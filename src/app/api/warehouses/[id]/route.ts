export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { clearWarehouseCache } from "@/lib/warehouses";
import { warehouseUpdateSchema } from "@/lib/validations";
import {
  FLOOR_NEEDS_PREFIX, WarehouseRuleError, assertPrefixFree, assertStoreHasPrimary,
  clearOtherPrimaries, normalisePrefix, uniqueViolationMessage,
} from "@/lib/warehouses-rules";
import { createLogger } from "@/lib/logger";

const log = createLogger("warehouses:api");

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("warehouses", "edit");
    const { id } = await params;
    const parsed = warehouseUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      log.warn("warehouse update body invalid", { warehouseId: id, path: first?.path.join("."), issues: parsed.error.issues.length });
      return errorResponse(first?.message ?? "Invalid warehouse", 400);
    }
    const data = parsed.data;

    // One transaction for the checks, the primary move and the write, so a refusal found only
    // after the write (a store left without a primary floor) rolls the write back (plan 1609 §1.7).
    const warehouse = await prisma.$transaction(async (tx) => {
      const existing = await tx.warehouse.findUnique({
        where: { id },
        select: { id: true, storeId: true, kind: true, isActive: true, invoicePrefix: true, isPrimary: true },
      });
      if (!existing) throw new WarehouseRuleError("Warehouse not found", 404);

      if (data.code) {
        const code = data.code.trim().toUpperCase();
        const clash = await tx.warehouse.findUnique({ where: { code }, select: { id: true, name: true } });
        if (clash && clash.id !== id) {
          throw new WarehouseRuleError(`Code "${code}" is already used by ${clash.name}`, 409);
        }
      }

      // Moving a warehouse to another store is allowed, but the target must exist and be
      // usable. The stock inside moves with it — which is a real business event, not a rename,
      // so it is logged at info.
      const storeId = data.storeId ?? existing.storeId;
      const moved = storeId !== existing.storeId;
      if (moved) {
        const store = await tx.store.findUnique({
          where: { id: storeId },
          select: { id: true, name: true, isActive: true },
        });
        if (!store) throw new WarehouseRuleError("Store not found", 400);
        if (!store.isActive) throw new WarehouseRuleError(`${store.name} is deactivated`, 400);
        log.info("warehouse reparented", { warehouseId: id, from: existing.storeId, to: store.id });
      }

      // The state after this write, so every rule judges the result, not the request.
      const kind = data.kind ?? existing.kind;
      const isFloor = kind === "FLOOR";
      const isActive = data.isActive ?? existing.isActive;
      const invoicePrefix = !isFloor
        ? null // a GODOWN never keeps a prefix (R30)
        : data.invoicePrefix !== undefined
          ? normalisePrefix(data.invoicePrefix)
          : existing.invoicePrefix;
      // A primary flag does not travel to another store unless the request sets it there.
      const isPrimary = !isFloor ? false : data.isPrimary ?? (moved ? false : existing.isPrimary);

      // R32: editing a floor requires a prefix. Deactivating a floor does not — an inactive
      // floor sells nothing and is ignored by the invoice resolver.
      if (isFloor && isActive && !invoicePrefix) throw new WarehouseRuleError(FLOOR_NEEDS_PREFIX, 400);
      if (invoicePrefix) await assertPrefixFree(tx, invoicePrefix, id);
      // Before the update: the partial unique index refuses a second primary per store.
      if (isPrimary) await clearOtherPrimaries(tx, storeId, id);

      const updated = await tx.warehouse.update({
        where: { id },
        data: {
          ...(moved ? { storeId } : {}),
          ...(data.code !== undefined ? { code: data.code.trim().toUpperCase() } : {}),
          ...(data.name !== undefined ? { name: data.name.trim() } : {}),
          ...(data.kind !== undefined ? { kind: data.kind } : {}),
          ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          invoicePrefix,
          isPrimary,
        },
        select: {
          id: true, code: true, name: true, kind: true, sortOrder: true, isActive: true,
          invoicePrefix: true, isPrimary: true,
          store: { select: { id: true, code: true, name: true } },
        },
      });

      // R33, after the write: judged only when a FLOOR is involved, before or after, so renaming
      // a godown is never refused over the store's floors. Both stores when it moved.
      if (isFloor || existing.kind === "FLOOR") {
        await assertStoreHasPrimary(tx, storeId);
        if (moved) await assertStoreHasPrimary(tx, existing.storeId);
      }
      return updated;
    });

    log.info("warehouse updated", {
      warehouseId: id, fields: Object.keys(data), kind: warehouse.kind, isPrimary: warehouse.isPrimary,
    });
    // A rename or a deactivation changes what the cached set says.
    // The cached array would otherwise outlive the change for the life of the process —
    // which is how a warehouse the picker offers gets refused by the server that offered it.
    clearWarehouseCache();
    return successResponse(warehouse);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof WarehouseRuleError) {
      log.warn("warehouse update refused", { status: error.status, message: error.message });
      return errorResponse(error.message, error.status);
    }
    const unique = uniqueViolationMessage(error);
    if (unique) {
      log.warn("warehouse update hit a unique constraint", { message: unique });
      return errorResponse(unique, 409);
    }
    const message = error instanceof Error ? error.message : "Failed to update the warehouse";
    log.error("warehouse update failed", { message });
    return errorResponse(message, 400);
  }
}

