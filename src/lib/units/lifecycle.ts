import { createLogger } from "@/lib/logger";
import { FINAL_UNIT_STATUSES, LIVE_UNIT_STATUSES, type Tx } from "./constants";
import { syncBinStock } from "./bin-stock";
import { cancelOpenTasks } from "./tasks";
import { pickUnitsUpTo } from "./pick";

const logMove = createLogger("units:moveUnits");
const logTransit = createLogger("units:markUnitsInTransit");
const logSell = createLogger("units:sellUnits");
const logRetire = createLogger("units:retireUnits");

async function binsOf(tx: Tx, unitIds: string[]): Promise<string[]> {
  const rows = await tx.inventoryUnit.findMany({
    where: { id: { in: unitIds }, binId: { not: null } },
    select: { binId: true },
  });
  return [...new Set(rows.map((r) => r.binId as string))];
}

/**
 * Move units into another warehouse (transfer receive, R7). They arrive with no bin, as
 * ASSEMBLED when built and RECEIVED otherwise (defect 6: they used to all become PUT_AWAY with
 * no bin). `nonAssemblable` is kept — that stamp is what survives a transfer (P6).
 * Returns the bins they left, already recounted.
 */
export async function moveUnits(tx: Tx, unitIds: string[], destWarehouseId: string): Promise<string[]> {
  const ids = [...new Set(unitIds)];
  if (ids.length === 0) return [];
  const sourceBins = await binsOf(tx, ids);
  const movable = { id: { in: ids }, status: { notIn: FINAL_UNIT_STATUSES } };

  const built = await tx.inventoryUnit.updateMany({
    where: { ...movable, assembledAt: { not: null } },
    data: { warehouseId: destWarehouseId, binId: null, status: "ASSEMBLED" },
  });
  const unbuilt = await tx.inventoryUnit.updateMany({
    where: { ...movable, assembledAt: null },
    data: { warehouseId: destWarehouseId, binId: null, status: "RECEIVED" },
  });
  const moved = built.count + unbuilt.count;
  if (moved !== ids.length) {
    logMove.warn("some units were not movable (already sold, lost or reset)", { requested: ids.length, moved });
  }
  await syncBinStock(tx, sourceBins);
  logMove.info("units moved", { destWarehouseId, moved, assembled: built.count, sourceBins: sourceBins.length });
  return sourceBins;
}

/**
 * Put units on a van (transfer dispatch): TRANSFERRED, no bin, open tasks cancelled, the bins
 * they left recounted. Refuses units that are no longer live.
 */
export async function markUnitsInTransit(tx: Tx, unitIds: string[]): Promise<number> {
  const ids = [...new Set(unitIds)];
  if (ids.length === 0) return 0;
  const sourceBins = await binsOf(tx, ids);
  const { count } = await tx.inventoryUnit.updateMany({
    where: { id: { in: ids }, status: { in: LIVE_UNIT_STATUSES } },
    data: { status: "TRANSFERRED", binId: null },
  });
  if (count !== ids.length) {
    logTransit.error("dispatch named units that are not in stock", { requested: ids.length, updated: count });
    throw new Error("Some of the chosen units are no longer in stock. Reload the transfer and dispatch again.");
  }
  await cancelOpenTasks(tx, ids, "dispatched on a transfer");
  await syncBinStock(tx, sourceBins);
  logTransit.info("units in transit", { units: count, sourceBins: sourceBins.length });
  return count;
}

/**
 * Sell units (R7, R38): SOLD, sold date and invoice, reservation cleared, out of their bin —
 * and the bins they sat in are recounted in the same transaction, so a sale from FLOOR-R3
 * lowers FLOOR-R3.
 */
