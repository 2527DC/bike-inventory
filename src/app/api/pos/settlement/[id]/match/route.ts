export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// POST — Match a bank transaction to a settlement payment mode
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("pos", "approve");
    const { id } = await params;
    const body = await req.json();
    const { paymentMode, bankTxnId, matchedAmount, notes } = body as {
      paymentMode: string;
      bankTxnId: string;
      matchedAmount: number;
      notes?: string;
    };

    if (!paymentMode || !bankTxnId || !matchedAmount) {
      return errorResponse("paymentMode, bankTxnId, and matchedAmount required", 400);
    }

    const settlement = await prisma.dailySettlement.findUnique({ where: { id } });
    if (!settlement) return errorResponse("Settlement not found", 404);

    const bankTxn = await prisma.bankTransaction.findUnique({ where: { id: bankTxnId } });
    if (!bankTxn) return errorResponse("Bank transaction not found", 404);

    // Get the expected amount for this payment mode
    const modeAmounts: Record<string, number> = {
      CARD: settlement.totalCard,
      UPI: settlement.totalUpi,
      FINANCE: settlement.totalFinance,
      CASH_DEPOSIT: settlement.totalCash,
    };
    const expectedAmount = modeAmounts[paymentMode] || 0;
    const variance = matchedAmount - expectedAmount;

    const match = await prisma.$transaction(async (tx) => {
      const m = await tx.settlementMatch.create({
        data: {
          settlementId: id,
          paymentMode,
          expectedAmount,
          bankTxnId,
          matchedAmount,
          variance,
          isMatched: true,
          notes,
        },
      });

      // Mark bank transaction as matched
      await tx.bankTransaction.update({
        where: { id: bankTxnId },
        data: { matchStatus: "MATCHED", processedAt: new Date() },
      });

      // Update settlement totals
      const allMatches = await tx.settlementMatch.findMany({
        where: { settlementId: id, isMatched: true },
      });
      const totalMatched = allMatches.reduce((s, m) => s + m.matchedAmount, 0);
      const unmatched = settlement.grandTotal - totalMatched;
      const allModesMatched = totalMatched >= settlement.grandTotal * 0.95; // 95% threshold

      await tx.dailySettlement.update({
        where: { id },
        data: {
          matchedAmount: totalMatched,
          unmatchedAmount: Math.max(0, unmatched),
          status: allModesMatched ? "FULLY_MATCHED" : "PARTIALLY_MATCHED",
        },
      });

      return m;
    });

    return successResponse(match);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create match", 500);
  }
}

// DELETE — Remove a match
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("pos", "approve");
    const { id } = await params;
    const body = await req.json();
    const { matchId } = body as { matchId: string };

    if (!matchId) return errorResponse("matchId required", 400);

    const match = await prisma.settlementMatch.findFirst({
      where: { id: matchId, settlementId: id },
    });
    if (!match) return errorResponse("Match not found", 404);

    await prisma.$transaction(async (tx) => {
      // Restore bank transaction
      if (match.bankTxnId) {
        await tx.bankTransaction.update({
          where: { id: match.bankTxnId },
          data: { matchStatus: "UNMATCHED", processedAt: null },
        });
      }

      await tx.settlementMatch.delete({ where: { id: matchId } });

      // Recalculate settlement totals
      const remaining = await tx.settlementMatch.findMany({
        where: { settlementId: id, isMatched: true },
      });
      const totalMatched = remaining.reduce((s, m) => s + m.matchedAmount, 0);
      const settlement = await tx.dailySettlement.findUnique({ where: { id } });
      if (settlement) {
        await tx.dailySettlement.update({
          where: { id },
          data: {
            matchedAmount: totalMatched,
            unmatchedAmount: Math.max(0, settlement.grandTotal - totalMatched),
            status: totalMatched > 0 ? "PARTIALLY_MATCHED" : settlement.cashVerifiedAt ? "CASH_VERIFIED" : "PENDING",
          },
        });
      }
    });

    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}
