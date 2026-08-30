import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("site-assignment");

export interface SiteAssignment {
  storeId?: string | null;
  warehouseId?: string | null;
}

/**
 * Validate a user's store/warehouse assignment before it is written.
 *
 * Returns an error MESSAGE when the assignment is not allowed, or `null` when it is.
 *
 * Shared by POST /api/users and PUT /api/users/[id] so the two cannot drift — the update
 * path is the one that gets forgotten, and a warehouse belonging to the wrong store is
 * invisible in every list that renders them separately.
 *
 * **The client-side filter on /team/new is cosmetic. This is the gate.** A hand-rolled
 * request can send any pair, and the pair is what has to hold: `BCH_WAREHOUSE` under
 * `BCC_STORE` is not a warehouse anyone can walk into.
 *
 * `effective` matters on update. PUT sends only the fields that changed, so validating the
 * incoming body alone would let someone change the store while leaving a warehouse that now
 * belongs to a different site. The caller passes what the row will look like AFTER the
 * update, not what arrived in the body.
 */
export async function validateSiteAssignment(effective: SiteAssignment): Promise<string | null> {
  const { storeId, warehouseId } = effective;

  if (!storeId && !warehouseId) return null; // unassigned is always valid

  if (storeId) {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, isActive: true, name: true },
    });
    if (!store) return "Store not found";
    if (!store.isActive) return `${store.name} is deactivated`;
  }

  if (warehouseId) {
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true, isActive: true, name: true, storeId: true, store: { select: { name: true } } },
    });
    if (!warehouse) return "Warehouse not found";
    if (!warehouse.isActive) return `${warehouse.name} is deactivated`;

    // A warehouse without its store is an assignment nobody can act on — "which site does
    // this person work at?" has no answer. Require the pair rather than inferring the store,
    // so the stored row always says both.
    if (!storeId) {
      return `${warehouse.name} belongs to ${warehouse.store.name}. Select that store as well.`;
    }

    if (warehouse.storeId !== storeId) {
      log.warn("rejected cross-store warehouse assignment", {
        warehouseId,
        warehouseStoreId: warehouse.storeId,
        requestedStoreId: storeId,
      });
      return `${warehouse.name} does not belong to the selected store.`;
    }
  }

  return null;
}
