export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { assemblyTaskCreateSchema } from "@/lib/validations";
import { assemblyLevelLabel } from "@/lib/assembly-level";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";
import type { AssemblyLevel, Prisma } from "@prisma/client";

const log = createLogger("assembly:tasks");

/** Rows per page of the "Awaiting Assignment" list. */
const PENDING_PAGE_SIZE = 50;

/**
 * GET — the /assembly screen's data.
 *
 * Response keys (kept stable — `my-assembly-tasks.tsx` reads `tasks`):
 *   tasks, pendingUnits, mechanics, isSupervisor,
 *   pendingTotal, pendingPage, pendingPageSize, pendingHasMore
 *
 * `?q=` searches the awaiting-assignment list and `?pendingPage=` pages it (plan 1509, B5).
 * It used to be a silent `take: 100`: the 101st bicycle simply did not exist on screen, and
 * nothing said so. `?only=pending` returns just that list, so typing in the search box does
 * not re-read every task and every user on each keystroke.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireFeature("assembly", "view");
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouseId");
    const status = searchParams.get("status");
    const level = searchParams.get("level") as AssemblyLevel | null;
    const mine = searchParams.get("mine") === "1";
    const onlyPending = searchParams.get("only") === "pending";
    const q = (searchParams.get("q") ?? "").trim();
    const pendingPage = Math.max(1, parseInt(searchParams.get("pendingPage") ?? "1", 10) || 1);

    const isSupervisor = await userCan(user.id, "assembly", "approve");
    const returnSupervisorData = isSupervisor && !mine;

    const where: Record<string, unknown> = {};
    if (!isSupervisor || mine) {
      where.assignedToId = user.id;
    }
    if (warehouseId) where.warehouseId = warehouseId;
    if (status) where.status = status;
    if (level) where.level = level;

    // Unassembled bicycles nobody is building yet. The search covers every identifier a person
    // at the rack might read off a carton or a label.
    const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
    const pendingWhere: Prisma.InventoryUnitWhereInput = {
      ...(warehouseId ? { warehouseId } : {}),
      assembledAt: null,
      status: { in: ["RECEIVED", "PUT_AWAY"] },
      assemblyTasks: { none: { status: { in: ["PENDING", "IN_PROGRESS", "ON_HOLD"] } } },
      ...(q
        ? {
            OR: [
              { unitCode: contains(q) },
              { frameNumber: contains(q) },
              { product: { is: { name: contains(q) } } },
              { product: { is: { sku: contains(q) } } },
              { product: { is: { brand: { is: { name: contains(q) } } } } },
              { bin: { is: { code: contains(q) } } },
              { warehouse: { is: { name: contains(q) } } },
              { warehouse: { is: { code: contains(q) } } },
            ],
          }
        : {}),
    };

    const productSelect = {
      id: true,
      name: true,
      sku: true,
      assemblyLevel: true,
      brand: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
    } as const;

    const [tasks, pendingUnits, pendingTotal, mechanics] = await Promise.all([
      onlyPending
        ? Promise.resolve([])
        : prisma.assemblyTask.findMany({
            where,
            include: {
              unit: {
                include: {
                  product: { select: productSelect },
                  bin: { select: { id: true, code: true, name: true, directions: true } },
                },
              },
              warehouse: { select: { id: true, name: true, code: true, kind: true } },
              assignedTo: { select: { id: true, name: true, email: true } },
              assignedBy: { select: { id: true, name: true } },
            },
            orderBy: [{ status: "asc" }, { createdAt: "desc" }],
          }),
      returnSupervisorData
        ? prisma.inventoryUnit.findMany({
            where: pendingWhere,
            include: {
              product: { select: productSelect },
              bin: { select: { id: true, code: true, name: true, directions: true } },
              warehouse: { select: { id: true, name: true, code: true } },
            },
            orderBy: { unitCode: "asc" },
            skip: (pendingPage - 1) * PENDING_PAGE_SIZE,
            take: PENDING_PAGE_SIZE,
          })
        : Promise.resolve([]),
      returnSupervisorData ? prisma.inventoryUnit.count({ where: pendingWhere }) : Promise.resolve(0),
      // Active users for the mechanic picker
      returnSupervisorData && !onlyPending
        ? prisma.user.findMany({
            where: { isActive: true },
            select: { id: true, name: true, email: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
    ]);

    log.debug("assembly data read", {
      tasks: tasks.length,
      pending: pendingUnits.length,
      pendingTotal,
      pendingPage,
      searched: q.length > 0,
    });

    return successResponse({
      tasks,
      pendingUnits,
      mechanics,
      isSupervisor,
      pendingTotal,
      pendingPage,
      pendingPageSize: PENDING_PAGE_SIZE,
      pendingHasMore: pendingPage * PENDING_PAGE_SIZE < pendingTotal,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("assembly data read failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch assembly tasks", 500);
  }
}

/**
 * POST — assign a bicycle to a mechanic.
 *
 * The level is the PRODUCT's (plan 1509, D3/D4). A product that already has
 * `Product.assemblyLevel` is assigned at it and any level in the body is ignored — there is no
 * per-bicycle override. A product with none must send one, and it is saved to the product in
 * the same transaction, so the next bicycle of that product is never asked. Before this the
 * body was destructured raw with a silent `level = "A85"` default, so a missing level quietly
 * became 85%.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("assembly", "approve");

    const parsed = assemblyTaskCreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      log.warn("assignment refused", { field: issue?.path.join("."), code: issue?.code });
      return errorResponse(issue?.message ?? "Invalid assignment", 400);
    }
    const { unitId, assignedToId, level: sentLevel, notes } = parsed.data;

    const unit = await prisma.inventoryUnit.findUnique({
      where: { id: unitId },
      include: {
        warehouse: true,
        bin: true,
        product: { select: { id: true, name: true, sku: true, assemblyLevel: true } },
      },
    });

    if (!unit) return errorResponse("Unit not found", 404);
    if (unit.assembledAt) {
      return errorResponse(`Unit ${unit.unitCode} is already assembled`, 400);
    }

    // The picker lists active users; a stale screen could still send a deactivated one.
    const assignee = await prisma.user.findUnique({
      where: { id: assignedToId },
      select: { id: true, isActive: true },
    });
    if (!assignee || !assignee.isActive) {
      log.warn("assignment refused", { reason: "assignee not active", unitId, assignedToId });
      return errorResponse("That mechanic is not an active user — pick another", 400);
    }

    // Level resolution happens before any write, so a refusal changes nothing.
    const productLevel = unit.product.assemblyLevel;
    if (!productLevel && !sentLevel) {
      log.warn("assignment refused", { reason: "level missing", unitId, productId: unit.product.id });
      return errorResponse(
        `Choose the assembly condition level for ${unit.product.name} — it is saved to the product and not asked again`,
        400
      );
    }
    if (productLevel && sentLevel && sentLevel !== productLevel) {
      log.debug("sent level ignored — product level wins", {
        unitId,
        productId: unit.product.id,
        productLevel,
        sentLevel,
      });
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
      // 0. The product's one level (D3). `updateMany` on `assemblyLevel: null` so two people
      //    assigning the same unset product at once cannot overwrite each other: the second
      //    write matches nothing, and that assignment takes whatever the first one saved.
      let level: AssemblyLevel;
      let levelSource: "product" | "saved-now";
      if (productLevel) {
        level = productLevel;
        levelSource = "product";
      } else {
        const saved = await tx.product.updateMany({
          where: { id: unit.product.id, assemblyLevel: null },
          data: { assemblyLevel: sentLevel! },
        });
        if (saved.count === 1) {
          level = sentLevel!;
          levelSource = "saved-now";
          await logActivity(tx, {
            module: "assembly",
            action: "updated",
            entityType: "Product",
            entityId: unit.product.id,
            entityRef: unit.product.sku,
            fromValue: null,
            toValue: level,
            details: `Assembly condition level set to ${assemblyLevelLabel(level)} at the first assignment (${unit.unitCode})`,
            userId: user.id,
            userName: user.name,
          });
        } else {
          const current = await tx.product.findUnique({
            where: { id: unit.product.id },
            select: { assemblyLevel: true },
          });
          level = current?.assemblyLevel ?? sentLevel!;
          levelSource = "product";
        }
      }

      // 1. Create AssemblyTask
      const task = await tx.assemblyTask.create({
        data: {
          unitId,
          warehouseId,
          level,
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

      return { task, levelSource };
    });

    log.info("assembly task assigned", {
      taskId: result.task.id,
      unitId,
      productId: unit.product.id,
      assignedToId,
      level: result.task.level,
      levelSource: result.levelSource,
    });

    return successResponse({ ...result.task, levelSource: result.levelSource }, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("assembly assignment failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to assign assembly task", 500);
  }
}
