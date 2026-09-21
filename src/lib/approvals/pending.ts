import { prisma } from "@/lib/db";
import { userCan } from "@/lib/rbac";
import { createLogger } from "@/lib/logger";
import type { ApprovalActivity } from "@prisma/client";

const log = createLogger("approvals:pending");

/**
 * Everything waiting for an approval ONE person can give (plan 1709-priority-build-and-stock-flow,
 * P17, R24).
 *
 * ─── BUILT FROM THE RECORDS, NOT FROM AN INBOX ────────────────────────────────────────────
 *
 * The obvious build for "where do approvers see requests" is a notifications table with read
 * and unread. P17 deliberately does not do that. A row in an inbox is a COPY of a fact, and a
 * copy goes stale: a transfer approved on somebody else's phone leaves an unread row saying it
 * still needs approving, and no amount of housekeeping makes two records agree forever. This
 * asks the four tables what is actually waiting, every time. It cannot be wrong, it needs no
 * read state, and nothing has to be cleaned up when a record is approved elsewhere.
 *
 * ─── EACH SECTION IS GATED ON ITS OWN GRANT ───────────────────────────────────────────────
 *
 * There is no `approvals` module and R22 is explicit that the doer/approver split is expressed
 * by permissions on the four existing modules. So a section is included if, and only if,
 * `userCan(module, "approve")` — a mechanic gets an empty list rather than a 403, which is the
 * right answer for a page the header badge links to for everybody.
 *
 * ─── ONE DEFINITION, THREE READERS ────────────────────────────────────────────────────────
 *
 * Lifted out of `api/approvals/pending/route.ts` by Part G so the Requests page, the header
 * badge and the dashboard's "Approvals waiting" card all count the SAME rows. A second copy of
 * these four `where` clauses would drift the first time one of them learned about a new status,
 * and the dashboard would then quietly disagree with the page it links to.
 */

export type RequestType = "INBOUND" | "OUTBOUND" | "TRANSFER" | "STOCK_AUDIT";

export interface PendingRequest {
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

export interface PendingApprovals {
  total: number;
  sections: Record<RequestType, boolean>;
  requests: PendingRequest[];
}

function ageHours(at: Date): number {
  return Math.max(0, Math.round(((Date.now() - at.getTime()) / 3_600_000) * 10) / 10);
}

/** Everything `userId` may approve, oldest first. Never throws on an empty grant — it returns []. */
export async function listPendingApprovals(userId: string): Promise<PendingApprovals> {
  const [canOutbound, canTransfer, canAudit] = await Promise.all([
    userCan(userId, "deliveries", "approve"),
    userCan(userId, "transfers", "approve"),
    userCan(userId, "stock_audit", "approve"),
  ]);

  const requests: PendingRequest[] = [];

  // ── Inbound: DELIBERATELY NOT LISTED (plan 2109-inbound-bins-navigation-fixes, R8, Q14) ──
  //
  // Do not restore this section. The owner's decision of 21 Sep 2026: inbound KEEPS its approval
  // step — approve, return with a note, resubmit, the receive gate in `api/inbound/[id]` — but
  // shipments no longer appear on the `/approvals` (Requests) screen or in its header badge.
  // Approvers find them on `/inbound` under the "Not approved" chip
  // (`src/lib/inbound/filters.ts`, the same `where` this section used), and the dashboard counts
  // them on a card of their own (`api/dashboard/overview`, Q15a). The approver push still goes
  // out and opens `/inbound/[id]` (`notifyInboundApprovalRequested`).
  //
  // The `inbound.approve` grant is therefore no longer read here, and the INBOUND section
  // reports false: there is nothing of it on this screen to show.

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

  log.debug("pending approvals resolved", {
    userId,
    total: requests.length,
    sections: { canOutbound, canTransfer, canAudit },
  });

  return {
    total: requests.length,
    sections: {
      INBOUND: false, // plan 2109, R8 — see the tombstone above
      OUTBOUND: canOutbound,
      TRANSFER: canTransfer,
      STOCK_AUDIT: canAudit,
    },
    requests,
  };
}
