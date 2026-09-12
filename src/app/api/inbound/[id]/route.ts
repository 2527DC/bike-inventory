export const dynamic = "force-dynamic";

export const runtime = "nodejs";
// nodejs, explicitly: receiving the last line finishes the shipment, which reaches SMTP and
// the FCM JWT signer through notify(), and Zoho Books through createBill(). None of that
// works on the edge runtime, and the failure there is not self-explanatory.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { BIN_TRACKING_ENABLED } from "@/lib/inventory-config";
import { resolveWarehouse } from "@/lib/warehouses";
import { adjustWarehouseQty, deductAnywhere } from "@/lib/stock-location";
import { inboundReceiveLineSchema, inboundCategorySchema } from "@/lib/validations";
import { nextUnitCode } from "@/lib/sequence";
import { logActivity } from "@/lib/activity-log";
import { finaliseDelivered, scheduleDeliveredSideEffects } from "@/lib/inbound/complete-shipment";
import { createLogger } from "@/lib/logger";

const log = createLogger("inbound:detail");

// GET: Shipment detail
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("inbound", "view");
    const { id } = await params;

    const shipment = await prisma.inboundShipment.findUnique({
      where: { id },
      include: {
        brand: { select: { name: true } },
        // The receiving gate: no line can be received until this is set (R3). `parent` so the
        // picker and the header can show "Spare Parts › Tyres" rather than a bare leaf name.
        category: { select: { id: true, name: true, parent: { select: { name: true } } } },
        createdBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
        deliveredBy: { select: { name: true } },
        putawayBy: { select: { name: true } },
        lineItems: {
          include: {
            product: { select: { name: true, sku: true } },
            bin: { select: { id: true, code: true, name: true, location: true } },
            preBooking: { select: { id: true, customerName: true, status: true } },
          },
        },
        vendorBill: { select: { vendorId: true } },
        preBookings: {
          select: { id: true, customerName: true, customerPhone: true, status: true, productName: true },
        },
      },
    });

    if (!shipment) return errorResponse("Not found", 404);
    return successResponse(shipment);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}

