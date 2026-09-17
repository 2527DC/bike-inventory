export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
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

/** Rows per page of the "Awaiting Assignment" and "No assembly" lists (plan 1709, R8). */
const PENDING_PAGE_SIZE = 100;
/** Most units one Assign may carry (plan 1709, R9). */
const MAX_BULK_ASSIGN = 500;
/** Ceiling on `pendingIds=1`, so a runaway filter cannot return a million ids. */
const MAX_PENDING_IDS = 5000;

const OPEN_TASK_STATUSES = ["PENDING", "IN_PROGRESS", "ON_HOLD"] as const;
/** Units that no longer physically exist here — never listed on No assembly. */
const GONE_UNIT_STATUSES = ["SOLD", "LOST", "RESET", "TRANSFERRED", "RETURNED", "DAMAGED"] as const;

type SortKey = "delivery" | "received" | "model";

const productSelect = {
  id: true,
  name: true,
  sku: true,
  assemblyLevel: true,
  brand: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
} as const;

const reservedForSelect = {
  select: { id: true, invoiceNo: true, scheduledDate: true, priorityAt: true },
} as const;

const unitListInclude = {
  product: { select: productSelect },
  bin: { select: { id: true, code: true, name: true, directions: true } },
  warehouse: { select: { id: true, name: true, code: true } },
  reservedForDelivery: reservedForSelect,
} satisfies Prisma.InventoryUnitInclude;

type ReservedDelivery = { id: string; invoiceNo: string; scheduledDate: Date | null; priorityAt: Date | null };

/** `reservedForDelivery` → the flat `reservedFor` the screens read. */
function reservedFor(d: ReservedDelivery | null | undefined) {
  return d
    ? { deliveryId: d.id, invoiceNo: d.invoiceNo, scheduledDate: d.scheduledDate, priorityAt: d.priorityAt }
    : null;
}

/**
 * ★ order (Q20): delivery day earliest first, a ★ with no day after the dated ones, then the
 * earliest star. Returns 0 for two unstarred rows so a stable sort keeps their order.
 */
function compareStar(a: ReservedDelivery | null | undefined, b: ReservedDelivery | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const ad = a.scheduledDate ? a.scheduledDate.getTime() : Number.POSITIVE_INFINITY;
  const bd = b.scheduledDate ? b.scheduledDate.getTime() : Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad - bd;
  const ap = a.priorityAt ? a.priorityAt.getTime() : Number.POSITIVE_INFINITY;
  const bp = b.priorityAt ? b.priorityAt.getTime() : Number.POSITIVE_INFINITY;
  return ap - bp;
}

