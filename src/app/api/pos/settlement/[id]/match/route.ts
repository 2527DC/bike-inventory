export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { BankLineError, claimLine, closeCaseAsRecorded, releaseLine } from "@/lib/bank-recon/lines";

const log = createLogger("pos:settlement-match");

/** "12 Oct" — the settlement day in a suspense note. Settlement dates are stored at UTC midnight. */
function settlementDay(date: Date): string {
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

// POST — Match a bank transaction to a settlement payment mode
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let settlementId: string | undefined;
  let txnId: string | undefined;
  try {
    const user = await requireFeature("pos", "approve");
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
    settlementId = id;
    txnId = bankTxnId;

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

      // Mark the bank line matched — through the one state machine (plan 1210 bank, D5). The
      // claim refuses a line already recorded, skipped or matched (409, finding L13's double
      // use); a line parked in suspense may be matched, and its case closes as RECORDED.
      await claimLine(tx, bankTxnId, { matchStatus: "MATCHED" });
      await closeCaseAsRecorded(tx, bankTxnId, user.id, `Matched in settlement ${settlementDay(settlement.date)}, ${paymentMode}`);

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

    log.info("matched", { settlementId: id, bankTxnId, paymentMode, matchId: match.id });
    return successResponse(match);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof BankLineError) {
      log.warn("line already handled", { settlementId, bankTxnId: txnId, status: error.status });
      return errorResponse(error.message, error.status);
    }
    return failure(error, { scope: "pos:settlement-match", step: "match", settlementId, bankTxnId: txnId });
  }
}

// DELETE — Remove a match
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let settlementId: string | undefined;
  try {
    const user = await requireFeature("pos", "approve");
    const { id } = await params;
    const body = await req.json();
    const { matchId } = body as { matchId: string };

    if (!matchId) return errorResponse("matchId required", 400);
    settlementId = id;

    const match = await prisma.settlementMatch.findFirst({
      where: { id: matchId, settlementId: id },
    });
    if (!match) return errorResponse("Match not found", 404);

    const releasedTo = await prisma.$transaction(async (tx) => {
      // Release the bank line (plan 1210 bank, D5): back to review — or, if it came out of
      // suspense, back into suspense with its case reopened.
      let to: "suspense" | "review" | null = null;
      if (match.bankTxnId) {
        const settlementRow = await tx.dailySettlement.findUnique({ where: { id }, select: { date: true } });
        const day = settlementRow ? ` ${settlementDay(settlementRow.date)}` : "";
        to = await releaseLine(tx, match.bankTxnId, user.id, `settlement match removed (settlement${day}, ${match.paymentMode})`);
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
      return to;
    });

    log.info("unmatched", { settlementId: id, bankTxnId: match.bankTxnId, paymentMode: match.paymentMode, releasedTo });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "pos:settlement-match", step: "unmatch", settlementId });
  }
}
