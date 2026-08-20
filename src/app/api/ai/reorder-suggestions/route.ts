export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { calcSalesVelocity, calcReorderPoint, calcDaysUntilStockout } from "@/lib/ai-calculations";

export async function GET() {
  try {
    await requireFeature("reorder", "view");

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // Get outward sales grouped by product for last 90 days
    const salesData = await prisma.inventoryTransaction.groupBy({
      by: ["productId"],
      where: { type: "OUTWARD", createdAt: { gte: ninetyDaysAgo } },
      _sum: { quantity: true },
    });

    const salesMap = new Map(salesData.map((s) => [s.productId, s._sum.quantity || 0]));

    // Get all active products with vendor info via purchase orders
    const products = await prisma.product.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true, sku: true, name: true, type: true,
        currentStock: true, minStock: true, reorderLevel: true, reorderQty: true,
        costPrice: true,
        category: { select: { name: true } },
        brand: { select: { name: true } },
        purchaseOrderItems: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: { purchaseOrder: { select: { vendor: { select: { name: true, paymentTermDays: true } } } } },
        },
      },
    });

    const suggestions = products
      .map((p) => {
        const totalSold90 = salesMap.get(p.id) || 0;
        const avgDailySales = calcSalesVelocity(totalSold90, 90);
        const vendorInfo = p.purchaseOrderItems[0]?.purchaseOrder?.vendor;
        const leadTimeDays = vendorInfo?.paymentTermDays || 7;
        const reorderPoint = calcReorderPoint(avgDailySales, leadTimeDays);
        const daysUntilStockout = calcDaysUntilStockout(p.currentStock, avgDailySales);
        const suggestedQty = Math.max(1, p.reorderQty, Math.ceil(avgDailySales * 30));

        return {
          product: { id: p.id, sku: p.sku, name: p.name, type: p.type, category: p.category?.name, brand: p.brand?.name },
          currentStock: p.currentStock,
          avgDailySales: Math.round(avgDailySales * 100) / 100,
          reorderPoint,
          daysUntilStockout,
          suggestedQty,
          vendorName: vendorInfo?.name || null,
          stockValue: p.currentStock * p.costPrice,
        };
      })
      .filter((s) => s.currentStock <= s.reorderPoint)
      .sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);

    return successResponse(suggestions);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to generate suggestions", 500);
  }
}
