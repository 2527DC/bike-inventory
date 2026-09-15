export const revalidate = 120; // cache 2 min

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

interface CriticalAlert {
  type: string;
  message: string;
  owner: string;
  count: number;
}

export async function GET() {
  try {
    await requireFeature("dashboard", "view");

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const h48 = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const h72 = new Date(now.getTime() - 72 * 60 * 60 * 1000);

    // All queries in a single Promise.all for max efficiency
    const [
      inboundStats,
      deliveryStats,
      poStats,
      inwardsVerified,
      inwardsPending,
      deliveriesClosed,
      deliveriesPending,
      expensesRecorded,
      posWithoutTracking,
    ] = await Promise.all([
      // Pending inbound shipments (IN_TRANSIT / PARTIALLY_DELIVERED)
      prisma.$queryRaw<[{ pending: number; overdue24h: number; overdue48h: number; overdue72h: number }]>`
        SELECT
          COUNT(*)::int AS pending,
          COUNT(*) FILTER (WHERE "createdAt" < ${h24})::int AS "overdue24h",
          COUNT(*) FILTER (WHERE "createdAt" < ${h48})::int AS "overdue48h",
          COUNT(*) FILTER (WHERE "createdAt" < ${h72})::int AS "overdue72h"
        FROM "InboundShipment"
        WHERE status IN ('IN_TRANSIT', 'PARTIALLY_DELIVERED')
      `,

      // Pending deliveries with age buckets
      prisma.$queryRaw<[{ pending: number; overdue24h: number; overdue48h: number; overdue72h: number }]>`
        SELECT
          COUNT(*)::int AS pending,
          COUNT(*) FILTER (WHERE "invoiceDate" < ${h24})::int AS "overdue24h",
          COUNT(*) FILTER (WHERE "invoiceDate" < ${h48})::int AS "overdue48h",
          COUNT(*) FILTER (WHERE "invoiceDate" < ${h72})::int AS "overdue72h"
        FROM "Delivery"
        WHERE status IN ('PENDING', 'VERIFIED', 'SCHEDULED')
      `,

      // POs awaiting tracking (uses 48h threshold)
      prisma.$queryRaw<[{ pending: number; overdue48h: number; overdue72h: number }]>`
        SELECT
          COUNT(*)::int AS pending,
          COUNT(*) FILTER (WHERE "orderDate" < ${h48})::int AS "overdue48h",
          COUNT(*) FILTER (WHERE "orderDate" < ${h72})::int AS "overdue72h"
        FROM "PurchaseOrder"
        WHERE status IN ('SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
      `,

      // Verified inwards today (INWARD type, created today, notes NOT containing [UNVERIFIED])
      prisma.$queryRaw<[{ count: number }]>`
        SELECT COUNT(*)::int AS count
        FROM "InventoryTransaction"
        WHERE type = 'INWARD'
          AND "createdAt" >= ${todayStart}
          AND (notes IS NULL OR notes NOT LIKE '%[UNVERIFIED]%')
      `,

      // Pending inwards (shipments not yet delivered)
      prisma.$queryRaw<[{ count: number }]>`
        SELECT COUNT(*)::int AS count
        FROM "InboundShipment"
        WHERE status IN ('IN_TRANSIT', 'PARTIALLY_DELIVERED')
      `,

      // Deliveries closed today
      prisma.delivery.count({
        where: { status: "DELIVERED", deliveredAt: { gte: todayStart } },
      }),

      // Deliveries pending
      prisma.delivery.count({
        where: { status: { in: ["PENDING", "VERIFIED", "SCHEDULED"] } },
      }),

      // Expenses recorded today
      prisma.expense.count({
        where: { date: { gte: todayStart } },
      }),

      // POs without tracking (sent > 48h ago)
      prisma.$queryRaw<[{ count: number }]>`
        SELECT COUNT(*)::int AS count
        FROM "PurchaseOrder"
        WHERE status = 'SENT_TO_VENDOR' AND "orderDate" < ${h48}
      `,
    ]);

    const inbound = inboundStats[0];
    const delivery = deliveryStats[0];
    const po = poStats[0];

    // Build today summary
    const today = {
      inwardsVerified: inwardsVerified[0]?.count || 0,
      inwardsPending: inwardsPending[0]?.count || 0,
      deliveriesClosed,
      deliveriesPending,
      expensesRecorded,
      posWithoutTracking: posWithoutTracking[0]?.count || 0,
    };

    // Build critical alerts (items > 24h/48h needing attention)
    const criticalAlerts: CriticalAlert[] = [];

    if (inbound.overdue24h > 0) {
      criticalAlerts.push({
        type: "inward",
        message: `${inbound.overdue24h} inbound shipment${inbound.overdue24h > 1 ? "s" : ""} pending 24h+${inbound.overdue72h > 0 ? ` (${inbound.overdue72h} over 72h!)` : ""}`,
        owner: "Inbound",
        count: inbound.overdue24h,
      });
    }

    if (delivery.overdue24h > 0) {
      criticalAlerts.push({
        type: "delivery",
        message: `${delivery.overdue24h} deliver${delivery.overdue24h > 1 ? "ies" : "y"} pending 24h+${delivery.overdue72h > 0 ? ` (${delivery.overdue72h} over 72h!)` : ""}`,
        owner: "Dispatch",
        count: delivery.overdue24h,
      });
    }

    if (po.overdue48h > 0) {
      criticalAlerts.push({
        type: "purchase_order",
        message: `${po.overdue48h} PO without tracking 48h+${po.overdue72h > 0 ? ` (${po.overdue72h} over 72h!)` : ""}`,
        owner: "Purchasing",
        count: po.overdue48h,
      });
    }

    // Team-wide Compliance % — Late = items past SLA (Inbound/Delivery 24h, PO 48h)
    const totalOpen = inbound.pending + delivery.pending + po.pending;
    const totalLate = inbound.overdue24h + delivery.overdue24h + po.overdue48h;
    const compliancePct = totalOpen > 0 ? Math.round(((totalOpen - totalLate) / totalOpen) * 100) : 100;

    return successResponse({ today, criticalAlerts, compliancePct, totalOpen, totalLate });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch health summary",
      500
    );
  }
}
