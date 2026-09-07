import type { TransferDocType, TransferType } from "@prisma/client";
import type { WarehouseRef } from "@/lib/warehouses";

/**
 * Which document does this movement need, and why.
 *
 * ─── DERIVED, NEVER CHOSEN ────────────────────────────────────────────────────────────────
 *
 * Nobody picks "tax invoice" or "delivery challan" on a form. The lane decides it, because the
 * lane is what the law looks at:
 *
 *   Two warehouses under ONE store  -> one GST registration -> not a supply -> DELIVERY CHALLAN
 *                                      (Rule 55(1)(c) covers movement that is not a supply)
 *   Two DIFFERENT GSTINs            -> distinct persons (CGST s.25) -> the movement IS a supply
 *                                      even with no money changing hands (Schedule I para 2)
 *                                      -> TAX INVOICE (s.31, Rule 46)
 *   Two stores that happen to share
 *   one GSTIN                       -> one registration again -> DELIVERY CHALLAN
 *
 * That third case is why this keys off the GSTIN and not merely off `storeId`. Two stores on
 * one registration are one person to the tax system, whatever the org chart says.
 *
 * ─── A MISSING GSTIN REFUSES. IT DOES NOT DEFAULT ─────────────────────────────────────────
 *
 * Every store has its own GSTIN (owner, O1). So an inter-store move with a blank GSTIN is not
 * "probably intra-state, use a challan" — it is missing master data, and quietly issuing a
 * delivery challan for what is legally a supply is precisely the compliance hole this phase
 * exists to close. The refusal names the store and the screen, so it is fixable in one hop.
 *
 * The stored result is a SNAPSHOT. Editing a store's GSTIN next year must not retroactively
 * change what document a transfer needed in 2026 — hence `transferType` and `requiredDocType`
 * are columns, not a computed property.
 */
export interface TransferPolicy {
  transferType: TransferType;
  requiredDocType: TransferDocType;
}

/** The store fields the derivation needs. `listWarehouses()` already selects them. */
type LaneWarehouse = Pick<WarehouseRef, "id" | "name" | "storeId" | "store">;

export type PolicyResult = { policy: TransferPolicy } | { error: string };

export function deriveTransferPolicy(from: LaneWarehouse, to: LaneWarehouse): PolicyResult {
  if (from.storeId === to.storeId) {
    // Same store, therefore one registration whatever the GSTIN column says. No GSTIN is
    // needed to answer this, so a store with a blank GSTIN can still move stock between its
    // own floor and its own godown — which is the everyday case and must not be blocked by
    // master data that only matters for inter-store movement.
    return { policy: { transferType: "INTRA_STORE", requiredDocType: "DELIVERY_CHALLAN" } };
  }

  const fromGstin = from.store.gstin?.trim() || null;
  const toGstin = to.store.gstin?.trim() || null;

  // Written as two guards rather than collecting into a list, so the compiler can see that
  // both are non-null below. A `missing.length > 0` check reads better but narrows nothing.
  if (!fromGstin && !toGstin) {
    return {
      error: `Set the GSTIN for ${from.name} and ${to.name} on /stores before transferring between stores.`,
    };
  }
  if (!fromGstin) {
    return { error: `Set the GSTIN for ${from.name} on /stores before transferring between stores.` };
  }
  if (!toGstin) {
    return { error: `Set the GSTIN for ${to.name} on /stores before transferring between stores.` };
  }

  return {
    policy: {
      transferType: "INTER_STORE",
      // Case-insensitive: a GSTIN is uppercase alphanumeric, and comparing raw strings would
      // read "29aaa..." and "29AAA..." as two registrations and demand a tax invoice for a
      // movement inside one.
      requiredDocType:
        fromGstin.toUpperCase() === toGstin.toUpperCase() ? "DELIVERY_CHALLAN" : "TAX_INVOICE",
    },
  };
}

/** The document's name as a person would say it. Used in refusals and on screen. */
export function docTypeLabel(doc: TransferDocType): string {
  return doc === "TAX_INVOICE" ? "tax invoice" : "delivery challan";
}

/**
 * The e-way bill threshold, in rupees.
 *
 * Applies to MOVEMENT, not to supply — so it catches a delivery challan too, which is the part
 * that surprises people. A ₹60,000 shift from the floor to the godown across town needs an
 * e-way bill even though no sale happened and no tax invoice exists.
 *
 * Dispatch WARNS rather than refuses: the bill is raised on the government portal, not here,
 * and blocking the van because a number has not been typed back into this app would stop real
 * work over a record-keeping gap.
 */
export const EWAY_BILL_THRESHOLD = 50_000;
