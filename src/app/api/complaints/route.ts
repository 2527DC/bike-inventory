export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { complaintCreateSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { nextComplaintTicket } from "@/lib/sequence";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("complaints");

export async function GET(req: NextRequest) {
  try {
    await requireFeature("complaints", "view");
    const { page, limit, skip, searchParams } = parseSearchParams(req.url);

    const status = searchParams.get("status") || undefined;
    const isFault = searchParams.get("isAssemblyFault");
    const mechanicId = searchParams.get("mechanicId") || undefined;
    const search = searchParams.get("search")?.trim() || undefined;

    const where: Record<string, unknown> = {
      ...(status && { status }),
      ...(isFault !== null && isFault !== undefined && isFault !== ""
        ? { isAssemblyFault: isFault === "true" }
        : {}),
      ...(mechanicId && {
        OR: [
          { faultMechanicId: mechanicId },
          { unit: { assembledById: mechanicId } },
        ],
      }),
      ...(search && {
        OR: [
          { ticketNo: { contains: search, mode: "insensitive" } },
          { customerName: { contains: search, mode: "insensitive" } },
          { customerPhone: { contains: search, mode: "insensitive" } },
          { unit: { unitCode: { contains: search, mode: "insensitive" } } },
          { unit: { product: { name: { contains: search, mode: "insensitive" } } } },
        ],
      }),
    };

    const [complaints, total] = await Promise.all([
      prisma.complaint.findMany({
        where,
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
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.complaint.count({ where }),
    ]);

    return paginatedResponse(complaints, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch complaints", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("complaints", "create");
    const body = await req.json();
    const data = complaintCreateSchema.parse(body);

    const unit = await prisma.inventoryUnit.findFirst({
      where: {
        unitCode: { equals: data.unitCode.trim(), mode: "insensitive" },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            brand: { select: { name: true } },
          },
        },
        assembledBy: { select: { id: true, name: true } },
      },
    });

    if (!unit) {
      return errorResponse(`No bicycle found with unit code "${data.unitCode}". Check the sticker on the frame.`, 404);
    }

    const complaint = await prisma.$transaction(async (tx) => {
      const ticketNo = await nextComplaintTicket(tx);

      const created = await tx.complaint.create({
        data: {
          ticketNo,
          unitId: unit.id,
          customerName: data.customerName.trim(),
          customerPhone: data.customerPhone.trim(),
          description: data.description.trim(),
          photoUrl: data.photoUrl || null,
          status: "OPEN",
          isAssemblyFault: false,
        },
        include: {
          unit: {
            include: {
              product: {
                select: {
                  name: true,
                  sku: true,
                  brand: { select: { name: true } },
                },
              },
              assembledBy: { select: { id: true, name: true } },
            },
          },
        },
      });

      await logActivity(tx, {
        module: "complaints",
        action: "created",
        entityType: "Complaint",
        entityId: created.id,
        entityRef: created.ticketNo,
        toValue: "OPEN",
        details: `Ticket ${ticketNo} logged for unit ${unit.unitCode} (${unit.product.name}) - Customer: ${created.customerName}`,
        userId: user.id,
        userName: user.name,
      });

      return created;
    });

    log.info("complaint created", {
      ticketNo: complaint.ticketNo,
      unitCode: unit.unitCode,
      customer: complaint.customerName,
    });

    return successResponse(complaint, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create complaint", 400);
  }
}
