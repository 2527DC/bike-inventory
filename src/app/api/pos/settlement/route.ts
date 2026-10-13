export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { releaseLine } from "@/lib/bank-recon/lines";

const log = createLogger("pos:settlement");

// GET — List daily settlements
export async function GET(req: NextRequest) {
  try {
    await requireFeature("pos", "view");
    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    const where: Record<string, unknown> = {};
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) (where.date as Record<string, unknown>).gte = new Date(dateFrom);
      if (dateTo) (where.date as Record<string, unknown>).lte = new Date(dateTo + "T23:59:59Z");
    }

    const settlements = await prisma.dailySettlement.findMany({
      where,
      orderBy: { date: "desc" },
      take: 30,
      include: {
        sessions: { select: { id: true, totalSales: true, invoiceCount: true, zakyaSessionId: true, cashierName: true } },
        cashVerifiedBy: { select: { name: true } },
        _count: { select: { matches: true } },
      },
    });

    return successResponse(settlements);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "pos:settlement", step: "list" });
  }
}

// POST — Create a daily settlement from POS sessions for a given date
export async function POST(req: NextRequest) {
  try {
    await requireFeature("pos", "create");
    const body = await req.json();
    const { date } = body as { date: string };

    if (!date) return errorResponse("Date required", 400);

    const settlementDate = new Date(date);
    const existing = await prisma.dailySettlement.findUnique({ where: { date: settlementDate } });
    if (existing) return errorResponse("Settlement already exists for this date", 400);

    // Find all POS sessions for this date
    const startOfDay = new Date(date + "T00:00:00Z");
    const endOfDay = new Date(date + "T23:59:59Z");

    const sessions = await prisma.posSession.findMany({
      where: {
        sessionDate: { gte: startOfDay, lte: endOfDay },
        settlementId: null,
      },
    });

    if (sessions.length === 0) return errorResponse("No unlinked POS sessions found for this date. Fetch sessions first.", 404);

    const totalCash = sessions.reduce((s, p) => s + p.cashSales, 0);
    const totalCard = sessions.reduce((s, p) => s + p.cardSales, 0);
    const totalUpi = sessions.reduce((s, p) => s + p.upiSales, 0);
    const totalFinance = sessions.reduce((s, p) => s + p.financeSales, 0);
    const totalCredit = sessions.reduce((s, p) => s + p.creditSales, 0);
    const grandTotal = sessions.reduce((s, p) => s + p.totalSales, 0);

    const settlement = await prisma.$transaction(async (tx) => {
      const s = await tx.dailySettlement.create({
        data: {
          date: settlementDate,
          totalCash,
          totalCard,
          totalUpi,
          totalFinance,
          totalCredit,
          grandTotal,
          unmatchedAmount: grandTotal,
        },
      });

      // Link sessions to settlement
      await tx.posSession.updateMany({
        where: { id: { in: sessions.map((p) => p.id) } },
        data: { settlementId: s.id },
      });

      return s;
    });

    return successResponse(settlement);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "pos:settlement", step: "create" });
  }
}

// DELETE — Delete a settlement and its linked sessions (admin only)
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireFeature("pos", "delete");
    const body = await req.json();
    const { id, deleteType, sessionId } = body as { id?: string; deleteType?: "settlement" | "session"; sessionId?: string };

    // Delete a single POS session
    if (deleteType === "session" && sessionId) {
      const session = await prisma.posSession.findUnique({ where: { id: sessionId } });
      if (!session) return errorResponse("Session not found", 404);

      await prisma.posSession.delete({ where: { id: sessionId } });
      return successResponse({ deleted: "session" });
    }

    // Delete a settlement
    if (!id) return errorResponse("Settlement ID required", 400);

    const settlement = await prisma.dailySettlement.findUnique({
      where: { id },
      include: { matches: true, sessions: true },
    });
    if (!settlement) return errorResponse("Settlement not found", 404);

    const day = settlement.date.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
    const released = await prisma.$transaction(async (tx) => {
      // Release the matched bank lines (plan 1210 bank, D5): each goes back to review — or, if
      // it came out of suspense, back into suspense with its case reopened. Once per line: two
      // matches on one line (old double use, L13) must not release it twice, which would move a
      // line just returned to suspense on to review and leave its case open behind it.
      const txnIds = [...new Set(settlement.matches.map((m) => m.bankTxnId).filter((t): t is string => !!t))];
      const to = { suspense: 0, review: 0 };
      for (const txnId of txnIds) {
        to[await releaseLine(tx, txnId, user.id, `settlement ${day} deleted`)]++;
      }

      // Delete matches
      await tx.settlementMatch.deleteMany({ where: { settlementId: id } });

      // Unlink sessions (don't delete them — they can be re-used)
      await tx.posSession.updateMany({
        where: { settlementId: id },
        data: { settlementId: null },
      });

      // Delete settlement
      await tx.dailySettlement.delete({ where: { id } });
      return to;
    });

    log.info("settlement deleted", { settlementId: id, linesToReview: released.review, linesToSuspense: released.suspense });
    return successResponse({ deleted: "settlement" });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "pos:settlement", step: "delete" });
  }
}
