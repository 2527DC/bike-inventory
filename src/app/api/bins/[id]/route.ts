export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("settings", "edit");
    const { id } = await params;
    const body = await req.json();

    const bin = await prisma.bin.findUnique({ where: { id } });
    if (!bin) return errorResponse("Bin not found", 404);

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.location !== undefined) updateData.location = body.location;
    if (body.zone !== undefined) updateData.zone = body.zone;

    const updated = await prisma.bin.update({ where: { id }, data: updateData });
    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update bin", 400);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("settings", "delete");
    const { id } = await params;

    const bin = await prisma.bin.findUnique({
      where: { id },
      include: { _count: { select: { products: true, serialItems: true } } },
    });

    if (!bin) return errorResponse("Bin not found", 404);

    if (bin._count.products > 0 || bin._count.serialItems > 0) {
      return errorResponse(
        `Cannot delete bin "${bin.code}" — it has ${bin._count.products} products assigned. Reassign them first.`,
        400
      );
    }

    // Soft-delete to preserve historical references
    await prisma.bin.update({ where: { id }, data: { isActive: false } });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to delete bin", 400);
  }
}
