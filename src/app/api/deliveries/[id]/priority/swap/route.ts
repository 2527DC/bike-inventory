export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { AVAILABLE_UNIT_STATUSES } from "@/lib/units";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("deliveries:priority-swap");

/**
 * Swap ONE unit held for a starred outward for another (plan 1709, R7, Q41).
 *
 * The app picks units — assembled first, then oldest — and a person may disagree: the chosen frame
 * is scratched, or the customer saw a particular cycle on the floor. This exchanges exactly one
 * reservation. `assembly.approve`, because it is the supervisor's call, not the mechanic's.
 *
 * Both units must be the same product in the same warehouse: a swap is a choice between
 * interchangeable items, never a way to move a reservation to another building — that is what a
 * transfer is for. The incoming unit must be free (held for nobody) and available (not sold, lost,
 * reset or in a van), so a swap can never take a cycle another outward is waiting on.
 */
const bodySchema = z.object({
  fromUnitId: z.string().min(1, "Choose the unit to release."),
  toUnitId: z.string().min(1, "Choose the unit to hold instead."),
});

class SwapRefusal extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SwapRefusal";
    this.status = status;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let deliveryId: string | undefined;
  try {
    const user = await requireFeature("assembly", "approve");
    const { id } = await params;
    deliveryId = id;
    const body = bodySchema.parse(await req.json());
    if (body.fromUnitId === body.toUnitId) {
      return errorResponse("Those are the same unit.", 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      const delivery = await tx.delivery.findUnique({
        where: { id },
        select: { id: true, invoiceNo: true, priorityAt: true },
      });
      if (!delivery) throw new SwapRefusal("Delivery not found", 404);

      const from = await tx.inventoryUnit.findUnique({
        where: { id: body.fromUnitId },
        select: { id: true, unitCode: true, productId: true, warehouseId: true, reservedForDeliveryId: true },
      });
      if (!from) throw new SwapRefusal("That unit no longer exists.", 404);
      if (from.reservedForDeliveryId !== id) {
        throw new SwapRefusal("That unit is not held for this outward. Reload and try again.", 409);
      }

      const to = await tx.inventoryUnit.findUnique({
        where: { id: body.toUnitId },
        select: {
          id: true,
          unitCode: true,
          productId: true,
          warehouseId: true,
          status: true,
          reservedForDeliveryId: true,
        },
      });
      if (!to) throw new SwapRefusal("That unit no longer exists.", 404);
      if (to.productId !== from.productId) {
        throw new SwapRefusal("Both units must be the same product.", 409);
      }
      if (to.warehouseId !== from.warehouseId) {
        throw new SwapRefusal("Both units must be in the same warehouse. Raise a transfer instead.", 409);
      }
      if (to.reservedForDeliveryId) {
        throw new SwapRefusal("That unit is already held for another outward.", 409);
      }
      if (!(AVAILABLE_UNIT_STATUSES as string[]).includes(to.status)) {
        throw new SwapRefusal(`That unit is ${to.status.toLowerCase()} and cannot be held.`, 409);
      }

      const now = new Date();
      await tx.inventoryUnit.update({
        where: { id: from.id },
        data: { reservedForDeliveryId: null, reservedAt: null },
      });
      await tx.inventoryUnit.update({
        where: { id: to.id },
        data: { reservedForDeliveryId: id, reservedAt: now },
      });

      await logActivity(tx, {
        module: "deliveries",
        action: "priority_unit_swapped",
        entityType: "Delivery",
        entityId: id,
        entityRef: delivery.invoiceNo,
        fromValue: from.unitCode,
        toValue: to.unitCode,
        userId: user.id,
        userName: user.name,
      });

      return { fromUnitCode: from.unitCode, toUnitCode: to.unitCode, invoiceNo: delivery.invoiceNo };
    });

    log.info("priority unit swapped", {
      deliveryId,
      fromUnitId: body.fromUnitId,
      toUnitId: body.toUnitId,
    });
    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("unit swap refused", { deliveryId, status: error.status });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof SwapRefusal) {
      log.warn("unit swap refused", { deliveryId, status: error.status, reason: error.message });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof z.ZodError) {
      log.warn("unit swap body rejected", { deliveryId });
      return errorResponse(error.issues[0]?.message ?? "Invalid swap request", 400);
    }
    log.error("unit swap failed", {
      deliveryId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to swap the unit", 500);
  }
}
