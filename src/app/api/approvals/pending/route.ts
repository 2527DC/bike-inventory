export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { createLogger } from "@/lib/logger";
import type { ApprovalActivity } from "@prisma/client";

const log = createLogger("approvals:pending");

/**
 * GET: everything waiting for an approval THIS person can give
 * (plan 1709-priority-build-and-stock-flow, P17, R24).
 *
 * ─── BUILT FROM THE RECORDS, NOT FROM AN INBOX ────────────────────────────────────────────
 *
 * The obvious build for "where do approvers see requests" is a notifications table with read
 * and unread. P17 deliberately does not do that. A row in an inbox is a COPY of a fact, and a
 * copy goes stale: a transfer approved on somebody else's phone leaves an unread row saying it
 * still needs approving, and no amount of housekeeping makes two records agree forever. This
 * endpoint asks the four tables what is actually waiting, every time. It cannot be wrong, it
 * needs no read state, and nothing has to be cleaned up when a record is approved elsewhere.
 *
 * ─── EACH SECTION IS GATED ON ITS OWN GRANT ───────────────────────────────────────────────
 *
 * `requireAuth` only: there is no `approvals` module and R22 is explicit that the doer/approver
 * split is expressed by permissions on the four existing modules. So a section is included if,
 * and only if, `userCan(module, "approve")` — a mechanic gets an empty list rather than a 403,
 * which is the right answer for a page the header badge links to for everybody.
 *
 * `?count=1` returns the total alone, for that badge.
 */

type RequestType = "INBOUND" | "OUTBOUND" | "TRANSFER" | "STOCK_AUDIT";

interface PendingRequest {
  type: RequestType;
  activity: ApprovalActivity;
  id: string;
  ref: string;
  summary: string;
  requestedByName: string;
  requestedAt: string;
  /** Hours since it was asked for, so the screen does not recompute the same arithmetic. */
  ageHours: number;
  link: string;
  /** False for a stock audit: approving one needs the apply choice, so it is Open-only (P17). */
  quickActions: boolean;
  /** True when this is the SECOND time round — it was returned and resubmitted. */
  resubmitted: boolean;
}

