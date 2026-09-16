export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import {
  floorWarehouseForInvoice,
  listFloorWarehousesWithPrefix,
} from "@/lib/deliveries/zoho-invoice";
import { TERMINAL_STATUSES } from "@/lib/deliveries/floor-stock";
import { createLogger } from "@/lib/logger";

const log = createLogger("deliveries:floor-warehouse");

/**
 * "Match warehouses" (A43, A43b). Links every open Dummy delivery — not DELIVERED / WALK_OUT,
 * `warehouseId` null — to the FLOOR warehouse its invoice prefix names, and derives `storeId`
 * from that warehouse (T3). Re-runnable: it only ever fills a null `warehouseId`, never
 * overwrites one, so running it after the owner types a new prefix picks up just the new matches.
 *
 * Batched: one read of the floors, one read of the candidates, then ONE `updateMany` per
 * matched warehouse (a handful), not one per delivery.
 */
export async function POST() {
  try {
    await requireFeature("deliveries", "edit");

    const floors = await listFloorWarehousesWithPrefix(prisma);
    const candidates = await prisma.delivery.findMany({
      where: { warehouseId: null, status: { notIn: [...TERMINAL_STATUSES] } },
      select: { id: true, invoiceNo: true },
    });

    // warehouseId → { storeId, deliveryIds }
    const groups = new Map<string, { storeId: string; ids: string[] }>();
    for (const d of candidates) {
      const hit = floorWarehouseForInvoice(d.invoiceNo, floors);
      if (!hit) continue;
      const group = groups.get(hit.warehouseId);
      if (group) group.ids.push(d.id);
      else groups.set(hit.warehouseId, { storeId: hit.storeId, ids: [d.id] });
    }

    let matched = 0;
    if (groups.size > 0) {
      const results = await prisma.$transaction(
        [...groups.entries()].map(([warehouseId, g]) =>
          prisma.delivery.updateMany({
            // `warehouseId: null` in the WHERE is the never-overwrite guarantee, even if another
            // request linked one of these rows between the read above and this write.
            where: { id: { in: g.ids }, warehouseId: null },
            data: { warehouseId, storeId: g.storeId },
          })
        )
      );
      matched = results.reduce((sum, r) => sum + r.count, 0);
    }

    const checked = candidates.length;
    const stillDummy = checked - matched;

    if (floors.length === 0 && checked > 0) {
      log.warn("match warehouses: no active floor warehouse carries an invoice prefix", { checked });
    }
    log.info("match warehouses finished", {
      checked,
      matched,
      stillDummy,
      floors: floors.length,
      warehousesMatched: groups.size,
    });

    return successResponse({ checked, matched, stillDummy });
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("match warehouses refused", { status: error.status });
      return errorResponse(error.message, error.status);
    }
    log.error("match warehouses failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to match warehouses", 500);
  }
}
