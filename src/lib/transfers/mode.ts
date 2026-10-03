import type { TransferDocType, TransferMode, WarehouseKind } from "@prisma/client";

/**
 * A transfer's direction and its document — plan 0310-bin-delete-multi-category-rules-and-
 * transfer-directions, Part D (R7, Q6, Q7).
 *
 * ─── THE DIRECTION IS THE TWO KINDS ─────────────────────────────────────────────────────────
 *
 * The form offers four directions, Floor → Godown, Godown → Floor, Floor → Floor and
 * Godown → Godown, between any two stores or inside one. The mode is therefore a function of
 * the kind of warehouse at each end, and the create route REFUSES a mode that disagrees with the
 * warehouses it names rather than trusting the button.
 *
 * ─── THE DOCUMENT IS THE TWO STORES ─────────────────────────────────────────────────────────
 *
 * Owner, 3 Oct 2026 (Q7): between two different stores a TAX INVOICE travels (separate GSTINs —
 * the movement is a supply, raised in Zoho Books); inside one store a DELIVERY CHALLAN does. This
 * replaces `docTypeForMode` (Store → Store = invoice, anything else = challan), which stopped
 * meaning anything once a Floor → Floor move could be either. The stores' GSTINs are still never
 * read (owner, 9 Sep 2026); only whether the two warehouses belong to the same store.
 *
 * Find stock (`api/deliveries/[id]/find-stock`) already derived its document this way, so both
 * creators now share these two functions.
 *
 * `resolveStoreWarehouse` (a picked STORE resolved to its floor) was deleted with the store-based
 * form: both sides of a transfer now name a warehouse.
 */

const MODE_BY_KINDS: Record<WarehouseKind, Record<WarehouseKind, TransferMode>> = {
  FLOOR: { FLOOR: "FLOOR_TO_FLOOR", GODOWN: "FLOOR_TO_GODOWN" },
  GODOWN: { FLOOR: "GODOWN_TO_FLOOR", GODOWN: "GODOWN_TO_GODOWN" },
};

/** The four directions the form offers, in its order. */
export const DIRECTION_MODES = ["FLOOR_TO_GODOWN", "GODOWN_TO_FLOOR", "FLOOR_TO_FLOOR", "GODOWN_TO_GODOWN"] as const;
export type DirectionMode = (typeof DIRECTION_MODES)[number];

/**
 * How a direction reads on screen and in refusals. A FLOOR warehouse is called a **Hub** on the
 * transfer screens (owner, 3 Oct 2026, plan 0310 R9) — wording only; the enum keeps FLOOR.
 */
export const DIRECTION_LABEL: Record<DirectionMode, string> = {
  FLOOR_TO_GODOWN: "Hub → Godown",
  GODOWN_TO_FLOOR: "Godown → Hub",
  FLOOR_TO_FLOOR: "Hub → Hub",
  GODOWN_TO_GODOWN: "Godown → Godown",
};

export function modeForKinds(fromKind: WarehouseKind, toKind: WarehouseKind): DirectionMode {
  return MODE_BY_KINDS[fromKind][toKind] as DirectionMode;
}

/** The kind each end of a direction must be — what the create route checks the warehouses against. */
export function kindsForMode(mode: DirectionMode): { from: WarehouseKind; to: WarehouseKind } {
  const [from, , to] = mode.split("_") as [WarehouseKind, string, WarehouseKind];
  return { from, to };
}

export function docTypeForLane(from: { storeId: string }, to: { storeId: string }): TransferDocType {
  return from.storeId === to.storeId ? "DELIVERY_CHALLAN" : "TAX_INVOICE";
}