/**
 * Refuse to delete a warehouse that holds stock or carries transfer history, and say how
 * much — "BCH Warehouse holds 412 stock rows across 87 products" is actionable; a foreign
 * key violation is not.
 *
 * StockLevel.warehouseId is Restrict, so the database is the backstop if this is ever missed.
 * Stock is never silently orphaned.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("warehouses", "delete");
    const { id } = await params;

    const warehouse = await prisma.warehouse.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            stockLevels: true,
            users: true,
            transfersFrom: true,
            transfersTo: true,
            // Three Restrict foreign keys added by MIG-1a. `stockCounts` is an audit scoped
            // to this warehouse; the two `orderTransfers*` are the transfer HEADER lane, as
            // opposed to `transfersFrom`/`transfersTo`, which are the per-item lanes that
            // already existed. Both sets are counted because both hold the row.
            stockCounts: true,
            orderTransfersFrom: true,
            orderTransfersTo: true,
          },
        },
      },
    });
    if (!warehouse) return errorResponse("Warehouse not found", 404);

    const transfers = warehouse._count.transfersFrom + warehouse._count.transfersTo;
    const transferOrders =
      warehouse._count.orderTransfersFrom + warehouse._count.orderTransfersTo;
    const blockers: string[] = [];

    if (warehouse._count.stockLevels) {
      // Products, not rows, is the number a person can act on — they have to move that many
      // lines somewhere before this warehouse can go.
      const products = await prisma.stockLevel.count({
        where: { warehouseId: id, quantity: { gt: 0 } },
      });
      blockers.push(
        `${warehouse._count.stockLevels} stock row(s)` +
          (products ? `, ${products} of them still holding stock` : ", all at zero quantity")
      );
    }
    if (transfers) blockers.push(`${transfers} transfer line(s)`);
    if (transferOrders) blockers.push(`${transferOrders} transfer order(s)`);
    if (warehouse._count.stockCounts) blockers.push(`${warehouse._count.stockCounts} stock audit(s)`);

    if (blockers.length) {
      log.info("warehouse delete refused", { warehouseId: id, blockers });
      return successResponse({
        deleted: false,
        name: warehouse.name,
        message:
          `${warehouse.name} still has ${blockers.join(" and ")}. ` +
          `Move the stock to another warehouse first, or deactivate this one to hide it from pickers while keeping its history.`,
      });
    }

    await prisma.warehouse.delete({ where: { id } });
    log.info("warehouse deleted", { warehouseId: id, unassignedUsers: warehouse._count.users });
    // The deleted warehouse is still in the cached set.
    // The cached array would otherwise outlive the change for the life of the process —
    // which is how a warehouse the picker offers gets refused by the server that offered it.
    clearWarehouseCache();
    return successResponse({
      deleted: true,
      name: warehouse.name,
      message:
        warehouse._count.users > 0
          ? `${warehouse.name} deleted. ${warehouse._count.users} user(s) are now unassigned.`
          : `${warehouse.name} deleted.`,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to delete the warehouse";
    log.error("warehouse delete failed", { message });
    return errorResponse(message, 400);
  }
}
