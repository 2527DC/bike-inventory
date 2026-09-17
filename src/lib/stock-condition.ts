import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { LIVE_UNIT_STATUSES } from "@/lib/units/constants";

const log = createLogger("stock:condition");

// ─── Assembled / unassembled / no assembly ───────────────────────────────────
// Plan 1709-priority-build-and-stock-flow, R10, R11, P7. Counts are read from the UNITS, not
// from `StockLevel`: a unit is the physical item and carries its condition. One definition,
// shared by /api/products (per product) and /api/stock/condition (per product per warehouse),
// so the two screens can never disagree about a number.
//
//   no assembly  — `nonAssemblable` stamped (R42, P6). Wins over the other two: an item that
//                  needs no build is neither "assembled" nor "waiting to be assembled".
//   assembled    — not non-assemblable, `assembledAt` set (what Part B's sync re-marks).
//   unassembled  — not non-assemblable, `assembledAt` null.
//
// Only LIVE units count: not SOLD / LOST / RESET (gone) and not TRANSFERRED (in a van).

export interface ConditionCounts {
  assembled: number;
  unassembled: number;
  noAssembly: number;
}

export const ZERO_CONDITION: ConditionCounts = { assembled: 0, unassembled: 0, noAssembly: 0 };

const LIVE = LIVE_UNIT_STATUSES as string[];

/**
 * Per-product condition counts for ONE page of products — a single grouped query keyed by the
 * page's ids, so the list costs one extra round trip however many rows it shows.
 *
 * `storeId` scopes the count to that store's active warehouses, matching the store-scoped
 * `currentStock` the list shows beside it.
 */
export async function conditionByProduct(
  productIds: string[],
  opts: { storeId?: string } = {}
): Promise<Map<string, ConditionCounts>> {
  const out = new Map<string, ConditionCounts>();
  if (productIds.length === 0) return out;

  const started = Date.now();
  const storeJoin = opts.storeId
    ? Prisma.sql`JOIN "Warehouse" w ON w.id = u.warehouse_id AND w."isActive" AND w."storeId" = ${opts.storeId}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{ product_id: string; assembled: number; unassembled: number; no_assembly: number }>
  >`
    SELECT u.product_id,
           COUNT(*) FILTER (WHERE NOT u.non_assemblable AND u.assembled_at IS NOT NULL)::int AS assembled,
           COUNT(*) FILTER (WHERE NOT u.non_assemblable AND u.assembled_at IS NULL)::int     AS unassembled,
           COUNT(*) FILTER (WHERE u.non_assemblable)::int                                    AS no_assembly
    FROM inventory_units u
    ${storeJoin}
    WHERE u.product_id = ANY(${productIds})
      AND u.status::text = ANY(${LIVE})
    GROUP BY u.product_id
  `;

  for (const r of rows) {
    out.set(r.product_id, {
      assembled: r.assembled,
      unassembled: r.unassembled,
      noAssembly: r.no_assembly,
    });
  }
  log.debug("condition by product", {
    products: productIds.length,
    withUnits: rows.length,
    storeId: opts.storeId,
    ms: Date.now() - started,
  });
  return out;
}

/**
 * The `where` clause for "products that hold at least one live non-assemblable unit" — the
 * No assembly chip on /stock (R42). Scoped to a store's warehouses when `storeId` is given.
 */
export function hasNoAssemblyUnitsWhere(storeId?: string): Prisma.ProductWhereInput {
  return {
    inventoryUnits: {
      some: {
        nonAssemblable: true,
        status: { in: LIVE_UNIT_STATUSES },
        ...(storeId && { warehouse: { storeId, isActive: true } }),
      },
    },
  };
}
