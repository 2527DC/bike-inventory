import type { Prisma } from "@prisma/client";
import { recomputeCurrentStock, recomputeReservedStock } from "@/lib/stock-location";
import { createLogger } from "@/lib/logger";

const log = createLogger("stock:hold");

type Tx = Prisma.TransactionClient;

/**
 * A delivery's stock, on ONE floor warehouse (plan 1609-deliveries, Phase 1).
 *
 * ─── THE RULES THIS FILE ENFORCES ─────────────────────────────────────────────────────────
 *
 * - An outward names a FLOOR warehouse (`Delivery.warehouseId`) and never touches a godown
 *   (owner, A40). `deductFromStore`, which cascades floor → godown, is NOT used for deliveries
 *   any more; it stays for manual outwards and store audits.
 * - A hold is `StockLevel.reservedQuantity` on that floor (A46); `Product.reservedStock` is only
 *   its cache (`recomputeReservedStock`).
 * - Holding NEVER fails on a shortage (A26, A37). A delivery is held all-or-nothing (T5): if any
 *   line is short, nothing is held and `stockReservedAt` stays null, which the screens show as
 *   "Stock not reserved" with a "Reserve stock now" button (A38).
 * - Handing over (Walk-out / Delivered) REFUSES when the floor is short (A40b). Nothing clamps.
 *
 * Call every function inside the caller's `$transaction`.
 */

export interface DeliveryLine {
  name: string;
  sku: string;
  quantity: number;
}

export interface ShortLine {
  name: string;
  sku: string;
  available: number;
  needed: number;
}

/** Holdable lines: SKU present, positive quantity, the same SKU summed across lines. */
export function stockLines(lineItems: unknown): DeliveryLine[] {
  const raw = Array.isArray(lineItems) ? (lineItems as Array<Partial<DeliveryLine>>) : [];
  const bySku = new Map<string, DeliveryLine>();
  for (const li of raw) {
    const sku = typeof li.sku === "string" ? li.sku.trim() : "";
    const qty = Number(li.quantity ?? 0);
    if (!sku || !(qty > 0)) continue;
    const prev = bySku.get(sku);
    if (prev) prev.quantity += qty;
    else bySku.set(sku, { name: String(li.name ?? sku), sku, quantity: qty });
  }
  return [...bySku.values()];
}

/**
 * The product a delivery line refers to. `Product.sku` is `@unique`, so this is one lookup —
 * the old "Bharath Cycle Hub bin first, then any" pair of queries could only ever find one row.
 */
export async function findDeliveryProduct(tx: Tx, sku: string) {
  return tx.product.findUnique({ where: { sku }, select: { id: true, name: true } });
}

interface DeliveryForStock {
  id: string;
  invoiceNo: string;
  warehouseId: string | null;
  lineItems: unknown;
  stockReservedAt: Date | null;
}

async function levelOf(tx: Tx, productId: string, warehouseId: string) {
  const row = await tx.stockLevel.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    select: { quantity: true, reservedQuantity: true },
  });
  return { quantity: row?.quantity ?? 0, reserved: row?.reservedQuantity ?? 0 };
}

/**
 * Try to hold this delivery's stock on its floor. Never throws on a shortage.
 *
 * Returns `held: true` and sets `stockReservedAt` when every line fits; otherwise holds nothing
 * and returns the short lines. Already held → no-op. A line whose SKU matches no product is
 * skipped, as the deduction has always done.
 */
export async function holdDeliveryStock(
  tx: Tx,
  delivery: DeliveryForStock
): Promise<{ held: boolean; short: ShortLine[] }> {
  if (delivery.stockReservedAt) return { held: true, short: [] };
  if (!delivery.warehouseId) {
    throw new Error("Dummy delivery: no warehouse matched this invoice number. No actions are allowed.");
  }

  const plan: Array<{ productId: string; qty: number }> = [];
  const short: ShortLine[] = [];
  for (const line of stockLines(delivery.lineItems)) {
    const product = await findDeliveryProduct(tx, line.sku);
    if (!product) continue;
    const { quantity, reserved } = await levelOf(tx, product.id, delivery.warehouseId);
    const available = quantity - reserved;
    if (available < line.quantity) {
      short.push({ name: line.name, sku: line.sku, available: Math.max(0, available), needed: line.quantity });
    } else {
      plan.push({ productId: product.id, qty: line.quantity });
    }
  }

  if (short.length > 0) {
    log.warn("hold short — nothing held", {
      deliveryId: delivery.id,
      warehouseId: delivery.warehouseId,
      shortLines: short.length,
    });
    return { held: false, short };
  }

  for (const p of plan) {
    await tx.stockLevel.upsert({
      where: { productId_warehouseId: { productId: p.productId, warehouseId: delivery.warehouseId } },
      update: { reservedQuantity: { increment: p.qty } },
      create: { productId: p.productId, warehouseId: delivery.warehouseId, quantity: 0, reservedQuantity: p.qty },
    });
    await recomputeReservedStock(tx, p.productId);
  }
  await tx.delivery.update({ where: { id: delivery.id }, data: { stockReservedAt: new Date() } });
  log.info("delivery stock held", { deliveryId: delivery.id, warehouseId: delivery.warehouseId, lines: plan.length });
  return { held: true, short: [] };
}

