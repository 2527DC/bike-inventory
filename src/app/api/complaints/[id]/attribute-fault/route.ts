export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { complaintAttributeSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("complaints:attribute-fault");

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("complaints", "approve");
    const { id } = await params;
    const body = await req.json();
    const data = complaintAttributeSchema.parse(body);

    const existing = await prisma.complaint.findUnique({
      where: { id },
      include: {
        unit: {
          include: {
            assembledBy: { select: { id: true, name: true } },
            product: { select: { name: true } },
          },
        },
      },
    });

    if (!existing) return errorResponse("Complaint not found", 404);

    let faultMechanicId: string | null = null;
    if (data.isAssemblyFault) {
      faultMechanicId = data.faultMechanicId || existing.unit.assembledById || null;
      if (!faultMechanicId) {
        return errorResponse("No mechanic found on this bicycle's assembly record. Please select the responsible mechanic manually.", 400);
      }

      const mechanic = await prisma.user.findUnique({
        where: { id: faultMechanicId },
        select: { id: true, name: true, isActive: true },
      });
      if (!mechanic) return errorResponse("Selected mechanic does not exist", 400);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.complaint.update({
        where: { id },
        data: {
          isAssemblyFault: data.isAssemblyFault,
          faultMechanicId: data.isAssemblyFault ? faultMechanicId : null,
          attributedById: user.id,
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

      await logActivity(tx, {
        module: "complaints",
        action: "attribute_fault",
        entityType: "Complaint",
        entityId: id,
        entityRef: existing.ticketNo,
        toValue: data.isAssemblyFault ? "ASSEMBLY_FAULT" : "NOT_FAULT",
        details: data.isAssemblyFault
          ? `Complaint ${existing.ticketNo} attributed to assembly fault by ${row.faultMechanic?.name ?? "mechanic"}. Verified by ${user.name}`
          : `Complaint ${existing.ticketNo} marked as NOT an assembly fault by ${user.name}`,
        userId: user.id,
        userName: user.name,
      });

      return row;
    });

    log.info("complaint fault attributed", {
      id,
      ticketNo: updated.ticketNo,
      isAssemblyFault: updated.isAssemblyFault,
      faultMechanicId: updated.faultMechanicId,
    });

    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to attribute fault", 400);
  }
}
