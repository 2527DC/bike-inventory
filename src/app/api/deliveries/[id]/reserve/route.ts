export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { holdDeliveryStock, isDummy, HOLDING_STATUSES } from "@/lib/deliveries/floor-stock";
import { createLogger } from "@/lib/logger";

const log = createLogger("deliveries:api");

/** A refusal raised inside the transaction that carries its own HTTP status. */
class ReserveRefusal extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ReserveRefusal";
    this.status = status;
  }
}

/**
 * "Reserve stock now" (A38, T5). Tries to hold the delivery's lines on its floor warehouse,
 * all or nothing. A shortage is not an error: the answer is `{ held: false, short: [...] }` and
 * the screen keeps showing the red card. Already held → `{ held: true, short: [] }`, no write.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let deliveryId: string | undefined;
  try {
    await requireFeature("deliveries", "edit");
    const { id } = await params;
    deliveryId = id;

    const result = await prisma.$transaction(async (tx) => {
      const delivery = await tx.delivery.findUnique({
        where: { id },
        select: {
          id: true,
          invoiceNo: true,
          status: true,
          warehouseId: true,
          lineItems: true,
          stockReservedAt: true,
        },
      });
      if (!delivery) throw new ReserveRefusal("Delivery not found", 404);
      if (isDummy(delivery)) {
        throw new ReserveRefusal(
          "Dummy delivery: no warehouse matched this invoice number. No actions are allowed.",
          409
        );
      }
      if (!(HOLDING_STATUSES as readonly string[]).includes(delivery.status)) {
        throw new ReserveRefusal(`Stock cannot be reserved for a delivery in ${delivery.status} status`, 409);
      }
      if (delivery.stockReservedAt) return { held: true, short: [], invoiceNo: delivery.invoiceNo };

      const hold = await holdDeliveryStock(tx, delivery);
      return { ...hold, invoiceNo: delivery.invoiceNo };
    });

    if (result.held) {
      log.info("reserve stock now: held", { deliveryId, invoiceNo: result.invoiceNo });
    } else {
      log.warn("reserve stock now: still short", {
        deliveryId,
        invoiceNo: result.invoiceNo,
        lines: result.short.length,
      });
    }

    return successResponse({ held: result.held, short: result.short });
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("reserve refused", { deliveryId, status: error.status });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof ReserveRefusal) {
      log.warn("reserve refused", { deliveryId, status: error.status, reason: error.message });
      return errorResponse(error.message, error.status);
    }
    log.error("reserve failed", {
      deliveryId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to reserve stock", 500);
  }
}
