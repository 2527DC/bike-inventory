export const revalidate = 120; // cache 2 min

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

interface PersonStats {
  name: string;
  role: string;
  pending: number;
  overdue24h: number;
  overdue48h: number;
  overdue72h: number;
}

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
      // Nithin — unverified inwards
      nithinStats,
      // Ranjitha — pending deliveries
      ranjithaStats,
      // Abhi Gowda — POs awaiting tracking
      abhiStats,
      // Sravan — expenses today
      sravanExpensesToday,
      // Today's summary
      inwardsVerified,
      inwardsPending,
      deliveriesClosed,
      deliveriesPending,
      expensesRecorded,
      posWithoutTracking,
    ] = await Promise.all([
      // --- Nithin: pending inbound shipments (IN_TRANSIT / PARTIALLY_DELIVERED) ---
      prisma.$queryRaw<[{ pending: number; overdue24h: number; overdue48h: number; overdue72h: number }]>`
        SELECT
          COUNT(*)::int AS pending,
          COUNT(*) FILTER (WHERE "createdAt" < ${h24})::int AS "overdue24h",
          COUNT(*) FILTER (WHERE "createdAt" < ${h48})::int AS "overdue48h",
          COUNT(*) FILTER (WHERE "createdAt" < ${h72})::int AS "overdue72h"
        FROM "InboundShipment"
        WHERE status IN ('IN_TRANSIT', 'PARTIALLY_DELIVERED')
      `,

      // --- Ranjitha: pending deliveries with age buckets ---
      prisma.$queryRaw<[{ pending: number; overdue24h: number; overdue48h: number; overdue72h: number }]>`
        SELECT
          COUNT(*)::int AS pending,
          COUNT(*) FILTER (WHERE "invoiceDate" < ${h24})::int AS "overdue24h",
          COUNT(*) FILTER (WHERE "invoiceDate" < ${h48})::int AS "overdue48h",
          COUNT(*) FILTER (WHERE "invoiceDate" < ${h72})::int AS "overdue72h"
        FROM "Delivery"
        WHERE status IN ('PENDING', 'VERIFIED', 'SCHEDULED')
      `,

      // --- Abhi Gowda: POs awaiting tracking (uses 48h threshold) ---
      prisma.$queryRaw<[{ pending: number; overdue48h: number; overdue72h: number }]>`
        SELECT
          COUNT(*)::int AS pending,
          COUNT(*) FILTER (WHERE "orderDate" < ${h48})::int AS "overdue48h",
          COUNT(*) FILTER (WHERE "orderDate" < ${h72})::int AS "overdue72h"
        FROM "PurchaseOrder"
        WHERE status IN ('SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
      `,

      // --- Sravan: expenses recorded today ---
      prisma.expense.count({
        where: { date: { gte: todayStart } },
      }),

      // --- Today's summary queries ---
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

    const nithin = nithinStats[0];
    const ranjitha = ranjithaStats[0];
    const abhi = abhiStats[0];

    // Build people array
    const people: PersonStats[] = [
      {
        name: "Nithin",
        role: "Inventory & Receiving Lead",
        pending: nithin.pending,
        overdue24h: nithin.overdue24h,
        overdue48h: nithin.overdue48h,
        overdue72h: nithin.overdue72h,
      },
      {
        name: "Ranjitha",
        role: "Sales & Dispatch Lead",
        pending: ranjitha.pending,
        overdue24h: ranjitha.overdue24h,
        overdue48h: ranjitha.overdue48h,
        overdue72h: ranjitha.overdue72h,
      },
      {
        name: "Abhi Gowda",
        role: "Purchase Manager",
        pending: abhi.pending,
        overdue24h: 0, // POs use 48h threshold, not 24h
        overdue48h: abhi.overdue48h,
        overdue72h: abhi.overdue72h,
      },
      {
        name: "Sravan",
        role: "Accounts Manager",
        pending: sravanExpensesToday,
        overdue24h: 0,
        overdue48h: 0,
        overdue72h: 0,
      },
    ];

    // Build today summary
    const today = {
      inwardsVerified: inwardsVerified[0]?.count || 0,
      inwardsPending: inwardsPending[0]?.count || 0,
      deliveriesClosed,
      deliveriesPending,
      expensesRecorded,
      posWithoutTracking: posWithoutTracking[0]?.count || 0,
    };

    // Build critical alerts (items > 24h needing Syed's attention)
    const criticalAlerts: CriticalAlert[] = [];

    if (nithin.overdue24h > 0) {
      criticalAlerts.push({
        type: "inward",
        message: `${nithin.overdue24h} inbound shipment${nithin.overdue24h > 1 ? "s" : ""} pending 24h+${nithin.overdue72h > 0 ? ` (${nithin.overdue72h} over 72h!)` : ""}`,
        owner: "Nithin",
        count: nithin.overdue24h,
      });
    }

    if (ranjitha.overdue24h > 0) {
      criticalAlerts.push({
        type: "delivery",
        message: `${ranjitha.overdue24h} deliver${ranjitha.overdue24h > 1 ? "ies" : "y"} pending 24h+${ranjitha.overdue72h > 0 ? ` (${ranjitha.overdue72h} over 72h!)` : ""}`,
        owner: "Ranjitha",
        count: ranjitha.overdue24h,
      });
    }

    if (abhi.overdue48h > 0) {
      criticalAlerts.push({
        type: "purchase_order",
        message: `${abhi.overdue48h} PO without tracking 48h+${abhi.overdue72h > 0 ? ` (${abhi.overdue72h} over 72h!)` : ""}`,
        owner: "Abhi Gowda",
        count: abhi.overdue48h,
      });
    }

    // Team-wide Compliance % — the single accountability number.
    // Late = items past SLA (Nithin/Ranjitha 24h, Abhi 48h). Excludes Sravan
    // (expenses today is activity, not backlog).
    const totalOpen = nithin.pending + ranjitha.pending + abhi.pending;
    const totalLate = nithin.overdue24h + ranjitha.overdue24h + abhi.overdue48h;
    const compliancePct = totalOpen > 0 ? Math.round(((totalOpen - totalLate) / totalOpen) * 100) : 100;

    return successResponse({ people, today, criticalAlerts, compliancePct, totalOpen, totalLate });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch health summary",
      500
    );
  }
}
