export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// GET: List unmatched in-transit line items available for manual pre-booking match
export async function GET() {
  try {
    await requireFeature("deliveries", "view");

    const items = await prisma.inboundLineItem.findMany({
      where: {
        shipment: { status: { in: ["IN_TRANSIT", "PARTIALLY_DELIVERED"] } },
        preBookedCustomerName: null,
        preBooking: null,
      },
      include: {
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            expectedDeliveryDate: true,
            brand: { select: { name: true } },
          },
        },
      },
      orderBy: { shipment: { expectedDeliveryDate: "asc" } },
    });

    return successResponse(items);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}
