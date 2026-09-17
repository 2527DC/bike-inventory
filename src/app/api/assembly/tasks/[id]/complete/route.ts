export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("assembly:complete");

const completeBodySchema = z.object({
  photoUrl: z.string().optional(),
  destinationBinId: z.string().optional(),
  frameNumber: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireFeature("assembly", "edit");
    const { id } = await params;
    const parsed = completeBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      log.warn("complete refused", { taskId: id, field: issue?.path.join("."), code: issue?.code });
      return errorResponse(issue?.message ?? "Invalid completion", 400);
    }
    const { photoUrl, destinationBinId, frameNumber, notes } = parsed.data;

    const task = await prisma.assemblyTask.findUnique({
      where: { id },
      include: {
        unit: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
        assignedTo: { select: { id: true, name: true } },
      },
    });

    if (!task) return errorResponse("Assembly task not found", 404);

    const isSupervisor = await userCan(user.id, "assembly", "approve");
    if (!isSupervisor && task.assignedToId !== user.id) {
      log.warn("complete refused", { taskId: id, reason: "not assignee", userId: user.id });
      return errorResponse("You can only complete tasks assigned to you", 403);
    }

    if (task.status === "COMPLETED") {
      return errorResponse("Task is already completed", 400);
    }

    // Calculate final hold seconds if it was ON_HOLD
    let finalHoldAdd = 0;
    if (task.status === "ON_HOLD" && task.holdStartedAt) {
      finalHoldAdd = Math.max(0, Math.round((Date.now() - new Date(task.holdStartedAt).getTime()) / 1000));
    }

    const completedAt = new Date();

    const result = await prisma.$transaction(async (tx) => {
      // 1. Mark AssemblyTask completed
      const updatedTask = await tx.assemblyTask.update({
        where: { id },
        data: {
          status: "COMPLETED",
          completedAt,
          photoUrl: photoUrl || task.photoUrl || null,
          notes: notes?.trim() || task.notes,
          holdStartedAt: null,
          totalHoldSeconds: { increment: finalHoldAdd },
        },
      });

      // 2. Update InventoryUnit
      const targetBinId = destinationBinId || task.unit.binId;
      await tx.inventoryUnit.update({
        where: { id: task.unitId },
        data: {
          status: "ASSEMBLED",
          assembledById: task.assignedToId,
          assembledAt: completedAt,
          assemblyLevel: task.level,
          frameNumber: frameNumber?.trim() || task.unit.frameNumber || null,
          binId: targetBinId,
        },
      });

      // 3. If relocated to a destination bin, log movement
      if (destinationBinId && destinationBinId !== task.unit.binId) {
        await tx.binMovementLog.create({
          data: {
            warehouseId: task.warehouseId,
            unitId: task.unitId,
            productId: task.unit.productId,
            quantity: 1,
            fromBinId: task.unit.binId,
            toBinId: destinationBinId,
            reason: `Assembled cycle moved to destination bin by ${task.assignedTo.name}`,
            movedById: user.id,
          },
        });
      }

      // 4. Backward-compatible earn-sync: Write AssemblyLog so mechanic payroll/incentives credit automatically
      await tx.assemblyLog.create({
        data: {
          mechanicId: task.assignedToId,
          assemblyType: task.level,
          bikeModel: task.unit.product.name,
          notes: `Build completed on Assembly Line (${task.unit.unitCode})`,
          photos: photoUrl ? [photoUrl] : [],
          createdAt: completedAt,
        },
      });

      // 5. Defect 5 (plan 1709): the build is recorded in the activity log too.
      await logActivity(tx, {
        module: "assembly",
        action: "status_changed",
        entityType: "AssemblyTask",
        entityId: id,
        entityRef: task.unit.unitCode,
        fromValue: task.status,
        toValue: "COMPLETED",
        details: `Build completed by ${task.assignedTo.name}${destinationBinId && destinationBinId !== task.unit.binId ? " and moved to a destination bin" : ""}`,
        userId: user.id,
        userName: user.name,
      });

      return updatedTask;
    });

    log.info("build completed", { taskId: id, unitId: task.unitId, mechanicId: task.assignedToId, holdSeconds: result.totalHoldSeconds });
    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("complete failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to complete assembly task", 500);
  }
}
