import { z } from "zod";
import { prisma } from "@/lib/db";
import { getWarehouseBreakdown } from "@/lib/stock-location";
import { getWarehouseBinQty } from "@/lib/units/bin-qty";
import { loadHomeBinRules, pickHomeBin } from "@/lib/bins/rule-match";
import type { WarehouseRef } from "@/lib/warehouses";
import { createLogger } from "@/lib/logger";

const log = createLogger("transfers:items");

/**
 * The transfer LINE rules, in one place (plan 1709-priority-build-and-stock-flow, R25).
 *
 * Why this file exists: R25 adds a PATCH that replaces the lines of a RETURNED order, and the
 * lines it accepts must pass EXACTLY the checks `POST /api/transfer-orders` applies — same lane
 * agreement, same "does this product exist", same source-stock check, same bin requirement. Two
 * copies of those four rules is how a returned order could be resubmitted with quantities the
 * create form would have refused, and the difference would only show at dispatch.
 *
 * It deliberately does NOT open a transaction and does NOT write. The caller decides whether the
 * lines are being created or replaced; this only answers "are these lines acceptable on this
 * lane". The stock figure it reads is uncommitted-safe advice, not a guarantee — dispatch
 * re-checks with the row locked, which is the only check that can be trusted.
 */

export const transferItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1),
  fromBinId: z.string().optional(),
  toBinId: z.string().optional(),
  // The item lane is MIRRORED from the header, not chosen. These stay accepted so an older
  // client keeps working, and are refused below when they disagree with the header — silently
  // preferring one over the other is how a transfer would move stock out of a building nobody
  // named.
  fromWarehouseId: z.string().min(1).optional(),
  toWarehouseId: z.string().min(1).optional(),
});

export type TransferItemInput = z.infer<typeof transferItemSchema>;

export interface ValidatedTransferItems {
  /**
   * Always `true`: bins are always on (plan 2109, Q27), so `fromBinId` / `toBinId` are present
   * on every line. No caller reads it any more; kept so the success and refusal shapes stay distinct.
   */
  binTrackingEnabled: true;
}

export interface TransferItemsRefusal {
  error: string;
  status: number;
}

export function isRefusal(
  result: ValidatedTransferItems | TransferItemsRefusal
): result is TransferItemsRefusal {
  return "error" in result;
}

/**
 * Check a set of lines against a lane. Returns either `{ binTrackingEnabled }` or the sentence
 * and status code to refuse with — never throws for a business refusal, so both callers answer
 * with the same words.
 */
