export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { calcSalesVelocity, calcPriorityScore, classifyPriority, calcDaysUntilStockout } from "@/lib/ai-calculations";

export async function GET() {
  try {
    await requireFeature("reorder", "view");

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // Fetch all active products and filter in JS (Prisma doesn't support self-referencing field comparisons)
    const [allProducts, salesData] = await Promise.all([
      prisma.product.findMany({
        where: { status: "ACTIVE" },
        select: {
          id: true, sku: true, name: true, type: true,
          currentStock: true, minStock: true, reorderLevel: true,
          costPrice: true,
          category: { select: { name: true } },
          brand: { select: { name: true } },
        },
      }),
      prisma.inventoryTransaction.groupBy({
        by: ["productId"],
        where: { type: "OUTWARD", createdAt: { gte: ninetyDaysAgo } },
        _sum: { quantity: true },
      }),
    ]);

    const lowStockProducts = allProducts.filter((p) => p.currentStock <= p.minStock || p.currentStock <= p.reorderLevel);
    const salesMap = new Map(salesData.map((s) => [s.productId, s._sum.quantity || 0]));

    const alerts = lowStockProducts
      .map((p) => {
        const threshold = Math.max(p.minStock, p.reorderLevel);
        const deficit = Math.max(0, threshold - p.currentStock);
        const totalSold90 = salesMap.get(p.id) || 0;
        const salesVelocity = calcSalesVelocity(totalSold90, 90);
        const priorityScore = calcPriorityScore(deficit, salesVelocity);
        const priority = classifyPriority(priorityScore);
        const daysUntilStockout = calcDaysUntilStockout(p.currentStock, salesVelocity);

        return {
          product: { id: p.id, sku: p.sku, name: p.name, type: p.type, category: p.category?.name, brand: p.brand?.name },
          currentStock: p.currentStock,
          minStock: p.minStock,
          reorderLevel: p.reorderLevel,
          deficit,
          salesVelocity: Math.round(salesVelocity * 100) / 100,
          daysUntilStockout,
          priorityScore,
          priority,
          lostSalesValue: deficit * p.costPrice,
        };
      })
      .sort((a, b) => b.priorityScore - a.priorityScore);

    return successResponse(alerts);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to generate alerts", 500);
  }
}
