export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { z } from "zod";
import { assertTransition, TransitionError } from "@/lib/transfers/transitions";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("transfer-orders:cancel");

const schema = z.object({
  reason: z.string().max(1000).optional(),
});

/**
 * POST: call off a transfer that has not been dispatched.
 *
 * Guarded on `transfers.view` and then widened by hand, because there are two legitimate
 * cancellers and only one of them is expressible as a single grant: somebody holding
 * `transfers.delete`, and the person who raised it. A creator withdrawing their own request
 * before anybody acted on it should not need a delete grant over everyone else's transfers.
 *
 * Cancelling from IN_TRANSIT is refused by the state machine, not here — the stock has already
 * left the source and is sitting in a van, so "cancelled" would leave those units in no
 * warehouse at all. `transitionError` says so in words and points at the receive flow, which
 * can record a total shortfall if the van came back empty.
 *
 * The reason reuses `rejectionNote`. A separate `cancellationNote` column would hold the same
 * kind of sentence for the same reader, and the two are never both set: a transfer is rejected
 * OR cancelled, never both.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("transfers", "view");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { reason } = schema.parse(body ?? {});

    const order = await prisma.transferOrder.findUnique({
      where: { id },
      select: { id: true, orderNo: true, status: true, createdById: true },
    });
    if (!order) return errorResponse("Transfer order not found", 404);

    const canDelete = await userCan(user.id, "transfers", "delete");
    if (!canDelete && order.createdById !== user.id) {
      return errorResponse("You can only cancel a transfer you raised.", 403);
    }

    assertTransition(order.status, "CANCELLED");
    const fromStatus = order.status;

    // The precondition is in the WHERE, so a second press lands as a 409 rather than a second
    // write over somebody else's dispatch. Claim and log commit together: cancelling somebody
    // else's transfer is exactly the kind of act the log exists to attribute.
    const claimed = await prisma.$transaction(async (tx) => {
      const claim = await tx.transferOrder.updateMany({
        where: { id, status: fromStatus },
        data: {
          status: "CANCELLED",
          rejectionNote: reason?.trim() || null,
          reviewedById: order.createdById === user.id ? undefined : user.id,
        },
      });
      if (claim.count !== 1) return false;

      await logActivity(tx, {
        module: "transfers",
        action: "cancelled",
        entityType: "TransferOrder",
        entityId: order.id,
        entityRef: order.orderNo,
        fromValue: fromStatus,
        toValue: "CANCELLED",
        details: reason?.trim() || null,
        userId: user.id,
        userName: user.name,
      });
      return true;
    });
    if (!claimed) {
      return errorResponse("This transfer has already moved on and can no longer be cancelled.", 409);
    }

    log.info("transfer cancelled", { orderId: order.id, orderNo: order.orderNo, fromStatus });
    return successResponse({ message: "Transfer cancelled", status: "CANCELLED" });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof TransitionError) return errorResponse(error.message, error.status);
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message ?? "Invalid request", 400);
    }
    const message = error instanceof Error ? error.message : "Failed to cancel this transfer";
    log.error("transfer cancel failed", { message });
    return errorResponse(message, 400);
  }
}
