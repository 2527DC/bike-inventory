export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { binDeleteBlockers, binDeleteRefusal } from "@/lib/bins/delete-check";

const log = createLogger("bins:detail");

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("bins", "edit");
    const { id } = await params;
    const body = await req.json();

    const bin = await prisma.bin.findUnique({ where: { id } });
    if (!bin) return errorResponse("Bin not found", 404);

    // ── THE NON-ASSEMBLABLE FLAG IS FIXED AT CREATION (R42, P6a) ──
    //
    // Flipping it would leave the units already inside stamped for a rule the bin no longer
    // states — an assemblable cycle sitting in a bin the build line skips, or a spare suddenly
    // on Awaiting. To change it, create a bin with the right flag and move the items (which
    // `placeUnitsInBin` still checks). Sending the value it already has is not a change.
    if (body.nonAssemblable !== undefined && Boolean(body.nonAssemblable) !== bin.nonAssemblable) {
      return errorResponse(
        `Whether bin ${bin.code} holds items that need assembly is set when the bin is created and cannot be changed. Create a new bin with the right setting and move the items into it.`,
        400
      );
    }

    // ── DELETE IS THE ONE WAY TO RETIRE A BIN (plan 0310, Q11) ──
    //
    // The edit form's Active checkbox used to write `isActive` straight through, so a bin holding
    // bikes could be hidden with no check at all. That checkbox is gone; DELETE runs the emptiness
    // check. Sending `true` (what a stale form sends) is not a change and is ignored.
    if (body.isActive === false && bin.isActive) {
      log.warn("bin deactivate via edit refused", { binId: id, code: bin.code });
      return errorResponse(`To retire bin ${bin.code}, use Delete on the bin.`, 400);
    }

    const updateData: Record<string, unknown> = {};
    if (body.code !== undefined) {
      const code = String(body.code).trim().toUpperCase();
      if (!code) return errorResponse("Bin code cannot be empty", 400);
      if (code !== bin.code) {
        const conflict = await prisma.bin.findFirst({
          where: {
            warehouseId: bin.warehouseId,
            code,
            id: { not: id },
          },
          select: { isActive: true },
        });
        if (conflict) {
          // A deleted bin keeps its row (soft delete), so its code is still taken here. Creating
          // that code with New Bin brings the row back (Q3); renaming onto it would not.
          return errorResponse(
            conflict.isActive
              ? `Bin code "${code}" already exists in this warehouse`
              : `Bin code "${code}" belonged to a deleted bin. Create ${code} with New Bin to bring it back, or pick another code.`,
            409
          );
        }
        updateData.code = code;
      }
    }
    if (body.name !== undefined) updateData.name = String(body.name).trim();
    if (body.directions !== undefined) updateData.directions = body.directions ? String(body.directions).trim() : null;
    if (body.floor !== undefined) updateData.floor = body.floor ? String(body.floor).trim() : null;
    if (body.zone !== undefined) updateData.zone = body.zone ? String(body.zone).trim() : null;
    if (body.location !== undefined) updateData.location = body.location ? String(body.location).trim() : null;
    if (body.capacity !== undefined) updateData.capacity = body.capacity !== null && body.capacity !== "" ? Number(body.capacity) : null;
    if (body.isAssemblyArea !== undefined) updateData.isAssemblyArea = Boolean(body.isAssemblyArea);

    const updated = await prisma.bin.update({
      where: { id },
      data: updateData,
      include: {
        warehouse: { select: { id: true, name: true, code: true, kind: true } },
      },
    });
    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("bin update failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to update bin", 400);
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return PATCH(req, ctx);
}

/** Thrown inside the delete transaction so nothing is written; the route answers 409 with it. */
class BinNotEmpty extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BinNotEmpty";
  }
}

/**
 * Delete a bin — plan 0310-bin-delete-multi-category-rules-and-transfer-directions, Part A (R1–R3).
 *
 * Refused while the bin holds anything (`binDeleteBlockers`: live units, loose quantity,
 * second-hand cycles in stock, an unfinished audit). Otherwise, in ONE transaction, its home-bin
 * rules are deleted and products that named it as their default bin are cleared (owner, Q1), and
 * the bin is retired.
 *
 * Still a SOFT delete (`isActive: false`): `BinMovementLog` rows point at the bin and must keep
 * reading as "moved from A1". The code stays on the row; `POST /api/bins` with the same code
 * brings it back (Q3).
 *
 * The check runs inside the transaction so it reads the same snapshot the writes commit against.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let binId: string | undefined;
  try {
    const user = await requireFeature("bins", "delete");
    const { id } = await params;
    binId = id;

    const bin = await prisma.bin.findUnique({
      where: { id },
      select: { id: true, code: true, warehouseId: true, isActive: true },
    });
    if (!bin) return errorResponse("Bin not found", 404);
    if (!bin.isActive) return errorResponse(`Bin ${bin.code} is already deleted`, 404);

    const outcome = await prisma.$transaction(async (tx) => {
      const blockers = await binDeleteBlockers(tx, id);
      if (!blockers.empty) {
        log.warn("bin delete refused", {
          binId: id,
          code: bin.code,
          items: blockers.items,
          secondHand: blockers.secondHand,
          openAudits: blockers.openAudits.map((a) => a.countNo ?? a.id),
        });
        throw new BinNotEmpty(binDeleteRefusal(bin.code, blockers));
      }

      const rules = await tx.homeBinRule.deleteMany({ where: { binId: id } });
      const products = await tx.product.updateMany({ where: { binId: id }, data: { binId: null } });
      await tx.bin.update({ where: { id }, data: { isActive: false } });
      return { rulesRemoved: rules.count, productsCleared: products.count };
    });

    log.info("bin deleted", {
      binId: id,
      code: bin.code,
      warehouseId: bin.warehouseId,
      rulesRemoved: outcome.rulesRemoved,
      productsCleared: outcome.productsCleared,
      userId: user.id,
    });
    return successResponse({ deleted: true, ...outcome });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof BinNotEmpty) return errorResponse(error.message, 409);
    log.error("bin delete failed", { binId, message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to delete bin", 400);
  }
}

