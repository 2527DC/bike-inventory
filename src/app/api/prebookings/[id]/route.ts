export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// GET: Pre-booking detail
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("deliveries", "view");
    const { id } = await params;

    const preBooking = await prisma.preBooking.findUnique({
      where: { id },
      include: {
        brand: { select: { name: true } },
        createdBy: { select: { name: true } },
        matchedShipment: {
          select: { shipmentNo: true, expectedDeliveryDate: true, status: true, brand: { select: { name: true } } },
        },
        matchedLineItem: {
          select: { productName: true, quantity: true, isDelivered: true },
        },
      },
    });

    if (!preBooking) return errorResponse("Not found", 404);
    return successResponse(preBooking);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}

// PUT: Update pre-booking status
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("deliveries", "edit");
    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.preBooking.findUnique({ where: { id } });
    if (!existing) return errorResponse("Not found", 404);

    // Manual match: link pre-booking to a specific inbound line item
    if (body.matchLineItemId) {
      if (existing.status !== "WAITING") {
        return errorResponse("Only WAITING pre-bookings can be matched", 400);
      }

      const lineItem = await prisma.inboundLineItem.findUnique({
        where: { id: body.matchLineItemId },
        include: { shipment: { select: { id: true, expectedDeliveryDate: true } }, preBooking: true },
      });

      if (!lineItem) return errorResponse("Line item not found", 404);
      if (lineItem.preBooking) return errorResponse("Line item already matched to another pre-booking", 400);

      const matched = await prisma.$transaction([
        prisma.preBooking.update({
          where: { id },
          data: {
            status: "MATCHED",
            matchedShipmentId: lineItem.shipment.id,
            matchedLineItemId: lineItem.id,
            expectedDate: lineItem.shipment.expectedDeliveryDate,
          },
        }),
        prisma.inboundLineItem.update({
          where: { id: lineItem.id },
          data: {
            preBookedCustomerName: existing.customerName,
            preBookedCustomerPhone: existing.customerPhone,
            preBookedInvoiceNo: existing.zohoInvoiceNo,
          },
        }),
      ]);

      return successResponse(matched[0]);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {};

    if (body.status) {
      updateData.status = body.status;
      if (body.status === "FULFILLED") updateData.fulfilledAt = new Date();
      if (body.status === "CANCELLED") {
        updateData.matchedShipmentId = null;
        updateData.matchedLineItemId = null;
        updateData.expectedDate = null;
        // Clear line item's pre-booking info
        if (existing.matchedLineItemId) {
          await prisma.inboundLineItem.update({
            where: { id: existing.matchedLineItemId },
            data: { preBookedCustomerName: null, preBookedCustomerPhone: null, preBookedInvoiceNo: null },
          });
        }
      }
    }

    const updated = await prisma.preBooking.update({
      where: { id },
      data: updateData,
      include: {
        brand: { select: { name: true } },
        matchedShipment: { select: { shipmentNo: true } },
      },
    });

    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 400);
  }
}