export async function validateTransferItems(params: {
  items: TransferItemInput[];
  fromWh: WarehouseRef;
  toWh: WarehouseRef;
  /** Named in the log line so a refusal can be traced to the order it came from. */
  context: { orderId?: string; orderNo?: string };
}): Promise<ValidatedTransferItems | TransferItemsRefusal> {
  const { items, fromWh, toWh, context } = params;

  // An item lane that disagrees with the header is a client that has not been updated, and
  // guessing which one it meant could move stock out of the wrong building.
  for (const item of items) {
    if (item.fromWarehouseId && item.fromWarehouseId !== fromWh.id) {
      return {
        error: "Every line moves along the order's route. Remove the per-line source warehouse.",
        status: 400,
      };
    }
    if (item.toWarehouseId && item.toWarehouseId !== toWh.id) {
      return {
        error: "Every line moves along the order's route. Remove the per-line destination warehouse.",
        status: 400,
      };
    }
  }

  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, brandId: true, categoryId: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  // A friendly up-front check so the person is told at the point of typing rather than at
  // dispatch. It is NOT the safety net — see the header.
  const breakdown = await getWarehouseBreakdown(productIds);
  // A product listed twice on one order draws from one shelf, so the lines are summed before
  // the comparison. Checking each line on its own would pass two lines of 6 against a stock of 10.
  const wanted = new Map<string, number>();
  for (const item of items) {
    wanted.set(item.productId, (wanted.get(item.productId) ?? 0) + item.quantity);
  }
  for (const [productId, quantity] of wanted) {
    const product = productMap.get(productId);
    if (!product) return { error: `Product not found: ${productId}`, status: 404 };
    const available = breakdown.get(productId)?.[fromWh.code] ?? 0;
    if (available < quantity) {
      log.warn("transfer lines refused: short at source", {
        ...context,
        productId,
        warehouseId: fromWh.id,
        available,
        wanted: quantity,
      });
      return {
        error: `Insufficient stock for ${product.name} at ${fromWh.name}. Available: ${available}`,
        status: 400,
      };
    }
  }

  // Bins are always on (plan 2109, Q27): every line names both bins.
  for (const item of items) {
    if (!item.fromBinId || !item.toBinId) {
      log.warn("transfer lines refused: bin missing", { ...context, productId: item.productId });
      return { error: "Choose the source bin and the destination bin on every line", status: 400 };
    }
  }

  // ── THE BINS ARE REAL, ON THE RIGHT SIDE, AND HOLD THE STOCK (plan 0310 Part C, 2209 Phase 1) ──
  //
  // Presence alone was all this used to test — any two ids passed, from any warehouse. The
  // From-bin picker and this check read the same `getWarehouseBinQty` and `pickHomeBin`, so
  // whatever the screen offered is what passes here.
  const binIds = [...new Set(items.flatMap((i) => [i.fromBinId as string, i.toBinId as string]))];
  const bins = await prisma.bin.findMany({
    where: { id: { in: binIds } },
    select: { id: true, code: true, warehouseId: true, isActive: true },
  });
  const binMap = new Map(bins.map((b) => [b.id, b]));
  for (const item of items) {
    const from = binMap.get(item.fromBinId as string);
    const to = binMap.get(item.toBinId as string);
    if (!from || !from.isActive || from.warehouseId !== fromWh.id) {
      log.warn("transfer lines refused: source bin", { ...context, productId: item.productId, binId: item.fromBinId, warehouseId: fromWh.id });
      return { error: `The source bin must be an active bin of ${fromWh.name}.`, status: 400 };
    }
    if (!to || !to.isActive || to.warehouseId !== toWh.id) {
      log.warn("transfer lines refused: destination bin", { ...context, productId: item.productId, binId: item.toBinId, warehouseId: toWh.id });
      return { error: `The destination bin must be an active bin of ${toWh.name}.`, status: 400 };
    }
  }

  // The chosen bin must hold the line (2209 Q2a: refuse, never spread silently). Lines naming the
  // same product AND bin draw from one shelf, so they are summed first.
  const binQty = await getWarehouseBinQty(fromWh.id, productIds);
  const wantedFromBin = new Map<string, { productId: string; binId: string; qty: number }>();
  for (const item of items) {
    const key = `${item.productId}|${item.fromBinId}`;
    const row = wantedFromBin.get(key) ?? { productId: item.productId, binId: item.fromBinId as string, qty: 0 };
    row.qty += item.quantity;
    wantedFromBin.set(key, row);
  }
  for (const { productId, binId, qty } of wantedFromBin.values()) {
    const held = binQty.get(productId) ?? new Map<string, number>();
    const inBin = held.get(binId) ?? 0;
    if (inBin >= qty) continue;
    const others = [...held.entries()]
      .filter(([b]) => b !== binId)
      .sort((a, b) => b[1] - a[1])
      .map(([b, n]) => `${binMap.get(b)?.code ?? "another bin"} (${n})`);
    log.warn("transfer lines refused: short in source bin", { ...context, productId, binId, inBin, wanted: qty });
    const code = binMap.get(binId)?.code ?? "That bin";
    return {
      error:
        `Bin ${code} holds ${inBin} of ${productMap.get(productId)?.name ?? "this product"}, not ${qty}.` +
        (others.length > 0 ? ` It is also in ${others.join(", ")} — split the line across bins.` : ""),
      status: 400,
    };
  }

  // A destination home-bin rule LOCKS the to-bin, as it does at inbound (plan 2109, R34).
  const rules = await loadHomeBinRules(prisma, toWh.id);
  for (const item of items) {
    const product = productMap.get(item.productId)!;
    const match = pickHomeBin(rules, { productId: product.id, brandId: product.brandId, categoryId: product.categoryId });
    if (match && match.bin.id !== item.toBinId) {
      log.warn("transfer lines refused: rule bin", { ...context, productId: product.id, binId: item.toBinId, ruleBinId: match.bin.id });
      return {
        error: `${product.name} goes to bin ${match.bin.code} at ${toWh.name} by its home-bin rule. Choose ${match.bin.code} as the destination bin.`,
        status: 409,
      };
    }
  }

  return { binTrackingEnabled: true };
}
