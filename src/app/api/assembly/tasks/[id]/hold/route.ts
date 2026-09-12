export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireFeature("assembly", "edit");
    const { id } = await params;
    const body = await req.json();
    const { action, reason } = body; // action: "HOLD" | "RESUME"

    const task = await prisma.assemblyTask.findUnique({
      where: { id },
      include: { unit: true },
    });

    if (!task) return errorResponse("Assembly task not found", 404);

    const isSupervisor = await userCan(user.id, "assembly", "approve");
    if (!isSupervisor && task.assignedToId !== user.id) {
      return errorResponse("You can only hold/resume tasks assigned to you", 403);
    }

    if (task.status === "COMPLETED") {
      return errorResponse("Task is already completed", 400);
    }

    if (action === "HOLD") {
      if (!reason?.trim()) {
        return errorResponse("Reason is required when placing an assembly task on hold", 400);
      }

      const updated = await prisma.assemblyTask.update({
        where: { id },
        data: {
          status: "ON_HOLD",
          holdStartedAt: new Date(),
          holdReason: reason.trim(),
        },
      });
      return successResponse(updated);
    }

    if (action === "RESUME") {
      let addSeconds = 0;
      if (task.holdStartedAt) {
        addSeconds = Math.max(0, Math.round((Date.now() - new Date(task.holdStartedAt).getTime()) / 1000));
      }

      const updated = await prisma.assemblyTask.update({
        where: { id },
        data: {
          status: "IN_PROGRESS",
          holdStartedAt: null,
          totalHoldSeconds: { increment: addSeconds },
        },
      });
      return successResponse(updated);
    }

    return errorResponse("Invalid action. Must be 'HOLD' or 'RESUME'", 400);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to toggle hold status", 500);
  }
}
