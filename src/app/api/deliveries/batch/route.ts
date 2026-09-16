export const dynamic = "force-dynamic";

export const runtime = "nodejs";
// nodejs, explicitly: this route reaches SMTP (a raw socket on 587) and the FCM JWT signer
// (node crypto) through notify(). Neither works on the edge runtime, and the failure there
// is not self-explanatory. Node is the default today; this stops a later change from
// silently breaking sends. See the notifications plan, Part C and D.1.
import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { maybeNotifyBelowReorder, type ReorderCrossing } from "@/lib/notify/stock";
import { deductDeliveryFromFloor, releaseDeliveryStock, isDummy } from "@/lib/deliveries/floor-stock";
import { createLogger } from "@/lib/logger";

const log = createLogger("deliveries:api");

/** A refusal raised inside the transaction that carries its own HTTP status. */
class BatchRefusal extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "BatchRefusal";
    this.status = status;
  }
}

export async function PUT(req: NextRequest) {
  let action: string | undefined;
  let requested = 0;
  try {
    const user = await requireFeature("deliveries", "edit");
    const body = await req.json();
    const parsed = body as { deliveryIds: string[]; action: string };
    const deliveryIds = parsed.deliveryIds;
    action = parsed.action;

    if (!deliveryIds || !Array.isArray(deliveryIds) || deliveryIds.length === 0) {
      return errorResponse("No deliveries selected", 400);
    }
    requested = deliveryIds.length;
    if (deliveryIds.length > 50) {
      return errorResponse("Maximum 50 deliveries per batch", 400);
    }

    if (!["OUT_FOR_DELIVERY", "DELIVERED"].includes(action)) {
      return errorResponse("Invalid action", 400);
    }
    const batchAction = action as "OUT_FOR_DELIVERY" | "DELIVERED";
    const expectedStatus = batchAction === "OUT_FOR_DELIVERY" ? "SCHEDULED" : "OUT_FOR_DELIVERY";

    // §F.0: filled INSIDE the transaction across every delivery and item, sent ONCE after it
    // commits. A batch can touch dozens of products; sending inside would eat the transaction
    // budget and roll back every deduction in the batch.
    const crossings: ReorderCrossing[] = [];

    const result = await prisma.$transaction(async (tx) => {
      // Read INSIDE the transaction: whether a delivery is held decides whether its own hold is
      // consumed or other deliveries' holds are respected, so a stale read would miscount.
      const deliveries = await tx.delivery.findMany({
        where: { id: { in: deliveryIds }, status: expectedStatus },
        include: { warehouse: { select: { name: true } } },
      });

      if (deliveries.length === 0) {
        throw new BatchRefusal(`No deliveries in ${expectedStatus} status`, 400);
      }

      // A Dummy takes no action (A41b, T2). One Dummy fails the whole batch, named, so the
      // clerk can take it out of the selection and retry.
      const dummies = deliveries.filter((d) => isDummy(d));
      if (dummies.length > 0) {
        const names = dummies.map((d) => d.invoiceNo).join(", ");
        throw new BatchRefusal(
          `Dummy delivery ${names}: no warehouse matched this invoice number. No actions are allowed. ` +
            `Remove it from the selection and try again.`,
          409
        );
      }

      let updated = 0;

      for (const delivery of deliveries) {
        const updateData: Record<string, unknown> = { status: batchAction };

        if (batchAction === "OUT_FOR_DELIVERY") {
          updateData.dispatchedAt = new Date();
        }

        if (batchAction === "DELIVERED") {
          updateData.deliveredAt = new Date();
          updateData.stockReservedAt = null;

          // Idempotency: skip if already deducted
          const alreadyDeducted = await tx.inventoryTransaction.findFirst({
            where: { referenceNo: delivery.invoiceNo, type: "OUTWARD" },
            select: { id: true },
          });

          if (alreadyDeducted) {
            // The stock already left; give back any hold before stockReservedAt is cleared.
            await releaseDeliveryStock(tx, delivery);
            log.warn("batch delivered: OUTWARD already recorded, deduction skipped", {
              deliveryId: delivery.id,
              invoiceNo: delivery.invoiceNo,
            });
          } else {
            // From the matched floor only (A40); refuses when short (A40b) and rolls back the batch.
            let moved;
            try {
              moved = await deductDeliveryFromFloor(
                tx,
                delivery,
                delivery.warehouse?.name ?? "the floor warehouse"
              );
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              log.warn("batch delivered: floor deduction refused", {
                deliveryId: delivery.id,
                invoiceNo: delivery.invoiceNo,
              });
              throw new BatchRefusal(`Invoice ${delivery.invoiceNo}: ${reason}`, 400);
            }

            for (const line of moved) {
              // Collect only (§F.0).
              crossings.push({
                productId: line.productId,
                previousStock: line.previousStock,
                newStock: line.newStock,
              });
              await tx.inventoryTransaction.create({
                data: {
                  type: "OUTWARD",
                  productId: line.productId,
                  quantity: line.quantity,
                  previousStock: line.previousStock,
                  newStock: line.newStock,
                  referenceNo: delivery.invoiceNo,
                  notes: `[ZOHO][VERIFIED] Customer: ${delivery.customerName} | Invoice: ${delivery.invoiceNo} | ${line.name} x${line.quantity}`,
                  userId: user.id,
                },
              });
            }
          }
        }

        await tx.delivery.update({ where: { id: delivery.id }, data: updateData });
        updated++;
      }

      return { updated };
    });

    // §F.0: committed. One helper call for the whole batch, after the response has gone out;
    // nothing is sent if the transaction threw (e.g. a floor short on a later item).
    after(() => maybeNotifyBelowReorder(crossings));

    log.info("batch update finished", {
      action: batchAction,
      requested,
      updated: result.updated,
      outwardLines: crossings.length,
    });

    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("batch update refused", { action, status: error.status });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof BatchRefusal) {
      log.warn("batch update refused", { action, requested, status: error.status, reason: error.message });
      return errorResponse(error.message, error.status);
    }
    log.error("batch update failed", {
      action,
      requested,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to batch update", 400);
  }
}
