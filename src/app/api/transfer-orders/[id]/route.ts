export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { z } from "zod";
import { computeActions } from "@/lib/transfers/actions";
import { EWAY_BILL_THRESHOLD } from "@/lib/transfers/policy";
import { transferItemSchema, validateTransferItems, isRefusal } from "@/lib/transfers/items";
import { warehouseById } from "@/lib/warehouses";
import { logActivity } from "@/lib/activity-log";
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

    const [canApprove, canEdit, canDelete, canCreate, canSeeCost] = await Promise.all([
      userCan(user.id, "transfers", "approve"),
      userCan(user.id, "transfers", "edit"),
      userCan(user.id, "transfers", "delete"),
      userCan(user.id, "transfers", "create"),
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
        canCreate,
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

const patchSchema = z.object({
  items: z.array(transferItemSchema).min(1, "At least one item is required"),
  notes: z.string().max(1000).optional(),
});

/**
 * PATCH: fix a RETURNED transfer and leave it ready to resubmit (R25, Q36).
 *
 * ─── WHY THERE WAS NO EDIT ROUTE BEFORE, AND WHY THIS ONE IS SAFE ─────────────────────────
 *
 * A transfer order has never been editable after create. That was right while Reject was
 * terminal: the only way back was a NEW order, and an order whose lines could change under an
 * approver would make approval meaningless. R25 replaces Reject with RETURNED — the creator
 * fixes the SAME record — so exactly one status accepts an edit, and it is the one status in
 * which nobody has agreed to anything and no stock has moved.
 *
 * `status: "RETURNED"` is therefore in the WHERE of every write below, not only in an `if`
 * above them. An order approved a moment ago by somebody else cannot have its lines rewritten
 * by a PATCH that read the row a second earlier.
 *
 * The lines are REPLACED, not merged. A returned order is being re-stated, and merging would
 * leave a line the creator deleted on a record they believe they corrected. The same four
 * checks `POST /api/transfer-orders` applies run first (`src/lib/transfers/items.ts`).
 *
 * The lane (`mode`, the two warehouses, `requiredDocType`) is NOT editable. Changing it would
 * change which document the transfer needs and which building the stock leaves, which is a
 * different transfer — cancel this one and raise that.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    // Not `requireFeature`: the two people who may do this are the creator — who needs no
    // further grant to correct their own returned request — and anyone holding
    // `transfers.create`, so a colleague can fix it while the creator is off the floor.
    const user = await requireAuth();
    const body = await req.json();
    const data = patchSchema.parse(body);

    const order = await prisma.transferOrder.findUnique({
      where: { id },
      select: {
        id: true,
        orderNo: true,
        status: true,
        createdById: true,
        fromWarehouseId: true,
        toWarehouseId: true,
      },
    });
    if (!order) return errorResponse("Transfer order not found", 404);

    const canCreate = await userCan(user.id, "transfers", "create");
    if (!canCreate && order.createdById !== user.id) {
      return errorResponse("You can only edit a transfer you raised.", 403);
    }

    if (order.status !== "RETURNED") {
      log.warn("transfer edit refused by status", { orderId: id, status: order.status, userId: user.id });
      return errorResponse(
        `This transfer is ${order.status.toLowerCase().replace(/_/g, " ")}. Only a returned transfer can be edited.`,
        409
      );
    }

    if (!order.fromWarehouseId || !order.toWarehouseId) {
      return errorResponse(
        "This transfer has no route recorded, so its lines cannot be edited. Cancel it and raise it again from /transfers/new.",
        400
      );
    }
    const [fromWh, toWh] = await Promise.all([
      warehouseById(order.fromWarehouseId),
      warehouseById(order.toWarehouseId),
    ]);
    if (!fromWh || !toWh) {
      return errorResponse("This transfer's route is no longer an active warehouse pair.", 400);
    }

    const lineCheck = await validateTransferItems({
      items: data.items,
      fromWh,
      toWh,
      context: { orderId: order.id, orderNo: order.orderNo },
    });
    if (isRefusal(lineCheck)) return errorResponse(lineCheck.error, lineCheck.status);
    const { binTrackingEnabled } = lineCheck;

    const updated = await prisma.$transaction(async (tx) => {
      // The claim is what makes the status check real — see the header.
      const claim = await tx.transferOrder.updateMany({
        where: { id, status: "RETURNED" },
        data: { notes: data.notes ?? undefined },
      });
      if (claim.count !== 1) return null;

      await tx.transferOrderItem.deleteMany({ where: { transferOrderId: id } });
      await tx.transferOrderItem.createMany({
        data: data.items.map((item) => ({
          transferOrderId: id,
          productId: item.productId,
          quantity: item.quantity,
          fromBinId: binTrackingEnabled ? item.fromBinId ?? null : null,
          toBinId: binTrackingEnabled ? item.toBinId ?? null : null,
          // Mirrored from the header, as at create.
          fromWarehouseId: fromWh.id,
          toWarehouseId: toWh.id,
        })),
      });

      await logActivity(tx, {
        module: "transfers",
        action: "edited",
        entityType: "TransferOrder",
        entityId: order.id,
        entityRef: order.orderNo,
        fromValue: "RETURNED",
        toValue: "RETURNED",
        details: `${data.items.length} line${data.items.length === 1 ? "" : "s"} after a return`,
        userId: user.id,
        userName: user.name,
      });

      return tx.transferOrder.findUnique({
        where: { id },
        select: { id: true, orderNo: true, status: true },
      });
    });

    if (!updated) {
      return errorResponse("This transfer is no longer returned, so it cannot be edited.", 409);
    }

    log.info("returned transfer edited", {
      orderId: order.id,
      orderNo: order.orderNo,
      lines: data.items.length,
      userId: user.id,
    });
    return successResponse({ message: "Transfer updated. Resubmit it when you are ready.", ...updated });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message ?? "Invalid transfer order", 400);
    }
    const message = error instanceof Error ? error.message : "Failed to update this transfer";
    log.error("transfer edit failed", { orderId: id, message });
    return errorResponse(message, 400);
  }
}
