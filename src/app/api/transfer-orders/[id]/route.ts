export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { computeActions } from "@/lib/transfers/actions";
import { EWAY_BILL_THRESHOLD } from "@/lib/transfers/policy";
import { createLogger } from "@/lib/logger";

const log = createLogger("transfer-orders:detail");

/**
 * GET: one transfer, everything the detail screen needs, in one request.
 *
 * ─── MONEY IS GATED, AND THE GATE IS COARSER THAN IT LOOKS ────────────────────────────────
 *
 * `unitCost` and `consignmentValue` are returned only with `cost_price.view`. The consignment
 * value is gated for a reason that is easy to miss: on a small transfer it is trivially
 * invertible. One line of twelve units at a total of ₹9,600 tells anybody who can do division
 * exactly what the shop pays per unit — so shipping the total to everyone would leak the cost
 * price that the `cost_price` module exists to protect.
 *
 * Everyone else gets `eWayBillRequired: boolean` instead: the operational fact they actually
 * need ("this consignment needs a bill") without the number behind it.
 *
 * ─── THE ACTION LIST IS COMPUTED HERE, NOT IN THE BROWSER ─────────────────────────────────
 *
 * The screen renders whatever `actions[]` contains and derives nothing from role names. The
 * routes re-check regardless — a client is never the gate — but this keeps the buttons and the
 * permissions from drifting apart, which is exactly how the purchase-order module ended up
 * with three disagreeing opinions about who could do what.
 *
 * ─── WHY THE ACTOR NAMES NEED A SECOND QUERY ──────────────────────────────────────────────
 *
 * `dispatchedById`, `receivedById` and `docUploadedById` are bare `String?` columns with NO
 * relation and no foreign key — unlike `createdById` and `reviewedById`, which are proper
 * relations. So Prisma cannot `include` them, and the timeline resolves the three ids with one
 * `findMany` rather than dragging a fourth migration into this phase to add the constraints.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("transfers", "view");
    const { id } = await params;

    // `include`, not `select`: every scalar on the header — `mode`, `fromStoreId`, `toStoreId`
    // among them — rides along without being named, and `...order` below hands them to the
    // screen. The store sub-selects carry only what the Route card prints; the GSTIN no longer
    // decides anything here (plan 0909-transfer-mode-and-document-attachment §4.6).
    const order = await prisma.transferOrder.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        fromWarehouse: {
          select: { id: true, code: true, name: true, store: { select: { id: true, name: true } } },
        },
        toWarehouse: {
          select: { id: true, code: true, name: true, store: { select: { id: true, name: true } } },
        },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, hsnCode: true } },
            fromWarehouse: { select: { id: true, code: true, name: true } },
            toWarehouse: { select: { id: true, code: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!order) return errorResponse("Transfer order not found", 404);

    const [canApprove, canEdit, canDelete, canSeeCost] = await Promise.all([
      userCan(user.id, "transfers", "approve"),
      userCan(user.id, "transfers", "edit"),
      userCan(user.id, "transfers", "delete"),
      userCan(user.id, "cost_price", "view"),
    ]);

    // Creator-scoped visibility, matching the list route.
    if (!canApprove && !canEdit && order.createdById !== user.id) {
      return errorResponse("You do not have access to this transfer", 403);
    }

    // The three unrelated actor columns, resolved in one go. See the header.
    const actorIds = [order.dispatchedById, order.receivedById, order.docUploadedById].filter(
      (v): v is string => Boolean(v)
    );
    const actors = actorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: [...new Set(actorIds)] } },
          select: { id: true, name: true },
        })
      : [];
    const actorName = new Map(actors.map((a) => [a.id, a.name]));

    const actions = computeActions({
      status: order.status,
      createdById: order.createdById,
      fromWarehouseId: order.fromWarehouseId,
      toWarehouseId: order.toWarehouseId,
      requiredDocType: order.requiredDocType,
      docType: order.docType,
      docUrl: order.docUrl,
      user: {
        id: user.id,
        warehouseId: user.warehouseId,
        canApprove,
        canEdit,
        canDelete,
      },
    });

    const consignmentValue = order.consignmentValue ? Number(order.consignmentValue) : null;

    const payload = {
      ...order,
      // Stripped for everyone without cost_price.view — including the per-line cost, which is
      // the same secret at a finer grain.
      consignmentValue: canSeeCost ? consignmentValue : undefined,
      items: order.items.map((item) => ({
        ...item,
        unitCost: canSeeCost && item.unitCost != null ? Number(item.unitCost) : undefined,
      })),
      // The operational fact, available to everyone. Null before dispatch, when no value has
      // been computed yet and the question cannot honestly be answered.
      eWayBillRequired:
        consignmentValue == null ? null : consignmentValue > EWAY_BILL_THRESHOLD,
      dispatchedByName: order.dispatchedById ? (actorName.get(order.dispatchedById) ?? null) : null,
      receivedByName: order.receivedById ? (actorName.get(order.receivedById) ?? null) : null,
      docUploadedByName: order.docUploadedById ? (actorName.get(order.docUploadedById) ?? null) : null,
      actions,
      canSeeCost,
    };

    log.debug("transfer detail served", { orderId: order.id, actions: actions.length });
    return successResponse(payload);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to load this transfer";
    log.error("transfer detail failed", { message });
    return errorResponse(message, 500);
  }
}
