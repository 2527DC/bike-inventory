export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { BinMoveRefused, placeUnitsInBin, syncBinStock } from "@/lib/units";
import { createLogger } from "@/lib/logger";

const log = createLogger("bins:move");

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("bins", "edit");
    const body = await req.json();
    const { warehouseId, unitId, productId, quantity = 1, fromBinId, toBinId, reason } = body;

    if (!warehouseId) return errorResponse("warehouseId is required", 400);
    if (!toBinId) return errorResponse("toBinId is required", 400);
    if (!unitId && !productId) return errorResponse("Either unitId or productId must be provided", 400);
    if (!reason?.trim()) return errorResponse("Reason is required for intra-warehouse movement", 400);

    // Verify toBin belongs to warehouse
    const toBin = await prisma.bin.findUnique({
      where: { id: toBinId },
      select: { id: true, warehouseId: true, code: true },
    });
    if (!toBin) return errorResponse("Destination bin not found", 404);
    if (toBin.warehouseId !== warehouseId) {
      return errorResponse(
        "Intra-warehouse Move is strictly within the same warehouse. Moving stock between different warehouses requires an inter-location Stock Transfer.",
        400
      );
    }

    // If fromBinId is provided, verify it also belongs to warehouse
    if (fromBinId) {
      const fromBin = await prisma.bin.findUnique({
        where: { id: fromBinId },
        select: { id: true, warehouseId: true, code: true },
      });
      if (!fromBin) return errorResponse("Source bin not found", 404);
      if (fromBin.warehouseId !== warehouseId) {
        return errorResponse(
          "Intra-warehouse Move is strictly within the same warehouse. Moving stock between different warehouses requires an inter-location Stock Transfer.",
          400
        );
      }
    }

    // 1. Move a specific InventoryUnit (bicycle)
    if (unitId) {
      const unit = await prisma.inventoryUnit.findUnique({
        where: { id: unitId },
        select: { id: true, unitCode: true, binId: true, warehouseId: true, productId: true },
      });

      if (!unit) return errorResponse("Inventory unit not found", 404);
      if (unit.warehouseId !== warehouseId) {
        return errorResponse(
          `Unit ${unit.unitCode} is currently in a different warehouse. Use a Stock Transfer to move it across warehouses.`,
          400
        );
      }

      const actualFromBinId = fromBinId || unit.binId;

      const result = await prisma.$transaction(async (tx) => {
        // ── ONE PLACEMENT HELPER (P6, P11) ──
        //
        // Was an inline `inventoryUnit.update({ binId })` with no bin-stock write at all, so a
        // relocated cycle left `BinStock` claiming it was still in the old bin. `placeUnitsInBin`
        // enforces the non-assemblable rule, stamps the unit when the destination is a
        // no-assembly bin, and recounts BOTH bins from their units.
        await placeUnitsInBin(tx, [unitId], toBinId);

        const movement = await tx.binMovementLog.create({
          data: {
            warehouseId,
            unitId,
            productId: unit.productId,
            quantity: 1,
            fromBinId: actualFromBinId || null,
            toBinId,
            reason: reason.trim(),
            movedById: user.id,
          },
        });

        const updatedUnit = await tx.inventoryUnit.findUnique({ where: { id: unitId } });
        return { unit: updatedUnit, log: movement };
      });

      log.info("unit relocated", {
        unitId,
        unitCode: unit.unitCode,
        warehouseId,
        fromBinId: actualFromBinId || null,
        toBinId,
        userId: user.id,
      });
      return successResponse(result);
    }

    // 2. Move loose/bulk product quantity
    //
    // Older stock with no unit records: the quantity is `BinStock` and nothing else, so it is
    // still moved by decrement/increment. Once codes have been generated for it (R41) its
    // units are the truth and the branch above runs instead.
    if (productId) {
      const moveQty = Number(quantity) || 1;
      if (moveQty <= 0) return errorResponse("Quantity must be positive", 400);

      const outcome = await prisma.$transaction(async (tx) => {
        if (fromBinId) {
          const fromStock = await tx.binStock.findUnique({
            where: { binId_productId: { binId: fromBinId, productId } },
          });

          if (!fromStock || fromStock.quantity < moveQty) {
            return {
              error: `Source bin does not have sufficient quantity (available: ${fromStock?.quantity ?? 0})`,
            };
          }

          await tx.binStock.update({
            where: { binId_productId: { binId: fromBinId, productId } },
            data: { quantity: { decrement: moveQty } },
          });
        }

        // Upsert destination bin stock
        await tx.binStock.upsert({
          where: { binId_productId: { binId: toBinId, productId } },
          update: { quantity: { increment: moveQty } },
          create: {
            binId: toBinId,
            productId,
            quantity: moveQty,
          },
        });

        const movement = await tx.binMovementLog.create({
          data: {
            warehouseId,
            productId,
            quantity: moveQty,
            fromBinId: fromBinId || null,
            toBinId,
            reason: reason.trim(),
            movedById: user.id,
          },
        });

        // If this product DOES have units, the counts just typed in are overruled by them.
        await syncBinStock(tx, [fromBinId || null, toBinId]);

        return { moved: true, quantity: moveQty, log: movement };
      });

      if ("error" in outcome) {
        log.warn("bulk move refused — not enough in the source bin", {
          productId,
          fromBinId: fromBinId || null,
          toBinId,
          moveQty,
        });
        return errorResponse(outcome.error as string, 400);
      }

      log.info("bulk quantity relocated", {
        productId,
        warehouseId,
        fromBinId: fromBinId || null,
        toBinId,
        quantity: moveQty,
        userId: user.id,
      });
      return successResponse(outcome);
    }

    return errorResponse("Invalid move payload", 400);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof BinMoveRefused) {
      log.warn("bin move refused", { message: error.message });
      return errorResponse(error.message, 409);
    }
    log.error("bin move failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to execute bin movement", 500);
  }
}
