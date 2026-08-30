export const revalidate = 60; // cache 1 minute

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { BIN_TRACKING_ENABLED } from "@/lib/inventory-config";
import { listWarehouses } from "@/lib/warehouses";

export async function GET() {
  try {
    await requireFeature("stock", "view");

    // ── Location mode (bins dormant): per-location summary across the 4 locations ──
    if (!BIN_TRACKING_ENABLED) {
      const rows = await prisma.$queryRaw<Array<{ warehouse_id: string; total_stock: number; total_value: number; product_count: number }>>`
        SELECT
          sl."warehouseId" as warehouse_id,
          COALESCE(SUM(sl.quantity), 0)::int as total_stock,
          COALESCE(SUM(sl.quantity * p."sellingPrice"), 0)::float as total_value,
          COUNT(*) FILTER (WHERE sl.quantity > 0)::int as product_count
        FROM "StockLevel" sl
        JOIN "Product" p ON p.id = sl."productId"
        WHERE p.status = 'ACTIVE'
        GROUP BY sl."warehouseId"
      `;
      const byWarehouse = new Map(rows.map((r) => [r.warehouse_id, r]));

      // Driven by the warehouse TABLE, not a constant, so a warehouse with no stock still
      // appears (at zero) and a newly created one needs no code change to show up.
      const warehouses = await listWarehouses();
      const locations = warehouses.map((w) => {
        const r = byWarehouse.get(w.id);
        return {
          key: w.code,
          id: w.id,
          label: w.name,
          storeId: w.storeId,
          totalStock: r?.total_stock ?? 0,
          totalValue: r?.total_value ?? 0,
          productCount: r?.product_count ?? 0,
          lowStockCount: 0,
          outOfStockCount: 0,
        };
      });

      return successResponse({ mode: "location", locations });
    }

    // ── Bin mode (dormant) ──
    const [bins, binStats] = await Promise.all([
      prisma.bin.findMany({
        where: { isActive: true },
        orderBy: { code: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          location: true,
          zone: true,
          _count: { select: { products: { where: { status: "ACTIVE" } } } },
        },
      }),
      prisma.$queryRaw<Array<{
        binId: string;
        total_stock: number;
        low_stock: number;
        out_of_stock: number;
        total_value: number;
      }>>`
        SELECT
          "binId",
          COALESCE(SUM("currentStock"), 0)::int as total_stock,
          COUNT(*) FILTER (WHERE "reorderLevel" > 0 AND "currentStock" <= "reorderLevel")::int as low_stock,
          COUNT(*) FILTER (WHERE "currentStock" <= 0)::int as out_of_stock,
          COALESCE(SUM("currentStock" * "sellingPrice"), 0)::float as total_value
        FROM "Product"
        WHERE status = 'ACTIVE' AND "binId" IS NOT NULL
        GROUP BY "binId"
      `,
    ]);

    const statsMap = new Map(binStats.map((s) => [s.binId, s]));

    const data = bins.map((b) => {
      const stats = statsMap.get(b.id);
      return {
        id: b.id,
        code: b.code,
        name: b.name,
        location: b.location,
        zone: b.zone,
        productCount: b._count.products,
        totalStock: stats?.total_stock || 0,
        lowStockCount: stats?.low_stock || 0,
        outOfStockCount: stats?.out_of_stock || 0,
        totalValue: stats?.total_value || 0,
      };
    });

    return successResponse({ mode: "bin", bins: data });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch stock by location",
      500
    );
  }
}
