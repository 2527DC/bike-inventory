export const revalidate = 60; // cache brand stock 1 minute

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET() {
  try {
    await requireFeature("stock", "view");

    // Fetch brand summaries using groupBy — no need to load all 2765 products
    const [brands, brandStats, locStats] = await Promise.all([
      prisma.brand.findMany({
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          contactPhone: true,
          whatsappNumber: true,
          _count: { select: { products: { where: { status: "ACTIVE" } } } },
        },
      }),
      // Aggregate stock metrics per brand in a single query
      prisma.$queryRaw<Array<{
        brandId: string;
        total_stock: number;
        low_stock: number;
        out_of_stock: number;
        total_value: number;
      }>>`
        SELECT
          "brandId",
          COALESCE(SUM("currentStock"), 0)::int as total_stock,
          COUNT(*) FILTER (WHERE "reorderLevel" > 0 AND "currentStock" <= "reorderLevel")::int as low_stock,
          COUNT(*) FILTER (WHERE "currentStock" <= 0)::int as out_of_stock,
          COALESCE(SUM("currentStock" * "sellingPrice"), 0)::float as total_value
        FROM "Product"
        WHERE status = 'ACTIVE' AND "brandId" IS NOT NULL
        GROUP BY "brandId"
      `,
      // Per-brand × per-location unit totals (the "where does this brand's stock sit" breakdown)
      prisma.$queryRaw<Array<{ brandId: string; location: string; qty: number }>>`
        SELECT p."brandId", sl.location::text as location, COALESCE(SUM(sl.quantity), 0)::int as qty
        FROM "StockLevel" sl
        JOIN "Product" p ON p.id = sl."productId"
        WHERE p.status = 'ACTIVE' AND p."brandId" IS NOT NULL
        GROUP BY p."brandId", sl.location
      `,
    ]);

    const statsMap = new Map(brandStats.map((s) => [s.brandId, s]));
    const locMap = new Map<string, Record<string, number>>();
    for (const r of locStats) {
      const cur = locMap.get(r.brandId) || {};
      cur[r.location] = r.qty;
      locMap.set(r.brandId, cur);
    }

    const data = brands
      .filter((b) => b._count.products > 0)
      .map((b) => {
        const stats = statsMap.get(b.id);
        return {
          id: b.id,
          name: b.name,
          contactPhone: b.contactPhone,
          whatsappNumber: b.whatsappNumber,
          productCount: b._count.products,
          totalStock: stats?.total_stock || 0,
          lowStockCount: stats?.low_stock || 0,
          outOfStockCount: stats?.out_of_stock || 0,
          totalValue: stats?.total_value || 0,
          byLocation: locMap.get(b.id) || {},
        };
      });

    return successResponse(data);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch brand stock",
      500
    );
  }
}
