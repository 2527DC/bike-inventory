export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { expenseSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { tryGetStorage } from "@/lib/storage";
import { createLogger } from "@/lib/logger";

const log = createLogger("expenses:delete");

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("expenses", "view");
    const { id } = await params;
    const expense = await prisma.expense.findUnique({
      where: { id },
      include: { recordedBy: { select: { name: true } } },
    });

    if (!expense) return errorResponse("Expense not found", 404);
    return successResponse(expense);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch expense", 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("expenses", "edit");
    const { id } = await params;
    const body = await req.json();
    const data = expenseSchema.partial().parse(body);

    const expense = await prisma.expense.update({
      where: { id },
      data: {
        ...(data.date && { date: new Date(data.date) }),
        ...(data.amount !== undefined && { amount: data.amount }),
        ...(data.category && { category: data.category }),
        ...(data.description && { description: data.description }),
        ...(data.paidBy && { paidBy: data.paidBy }),
        ...(data.paymentMode && { paymentMode: data.paymentMode }),
        ...(data.referenceNo !== undefined && { referenceNo: data.referenceNo }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
      include: { recordedBy: { select: { name: true } } },
    });

    return successResponse(expense);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update expense", 400);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("expenses", "delete");
    const { id } = await params;

    const existing = await prisma.expense.findUnique({ where: { id }, select: { receiptUrl: true } });
    if (!existing) return errorResponse("Expense not found", 404);

    // Row first, then the object (plan Q6b). A row that outlives its photo is a broken link;
    // a photo that outlives its row is an orphan, which is the lesser fault — and both
    // providers treat deleting an absent object as success, so a retry is safe.
    await prisma.expense.delete({ where: { id } });
    const hadReceipt = Boolean(existing.receiptUrl);
    log.info("row deleted", { expenseId: id, hadReceipt });

    if (existing.receiptUrl) await removeReceipt(id, existing.receiptUrl);

    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("delete refused", { status: error.status });
      return errorResponse(error.message, error.status);
    }
    log.error("delete failed", { reason: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to delete expense", 400);
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
