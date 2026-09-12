export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { z } from "zod";
import { warehouseById } from "@/lib/warehouses";
import { assertTransition, TransitionError } from "@/lib/transfers/transitions";
import { docTypeLabel, EWAY_BILL_THRESHOLD } from "@/lib/transfers/policy";
import { moveOutOfWarehouse, writeTransferLedgerRow } from "@/lib/transfers/stock";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("transfer-orders:dispatch");

const schema = z.object({
  vehicleNo: z.string().max(30).optional(),
  transporterName: z.string().max(100).optional(),
  eWayBillNo: z.string().max(30).optional(),
  unitIds: z.array(z.string()).optional(),
});

/**
 * POST: dispatch an approved transfer. The stock LEAVES the source here.
 *
 * ─── THE ONE THING THAT MUST NOT BE GOT WRONG ─────────────────────────────────────────────
 *
 * Every stock read and every stock write happens INSIDE the transaction, and the deduction
 * goes through `moveOutOfWarehouse`, which refuses rather than short-deducting.
 *
 * The old transfer code did the opposite on both counts: it read availability before
 * `$transaction` opened and then called `adjustWarehouseQty` raw. That helper CLAMPS AT ZERO
 * AND RETURNS SUCCESS, so two people dispatching overlapping orders both passed a check
 * against the same stale pre-image and the second one silently wrote 0 — units gone, no error
 * anywhere. That is the hole this route exists to close, and moving the check inside the
 * transaction is what closes it: the `StockLevel` row is locked for the rest of the
 * transaction, so a concurrent dispatch waits instead of racing.
 *
 * ─── THE GLOBAL TOTAL GENUINELY FALLS HERE ────────────────────────────────────────────────
 *
 * Historical TRANSFER ledger rows all have `previousStock === newStock`, because approval used
 * to move stock out of one warehouse and into another in one step and the global figure never
 * changed. Dispatch and receipt are separate events now, so between them the units are in a
 * van and belong to no warehouse. Both figures are recorded honestly — see
 * `writeTransferLedgerRow`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("transfers", "edit");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const input = schema.parse(body ?? {});

    const order = await prisma.transferOrder.findUnique({
      where: { id },
      select: {
        id: true,
        orderNo: true,
        status: true,
        fromWarehouseId: true,
        toWarehouseId: true,
        requiredDocType: true,
        docType: true,
        docUrl: true,
        eWayBillNo: true,
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            fromWarehouseId: true,
            product: { select: { name: true, costPrice: true } },
          },
        },
      },
    });

    if (!order) return errorResponse("Transfer order not found", 404);
    assertTransition(order.status, "IN_TRANSIT");

    const sourceId = order.fromWarehouseId ?? order.items[0]?.fromWarehouseId ?? null;
    if (!sourceId) {
      return errorResponse("This transfer has no source warehouse recorded, so it cannot be dispatched.", 400);
    }

    // Site scoping — the first place in this application that reads `User.warehouseId`.
    // Dispatch empties the SOURCE, so the source is what scopes it. An unpinned user (null)
    // passes, which is every user today.
    if (user.warehouseId && user.warehouseId !== sourceId) {
      return errorResponse("You can only dispatch transfers leaving your own warehouse.", 403);
    }

    const sourceWh = await warehouseById(sourceId);
    if (!sourceWh) return errorResponse("This transfer's source is no longer an active warehouse.", 400);
    const destWh = order.toWarehouseId ? await warehouseById(order.toWarehouseId) : null;

    // P15's document gate. A null `requiredDocType` means the order predates the policy and
    // dispatches freely — demanding a tax invoice for a movement agreed before the rule
    // existed would strand it forever.
    if (order.requiredDocType) {
      const label = docTypeLabel(order.requiredDocType);
      if (!order.docUrl) {
        return errorResponse(`Attach the ${label} first.`, 400);
      }
      if (order.docType !== order.requiredDocType) {
        return errorResponse(
          `This transfer needs a ${label}. Replace the attached document before dispatching.`,
          400
        );
      }
    }

    const eWayBillNo = input.eWayBillNo?.trim() || order.eWayBillNo || null;

    const result = await prisma.$transaction(async (tx) => {
      // Claim the transition first, with the precondition in the WHERE. P7's pattern: two
      // people pressing Dispatch at the same moment produce one movement and one refusal,
      // not two deductions.
      const claim = await tx.transferOrder.updateMany({
        where: { id, status: "APPROVED" },
        data: {
          status: "IN_TRANSIT",
          dispatchedById: user.id,
          dispatchedAt: new Date(),
          vehicleNo: input.vehicleNo?.trim() || null,
          transporterName: input.transporterName?.trim() || null,
          eWayBillNo,
        },
      });
      if (claim.count !== 1) return { claimed: false as const };

      let consignmentValue = 0;

      for (const item of order.items) {
        // The cost the stock moves at, captured per line. A transfer between two GSTINs is a
        // supply and the tax invoice needs a value — and a cost price read next year would be
        // the wrong one. `InventoryTransaction` has no cost column at all, which is why this
        // lives on the item.
        const unitCost = item.product.costPrice ?? 0;
        consignmentValue += unitCost * item.quantity;

        const previousStock = await tx.product
          .findUnique({ where: { id: item.productId }, select: { currentStock: true } })
          .then((p) => p?.currentStock ?? 0);

        // Refuses rather than clamping. Throwing here rolls back the claim above with it.
        const newStock = await moveOutOfWarehouse(
          tx,
          item.productId,
          sourceId,
          item.quantity,
          item.product.name,
          sourceWh.name
        );

        await tx.transferOrderItem.update({
          where: { id: item.id },
          data: { unitCost },
        });

        await writeTransferLedgerRow(tx, {
          type: "TRANSFER",
          productId: item.productId,
          quantity: item.quantity,
          previousStock,
          newStock,
          orderNo: order.orderNo,
          tag: "[DISPATCHED]",
          fromLabel: sourceWh.name,
          toLabel: destWh?.name,
          userId: user.id,
        });
      }

      // Record dispatched unit barcodes
      if (input.unitIds && input.unitIds.length > 0) {
        for (const unitId of input.unitIds) {
          await tx.transferOrderUnit.upsert({
            where: { transferOrderId_unitId: { transferOrderId: id, unitId } },
            update: { dispatchedAt: new Date() },
            create: {
              transferOrderId: id,
              unitId,
              dispatchedAt: new Date(),
            },
          });

          await tx.inventoryUnit.update({
            where: { id: unitId },
            data: {
              status: "TRANSFERRED",
              binId: null,
            },
          });
        }
      }

      await tx.transferOrder.update({
        where: { id },
        data: { consignmentValue },
      });

      await logActivity(tx, {
        module: "transfers",
        action: "dispatched",
        entityType: "TransferOrder",
        entityId: order.id,
        entityRef: order.orderNo,
        fromValue: "APPROVED",
        toValue: "IN_TRANSIT",
        details: [
          input.vehicleNo?.trim() ? `Vehicle ${input.vehicleNo.trim()}` : null,
          input.transporterName?.trim() || null,
          eWayBillNo ? `E-way ${eWayBillNo}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
        userId: user.id,
        userName: user.name,
      });

      return { claimed: true as const, consignmentValue };
    });

    if (!result.claimed) {
      return errorResponse("This transfer has already been dispatched.", 409);
    }

    // WARNINGS, not refusals. The e-way bill is raised on the government portal, not here, and
    // holding the van because a number has not been typed back into this app would stop real
    // work over a record-keeping gap. It applies to a delivery challan too — the threshold is
    // about MOVEMENT, not about supply, which is the part that surprises people.
    const warnings: string[] = [];
    if (result.consignmentValue > EWAY_BILL_THRESHOLD && !eWayBillNo) {
      warnings.push(
        `This consignment is over ₹${EWAY_BILL_THRESHOLD.toLocaleString("en-IN")} and needs an e-way bill. Add the number once it is raised.`
      );
    }

    log.info("transfer dispatched", {
      orderId: order.id,
      orderNo: order.orderNo,
      lines: order.items.length,
      hasEWayBill: Boolean(eWayBillNo),
      warnings: warnings.length,
    });

    return successResponse({
      message: "Transfer dispatched",
      status: "IN_TRANSIT",
      consignmentValue: result.consignmentValue,
      warnings,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof TransitionError) return errorResponse(error.message, error.status);
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message ?? "Invalid dispatch details", 400);
    }
    const message = error instanceof Error ? error.message : "Failed to dispatch this transfer";
    log.error("transfer dispatch failed", { message });
    return errorResponse(message, 400);
  }
}
