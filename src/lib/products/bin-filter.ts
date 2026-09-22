import type { Prisma } from "@prisma/client";
import { LIVE_UNIT_STATUSES } from "@/lib/units/constants";

/**
 * "Where a product is" for the /stock list (plan 2209-audit-assigns-product-bin, R2, Q2a).
 *
 * `Product.binId` is one home bin, written by inbound and (since this plan) by an approved bin
 * audit. The stock itself lives in `InventoryUnit.binId` and `BinStock`, and moves between bins
 * without touching the home bin. So "in bin X" is any of the three:
 *   - the home bin is X
 *   - a live unit sits in X
 *   - X's BinStock row for the product is above zero
 *
 * Returned as ONE where-object carrying an `OR`, meant to be pushed onto the route's `AND` list —
 * never spread at the top level, where it would collide with another `OR` (search) and one of
 * them would silently vanish.
 */
export function productInBinWhere(binId: string): Prisma.ProductWhereInput {
  return {
    OR: [
      { binId },
      { inventoryUnits: { some: { binId, status: { in: LIVE_UNIT_STATUSES } } } },
      { binStocks: { some: { binId, quantity: { gt: 0 } } } },
    ],
  };
}

/**
 * "Has no bin" for the "Needs details" filter (R3): no home bin, no live unit sitting in any bin,
 * and no bin quantity above zero anywhere. A product a bin audit put on a shelf is therefore no
 * longer flagged, even before its home bin is filled.
 */
export function productHasNoBinWhere(): Prisma.ProductWhereInput {
  return {
    binId: null,
    inventoryUnits: { none: { binId: { not: null }, status: { in: LIVE_UNIT_STATUSES } } },
    binStocks: { none: { quantity: { gt: 0 } } },
  };
}
