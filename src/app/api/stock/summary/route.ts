export const revalidate = 120; // cache stock summary 2 minutes

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET() {
  try {
    await requireFeature("stock", "view");
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalProducts,
      todayInwards,
      todayOutwards,
      stockAgg,
      categoryBreakdownRaw,
      lowStockProducts,
    ] = await Promise.all([
      prisma.product.count({ where: { status: "ACTIVE" } }),
      prisma.inventoryTransaction.aggregate({
        where: { type: "INWARD", createdAt: { gte: today } },
        _sum: { quantity: true },
        _count: true,
      }),
      prisma.inventoryTransaction.aggregate({
        where: { type: "OUTWARD", createdAt: { gte: today } },
        _sum: { quantity: true },
        _count: true,
      }),
      // Use raw SQL to compute stock value in DB instead of loading 2765 products
      prisma.$queryRaw<[{ value: number }]>`
        SELECT COALESCE(SUM("currentStock" * "costPrice"), 0)::float as value
        FROM "Product" WHERE status = 'ACTIVE'
      `,
      prisma.product.groupBy({
        by: ["categoryId"],
        where: { status: "ACTIVE" },
        _count: true,
      }),
      // Low stock count via raw SQL (compare two fields)
      prisma.$queryRaw<[{ count: number }]>`
        SELECT COUNT(*)::int as count FROM "Product"
        WHERE status = 'ACTIVE' AND "reorderLevel" > 0 AND "currentStock" <= "reorderLevel"
      `,
    ]);

    const totalStockValue = stockAgg[0]?.value || 0;
    const lowStockCount = lowStockProducts[0]?.count || 0;

    const categoryBreakdown: Record<string, number> = {};
    for (const c of categoryBreakdownRaw) {
      categoryBreakdown[c.categoryId] = c._count;
    }

    return successResponse({
      totalProducts,
      totalStockValue,
      lowStockCount,
      todayInwards: {
        count: todayInwards._count,
        quantity: todayInwards._sum.quantity || 0,
      },
      todayOutwards: {
        count: todayOutwards._count,
        quantity: todayOutwards._sum.quantity || 0,
      },
      categoryBreakdown,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch summary",
      500
    );
  }
}
