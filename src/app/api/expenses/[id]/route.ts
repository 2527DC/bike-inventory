export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { expenseUpdateSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { tryGetStorage } from "@/lib/storage";
import { createLogger } from "@/lib/logger";
import { logActivity } from "@/lib/activity-log";
import { EXPENSE_INCLUDE } from "@/lib/expenses/filters";
import { releaseLine } from "@/lib/bank-recon/lines";

const log = createLogger("expenses:delete");
const editLog = createLogger("expenses:edit");

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("expenses", "view");
    const { id } = await params;
    const expense = await prisma.expense.findUnique({ where: { id }, include: EXPENSE_INCLUDE });

    if (!expense) return errorResponse("Expense not found", 404);
    return successResponse(expense);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    editLog.error("fetch failed", { reason: error instanceof Error ? error.message : String(error) });
    return errorResponse("Failed to fetch expense", 500);
  }
}

// PUT /api/expenses/[id] — no screen calls this (plan 1210-expense-store, E8: a wrong store or
// payer is fixed by deleting and re-entering). It does not accept a payer or a store: a
// free-text `paidBy` would desynchronise `paidById`.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("expenses", "edit");
    const { id } = await params;
    const body = await req.json();
    const data = expenseUpdateSchema.parse(body);

    const expense = await prisma.expense.update({
      where: { id },
      data: {
        ...(data.date && { date: new Date(data.date) }),
        ...(data.amount !== undefined && { amount: data.amount }),
        ...(data.category && { category: data.category }),
        ...(data.description && { description: data.description }),
        ...(data.paymentMode && { paymentMode: data.paymentMode }),
        ...(data.referenceNo !== undefined && { referenceNo: data.referenceNo }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
      include: EXPENSE_INCLUDE,
    });

    editLog.info("expense updated", { expenseId: id, fields: Object.keys(data) });
    return successResponse(expense);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Invalid expense details";
      editLog.warn("update failed validation", { message });
      return errorResponse(message, 400);
    }
    editLog.error("update failed", { reason: error instanceof Error ? error.message : String(error) });
    return errorResponse("Failed to update expense", 400);
  }
}

/** "Transport ₹1,200 12 Oct 2026" — the human reference the activity feed shows. */
function expenseRef(e: { category: string; amount: number; date: Date }): string {
  const category = e.category
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const amount = `₹${e.amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const date = e.date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  return `${category} ${amount} ${date}`;
}

// DELETE /api/expenses/[id] — a hard delete (owner, 12 Oct 2026, E9), recorded in the activity
// log. One transaction: the bank statement line this expense was created from (at most one —
// confirmedExpenseId is unique) is released through the bank-line state machine — back to
// "to review", or back into suspense if that is where it came from (plan 1210 bank, D5, Q12 = a;
// otherwise it stays marked EXPENSE, pointing at a row that no longer exists — L10/D11) — the
// row is deleted, and the log entry is written. Then the receipt photo is removed.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("expenses", "delete");
    const { id } = await params;

    const existing = await prisma.expense.findUnique({
      where: { id },
      select: {
        id: true,
        category: true,
        amount: true,
        date: true,
        paidBy: true,
        receiptUrl: true,
        store: { select: { name: true } },
        recordedBy: { select: { name: true } },
      },
    });
    if (!existing) return errorResponse("Expense not found", 404);

    // Row first, then the object (plan 0909 Q6b). A row that outlives its photo is a broken
    // link; a photo that outlives its row is an orphan, which is the lesser fault — and both
    // providers treat deleting an absent object as success, so a retry is safe.
    const bankLine = await prisma.$transaction(async (tx) => {
      const line = await tx.bankTransaction.findUnique({ where: { confirmedExpenseId: id }, select: { id: true } });
      const releasedTo = line
        ? await releaseLine(tx, line.id, user.id, `the expense it was recorded as (${expenseRef(existing)}) was deleted`)
        : null;
      await tx.expense.delete({ where: { id } });
      await logActivity(tx, {
        module: "expenses",
        action: "deleted",
        entityType: "Expense",
        entityId: id,
        entityRef: expenseRef(existing),
        details: [
          existing.store?.name ?? "No store",
          `paid by ${existing.paidBy}`,
          `recorded by ${existing.recordedBy.name}`,
          releasedTo === "suspense" ? "bank line back in suspense" : releasedTo === "review" ? "bank line back to review" : null,
        ]
          .filter(Boolean)
          .join(" · "),
        userId: user.id,
        userName: user.name,
      });
      return { bankTxnId: line?.id ?? null, releasedTo };
    });
    if (bankLine.bankTxnId) {
      log.warn("expense behind a bank line deleted", { expenseId: id, bankTxnId: bankLine.bankTxnId, releasedTo: bankLine.releasedTo });
    }
    // Kept as a count for the screen that reads it (expenses/_components/delete-expense-sheet.tsx).
    const bankLinesReopened = bankLine.releasedTo ? 1 : 0;

    const hadReceipt = Boolean(existing.receiptUrl);
    log.info("row deleted", { expenseId: id, hadReceipt, bankLinesReopened, deletedById: user.id });

    if (existing.receiptUrl) await removeReceipt(id, existing.receiptUrl);

    return successResponse({ deleted: true, bankLinesReopened, bankLineReleasedTo: bankLine.releasedTo });
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("delete refused", { status: error.status });
      return errorResponse(error.message, error.status);
    }
    log.error("delete failed", { reason: error instanceof Error ? error.message : String(error) });
    return errorResponse("Failed to delete expense", 400);
  }
}

/**
 * Remove the stored receipt photo. Never throws: the bookkeeping action (the row) has already
 * succeeded, so a storage fault here is a warning someone should see, not a failed request.
 */
async function removeReceipt(expenseId: string, receiptUrl: string): Promise<void> {
  const storage = await tryGetStorage();
  if (!storage) {
    log.warn("receipt not removed", { expenseId, key: null, reason: "storage not configured" });
    return;
  }
  // keyFromUrl answers null for a URL this provider did not issue — a photo stored before the
  // provider was switched. Nothing to delete on the live provider; the old object is left.
  const key = storage.keyFromUrl(receiptUrl);
  if (!key) {
    log.warn("receipt not removed", { expenseId, key: null, reason: "url not issued by the live provider", provider: storage.key });
    return;
  }
  try {
    await storage.delete(key);
    log.debug("receipt removed", { expenseId, key, provider: storage.key });
  } catch (e) {
    log.warn("receipt not removed", {
      expenseId,
      key,
      provider: storage.key,
      reason: e instanceof Error ? e.message : String(e),
    });
  }
}
