export const dynamic = "force-dynamic";

export const runtime = "nodejs";
// nodejs, explicitly: this route reaches SMTP (a raw socket on 587) and the FCM JWT signer
// (node crypto) through notify(). Neither works on the edge runtime, and the failure there
// is not self-explanatory. Node is the default today; this stops a later change from
// silently breaking sends. See the notifications plan, Part C and D.1.
import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { deliveryUpdateSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { maybeNotifyBelowReorder, type ReorderCrossing } from "@/lib/notify/stock";
import {
  holdDeliveryStock,
  releaseDeliveryStock,
  deductDeliveryFromFloor,
  isDummy,
  type ShortLine,
} from "@/lib/deliveries/floor-stock";
import {
  slotRefusal,
  SLOT_REFUSAL_MESSAGE,
  istDayBounds,
  isDateString,
  toISTDateString,
} from "@/lib/deliveries/slots";
import { toPlus91, samePhone } from "@/lib/phone";
import { createLogger } from "@/lib/logger";

const log = createLogger("deliveries:api");

const DUMMY_MESSAGE = "Dummy delivery: no warehouse matched this invoice number. No actions are allowed.";

/** Statuses whose `scheduledDate` does not take one of the day's slots (same rule as slots.ts). */
const SLOTLESS_STATUSES = ["PREBOOKED", "WALK_OUT"];

/** The IST calendar day ("YYYY-MM-DD") a staff date means, or null when it is not a date. */
function staffDateToISTDay(value: string): string | null {
  if (isDateString(value)) {
    const probe = new Date(`${value}T00:00:00+05:30`);
    return Number.isNaN(probe.getTime()) || toISTDateString(probe) !== value ? null : value;
  }
  const moment = new Date(value);
  return Number.isNaN(moment.getTime()) ? null : toISTDateString(moment);
}

const DELIVERY_INCLUDE = {
  verifiedBy: { select: { name: true } },
  warehouse: { select: { id: true, name: true, kind: true } },
  customer: { select: { id: true, name: true, phone: true } },
} as const;

/** A refusal thrown inside the transaction that carries its own HTTP status (404, 409). */
class DeliveryActionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DeliveryActionError";
    this.status = status;
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let deliveryId: string | undefined;
  try {
    await requireFeature("deliveries", "view");
    const { id } = await params;
    deliveryId = id;

    const delivery = await prisma.delivery.findUnique({
      where: { id },
      include: DELIVERY_INCLUDE,
    });

    if (!delivery) return errorResponse("Delivery not found", 404);

    // Check payment status from receivables
    let paymentStatus: { hasPending: boolean; balance: number; paidAmount: number; totalAmount: number } | null = null;
    try {
      const invoice = await prisma.customerInvoice.findFirst({
        where: { invoiceNo: delivery.invoiceNo },
        select: { amount: true, paidAmount: true, status: true },
      });
      if (invoice) {
        const balance = invoice.amount - invoice.paidAmount;
        paymentStatus = {
          hasPending: balance > 0,
          balance,
          paidAmount: invoice.paidAmount,
          totalAmount: invoice.amount,
        };
      }
    } catch (err) {
      // Payment status is a nice-to-have on the detail screen; the delivery still loads.
      log.warn("payment status lookup failed", {
        deliveryId: id,
        invoiceNo: delivery.invoiceNo,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return successResponse({ ...delivery, isDummy: isDummy(delivery), paymentStatus });
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("delivery fetch refused", { deliveryId, status: error.status });
      return errorResponse(error.message, error.status);
    }
    log.error("delivery fetch failed", {
      deliveryId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch delivery", 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let deliveryId: string | undefined;
  try {
    const user = await requireFeature("deliveries", "edit");
    const { id } = await params;
    deliveryId = id;
    const body = await req.json();
    const data = deliveryUpdateSchema.parse(body);

    const preCheck = await prisma.delivery.findUnique({ where: { id }, select: { id: true } });
    if (!preCheck) return errorResponse("Delivery not found", 404);

    // §F.0: filled INSIDE the transaction (only the DELIVERED / WALK_OUT deduction below moves
    // currentStock down), sent AFTER it commits. Hold and release touch reservedQuantity
    // only and cannot cross the reorder line.
    const crossings: ReorderCrossing[] = [];

    // Lines a SCHEDULED / PACKED move could not hold (A26, A37). The move is still accepted.
    let stockShort: ShortLine[] = [];

    // Set when a staff phone edit dropped the saved customer; logged once the write commits.
    let unlinkedCustomerId: string | null = null;

    const result = await prisma.$transaction(async (tx) => {
      // Re-read inside transaction to prevent race conditions
      const existing = await tx.delivery.findUnique({
        where: { id },
        include: { warehouse: { select: { name: true } } },
      });
      if (!existing) throw new DeliveryActionError("Delivery not found", 404);

      // A Dummy (no floor warehouse matched the invoice prefix) takes no action at all (A41b,
      // A41c, T2). DELETE is the only exception and lives in its own handler.
      const changesSomething = Object.values(data).some((v) => v !== undefined);
      if (isDummy(existing) && changesSomething) {
        throw new DeliveryActionError(DUMMY_MESSAGE, 409);
      }

      const updateData: Record<string, unknown> = {};

      // Phones are written `+91-XXXXXXXXXX` (A12b, B3 — a row converts when it is touched);
      // an empty string clears the column.
      let customerId = existing.customerId;
      if (data.customerPhone !== undefined) {
        const phone = toPlus91(data.customerPhone);
        updateData.customerPhone = phone;
        // The saved customer is identified by this number. A different number means it no longer
        // matches, so the link is dropped and staff must Save the customer again (A6).
        if (existing.customerId && !samePhone(existing.customerPhone, phone)) {
          updateData.customerId = null;
          customerId = null;
          unlinkedCustomerId = existing.customerId;
        }
      }
      if (data.alternatePhone !== undefined) updateData.alternatePhone = toPlus91(data.alternatePhone);

      // Status transition guards (inside transaction for atomicity)
      if (data.status) {
        const VALID: Record<string, string[]> = {
          PENDING: ["VERIFIED", "WALK_OUT", "SCHEDULED", "FLAGGED", "PREBOOKED"],
          VERIFIED: ["WALK_OUT", "SCHEDULED", "PACKED"],
          SCHEDULED: ["OUT_FOR_DELIVERY", "VERIFIED", "PACKED", "DELIVERED"],
          PACKED: ["SHIPPED", "VERIFIED"],
          SHIPPED: ["IN_TRANSIT"],
          IN_TRANSIT: ["DELIVERED"],
          OUT_FOR_DELIVERY: ["DELIVERED"],
          FLAGGED: ["PENDING"],
          PREBOOKED: ["VERIFIED"],
          DELIVERED: [],
          WALK_OUT: [],
        };
        const allowed = VALID[existing.status] || [];
        if (!allowed.includes(data.status)) {
          throw new Error(`Cannot change from ${existing.status} to ${data.status}`);
        }

        // Schedule and Walk-out require the saved customer (A5, A6) — Delivery.customerId, set by
        // Save Contact (`POST /api/deliveries/[id]/customer`), not merely a phone on the row.
        if ((data.status === "SCHEDULED" || data.status === "WALK_OUT") && !customerId) {
          throw new DeliveryActionError("Save the customer first.", 409);
        }

        // SHIPPED requires tracking number for outstation deliveries
        if (data.status === "SHIPPED" && existing.isOutstation && !existing.courierTrackingNo && !data.courierTrackingNo) {
          throw new Error("Tracking number is required for outstation shipments before marking as Shipped");
        }
      }

      // Copy simple fields (phones are handled above)
      if (data.customerAddress !== undefined) updateData.customerAddress = data.customerAddress;
      if (data.customerArea !== undefined) updateData.customerArea = data.customerArea;
      if (data.customerPincode !== undefined) updateData.customerPincode = data.customerPincode;
      if (data.deliveryNotes !== undefined) updateData.deliveryNotes = data.deliveryNotes;
      if (data.notes !== undefined) updateData.notes = data.notes;

      // Staff date (A28, A36, T9). null clears it — staff may schedule without a date. A date is
      // stored as the start of its IST day and must pass the same 10-per-day slot rule as the
      // customer's calendar. Keeping the delivery's current day is never refused (it already
      // holds that slot, and a past day would otherwise block every later edit). A delivery whose
      // status takes no slot (PREBOOKED, WALK_OUT) is not counted, so it is not checked either.
      if (data.scheduledDate === null) {
        updateData.scheduledDate = null;
      } else if (data.scheduledDate !== undefined) {
        const day = staffDateToISTDay(data.scheduledDate);
        if (!day) throw new DeliveryActionError("Enter a valid delivery date.", 400);
        const currentDay = existing.scheduledDate ? toISTDateString(existing.scheduledDate) : null;
        const effectiveStatus = data.status ?? existing.status;
        if (day !== currentDay && !SLOTLESS_STATUSES.includes(effectiveStatus)) {
          const refusal = await slotRefusal(tx, day, existing.id);
          if (refusal) {
            log.warn("staff date refused", {
              deliveryId: existing.id,
              invoiceNo: existing.invoiceNo,
              day,
              refusal,
            });
            throw new DeliveryActionError(SLOT_REFUSAL_MESSAGE[refusal], 409);
          }
        }
        updateData.scheduledDate = istDayBounds(day).start;
      }

      // Outstation & courier fields
      if (data.isOutstation !== undefined) updateData.isOutstation = data.isOutstation;
      if (data.courierName !== undefined) updateData.courierName = data.courierName;
      if (data.courierTrackingNo !== undefined) updateData.courierTrackingNo = data.courierTrackingNo;
      if (data.courierTrackingLink !== undefined) updateData.courierTrackingLink = data.courierTrackingLink;
      if (data.courierCost !== undefined) updateData.courierCost = data.courierCost;
      if (data.vehicleNo !== undefined) updateData.vehicleNo = data.vehicleNo;
      if (data.freeAccessories !== undefined) updateData.freeAccessories = data.freeAccessories;
      if (data.reversePickup !== undefined) updateData.reversePickup = data.reversePickup;
      if (data.invoiceType !== undefined) updateData.invoiceType = data.invoiceType;
      if (data.mapsLink !== undefined) updateData.mapsLink = data.mapsLink;

      // WhatsApp tracking flags
      if (data.whatsAppScheduledSent !== undefined) updateData.whatsAppScheduledSent = data.whatsAppScheduledSent;
      if (data.whatsAppDispatchedSent !== undefined) updateData.whatsAppDispatchedSent = data.whatsAppDispatchedSent;
      if (data.whatsAppDeliveredSent !== undefined) updateData.whatsAppDeliveredSent = data.whatsAppDeliveredSent;

      if (data.status) {
        updateData.status = data.status;

        if (data.status === "VERIFIED") {
          updateData.verifiedAt = new Date();
          updateData.verifiedById = user.id;
        }

        if (data.status === "OUT_FOR_DELIVERY" || data.status === "SHIPPED") {
          updateData.dispatchedAt = new Date();
        }

        if (data.status === "FLAGGED") {
          updateData.flagReason = data.flagReason || "No reason provided";
          updateData.flaggedAt = new Date();
        }

        // Resolve flag
        if (data.status === "PENDING" && existing.status === "FLAGGED") {
          updateData.flagResolvedAt = new Date();
          updateData.flagResolvedBy = user.id;
        }

        // HOLD stock on SCHEDULED or PACKED, on the matched floor (A46). Never fails on a
        // shortage (A26, A37): all-or-nothing (T5), the move is accepted and the short lines go
        // back to the screen. holdDeliveryStock writes `stockReservedAt` itself when it holds,
        // so updateData must NOT carry that key here or it would overwrite the fresh value.
        if (data.status === "SCHEDULED" || data.status === "PACKED") {
          const hold = await holdDeliveryStock(tx, existing);
          if (!hold.held) {
            stockShort = hold.short;
            log.warn("hold short — status accepted without a hold", {
              deliveryId: existing.id,
              invoiceNo: existing.invoiceNo,
              warehouseId: existing.warehouseId,
              lines: hold.short.length,
            });
          }
        }

        // DEDUCT stock on DELIVERED or WALK_OUT (final handover), from the floor only (A40).
        if (data.status === "DELIVERED" || data.status === "WALK_OUT") {
          updateData.deliveredAt = new Date();
          updateData.stockReservedAt = null;

          // Idempotency: skip if already deducted
          const alreadyDeducted = await tx.inventoryTransaction.findFirst({
            where: { referenceNo: existing.invoiceNo, type: "OUTWARD" },
            select: { id: true },
          });

          if (alreadyDeducted) {
            // The stock already left; a hold still counted on the floor would never be given
            // back once stockReservedAt is cleared below.
            await releaseDeliveryStock(tx, existing);
            log.warn("handover: OUTWARD already recorded, deduction skipped", {
              deliveryId: existing.id,
              invoiceNo: existing.invoiceNo,
            });
          } else {
            // Refuses (plain Error → 400) when the floor is short (A40b); the transaction rolls back.
            const moved = await deductDeliveryFromFloor(
              tx,
              existing,
              existing.warehouse?.name ?? "the floor warehouse"
            );
            for (const line of moved) {
              // Collect only (§F.0); sent after commit.
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
                  referenceNo: existing.invoiceNo,
                  notes: `[ZOHO][VERIFIED] Customer: ${existing.customerName} | Invoice: ${existing.invoiceNo} | ${line.name} x${line.quantity}`,
                  userId: user.id,
                },
              });
            }
          }
        }

        // RELEASE the hold on rollback (SCHEDULED/PACKED → VERIFIED)
        if (data.status === "VERIFIED" && existing.stockReservedAt) {
          await releaseDeliveryStock(tx, existing);
          updateData.stockReservedAt = null;
        }
      }

      return tx.delivery.update({
        where: { id },
        data: updateData,
        include: DELIVERY_INCLUDE,
      });
    });

    // §F.0: committed. Sent after the response has gone out; empty unless this PUT deducted
    // stock, and nothing is sent if the transaction threw.
    after(() => maybeNotifyBelowReorder(crossings));

    if (unlinkedCustomerId) {
      log.warn("customer phone changed — saved customer unlinked", {
        deliveryId: result.id,
        invoiceNo: result.invoiceNo,
        customerId: unlinkedCustomerId,
      });
    }

    log.info("delivery updated", {
      deliveryId: result.id,
      invoiceNo: result.invoiceNo,
      status: data.status ?? null,
      stockShortLines: stockShort.length,
      outwardLines: crossings.length,
    });

    return successResponse({ ...result, isDummy: isDummy(result), stockShort });
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("delivery update refused", { deliveryId, status: error.status });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof DeliveryActionError) {
      log.warn("delivery update refused", { deliveryId, status: error.status, reason: error.message });
      return errorResponse(error.message, error.status);
    }
    log.warn("delivery update failed", {
      deliveryId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to update delivery", 400);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let deliveryId: string | undefined;
  try {
    await requireFeature("deliveries", "delete");
    const { id } = await params;
    deliveryId = id;

    const delivery = await prisma.delivery.findUnique({ where: { id }, select: { status: true } });
    if (!delivery) return errorResponse("Delivery not found", 404);

    const blockedStatuses = ["SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "WALK_OUT"];
    if (blockedStatuses.includes(delivery.status)) {
      return errorResponse(`Cannot delete a delivery in ${delivery.status} status`, 400);
    }

    // Allowed on a Dummy (T2) so duplicates such as INVOICE-003951 can be cleared.
    const deleted = await prisma.$transaction(async (tx) => {
      const existing = await tx.delivery.findUnique({ where: { id } });
      if (!existing) throw new DeliveryActionError("Delivery not found", 404);
      if (blockedStatuses.includes(existing.status)) {
        throw new DeliveryActionError(`Cannot delete a delivery in ${existing.status} status`, 400);
      }

      // Give back the floor hold, if any. No-op when nothing is held or on a Dummy.
      await releaseDeliveryStock(tx, existing);
      await tx.delivery.delete({ where: { id } });
      return { invoiceNo: existing.invoiceNo };
    });

    log.info("delivery deleted", { deliveryId: id, invoiceNo: deleted.invoiceNo });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("delivery delete refused", { deliveryId, status: error.status });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof DeliveryActionError) {
      log.warn("delivery delete refused", { deliveryId, status: error.status, reason: error.message });
      return errorResponse(error.message, error.status);
    }
    log.error("delivery delete failed", {
      deliveryId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to delete delivery", 400);
  }
}
