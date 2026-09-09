export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { z } from "zod";
import { getWarehouseBreakdown } from "@/lib/stock-location";
import { warehouseById } from "@/lib/warehouses";
import { assertTransition, TransitionError } from "@/lib/transfers/transitions";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("transfer-orders:approve");

const schema = z.object({
  action: z.enum(["approve", "reject"]),
  rejectionNote: z.string().max(1000).optional(),
});

/**
 * POST: approve or reject a pending transfer.
 *
 * ─── APPROVAL NO LONGER MOVES STOCK. THIS IS THE HEART OF P14 ─────────────────────────────
 *
 * The old version of this route called `adjustWarehouseQty` twice per line and wrote an
 * `[APPROVED]` ledger row — the entire movement happened the instant somebody said yes. That
 * was fine while a transfer was an instantaneous bookkeeping entry, and wrong the moment a van
 * became part of it: the stock left the source and arrived at the destination in the same
 * millisecond, so a receiving clerk had nothing to receive and a shortfall had nowhere to go.
 *
 * Now approval agrees to the movement and nothing else. Dispatch takes the stock out; receipt
 * puts it in. MIG-2 rewrote the legacy APPROVED rows to RECEIVED precisely because they mean
 * the OLD thing ("everything has moved") and this route now produces the new one ("nothing has
 * moved yet") — leaving them alone would have made every historical transfer dispatchable a
 * second time.
 *
 * ─── THE STOCK CHECK STAYS, AND IS STILL NOT A GUARANTEE ──────────────────────────────────
 *
 * Approving something the source cannot cover is worth refusing early, so the check remains.
 * But it proves nothing about dispatch time — anything can sell in between — so dispatch
 * re-checks inside its own transaction with the row locked. That one is the real gate.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("transfers", "approve");
    const { id } = await params;
    const body = await req.json();
    const { action, rejectionNote } = schema.parse(body);

    const order = await prisma.transferOrder.findUnique({
      where: { id },
      select: {
        id: true,
        orderNo: true,
        status: true,
        fromWarehouseId: true,
        toWarehouseId: true,
        requiredDocType: true,
        items: {
          select: {
            productId: true,
            quantity: true,
            fromWarehouseId: true,
            product: { select: { name: true } },
          },
        },
      },
    });

    if (!order) return errorResponse("Transfer order not found", 404);

    assertTransition(order.status, action === "approve" ? "APPROVED" : "REJECTED");

    if (action === "reject") {
      // Idempotent claim, the pattern P7 established for inbound: the precondition lives in
      // the WHERE rather than in an `if` above it, so two people rejecting the same order at
      // the same moment produce one write and one no-op instead of two writes.
      //
      // Claim and log commit TOGETHER. `logActivity(tx, …)` throws on failure and takes the
      // review with it, which is what activity-log.ts asks for when the entry is evidence
      // rather than telemetry — a review nobody can attribute is worse than one that never
      // happened.
      const claimed = await prisma.$transaction(async (tx) => {
        const claim = await tx.transferOrder.updateMany({
          where: { id, status: "PENDING" },
          data: {
            status: "REJECTED",
            reviewedById: user.id,
            reviewedAt: new Date(),
            rejectionNote: rejectionNote || null,
          },
        });
        if (claim.count !== 1) return false;

        await logActivity(tx, {
          module: "transfers",
          action: "rejected",
          entityType: "TransferOrder",
          entityId: order.id,
          entityRef: order.orderNo,
          fromValue: "PENDING",
          toValue: "REJECTED",
          details: rejectionNote || null,
          userId: user.id,
          userName: user.name,
        });
        return true;
      });
      if (!claimed) {
        return errorResponse("This transfer has already been reviewed.", 409);
      }

      log.info("transfer rejected", { orderId: order.id, orderNo: order.orderNo });
      return successResponse({ message: "Transfer order rejected", status: "REJECTED" });
    }

    // ── approve ──────────────────────────────────────────────────────────────────────────
    const sourceId = order.fromWarehouseId ?? order.items[0]?.fromWarehouseId ?? null;
    if (!sourceId) {
      return errorResponse(
        "This transfer has no source warehouse recorded, so it cannot be approved. Raise it again from /transfers/new.",
        400
      );
    }
    const sourceWh = await warehouseById(sourceId);
    if (!sourceWh) {
      return errorResponse("This transfer's source is no longer an active warehouse.", 400);
    }

    const breakdown = await getWarehouseBreakdown(order.items.map((i) => i.productId));
    for (const item of order.items) {
      const available = breakdown.get(item.productId)?.[sourceWh.code] ?? 0;
      if (available < item.quantity) {
        return errorResponse(
          `Insufficient stock for ${item.product.name} at ${sourceWh.name}. Available: ${available}, requested: ${item.quantity}`,
          400
        );
      }
    }

    // A transfer raised before the document policy existed has a null `requiredDocType`.
    // This used to be backfilled here from the two stores' GSTINs; that derivation was deleted
    // on 9 Sep 2026 (the document is decided by the mode chosen at creation, never by the
    // GSTIN). A null one is left alone rather than guessed at — the dispatch gate already
    // treats null as "predates the policy" and lets it through. There are no such rows today.
    if (!order.requiredDocType) {
      log.warn("approving a transfer with no requiredDocType; left null", {
        orderId: order.id,
        orderNo: order.orderNo,
      });
    }

    const claimed = await prisma.$transaction(async (tx) => {
      const claim = await tx.transferOrder.updateMany({
        where: { id, status: "PENDING" },
        data: {
          status: "APPROVED",
          reviewedById: user.id,
          reviewedAt: new Date(),
        },
      });
      if (claim.count !== 1) return false;

      await logActivity(tx, {
        module: "transfers",
        action: "approved",
        entityType: "TransferOrder",
        entityId: order.id,
        entityRef: order.orderNo,
        fromValue: "PENDING",
        toValue: "APPROVED",
        userId: user.id,
        userName: user.name,
      });
      return true;
    });
    if (!claimed) {
      return errorResponse("This transfer has already been reviewed.", 409);
    }

    log.info("transfer approved", {
      orderId: order.id,
      orderNo: order.orderNo,
      requiredDocType: order.requiredDocType,
    });

    return successResponse({
      message: "Transfer order approved",
      status: "APPROVED",
      requiredDocType: order.requiredDocType,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof TransitionError) return errorResponse(error.message, error.status);
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message ?? "Invalid request", 400);
    }
    const message = error instanceof Error ? error.message : "Failed to process transfer order";
    log.error("transfer approve failed", { message });
    return errorResponse(message, 400);
  }
}
