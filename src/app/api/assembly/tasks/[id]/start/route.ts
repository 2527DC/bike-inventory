export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireFeature("assembly", "edit");
    const { id } = await params;

    const task = await prisma.assemblyTask.findUnique({
      where: { id },
      include: { unit: true },
    });

    if (!task) return errorResponse("Assembly task not found", 404);

    const isSupervisor = await userCan(user.id, "assembly", "approve");
    if (!isSupervisor && task.assignedToId !== user.id) {
      return errorResponse("You can only start tasks assigned to you", 403);
    }

    if (task.status === "COMPLETED") {
      return errorResponse("Task is already completed", 400);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.assemblyTask.update({
        where: { id },
        data: {
          status: "IN_PROGRESS",
          startedAt: task.startedAt || new Date(),
        },
      });

      await tx.inventoryUnit.update({
        where: { id: task.unitId },
        data: { status: "IN_ASSEMBLY" },
      });

      return t;
    });

    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to start assembly task", 500);
  }
}
