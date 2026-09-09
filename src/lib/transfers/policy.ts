import type { TransferDocType } from "@prisma/client";

/**
 * What remains of the transfer document policy.
 *
 * `deriveTransferPolicy` — the rule that read both stores' GSTINs and refused a store-to-store
 * transfer while either was blank — was deleted on 9 Sep 2026. The document is now decided by
 * the MODE chosen on the form; see `src/lib/transfers/mode.ts` (`docTypeForMode`). The GSTIN
 * is never consulted. What is left here is the wording and the e-way threshold, which the
 * dispatch, document and detail routes still read.
 */

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
