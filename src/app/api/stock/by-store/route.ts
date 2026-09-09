export const revalidate = 60; // cache 1 minute, as /api/stock/by-bin does

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { listStores } from "@/lib/stores";
import { listWarehouses } from "@/lib/warehouses";

const log = createLogger("stock:by-store");

/**
 * Stock per STORE — the sum of every active warehouse the store owns.
 *
 * Plan 0909-stock-store-and-warehouse-scoping, Part B. `/api/stock/by-bin` answers per
 * warehouse; this answers per store, so the two header buttons on /stock ("By Location",
 * "By Store") are the two scopes R1 asked for. The response shape mirrors by-bin's
 * `locations[]` on purpose: one card component renders both without a branch.
 *
 * `COUNT(DISTINCT productId)` is the point — a product held on the floor AND in the godown
 * is one product (Q3). `p.status = 'ACTIVE'` matches by-bin (Q-C, 9 Sep 2026).
 */
export async function GET() {
  try {
    await requireFeature("stock", "view");

    const [storeRows, warehouseRows, stores, warehouses] = await Promise.all([
      prisma.$queryRaw<Array<{ store_id: string; total_stock: number; total_value: number; product_count: number }>>`
        SELECT w."storeId"                                                       AS store_id,
               COALESCE(SUM(sl.quantity), 0)::int                                AS total_stock,
               COALESCE(SUM(sl.quantity * p."sellingPrice"), 0)::float           AS total_value,
               COUNT(DISTINCT sl."productId") FILTER (WHERE sl.quantity > 0)::int AS product_count
        FROM "StockLevel" sl
        JOIN "Warehouse" w ON w.id = sl."warehouseId" AND w."isActive"
        JOIN "Product"   p ON p.id = sl."productId"
        WHERE p.status = 'ACTIVE'
        GROUP BY w."storeId"
      `,
      // The per-warehouse split printed on each store card ("Floor 3 · Godown 5") — the same
      // SQL by-bin runs, so the two screens can never disagree about a warehouse.
      prisma.$queryRaw<Array<{ warehouse_id: string; total_stock: number }>>`
        SELECT sl."warehouseId" AS warehouse_id,
               COALESCE(SUM(sl.quantity), 0)::int AS total_stock
        FROM "StockLevel" sl
        JOIN "Product" p ON p.id = sl."productId"
        WHERE p.status = 'ACTIVE'
        GROUP BY sl."warehouseId"
      `,
      listStores(),
      listWarehouses(),
    ]);

    const byStore = new Map(storeRows.map((r) => [r.store_id, r]));
    const byWarehouse = new Map(warehouseRows.map((r) => [r.warehouse_id, r.total_stock]));

    // Driven by the store TABLE, not by the stock rows, so a store with nothing on hand still
    // appears at zero — the same rule by-bin applies to warehouses.
    const locations = stores.map((s) => {
      const r = byStore.get(s.id);
      return {
        key: s.code,
        id: s.id,
        label: s.name,
        kind: "Store" as const,
        totalStock: r?.total_stock ?? 0,
        totalValue: r?.total_value ?? 0,
        productCount: r?.product_count ?? 0,
        // Zero for the same reason they are zero on by-bin: a per-location low-stock rule
        // does not exist yet (plan §5).
        lowStockCount: 0,
        outOfStockCount: 0,
        warehouses: warehouses
          .filter((w) => w.storeId === s.id)
          .map((w) => ({ code: w.code, name: w.name, kind: w.kind, units: byWarehouse.get(w.id) ?? 0 })),
      };
    });

    log.debug("stock by store loaded", {
      stores: locations.length,
      withStock: locations.filter((l) => l.totalStock > 0).length,
    });

    return successResponse({ locations });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("stock by store failed", { reason: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch stock by store", 500);
  }
}