/**
 * GET — the /assembly screen's data.
 *
 * Response keys (kept stable — `my-assembly-tasks.tsx` reads `tasks`):
 *   tasks, pendingUnits, mechanics, isSupervisor,
 *   pendingTotal, pendingPage, pendingPageSize, pendingHasMore
 * plus, from plan 1709: `starredTotal`, `filterOptions` (with `?filters=1`), `selectedProduct`,
 * `pendingIds` (with `?pendingIds=1`). Every unit and every task's unit carries `reservedFor`.
 *
 * Modes:
 *   (none)             tasks + mechanics + page 1 of Awaiting
 *   ?mine=1            my own tasks only
 *   ?only=tasks        every task + mechanics + the Awaiting count (no rows)
 *   ?only=pending      the Awaiting list only
 *   ?only=no-assembly  units stamped non-assemblable (R42), read-only list
 *   ?pendingIds=1      every matching unit id of the chosen list, for "Select all N matching"
 *
 * List filters: productId, brandId, warehouseId, binId, q, reserved=0 (unstarred only).
 * Sort: delivery (default) | received | model. ★ units always come first (R20).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireFeature("assembly", "view");
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouseId");
    const status = searchParams.get("status");
    const level = searchParams.get("level") as AssemblyLevel | null;
    const mine = searchParams.get("mine") === "1";
    const only = searchParams.get("only");
    const onlyPending = only === "pending";
    const onlyTasks = only === "tasks";
    const onlyNoAssembly = only === "no-assembly";
    const wantIds = searchParams.get("pendingIds") === "1";
    const wantFilters = searchParams.get("filters") === "1";
    const productId = searchParams.get("productId");
    const brandId = searchParams.get("brandId");
    const binId = searchParams.get("binId");
    const unreservedOnly = searchParams.get("reserved") === "0";
    const q = (searchParams.get("q") ?? "").trim();
    const sortParam = searchParams.get("sort");
    const sort: SortKey = sortParam === "received" || sortParam === "model" ? sortParam : "delivery";
    const pendingPage = Math.max(1, parseInt(searchParams.get("pendingPage") ?? "1", 10) || 1);

    const isSupervisor = await userCan(user.id, "assembly", "approve");
    const returnSupervisorData = isSupervisor && !mine;

    // The No assembly tab is `assembly.view` (R42) — anyone who can open the screen.
    if (onlyNoAssembly) {
      const base: Prisma.InventoryUnitWhereInput = {
        nonAssemblable: true,
        status: { notIn: [...GONE_UNIT_STATUSES] },
      };
      const args: ListArgs = { base, q, productId, brandId, warehouseId, binId, unreservedOnly, sort, page: pendingPage, wantFilters, mode: "no-assembly" };
      return successResponse(wantIds ? await readUnitIds(args) : await readUnitList(args));
    }

    if (onlyPending || wantIds) {
      if (!isSupervisor) return errorResponse("You do not have permission to approve assembly", 403);
      const args: ListArgs = { base: awaitingBase(), q, productId, brandId, warehouseId, binId, unreservedOnly, sort, page: pendingPage, wantFilters, mode: "awaiting" };
      return successResponse(wantIds ? await readUnitIds(args) : await readUnitList(args));
    }

    const where: Prisma.AssemblyTaskWhereInput = {};
    if (!isSupervisor || mine) where.assignedToId = user.id;
    if (warehouseId) where.warehouseId = warehouseId;
    if (status) where.status = status as Prisma.AssemblyTaskWhereInput["status"];
    if (level) where.level = level;

    const [rawTasks, pendingRows, pendingCount, mechanics] = await Promise.all([
      prisma.assemblyTask.findMany({
        where,
        include: {
          unit: {
            include: {
              product: { select: productSelect },
              bin: { select: { id: true, code: true, name: true, directions: true } },
              reservedForDelivery: reservedForSelect,
              // Where the unit came from — the vendor for "Raise vendor issue" (Q5).
              inboundShipment: {
                select: {
                  vendorBill: { select: { vendorId: true } },
                  brand: { select: { vendors: { where: { isPrimary: true }, select: { vendorId: true }, take: 1 } } },
                },
              },
            },
          },
          warehouse: { select: { id: true, name: true, code: true, kind: true } },
          assignedTo: { select: { id: true, name: true, email: true } },
          assignedBy: { select: { id: true, name: true } },
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      }),
      returnSupervisorData && !onlyTasks
        ? readUnitList({ base: awaitingBase(), q, productId, brandId, warehouseId, binId, unreservedOnly, sort, page: pendingPage, wantFilters: false, mode: "awaiting" })
        : Promise.resolve(null),
      // ?only=tasks: just the Awaiting count, for the tab badge.
      returnSupervisorData && onlyTasks ? prisma.inventoryUnit.count({ where: awaitingBase() }) : Promise.resolve(0),
      // Active users for the mechanic picker
      returnSupervisorData
        ? prisma.user.findMany({
            where: { isActive: true },
            select: { id: true, name: true, email: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
    ]);

    // ★ builds first (R20). Array.prototype.sort is stable, so unstarred keep the query order.
    const tasks = rawTasks
      .map((t) => {
        const { reservedForDelivery, inboundShipment, ...unit } = t.unit;
        const vendorId =
          inboundShipment?.vendorBill?.vendorId ?? inboundShipment?.brand?.vendors[0]?.vendorId ?? null;
        return { delivery: reservedForDelivery, row: { ...t, unit: { ...unit, reservedFor: reservedFor(reservedForDelivery), vendorId } } };
      })
      .sort((a, b) => compareStar(a.delivery, b.delivery))
      .map((x) => x.row);

    const pendingTotal = pendingRows?.total ?? pendingCount;

    log.debug("assembly data read", {
      tasks: tasks.length,
      pending: pendingRows?.pendingUnits.length ?? 0,
      pendingTotal,
      pendingPage,
      searched: q.length > 0,
    });

    return successResponse({
      tasks,
      pendingUnits: pendingRows?.pendingUnits ?? [],
      mechanics,
      isSupervisor,
      pendingTotal,
      starredTotal: pendingRows?.starredTotal ?? 0,
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
 * Unassembled bicycles nobody is building yet (R8). Non-assemblable units are ALWAYS left out
 * (R42) — they are listed on their own tab instead.
 */
