export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { adjustWarehouseQty, addAnywhereAt } from "@/lib/stock-location";
import { resolveWarehouse } from "@/lib/warehouses";
import { BinMoveRefused, createUnits } from "@/lib/units";
import { matchHomeBin } from "@/lib/bins/rule-match";
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

      // `Product.binId` is set below, once the bin the units actually went into is known — the
      // caller's bin may belong to another warehouse, or there may be none and a rule decides.

      await tx.inventoryTransaction.update({
        where: { id: transactionId },
        data: { previousStock: product.currentStock, newStock },
      });

      // ── UNITS FOR THE VERIFIED QUANTITY (plan 1709, P4) ──
      //
      // Every inward creates unassembled units, in the warehouse the quantity went to, tied to
      // this INWARD row so the Zoho cleanup can retire exactly them.
      //
      // The bin: the one the caller sent, else the home-bin rule for this product in that
      // warehouse (P4 (2)). A rule bin that needs no assembly stamps the units on the way in,
      // so a spare verified from Zoho never reaches the build line.
      if (!unitWarehouseId) return { units: 0, binId: null as string | null, ruleLabel: null as string | null };

      let targetBinId: string | null = null;
      let ruleLabel: string | null = null;
      if (binId) {
        const bin = await tx.bin.findUnique({
          where: { id: binId },
          select: { id: true, isActive: true, warehouseId: true },
        });
        if (bin && bin.isActive && bin.warehouseId === unitWarehouseId) targetBinId = bin.id;
      }
      if (!targetBinId) {
        const match = await matchHomeBin(tx, { productId: product.id, warehouseId: unitWarehouseId });
        if (match) {
          targetBinId = match.bin.id;
          ruleLabel = match.label;
        }
      }

      const ids = await createUnits(tx, {
        productId: product.id,
        warehouseId: unitWarehouseId,
        qty: transaction.quantity,
        binId: targetBinId,
        sourceTransactionId: transactionId,
      });

      if (targetBinId && ids.length > 0) {
        await tx.product.update({ where: { id: product.id }, data: { binId: targetBinId } });
        await tx.binMovementLog.create({
          data: {
            warehouseId: unitWarehouseId,
            productId: product.id,
            quantity: transaction.quantity,
            fromBinId: null,
            toBinId: targetBinId,
            reason: ruleLabel ? `Zoho inward verified — home bin rule (${ruleLabel})` : "Zoho inward verified",
            movedById: user.id,
          },
        });
      }

      return { units: ids.length, binId: targetBinId, ruleLabel };
    }, { timeout: 30_000 });

    log.info("zoho inward verified", {
      transactionId,
      productId: transaction.productId,
      qty: transaction.quantity,
      unitsCreated: unitsCreated.units,
      binId: unitsCreated.binId,
      ruleLabel: unitsCreated.ruleLabel,
    });
    return successResponse({
      message: "Inward verified, stock added",
      id: transactionId,
      unitsCreated: unitsCreated.units,
      binId: unitsCreated.binId,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof BinMoveRefused) {
      log.warn("inward verify refused by the bin rules", { message: error.message });
      return errorResponse(error.message, 409);
    }
    log.error("inward verify failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Verification failed", 400);
  }
}
