export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("complaints:id");

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("complaints", "view");
    const { id } = await params;

    const complaint = await prisma.complaint.findUnique({
      where: { id },
      include: {
        unit: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                brand: { select: { name: true } },
                category: { select: { name: true } },
              },
            },
            warehouse: { select: { id: true, name: true } },
            bin: { select: { id: true, code: true, name: true } },
            assembledBy: { select: { id: true, name: true, email: true } },
          },
        },
        faultMechanic: { select: { id: true, name: true, email: true } },
        attributedBy: { select: { id: true, name: true } },
      },
    });

    if (!complaint) return errorResponse("Complaint not found", 404);

    return successResponse(complaint);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch complaint", 500);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("complaints", "edit");
    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.complaint.findUnique({ where: { id } });
    if (!existing) return errorResponse("Complaint not found", 404);

    const validStatuses = ["OPEN", "RESOLVED", "DISMISSED"];
    if (body.status && !validStatuses.includes(body.status)) {
      return errorResponse(`Invalid status: ${body.status}. Must be OPEN, RESOLVED, or DISMISSED`, 400);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.complaint.update({
        where: { id },
        data: {
          ...(body.status && { status: body.status }),
          ...(body.description && { description: body.description.trim() }),
          ...(body.photoUrl !== undefined && { photoUrl: body.photoUrl }),
        },
        include: {
          unit: {
            include: {
              product: { select: { name: true } },
              assembledBy: { select: { id: true, name: true } },
            },
          },
          faultMechanic: { select: { id: true, name: true } },
          attributedBy: { select: { id: true, name: true } },
        },
      });

      if (body.status && body.status !== existing.status) {
        await logActivity(tx, {
          module: "complaints",
          action: "status_changed",
          entityType: "Complaint",
          entityId: id,
          entityRef: existing.ticketNo,
          fromValue: existing.status,
          toValue: body.status,
          details: `Complaint ${existing.ticketNo} status changed to ${body.status}`,
          userId: user.id,
          userName: user.name,
        });
      }

      return row;
    });

    log.info("complaint updated", { id, status: updated.status });
    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update complaint", 400);
  }
}
