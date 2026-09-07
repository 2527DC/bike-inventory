export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { purchaseOrderUpdateSchema } from "@/lib/validations";
import { canTransition, transitionError, isEditable } from "@/lib/purchase-orders/status";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("purchase-orders:id");

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("purchase_orders", "view");
    const { id } = await params;
    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        // `vendor: true` already returns `email`, which is what the send sheet prefills with.
        // Contacts are a separate relation and were not included — without them the fallback
        // "the vendor has no address of its own, use the primary contact's" cannot happen on
        // the client. Sorted, not filtered: nothing guarantees a primary exists.
        vendor: {
          include: {
            contacts: {
              select: { name: true, email: true, isPrimary: true },
              orderBy: { isPrimary: "desc" },
            },
          },
        },
        items: { include: { product: { select: { name: true, sku: true, currentStock: true } } } },
        createdBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
        // Who sent it. The scalar sent* columns come back with the row, but the NAME needs the
        // relation — without this the Order Info line can say when and how but never by whom.
        sentBy: { select: { name: true } },
        bills: { include: { payments: true } },
      },
    });

    if (!po) return errorResponse("Purchase order not found", 404);
    return successResponse(po);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch purchase order", 500);
  }
}

/**
 * Edit a purchase order's header, or move it through the state machine.
 *
 * ─── WHAT THIS ROUTE USED TO ALLOW ───────────────────────────────────────────────────────
 *
 * A hardcoded copy of the enum and ONE rule ("SENT_TO_VENDOR requires APPROVED"). Everything
 * else was free: RECEIVED -> DRAFT, CANCELLED -> APPROVED, DRAFT -> RECEIVED all succeeded.
 *
 * Worst of all it accepted `status: "APPROVED"` directly, which routed around
 * POST /[id]/approve entirely: no `purchase_orders.approve` grant needed, and
 * `approvedById`/`approvedAt` left null — an approved purchase order with no authoriser on
 * record. Both are refused here now and pointed at the route that owns them.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("purchase_orders", "edit");
    const { id } = await params;

    const parsed = purchaseOrderUpdateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid update", 400);
    }
    const data = parsed.data;

    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { id: true, poNumber: true, status: true, notes: true, expectedDate: true },
    });
    if (!po) return errorResponse("Purchase order not found", 404);

    // Both of these have side effects a bare status write would skip — an authoriser on
    // record, and the sentAt/sentVia/sendCount columns — so they belong to their own routes.
    if (data.status === "APPROVED") return errorResponse("Use the Approve action", 400);
    if (data.status === "SENT_TO_VENDOR") {
      return errorResponse("Use Send to vendor or Mark sent", 400);
    }

    const movingStatus = data.status !== undefined && data.status !== po.status;
    if (movingStatus && !canTransition(po.status, data.status!)) {
      return errorResponse(transitionError(po.status, data.status!), 409);
    }

    // Header edits are refused once the PO has been approved or sent: the content is what
    // somebody authorised, or what the vendor is holding. Re-open it to draft first, which
    // clears the approval and makes the change visible rather than silent.
    const editingHeader = data.notes !== undefined || data.expectedDate !== undefined;
    if (editingHeader && !isEditable(po.status)) {
      return errorResponse("Re-open to draft before editing", 409);
    }

    // Going back to DRAFT clears the approval. Leaving approvedBy set on a re-opened PO would
    // mean the next Approve overwrites a record of who approved which version.
    const reopening = data.status === "DRAFT" && po.status !== "DRAFT";

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.purchaseOrder.update({
        where: { id },
        data: {
          ...(data.status !== undefined && { status: data.status }),
          ...(data.notes !== undefined && { notes: data.notes }),
          ...(data.expectedDate !== undefined && {
            expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
          }),
          ...(reopening && { approvedById: null, approvedAt: null }),
        },
        include: { vendor: { select: { name: true } }, items: true },
      });

      if (movingStatus) {
        await logActivity(tx, {
          module: "purchase_orders",
          action: data.status === "CANCELLED" ? "cancelled" : "status_changed",
          entityType: "PurchaseOrder",
          entityId: id,
          entityRef: po.poNumber,
          fromValue: po.status,
          toValue: data.status!,
          details: reopening ? "Re-opened to draft; approval cleared" : null,
          userId: user.id,
          userName: user.name,
        });
      } else if (editingHeader) {
        const changed: string[] = [];
        if (data.notes !== undefined && data.notes !== po.notes) changed.push("notes");
        if (data.expectedDate !== undefined) changed.push("expected date");
        if (changed.length > 0) {
          await logActivity(tx, {
            module: "purchase_orders",
            action: "updated",
            entityType: "PurchaseOrder",
            entityId: id,
            entityRef: po.poNumber,
            details: `Changed ${changed.join(", ")}`,
            userId: user.id,
            userName: user.name,
          });
        }
      }

      return row;
    });

    log.info("purchase order updated", {
      poId: id,
      poNumber: po.poNumber,
      from: po.status,
      to: updated.status,
    });
    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to update purchase order";
    log.error("purchase order update failed", { message });
    return errorResponse(message, 400);
  }
}
