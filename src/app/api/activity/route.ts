export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";

// GET: Fetch activity log for a user (or all users for ADMIN)
export async function GET(req: NextRequest) {
  try {
    const user = await requireFeature("activity", "view");
    const { searchParams } = new URL(req.url);
    const targetUserId = searchParams.get("userId");
    const dateStr = searchParams.get("date"); // YYYY-MM-DD
    // Seeing other people's activity is a team-oversight capability.
    const isAdmin = await userCan(user.id, "team", "view");

    // Non-admins can only see their own activity
    const userId = isAdmin && targetUserId ? targetUserId : user.id;
    const showAll = isAdmin && !targetUserId;

    // Date range
    const date = dateStr ? new Date(dateStr) : new Date();
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const userFilter = showAll ? {} : { userId };
    const dateFilter = { createdAt: { gte: dayStart, lte: dayEnd } };

    // Fetch all activity sources in parallel
    const [
      transactions,
      deliveryActions,
      inboundActions,
      transferActions,
      expenseActions,
      paymentActions,
      poActions,
    ] = await Promise.all([
      // 1. Inventory transactions (inward, outward, transfer, adjustment)
      prisma.inventoryTransaction.findMany({
        where: { ...userFilter, ...dateFilter },
        select: {
          id: true, type: true, quantity: true, notes: true, referenceNo: true,
          createdAt: true, userId: true,
          product: { select: { name: true } },
          user: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),

      // 2. Delivery verifications
      prisma.delivery.findMany({
        where: {
          ...(showAll ? {} : { verifiedById: userId }),
          verifiedAt: { gte: dayStart, lte: dayEnd },
        },
        select: {
          id: true, invoiceNo: true, customerName: true, status: true,
          invoiceAmount: true, verifiedAt: true,
          verifiedBy: { select: { id: true, name: true } },
        },
        orderBy: { verifiedAt: "desc" },
        take: 100,
      }),

      // 3. Inbound shipment actions (created, approved, delivered, putaway)
      prisma.inboundShipment.findMany({
        where: {
          OR: showAll ? [
            { createdAt: { gte: dayStart, lte: dayEnd } },
            { approvedAt: { gte: dayStart, lte: dayEnd } },
            { deliveredAt: { gte: dayStart, lte: dayEnd } },
            { putawayAt: { gte: dayStart, lte: dayEnd } },
          ] : [
            { createdById: userId, createdAt: { gte: dayStart, lte: dayEnd } },
            { approvedById: userId, approvedAt: { gte: dayStart, lte: dayEnd } },
            { deliveredById: userId, deliveredAt: { gte: dayStart, lte: dayEnd } },
            { putawayById: userId, putawayAt: { gte: dayStart, lte: dayEnd } },
          ],
        },
        select: {
          id: true, shipmentNo: true, billNo: true, status: true, totalAmount: true,
          createdAt: true, approvedAt: true, deliveredAt: true, putawayAt: true,
          createdById: true, approvedById: true, deliveredById: true, putawayById: true,
          brand: { select: { name: true } },
          createdBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
          deliveredBy: { select: { id: true, name: true } },
          putawayBy: { select: { id: true, name: true } },
        },
        take: 50,
      }),

      // 4. Transfer orders
      prisma.transferOrder.findMany({
        where: {
          OR: showAll ? [
            { createdAt: { gte: dayStart, lte: dayEnd } },
            { reviewedAt: { gte: dayStart, lte: dayEnd } },
          ] : [
            { createdById: userId, createdAt: { gte: dayStart, lte: dayEnd } },
            { reviewedById: userId, reviewedAt: { gte: dayStart, lte: dayEnd } },
          ],
        },
        select: {
          id: true, orderNo: true, status: true, createdAt: true, reviewedAt: true,
          createdById: true, reviewedById: true,
          createdBy: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
        take: 50,
      }),

      // 5. Expenses
      prisma.expense.findMany({
        where: {
          ...(showAll ? {} : { recordedById: userId }),
          ...dateFilter,
        },
        select: {
          id: true, description: true, amount: true, category: true, createdAt: true,
          recordedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),

      // 6. Vendor payments
      prisma.vendorPayment.findMany({
        where: {
          ...(showAll ? {} : { recordedById: userId }),
          ...dateFilter,
        },
        select: {
          id: true, amount: true, paymentMode: true, referenceNo: true, createdAt: true,
          recordedBy: { select: { id: true, name: true } },
          bill: { select: { billNo: true, vendor: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),

      // 7. Purchase orders
      prisma.purchaseOrder.findMany({
        where: {
          OR: showAll ? [
            { createdAt: { gte: dayStart, lte: dayEnd } },
            { approvedAt: { gte: dayStart, lte: dayEnd } },
          ] : [
            { createdById: userId, createdAt: { gte: dayStart, lte: dayEnd } },
            { approvedById: userId, approvedAt: { gte: dayStart, lte: dayEnd } },
          ],
        },
        select: {
          id: true, poNumber: true, status: true, grandTotal: true,
          createdAt: true, approvedAt: true,
          createdById: true, approvedById: true,
          createdBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
          vendor: { select: { name: true } },
        },
        take: 50,
      }),
    ]);

    // Normalize into a unified activity log
    type Activity = {
      id: string;
      action: string;
      detail: string;
      category: "STOCK" | "DELIVERY" | "INBOUND" | "TRANSFER" | "EXPENSE" | "PAYMENT" | "PO";
      userName: string;
      userId: string;
      timestamp: string;
      amount?: number;
      isError?: boolean;
      errorDetail?: string;
    };

    const activities: Activity[] = [];

    // 1. Inventory transactions
    for (const t of transactions) {
      const isNegative = t.notes?.includes("[NEGATIVE STOCK]");
      activities.push({
        id: `txn-${t.id}`,
        action: t.type === "INWARD" ? "Stock In" : t.type === "OUTWARD" ? "Stock Out" : t.type === "TRANSFER" ? "Transfer" : "Adjustment",
        detail: `${t.product.name} x${t.quantity}${t.referenceNo ? ` (${t.referenceNo})` : ""}`,
        category: "STOCK",
        userName: t.user.name,
        userId: t.userId,
        timestamp: t.createdAt.toISOString(),
        isError: isNegative,
        errorDetail: isNegative ? "Negative stock — needs inward/transfer" : undefined,
      });
    }

    // 2. Delivery verifications
    for (const d of deliveryActions) {
      activities.push({
        id: `del-${d.id}`,
        action: d.status === "WALK_OUT" ? "Walk-out" : d.status === "DELIVERED" ? "Delivered" : `Verified → ${d.status}`,
        detail: `${d.invoiceNo} — ${d.customerName}`,
        category: "DELIVERY",
        userName: d.verifiedBy?.name || "Unknown",
        userId: d.verifiedBy?.id || "",
        timestamp: d.verifiedAt?.toISOString() || "",
        amount: d.invoiceAmount,
      });
    }

    // 3. Inbound shipment actions
    for (const s of inboundActions) {
      if (s.createdAt >= dayStart && s.createdAt <= dayEnd && s.createdBy) {
        if (showAll || s.createdById === userId) {
          activities.push({
            id: `ib-create-${s.id}`,
            action: "Created Shipment",
            detail: `${s.shipmentNo} — ${s.brand.name} (${s.billNo})`,
            category: "INBOUND",
            userName: s.createdBy.name,
            userId: s.createdBy.id,
            timestamp: s.createdAt.toISOString(),
            amount: s.totalAmount,
          });
        }
      }
      if (s.approvedAt && s.approvedAt >= dayStart && s.approvedAt <= dayEnd && s.approvedBy) {
        if (showAll || s.approvedById === userId) {
          activities.push({
            id: `ib-approve-${s.id}`,
            action: "Approved Shipment",
            detail: `${s.shipmentNo} — ${s.brand.name}`,
            category: "INBOUND",
            userName: s.approvedBy.name,
            userId: s.approvedBy.id,
            timestamp: s.approvedAt.toISOString(),
          });
        }
      }
      if (s.deliveredAt && s.deliveredAt >= dayStart && s.deliveredAt <= dayEnd && s.deliveredBy) {
        if (showAll || s.deliveredById === userId) {
          activities.push({
            id: `ib-deliver-${s.id}`,
            action: "Marked Delivered",
            detail: `${s.shipmentNo} — ${s.brand.name}`,
            category: "INBOUND",
            userName: s.deliveredBy.name,
            userId: s.deliveredBy.id,
            timestamp: s.deliveredAt.toISOString(),
          });
        }
      }
      if (s.putawayAt && s.putawayAt >= dayStart && s.putawayAt <= dayEnd && s.putawayBy) {
        if (showAll || s.putawayById === userId) {
          activities.push({
            id: `ib-putaway-${s.id}`,
            action: "Putaway Done",
            detail: `${s.shipmentNo} — ${s.brand.name}`,
            category: "INBOUND",
            userName: s.putawayBy.name,
            userId: s.putawayBy.id,
            timestamp: s.putawayAt.toISOString(),
          });
        }
      }
    }

    // 4. Transfer orders
    for (const t of transferActions) {
      if (t.createdAt >= dayStart && t.createdAt <= dayEnd && t.createdBy) {
        if (showAll || t.createdById === userId) {
          activities.push({
            id: `tr-create-${t.id}`,
            action: "Created Transfer",
            detail: t.orderNo,
            category: "TRANSFER",
            userName: t.createdBy.name,
            userId: t.createdBy.id,
            timestamp: t.createdAt.toISOString(),
          });
        }
      }
      if (t.reviewedAt && t.reviewedAt >= dayStart && t.reviewedAt <= dayEnd && t.reviewedBy) {
        if (showAll || t.reviewedById === userId) {
          activities.push({
            id: `tr-review-${t.id}`,
            action: "Reviewed Transfer",
            detail: t.orderNo,
            category: "TRANSFER",
            userName: t.reviewedBy.name,
            userId: t.reviewedBy.id,
            timestamp: t.reviewedAt.toISOString(),
          });
        }
      }
    }

    // 5. Expenses
    for (const e of expenseActions) {
      activities.push({
        id: `exp-${e.id}`,
        action: "Recorded Expense",
        detail: `${e.description} (${e.category})`,
        category: "EXPENSE",
        userName: e.recordedBy.name,
        userId: e.recordedBy.id,
        timestamp: e.createdAt.toISOString(),
        amount: e.amount,
      });
    }

    // 6. Vendor payments
    for (const p of paymentActions) {
      activities.push({
        id: `pay-${p.id}`,
        action: "Vendor Payment",
        detail: `${p.bill?.vendor?.name || "Vendor"} — ${p.bill?.billNo || "N/A"} (${p.paymentMode})`,
        category: "PAYMENT",
        userName: p.recordedBy.name,
        userId: p.recordedBy.id,
        timestamp: p.createdAt.toISOString(),
        amount: p.amount,
      });
    }

    // 7. Purchase orders
    for (const po of poActions) {
      if (po.createdAt >= dayStart && po.createdAt <= dayEnd && po.createdBy) {
        if (showAll || po.createdById === userId) {
          activities.push({
            id: `po-create-${po.id}`,
            action: "Created PO",
            detail: `${po.poNumber} — ${po.vendor.name}`,
            category: "PO",
            userName: po.createdBy.name,
            userId: po.createdBy.id,
            timestamp: po.createdAt.toISOString(),
            amount: po.grandTotal,
          });
        }
      }
      if (po.approvedAt && po.approvedAt >= dayStart && po.approvedAt <= dayEnd && po.approvedBy) {
        if (showAll || po.approvedById === userId) {
          activities.push({
            id: `po-approve-${po.id}`,
            action: "Approved PO",
            detail: `${po.poNumber} — ${po.vendor.name}`,
            category: "PO",
            userName: po.approvedBy.name,
            userId: po.approvedBy.id,
            timestamp: po.approvedAt.toISOString(),
          });
        }
      }
    }

    // Sort by timestamp (newest first)
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Group by user for summary
    const userSummary: Record<string, { name: string; actions: number; errors: number; categories: Record<string, number> }> = {};
    for (const a of activities) {
      if (!userSummary[a.userId]) {
        userSummary[a.userId] = { name: a.userName, actions: 0, errors: 0, categories: {} };
      }
      userSummary[a.userId].actions++;
      if (a.isError) userSummary[a.userId].errors++;
      userSummary[a.userId].categories[a.category] = (userSummary[a.userId].categories[a.category] || 0) + 1;
    }

    return successResponse({
      date: dayStart.toISOString().split("T")[0],
      totalActions: activities.length,
      errorCount: activities.filter((a) => a.isError).length,
      activities,
      userSummary: Object.entries(userSummary).map(([id, s]) => ({ userId: id, ...s })),
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch activity", 500);
  }
}
