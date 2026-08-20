export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET() {
  try {
    await requireFeature("second_hand", "view");

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [inStock, soldThisMonth, allSold, aging7, aging14, aging30] = await Promise.all([
      prisma.secondHandCycle.findMany({
        where: { status: "IN_STOCK" },
        select: { costPrice: true, createdAt: true },
      }),
      prisma.secondHandCycle.findMany({
        where: { status: "SOLD", soldAt: { gte: monthStart } },
        select: { costPrice: true, sellingPrice: true },
      }),
      prisma.secondHandCycle.aggregate({
        where: { status: "SOLD", sellingPrice: { not: null } },
        _avg: { sellingPrice: true, costPrice: true },
        _count: true,
      }),
      prisma.secondHandCycle.count({
        where: {
          status: "IN_STOCK",
          createdAt: { lt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.secondHandCycle.count({
        where: {
          status: "IN_STOCK",
          createdAt: { lt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.secondHandCycle.count({
        where: {
          status: "IN_STOCK",
          createdAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    const totalCostValue = inStock.reduce((s, c) => s + c.costPrice, 0);
    const soldRevenue = soldThisMonth.reduce((s, c) => s + (c.sellingPrice || 0), 0);
    const soldCost = soldThisMonth.reduce((s, c) => s + c.costPrice, 0);
    const avgMargin = allSold._count > 0
      ? ((allSold._avg.sellingPrice || 0) - (allSold._avg.costPrice || 0))
      : 0;

    return successResponse({
      inStock: { count: inStock.length, totalCostValue },
      soldThisMonth: { count: soldThisMonth.length, revenue: soldRevenue, profit: soldRevenue - soldCost },
      avgMargin: Math.round(avgMargin),
      totalSold: allSold._count,
      aging: { over7: aging7, over14: aging14, over30: aging30 },
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}
