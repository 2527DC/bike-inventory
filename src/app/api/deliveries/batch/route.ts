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
import {
  deductDeliveryFromFloor,
  releaseDeliveryStock,
  floorShortForDispatch,
  shortRefusalMessage,
  isDummy,
  type ShortLine,
} from "@/lib/deliveries/floor-stock";
import { notifyTransferNeeded } from "@/lib/deliveries/transfer-needed";
import { APPROVAL_GATED_STATUSES, approvalRefusal, isDeliveryApproved } from "@/lib/approvals/actions/delivery";
import { createLogger } from "@/lib/logger";
import { sellDeliveryUnits } from "@/lib/units";

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

  // Plan 1709, R13/R14: the outward the batch refused, and what it was short of. Declared OUTSIDE
  // the try because the refusal rolls the whole batch back and is reported from the catch — the
  // shortage is still real, and the people who can move stock should hear about it.
  let userId: string | undefined;
  let refusedShort: ShortLine[] = [];
  let refusedDelivery: { id: string; invoiceNo: string; warehouse: { name: string } | null } | null = null;

  try {
    const user = await requireFeature("deliveries", "edit");
    userId = user.id;
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
          // ─── Plan 1709: the same two gates the single route applies (R26a, R13) ──────────
          // Per id, and the refusal names the invoice, so the clerk knows which one to take out
          // of the selection. One failure rolls the whole batch back — deliberately: a batch is
          // a single decision, and half a dispatch is worse than none.
          if (APPROVAL_GATED_STATUSES.includes(batchAction) && !isDeliveryApproved(delivery)) {
            log.warn("batch dispatch refused: not approved", {
              deliveryId: delivery.id,
              invoiceNo: delivery.invoiceNo,
            });
            throw new BatchRefusal(`Invoice ${delivery.invoiceNo}: ${approvalRefusal(delivery)}`, 409);
          }

          const short = await floorShortForDispatch(tx, delivery);
          if (short.length > 0) {
            refusedShort = short;
            refusedDelivery = {
              id: delivery.id,
              invoiceNo: delivery.invoiceNo,
              warehouse: delivery.warehouse,
            };
            throw new BatchRefusal(
              `Invoice ${delivery.invoiceNo}: ${shortRefusalMessage(short, delivery.warehouse?.name ?? "the floor warehouse")}`,
              409
            );
          }

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
              // R14: keep what it was short of, so the transfer push can go out after the
              // rollback. Matched on `name` rather than `instanceof`, because this catch already
              // has the error narrowed to `unknown` from a helper that may wrap it.
              if (err instanceof Error && err.name === "FloorShortError") {
                refusedShort = (err as Error & { short: ShortLine[] }).short;
                refusedDelivery = {
                  id: delivery.id,
                  invoiceNo: delivery.invoiceNo,
                  warehouse: delivery.warehouse,
                };
              }
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
            // Plan 1709, Part B (R7, R38): sell the units behind the lines from this floor.
            await sellDeliveryUnits(tx, delivery, moved);
          }
        }

        await tx.delivery.update({ where: { id: delivery.id }, data: updateData });
        updated++;
      }

      return { updated };
      // Up to 50 deliveries, each now also picking and selling its units (plan 1709, Part B):
      // past Prisma's 5 s default on a full batch.
    }, { timeout: 30_000 });

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
    // R14: the batch rolled back, but the shortage it hit is real. Told after the response.
    if (refusedShort.length > 0 && refusedDelivery) {
      const delivery = refusedDelivery;
      const short = refusedShort;
      after(() => notifyTransferNeeded(delivery, short, userId));
    }

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
