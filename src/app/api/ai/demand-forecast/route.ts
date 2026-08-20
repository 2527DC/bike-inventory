export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { calcSalesVelocity, classifyDemand, calcTrend } from "@/lib/ai-calculations";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("reorder", "view");

    const url = new URL(req.url);
    const categoryFilter = url.searchParams.get("category");
    const typeFilter = url.searchParams.get("type");

    const now = Date.now();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now - 60 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000);

    // Parallel queries for 30, 60, 90 day sales
    const [sales30, sales60, sales90] = await Promise.all([
      prisma.inventoryTransaction.groupBy({
        by: ["productId"],
        where: { type: "OUTWARD", createdAt: { gte: thirtyDaysAgo } },
        _sum: { quantity: true },
      }),
      prisma.inventoryTransaction.groupBy({
        by: ["productId"],
        where: { type: "OUTWARD", createdAt: { gte: sixtyDaysAgo } },
        _sum: { quantity: true },
      }),
      prisma.inventoryTransaction.groupBy({
        by: ["productId"],
        where: { type: "OUTWARD", createdAt: { gte: ninetyDaysAgo } },
        _sum: { quantity: true },
      }),
    ]);

    const map30 = new Map(sales30.map((s) => [s.productId, s._sum.quantity || 0]));
    const map60 = new Map(sales60.map((s) => [s.productId, s._sum.quantity || 0]));
    const map90 = new Map(sales90.map((s) => [s.productId, s._sum.quantity || 0]));

    const productWhere: Record<string, unknown> = { status: "ACTIVE" as const };
    if (categoryFilter) productWhere.categoryId = categoryFilter;
    if (typeFilter) productWhere.type = typeFilter;

    const products = await prisma.product.findMany({
      where: productWhere,
      select: {
        id: true, sku: true, name: true, type: true, currentStock: true,
        category: { select: { name: true } },
        brand: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    });

    const forecast = products.map((p) => {
      const qty30 = map30.get(p.id) || 0;
      const qty60 = map60.get(p.id) || 0;
      const qty90 = map90.get(p.id) || 0;
      const rate30 = calcSalesVelocity(qty30, 30);
      const rate90 = calcSalesVelocity(qty90, 90);
      const classification = classifyDemand(qty30);
      const trend = calcTrend(rate30, rate90);
      const projectedMonthly = Math.round(rate30 * 30);
      const monthsOfStock = rate30 > 0 ? Math.round((p.currentStock / (rate30 * 30)) * 10) / 10 : 999;

      return {
        product: { id: p.id, sku: p.sku, name: p.name, type: p.type, category: p.category?.name, brand: p.brand?.name },
        currentStock: p.currentStock,
        sales30: qty30,
        sales60: qty60,
        sales90: qty90,
        classification,
        trend,
        projectedMonthlyDemand: projectedMonthly,
        monthsOfStockLeft: monthsOfStock,
      };
    });

    return successResponse(forecast);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to generate forecast", 500);
  }
}
