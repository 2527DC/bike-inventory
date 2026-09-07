// Per-warehouse stock helpers.
//
// Model: each (product, warehouse) has an explicit StockLevel row. Product.currentStock is
// the cached SUM of a product's rows, recomputed on every change. There is no "derived"
// location — counting/receiving/transferring all write a specific warehouse and then
// recompute the total.
//
// Every exported function used to take `location: StockLocation`. They now take
// `warehouseId: string`, because locations are rows: see src/lib/warehouses.ts to resolve a
// code or a request value to an id. These are the functions that keep Product.currentStock
// correct, so every caller changed with them.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type Tx = Prisma.TransactionClient;
type DbClient = Tx | typeof prisma;

// Recompute and persist Product.currentStock = sum of its StockLevel quantities.
// Returns the new total.
export async function recomputeCurrentStock(tx: Tx, productId: string): Promise<number> {
  const agg = await tx.stockLevel.aggregate({
    where: { productId },
    _sum: { quantity: true },
  });
  const total = agg._sum.quantity ?? 0;
  await tx.product.update({ where: { id: productId }, data: { currentStock: total } });
  return total;
}

// Change a warehouse's quantity by delta (may be negative). Clamps at 0, upserts the row,
// then recomputes currentStock. Returns the new total.
export async function adjustWarehouseQty(tx: Tx, productId: string, warehouseId: string, delta: number): Promise<number> {
  const existing = await tx.stockLevel.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    select: { quantity: true },
  });
  const next = Math.max(0, (existing?.quantity ?? 0) + delta);
  await tx.stockLevel.upsert({
    where: { productId_warehouseId: { productId, warehouseId } },
    update: { quantity: next },
    create: { productId, warehouseId, quantity: next },
  });
  return recomputeCurrentStock(tx, productId);
}

/**
 * Take `qty` of a product out of a STORE, spreading across that store's warehouses.
 *
 * ─── WHY THIS EXISTS (R12 — the bug it fixes) ─────────────────────────────────────────────
 *
 * Product.currentStock is a CACHE. StockLevel is the truth. Receiving, audits and transfers
 * honour that: they write StockLevel and let recomputeCurrentStock rebuild the total. The
 * outward paths did not — they wrote `currentStock` directly and never touched the ledger.
 *
 * So the next recompute, triggered by ANY later receipt, applied audit or transfer, rebuilt
 * the total from a ledger that was never told about the sale, and the sold units came back:
 *
 *     10 in stock -> sell 3 -> shows 7 -> receive 5 -> shows 15, not 12.
 *
 * Routing every outward movement through here is what makes a sale survive.
 *
 * ─── WHY A STORE AND NOT A WAREHOUSE ──────────────────────────────────────────────────────
 *
 * A delivery names a store and nothing else — no screen and no request body mentions a
 * warehouse (owner, 4 Sep: deduction is store-scoped). But stock only exists in StockLevel
 * rows, which are per warehouse. So the store is the interface and its warehouses are the
 * implementation: this walks them in `sortOrder` and cascades to the next when one cannot
 * cover the line.
 *
 * ─── THE SHORTFALL CHECK IS NOT OPTIONAL ──────────────────────────────────────────────────
 *
 * `adjustWarehouseQty` clamps at zero. Deducting 3 from a warehouse holding 0 therefore
 * writes 0 and reports success — which would lose the sale exactly as the original bug did,
 * in a new costume. Summing the store first and refusing up front is what prevents that.
 *
 * Today every store has one warehouse, so this resolves to a single write. The cascade
 * exists because /stores already allows a second one, and a silent partial deduction must
 * not be the way we find that out.
 *
 * Throws a readable Error naming the product and the shortfall. Call it inside the caller's
 * transaction so a refusal rolls the whole delivery back rather than leaving half a sale.
 *
 * @returns the product's new cached total.
 */
