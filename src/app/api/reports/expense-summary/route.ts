export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("reports", "view");
    const { searchParams } = new URL(req.url);

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dateFrom = searchParams.get("dateFrom") ? new Date(searchParams.get("dateFrom")!) : thirtyDaysAgo;
    const dateTo = searchParams.get("dateTo") ? new Date(searchParams.get("dateTo")!) : now;

    const where = { date: { gte: dateFrom, lte: dateTo } };

    const grouped = await prisma.expense.groupBy({
      by: ["category"],
      where,
      _sum: { amount: true },
      _count: true,
    });

    const total = grouped.reduce((sum, g) => sum + (g._sum.amount || 0), 0);
    const daysDiff = Math.max(1, Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24)));
    const dailyAvg = total / daysDiff;

    const categories = grouped
      .map((g) => ({
        category: g.category,
        amount: g._sum.amount || 0,
        count: g._count,
        percentage: total > 0 ? Math.round(((g._sum.amount || 0) / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    return successResponse({
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      total,
      dailyAvg: Math.round(dailyAvg),
      totalCount: grouped.reduce((sum, g) => sum + g._count, 0),
      categories,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch expense summary", 500);
  }
}