function awaitingBase(): Prisma.InventoryUnitWhereInput {
  return {
    assembledAt: null,
    nonAssemblable: false,
    status: { in: ["RECEIVED", "PUT_AWAY"] },
    assemblyTasks: { none: { status: { in: [...OPEN_TASK_STATUSES] } } },
  };
}

interface ListArgs {
  base: Prisma.InventoryUnitWhereInput;
  q: string;
  productId: string | null;
  brandId: string | null;
  warehouseId: string | null;
  binId: string | null;
  unreservedOnly: boolean;
  sort: SortKey;
  page: number;
  wantFilters: boolean;
  mode: "awaiting" | "no-assembly";
}

/**
 * One page of a unit list, ★ first.
 *
 * Two queries rather than one ORDER BY: Postgres cannot put "reserved" before "not reserved"
 * AND order the reserved ones by their delivery's day through Prisma's orderBy. So the ★ group
 * is read first, and the page window continues into the unstarred group once it runs out.
 */
function listWhere(a: ListArgs): Prisma.InventoryUnitWhereInput {
  const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
  return {
    ...a.base,
    ...(a.productId ? { productId: a.productId } : {}),
    ...(a.warehouseId ? { warehouseId: a.warehouseId } : {}),
    ...(a.binId ? { binId: a.binId } : {}),
    ...(a.brandId ? { product: { is: { brandId: a.brandId } } } : {}),
    ...(a.unreservedOnly ? { reservedForDeliveryId: null } : {}),
    // The search covers every identifier a person at the rack might read off a carton or a label.
    ...(a.q
      ? {
          OR: [
            { unitCode: contains(a.q) },
            { frameNumber: contains(a.q) },
            { product: { is: { name: contains(a.q) } } },
            { product: { is: { sku: contains(a.q) } } },
            { product: { is: { brand: { is: { name: contains(a.q) } } } } },
            { bin: { is: { code: contains(a.q) } } },
            { warehouse: { is: { name: contains(a.q) } } },
            { warehouse: { is: { code: contains(a.q) } } },
          ],
        }
      : {}),
  };
}

/** Every matching unit id (R8's "Select all N matching"), capped at MAX_PENDING_IDS. */
async function readUnitIds(a: ListArgs) {
  const rows = await prisma.inventoryUnit.findMany({
    where: listWhere(a),
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: MAX_PENDING_IDS,
  });
  log.debug("unit ids read", { mode: a.mode, count: rows.length });
  return { pendingIds: rows.map((r) => r.id), truncated: rows.length === MAX_PENDING_IDS };
}

