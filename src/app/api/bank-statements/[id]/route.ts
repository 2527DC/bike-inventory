export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { createLogger } from "@/lib/logger";
import { bankStatementAssignSchema } from "@/lib/validations";
import { BankLineError } from "@/lib/bank-recon/lines";

// Give a statement its bank account (plan 1210-bank-accounts-and-suspense, Q7, §3 B5).
//
// Statements uploaded before bank accounts existed carry only "HDFC" or "ICICI" — and HDFC Hub
// cannot be told from HDFC Centre by the file. A person assigns them on /accounts/bank-upload.
//
//   - An unassigned statement: bank_recon.edit.
//   - Moving an ASSIGNED one: also bank_recon.approve — a mis-click between HDFC Hub and HDFC
//     Centre must be correctable, by someone senior.
//   - The account's bank must equal the statement's bank: an ICICI file never lands on HDFC.
//   - One transaction moves the statement AND every line on it. BankTransaction.bankAccountId is
//     a copy of the statement's, written only here and by the upload; it exists for the duplicate
//     index and the weekly tile, so the two must never disagree.

const log = createLogger("bank-statements:assign");

/** How a bank code reads in a sentence. Old statements hold free strings; fall back to them. */
const BANK_WORDS: Record<string, string> = {
  ICICI: "ICICI",
  HDFC: "HDFC",
  DHANLAXMI: "Dhanlaxmi",
  OTHER: "another bank",
};
const bankWord = (code: string) => BANK_WORDS[code] ?? code;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let statementId: string | undefined;
  let accountName: string | undefined;
  let targetAccountId: string | undefined;
  try {
    const user = await requireFeature("bank_recon", "edit");
    ({ id: statementId } = await params);
    const { bankAccountId } = bankStatementAssignSchema.parse(await req.json());
    targetAccountId = bankAccountId;

    const statement = await prisma.bankStatement.findUnique({
      where: { id: statementId },
      select: { id: true, bank: true, bankAccountId: true, bankAccount: { select: { name: true } } },
    });
    if (!statement) return errorResponse("Statement not found", 404);

    // Run twice, or by two people choosing the same account: nothing to do, and say so plainly.
    if (statement.bankAccountId === bankAccountId) {
      return successResponse({ id: statement.id, bankAccountId, accountName: statement.bankAccount?.name ?? null, lines: 0, unchanged: true });
    }

    if (statement.bankAccountId && !(await userCan(user.id, "bank_recon", "approve"))) {
      log.warn("reassign refused without approve", { statementId, from: statement.bankAccountId, to: bankAccountId });
      return errorResponse(
        `This statement is already on ${statement.bankAccount?.name ?? "another account"}. Moving it needs approve permission on Bank Reconciliation.`,
        403
      );
    }

    const account = await prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
      select: { id: true, name: true, bank: true, isActive: true },
    });
    if (!account || !account.isActive) {
      log.warn("assign refused: account missing or retired", { statementId, bankAccountId });
      return errorResponse("Pick an active bank account", 400);
    }
    accountName = account.name;

    if (account.bank !== statement.bank) {
      log.warn("assign refused: bank mismatch", {
        statementId,
        bankAccountId,
        statementBank: statement.bank,
        accountBank: account.bank,
      });
      return errorResponse(
        `This statement is from ${bankWord(statement.bank)}, but ${account.name} is at ${bankWord(account.bank)}. Pick an account at ${bankWord(statement.bank)}.`,
        400
      );
    }

    const lines = await prisma.$transaction(async (tx) => {
      // The guard IS the write: the statement moves only if it is still where it was read. Two
      // people assigning one old statement at once — the second finds nothing to move.
      const moved = await tx.bankStatement.updateMany({
        where: { id: statement.id, bankAccountId: statement.bankAccountId },
        data: { bankAccountId: account.id },
      });
      if (moved.count === 0) {
        throw new BankLineError("Someone else just assigned this statement — reload to see where it went.", 409);
      }
      const res = await tx.bankTransaction.updateMany({
        where: { statementId: statement.id },
        data: { bankAccountId: account.id },
      });
      return res.count;
    });

    log.info("statement assigned", {
      statementId,
      bankAccountId: account.id,
      from: statement.bankAccountId,
      lines,
    });
    return successResponse({ id: statement.id, bankAccountId: account.id, accountName: account.name, lines });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof BankLineError) {
      log.warn("assign refused", { statementId, status: error.status, reason: error.message });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Pick the bank account";
      log.warn("assign refused: invalid body", { statementId, reason: message });
      return errorResponse(message, 400);
    }
    if (error instanceof SyntaxError) {
      log.warn("assign refused: body is not JSON", { statementId });
      return errorResponse("The request body is not valid JSON", 400);
    }
    // A newer statement moved onto an account that already holds the same lines (same
    // fingerprint). Old statements have no fingerprints, so they never collide.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      log.warn("assign refused: lines collide", { statementId, bankAccountId: targetAccountId });
      return errorResponse(`These lines are already on ${accountName ?? "that account"}`, 409);
    }
    return failure(error, { scope: "bank-statements:assign", statementId, bankAccountId: targetAccountId });
  }
}
