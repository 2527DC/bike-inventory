export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { storeUpdateSchema } from "@/lib/validations";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:stores:id");

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("stores", "edit");
    const { id } = await params;
    const data = storeUpdateSchema.parse(await req.json());

    const existing = await prisma.store.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return errorResponse("Store not found", 404);

    if (data.code) {
      const code = data.code.trim().toUpperCase();
      const clash = await prisma.store.findUnique({ where: { code }, select: { id: true, name: true } });
      if (clash && clash.id !== id) {
        return errorResponse(`Code "${code}" is already used by ${clash.name}`, 409);
      }
    }

    const store = await prisma.store.update({
      where: { id },
      data: {
        ...(data.code !== undefined ? { code: data.code.trim().toUpperCase() } : {}),
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.address !== undefined ? { address: data.address?.trim() || null } : {}),
        ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });

    log.info("store updated", { storeId: id, fields: Object.keys(data) });
    return successResponse(store);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to update the store";
    log.error("store update failed", { message });
    return errorResponse(message, 400);
  }
}

/**
 * Hard-delete only when nothing references the store. Otherwise refuse with the counts and
 * point at deactivation — the same rule /team applies to a user with history.
 *
 * The FK is Restrict, so the database would refuse anyway. This check exists so the refusal
 * is a sentence a person can act on rather than a constraint-violation string, and so it
 * names WHICH relation is holding the row.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("stores", "delete");
    const { id } = await params;

    const store = await prisma.store.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        _count: {
          select: { warehouses: true, users: true, countEvents: true, analyticsDevices: true },
        },
      },
    });
    if (!store) return errorResponse("Store not found", 404);

    const blockers: string[] = [];
    if (store._count.warehouses) blockers.push(`${store._count.warehouses} warehouse(s)`);
    if (store._count.countEvents) blockers.push(`${store._count.countEvents} footfall event(s)`);
    if (store._count.analyticsDevices) blockers.push(`${store._count.analyticsDevices} counting device(s)`);
    // Users are NOT a blocker: User.storeId is SetNull, so deleting a store unassigns staff
    // rather than destroying them. Mentioned in the message so the effect is not a surprise.

    if (blockers.length) {
      log.info("store delete refused", { storeId: id, blockers });
      return successResponse({
        deleted: false,
        name: store.name,
        message:
          `${store.name} still has ${blockers.join(", ")}. ` +
          `Move or remove them first, or deactivate the store to hide it from pickers while keeping its history.`,
      });
    }

    await prisma.store.delete({ where: { id } });
    log.info("store deleted", { storeId: id, unassignedUsers: store._count.users });
    return successResponse({
      deleted: true,
      name: store.name,
      message:
        store._count.users > 0
          ? `${store.name} deleted. ${store._count.users} user(s) are now unassigned.`
          : `${store.name} deleted.`,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to delete the store";
    log.error("store delete failed", { message });
    return errorResponse(message, 400);
  }
}