export async function deductFromStore(
  tx: Tx,
  productId: string,
  storeId: string,
  qty: number,
  productLabel?: string
): Promise<number> {
  if (qty <= 0) return recomputeCurrentStock(tx, productId);

  // Active only, in picker order. An inactive warehouse is one nobody is putting stock into
  // or taking it out of, so draining it as a side effect of a sale would be a surprise.
  const warehouses = await tx.warehouse.findMany({
    where: { storeId, isActive: true },
    select: { id: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  if (warehouses.length === 0) {
    throw new Error(
      `Cannot deduct ${qty} of ${productLabel ?? productId}: this store has no active warehouse to take stock from.`
    );
  }

  return deductAcrossWarehouses(
    tx,
    productId,
    warehouses.map((w) => w.id),
    qty,
    productLabel,
    "at this store"
  );
}

/**
 * Take `qty` out of wherever the product actually is, across every warehouse holding it.
 *
 * For REVERSALS, not sales. Undoing an inbound receipt has to put the ledger back, but the
 * warehouse the receipt went into is not recorded anywhere: `inbound/[id]/route.ts` takes it
 * from the request body at receive time and `InboundLineItem` has no `warehouseId` column to
 * keep it in. Storing it would be a schema change, and P1b carries no migration.
 *
 * So this reverses against the rows that exist, largest holding first. With one warehouse per
 * store — today's shape — it is exactly equivalent to reversing the original receipt. With
 * several it is a best effort that is still strictly correct in total, because the units come
 * out of the ledger rather than only out of the cache.
 *
 * ⚠ The precise fix is `InboundLineItem.warehouseId`, written at receive time and read here.
 *   Raised for a later phase; see the P1b notes in the 0409 plan.
 */
export async function deductAnywhere(
  tx: Tx,
  productId: string,
  qty: number,
  productLabel?: string
): Promise<number> {
  if (qty <= 0) return recomputeCurrentStock(tx, productId);

  const levels = await tx.stockLevel.findMany({
    where: { productId, quantity: { gt: 0 } },
    select: { warehouseId: true, quantity: true },
    orderBy: { quantity: "desc" },
  });

  return deductAcrossWarehouses(
    tx,
    productId,
    levels.map((l) => l.warehouseId),
    qty,
    productLabel,
    "in any warehouse"
  );
}

/**
 * Put `qty` BACK, for a reversal that has no recorded destination.
 *
 * The mirror of `deductAnywhere` and subject to the same limitation: nothing records which
 * warehouse an undone movement came out of. It goes to the warehouse that already holds the
 * most of this product — the one it most likely left — and failing that to the primary
 * store's first active warehouse, so the units land in the ledger rather than only in the
 * cache. Never invents a warehouse.
 */
export async function addAnywhere(
  tx: Tx,
  productId: string,
  qty: number
): Promise<number> {
  if (qty <= 0) return recomputeCurrentStock(tx, productId);

  const busiest = await tx.stockLevel.findFirst({
    where: { productId },
    select: { warehouseId: true },
    orderBy: { quantity: "desc" },
  });

  const warehouseId =
    busiest?.warehouseId ??
    (
      await tx.warehouse.findFirst({
        where: { isActive: true },
        select: { id: true },
        orderBy: [{ store: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
      })
    )?.id;

  if (!warehouseId) {
    throw new Error(`Cannot restore ${qty} units: no active warehouse exists to put them in.`);
  }

  return adjustWarehouseQty(tx, productId, warehouseId, qty);
}

/**
 * The shared core: take `qty` across `warehouseIds` in the order given, cascading to the next
 * when one cannot cover it.
 *
 * The up-front sum is the load-bearing part. `adjustWarehouseQty` clamps at zero, so
 * deducting 3 from a warehouse holding 0 writes 0 and reports success — a silent short
 * deduction, which is the original bug wearing a different hat. Summing first and refusing
 * before any write is what makes that impossible.
 */
async function deductAcrossWarehouses(
  tx: Tx,
  productId: string,
  warehouseIds: string[],
  qty: number,
  productLabel: string | undefined,
  scopeLabel: string
): Promise<number> {
  const label = productLabel ?? productId;

  const levels = await tx.stockLevel.findMany({
    where: { productId, warehouseId: { in: warehouseIds } },
    select: { warehouseId: true, quantity: true },
  });
  const held = new Map(levels.map((l) => [l.warehouseId, l.quantity]));
  const available = levels.reduce((sum, l) => sum + l.quantity, 0);

  if (available < qty) {
    throw new Error(
      `Insufficient stock for ${label} ${scopeLabel}. Available: ${available}, Needed: ${qty}.`
    );
  }

  let remaining = qty;
  for (const warehouseId of warehouseIds) {
    if (remaining <= 0) break;
    const inThis = held.get(warehouseId) ?? 0;
    if (inThis <= 0) continue;
    const take = Math.min(inThis, remaining);
    await adjustWarehouseQty(tx, productId, warehouseId, -take);
    remaining -= take;
  }

  // Unreachable: the sum above already proved enough is held, and this runs inside the
  // caller's transaction so nothing else can drain it in between. Kept as a loud failure
  // rather than a silent short deduction if that reasoning is ever wrong.
  if (remaining > 0) {
    throw new Error(
      `Could not fully deduct ${label}: ${remaining} of ${qty} left unallocated ${scopeLabel}.`
    );
  }

  return recomputeCurrentStock(tx, productId);
}

// Set a warehouse's quantity to an absolute value (clamped >= 0), then recompute
// currentStock. Used by stock counts. Returns the new total.
export async function setWarehouseQty(tx: Tx, productId: string, warehouseId: string, qty: number): Promise<number> {
  const next = Math.max(0, qty);
  await tx.stockLevel.upsert({
    where: { productId_warehouseId: { productId, warehouseId } },
    update: { quantity: next },
    create: { productId, warehouseId, quantity: next },
  });
  return recomputeCurrentStock(tx, productId);
}

// Quantity at one warehouse for many products (productId -> qty, missing = 0).
export async function getWarehouseQtyMap(productIds: string[], warehouseId: string, client: DbClient = prisma): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await client.stockLevel.findMany({
    where: { productId: { in: productIds }, warehouseId },
    select: { productId: true, quantity: true },
  });
  return new Map(rows.map((r) => [r.productId, r.quantity]));
}

/**
 * Quantity across a whole STORE for many products (productId -> qty, missing = 0).
 *
 * The store-scoped counterpart of `getWarehouseQtyMap`, for a whole-store stock audit. Sums
 * the store's ACTIVE warehouses — an inactive one is not somewhere anybody is counting, so
 * including it would report stock the counter cannot physically see and manufacture a
 * variance on every line.
 *
 * NOT `Product.currentStock`. That is the global cache across every store, so a BCH audit
 * would have been handed BCH + BCC quantities and shown a variance on products that were
 * simply sitting in the other store.
 */
export async function getStoreQtyMap(
  productIds: string[],
  storeId: string,
  client: DbClient = prisma
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await client.stockLevel.findMany({
    where: {
      productId: { in: productIds },
      warehouse: { storeId, isActive: true },
    },
    select: { productId: true, quantity: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.productId, (out.get(r.productId) ?? 0) + r.quantity);
  }
  return out;
}

// Quantity at one warehouse for a single product (0 if no row).
export async function getWarehouseQty(productId: string, warehouseId: string, client: DbClient = prisma): Promise<number> {
  const row = await client.stockLevel.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    select: { quantity: true },
  });
  return row?.quantity ?? 0;
}

// Full per-warehouse breakdown for many products: productId -> { warehouseCode -> qty }.
//
// Keyed by CODE rather than id: the only consumers render it, and "BCH_WAREHOUSE" is
// readable in a payload while a cuid is not. Callers that need ids have the rows already.
export async function getWarehouseBreakdown(productIds: string[], client: DbClient = prisma): Promise<Map<string, Record<string, number>>> {
  const out = new Map<string, Record<string, number>>();
  if (productIds.length === 0) return out;
  const rows = await client.stockLevel.findMany({
    where: { productId: { in: productIds } },
    select: { productId: true, quantity: true, warehouse: { select: { code: true } } },
  });
  for (const r of rows) {
    const cur = out.get(r.productId) ?? {};
    cur[r.warehouse.code] = r.quantity;
    out.set(r.productId, cur);
  }
  return out;
}
