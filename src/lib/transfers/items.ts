import { z } from "zod";
import { prisma } from "@/lib/db";
import { getWarehouseBreakdown } from "@/lib/stock-location";
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
    select: { id: true, name: true },
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
      return { error: "Source and destination bins are required", status: 400 };
    }
  }

  return { binTrackingEnabled: true };
}
