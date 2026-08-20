export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET() {
  try {
    await requireFeature("inbound", "view");

    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + (7 - weekEnd.getDay()));

    const [inTransit, arrivingThisWeek, preBookingsWaiting, deliveredThisMonth] = await Promise.all([
      prisma.inboundShipment.aggregate({
        where: { status: "IN_TRANSIT" },
        _sum: { totalItems: true },
        _count: true,
      }),
      prisma.inboundShipment.aggregate({
        where: {
          status: "IN_TRANSIT",
          expectedDeliveryDate: { lte: weekEnd },
        },
        _sum: { totalItems: true },
        _count: true,
      }),
      prisma.preBooking.count({
        where: { status: "WAITING" },
      }),
      prisma.inboundShipment.count({
        where: {
          status: "DELIVERED",
          deliveredAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) },
        },
      }),
    ]);

    return successResponse({
      inTransit: {
        shipments: inTransit._count,
        items: inTransit._sum.totalItems || 0,
      },
      arrivingThisWeek: {
        shipments: arrivingThisWeek._count,
        items: arrivingThisWeek._sum.totalItems || 0,
      },
      preBookingsWaiting,
      deliveredThisMonth,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}
