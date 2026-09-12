export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import type { AssemblyLevel } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const user = await requireFeature("assembly", "view");
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouseId");
    const status = searchParams.get("status");
    const level = searchParams.get("level") as AssemblyLevel | null;

    const isSupervisor = await userCan(user.id, "assembly", "approve");

    const where: Record<string, unknown> = {};
    if (!isSupervisor) {
      where.assignedToId = user.id;
    }
    if (warehouseId) where.warehouseId = warehouseId;
    if (status) where.status = status;
    if (level) where.level = level;

    const [tasks, pendingUnits, mechanics] = await Promise.all([
      prisma.assemblyTask.findMany({
        where,
        include: {
          unit: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  brand: { select: { id: true, name: true } },
                  category: { select: { id: true, name: true } },
                },
              },
              bin: { select: { id: true, code: true, name: true, directions: true } },
            },
          },
          warehouse: { select: { id: true, name: true, code: true, kind: true } },
          assignedTo: { select: { id: true, name: true, email: true } },
          assignedBy: { select: { id: true, name: true } },
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      }),
      // For supervisors: also return unassembled bicycles available to be assigned
      isSupervisor
        ? prisma.inventoryUnit.findMany({
            where: {
              ...(warehouseId ? { warehouseId } : {}),
              assembledAt: null,
              status: { in: ["RECEIVED", "PUT_AWAY"] },
              assemblyTasks: { none: { status: { in: ["PENDING", "IN_PROGRESS", "ON_HOLD"] } } },
            },
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  brand: { select: { id: true, name: true } },
                  category: { select: { id: true, name: true } },
                },
              },
              bin: { select: { id: true, code: true, name: true, directions: true } },
              warehouse: { select: { id: true, name: true, code: true } },
            },
            take: 100,
            orderBy: { unitCode: "asc" },
          })
        : Promise.resolve([]),
      // Active mechanics list for assignment
      isSupervisor
        ? prisma.user.findMany({
            where: { isActive: true },
            select: { id: true, name: true, email: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
    ]);

    return successResponse({
      tasks,
      pendingUnits,
      mechanics,
      isSupervisor,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch assembly tasks", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("assembly", "approve");
    const body = await req.json();
    const { unitId, assignedToId, level = "A85", notes } = body;

    if (!unitId || !assignedToId) {
      return errorResponse("unitId and assignedToId are required", 400);
    }

    const unit = await prisma.inventoryUnit.findUnique({
      where: { id: unitId },
      include: {
        warehouse: true,
        bin: true,
      },
    });

    if (!unit) return errorResponse("Unit not found", 404);
    if (unit.assembledAt) {
      return errorResponse(`Unit ${unit.unitCode} is already assembled`, 400);
    }

    // Check if unit is already in active assembly task
    const activeTask = await prisma.assemblyTask.findFirst({
      where: {
        unitId,
        status: { in: ["PENDING", "IN_PROGRESS", "ON_HOLD"] },
      },
    });
    if (activeTask) {
      return errorResponse(`Unit ${unit.unitCode} already has an active task (${activeTask.status})`, 400);
    }

    const warehouseId = unit.warehouseId;

    // Find the assembly bin in this warehouse (isAssemblyArea = true)
    let asmBin = await prisma.bin.findFirst({
      where: { warehouseId, isAssemblyArea: true, isActive: true },
    });

    // If no assembly area bin configured, check for bin with code "ASM"
    if (!asmBin) {
      asmBin = await prisma.bin.findFirst({
        where: { warehouseId, code: "ASM", isActive: true },
      });
    }

    // If still not found, create a default ASM bin for this warehouse
    if (!asmBin) {
      asmBin = await prisma.bin.create({
        data: {
          code: "ASM",
          name: "Assembly Staging Area",
          warehouseId,
          directions: "Workshop assembly build floor",
          isAssemblyArea: true,
        },
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create AssemblyTask
      const task = await tx.assemblyTask.create({
        data: {
          unitId,
          warehouseId,
          level: level as AssemblyLevel,
          status: "PENDING",
          assignedToId,
          assignedById: user.id,
          notes: notes?.trim() || null,
        },
        include: {
          unit: { include: { product: true } },
          assignedTo: { select: { id: true, name: true } },
        },
      });

      // 2. Auto-move unit to the assembly staging bin
      const oldBinId = unit.binId;
      await tx.inventoryUnit.update({
        where: { id: unitId },
        data: {
          binId: asmBin.id,
          status: "ASSIGNED",
        },
      });

      // 3. Log movement
      await tx.binMovementLog.create({
        data: {
          warehouseId,
          unitId,
          productId: unit.productId,
          quantity: 1,
          fromBinId: oldBinId,
          toBinId: asmBin.id,
          reason: `Moved by assembly assignment to ${task.assignedTo.name} (${level})`,
          movedById: user.id,
        },
      });

      return task;
    });

    return successResponse(result, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to assign assembly task", 500);
  }
}
