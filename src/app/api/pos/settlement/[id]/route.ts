export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError, getServerSession } from "@/lib/auth-helpers";
import { ZohoClient } from "@/lib/zoho";

// GET — Settlement detail with sessions and matches
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("pos", "view");
    const { id } = await params;

    const settlement = await prisma.dailySettlement.findUnique({
      where: { id },
      include: {
        sessions: true,
        matches: {
          include: {
            bankTxn: { select: { id: true, description: true, amount: true, date: true, reference: true } },
          },
        },
        cashVerifiedBy: { select: { name: true } },
      },
    });

    if (!settlement) return errorResponse("Settlement not found", 404);

    // Also fetch bank transactions around this date (±1 day) for matching
    const date = settlement.date;
    const dayBefore = new Date(date);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dayAfter = new Date(date);
    dayAfter.setDate(dayAfter.getDate() + 2);

    const bankTxns = await prisma.bankTransaction.findMany({
      where: {
        date: { gte: dayBefore, lte: dayAfter },
        type: "CREDIT",
        matchStatus: { in: ["UNMATCHED", "FLAGGED"] },
      },
      orderBy: { amount: "desc" },
      take: 50,
    });

    // Fetch customer payments from Zoho Books for this date
    let zohoPayments: Array<{
      payment_id: string; date: string; amount: number;
      payment_mode: string; customer_name: string; reference_number: string;
      account_name: string;
    }> = [];
    try {
      const zoho = new ZohoClient();
      const ok = await zoho.init();
      if (ok) {
        const dateStr = settlement.date.toISOString().split("T")[0];
        const data = await zoho.listCustomerPayments(1, dateStr, dateStr);
        zohoPayments = data.customerpayments || [];
      }
    } catch {
      // Non-critical — page works without payments
    }

    return successResponse({ settlement, bankTxns, zohoPayments });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}

// PUT — Update settlement (cash verification, update POS mode breakdowns)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession();
    await requireFeature("pos", "edit");
    const userId = (session?.user as { userId?: string })?.userId || "";
    const { id } = await params;
    const body = await req.json();

    const settlement = await prisma.dailySettlement.findUnique({ where: { id } });
    if (!settlement) return errorResponse("Settlement not found", 404);

    // Cash verification
    if (body.cashCounted !== undefined) {
      const cashCounted = parseFloat(body.cashCounted);
      const cashVariance = cashCounted - settlement.totalCash;
      const newStatus = settlement.matchedAmount > 0 ? "PARTIALLY_MATCHED" : "CASH_VERIFIED";

      const updated = await prisma.dailySettlement.update({
        where: { id },
        data: {
          cashCounted,
          cashVariance,
          cashVerifiedAt: new Date(),
          cashVerifiedById: userId,
          status: newStatus as "CASH_VERIFIED" | "PARTIALLY_MATCHED",
        },
      });
      return successResponse(updated);
    }

    // Update POS mode breakdowns (manual entry when Zakya doesn't provide breakdown)
    if (body.totalCash !== undefined || body.totalCard !== undefined || body.totalUpi !== undefined || body.totalFinance !== undefined || body.totalCredit !== undefined) {
      const totalCash = body.totalCash ?? settlement.totalCash;
      const totalCard = body.totalCard ?? settlement.totalCard;
      const totalUpi = body.totalUpi ?? settlement.totalUpi;
      const totalFinance = body.totalFinance ?? settlement.totalFinance;
      const totalCredit = body.totalCredit ?? settlement.totalCredit;

      const updated = await prisma.dailySettlement.update({
        where: { id },
        data: { totalCash, totalCard, totalUpi, totalFinance, totalCredit, notes: body.notes ?? settlement.notes },
      });
      return successResponse(updated);
    }

    // Cash In / Cash Out (manual daily recording)
    if (body.cashIn !== undefined || body.cashOut !== undefined) {
      const updated = await prisma.dailySettlement.update({
        where: { id },
        data: {
          cashIn: body.cashIn !== undefined ? parseFloat(body.cashIn) : settlement.cashIn,
          cashOut: body.cashOut !== undefined ? parseFloat(body.cashOut) : settlement.cashOut,
          cashOutReason: body.cashOutReason ?? settlement.cashOutReason,
        },
      });
      return successResponse(updated);
    }

    return errorResponse("No valid update fields", 400);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}
