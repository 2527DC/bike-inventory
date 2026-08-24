// Rename, revoke, or restore a counting device.
//
// There is no DELETE. Revocation is `isActive = false`, because a device's counted history
// has to survive it — the FK from count_events is onDelete: SetNull, so a hard delete would
// orphan every crossing that device ever reported (database-architect: soft delete over hard
// delete for business entities).

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { analyticsDeviceUpdateSchema } from "@/lib/validations";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("analytics", "edit");
    const { id } = await params;

    const body = await req.json().catch(() => null);
    const parsed = analyticsDeviceUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid update", 400);
    }

    const device = await prisma.analyticsDevice.update({
      where: { id },
      data: parsed.data,
      select: {
        id: true,
        label: true,
        storeId: true,
        agentId: true,
        isActive: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });

    return successResponse(device);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return errorResponse("Device not found", 404);
    }
    console.error("analytics device update failed", error);
    return errorResponse("Failed to update device", 500);
  }
}