async function readUnitList(a: ListArgs) {
  const where = listWhere(a);
  const starredWhere: Prisma.InventoryUnitWhereInput = { AND: [where, { reservedForDeliveryId: { not: null } }] };
  const plainWhere: Prisma.InventoryUnitWhereInput = { AND: [where, { reservedForDeliveryId: null }] };

  const plainOrder: Prisma.InventoryUnitOrderByWithRelationInput[] =
    a.sort === "model"
      ? [{ product: { name: "asc" } }, { unitCode: "asc" }]
      : // delivery and received: unstarred units have no delivery day, so both are oldest first.
        [{ createdAt: "asc" }, { unitCode: "asc" }];

  const [total, starredTotal] = await Promise.all([
    prisma.inventoryUnit.count({ where }),
    a.unreservedOnly ? Promise.resolve(0) : prisma.inventoryUnit.count({ where: starredWhere }),
  ]);

  const skip = (a.page - 1) * PENDING_PAGE_SIZE;
  let starred: Awaited<ReturnType<typeof readStarred>> = [];
  if (skip < starredTotal) starred = await readStarred(starredWhere, skip);

  const remaining = PENDING_PAGE_SIZE - starred.length;
  const plainSkip = Math.max(0, skip - starredTotal);
  const plain =
    remaining > 0
      ? await prisma.inventoryUnit.findMany({
          where: plainWhere,
          include: unitListInclude,
          orderBy: plainOrder,
          skip: plainSkip,
          take: remaining,
        })
      : [];

  const pendingUnits = [...starred, ...plain].map(({ reservedForDelivery, ...u }) => ({
    ...u,
    reservedFor: reservedFor(reservedForDelivery),
  }));

  const filterOptions = a.wantFilters ? await readFilterOptions(a.base) : undefined;
  const selectedProduct = a.productId
    ? await prisma.product.findUnique({ where: { id: a.productId }, select: { id: true, name: true, sku: true } })
    : undefined;

  log.debug("unit list read", { mode: a.mode, page: a.page, rows: pendingUnits.length, total, starredTotal, sort: a.sort });

  return {
    pendingUnits,
    total,
    pendingTotal: total,
    starredTotal,
    pendingPage: a.page,
    pendingPageSize: PENDING_PAGE_SIZE,
    pendingHasMore: a.page * PENDING_PAGE_SIZE < total,
    ...(filterOptions ? { filterOptions } : {}),
    ...(selectedProduct !== undefined ? { selectedProduct } : {}),
  };
}

/** The ★ group: delivery day (no day last), then the earliest star, then the oldest unit. */
function readStarred(where: Prisma.InventoryUnitWhereInput, skip: number) {
  return prisma.inventoryUnit.findMany({
    where,
    include: unitListInclude,
    orderBy: [
      { reservedForDelivery: { scheduledDate: { sort: "asc", nulls: "last" } } },
      { reservedForDelivery: { priorityAt: { sort: "asc", nulls: "last" } } },
      { createdAt: "asc" },
    ],
    skip,
    take: PENDING_PAGE_SIZE,
  });
}

/**
 * Brands, locations and bins that actually hold units of this list — so a filter never offers
 * an empty choice. Read from the unfiltered base, so choosing one does not hide the others.
 */
