export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError, getServerSession } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("bank-statements:review");

// GET — Fetch statement transactions for review
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("bills", "view");
    const { id } = await params;

    const statement = await prisma.bankStatement.findUnique({
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
    });

    if (!statement) return errorResponse("Statement not found", 404);
    return successResponse(statement);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch statement", 500);
  }
}

// POST — Confirm/process a transaction match
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession();
    await requireFeature("bills", "create");
    const userId = (session?.user as { userId?: string })?.userId || "";
    const { id } = await params;

    const body = await req.json();
    const { txnId, txnIds, action, vendorId, billId, category } = body as {
      txnId?: string;
      txnIds?: string[];
      action: "confirm_payment" | "confirm_expense" | "ignore" | "flag";
      vendorId?: string;
      billId?: string;
      category?: string;
    };

    // Support bulk actions via txnIds array
    const ids = txnIds || (txnId ? [txnId] : []);
    if (ids.length === 0) return errorResponse("No transaction IDs provided", 400);

    // For bulk actions, process all at once
    if (ids.length > 1 && (action === "confirm_expense" || action === "ignore" || action === "confirm_payment")) {
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
        } else if (action === "confirm_expense") {
          const categoryMap: Record<string, string> = {
            EXPENSE_SALARY: "SALARY_ADVANCE", EXPENSE_RENT: "SHOP_MAINTENANCE",
            EXPENSE_UTILITY: "UTILITIES", EXPENSE_DELIVERY: "DELIVERY",
            EXPENSE_TRANSPORT: "TRANSPORT", EXPENSE_OTHER: "MISCELLANEOUS",
          };
          await prisma.expense.create({
            data: {
              date: t.date, amount: t.amount,
              category: (categoryMap[category || ""] || "MISCELLANEOUS") as "SALARY_ADVANCE" | "SHOP_MAINTENANCE" | "UTILITIES" | "DELIVERY" | "TRANSPORT" | "MISCELLANEOUS",
              description: t.description, paidBy: "Bank Transfer", paymentMode: "NEFT",
              referenceNo: t.reference, notes: "Auto-recorded from bank statement",
              recordedById: userId,
            },
          });
          await prisma.bankTransaction.update({
            where: { id: t.id },
            data: { matchStatus: "EXPENSE", processedAt: new Date() },
          });
          processed++;
        } else if (action === "confirm_payment" && vendorId) {
          const payment = await prisma.vendorPayment.create({
            data: {
              vendorId, billId: null, amount: t.amount,
              paymentMode: t.reference?.startsWith("UPI") ? "UPI" : t.reference?.startsWith("NEFT") || t.reference?.startsWith("RTGS") ? "NEFT" : "CHEQUE",
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
            paymentMode: txn.reference?.startsWith("UPI") ? "UPI" : txn.reference?.startsWith("NEFT") || txn.reference?.startsWith("RTGS") ? "NEFT" : "CHEQUE",
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
      // Map category to ExpenseCategory enum
      const categoryMap: Record<string, string> = {
        EXPENSE_SALARY: "SALARY_ADVANCE",
        EXPENSE_RENT: "SHOP_MAINTENANCE",
        EXPENSE_UTILITY: "UTILITIES",
        EXPENSE_DELIVERY: "DELIVERY",
        EXPENSE_TRANSPORT: "TRANSPORT",
        EXPENSE_OTHER: "MISCELLANEOUS",
      };

      const expense = await prisma.expense.create({
        data: {
          date: txn.date,
          amount: txn.amount,
          category: (categoryMap[category || ""] || "MISCELLANEOUS") as "SALARY_ADVANCE" | "SHOP_MAINTENANCE" | "UTILITIES" | "DELIVERY" | "TRANSPORT" | "MISCELLANEOUS",
          description: txn.description,
          paidBy: "Bank Transfer",
          paymentMode: "NEFT",
          referenceNo: txn.reference,
          notes: `Auto-recorded from bank statement`,
          recordedById: userId,
        },
      });

      await prisma.bankTransaction.update({
        where: { id: singleId },
        data: {
          matchStatus: "EXPENSE",
          confirmedExpenseId: expense.id,
          processedAt: new Date(),
        },
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
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to process transaction", 500);
  }
}
