export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET() {
  try {
    await requireFeature("deliveries", "view");

    const baseWhere = { OR: [{ invoiceType: null as string | null }, { invoiceType: { not: "SERVICE" } }] };

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [pending, verified, scheduled, outForDelivery, deliveredThisMonth, deliveredToday, flagged, prebooked, packed, shipped, inTransit, walkOut, walkOutToday] = await Promise.all([
      prisma.delivery.count({ where: { ...baseWhere, status: "PENDING" } }),
      prisma.delivery.count({ where: { ...baseWhere, status: "VERIFIED" } }),
      prisma.delivery.count({ where: { ...baseWhere, status: "SCHEDULED" } }),
      prisma.delivery.count({ where: { ...baseWhere, status: "OUT_FOR_DELIVERY" } }),
      prisma.delivery.count({ where: { ...baseWhere, status: "DELIVERED", deliveredAt: { gte: startOfMonth } } }),
      prisma.delivery.count({ where: { ...baseWhere, status: "DELIVERED", deliveredAt: { gte: startOfDay } } }),
      prisma.delivery.count({ where: { ...baseWhere, status: "FLAGGED" } }),
      prisma.delivery.count({ where: { ...baseWhere, status: "PREBOOKED" } }),
      prisma.delivery.count({ where: { ...baseWhere, status: "PACKED" } }),
      prisma.delivery.count({ where: { ...baseWhere, status: "SHIPPED" } }),
      prisma.delivery.count({ where: { ...baseWhere, status: "IN_TRANSIT" } }),
      prisma.delivery.count({ where: { ...baseWhere, status: "WALK_OUT", deliveredAt: { gte: startOfMonth } } }),
      prisma.delivery.count({ where: { ...baseWhere, status: "WALK_OUT", deliveredAt: { gte: startOfDay } } }),
    ]);

    return successResponse({
      pending,
      verified,
      scheduled,
      outForDelivery,
      delivered: deliveredThisMonth,
      deliveredToday,
      flagged,
      prebooked,
      packed,
      shipped,
      inTransit,
      walkOut,
      walkOutToday,
      total: pending + verified + scheduled + outForDelivery + flagged + prebooked + packed + shipped + inTransit,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch stats", 500);
  }
}
