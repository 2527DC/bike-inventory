export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { bankAccountWriteSchema } from "@/lib/validations";
import { fromDateColumn, toDateColumn } from "@/lib/analytics/time";

// The bank accounts as DATA (plan 1210-bank-accounts-and-suspense, R1, §3 B2). The owner's four
// — ICICI, HDFC Hub, HDFC Centre, Dhanlaxmi — are rows here, never names in code. Adding,
// renaming or retiring one needs bank_recon.approve (Q8); reading them needs bank_recon.view.
// No DELETE anywhere: statements reference an account with onDelete Restrict, so an account
// that is no longer used is retired (PATCH isActive=false), not removed.
//
// Store and last four digits are OPTIONAL by the owner's decision (13 Oct 2026): production has
// one store, and HDFC Centre / ICICI / Dhanlaxmi show "Store not set" until someone picks one.

const log = createLogger("bank-accounts");

// The same select and serialiser live in ./[id]/route.ts — a route file may export only its
// handlers, so the two cannot share a constant without a lib file.
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

/** reconcileFrom is a calendar day (@db.Date) — sent as "YYYY-MM-DD", never as a UTC instant. */
function serialise(a: AccountRow) {
  return { ...a, reconcileFrom: a.reconcileFrom ? fromDateColumn(a.reconcileFrom) : null };
}

/** "2026-02-30" passes the YYYY-MM-DD regex; JavaScript would quietly read it as 2 March. */
function isRealDay(day: string): boolean {
  return fromDateColumn(toDateColumn(day)) === day;
}

// GET — the accounts, active only unless ?includeInactive=1 (the api/vendors convention).
export async function GET(req: NextRequest) {
  try {
    await requireFeature("bank_recon", "view");
    const includeInactive = req.nextUrl.searchParams.get("includeInactive") === "1";

    const rows = await prisma.bankAccount.findMany({
      where: includeInactive ? {} : { isActive: true },
      select: ACCOUNT_SELECT,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    log.debug("bank accounts listed", { count: rows.length, includeInactive });
    return successResponse(rows.map(serialise));
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "bank-accounts", step: "list" });
  }
}

// POST — add an account (Q8: bank_recon.approve).
export async function POST(req: NextRequest) {
  try {
    await requireFeature("bank_recon", "approve");
    const data = bankAccountWriteSchema.parse(await req.json());

    if (data.reconcileFrom && !isRealDay(data.reconcileFrom)) {
      return errorResponse(`"Reconcile from" is not a real date (${data.reconcileFrom}).`, 400);
    }

    if (data.storeId) {
      const store = await prisma.store.findUnique({ where: { id: data.storeId }, select: { isActive: true } });
      if (!store || !store.isActive) {
        log.warn("bank account refused: store missing or retired", { storeId: data.storeId });
        return errorResponse("Pick an active store — that one is missing or retired. Or leave the store unset for now.", 400);
      }
    }

    // A sentence by name before the insert. The unique index is still the real guard (the P2002
    // branch below) — this only makes the common case readable, and case-blind: "HDFC hub"
    // next to "HDFC Hub" would be two accounts nobody can tell apart on a chip.
    const sameName = await prisma.bankAccount.findFirst({
      where: { name: { equals: data.name, mode: "insensitive" } },
      select: { name: true },
    });
    if (sameName) {
      log.warn("bank account refused: duplicate name", { field: "name" });
      return errorResponse(`An account named ${sameName.name} already exists`, 409);
    }
    if (data.zohoAccountId) {
      const sameZoho = await prisma.bankAccount.findUnique({
        where: { zohoAccountId: data.zohoAccountId },
        select: { name: true },
      });
      if (sameZoho) {
        log.warn("bank account refused: duplicate Zoho id", { field: "zohoAccountId" });
        return errorResponse(`Zoho account id ${data.zohoAccountId} is already on ${sameZoho.name}`, 409);
      }
    }

    const created = await prisma.bankAccount.create({
      data: {
        name: data.name,
        bank: data.bank,
        accountLast4: data.accountLast4 ?? null,
        storeId: data.storeId ?? null,
        zohoAccountId: data.zohoAccountId ?? null,
        reconcileFrom: data.reconcileFrom ? toDateColumn(data.reconcileFrom) : null,
        sortOrder: data.sortOrder ?? 0,
      },
      select: ACCOUNT_SELECT,
    });

    log.info("bank account created", {
      bankAccountId: created.id,
      bank: created.bank,
      fields: Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined),
      hasStore: !!created.storeId,
    });
    return successResponse(serialise(created), 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Invalid bank account";
      log.warn("bank account refused: invalid", { reason: message });
      return errorResponse(message, 400);
    }
    if (error instanceof SyntaxError) {
      log.warn("bank account refused: body is not JSON");
      return errorResponse("The request body is not valid JSON", 400);
    }
    // Two people adding the same account at once: the pre-check passed for both, the index refused one.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.target ?? "");
      log.warn("bank account refused: duplicate (index)", { target });
      return errorResponse(
        target.includes("zoho")
          ? "That Zoho account id is already on another bank account"
          : "An account with that name already exists",
        409
      );
    }
    return failure(error, { scope: "bank-accounts", step: "create" });
  }
}
