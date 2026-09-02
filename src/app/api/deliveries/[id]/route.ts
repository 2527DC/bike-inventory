export const dynamic = "force-dynamic";

import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { deliveryUpdateSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { maybeNotifyBelowReorder, type ReorderCrossing } from "@/lib/notify/stock";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("deliveries", "view");
    const { id } = await params;

    const delivery = await prisma.delivery.findUnique({
      where: { id },
      include: { verifiedBy: { select: { name: true } } },
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
    } catch { /* CustomerInvoice table might not exist yet */ }

    return successResponse({ ...delivery, paymentStatus });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch delivery", 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("deliveries", "edit");
    const { id } = await params;
    const body = await req.json();
    const data = deliveryUpdateSchema.parse(body);

    const preCheck = await prisma.delivery.findUnique({ where: { id } });
    if (!preCheck) return errorResponse("Delivery not found", 404);

    // §F.0: filled INSIDE the transaction (only the DELIVERED / WALK_OUT deduction below moves
    // currentStock down), sent AFTER it commits. Reservation and release touch reservedStock
    // only and cannot cross the reorder line.
    const crossings: ReorderCrossing[] = [];

    const result = await prisma.$transaction(async (tx) => {
      // Re-read inside transaction to prevent race conditions
      const existing = await tx.delivery.findUnique({ where: { id } });
      if (!existing) throw new Error("Delivery not found");

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

        // Walk-out requires customer phone to be saved
        if (data.status === "WALK_OUT" && !existing.customerPhone) {
          throw new Error("Cannot walk-out without saving customer contact first");
        }

        // SHIPPED requires tracking number for outstation deliveries
        if (data.status === "SHIPPED" && existing.isOutstation && !existing.courierTrackingNo && !data.courierTrackingNo) {
          throw new Error("Tracking number is required for outstation shipments before marking as Shipped");
        }
      }
      const updateData: Record<string, unknown> = {};

      // Copy simple fields
      if (data.customerAddress !== undefined) updateData.customerAddress = data.customerAddress;
      if (data.customerArea !== undefined) updateData.customerArea = data.customerArea;
      if (data.customerPincode !== undefined) updateData.customerPincode = data.customerPincode;
      if (data.customerPhone !== undefined) updateData.customerPhone = data.customerPhone;
      if (data.alternatePhone !== undefined) updateData.alternatePhone = data.alternatePhone;
      if (data.deliveryNotes !== undefined) updateData.deliveryNotes = data.deliveryNotes;
      if (data.notes !== undefined) updateData.notes = data.notes;
      if (data.scheduledDate) updateData.scheduledDate = new Date(data.scheduledDate);

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

        // Mark delivered timestamp + clear reservation
        if (data.status === "DELIVERED") {
          updateData.deliveredAt = new Date();
          updateData.stockReservedAt = null;
        }
        if (data.status === "WALK_OUT") {
          updateData.stockReservedAt = null;
        }

        // RESERVE stock on SCHEDULED or PACKED (don't deduct yet)
        if (data.status === "SCHEDULED" || data.status === "PACKED") {
          if (!existing.stockReservedAt) {
            const items = (existing.lineItems as Array<{ name: string; sku: string; quantity: number; rate: number }>) || [];
            for (const item of items) {
              if (!item.sku) continue;
              const product = await tx.product.findFirst({
                where: { sku: item.sku, bin: { location: { startsWith: "Bharath Cycle Hub" } } },
                select: { id: true, currentStock: true, reservedStock: true },
              }) || await tx.product.findFirst({
                where: { sku: item.sku },
                select: { id: true, currentStock: true, reservedStock: true },
              });
              if (!product) continue;

              const available = product.currentStock - product.reservedStock;
              if (available < item.quantity) {
                throw new Error(`Insufficient available stock for ${item.name} (SKU: ${item.sku}). Available: ${available}, Needed: ${item.quantity}`);
              }
              await tx.product.update({
                where: { id: product.id },
                data: { reservedStock: product.reservedStock + item.quantity },
              });
            }
            updateData.stockReservedAt = new Date();
          }
        }

        // DEDUCT stock on DELIVERED or WALK_OUT (final handover)
        if (data.status === "DELIVERED" || data.status === "WALK_OUT") {
          if (data.status === "WALK_OUT") updateData.deliveredAt = new Date();

          // Idempotency: skip if already deducted
          const alreadyDeducted = await tx.inventoryTransaction.findFirst({
            where: { referenceNo: existing.invoiceNo, type: "OUTWARD" },
          });

          if (!alreadyDeducted) {
            const items = (existing.lineItems as Array<{ name: string; sku: string; quantity: number; rate: number }>) || [];
            for (const item of items) {
              if (!item.sku) continue;
              const product = await tx.product.findFirst({
                where: { sku: item.sku, bin: { location: { startsWith: "Bharath Cycle Hub" } } },
                select: { id: true, currentStock: true, reservedStock: true },
              }) || await tx.product.findFirst({
                where: { sku: item.sku },
                select: { id: true, currentStock: true, reservedStock: true },
              });
              if (!product) continue;

              const wasReserved = !!existing.stockReservedAt;
              if (wasReserved) {
                // Stock was reserved — deduct both
                const newStock = product.currentStock - item.quantity;
                if (newStock < 0) {
                  throw new Error(`Insufficient stock for ${item.name} (SKU: ${item.sku}). Available: ${product.currentStock}, Needed: ${item.quantity}`);
                }
                await tx.product.update({
                  where: { id: product.id },
                  data: {
                    currentStock: newStock,
                    reservedStock: Math.max(0, product.reservedStock - item.quantity),
                  },
                });
              } else {
                // Direct walk-out (no prior reservation) — check available stock
                const available = product.currentStock - product.reservedStock;
                if (available < item.quantity) {
                  throw new Error(`Insufficient available stock for ${item.name} (SKU: ${item.sku}). Available: ${available}, Needed: ${item.quantity}`);
                }
                await tx.product.update({
                  where: { id: product.id },
                  data: { currentStock: product.currentStock - item.quantity },
                });
              }

              // Both branches above moved currentStock DOWN by item.quantity — reserved or direct
              // walk-out alike — so both can cross the reorder line. Collect only (§F.0).
              crossings.push({
                productId: product.id,
                previousStock: product.currentStock,
                newStock: product.currentStock - item.quantity,
              });
              await tx.inventoryTransaction.create({
                data: {
                  type: "OUTWARD",
                  productId: product.id,
                  quantity: item.quantity,
                  previousStock: product.currentStock,
                  newStock: product.currentStock - item.quantity,
                  referenceNo: existing.invoiceNo,
                  notes: `[ZOHO][VERIFIED] Customer: ${existing.customerName} | Invoice: ${existing.invoiceNo} | ${item.name} x${item.quantity}`,
                  userId: user.id,
                },
              });
            }
          }
        }

        // RELEASE reservation on rollback (SCHEDULED/PACKED → VERIFIED)
        if (data.status === "VERIFIED" && existing.stockReservedAt) {
          const items = (existing.lineItems as Array<{ name: string; sku: string; quantity: number; rate: number }>) || [];
          for (const item of items) {
            if (!item.sku) continue;
            const product = await tx.product.findFirst({
              where: { sku: item.sku, bin: { location: { startsWith: "Bharath Cycle Hub" } } },
              select: { id: true, reservedStock: true },
            }) || await tx.product.findFirst({
              where: { sku: item.sku },
              select: { id: true, reservedStock: true },
            });
            if (!product) continue;
            await tx.product.update({
              where: { id: product.id },
              data: { reservedStock: Math.max(0, product.reservedStock - item.quantity) },
            });
          }
          updateData.stockReservedAt = null;
        }
      }

      return tx.delivery.update({
        where: { id },
        data: updateData,
        include: { verifiedBy: { select: { name: true } } },
      });
    });

    // §F.0: committed. Sent after the response has gone out; empty unless this PUT deducted
    // stock, and nothing is sent if the transaction threw.
    after(() => maybeNotifyBelowReorder(crossings));

    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update delivery", 400);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("deliveries", "delete");
    const { id } = await params;

    const delivery = await prisma.delivery.findUnique({ where: { id } });
    if (!delivery) return errorResponse("Delivery not found", 404);

    const blockedStatuses = ["SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "WALK_OUT"];
    if (blockedStatuses.includes(delivery.status)) {
      return errorResponse(`Cannot delete a delivery in ${delivery.status} status`, 400);
    }

    await prisma.$transaction(async (tx) => {
      // Release reserved stock if delivery had a reservation
      if (delivery.stockReservedAt) {
        const items = (delivery.lineItems as Array<{ name: string; sku: string; quantity: number; rate: number }>) || [];
        for (const item of items) {
          if (!item.sku) continue;
          const product = await tx.product.findFirst({
            where: { sku: item.sku, bin: { location: { startsWith: "Bharath Cycle Hub" } } },
            select: { id: true, reservedStock: true },
          }) || await tx.product.findFirst({
            where: { sku: item.sku },
            select: { id: true, reservedStock: true },
          });
          if (!product) continue;
          await tx.product.update({
            where: { id: product.id },
            data: { reservedStock: Math.max(0, product.reservedStock - item.quantity) },
          });
        }
      }

      await tx.delivery.delete({ where: { id } });
    });

    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to delete delivery", 400);
  }
}
