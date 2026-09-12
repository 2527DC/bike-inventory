export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

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
        include: { bin: true },
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
        const updatedUnit = await tx.inventoryUnit.update({
          where: { id: unitId },
          data: {
            binId: toBinId,
            status: unit.status === "RECEIVED" ? "PUT_AWAY" : unit.status,
          },
        });

        const log = await tx.binMovementLog.create({
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

        return { unit: updatedUnit, log };
      });

      return successResponse(result);
    }

    // 2. Move loose/bulk product quantity
    if (productId) {
      const moveQty = Number(quantity) || 1;
      if (moveQty <= 0) return errorResponse("Quantity must be positive", 400);

      const result = await prisma.$transaction(async (tx) => {
        if (fromBinId) {
          const fromStock = await tx.binStock.findUnique({
            where: { binId_productId: { binId: fromBinId, productId } },
          });

          if (!fromStock || fromStock.quantity < moveQty) {
            return errorResponse(
              `Source bin does not have sufficient quantity (available: ${fromStock?.quantity ?? 0})`,
              400
            );
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

        const log = await tx.binMovementLog.create({
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

        return { moved: true, quantity: moveQty, log };
      });

      return successResponse(result);
    }

    return errorResponse("Invalid move payload", 400);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to execute bin movement", 500);
  }
}
