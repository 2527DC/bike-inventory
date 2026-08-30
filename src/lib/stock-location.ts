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