// PUT: Update shipment (mark line items delivered, update notes)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireFeature("inbound", "edit");
    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.inboundShipment.findUnique({ where: { id } });
    if (!existing) return errorResponse("Not found", 404);

    // ─── SET THE SHIPMENT CATEGORY (R3) ───────────────────────────────────────────────────
    //
    // Cycles / Spares / Accessories used to live in ONE phone's localStorage, so the shipment
    // read as uncategorised to everybody else and lost the value whenever that browser
    // cleared. It is a property of the shipment, so it is a column now (MIG-1a).
    if (body.categoryId !== undefined && body.lineItemId === undefined) {
      const parsed = inboundCategorySchema.safeParse(body);
      if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request", 400);

      const category = await prisma.category.findUnique({
        where: { id: parsed.data.categoryId },
        select: { id: true, name: true },
      });
      if (!category) return errorResponse("That category does not exist", 400);

      // Refused once anything has been received: the category decides how the lines are
      // handled, so changing it afterwards would re-interpret stock already in the building.
      const received = await prisma.inboundLineItem.count({
        where: { shipmentId: id, isDelivered: true },
      });
      if (received > 0) {
        return errorResponse(
          "Items have already been received on this shipment, so its category can no longer be changed.",
          400
        );
      }

      const previous = existing.categoryId
        ? await prisma.category.findUnique({ where: { id: existing.categoryId }, select: { name: true } })
        : null;

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.inboundShipment.update({
          where: { id },
          data: { categoryId: category.id },
          include: { category: { select: { id: true, name: true } } },
        });
        await logActivity(tx, {
          module: "inbound",
          action: "updated",
          entityType: "InboundShipment",
          entityId: id,
          entityRef: existing.shipmentNo,
          fromValue: previous?.name ?? null,
          toValue: category.name,
          details: "category",
          userId: user.id,
          userName: user.name,
        });
        return row;
      });

      log.info("shipment category set", { shipmentId: id, categoryId: category.id });
      return successResponse(updated);
    }

    // ─── RECEIVE ONE LINE (R3) ────────────────────────────────────────────────────────────
    //
    // Per LINE, and the shipment finishes itself: when the last outstanding line is received
    // the transition into DELIVERED is claimed here, so the Mark All / Partial / Undo buttons
    // and the whole [id]/status route are gone.
    if (body.lineItemId !== undefined) {
      const parsed = inboundReceiveLineSchema.safeParse(body);
      if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request", 400);
      const { lineItemId, deliveredQty: qty, warehouseId } = parsed.data;

      // ── Gates, all before the transaction ──
      //
      // The per-line route had NO approval gate at all: stock could be received into a
      // shipment nobody had approved.
      if (existing.status === "DELIVERED") {
        return errorResponse("This shipment is already fully received", 400);
      }
      if (!existing.approvedAt) {
        return errorResponse("This shipment has not been approved yet", 403);
      }
      if (!existing.categoryId) {
        return errorResponse("Choose the shipment category before receiving", 400);
      }

      const lineItem = await prisma.inboundLineItem.findUnique({
        where: { id: lineItemId },
        include: {
          shipment: { include: { brand: { select: { name: true } } } },
          preBooking: true,
        },
      });
      if (!lineItem) return errorResponse("Line item not found", 404);
      if (lineItem.shipmentId !== id) {
        return errorResponse("That line item belongs to a different shipment", 400);
      }
      // D6: the blue button receives the FULL bill quantity. A shortage is a vendor issue,
      // not a smaller receipt — otherwise the shortfall silently becomes the new truth.
      if (qty !== lineItem.quantity) {
        return errorResponse(
          `Receive the full billed quantity (${lineItem.quantity}). For a short delivery, use Report Issue.`,
          400
        );
      }

      const resolved = await resolveWarehouse(warehouseId);
      if ("error" in resolved) return errorResponse(resolved.error, 400);
      const warehouse = resolved.warehouse;

      const binAllocations: Array<{ binId: string; qty: number }> = body.binAllocations || (body.binId ? [{ binId: body.binId, qty }] : []);
      if (BIN_TRACKING_ENABLED && binAllocations.length === 0) {
        return errorResponse("Bin assignment is required when marking items delivered", 400);
      }
      const primaryBinId = binAllocations[0]?.binId ?? null;

      const outcome = await prisma.$transaction(async (tx) => {
        // ── THE IDEMPOTENT CLAIM ──
        //
        // `isDelivered` used to be read OUTSIDE the transaction (`wasDelivered`), so two taps
        // in quick succession both saw false and both added the stock — a double-tap on a
        // phone silently doubled the received quantity. Letting the database decide makes
        // that impossible: exactly one caller gets count === 1.
        const claim = await tx.inboundLineItem.updateMany({
          where: { id: lineItemId, isDelivered: false },
          data: { isDelivered: true, deliveredQty: qty, ...(primaryBinId ? { binId: primaryBinId } : {}) },
        });
        if (claim.count === 0) {
          return { updated: false, alreadyReceived: true, shipmentDelivered: false, snapshot: null };
        }

        {
          const searchName = lineItem.productName.substring(0, 20);
          const matchedProduct = lineItem.productId
            ? await tx.product.findUnique({ where: { id: lineItem.productId } })
            : await tx.product.findFirst({
                where: { name: { contains: searchName, mode: "insensitive" } },
              });

          if (!matchedProduct) {
            throw new Error(`Product not found for "${lineItem.productName}" — import it from Zoho Items first`);
          }

          let runningStock = matchedProduct.currentStock;
          if (BIN_TRACKING_ENABLED && binAllocations.length) {
            // Create one inventory transaction per bin allocation
            for (const alloc of binAllocations) {
              const previousStock = runningStock;
              runningStock += alloc.qty;
              await tx.inventoryTransaction.create({
                data: {
                  type: "INWARD",
                  productId: matchedProduct.id,
                  quantity: alloc.qty,
                  previousStock,
                  newStock: runningStock,
                  referenceNo: lineItem.shipment.shipmentNo,
                  notes: `[INBOUND] Brand: ${lineItem.shipment.brand.name} | Bill: ${lineItem.shipment.billNo} | ${lineItem.productName} x${alloc.qty} → Bin: ${alloc.binId.slice(-6)}`,
                  userId: user.id,
                },
              });
            }
            await tx.product.update({
              where: { id: matchedProduct.id },
              data: { currentStock: runningStock, binId: primaryBinId },
            });
          } else {
            // Location mode: add qty to the chosen location; currentStock recomputes as the sum.
            const previousStock = runningStock;
            runningStock += qty;
            await tx.inventoryTransaction.create({
              data: {
                type: "INWARD",
                productId: matchedProduct.id,
                quantity: qty,
                previousStock,
                newStock: runningStock,
                referenceNo: lineItem.shipment.shipmentNo,
                notes: `[INBOUND] Brand: ${lineItem.shipment.brand.name} | Bill: ${lineItem.shipment.billNo} | ${lineItem.productName} x${qty} → ${warehouse.name}`,
                userId: user.id,
              },
            });
            await adjustWarehouseQty(tx, matchedProduct.id, warehouse.id, qty);
          }

          // ── Mint company-wide unit codes U-xxxxxx for bicycles (R2, R6, R19) ──
          const shipmentCat = existing.categoryId
            ? await tx.category.findUnique({ where: { id: existing.categoryId }, select: { name: true } })
            : null;
          const isCycle =
            shipmentCat?.name.toLowerCase().includes("cycle") ||
            shipmentCat?.name.toLowerCase().includes("bike") ||
            matchedProduct.tags.some((t) => t.toLowerCase().includes("bicycle") || t.toLowerCase().includes("cycle"));

          if (isCycle) {
            for (let i = 0; i < qty; i++) {
              const unitCode = await nextUnitCode(tx);
              await tx.inventoryUnit.create({
                data: {
                  unitCode,
                  productId: matchedProduct.id,
                  warehouseId: warehouse.id,
                  binId: primaryBinId,
                  status: primaryBinId ? "PUT_AWAY" : "RECEIVED",
                  inboundShipmentId: id,
                },
              });
            }
          }

          if (primaryBinId) {
            await tx.binStock.upsert({
              where: { binId_productId: { binId: primaryBinId, productId: matchedProduct.id } },
              update: { quantity: { increment: qty } },
              create: { binId: primaryBinId, productId: matchedProduct.id, quantity: qty },
            });
            await tx.binMovementLog.create({
              data: {
                warehouseId: warehouse.id,
                productId: matchedProduct.id,
                quantity: qty,
                fromBinId: null,
                toBinId: primaryBinId,
                reason: "Inbound receiving put-away",
                movedById: user.id,
              },
            });
          }

          // Auto-create delivery for pre-booked items so outwards clerk can see it
          if (lineItem.preBookedCustomerName) {
            const existingDelivery = await tx.delivery.findFirst({
              where: { invoiceNo: lineItem.preBookedInvoiceNo || `PB-${lineItem.id}` },
            });
            if (!existingDelivery) {
              await tx.delivery.create({
                data: {
                  invoiceNo: lineItem.preBookedInvoiceNo || `PB-${lineItem.id}`,
                  invoiceDate: new Date(),
                  invoiceAmount: 0,
                  customerName: lineItem.preBookedCustomerName,
                  customerPhone: lineItem.preBookedCustomerPhone || null,
                  status: "PENDING",
                  prebookNotes: `Pre-booked item arrived: ${lineItem.productName} x${qty} | ${lineItem.shipment.brand.name} | ${lineItem.shipment.shipmentNo}`,
                  lineItems: [{ name: lineItem.productName, quantity: qty }],
                  verifiedById: user.id,
                },
              });
            }
          }

          // Fulfill the pre-booking if matched
          if (lineItem.preBooking) {
            await tx.preBooking.update({
              where: { id: lineItem.preBooking.id },
              data: { status: "FULFILLED", fulfilledAt: new Date() },
            });
          }
        }

        await logActivity(tx, {
          module: "inbound",
          action: "received",
          entityType: "InboundShipment",
          entityId: id,
          entityRef: existing.shipmentNo,
          details: `${lineItem.productName} ×${qty} → ${warehouse.name}`,
          userId: user.id,
          userName: user.name,
        });

        // ── DOES THIS FINISH THE SHIPMENT? ──
        //
        // Asked here, inside the transaction, off the row the claim just wrote — so the
        // count cannot race with another line being received at the same moment.
        const remaining = await tx.inboundLineItem.count({
          where: { shipmentId: id, isDelivered: false },
        });

        if (remaining === 0) {
          const snapshot = await finaliseDelivered(tx, id, user.id, user.name, existing.status);
          return { updated: true, alreadyReceived: false, shipmentDelivered: Boolean(snapshot), snapshot };
        }

        // The FIRST receipt is a real state change and used to be invisible: a partially
        // received shipment showed N receipts and no transition, so nothing distinguished
        // "nobody has started" from "half of it is in".
        if (existing.status === "IN_TRANSIT") {
          await tx.inboundShipment.update({
            where: { id },
            data: { status: "PARTIALLY_DELIVERED" },
          });
          await logActivity(tx, {
            module: "inbound",
            action: "status_changed",
            entityType: "InboundShipment",
            entityId: id,
            entityRef: existing.shipmentNo,
            fromValue: "IN_TRANSIT",
            toValue: "PARTIALLY_DELIVERED",
            details: `${remaining} line(s) still to receive`,
            userId: user.id,
            userName: user.name,
          });
        }

        return { updated: true, alreadyReceived: false, shipmentDelivered: false, snapshot: null };
      });

      // AFTER the transaction resolved, never inside it. `after()` fires even when the
      // response throws, so registering the Zoho push inside would bill a shipment that then
      // rolled back — and a rollback cannot recall a bill from someone else's books.
      if (outcome.snapshot) {
        scheduleDeliveredSideEffects(outcome.snapshot, { id: user.id, name: user.name });
      }

      log.info("line received", {
        shipmentId: id,
        lineItemId,
        qty,
        warehouseId: warehouse.id,
        alreadyReceived: outcome.alreadyReceived,
        shipmentDelivered: outcome.shipmentDelivered,
      });

      return successResponse({
        updated: outcome.updated,
        alreadyReceived: outcome.alreadyReceived,
        shipmentDelivered: outcome.shipmentDelivered,
      });
    }

    // Update notes
    if (body.notes !== undefined) {
      const updated = await prisma.inboundShipment.update({
        where: { id },
        data: { notes: body.notes },
      });
      return successResponse(updated);
    }

    // Mark WhatsApp sent for a line item
    if (body.lineItemId && body.whatsAppSent) {
      await prisma.inboundLineItem.update({
        where: { id: body.lineItemId },
        data: { whatsAppSent: true },
      });
      return successResponse({ updated: true });
    }

    return errorResponse("No valid update fields", 400);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 400);
  }
}

