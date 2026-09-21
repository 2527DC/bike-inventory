export const revalidate = 60; // cache 1 minute

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { listWarehouses } from "@/lib/warehouses";

const log = createLogger("stock:by-bin");

export async function GET() {
  try {
    await requireFeature("stock", "view");

    // Per-warehouse summary. This used to branch on the bin-tracking switch: with it ON the
    // route returned a legacy per-bin summary (`Product.binId` / `currentStock`) as `{ bins }`,
    // which /stock/by-bin — its only reader — never rendered, so the page showed "No stock
    // data". Bins are always on now (plan 2109, Q27) and the switch is gone; the per-bin view
    // lives on /bins, from units. This route answers per warehouse, always.
    {
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
          // `site` and `kind` are READ by /stock/by-bin and were once never sent. The screen
          // groups by `site`, so every row landed in one group keyed `undefined` — which is
          // React's "each child needs a unique key" warning — the site heading rendered
          // blank, and `kind` being undefined meant the Warehouse icon branch was never
          // taken, so a warehouse drew the Store icon. Nothing type-checked it because the
          // page casts the JSON straight into its own interface.
          //
          // Site is the store code's prefix: "BCH_STORE" -> "BCH", which is what SITE_NAMES
          // on that page is keyed on. `kind` follows `Warehouse.kind` (plan
          // 0909-stock-store-and-warehouse-scoping, D2): a FLOOR row is the shop, and the
          // screen draws it with the Store icon; a GODOWN is storage and draws the Warehouse
          // icon. The page's vocabulary ("Store" / "Warehouse") predates the column and is
          // kept so the card needs no change.
          site: (w.store?.code ?? "").split("_")[0],
          kind: w.kind === "FLOOR" ? ("Store" as const) : ("Warehouse" as const),
          totalStock: r?.total_stock ?? 0,
          totalValue: r?.total_value ?? 0,
          productCount: r?.product_count ?? 0,
          lowStockCount: 0,
          outOfStockCount: 0,
        };
      });

      log.debug("stock by warehouse", { warehouses: locations.length });
      return successResponse({ mode: "location", locations });
    }
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("stock by warehouse failed", { error: error instanceof Error ? error.message : String(error) });
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch stock by location",
      500
    );
  }
}
