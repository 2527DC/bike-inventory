export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { warehouseUpdateSchema } from "@/lib/validations";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:warehouses:id");

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("warehouses", "edit");
    const { id } = await params;
    const data = warehouseUpdateSchema.parse(await req.json());

    const existing = await prisma.warehouse.findUnique({
      where: { id },
      select: { id: true, storeId: true },
    });
    if (!existing) return errorResponse("Warehouse not found", 404);

    if (data.code) {
      const code = data.code.trim().toUpperCase();
      const clash = await prisma.warehouse.findUnique({ where: { code }, select: { id: true, name: true } });
      if (clash && clash.id !== id) {
        return errorResponse(`Code "${code}" is already used by ${clash.name}`, 409);
      }
    }

    // Moving a warehouse to another store is allowed, but the target must exist and be
    // usable. The stock inside moves with it — which is a real business event, not a rename,
    // so it is logged at info.
    if (data.storeId && data.storeId !== existing.storeId) {
      const store = await prisma.store.findUnique({
        where: { id: data.storeId },
        select: { id: true, name: true, isActive: true },
      });
      if (!store) return errorResponse("Store not found", 400);
      if (!store.isActive) return errorResponse(`${store.name} is deactivated`, 400);
      log.info("warehouse reparented", { warehouseId: id, from: existing.storeId, to: store.id });
    }

    const warehouse = await prisma.warehouse.update({
      where: { id },
      data: {
        ...(data.storeId !== undefined ? { storeId: data.storeId } : {}),
        ...(data.code !== undefined ? { code: data.code.trim().toUpperCase() } : {}),
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
      select: {
        id: true, code: true, name: true, sortOrder: true, isActive: true,
        store: { select: { id: true, code: true, name: true } },
      },
    });

    log.info("warehouse updated", { warehouseId: id, fields: Object.keys(data) });
    return successResponse(warehouse);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
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