export async function sellUnits(
  tx: Tx,
  unitIds: string[],
  sale: { invoiceNo?: string | null; customerName?: string | null; customerPhone?: string | null }
): Promise<number> {
  const ids = [...new Set(unitIds)];
  if (ids.length === 0) return 0;
  const sourceBins = await binsOf(tx, ids);
  const { count } = await tx.inventoryUnit.updateMany({
    where: { id: { in: ids }, status: { in: LIVE_UNIT_STATUSES } },
    data: {
      status: "SOLD",
      soldAt: new Date(),
      saleInvoiceNo: sale.invoiceNo ?? null,
      ...(sale.customerName ? { customerName: sale.customerName } : {}),
      ...(sale.customerPhone ? { customerPhone: sale.customerPhone } : {}),
      reservedForDeliveryId: null,
      reservedAt: null,
      binId: null,
    },
  });
  if (count !== ids.length) {
    logSell.error("sale named units that are not in stock", { requested: ids.length, sold: count });
    throw new Error("Some of the picked units are no longer in stock. Try again.");
  }
  await cancelOpenTasks(tx, ids, "sold");
  await syncBinStock(tx, sourceBins);
  logSell.info("units sold", { units: count, invoiceNo: sale.invoiceNo ?? null, bins: sourceBins.length });
  return count;
}

/**
 * Retire units that are gone: LOST (missing, short on arrival, deleted shipment) or RESET
 * (cleared by a stock reset or a cleanup, P3). Bin and reservation cleared, open assembly tasks
 * cancelled (P3 for RESET; a lost cycle cannot be built either), bins recounted. Units already
 * SOLD / LOST / RESET are left alone. Returns how many changed.
 */
export async function retireUnits(tx: Tx, unitIds: string[], status: "LOST" | "RESET"): Promise<number> {
  const ids = [...new Set(unitIds)];
  if (ids.length === 0) return 0;
  let total = 0;
  // Chunked so a warehouse reset of thousands of units stays inside Postgres' bind limit.
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const sourceBins = await binsOf(tx, chunk);
    const { count } = await tx.inventoryUnit.updateMany({
      where: { id: { in: chunk }, status: { notIn: FINAL_UNIT_STATUSES } },
      data: { status, binId: null, reservedForDeliveryId: null, reservedAt: null },
    });
    total += count;
    await cancelOpenTasks(tx, chunk, status === "RESET" ? "stock reset" : "unit lost");
    await syncBinStock(tx, sourceBins);
  }
  if (total !== ids.length) {
    logRetire.warn("some units were already sold, lost or reset", { requested: ids.length, retired: total, status });
  }
  logRetire.info("units retired", { units: total, status });
  return total;
}

/**
 * Sell the units behind a handed-over outward (DELIVERED / WALK_OUT), one line at a time, from
 * the outward's floor warehouse — its own held units first (R16), then built, then oldest.
 *
 * Tolerant (P8, P11): a line whose stock predates units sells only the units that exist, and a
 * line with none sells none; the quantity deduction the caller already made stands either way.
 * Any unit still held for this outward elsewhere (a ★ pick that never arrived) is released,
 * because the outward it was held for is finished.
 */
export async function sellDeliveryUnits(
  tx: Tx,
  delivery: {
    id: string;
    warehouseId: string | null;
    invoiceNo: string;
    customerName?: string | null;
    customerPhone?: string | null;
  },
  lines: Array<{ productId: string; quantity: number }>
): Promise<{ sold: number; released: number }> {
  if (!delivery.warehouseId) return { sold: 0, released: 0 };
  let sold = 0;
  for (const line of lines) {
    const ids = await pickUnitsUpTo(tx, {
      productId: line.productId,
      warehouseId: delivery.warehouseId,
      qty: line.quantity,
      reservedForDeliveryId: delivery.id,
      order: "sale",
    });
    sold += await sellUnits(tx, ids, {
      invoiceNo: delivery.invoiceNo,
      customerName: delivery.customerName,
      customerPhone: delivery.customerPhone,
    });
  }
  const { count: released } = await tx.inventoryUnit.updateMany({
    where: { reservedForDeliveryId: delivery.id },
    data: { reservedForDeliveryId: null, reservedAt: null },
  });
  if (released > 0) {
    logSell.warn("outward finished with units still held elsewhere — released", {
      deliveryId: delivery.id,
      released,
    });
  }
  logSell.info("outward units sold", { deliveryId: delivery.id, lines: lines.length, sold });
  return { sold, released };
}
