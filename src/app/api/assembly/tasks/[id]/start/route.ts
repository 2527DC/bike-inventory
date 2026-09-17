export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("assembly:start");

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
      log.warn("start refused", { taskId: id, reason: "not assignee", userId: user.id });
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

      // Defect 5 (plan 1709): assembly wrote no activity log, so builds per day could not be
      // counted from history.
      await logActivity(tx, {
        module: "assembly",
        action: "status_changed",
        entityType: "AssemblyTask",
        entityId: id,
        entityRef: task.unit.unitCode,
        fromValue: task.status,
        toValue: "IN_PROGRESS",
        details: "Build started",
        userId: user.id,
        userName: user.name,
      });

      return t;
    });

    log.info("build started", { taskId: id, unitId: task.unitId });
    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("start failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to start assembly task", 500);
  }
}
