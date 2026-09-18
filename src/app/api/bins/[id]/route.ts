export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

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
        });
        if (conflict) {
          return errorResponse(`Bin code "${code}" already exists in this warehouse`, 409);
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
    if (body.isActive !== undefined) updateData.isActive = Boolean(body.isActive);

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

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("bins", "delete");
    const { id } = await params;

    const bin = await prisma.bin.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            products: true,
            binStocks: true,
            units: true,
          },
        },
      },
    });

    if (!bin) return errorResponse("Bin not found", 404);

    const totalOccupants = (bin._count.binStocks || 0) + (bin._count.units || 0) + (bin._count.products || 0);
    if (totalOccupants > 0) {
      return errorResponse(
        `Cannot delete bin "${bin.code}" — it has ${totalOccupants} active inventory items. Move them to another bin first.`,
        400
      );
    }

    // Soft-delete to preserve historical movement logs
    await prisma.bin.update({ where: { id }, data: { isActive: false } });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("bin delete failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to delete bin", 400);
  }
}

