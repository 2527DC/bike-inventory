export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { BIN_TRACKING_ENABLED } from "@/lib/inventory-config";
import { resolveWarehouse } from "@/lib/warehouses";
import { adjustWarehouseQty } from "@/lib/stock-location";

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

    // Update individual line item delivery + add stock + auto-create delivery for pre-booked
    //
    // inbound.delivered is deliberately NOT wired here, although the notifications plan (§F.3)
    // lists this file. This handler never writes InboundShipment.status — it marks ONE line item
    // delivered and adds its stock; the shipment stays IN_TRANSIT / PARTIALLY_DELIVERED until
    // someone marks it DELIVERED through [id]/status, which is the only site that fires.
    if (body.lineItemId && body.deliveredQty !== undefined) {
      const lineItem = await prisma.inboundLineItem.findUnique({
        where: { id: body.lineItemId },
        include: {
          shipment: { include: { brand: { select: { name: true } } } },
          preBooking: true,
        },
      });
      if (!lineItem) return errorResponse("Line item not found", 404);

      const wasDelivered = lineItem.isDelivered;
      const nowDelivered = body.deliveredQty > 0;
      const qty = body.deliveredQty;

      // Bin mode (dormant): per-unit bin allocation. Location mode (active): receive
      // the whole line into one location (default Store).
      const binAllocations: Array<{ binId: string; qty: number }> = body.binAllocations || (body.binId ? [{ binId: body.binId, qty }] : []);
      if (BIN_TRACKING_ENABLED && binAllocations.length === 0) {
        return errorResponse("Bin assignment is required when marking items delivered", 400);
      }
      const primaryBinId = binAllocations[0]?.binId ?? null;
      const resolved = await resolveWarehouse(body.warehouseId ?? body.location);
      if ("error" in resolved) return errorResponse(resolved.error, 400);
      const warehouse = resolved.warehouse;

      await prisma.$transaction(async (tx) => {
        await tx.inboundLineItem.update({
          where: { id: body.lineItemId },
          data: { isDelivered: nowDelivered, deliveredQty: qty, ...(primaryBinId ? { binId: primaryBinId } : {}) },
        });

        // Add stock only when newly marking as delivered (not already delivered)
        if (nowDelivered && !wasDelivered && qty > 0) {
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
      });

      return successResponse({ updated: true });
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
            await tx.product.update({
              where: { id: product.id },
              data: { currentStock: Math.max(0, product.currentStock - qty) },
            });
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
