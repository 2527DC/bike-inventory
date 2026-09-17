import { nextUnitCode } from "@/lib/sequence";
import { createLogger } from "@/lib/logger";
import type { Tx } from "./constants";
import { syncBinStock } from "./bin-stock";

const log = createLogger("units:createUnits");

export interface CreateUnitsInput {
  productId: string;
  warehouseId: string;
  qty: number;
  /** Built already (an audit counted it assembled). Default: unassembled, as every inward (P4). */
  assembled?: boolean;
  /** Put straight into this bin. A non-assemblable bin stamps the units (P6b). */
  binId?: string | null;
  inboundShipmentId?: string | null;
  /** The INWARD ledger row that created them, so a cleanup can retire exactly these (P4). */
  sourceTransactionId?: string | null;
}

/**
 * Create one unit per physical item, each with its OWN code from the row-locked sequence
 * (`U-000087`, `U-000088`, … — R46, P8). Returns the new ids in code order.
 *
 * With a bin: the bin must be active and in the same warehouse; units are PUT_AWAY there (or
 * ASSEMBLED), stamped non-assemblable when the bin is, and the bin is recounted (P11).
 */
export async function createUnits(tx: Tx, input: CreateUnitsInput): Promise<string[]> {
  if (input.qty <= 0) return [];

  let binNonAssemblable = false;
  if (input.binId) {
    const bin = await tx.bin.findUnique({
      where: { id: input.binId },
      select: { id: true, code: true, warehouseId: true, nonAssemblable: true, isActive: true },
    });
    if (!bin || !bin.isActive) throw new Error("That bin does not exist or is not active — pick another.");
    if (bin.warehouseId !== input.warehouseId) {
      throw new Error(`Bin ${bin.code} is not in the warehouse these items are going into.`);
    }
    binNonAssemblable = bin.nonAssemblable;
  }

  const now = new Date();
  const ids: string[] = [];
  for (let i = 0; i < input.qty; i++) {
    const unitCode = await nextUnitCode(tx);
    const unit = await tx.inventoryUnit.create({
      data: {
        unitCode,
        productId: input.productId,
        warehouseId: input.warehouseId,
        binId: input.binId ?? null,
        status: input.assembled ? "ASSEMBLED" : input.binId ? "PUT_AWAY" : "RECEIVED",
        assembledAt: input.assembled ? now : null,
        nonAssemblable: binNonAssemblable,
        inboundShipmentId: input.inboundShipmentId ?? null,
        sourceTransactionId: input.sourceTransactionId ?? null,
      },
      select: { id: true },
    });
    ids.push(unit.id);
  }

  if (input.binId) await syncBinStock(tx, [input.binId]);

  log.info("units created", {
    productId: input.productId,
    warehouseId: input.warehouseId,
    binId: input.binId ?? null,
    count: ids.length,
    assembled: !!input.assembled,
    nonAssemblable: binNonAssemblable,
    inboundShipmentId: input.inboundShipmentId ?? null,
    sourceTransactionId: input.sourceTransactionId ?? null,
  });
  return ids;
}
