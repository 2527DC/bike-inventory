export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { istDayBounds } from "@/lib/services/timezone";
import { createLogger } from "@/lib/logger";

const log = createLogger("activity:feed");

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

    // Date range — an IST calendar day, not the server's.
    //
    // This was `setHours(0,0,0,0)`, i.e. midnight wherever the server happens to be. Vercel is
    // UTC, so the day ran 05:30 IST to 05:30 IST: everything done between midnight and dawn
    // filed under yesterday, and the response then echoed yesterday's date, so the screen
    // agreed with itself and the gap was invisible.
    const { dayStr, start: dayStart, end: dayEnd } = istDayBounds(dateStr ?? undefined);

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
      loggedActions,
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

      // 8. ActivityLog — the explicit record, written by logActivity (P1) inside the same
      // transaction as the change it describes. The seven sources above INFER activity from
      // timestamp columns on business rows; this one is the only source that carries what
      // actually changed (from -> to) rather than merely that something did.
      prisma.activityLog.findMany({
        where: { ...userFilter, ...dateFilter },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    ]);

    // Normalize into a unified activity log
    type Activity = {
      id: string;
      action: string;
      detail: string;
      category:
        | "STOCK" | "DELIVERY" | "INBOUND" | "TRANSFER" | "EXPENSE" | "PAYMENT" | "PO"
        // Added by P5 with the ActivityLog source. Both clients must carry the same four in
        // CATEGORY_CONFIG, or a row renders with no icon and no label.
        | "AUDIT" | "ISSUE" | "ZOHO" | "MASTER_DATA";
      userName: string;
      userId: string;
      timestamp: string;
      amount?: number;
      isError?: boolean;
      errorDetail?: string;
    };

    // ─── ActivityLog: module -> feed category and the label shown before the verb ─────────
    // Keys are RBAC module keys, which is what logActivity writes (see src/lib/activity-log.ts).
    const LOG_MODULES: Record<string, { category: Activity["category"]; label: string }> = {
      stock_audit: { category: "AUDIT", label: "Audit" },
      inbound: { category: "INBOUND", label: "Inbound" },
      vendor_issues: { category: "ISSUE", label: "Issue" },
      zoho: { category: "ZOHO", label: "Zoho" },
      categories: { category: "MASTER_DATA", label: "Category" },
      customers: { category: "MASTER_DATA", label: "Customer" },
      purchase_orders: { category: "PO", label: "PO" },
      transfers: { category: "TRANSFER", label: "Transfer" },
    };

    // Six of the seven inferred sources above describe the same events the log now records, so
    // without this the feed shows each one twice. The log row wins: it carries from -> to, and
    // the inferred row carries only a timestamp.
    //
    // PO and transfer entries are listed here before P9 and P14 write them. That is deliberate —
    // the duplicate would otherwise appear the day those phases land, in a file neither of them
    // touches.
    const loggedKeys = new Set(loggedActions.map((r) => `${r.entityType}:${r.entityId}:${r.action}`));
    const alreadyLogged = (entityType: string, entityId: string, ...actions: string[]) =>
      actions.some((a) => loggedKeys.has(`${entityType}:${entityId}:${a}`));

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
        if ((showAll || s.approvedById === userId) && !alreadyLogged("InboundShipment", s.id, "approved")) {
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
        if ((showAll || s.deliveredById === userId) && !alreadyLogged("InboundShipment", s.id, "delivered")) {
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
        if ((showAll || t.createdById === userId) && !alreadyLogged("TransferOrder", t.id, "created")) {
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
        if ((showAll || t.reviewedById === userId) && !alreadyLogged("TransferOrder", t.id, "approved", "rejected")) {
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
        if ((showAll || po.createdById === userId) && !alreadyLogged("PurchaseOrder", po.id, "created")) {
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
        if ((showAll || po.approvedById === userId) && !alreadyLogged("PurchaseOrder", po.id, "approved")) {
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

    // 8. ActivityLog
    //
    // The only source that says what changed. `action` reads "<Label> <verb>" and `detail`
    // is the human reference, the transition and the free text, joined by "·" and skipping
    // whatever is absent — so a row never renders a dangling separator or a bare "undefined".
    const unknownModules = new Set<string>();
    for (const r of loggedActions) {
      const known = LOG_MODULES[r.module];
      if (!known) unknownModules.add(r.module);
      // An unknown module is still someone's action: render it rather than dropping it, and
      // warn once per module so a missing entry above is found by reading the logs, not by a
      // person noticing their work is absent from the feed.
      const { category, label } = known ?? {
        category: "MASTER_DATA" as const,
        label: r.module.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
      };

      const transition =
        r.fromValue || r.toValue ? `${r.fromValue ?? "—"} → ${r.toValue ?? "—"}` : null;
      const detail = [r.entityRef, transition, r.details].filter(Boolean).join(" · ");

      activities.push({
        id: `log-${r.id}`,
        action: `${label} ${r.action.replace(/_/g, " ")}`,
        detail,
        category,
        userName: r.userName,
        userId: r.userId,
        timestamp: r.createdAt.toISOString(),
      });
    }
    if (unknownModules.size > 0) {
      log.warn("activity log rows carry modules the feed does not map", {
        modules: [...unknownModules],
      });
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
      // dayStart is 18:30 UTC the PREVIOUS day, so its ISO date names the wrong day. The
      // window's own IST day name is the answer, and it is what the screen echoes back.
      date: dayStr,
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
