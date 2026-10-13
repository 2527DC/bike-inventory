// Which store a payable belongs to — the one rule, shared by the Zoho pull, the payment route
// and (later) plan D's bank-confirmed payments. Plan 1210 credit notes and payables, Part 2.2.
//
// Production has ONE Store row today (BCH1); Bharath Cycle Centre is not in the app. Nothing
// here assumes a store code — a store is found by the Zoho location linked to it on /stores,
// or picked by a person. A bill whose location is not linked stays "Store not set" (null).
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import type { Db } from "@/lib/sequence";
import type { ZohoLocation } from "@/lib/integrations/books";

const log = createLogger("payables:store");

/**
 * The store linked to a Zoho location_id, or null.
 *
 * Zoho Locations nest: a bill can carry a warehouse sub-location ("BHARATH CYCLE HUB
 * (Warehouse)") whose parent is the store's location. Pass the organisation's location list
 * (one `BooksClient.listLocations()` per run) and an unlinked child resolves through its parent.
 */
export async function storeIdForLocation(
  zohoLocationId: string | null | undefined,
  locations?: ZohoLocation[],
  db: Db = prisma,
): Promise<string | null> {
  if (!zohoLocationId) return null;
  const direct = await db.store.findUnique({ where: { zohoLocationId }, select: { id: true } });
  if (direct) return direct.id;
  const parentId = locations?.find((l) => l.location_id === zohoLocationId)?.parent_location_id;
  if (!parentId) return null;
  const parent = await db.store.findUnique({ where: { zohoLocationId: parentId }, select: { id: true } });
  return parent?.id ?? null;
}

export class StoreRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreRuleError";
  }
}

/**
 * The store of a vendor payment (Q9): the store of the bills it pays — they must all share one —
 * or, for an advance with no bill, the store picked by hand. Throws StoreRuleError with a
 * sentence the screen can show; the route answers it as a 400.
 */
export async function storeIdForPayment(
  { billIds, explicitStoreId }: { billIds: string[]; explicitStoreId?: string | null },
  db: Db = prisma,
): Promise<string | null> {
  if (billIds.length === 0) {
    if (!explicitStoreId) throw new StoreRuleError("Pick the store this advance is paid from.");
    return explicitStoreId;
  }
  const bills = await db.vendorBill.findMany({
    where: { id: { in: billIds } },
    select: { id: true, billNo: true, storeId: true, store: { select: { name: true } } },
  });
  const stores = new Set(bills.map((b) => b.storeId).filter((x): x is string => !!x));
  if (stores.size > 1) {
    log.warn("payment spans two stores", { billIds, stores: [...stores] });
    throw new StoreRuleError("One payment pays one store's bills. Pay each store's bills separately.");
  }
  const fromBills = stores.size === 1 ? [...stores][0] : null;
  if (fromBills && explicitStoreId && explicitStoreId !== fromBills) {
    throw new StoreRuleError("The bills you ticked belong to a different store from the one picked.");
  }
  // Bills with no store yet: fall back to the picked store, else leave it unset.
  return fromBills ?? explicitStoreId ?? null;
}
