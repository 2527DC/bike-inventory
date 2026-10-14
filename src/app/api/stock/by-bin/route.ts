export const revalidate = 60; // cache 1 minute

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { listWarehouses } from "@/lib/warehouses";
import { LIVE_UNIT_STATUSES } from "@/lib/units/constants";

const log = createLogger("stock:by-bin");

/** At most this many "without codes" lines per warehouse are sent; the totals count them all. */
const UNCODED_LINES_PER_WAREHOUSE = 100;

const LIVE = LIVE_UNIT_STATUSES as string[];

/** One product in one bin whose bin quantity is more than the live units of it in that bin. */
interface UncodedLine {
  productId: string;
  productName: string;
  sku: string;
  binId: string;
  binCode: string;
  binQty: number;
  liveUnits: number;
  withoutCodes: number;
}

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

      // ── Stock without unit codes, per product per bin (plan 1410-stock-quick-add, Q2) ──
      // A product with no unit codes keeps the bin quantity that was typed in (or quick-added),
      // because syncBinStock never recounts an untracked product (src/lib/units/bin-stock.ts).
      // Whatever a bin holds beyond the live units of that product in it has no code. Only
      // those lines are returned — the largest first, capped per warehouse — with each
      // warehouse's full totals beside them, so the screen can say how many it is not listing.
      const uncoded = await prisma.$queryRaw<Array<{
        warehouse_id: string; product_id: string; product_name: string; sku: string;
        bin_id: string; bin_code: string; bin_qty: number; live_units: number; without_codes: number;
        wh_lines: number; wh_units: number;
      }>>`
        SELECT warehouse_id, product_id, product_name, sku, bin_id, bin_code, bin_qty, live_units,
               without_codes, wh_lines, wh_units
        FROM (
          SELECT b.warehouse_id,
                 bs.product_id,
                 p.name AS product_name,
                 p.sku,
                 bs.bin_id,
                 b.code AS bin_code,
                 bs.quantity::int AS bin_qty,
                 COALESCE(l.n, 0)::int AS live_units,
                 (bs.quantity - COALESCE(l.n, 0))::int AS without_codes,
                 ROW_NUMBER() OVER (
                   PARTITION BY b.warehouse_id
                   ORDER BY bs.quantity - COALESCE(l.n, 0) DESC, p.name
                 ) AS rn,
                 COUNT(*) OVER (PARTITION BY b.warehouse_id)::int AS wh_lines,
                 SUM(bs.quantity - COALESCE(l.n, 0)) OVER (PARTITION BY b.warehouse_id)::int AS wh_units
          FROM bin_stocks bs
          JOIN bins b ON b.id = bs.bin_id
          JOIN "Product" p ON p.id = bs.product_id
          LEFT JOIN (
            SELECT u.bin_id, u.product_id, COUNT(*)::int AS n
            FROM inventory_units u
            WHERE u.bin_id IS NOT NULL AND u.status::text = ANY(${LIVE})
            GROUP BY u.bin_id, u.product_id
          ) l ON l.bin_id = bs.bin_id AND l.product_id = bs.product_id
          WHERE p.status = 'ACTIVE' AND bs.quantity > COALESCE(l.n, 0)
        ) x
        WHERE rn <= ${UNCODED_LINES_PER_WAREHOUSE}
        ORDER BY warehouse_id, rn
      `;
      const uncodedByWarehouse = new Map<string, { units: number; lines: number; top: UncodedLine[] }>();
      for (const r of uncoded) {
        let entry = uncodedByWarehouse.get(r.warehouse_id);
        if (!entry) {
          entry = { units: r.wh_units, lines: r.wh_lines, top: [] };
          uncodedByWarehouse.set(r.warehouse_id, entry);
        }
        entry.top.push({
          productId: r.product_id,
          productName: r.product_name,
          sku: r.sku,
          binId: r.bin_id,
          binCode: r.bin_code,
          binQty: r.bin_qty,
          liveUnits: r.live_units,
          withoutCodes: r.without_codes,
        });
      }

      // Driven by the warehouse TABLE, not a constant, so a warehouse with no stock still
      // appears (at zero) and a newly created one needs no code change to show up.
      const warehouses = await listWarehouses();
      const locations = warehouses.map((w) => {
        const r = byWarehouse.get(w.id);
        const u = uncodedByWarehouse.get(w.id);
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
          // Units in this warehouse's bins that carry no unit code, over how many product-bin
          // lines, and the largest of those lines (at most UNCODED_LINES_PER_WAREHOUSE).
          withoutCodes: u?.units ?? 0,
          withoutCodesLines: u?.lines ?? 0,
          withoutCodesTop: u?.top ?? [],
        };
      });

      log.debug("stock by warehouse", {
        warehouses: locations.length,
        uncodedLinesSent: uncoded.length,
        warehousesWithUncoded: uncodedByWarehouse.size,
      });
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
