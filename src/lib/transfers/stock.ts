import type { Prisma } from "@prisma/client";
import { adjustWarehouseQty } from "@/lib/stock-location";
import { createLogger } from "@/lib/logger";

const log = createLogger("transfers:stock");

type Tx = Prisma.TransactionClient;

/**
 * Take `qty` out of ONE named warehouse, refusing rather than short-deducting.
 *
 * ─── WHY THIS EXISTS INSTEAD OF CALLING adjustWarehouseQty DIRECTLY ───────────────────────
 *
 * `adjustWarehouseQty` CLAMPS AT ZERO AND REPORTS SUCCESS. Deducting 3 from a warehouse
 * holding 1 writes 0 and returns a number as though nothing were wrong; deducting from a
 * warehouse with no row at all *creates* one at 0 and also succeeds. Two units vanish and
 * nothing anywhere says so.
 *
 * The old transfer code did exactly that — `approve/route.ts` and the create route both called
 * it raw, with the availability check read OUTSIDE the transaction. Two people approving
 * overlapping orders both passed the check against the same pre-image, and the second one
 * silently clamped. That is a live TOCTOU hole, and closing it is half the point of P14.
 *
 * `deductFromStore` in `stock-location.ts` already solved this shape for sales — sum first,
 * refuse before any write. The difference here is that a transfer names ONE warehouse and must
 * not cascade to a sibling: the stock is being moved out of a specific building, and quietly
 * taking the shortfall from the shop floor instead would move units nobody agreed to move.
 *
 * ─── CALL IT INSIDE THE TRANSACTION ───────────────────────────────────────────────────────
 *
 * The read and the write are both `tx`, so the row is locked for the rest of the transaction
 * and a concurrent dispatch of the same product waits rather than racing. A check performed
 * before `$transaction` opens proves nothing by the time the write lands.
 *
 * @returns the product's new cached total (the global figure, which genuinely DROPS here).
 * @throws a readable Error naming the product, the warehouse and what was actually available.
 */
export async function moveOutOfWarehouse(
  tx: Tx,
  productId: string,
  warehouseId: string,
  qty: number,
  productLabel: string,
  warehouseLabel: string
): Promise<number> {
  if (qty <= 0) throw new Error(`Cannot move ${qty} of ${productLabel}: quantity must be positive.`);

  const level = await tx.stockLevel.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    select: { quantity: true },
  });
  const available = level?.quantity ?? 0;

  if (available < qty) {
    log.warn("dispatch refused: not enough at source", {
      productId,
      warehouseId,
      available,
      requested: qty,
    });
    throw new Error(
      `Not enough ${productLabel} at ${warehouseLabel}. Available: ${available}, needed: ${qty}.`
    );
  }

  return adjustWarehouseQty(tx, productId, warehouseId, -qty);
}

/**
 * Put `qty` INTO one named warehouse.
 *
 * A thin pass-through today, and deliberately still a named function: receiving has no
 * clamping hazard (adding is never silently truncated), but every movement in this module
 * should read the same way, and a future rule about receiving into an inactive warehouse
 * belongs here rather than sprinkled across three routes.
 *
 * @returns the product's new cached total.
 */
export async function moveIntoWarehouse(
  tx: Tx,
  productId: string,
  warehouseId: string,
  qty: number
): Promise<number> {
  if (qty <= 0) throw new Error("Cannot receive a non-positive quantity.");
  return adjustWarehouseQty(tx, productId, warehouseId, qty);
}

/**
 * The ledger row for one leg of a transfer.
 *
 * ─── previousStock / newStock GENUINELY DIFFER NOW ────────────────────────────────────────
 *
 * Every TRANSFER row written before P14 set `previousStock === newStock`, and that was correct
 * at the time: approval moved the units out of one warehouse and into another in the same
 * breath, so the GLOBAL total never changed and the ledger honestly recorded "no net change".
 *
 * Dispatch and receipt are separate events now, and between them the units are in a van. The
 * global total really does fall at dispatch and rise at receipt. Copying the old row shape here
 * would write `previousStock === newStock` on both legs and make the movement report claim
 * nothing happened, twice.
 *
 * So both figures come from the caller, and the "after" figure is the value
 * `moveOutOfWarehouse` / `moveIntoWarehouse` returned — the recomputed total, not an arithmetic
 * guess. `InventoryTransaction` has no `warehouseId` column, so the warehouse names live in
 * `notes`, which is where `/stock/[id]`'s label parser already looks for them.
 */
export async function writeTransferLedgerRow(
  tx: Tx,
  input: {
    type: "TRANSFER" | "ADJUSTMENT";
    productId: string;
    quantity: number;
    previousStock: number;
    newStock: number;
    orderNo: string;
    /** "[DISPATCHED]", "[RECEIVED]", "[TRANSIT SHORTFALL]" — the tag `/stock/[id]` renders. */
    tag: string;
    fromLabel?: string;
    toLabel?: string;
    userId: string;
  }
): Promise<void> {
  const route =
    input.fromLabel && input.toLabel
      ? `From: ${input.fromLabel} → To: ${input.toLabel} | `
      : input.fromLabel
        ? `From: ${input.fromLabel} | `
        : input.toLabel
          ? `To: ${input.toLabel} | `
          : "";

  await tx.inventoryTransaction.create({
    data: {
      type: input.type,
      productId: input.productId,
      quantity: input.quantity,
      previousStock: input.previousStock,
      newStock: input.newStock,
      referenceNo: input.orderNo,
      // The word "Transfer" must survive in this string: `stock/[id]/page.tsx`'s
      // parseTransactionLabel lowercases the note and tests `includes("transfer")` to render
      // the movement as a transfer rather than a bare adjustment.
      notes: `${input.tag} ${route}Transfer Order: ${input.orderNo}`,
      userId: input.userId,
    },
  });
}