/** Give the hold back. No-op when nothing is held. Does not write the delivery row — the caller does. */
export async function releaseDeliveryStock(tx: Tx, delivery: DeliveryForStock): Promise<boolean> {
  if (!delivery.stockReservedAt || !delivery.warehouseId) return false;
  for (const line of stockLines(delivery.lineItems)) {
    const product = await findDeliveryProduct(tx, line.sku);
    if (!product) continue;
    const { reserved } = await levelOf(tx, product.id, delivery.warehouseId);
    await tx.stockLevel.updateMany({
      where: { productId: product.id, warehouseId: delivery.warehouseId },
      data: { reservedQuantity: Math.max(0, reserved - line.quantity) },
    });
    await recomputeReservedStock(tx, product.id);
  }
  log.info("delivery stock released", { deliveryId: delivery.id, warehouseId: delivery.warehouseId });
  return true;
}

export interface DeductedLine {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  previousStock: number;
  newStock: number;
}

/**
 * Hand the goods over: take every line out of the floor, refusing if any line is short (A40b).
 *
 * Checks every line BEFORE writing any, so a refusal leaves nothing half-done even before the
 * transaction rolls back. When the delivery was held, its own hold is consumed; otherwise the
 * holds of other deliveries are respected. Returns what moved, for the OUTWARD ledger rows and
 * the reorder notifications. Does not write the delivery row.
 */
export async function deductDeliveryFromFloor(
  tx: Tx,
  delivery: DeliveryForStock,
  warehouseName: string
): Promise<DeductedLine[]> {
  if (!delivery.warehouseId) {
    throw new Error("Dummy delivery: no warehouse matched this invoice number. No actions are allowed.");
  }
  const wasHeld = !!delivery.stockReservedAt;

  const plan: Array<DeliveryLine & { productId: string; quantity: number; reserved: number; onFloor: number }> = [];
  for (const line of stockLines(delivery.lineItems)) {
    const product = await findDeliveryProduct(tx, line.sku);
    if (!product) continue;
    const { quantity, reserved } = await levelOf(tx, product.id, delivery.warehouseId);
    const usable = wasHeld ? quantity : quantity - reserved;
    if (usable < line.quantity) {
      log.warn("handover refused: floor short", {
        deliveryId: delivery.id,
        warehouseId: delivery.warehouseId,
        productId: product.id,
        usable,
        needed: line.quantity,
      });
      throw new Error(
        `Not enough stock of ${line.name} (SKU: ${line.sku}) on ${warehouseName} ` +
          `(has ${Math.max(0, usable)}, needs ${line.quantity}). Transfer from godown first.`
      );
    }
    plan.push({ ...line, productId: product.id, reserved, onFloor: quantity });
  }

  const moved: DeductedLine[] = [];
  for (const p of plan) {
    const previousStock = (await tx.product.findUnique({ where: { id: p.productId }, select: { currentStock: true } }))
      ?.currentStock ?? 0;
    await tx.stockLevel.update({
      where: { productId_warehouseId: { productId: p.productId, warehouseId: delivery.warehouseId } },
      data: {
        quantity: p.onFloor - p.quantity,
        ...(wasHeld ? { reservedQuantity: Math.max(0, p.reserved - p.quantity) } : {}),
      },
    });
    const newStock = await recomputeCurrentStock(tx, p.productId);
    if (wasHeld) await recomputeReservedStock(tx, p.productId);
    moved.push({ productId: p.productId, name: p.name, sku: p.sku, quantity: p.quantity, previousStock, newStock });
  }
  log.info("delivery stock deducted from floor", {
    deliveryId: delivery.id,
    warehouseId: delivery.warehouseId,
    lines: moved.length,
    wasHeld,
  });
  return moved;
}

/** Statuses in which a delivery ought to hold stock; null `stockReservedAt` in one of these = "not reserved". */
export const HOLDING_STATUSES = ["SCHEDULED", "PACKED", "OUT_FOR_DELIVERY", "SHIPPED", "IN_TRANSIT"] as const;

/** Statuses that are finished; a null warehouse on anything else is a Dummy. */
export const TERMINAL_STATUSES = ["DELIVERED", "WALK_OUT"] as const;

export function isDummy(d: { warehouseId: string | null; status: string }): boolean {
  return !d.warehouseId && !(TERMINAL_STATUSES as readonly string[]).includes(d.status);
}
