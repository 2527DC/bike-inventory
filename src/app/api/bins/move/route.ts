export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { z } from "zod";
import { BinMoveRefused, LIVE_UNIT_STATUSES, placeUnitsInBin, syncBinStock } from "@/lib/units";
import { getBinQtyMap } from "@/lib/units/bin-qty";
import { createLogger } from "@/lib/logger";

const log = createLogger("bins:move");

/** "Move everything out of this bin" (plan 0310, R4, Q2). The two older branches keep their raw body. */
const moveAllSchema = z.object({
  warehouseId: z.string().min(1, "warehouseId is required"),
  fromBinId: z.string().min(1, "Choose the bin to empty"),
  toBinId: z.string().min(1, "Choose the destination bin"),
  reason: z.string().trim().min(1, "Say why the items are moving"),
  all: z.literal(true),
});

/** A business refusal inside the move-all transaction; nothing is written, the route answers 400. */
class MoveAllRefused extends Error {}

/**
 * Empty one bin into another, in ONE transaction — what Move Out on the bin drawer does, and the
 * step the owner named before a delete ("they must move the items from the bin to another one").
 *
 * Coded units go through `placeUnitsInBin`, so the no-assembly rule (P6) and the recount of both
 * bins are the same as a single Relocate; one refused unit refuses the whole move. Whatever is
 * left after that is loose quantity of products that have never had a unit, moved by
 * decrement/increment like the bulk branch below. Every unit and every loose line gets its own
 * `BinMovementLog` row.
 */
async function moveEverything(userId: string, raw: unknown) {
  const { warehouseId, fromBinId, toBinId, reason } = moveAllSchema.parse(raw);
  if (fromBinId === toBinId) return errorResponse("Choose a different bin to move the items into", 400);

  const bins = await prisma.bin.findMany({
    where: { id: { in: [fromBinId, toBinId] } },
    select: { id: true, code: true, warehouseId: true, isActive: true },
  });
  const fromBin = bins.find((b) => b.id === fromBinId);
  const toBin = bins.find((b) => b.id === toBinId);
  if (!fromBin) return errorResponse("Source bin not found", 404);
  if (!toBin || !toBin.isActive) return errorResponse("Destination bin not found or not active", 404);
  if (fromBin.warehouseId !== warehouseId || toBin.warehouseId !== warehouseId) {
    return errorResponse(
      "Intra-warehouse Move is strictly within the same warehouse. Moving stock between different warehouses requires an inter-location Stock Transfer.",
      400
    );
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const units = await tx.inventoryUnit.findMany({
      where: { binId: fromBinId, status: { in: LIVE_UNIT_STATUSES } },
      select: { id: true, productId: true },
    });
    if (units.length > 0) {
      await placeUnitsInBin(tx, units.map((u) => u.id), toBinId);
      await tx.binMovementLog.createMany({
        data: units.map((u) => ({
          warehouseId,
          unitId: u.id,
          productId: u.productId,
          quantity: 1,
          fromBinId,
          toBinId,
          reason,
          movedById: userId,
        })),
      });
    }

    // What is still in the bin now is loose quantity of products with no units anywhere.
    const loose = [...(await getBinQtyMap(fromBinId, undefined, tx)).entries()].filter(([, q]) => q > 0);
    for (const [productId, qty] of loose) {
      await tx.binStock.update({
        where: { binId_productId: { binId: fromBinId, productId } },
        data: { quantity: { decrement: qty } },
      });
      await tx.binStock.upsert({
        where: { binId_productId: { binId: toBinId, productId } },
        update: { quantity: { increment: qty } },
        create: { binId: toBinId, productId, quantity: qty },
      });
    }
    if (loose.length > 0) {
      await tx.binMovementLog.createMany({
        data: loose.map(([productId, qty]) => ({
          warehouseId,
          productId,
          quantity: qty,
          fromBinId,
          toBinId,
          reason,
          movedById: userId,
        })),
      });
      await syncBinStock(tx, [fromBinId, toBinId]);
    }

    const looseMoved = loose.reduce((n, [, q]) => n + q, 0);
    if (units.length === 0 && looseMoved === 0) throw new MoveAllRefused(`Bin ${fromBin.code} is already empty`);
    return { unitsMoved: units.length, looseMoved };
  });

  log.info("bin emptied", {
    warehouseId,
    fromBinId,
    toBinId,
    unitsMoved: outcome.unitsMoved,
    looseMoved: outcome.looseMoved,
    userId,
  });
  return successResponse({ moved: true, ...outcome });
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("bins", "edit");
    const body = await req.json();
    if (body?.all === true) return await moveEverything(user.id, body);
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
    if (error instanceof MoveAllRefused) {
      log.warn("bin move-all refused", { message: error.message });
      return errorResponse(error.message, 400);
    }
    if (error instanceof z.ZodError) {
      log.warn("bin move-all refused: invalid body", { message: error.issues[0]?.message });
      return errorResponse(error.issues[0]?.message ?? "Invalid move", 400);
    }
    log.error("bin move failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to execute bin movement", 500);
  }
}
