export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";
import type { HoldIssue } from "@prisma/client";

const log = createLogger("assembly:hold");

/**
 * The one-tap hold (plan 1709, R3–R6). Exactly two issues; no reason text, no confirm.
 * A mis-tap is undone by RESUME (Q4).
 */
const holdBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("HOLD"),
    issue: z.enum(["CYCLE", "WORKFLOOR"], { error: "Choose Issue with the cycle or Issue on the workfloor" }),
  }),
  z.object({ action: z.literal("RESUME") }),
]);

const HOLD_ISSUE_LABEL: Record<HoldIssue, string> = {
  CYCLE: "Issue with the cycle",
  WORKFLOOR: "Issue on the workfloor",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("assembly", "edit");
    const { id } = await params;

    const parsed = holdBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      log.warn("hold refused", { taskId: id, field: issue?.path.join("."), code: issue?.code });
      return errorResponse(issue?.message ?? "Invalid action. Must be 'HOLD' or 'RESUME'", 400);
    }
    const body = parsed.data;

    const task = await prisma.assemblyTask.findUnique({
      where: { id },
      include: { unit: { select: { unitCode: true } } },
    });
    if (!task) return errorResponse("Assembly task not found", 404);

    const isSupervisor = await userCan(user.id, "assembly", "approve");
    if (!isSupervisor && task.assignedToId !== user.id) {
      log.warn("hold refused", { taskId: id, reason: "not assignee", userId: user.id });
      return errorResponse("You can only hold/resume tasks assigned to you", 403);
    }
    if (task.status === "COMPLETED") return errorResponse("Task is already completed", 400);

    if (body.action === "HOLD") {
      // Only a running build can be held: holding a PENDING task would later "resume" it with
      // no start time, and re-holding an ON_HOLD one would reset its hold clock.
      if (task.status !== "IN_PROGRESS") {
        log.warn("hold refused", { taskId: id, reason: "not in progress", status: task.status });
        return errorResponse(
          task.status === "ON_HOLD" ? `${task.unit.unitCode} is already on hold` : "Start the build before putting it on hold",
          409
        );
      }

      const updated = await prisma.$transaction(async (tx) => {
        // Claim on status, so a double tap from two devices writes once.
        const claimed = await tx.assemblyTask.updateMany({
          where: { id, status: "IN_PROGRESS" },
          data: { status: "ON_HOLD", holdStartedAt: new Date(), holdIssue: body.issue, holdNote: null },
        });
        if (claimed.count === 0) return null;
        await logActivity(tx, {
          module: "assembly",
          action: "status_changed",
          entityType: "AssemblyTask",
          entityId: id,
          entityRef: task.unit.unitCode,
          fromValue: "IN_PROGRESS",
          toValue: "ON_HOLD",
          details: `On hold — ${HOLD_ISSUE_LABEL[body.issue]}`,
          userId: user.id,
          userName: user.name,
        });
        return tx.assemblyTask.findUnique({ where: { id } });
      });
      if (!updated) return errorResponse(`${task.unit.unitCode} changed meanwhile — reload`, 409);

      log.info("build put on hold", { taskId: id, unitId: task.unitId, issue: body.issue });
      return successResponse(updated);
    }

    // RESUME
    if (task.status !== "ON_HOLD") {
      log.warn("resume refused", { taskId: id, reason: "not on hold", status: task.status });
      return errorResponse(`${task.unit.unitCode} is not on hold`, 409);
    }
    const addSeconds = task.holdStartedAt
      ? Math.max(0, Math.round((Date.now() - new Date(task.holdStartedAt).getTime()) / 1000))
      : 0;

    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.assemblyTask.updateMany({
        where: { id, status: "ON_HOLD" },
        // holdIssue / holdNote stay: they describe the last hold. The next HOLD replaces them.
        data: { status: "IN_PROGRESS", holdStartedAt: null, totalHoldSeconds: { increment: addSeconds } },
      });
      if (claimed.count === 0) return null;
      await logActivity(tx, {
        module: "assembly",
        action: "status_changed",
        entityType: "AssemblyTask",
        entityId: id,
        entityRef: task.unit.unitCode,
        fromValue: "ON_HOLD",
        toValue: "IN_PROGRESS",
        details: `Resumed after ${Math.round(addSeconds / 60)} min on hold${task.holdIssue ? ` (${HOLD_ISSUE_LABEL[task.holdIssue]})` : ""}`,
        userId: user.id,
        userName: user.name,
      });
      return tx.assemblyTask.findUnique({ where: { id } });
    });
    if (!updated) return errorResponse(`${task.unit.unitCode} changed meanwhile — reload`, 409);

    log.info("build resumed", { taskId: id, unitId: task.unitId, heldSeconds: addSeconds });
    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("hold/resume failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to toggle hold status", 500);
  }
}
