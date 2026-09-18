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
import { moveUnits, retireUnits } from "@/lib/units";
import { recordApprovalEvent } from "@/lib/approvals/events";
import { holdDeliveryStock, isDummy, TERMINAL_STATUSES } from "@/lib/deliveries/floor-stock";
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
        // Who approved this transfer — a short receipt is counted against them (R26), not
        // against the clerk unloading the van.
        reviewedById: true,
        // The outward this transfer was raised for by Find stock (R45, P16). Receiving it holds
        // that outward's stock at once (P19).
        deliveryId: true,
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
      let totalShortfall = 0;

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
          totalShortfall += shortfall;
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

      // ── UNITS: ONLY WHAT ARRIVED (plan 1709, Part B, R7) ──────────────────────────────────
      //
      // Kept as one block, apart from the approval and delivery-hold changes that follow in
      // Parts C and D.
      //
      // This used to move EVERY dispatched unit into the destination as PUT_AWAY with no bin,
      // ignoring `receivedQty` — a short receipt left phantom units at the destination. Now,
      // per line, exactly `receivedQty` of that product's dispatched units arrive (held for
      // an outward first, then built, then oldest) as ASSEMBLED / RECEIVED, and the rest are
      // retired as LOST: they left the source at dispatch and never came off the van.
      // Tolerant: a line whose stock had fewer unit records moves what there is.
      const transferUnits = await tx.transferOrderUnit.findMany({
        where: { transferOrderId: id, receivedAt: null, unit: { status: "TRANSFERRED" } },
        select: {
          id: true,
          unitId: true,
          unit: { select: { productId: true, reservedForDeliveryId: true, assembledAt: true, createdAt: true } },
        },
      });
      const pool = new Map<string, typeof transferUnits>();
      for (const tu of transferUnits) {
        const list = pool.get(tu.unit.productId) ?? [];
        list.push(tu);
        pool.set(tu.unit.productId, list);
      }
      for (const list of pool.values()) {
        list.sort(
          (a, b) =>
            Number(b.unit.reservedForDeliveryId !== null) - Number(a.unit.reservedForDeliveryId !== null) ||
            Number(b.unit.assembledAt !== null) - Number(a.unit.assembledAt !== null) ||
            a.unit.createdAt.getTime() - b.unit.createdAt.getTime()
        );
      }

      const arrived: typeof transferUnits = [];
      for (const item of order.items) {
        const list = pool.get(item.productId) ?? [];
        // splice: a product on two lines draws from the same pool without double-counting.
        arrived.push(...list.splice(0, submitted.get(item.id)!));
      }
      const missing = [...pool.values()].flat();

      if (arrived.length > 0) {
        await tx.transferOrderUnit.updateMany({
          where: { id: { in: arrived.map((tu) => tu.id) } },
          data: { receivedAt: new Date() },
        });
        await moveUnits(tx, arrived.map((tu) => tu.unitId), destId);
      }
      if (missing.length > 0) {
        await retireUnits(tx, missing.map((tu) => tu.unitId), "LOST");
      }
      const unitMoves = { arrived: arrived.length, lost: missing.length };

      // ── A SHORT RECEIPT IS AN APPROVER ERROR (plan 1709, Part D, R26) ────────────────────
      //
      // ONE event per receipt, not one per short line. The rule counts "a short receive" as a
      // single error (`countShortReceive`, src/lib/settings/approval-rules.ts); writing a row
      // per line would make a five-line van that arrived one box short look like five separate
      // mistakes and quietly multiply that approver's error rate by the size of the order.
      // The lines themselves stay readable on `TransferOrderItem.receivedQty` and in the
      // `[TRANSIT SHORTFALL]` ledger rows above.
      //
      // `approverId` is the person who APPROVED the transfer (`reviewedById`), never the
      // receiving clerk — see the contract in src/lib/approvals/events.ts.
      if (shortLines > 0) {
        await recordApprovalEvent(tx, {
          activity: "TRANSFER",
          event: "SHORT_RECEIVED",
          recordId: order.id,
          recordRef: order.orderNo,
          actorId: user.id,
          approverId: order.reviewedById,
          warehouseId: destId,
          quantity: totalShortfall,
          note: `${shortLines} line${shortLines === 1 ? "" : "s"} short by ${totalShortfall} in total`,
        });
      }

      // ── P19: the outward this stock was fetched for is held AT ONCE ─────────────────────
      //
      // Deliberately after the units block and before the activity log, as its own step. Until
      // now a received transfer held nothing and staff pressed "Reserve stock now" afterwards —
      // which leaves a window in which the customer's cycle can be sold to a walk-in between
      // the van arriving and somebody remembering.
      //
      // It is best effort BY DESIGN: `holdDeliveryStock` returns `{ held: false, short }` when a
      // line is still short (another transfer is still in transit, say), and that must NOT
      // fail the receipt — the stock is physically in the building either way, and the screens
      // already show "Stock not reserved" with a button. A Dummy outward (no warehouse) and a
      // terminal one (delivered / walked out) are skipped: the first cannot be acted on at all
      // and the second has already gone.
      let deliveryHold: { deliveryId: string; held: boolean; shortLines: number } | null = null;
      if (order.deliveryId) {
        const delivery = await tx.delivery.findUnique({
          where: { id: order.deliveryId },
          select: { id: true, invoiceNo: true, warehouseId: true, status: true, lineItems: true, stockReservedAt: true },
        });
        if (!delivery) {
          log.warn("transfer names an outward that no longer exists", {
            orderId: order.id,
            deliveryId: order.deliveryId,
          });
        } else if (isDummy(delivery) || (TERMINAL_STATUSES as readonly string[]).includes(delivery.status)) {
          log.info("outward not holdable on receive", {
            orderId: order.id,
            deliveryId: delivery.id,
            status: delivery.status,
            dummy: isDummy(delivery),
          });
        } else {
          const hold = await holdDeliveryStock(tx, delivery);
          deliveryHold = { deliveryId: delivery.id, held: hold.held, shortLines: hold.short.length };
        }
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

      return { claimed: true as const, shortLines, unitMoves, deliveryHold };
    }, { timeout: 30_000 });

    if (!result.claimed) {
      return errorResponse("This transfer has already been received.", 409);
    }

    log.info("transfer received", {
      orderId: order.id,
      orderNo: order.orderNo,
      lines: order.items.length,
      shortLines: result.shortLines,
      unitsArrived: result.unitMoves.arrived,
      unitsLost: result.unitMoves.lost,
      deliveryId: result.deliveryHold?.deliveryId ?? null,
      deliveryHeld: result.deliveryHold?.held ?? null,
    });

    return successResponse({
      message: "Transfer received",
      status: "RECEIVED",
      shortLines: result.shortLines,
      // So the receive sheet can say "and the outward's stock is now held" — or why it is not.
      deliveryHold: result.deliveryHold,
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
