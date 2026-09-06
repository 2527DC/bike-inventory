export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("purchase-orders:approve");

/**
 * Approve a purchase order.
 *
 * ─── NARROWED IN P9: PENDING_APPROVAL ONLY ───────────────────────────────────────────────
 *
 * This used to accept DRAFT as well, which meant nothing was ever approved FROM the pending
 * state — a draft went straight to APPROVED and the review step did not exist in practice.
 * With `submit` on the create route, a PO now reaches PENDING_APPROVAL deliberately, and this
 * is the one door out of it.
 *
 * Approving is also the ONLY way to reach APPROVED: `PUT /api/purchase-orders/[id]` refuses
 * that status with "Use the Approve action". It used to accept it, which let anyone holding
 * `purchase_orders.edit` approve a PO without the approve grant and with no authoriser
 * recorded.
 *
 * ─── SELF-APPROVAL IS ALLOWED, AND LOGGED (O7) ───────────────────────────────────────────
 *
 * A shop this size has days when the person who raised the order is the only person present
 * who can approve it. Refusing would stop work; pretending it did not happen would be worse.
 * So it is permitted, warned in the server log, and written into the activity row's details
 * where anyone reviewing the trail can see it.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("purchase_orders", "approve");
    const { id } = await params;

    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { id: true, poNumber: true, status: true, createdById: true, grandTotal: true },
    });
    if (!po) return errorResponse("Purchase order not found", 404);

    if (po.status !== "PENDING_APPROVAL") {
      // Named states, not "not in a state that can be approved" — the previous wording left
      // the person guessing what to do, and the answer differs per state.
      const hint =
        po.status === "DRAFT"
          ? "Submit it for approval first."
          : po.status === "APPROVED"
            ? "It is already approved."
            : `It is ${po.status.replace(/_/g, " ").toLowerCase()}.`;
      return errorResponse(`This purchase order cannot be approved. ${hint}`, 400);
    }

    const selfApproved = po.createdById === user.id;
    if (selfApproved) {
      log.warn("po self-approved", { poId: id, poNumber: po.poNumber, userId: user.id });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: "APPROVED",
          approvedById: user.id,
          approvedAt: new Date(),
        },
        include: {
          vendor: { select: { name: true, whatsappNumber: true } },
          items: { include: { product: { select: { name: true, sku: true } } } },
        },
      });

      await logActivity(tx, {
        module: "purchase_orders",
        action: "approved",
        entityType: "PurchaseOrder",
        entityId: id,
        entityRef: po.poNumber,
        fromValue: "PENDING_APPROVAL",
        toValue: "APPROVED",
        details: selfApproved ? "Self-approved by the person who raised it" : null,
        userId: user.id,
        userName: user.name,
      });

      return row;
    });

    log.info("purchase order approved", {
      poId: id,
      poNumber: po.poNumber,
      selfApproved,
    });
    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to approve purchase order";
    log.error("purchase order approval failed", { message });
    return errorResponse(message, 400);
  }
}