async function readFilterOptions(base: Prisma.InventoryUnitWhereInput) {
  const [groups, products] = await Promise.all([
    prisma.inventoryUnit.groupBy({ by: ["warehouseId", "binId"], where: base, _count: { _all: true } }),
    prisma.inventoryUnit.groupBy({ by: ["productId"], where: base }),
  ]);
  const warehouseIds = [...new Set(groups.map((g) => g.warehouseId))];
  const binIds = [...new Set(groups.map((g) => g.binId).filter((b): b is string => !!b))];
  const [warehouses, bins, brands] = await Promise.all([
    prisma.warehouse.findMany({ where: { id: { in: warehouseIds } }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
    prisma.bin.findMany({ where: { id: { in: binIds } }, select: { id: true, code: true, name: true, warehouseId: true }, orderBy: { code: "asc" } }),
    prisma.brand.findMany({
      where: { products: { some: { id: { in: products.map((p) => p.productId) } } } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { warehouses, bins, brands };
}

/**
 * The body: the original single-unit shape (`unitId`) or a bulk `unitIds[]` (R9, ≤ 500).
 * `level` applies only to products that have none yet — a product with a level is assigned at
 * it and anything sent is ignored (plan 1509, D3/D4).
 */
const assignBodySchema = assemblyTaskCreateSchema
  .omit({ unitId: true })
  .extend({
    unitId: z.string().min(1).optional(),
    unitIds: z
      .array(z.string().min(1))
      .min(1, "Choose at least one bicycle")
      .max(MAX_BULK_ASSIGN, `Assign at most ${MAX_BULK_ASSIGN} bicycles at a time`)
      .optional(),
  })
  .refine((b) => !!b.unitId || (b.unitIds && b.unitIds.length > 0), { message: "Choose a bicycle", path: ["unitIds"] });

/**
 * POST — assign one or many bicycles to a mechanic, in ONE transaction.
 *
 * Per unit, as before plan 1709: the unit exists and is not assembled, it has no open task, it
 * is moved to its warehouse's assembly bin (found by `isAssemblyArea`, then code "ASM", else
 * created) with a `BinMovementLog`. The product's level is used; a product with none needs a
 * `level`, which is saved to the product in the same transaction.
 * New: a non-assemblable unit (R42) is refused. Any refusal refuses the whole batch.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("assembly", "approve");

    const parsed = assignBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      log.warn("assignment refused", { field: issue?.path.join("."), code: issue?.code });
      return errorResponse(issue?.message ?? "Invalid assignment", 400);
    }
    const { unitId, unitIds: sentIds, assignedToId, level: sentLevel, notes } = parsed.data;
    const unitIds = [...new Set(sentIds ?? [unitId!])];

    // The picker lists active users; a stale screen could still send a deactivated one.
    const assignee = await prisma.user.findUnique({
      where: { id: assignedToId },
      select: { id: true, name: true, isActive: true },
    });
    if (!assignee || !assignee.isActive) {
      log.warn("assignment refused", { reason: "assignee not active", units: unitIds.length, assignedToId });
      return errorResponse("That mechanic is not an active user — pick another", 400);
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const units = await tx.inventoryUnit.findMany({
          where: { id: { in: unitIds } },
          include: { product: { select: { id: true, name: true, sku: true, assemblyLevel: true } } },
        });
        if (units.length !== unitIds.length) {
          throw new Refusal(unitIds.length === 1 ? "Unit not found" : `${unitIds.length - units.length} of the chosen bicycles no longer exist — reload the list`, 404);
        }

        const assembled = units.find((u) => u.assembledAt);
        if (assembled) throw new Refusal(`Unit ${assembled.unitCode} is already assembled`);
        const noAssembly = units.find((u) => u.nonAssemblable);
        if (noAssembly) throw new Refusal(`Unit ${noAssembly.unitCode} is in a non-assemblable bin — it needs no build`);

        // Level resolution happens before any write, so a refusal changes nothing.
        const needLevel = [...new Map(units.filter((u) => !u.product.assemblyLevel).map((u) => [u.product.id, u.product])).values()];
        if (needLevel.length > 0 && !sentLevel) {
          const names = needLevel.slice(0, 3).map((p) => p.name).join(", ") + (needLevel.length > 3 ? ` and ${needLevel.length - 3} more` : "");
          throw new Refusal(`Choose the assembly condition level for ${names} — it is saved to the product and not asked again`);
        }

        const openTask = await tx.assemblyTask.findFirst({
          where: { unitId: { in: unitIds }, status: { in: [...OPEN_TASK_STATUSES] } },
          include: { unit: { select: { unitCode: true } } },
        });
        if (openTask) throw new Refusal(`Unit ${openTask.unit.unitCode} already has an active task (${openTask.status})`);

        // 0. The product's one level (D3). `updateMany` on `assemblyLevel: null` so two people
        //    assigning the same unset product at once cannot overwrite each other: the second
        //    write matches nothing, and that assignment takes whatever the first one saved.
        const levelByProduct = new Map<string, { level: AssemblyLevel; source: "product" | "saved-now" }>();
        for (const u of units) {
          if (u.product.assemblyLevel) levelByProduct.set(u.product.id, { level: u.product.assemblyLevel, source: "product" });
        }
        for (const p of needLevel) {
          const saved = await tx.product.updateMany({ where: { id: p.id, assemblyLevel: null }, data: { assemblyLevel: sentLevel! } });
          if (saved.count === 1) {
            levelByProduct.set(p.id, { level: sentLevel!, source: "saved-now" });
            const firstUnit = units.find((u) => u.product.id === p.id)!;
            await logActivity(tx, {
              module: "assembly",
              action: "updated",
              entityType: "Product",
              entityId: p.id,
              entityRef: p.sku,
              fromValue: null,
              toValue: sentLevel!,
              details: `Assembly condition level set to ${assemblyLevelLabel(sentLevel!)} at the first assignment (${firstUnit.unitCode})`,
              userId: user.id,
              userName: user.name,
            });
          } else {
            const current = await tx.product.findUnique({ where: { id: p.id }, select: { assemblyLevel: true } });
            levelByProduct.set(p.id, { level: current?.assemblyLevel ?? sentLevel!, source: "product" });
          }
        }

        // 1. The assembly staging bin of every warehouse involved.
        const asmBinByWarehouse = new Map<string, string>();
        for (const warehouseId of new Set(units.map((u) => u.warehouseId))) {
          const asmBin =
            (await tx.bin.findFirst({ where: { warehouseId, isAssemblyArea: true, isActive: true } })) ??
            (await tx.bin.findFirst({ where: { warehouseId, code: "ASM", isActive: true } })) ??
            (await tx.bin.create({
              data: {
                code: "ASM",
                name: "Assembly Staging Area",
                warehouseId,
                directions: "Workshop assembly build floor",
                isAssemblyArea: true,
              },
            }));
          asmBinByWarehouse.set(warehouseId, asmBin.id);
        }

        // 2. Tasks, unit moves and movement logs — batched, so 500 bicycles are a handful of
        //    statements rather than 1,500 round trips.
        const now = new Date();
        const trimmedNotes = notes?.trim() || null;
        await tx.assemblyTask.createMany({
          data: units.map((u) => ({
            unitId: u.id,
            warehouseId: u.warehouseId,
            level: levelByProduct.get(u.product.id)!.level,
            status: "PENDING" as const,
            assignedToId,
            assignedById: user.id,
            assignedAt: now,
            notes: trimmedNotes,
          })),
        });
        for (const [warehouseId, asmBinId] of asmBinByWarehouse) {
          await tx.inventoryUnit.updateMany({
            where: { id: { in: units.filter((u) => u.warehouseId === warehouseId).map((u) => u.id) } },
            data: { binId: asmBinId, status: "ASSIGNED" },
          });
        }
        await tx.binMovementLog.createMany({
          data: units.map((u) => ({
            warehouseId: u.warehouseId,
            unitId: u.id,
            productId: u.productId,
            quantity: 1,
            fromBinId: u.binId,
            toBinId: asmBinByWarehouse.get(u.warehouseId)!,
            reason: `Moved by assembly assignment to ${assignee.name} (${levelByProduct.get(u.product.id)!.level})`,
            movedById: user.id,
          })),
        });

        const tasks = await tx.assemblyTask.findMany({
          where: { unitId: { in: unitIds }, status: "PENDING" },
          select: { id: true, unitId: true, level: true },
        });

        const levels = [...new Set([...levelByProduct.values()].map((l) => l.level))];
        const savedNow = needLevel.filter((p) => levelByProduct.get(p.id)?.source === "saved-now");
        return {
          assigned: units.length,
          assignedTo: { id: assignee.id, name: assignee.name },
          // Kept for the single-unit message: "U-000481 assigned … at 85% · Semi-built".
          level: levels.length === 1 ? levels[0] : null,
          levelSource: savedNow.length > 0 ? ("saved-now" as const) : ("product" as const),
          levelsSaved: savedNow.map((p) => ({ productId: p.id, productName: p.name, level: sentLevel! })),
          tasks: tasks.map((t) => ({ taskId: t.id, unitId: t.unitId, level: t.level, unitCode: units.find((u) => u.id === t.unitId)?.unitCode })),
        };
      },
      { timeout: 60_000 }
    );

    log.info("assembly tasks assigned", {
      units: result.assigned,
      unitIds: unitIds.slice(0, 20),
      assignedToId,
      levelsSaved: result.levelsSaved.length,
    });

    return successResponse(result, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof Refusal) {
      log.warn("assignment refused", { reason: error.message });
      return errorResponse(error.message, error.status);
    }
    log.error("assembly assignment failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to assign assembly task", 500);
  }
}

/** A refusal thrown inside the transaction, so nothing is written, and answered as a 4xx. */
class Refusal extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "Refusal";
    this.status = status;
  }
}
