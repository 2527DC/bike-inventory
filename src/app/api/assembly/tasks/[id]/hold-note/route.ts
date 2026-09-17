export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("assembly:hold-note");

const holdNoteSchema = z.object({
  note: z.string({ error: "Write a note" }).max(500, "Keep the note under 500 characters"),
});

/**
 * PUT — the supervisor's note on a held build (plan 1709, Q3). The mechanic adds nothing; the
 * supervisor writes what they agreed after talking to them. An empty note clears it.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("assembly", "approve");
    const { id } = await params;

    const parsed = holdNoteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      log.warn("hold note refused", { taskId: id, code: issue?.code });
      return errorResponse(issue?.message ?? "Invalid note", 400);
    }
    const note = parsed.data.note.trim() || null;

    const task = await prisma.assemblyTask.findUnique({
      where: { id },
      select: { id: true, status: true, holdNote: true, unit: { select: { unitCode: true } } },
    });
    if (!task) return errorResponse("Assembly task not found", 404);
    if (task.status === "COMPLETED" || task.status === "CANCELLED") {
      return errorResponse(`${task.unit.unitCode} is ${task.status.toLowerCase()} — its note can no longer change`, 400);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.assemblyTask.update({
        where: { id },
        data: { holdNote: note },
        select: { id: true, holdNote: true },
      });
      await logActivity(tx, {
        module: "assembly",
        action: "updated",
        entityType: "AssemblyTask",
        entityId: id,
        entityRef: task.unit.unitCode,
        fromValue: task.holdNote,
        toValue: note,
        details: note ? "Hold note updated" : "Hold note cleared",
        userId: user.id,
        userName: user.name,
      });
      return t;
    });

    log.info("hold note saved", { taskId: id, cleared: note === null });
    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("hold note save failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to save the note", 500);
  }
}
