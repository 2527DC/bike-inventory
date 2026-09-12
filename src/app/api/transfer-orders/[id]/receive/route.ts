export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { z } from "zod";
import { warehouseById } from "@/lib/warehouses";
import { assertTransition, TransitionError } from "@/lib/transfers/transitions";
import { moveIntoWarehouse, writeTransferLedgerRow } from "@/lib/transfers/stock";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("transfer-orders:receive");

const schema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        // 0 is legal and meaningful: "this line arrived, and none of it was in the van".
        receivedQty: z.number().int().min(0),
      })
    )
    .min(1, "At least one line is required"),
  note: z.string().max(1000).optional(),
});

/**
 * POST: receive a transfer that is in transit. The stock ARRIVES at the destination here.
 *
 * ─── WHY EVERY LINE MUST BE PRESENT ───────────────────────────────────────────────────────
 *
 * The van either arrived or it did not. Receiving three lines of a five-line order and leaving
 * the other two IN_TRANSIT would mean stock permanently in a van that has already been
 * unloaded — so the whole order is settled in one call, and a line that did not turn up is
 * recorded as `receivedQty: 0` rather than omitted. That is also why the API refuses a partial
 * body instead of assuming the missing lines arrived in full.
 *
 * ─── THE SHORTFALL LEDGER ROW RECORDS. IT DOES NOT DEDUCT ─────────────────────────────────
 *
 * This is the one place the plan's shorthand ("ADJUSTMENT −shortfall") would produce a real
 * bug if taken literally. Follow the arithmetic:
 *
 *     dispatch   global total −= quantity        (the units left the source)
 *     receive    global total += receivedQty     (what actually arrived)
 *     net                     −= shortfall       ← already correct, with no further write
 *
 * The missing units are ALREADY out of the total, because dispatch took them out and receipt
 * only puts back what turned up. A second deducting adjustment would remove them twice and
 * quietly understate stock by the size of every shortfall ever recorded.
 *
 * So the `[TRANSIT SHORTFALL]` row is written with `previousStock === newStock`: it changes
 * nothing and exists to say WHY the total fell — otherwise the only trace of five lost units
 * is a dispatch of 10 followed by a receipt of 5, and nobody reading the ledger a month later
 * can tell that from a half-finished transfer.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("transfers", "edit");
    const { id } = await params;
    const body = await req.json();
    const input = schema.parse(body);

    const order = await prisma.transferOrder.findUnique({
      where: { id },
      select: {
        id: true,
        orderNo: true,
        status: true,
        fromWarehouseId: true,
        toWarehouseId: true,
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            toWarehouseId: true,
            product: { select: { name: true } },
          },
        },
      },
    });

    if (!order) return errorResponse("Transfer order not found", 404);
    assertTransition(order.status, "RECEIVED");

    const destId = order.toWarehouseId ?? order.items[0]?.toWarehouseId ?? null;
    if (!destId) {
      return errorResponse("This transfer has no destination warehouse recorded, so it cannot be received.", 400);
    }

    // Receipt fills the DESTINATION, so the destination is what scopes it.
    if (user.warehouseId && user.warehouseId !== destId) {
      return errorResponse("You can only receive transfers arriving at your own warehouse.", 403);
    }

    const destWh = await warehouseById(destId);
    if (!destWh) return errorResponse("This transfer's destination is no longer an active warehouse.", 400);
    const sourceWh = order.fromWarehouseId ? await warehouseById(order.fromWarehouseId) : null;

    const byId = new Map(order.items.map((i) => [i.id, i]));
    const submitted = new Map(input.items.map((i) => [i.itemId, i.receivedQty]));

    for (const [itemId] of submitted) {
      if (!byId.has(itemId)) return errorResponse("That line is not on this transfer.", 400);
    }
    const missing = order.items.filter((i) => !submitted.has(i.id));
    if (missing.length > 0) {
      return errorResponse(
        `Record a received quantity for every line. Missing: ${missing.map((m) => m.product.name).join(", ")}`,
        400
      );
    }
    for (const item of order.items) {
      const received = submitted.get(item.id)!;
      if (received > item.quantity) {
        return errorResponse(
          `Cannot receive ${received} of ${item.product.name} — only ${item.quantity} were dispatched.`,
          400
        );
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.transferOrder.updateMany({
        where: { id, status: "IN_TRANSIT" },
        data: {
          status: "RECEIVED",
          receivedById: user.id,
          receivedAt: new Date(),
          receiveNote: input.note?.trim() || null,
        },
      });
      if (claim.count !== 1) return { claimed: false as const };

      let shortLines = 0;

      for (const item of order.items) {
        const received = submitted.get(item.id)!;
        const shortfall = item.quantity - received;

        await tx.transferOrderItem.update({
          where: { id: item.id },
          // NULL means "not received yet" and 0 means "received, none arrived". Writing the
          // number — including 0 — is what makes that distinction real.
          data: { receivedQty: received },
        });

        if (received > 0) {
          const previousStock = await tx.product
            .findUnique({ where: { id: item.productId }, select: { currentStock: true } })
            .then((p) => p?.currentStock ?? 0);

          const newStock = await moveIntoWarehouse(tx, item.productId, destId, received);

          await writeTransferLedgerRow(tx, {
            type: "TRANSFER",
            productId: item.productId,
            quantity: received,
            previousStock,
            newStock,
            orderNo: order.orderNo,
            tag: "[RECEIVED]",
            fromLabel: sourceWh?.name,
            toLabel: destWh.name,
            userId: user.id,
          });
        }

        if (shortfall > 0) {
          shortLines += 1;
          // See the header: this RECORDS the loss, it does not deduct it again. The units left
          // the total at dispatch and were never added back.
          const current = await tx.product
            .findUnique({ where: { id: item.productId }, select: { currentStock: true } })
            .then((p) => p?.currentStock ?? 0);

          await writeTransferLedgerRow(tx, {
            type: "ADJUSTMENT",
            productId: item.productId,
            quantity: shortfall,
            previousStock: current,
            newStock: current,
            orderNo: order.orderNo,
            tag: "[TRANSIT SHORTFALL]",
            fromLabel: sourceWh?.name,
            toLabel: destWh.name,
            userId: user.id,
          });
        }
      }

      // Also relocate received units to destination warehouse
      const transferUnits = await tx.transferOrderUnit.findMany({
        where: { transferOrderId: id, receivedAt: null },
      });

      for (const tu of transferUnits) {
        await tx.transferOrderUnit.update({
          where: { id: tu.id },
          data: { receivedAt: new Date() },
        });

        await tx.inventoryUnit.update({
          where: { id: tu.unitId },
          data: {
            warehouseId: destId,
            binId: null, // ready for put-away into destination warehouse bin
            status: "PUT_AWAY",
          },
        });
      }

      await logActivity(tx, {
        module: "transfers",
        action: "received",
        entityType: "TransferOrder",
        entityId: order.id,
        entityRef: order.orderNo,
        fromValue: "IN_TRANSIT",
        toValue: "RECEIVED",
        details:
          shortLines > 0
            ? `${shortLines} line${shortLines === 1 ? "" : "s"} short of what was dispatched`
            : "All lines received in full",
        userId: user.id,
        userName: user.name,
      });

      return { claimed: true as const, shortLines };
    });

    if (!result.claimed) {
      return errorResponse("This transfer has already been received.", 409);
    }

    log.info("transfer received", {
      orderId: order.id,
      orderNo: order.orderNo,
      lines: order.items.length,
      shortLines: result.shortLines,
    });

    return successResponse({
      message: "Transfer received",
      status: "RECEIVED",
      shortLines: result.shortLines,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof TransitionError) return errorResponse(error.message, error.status);
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message ?? "Invalid receipt", 400);
    }
    const message = error instanceof Error ? error.message : "Failed to receive this transfer";
    log.error("transfer receive failed", { message });
    return errorResponse(message, 400);
  }
}
