export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import type { BankTransaction, ExpenseCategory, PaymentMode, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { listStores } from "@/lib/stores";
import { resolveStore, ExpenseAssignmentError } from "@/lib/expenses/assignment";

const log = createLogger("bank-statements:review");

// ─── Expenses created from a bank debit (plan 1210-expense-store-department-and-payer, Part G) ───

/** The reconcile screen's expense chips → `ExpenseCategory`. Anything unknown is MISCELLANEOUS. */
const EXPENSE_CATEGORY_MAP: Record<string, ExpenseCategory> = {
  EXPENSE_SALARY: "SALARY_ADVANCE",
  EXPENSE_RENT: "SHOP_MAINTENANCE",
  EXPENSE_UTILITY: "UTILITIES",
  EXPENSE_DELIVERY: "DELIVERY",
  EXPENSE_TRANSPORT: "TRANSPORT",
  EXPENSE_OTHER: "MISCELLANEOUS",
};

/**
 * `confirm_expense` body, single and bulk. Every expense names its store (R2, R6); whether the
 * id is a real, active store is `resolveStore`'s call, not the schema's.
 */
const confirmExpenseSchema = z.object({
  storeId: z.string({ error: "Pick the store this expense belongs to." }).trim().min(1, "Pick the store this expense belongs to."),
  category: z.string().optional(),
});

/** How a bank line paid, read off its reference. One rule for vendor payments and expenses (L8). */
function paymentModeFromReference(reference: string | null): PaymentMode {
  if (reference?.startsWith("UPI")) return "UPI";
  if (reference?.startsWith("NEFT") || reference?.startsWith("RTGS")) return "NEFT";
  return "CHEQUE";
}

/** The line was processed by an earlier (or concurrent) request. The route answers 409. */
class LineAlreadyProcessedError extends Error {
  readonly status = 409;
}

/**
 * The expense a bank debit becomes. Payer stays the typed "Bank Transfer" (E6) — the money
 * left the bank account, not a person's pocket. `notes` is how /expenses recognises a
 * bank-created row (its delete confirmation warns the bank line reopens); do not reword it.
 */
function expenseFromLine(
  line: BankTransaction,
  opts: { category: ExpenseCategory; storeId: string; recordedById: string }
): Prisma.ExpenseUncheckedCreateInput {
  return {
    date: line.date,
    amount: line.amount,
    category: opts.category,
    description: line.description,
    paidBy: "Bank Transfer",
    paidById: null,
    storeId: opts.storeId,
    paymentMode: paymentModeFromReference(line.reference),
    referenceNo: line.reference,
    notes: "Auto-recorded from bank statement",
    recordedById: opts.recordedById,
  };
}

// GET — Fetch statement transactions for review
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let statementId = "";
  try {
    await requireFeature("bills", "view");
    const { id } = await params;
    statementId = id;

    const [statement, stores] = await Promise.all([
      prisma.bankStatement.findUnique({
        where: { id },
        include: {
          uploadedBy: { select: { name: true } },
          transactions: {
            orderBy: { date: "desc" },
            include: {
              suggestedVendor: { select: { id: true, name: true } },
              suggestedBill: { select: { id: true, billNo: true, amount: true, paidAmount: true } },
            },
          },
        },
      }),
      listStores(),
    ]);

    if (!statement) return errorResponse("Statement not found", 404);
    // The Expense panel's store chips. Served here so reconciling needs no `expenses` grant.
    const expenseStores = stores.map((s) => ({ id: s.id, name: s.name }));
    return successResponse({ ...statement, expenseStores });
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("statement load refused", { statementId, status: error.status });
      return errorResponse(error.message, error.status);
    }
    log.error("statement load failed", {
      statementId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch statement", 500);
  }
}

// POST — Confirm/process a transaction match
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Hoisted so the catch can name what failed. Identifiers only — never the body.
  let statementId = "";
  let actionName = "";
  try {
    const user = await requireFeature("bills", "create");
    // The user the guard returned, not a second session read with a "" fallback (L6).
    const userId = user.id;
    const { id } = await params;
    statementId = id;

    const body = await req.json();
    const { txnId, txnIds, action, vendorId, billId } = body as {
      txnId?: string;
      txnIds?: string[];
      action: "confirm_payment" | "confirm_expense" | "ignore" | "flag";
      vendorId?: string;
      billId?: string;
    };
    actionName = typeof action === "string" ? action : "";

    // Support bulk actions via txnIds array
    const ids = txnIds || (txnId ? [txnId] : []);
    if (ids.length === 0) return errorResponse("No transaction IDs provided", 400);

    // Bulk expense: one transaction for every selected line, each line pointing at the expense
    // it became (L5). Only unprocessed DEBIT lines of this statement qualify.
    if (ids.length > 1 && action === "confirm_expense") {
      const input = confirmExpenseSchema.parse(body);
      const store = await resolveStore(input.storeId, userId);
      const category = EXPENSE_CATEGORY_MAP[input.category ?? ""] ?? "MISCELLANEOUS";

      const recorded = await prisma.$transaction(
        async (tx) => {
          const lines = await tx.bankTransaction.findMany({
            where: { id: { in: ids }, statementId: id, processedAt: null, type: "DEBIT" },
          });
          if (lines.length === 0) {
            throw new LineAlreadyProcessedError("These lines have already been processed.");
          }

          const done: { txnId: string; expenseId: string }[] = [];
          for (const line of lines) {
            const expense = await tx.expense.create({
              data: expenseFromLine(line, { category, storeId: store.id, recordedById: userId }),
            });
            // Conditional on processedAt: a concurrent request that claimed the line first makes
            // this match nothing, and the whole batch rolls back instead of double-recording.
            const claimed = await tx.bankTransaction.updateMany({
              where: { id: line.id, statementId: id, processedAt: null },
              data: { matchStatus: "EXPENSE", confirmedExpenseId: expense.id, processedAt: new Date() },
            });
            if (claimed.count !== 1) {
              throw new LineAlreadyProcessedError(
                "Some of these lines were processed by someone else meanwhile. Nothing was recorded — refresh and try again."
              );
            }
            done.push({ txnId: line.id, expenseId: expense.id });
          }
          return done;
        },
        // Two statements per line; a full statement's worth of debits outlives the 5 s default.
        { timeout: 30_000 }
      );

      log.info("bank line recorded as expense", {
        statementId: id,
        txnIds: recorded.map((r) => r.txnId),
        expenseIds: recorded.map((r) => r.expenseId),
        storeId: store.id,
      });
      return successResponse({ action, processed: recorded.length });
    }

    // For bulk actions, process all at once
    if (ids.length > 1 && (action === "ignore" || action === "confirm_payment")) {
      const txns = await prisma.bankTransaction.findMany({
        where: { id: { in: ids }, statementId: id, processedAt: null },
      });
      if (txns.length === 0) return errorResponse("No unprocessed transactions found", 404);

      let processed = 0;
      for (const t of txns) {
        if (action === "ignore") {
          await prisma.bankTransaction.update({
            where: { id: t.id },
            data: { matchStatus: "IGNORED", processedAt: new Date() },
          });
          processed++;
        } else if (action === "confirm_payment" && vendorId) {
          const payment = await prisma.vendorPayment.create({
            data: {
              vendorId, billId: null, amount: t.amount,
              paymentMode: paymentModeFromReference(t.reference),
              paymentDate: t.date, referenceNo: t.reference || t.description.slice(0, 50),
              notes: "Auto-recorded from bank statement", recordedById: userId,
            },
          });
          await prisma.bankTransaction.update({
            where: { id: t.id },
            data: { matchStatus: "MATCHED", confirmedVendorId: vendorId, confirmedPaymentId: payment.id, processedAt: new Date() },
          });
          processed++;
        }
      }
      return successResponse({ action, processed });
    }

    // Single transaction flow
    const singleId = ids[0];
    const txn = await prisma.bankTransaction.findFirst({
      where: { id: singleId, statementId: id },
    });
    if (!txn) return errorResponse("Transaction not found", 404);

    if (action === "confirm_payment" && vendorId) {
      // ONE TRANSACTION, AND A BALANCE GUARD.
      //
      // This path used to run three plain `prisma.` statements in sequence with no check on
      // the bill's remaining balance. Two things went wrong with that:
      //
      //   1. Confirming a bank match could drive `paidAmount` PAST `amount` — the state
      //      customers/[id]/route.ts:52 describes as "neither can be trusted". The sibling
      //      path in api/payments/route.ts:65 has always guarded this; this one did not.
      //   2. Without a transaction, a failure between the payment insert and the bill update
      //      left a VendorPayment row that no bill balance reflects.
      //
      // The epsilon matches api/payments/route.ts exactly and is deliberate: these columns are
      // Float, so an exact-settlement comparison needs the tolerance. It disappears the day
      // the money columns become Decimal — see docs/code-review-2026-09-02.md.
      const payment = await prisma.$transaction(async (tx) => {
        if (billId) {
          const bill = await tx.vendorBill.findUnique({ where: { id: billId } });
          if (!bill) throw new Error(`Bill not found: ${billId}`);
          const remaining = bill.amount - bill.paidAmount;
          if (txn.amount > remaining + 0.01) {
            throw new Error(
              `Bank transaction ₹${txn.amount} exceeds bill ${bill.billNo} remaining ₹${remaining.toFixed(2)}. Confirm against the right bill, or split the payment.`
            );
          }
        }

        const created = await tx.vendorPayment.create({
          data: {
            vendorId,
            billId: billId || null,
            amount: txn.amount,
            paymentMode: paymentModeFromReference(txn.reference),
            paymentDate: txn.date,
            referenceNo: txn.reference || txn.description.slice(0, 50),
            notes: `Auto-recorded from bank statement: ${txn.description}`,
            recordedById: userId,
          },
        });

        if (billId) {
          // Re-read inside the transaction so the balance the guard checked is the one we add to.
          const bill = await tx.vendorBill.findUnique({ where: { id: billId } });
          if (bill) {
            const newPaid = bill.paidAmount + txn.amount;
            await tx.vendorBill.update({
              where: { id: billId },
              data: {
                paidAmount: newPaid,
                status: newPaid >= bill.amount - 0.01 ? "PAID" : "PARTIALLY_PAID",
              },
            });
          }
        }

        await tx.bankTransaction.update({
          where: { id: singleId },
          data: {
            matchStatus: "MATCHED",
            confirmedVendorId: vendorId,
            confirmedPaymentId: created.id,
            processedAt: new Date(),
          },
        });

        return created;
      });

      log.info("bank match confirmed as payment", {
        statementId: id,
        txnId: singleId,
        paymentId: payment.id,
        vendorId,
        billId: billId || null,
      });
      return successResponse({ action: "payment_recorded", paymentId: payment.id });
    }

    if (action === "confirm_expense") {
      if (txn.type !== "DEBIT") return errorResponse("Only a debit line can be recorded as an expense.", 400);
      const input = confirmExpenseSchema.parse(body);
      const store = await resolveStore(input.storeId, userId);
      const category = EXPENSE_CATEGORY_MAP[input.category ?? ""] ?? "MISCELLANEOUS";

      // ONE TRANSACTION, AND A processedAt GUARD (L5). This path used to read the line without
      // checking processedAt and write the expense and the line in two separate statements, so a
      // retried request — a double tap, a flaky network — recorded a second expense.
      const expense = await prisma.$transaction(async (tx) => {
        const line = await tx.bankTransaction.findFirst({
          where: { id: singleId, statementId: id, processedAt: null, type: "DEBIT" },
        });
        if (!line) throw new LineAlreadyProcessedError("This line has already been processed.");

        const created = await tx.expense.create({
          data: expenseFromLine(line, { category, storeId: store.id, recordedById: userId }),
        });
        // Conditional on processedAt, so of two concurrent requests only one can claim the line;
        // the loser matches nothing and rolls its expense back.
        const claimed = await tx.bankTransaction.updateMany({
          where: { id: singleId, statementId: id, processedAt: null },
          data: { matchStatus: "EXPENSE", confirmedExpenseId: created.id, processedAt: new Date() },
        });
        if (claimed.count !== 1) throw new LineAlreadyProcessedError("This line has already been processed.");
        return created;
      });

      log.info("bank line recorded as expense", {
        statementId: id,
        txnIds: [singleId],
        expenseIds: [expense.id],
        storeId: store.id,
      });
      return successResponse({ action: "expense_recorded", expenseId: expense.id });
    }

    if (action === "ignore") {
      await prisma.bankTransaction.update({
        where: { id: singleId },
        data: { matchStatus: "IGNORED", processedAt: new Date() },
      });
      return successResponse({ action: "ignored" });
    }

    if (action === "flag") {
      await prisma.bankTransaction.update({
        where: { id: singleId },
        data: { matchStatus: "FLAGGED", flagReason: body.flagReason || "Manually flagged", processedAt: new Date() },
      });
      return successResponse({ action: "flagged" });
    }

    return errorResponse("Invalid action", 400);
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("review action refused", { statementId, action: actionName, status: error.status });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Invalid request";
      log.warn("review action failed validation", { statementId, action: actionName, message });
      return errorResponse(message, 400);
    }
    if (error instanceof ExpenseAssignmentError || error instanceof LineAlreadyProcessedError) {
      log.warn("review action refused", { statementId, action: actionName, status: error.status, reason: error.message });
      return errorResponse(error.message, error.status);
    }
    log.error("review action failed", {
      statementId,
      action: actionName,
      reason: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to process transaction", 500);
  }
}
