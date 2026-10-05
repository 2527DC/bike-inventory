import { nextUnitCodes } from "@/lib/sequence";
import { createLogger } from "@/lib/logger";
import type { Tx } from "./constants";
import { syncBinStock } from "./bin-stock";

const log = createLogger("units:createUnits");

/** Rows per INSERT. ~12 columns each, so a chunk stays far below Postgres's 65,535 parameters. */
const INSERT_CHUNK = 1000;

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

  // ONE code allocation and one INSERT per chunk — never a statement per item (plan 0510).
  // Until 5 Oct 2026 this looped `nextUnitCode` + `create` once per unit: three statements per
  // item, one of them a scan of the whole table, so an audit giving 4,050 items their codes
  // outran its transaction and was rolled back.
  const started = Date.now();
  const now = new Date();
  const codes = await nextUnitCodes(tx, input.qty);
  const rows = codes.map((unitCode) => ({
    unitCode,
    productId: input.productId,
    warehouseId: input.warehouseId,
    binId: input.binId ?? null,
    status: input.assembled ? ("ASSEMBLED" as const) : input.binId ? ("PUT_AWAY" as const) : ("RECEIVED" as const),
    assembledAt: input.assembled ? now : null,
    nonAssemblable: binNonAssemblable,
    inboundShipmentId: input.inboundShipmentId ?? null,
    sourceTransactionId: input.sourceTransactionId ?? null,
  }));

  const idByCode = new Map<string, string>();
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const created = await tx.inventoryUnit.createManyAndReturn({
      data: rows.slice(i, i + INSERT_CHUNK),
      select: { id: true, unitCode: true },
    });
    for (const u of created) idByCode.set(u.unitCode, u.id);
  }
  // Code order is what the label sheet prints in; it is rebuilt from the codes allocated, not
  // trusted to the order the INSERT happened to return.
  const ids = codes.map((code) => idByCode.get(code)).filter((id): id is string => id !== undefined);
  if (ids.length !== codes.length) {
    log.error("units created do not match the codes allocated", {
      productId: input.productId,
      allocated: codes.length,
      returned: idByCode.size,
    });
    throw new Error("Creating the unit codes failed — nothing was saved. Try again.");
  }
  log.debug("units inserted", { productId: input.productId, count: codes.length, ms: Date.now() - started });

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
