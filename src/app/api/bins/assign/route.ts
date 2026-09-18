export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { BinMoveRefused, placeUnitsInBin } from "@/lib/units";
import { createLogger } from "@/lib/logger";

const log = createLogger("bins:assign");

interface AssignItemInput {
  lineItemId: string;
  binId: string;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("bins", "edit");
    const body = await req.json();

    const items: AssignItemInput[] = body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return errorResponse("Invalid or empty items array", 400);
    }

    let updatedCount = 0;
    let unitsPlaced = 0;

    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        const { lineItemId, binId } = item;
        if (!lineItemId || !binId) continue;

        const lineItem = await tx.inboundLineItem.findUnique({
          where: { id: lineItemId },
          include: {
            shipment: { select: { id: true, shipmentNo: true } },
          },
        });
        if (!lineItem) continue;

        const targetBin = await tx.bin.findUnique({
          where: { id: binId },
          select: { id: true, warehouseId: true, code: true },
        });
        if (!targetBin) continue;

        // 1. Update lineItem binId
        await tx.inboundLineItem.update({
          where: { id: lineItemId },
          data: { binId },
        });

        // 2. If item is linked to a product, sync stock & units
        if (lineItem.productId) {
          const moveQty = lineItem.deliveredQty || lineItem.quantity;

          // Find unassigned inventory units for this shipment & product
          const unitsToUpdate = await tx.inventoryUnit.findMany({
            where: {
              inboundShipmentId: lineItem.shipmentId,
              productId: lineItem.productId,
              binId: null,
            },
            select: { id: true, binId: true },
            take: moveQty,
          });

          if (unitsToUpdate.length > 0) {
            // ── ONE PLACEMENT HELPER (P6, P11) ──
            //
            // Checks the non-assemblable rule, stamps the units when this bin is a no-assembly
            // bin, and recounts `BinStock` from the units afterwards. The old code incremented
            // `BinStock` by the whole line quantity ON TOP of moving the units, so a bin that
            // is recounted from its units read double.
            await placeUnitsInBin(tx, unitsToUpdate.map((u) => u.id), binId);
            unitsPlaced += unitsToUpdate.length;

            for (const u of unitsToUpdate) {
              await tx.binMovementLog.create({
                data: {
                  warehouseId: targetBin.warehouseId,
                  unitId: u.id,
                  productId: lineItem.productId,
                  quantity: 1,
                  fromBinId: u.binId,
                  toBinId: binId,
                  reason: `Manual assignment from Unmatched Inbound (${lineItem.shipment.shipmentNo})`,
                  movedById: user.id,
                },
              });
            }
          } else {
            // No unit records: older loose stock, whose bin quantity is still `BinStock` alone.
            await tx.binStock.upsert({
              where: { binId_productId: { binId, productId: lineItem.productId } },
              update: { quantity: { increment: moveQty } },
              create: { binId, productId: lineItem.productId, quantity: moveQty },
            });
            await tx.binMovementLog.create({
              data: {
                warehouseId: targetBin.warehouseId,
                productId: lineItem.productId,
                quantity: moveQty,
                fromBinId: null,
                toBinId: binId,
                reason: `Manual assignment from Unmatched Inbound (${lineItem.shipment.shipmentNo})`,
                movedById: user.id,
              },
            });
          }
        }

        updatedCount++;
      }
    }, { timeout: 30_000 });

    log.info("unmatched items assigned to bins", { lines: updatedCount, unitsPlaced, userId: user.id });
    return successResponse({ updatedCount, unitsPlaced, success: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof BinMoveRefused) {
      log.warn("bin assignment refused", { message: error.message });
      return errorResponse(error.message, 409);
    }
    log.error("bin assignment failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to assign bins", 500);
  }
}
