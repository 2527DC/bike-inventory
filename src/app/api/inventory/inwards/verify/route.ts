export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { adjustWarehouseQty, addAnywhereAt } from "@/lib/stock-location";
import { resolveWarehouse } from "@/lib/warehouses";
import { createUnits } from "@/lib/units";
import { createLogger } from "@/lib/logger";

const log = createLogger("inventory:inwards-verify");

// POST: Verify a Zoho-pulled inward transaction (adds stock)
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("inbound", "approve");
    const body = await req.json();
    const { transactionId, binId, warehouseId } = body;

    if (!transactionId) return errorResponse("Transaction ID required", 400);

    const transaction = await prisma.inventoryTransaction.findUnique({
      where: { id: transactionId },
      include: { product: true },
    });

    if (!transaction) return errorResponse("Transaction not found", 404);
    if (transaction.type !== "INWARD") return errorResponse("Not an inward transaction", 400);
    if (!transaction.notes?.includes("[ZOHO]")) return errorResponse("Not a Zoho transaction", 400);
    if (transaction.notes?.includes("[VERIFIED]")) return errorResponse("Already verified", 400);

    // Resolved before the transaction: `resolveWarehouse` reads on the root client.
    let targetWarehouseId: string | null = null;
    if (warehouseId) {
      const resolved = await resolveWarehouse(warehouseId);
      if ("error" in resolved) return errorResponse(resolved.error, 400);
      targetWarehouseId = resolved.warehouse.id;
    }

    // Now actually add the stock — read product INSIDE transaction to prevent race condition
    const unitsCreated = await prisma.$transaction(async (tx) => {
      // Idempotent claim: two approvers verifying the same row at once must add the stock
      // once. The `[VERIFIED]` check above ran outside the transaction.
      const claim = await tx.inventoryTransaction.updateMany({
        where: { id: transactionId, notes: { not: { contains: "[VERIFIED]" } } },
        data: {
          notes: transaction.notes!
            .replace("[UNVERIFIED]", "[VERIFIED]")
            + ` | Verified by: ${user.name} at ${new Date().toISOString()}`,
        },
      });
      if (claim.count !== 1) throw new Error("Already verified");

      const product = await tx.product.findUniqueOrThrow({
        where: { id: transaction.productId },
      });

      // THE FIX (R12), and this site is NOT in the 0409 plan's table — it was found by the
      // phase's proof grep for direct `currentStock:` writes.
      //
      // It is the same bug mirrored. The outward paths wrote the cache and let the ledger
      // hand sold units back; this INWARD path wrote the cache and left the ledger short, so
      // the next recompute made verified stock DISAPPEAR instead of reappear. Same cause,
      // opposite symptom, so it is fixed the same way.
      //
      // `warehouseId` is honoured when a caller sends one (none does today); otherwise the
      // units go where that product already lives. See addAnywhere.
      let newStock: number;
      let unitWarehouseId: string | null;
      if (targetWarehouseId) {
        newStock = await adjustWarehouseQty(tx, product.id, targetWarehouseId, transaction.quantity);
        unitWarehouseId = targetWarehouseId;
      } else {
        const added = await addAnywhereAt(tx, product.id, transaction.quantity);
        newStock = added.total;
        unitWarehouseId = added.warehouseId;
      }

      if (binId) {
        await tx.product.update({ where: { id: product.id }, data: { binId } });
      }

      await tx.inventoryTransaction.update({
        where: { id: transactionId },
        data: { previousStock: product.currentStock, newStock },
      });

      // ── UNITS FOR THE VERIFIED QUANTITY (plan 1709, P4) ──
      //
      // Every inward creates unassembled units, in the warehouse the quantity went to, tied to
      // this INWARD row so the Zoho cleanup can retire exactly them. No bin yet: the home-bin
      // rule placement arrives with Part H.
      if (!unitWarehouseId) return 0;
      const ids = await createUnits(tx, {
        productId: product.id,
        warehouseId: unitWarehouseId,
        qty: transaction.quantity,
        sourceTransactionId: transactionId,
      });
      return ids.length;
    }, { timeout: 30_000 });

    log.info("zoho inward verified", { transactionId, productId: transaction.productId, qty: transaction.quantity, unitsCreated });
    return successResponse({ message: "Inward verified, stock added", id: transactionId, unitsCreated });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("inward verify failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Verification failed", 400);
  }
}