function ageHours(at: Date): number {
  return Math.max(0, Math.round(((Date.now() - at.getTime()) / 3_600_000) * 10) / 10);
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(req.url);
    const countOnly = searchParams.get("count") === "1";

    const [canInbound, canOutbound, canTransfer, canAudit] = await Promise.all([
      userCan(user.id, "inbound", "approve"),
      userCan(user.id, "deliveries", "approve"),
      userCan(user.id, "transfers", "approve"),
      userCan(user.id, "stock_audit", "approve"),
    ]);

    const requests: PendingRequest[] = [];

    // ── Inbound: raised, not approved, not sent back ────────────────────────────────────
    // A returned shipment is the creator's, not the approver's, so it is NOT waiting here — it
    // comes back when they resubmit, which clears `rejectedAt`. DELIVERED is excluded because a
    // shipment that somehow reached the shelf is no longer an approval question.
    if (canInbound) {
      const shipments = await prisma.inboundShipment.findMany({
        where: { approvedAt: null, rejectedAt: null, status: { not: "DELIVERED" } },
        select: {
          id: true,
          shipmentNo: true,
          billNo: true,
          totalItems: true,
          createdAt: true,
          resubmittedAt: true,
          brand: { select: { name: true } },
          createdBy: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 200,
      });
      for (const s of shipments) {
        const at = s.resubmittedAt ?? s.createdAt;
        requests.push({
          type: "INBOUND",
          activity: "INBOUND",
          id: s.id,
          ref: s.shipmentNo,
          summary: `${s.brand.name} — bill ${s.billNo}, ${s.totalItems} item${s.totalItems === 1 ? "" : "s"}`,
          requestedByName: s.createdBy.name,
          requestedAt: at.toISOString(),
          ageHours: ageHours(at),
          link: `/inbound/${s.id}`,
          quickActions: true,
          resubmitted: s.resubmittedAt !== null,
        });
      }
    }

    // ── Outbound: approval asked for and not yet given ──────────────────────────────────
    // `approvalReturnedAt` after the request means it was sent back and the creator has not
    // asked again; re-requesting moves `approvalRequestedAt` forward past it. Dummy outwards
    // (no warehouse) are excluded — R26a says they never enter the approval flow at all.
    if (canOutbound) {
      const deliveries = await prisma.delivery.findMany({
        where: {
          approvalRequestedAt: { not: null },
          approvedAt: null,
          warehouseId: { not: null },
          status: { notIn: ["DELIVERED", "WALK_OUT"] },
        },
        select: {
          id: true,
          invoiceNo: true,
          customerName: true,
          customerArea: true,
          approvalRequestedAt: true,
          approvalReturnedAt: true,
          approvalRequestedBy: { select: { name: true } },
        },
        orderBy: { approvalRequestedAt: "asc" },
        take: 200,
      });
      for (const d of deliveries) {
        const at = d.approvalRequestedAt!;
        // Returned AFTER the last request: it is with the creator, not with an approver.
        if (d.approvalReturnedAt && d.approvalReturnedAt >= at) continue;
        requests.push({
          type: "OUTBOUND",
          activity: "OUTBOUND",
          id: d.id,
          ref: d.invoiceNo,
          summary: `${d.customerName}${d.customerArea ? ` — ${d.customerArea}` : ""}`,
          requestedByName: d.approvalRequestedBy?.name ?? "—",
          requestedAt: at.toISOString(),
          ageHours: ageHours(at),
          link: `/deliveries/${d.id}`,
          quickActions: true,
          resubmitted: d.approvalReturnedAt !== null,
        });
      }
    }

    // ── Transfers: PENDING is exactly "waiting for a decision" ──────────────────────────
    if (canTransfer) {
      const orders = await prisma.transferOrder.findMany({
        where: { status: "PENDING" },
        select: {
          id: true,
          orderNo: true,
          createdAt: true,
          resubmittedAt: true,
          deliveryId: true,
          createdBy: { select: { name: true } },
          fromWarehouse: { select: { name: true } },
          toWarehouse: { select: { name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 200,
      });
      for (const o of orders) {
        const at = o.resubmittedAt ?? o.createdAt;
        const route = `${o.fromWarehouse?.name ?? "—"} → ${o.toWarehouse?.name ?? "—"}`;
        requests.push({
          type: "TRANSFER",
          activity: "TRANSFER",
          id: o.id,
          ref: o.orderNo,
          // A Find-stock transfer is raised because a customer's outward is short, so say so:
          // it is the one transfer on this list that somebody is standing at a counter waiting for.
          summary: `${route}, ${o._count.items} line${o._count.items === 1 ? "" : "s"}${o.deliveryId ? " · for an outward" : ""}`,
          requestedByName: o.createdBy.name,
          requestedAt: at.toISOString(),
          ageHours: ageHours(at),
          link: `/transfers/${o.id}`,
          quickActions: true,
          resubmitted: o.resubmittedAt !== null,
        });
      }
    }

    // ── Stock audits: COMPLETED and awaiting a decision ─────────────────────────────────
    // Open-only. Approving an audit is not one button: the approver chooses verify-only or
    // "apply the counts", and a whole-store audit also names the warehouse a surplus goes to.
    // A quick Approve here would have to pick one of those silently.
    if (canAudit) {
      const counts = await prisma.stockCount.findMany({
        where: { status: "COMPLETED" },
        select: {
          id: true,
          countNo: true,
          title: true,
          completedAt: true,
          createdAt: true,
          assignedTo: { select: { name: true } },
          warehouse: { select: { name: true } },
          store: { select: { name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { completedAt: "asc" },
        take: 200,
      });
      for (const c of counts) {
        const at = c.completedAt ?? c.createdAt;
        const where = c.warehouse?.name ?? c.store?.name ?? "no recorded location";
        requests.push({
          type: "STOCK_AUDIT",
          activity: "STOCK_AUDIT",
          id: c.id,
          ref: c.countNo ?? c.title,
          summary: `${where}, ${c._count.items} line${c._count.items === 1 ? "" : "s"}`,
          requestedByName: c.assignedTo.name,
          requestedAt: at.toISOString(),
          ageHours: ageHours(at),
          link: `/stock-audit/${c.id}/review`,
          quickActions: false,
          resubmitted: false,
        });
      }
    }

    // Oldest first: the age column is the point of the page.
    requests.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));

    if (countOnly) {
      log.debug("pending approvals counted", { userId: user.id, total: requests.length });
      return successResponse({ total: requests.length });
    }

    log.debug("pending approvals served", {
      userId: user.id,
      total: requests.length,
      sections: { canInbound, canOutbound, canTransfer, canAudit },
    });

    return successResponse({
      total: requests.length,
      sections: {
        INBOUND: canInbound,
        OUTBOUND: canOutbound,
        TRANSFER: canTransfer,
        STOCK_AUDIT: canAudit,
      },
      requests,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to load pending approvals";
    log.error("pending approvals failed", { message });
    return errorResponse(message, 500);
  }
}
