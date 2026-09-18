export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { assertTransition, TransitionError } from "@/lib/transfers/transitions";
import { recordApprovalEvent } from "@/lib/approvals/events";
import { notifyTransferApprovalRequested } from "@/lib/approvals/actions/transfer";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("transfer-orders:resubmit");

/**
 * POST: send a RETURNED transfer back for approval (R25, Q36).
 *
 * The same order, not a new one — that is the whole point of RETURNED. The approver sees one
 * record carrying its own history: requested, returned with a note, corrected, resubmitted.
 *
 * The lines are corrected by `PATCH /api/transfer-orders/[id]` before this; this route only
 * changes the status, so a creator who decides the order was right as it stood can resubmit it
 * untouched. `reviewedById` / `reviewedAt` are cleared because the review they recorded was of
 * a version that no longer exists; `rejectionNote` is KEPT, so the returned reason stays
 * readable on the timeline after the status has moved on.
 *
 * No auto-approve here, even for a creator who holds `transfers.approve`. Auto-approve belongs
 * to the moment an order is raised (Q15); a resubmit is an answer to somebody else's note, and
 * signing off on your own correction of their objection is the one case where it would hide
 * exactly the disagreement the note recorded.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireAuth();

    const order = await prisma.transferOrder.findUnique({
      where: { id },
      select: {
        id: true,
        orderNo: true,
        status: true,
        createdById: true,
        fromWarehouse: { select: { name: true } },
        toWarehouse: { select: { name: true } },
        _count: { select: { items: true } },
      },
    });
    if (!order) return errorResponse("Transfer order not found", 404);

    const canCreate = await userCan(user.id, "transfers", "create");
    if (!canCreate && order.createdById !== user.id) {
      return errorResponse("You can only resubmit a transfer you raised.", 403);
    }

    assertTransition(order.status, "PENDING");

    if (order._count.items === 0) {
      return errorResponse("This transfer has no lines. Add at least one before resubmitting it.", 400);
    }

    // The precondition is in the WHERE, so a second press lands as a 409 rather than a second
    // request against an order somebody has already started reviewing.
    const claimed = await prisma.$transaction(async (tx) => {
      const claim = await tx.transferOrder.updateMany({
        where: { id, status: "RETURNED" },
        data: {
          status: "PENDING",
          resubmittedAt: new Date(),
          reviewedById: null,
          reviewedAt: null,
        },
      });
      if (claim.count !== 1) return false;

      await recordApprovalEvent(tx, {
        activity: "TRANSFER",
        event: "RESUBMITTED",
        recordId: order.id,
        recordRef: order.orderNo,
        actorId: user.id,
        // Still nothing approved — the resubmit is a request, not an outcome.
        approverId: null,
      });

      await logActivity(tx, {
        module: "transfers",
        action: "resubmitted",
        entityType: "TransferOrder",
        entityId: order.id,
        entityRef: order.orderNo,
        fromValue: "RETURNED",
        toValue: "PENDING",
        userId: user.id,
        userName: user.name,
      });
      return true;
    });

    if (!claimed) {
      return errorResponse("This transfer is no longer returned, so it cannot be resubmitted.", 409);
    }

    log.info("transfer resubmitted", { orderId: order.id, orderNo: order.orderNo, userId: user.id });

    notifyTransferApprovalRequested({
      orderId: order.id,
      orderNo: order.orderNo,
      actorId: user.id,
      actorName: user.name,
      routeLabel: `${order.fromWarehouse?.name ?? "—"} → ${order.toWarehouse?.name ?? "—"}`,
      resubmitted: true,
    });

    return successResponse({ message: "Transfer resubmitted for approval", status: "PENDING" });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof TransitionError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to resubmit this transfer";
    log.error("transfer resubmit failed", { orderId: id, message });
    return errorResponse(message, 400);
  }
}
