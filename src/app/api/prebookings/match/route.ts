export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// POST: Auto-match waiting pre-bookings to in-transit shipment line items
export async function POST() {
  try {
    await requireFeature("deliveries", "approve");

    const waitingPreBookings = await prisma.preBooking.findMany({
      where: { status: "WAITING" },
    });

    if (waitingPreBookings.length === 0) {
      return successResponse({ matched: 0, message: "No waiting pre-bookings" });
    }

    // Get all in-transit line items not yet matched
    const availableLineItems = await prisma.inboundLineItem.findMany({
      where: {
        shipment: { status: "IN_TRANSIT" },
        preBookedCustomerName: null,
        preBooking: null,
      },
      include: {
        shipment: { select: { id: true, expectedDeliveryDate: true } },
      },
    });

    let matched = 0;

    for (const pb of waitingPreBookings) {
      const match = availableLineItems.find((li) =>
        li.productName.toLowerCase().includes(pb.productName.toLowerCase().substring(0, 15))
        || pb.productName.toLowerCase().includes(li.productName.toLowerCase().substring(0, 15))
      );

      if (match) {
        await prisma.$transaction([
          prisma.preBooking.update({
            where: { id: pb.id },
            data: {
              status: "MATCHED",
              matchedShipmentId: match.shipment.id,
              matchedLineItemId: match.id,
              expectedDate: match.shipment.expectedDeliveryDate,
            },
          }),
          prisma.inboundLineItem.update({
            where: { id: match.id },
            data: {
              preBookedCustomerName: pb.customerName,
              preBookedCustomerPhone: pb.customerPhone,
              preBookedInvoiceNo: pb.zohoInvoiceNo,
            },
          }),
        ]);

        // Remove from available to prevent double-matching
        const idx = availableLineItems.indexOf(match);
        availableLineItems.splice(idx, 1);
        matched++;
      }
    }

    return successResponse({ matched, total: waitingPreBookings.length });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}
