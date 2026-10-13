export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { bankAccountUpdateSchema } from "@/lib/validations";
import { fromDateColumn, toDateColumn } from "@/lib/analytics/time";

// Edit or retire one bank account (plan 1210-bank-accounts-and-suspense, §3 B2; Q8:
// bank_recon.approve). There is deliberately NO DELETE: statements and lines point here with
// onDelete Restrict, so an account no longer in use is retired — it leaves the upload chips and
// the weekly tile, and every statement it holds keeps its name.

const log = createLogger("bank-accounts");

// Kept in step with ../route.ts by hand — a route file may export only its handlers.
const ACCOUNT_SELECT = {
  id: true,
  name: true,
  bank: true,
  accountLast4: true,
  storeId: true,
  store: { select: { id: true, code: true, name: true } },
  zohoAccountId: true,
  reconcileFrom: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BankAccountSelect;

type AccountRow = Prisma.BankAccountGetPayload<{ select: typeof ACCOUNT_SELECT }>;

function serialise(a: AccountRow) {
  return { ...a, reconcileFrom: a.reconcileFrom ? fromDateColumn(a.reconcileFrom) : null };
}

function isRealDay(day: string): boolean {
  return fromDateColumn(toDateColumn(day)) === day;
}

// PATCH — any subset of the B2 fields, plus isActive. `null` clears an optional field
// (store, last four, Zoho id, reconcile from); a key left out is left alone.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let bankAccountId: string | undefined;
  try {
    await requireFeature("bank_recon", "approve");
    ({ id: bankAccountId } = await params);
    const data = bankAccountUpdateSchema.parse(await req.json());

    const fields = Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined);
    if (fields.length === 0) return errorResponse("Nothing to change", 400);

    const existing = await prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
      select: { id: true, name: true, bank: true, isActive: true },
    });
    if (!existing) return errorResponse("Bank account not found", 404);

    if (data.reconcileFrom && !isRealDay(data.reconcileFrom)) {
      return errorResponse(`"Reconcile from" is not a real date (${data.reconcileFrom}).`, 400);
    }

    if (data.storeId) {
      const store = await prisma.store.findUnique({ where: { id: data.storeId }, select: { isActive: true } });
      if (!store || !store.isActive) {
        log.warn("bank account refused: store missing or retired", { bankAccountId, storeId: data.storeId });
        return errorResponse("Pick an active store — that one is missing or retired. Or leave the store unset for now.", 400);
      }
    }

    // A statement's `bank` is a copy of its account's bank, and "assign an account" (B5) refuses
    // to put an HDFC file on an ICICI account. Changing the bank of an account that already holds
    // statements would break both at once — so it is refused, and a new account is the answer.
    if (data.bank && data.bank !== existing.bank) {
      const statements = await prisma.bankStatement.count({ where: { bankAccountId } });
      if (statements > 0) {
        log.warn("bank account refused: bank change with statements", { bankAccountId, statements });
        return errorResponse(
          `${existing.name} already has ${statements} statement${statements === 1 ? "" : "s"} from ${existing.bank} — its bank cannot change. Add a new account instead.`,
          400
        );
      }
    }

    if (data.name) {
      const sameName = await prisma.bankAccount.findFirst({
        where: { name: { equals: data.name, mode: "insensitive" }, id: { not: bankAccountId } },
        select: { name: true },
      });
      if (sameName) {
        log.warn("bank account refused: duplicate name", { bankAccountId, field: "name" });
        return errorResponse(`An account named ${sameName.name} already exists`, 409);
      }
    }
    if (data.zohoAccountId) {
      const sameZoho = await prisma.bankAccount.findFirst({
        where: { zohoAccountId: data.zohoAccountId, id: { not: bankAccountId } },
        select: { name: true },
      });
      if (sameZoho) {
        log.warn("bank account refused: duplicate Zoho id", { bankAccountId, field: "zohoAccountId" });
        return errorResponse(`Zoho account id ${data.zohoAccountId} is already on ${sameZoho.name}`, 409);
      }
    }

    const updated = await prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.bank !== undefined ? { bank: data.bank } : {}),
        ...(data.accountLast4 !== undefined ? { accountLast4: data.accountLast4 } : {}),
        ...(data.storeId !== undefined ? { storeId: data.storeId } : {}),
        ...(data.zohoAccountId !== undefined ? { zohoAccountId: data.zohoAccountId } : {}),
        ...(data.reconcileFrom !== undefined
          ? { reconcileFrom: data.reconcileFrom ? toDateColumn(data.reconcileFrom) : null }
          : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
      select: ACCOUNT_SELECT,
    });

    const event =
      data.isActive === false && existing.isActive
        ? "retired"
        : data.isActive === true && !existing.isActive
          ? "reactivated"
          : "updated";
    log.info(`bank account ${event}`, { bankAccountId, fields });
    return successResponse(serialise(updated));
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Invalid bank account";
      log.warn("bank account refused: invalid", { bankAccountId, reason: message });
      return errorResponse(message, 400);
    }
    if (error instanceof SyntaxError) {
      log.warn("bank account refused: body is not JSON", { bankAccountId });
      return errorResponse("The request body is not valid JSON", 400);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.target ?? "");
      log.warn("bank account refused: duplicate (index)", { bankAccountId, target });
      return errorResponse(
        target.includes("zoho")
          ? "That Zoho account id is already on another bank account"
          : "An account with that name already exists",
        409
      );
    }
    return failure(error, { scope: "bank-accounts", step: "update", bankAccountId });
  }
}