// DELETE: Remove shipment (admin only, only if no stock was added)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("inbound", "delete");
    const { id } = await params;

    const shipment = await prisma.inboundShipment.findUnique({
      where: { id },
      include: { lineItems: true },
    });
    if (!shipment) return errorResponse("Not found", 404);

    await prisma.$transaction(async (tx) => {
      // Reverse stock for delivered items
      for (const li of shipment.lineItems) {
        if (li.isDelivered && li.productId) {
          const qty = li.deliveredQty ?? li.quantity;
          const product = await tx.product.findUnique({ where: { id: li.productId } });
          if (product && qty > 0) {
            // THE FIX (R12). Was `currentStock: Math.max(0, currentStock - qty)`, which moved
            // the cache and left StockLevel holding the units — so the next recompute undid
            // the undo and the deleted shipment's stock came straight back.
            //
            // `deductAnywhere` rather than a specific warehouse because the one the receipt
            // went into is not recorded: it arrives in the request body at receive time and
            // InboundLineItem has no column for it. See that helper's note.
            await deductAnywhere(tx, product.id, qty, `${li.productName} (${product.sku})`);
          }
          // Delete inventory transactions for this shipment
          await tx.inventoryTransaction.deleteMany({
            where: { productId: li.productId, referenceNo: shipment.shipmentNo, type: "INWARD" },
          });
        }
      }

      // Reset pre-bookings
      await tx.preBooking.updateMany({
        where: { matchedShipmentId: id },
        data: { status: "WAITING", matchedShipmentId: null, matchedLineItemId: null },
      });

      // Delete line items, then shipment
      await tx.inboundLineItem.deleteMany({ where: { shipmentId: id } });

      // Delete linked VendorBill (so it can be re-fetched from Zoho)
      if (shipment.vendorBillId) {
        // Only delete if no payments recorded against it
        const paymentCount = await tx.vendorPayment.count({ where: { billId: shipment.vendorBillId } });
        if (paymentCount === 0) {
          await tx.vendorBill.delete({ where: { id: shipment.vendorBillId } });
        } else {
          // Unlink but keep the VendorBill
          await tx.inboundShipment.update({ where: { id }, data: { vendorBillId: null } });
        }
      }

      await tx.inboundShipment.delete({ where: { id } });
    });

    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to delete", 400);
  }
}
