import type { TransferDocType, TransferMode } from "@prisma/client";
import { listWarehouses, type WarehouseRef } from "@/lib/warehouses";
import { storeById } from "@/lib/stores";
import { createLogger } from "@/lib/logger";

const log = createLogger("transfers:mode");

/**
 * Which document a transfer travels with — decided by the MODE the person chose, nothing else.
 *
 * ─── CHOSEN, NOT DERIVED ──────────────────────────────────────────────────────────────────
 *
 * The previous rule (`deriveTransferPolicy`, deleted) read both stores' GSTINs and refused the
 * transfer when either was blank. The owner's instruction on 9 Sep 2026 reverses that: the
 * document is a function of the two buttons on /transfers/new and the store's tax registration
 * is never consulted. A store's GSTIN is master data; the paper in the van is not.
 *
 *   STORE_TO_STORE     -> TAX INVOICE      (raised in Zoho Books, uploaded here)
 *   STORE_TO_WAREHOUSE -> DELIVERY CHALLAN
 */
export function docTypeForMode(mode: TransferMode): TransferDocType {
  return mode === "STORE_TO_STORE" ? "TAX_INVOICE" : "DELIVERY_CHALLAN";
}

export type StoreWarehouseResult = { warehouse: WarehouseRef } | { error: string };

/**
 * The warehouse a STORE resolves to when it is picked on the create form.
 *
 * Stock does not live in a `Store`; it lives in a `Warehouse`, and every warehouse belongs to
 * one store. "Store" on the form means that store's shop FLOOR (plan
 * 0909-stock-store-and-warehouse-scoping, D1/D2): the first active `kind = FLOOR` warehouse by
 * `sortOrder`, then `name` — which is the order `listWarehouses()` already returns.
 *
 * A store with no floor row falls back to its first active warehouse of any kind, with a
 * warning, so a store seeded before the floor/godown split still transfers rather than being
 * refused for a row nobody has created yet. A store with NO active warehouse at all is refused
 * with a message naming it — there is nowhere for the stock to leave from or arrive at.
 */
export async function resolveStoreWarehouse(storeId: string): Promise<StoreWarehouseResult> {
  const store = await storeById(storeId);
  if (!store) {
    log.warn("store is not active or does not exist", { storeId });
    return { error: "That store is not an active store." };
  }

  // `listWarehouses()` is ordered by store sortOrder, then warehouse sortOrder, then name, so
  // the first hit within one store is already the right one — no re-sort needed.
  const own = (await listWarehouses()).filter((w) => w.storeId === storeId);
  const floor = own.find((w) => w.kind === "FLOOR");
  if (floor) return { warehouse: floor };

  const first = own[0];
  if (first) {
    log.warn("store has no floor, using first warehouse", { storeId, warehouseId: first.id });
    return { warehouse: first };
  }

  log.warn("store has no active warehouse", { storeId });
  return { error: `${store.name} has no active warehouse, so stock cannot move to or from it. Add one on /stores.` };
}
