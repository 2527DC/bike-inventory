export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { canTransition, transitionError } from "@/lib/purchase-orders/status";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("purchase-orders:mark-sent");

/** Thrown inside the transaction when another request claimed the send first. */
class AlreadySentError extends Error {
  constructor() {
    super("This purchase order was just marked sent by someone else");
    this.name = "AlreadySentError";
  }
}

const markSentSchema = z.object({
  // MANUAL covers "handed it over at the counter" and "read it out on the phone". EMAIL is
  // reserved for P12, which sends it itself and records a PurchaseOrderSend row with the
  // message id — claiming EMAIL here would assert a delivery nothing can evidence.
  channel: z.enum(["WHATSAPP", "MANUAL"]).default("WHATSAPP"),
  note: z.string().max(500).optional(),
});

/**
 * Record that an approved PO was sent to the vendor by hand.
 *
 * ─── WHY THIS ROUTE EXISTS NOW RATHER THAN IN P12 ────────────────────────────────────────
 *
 * "Mark Sent" on the detail screen was a plain `PUT { status: "SENT_TO_VENDOR" }`. P9's state
 * machine refuses that status on the PUT, so without this route the existing button would
 * simply stop working — the plan says "Mark sent is kept until P12", and keeping it means
 * giving it somewhere to go.
 *
 * It also fixes what that PUT never did. `sentAt`, `sentById`, `sentVia` and `sendCount` have
 * existed on the header since MIG-1a and were written by NOTHING: a PO could read
 * SENT_TO_VENDOR with every column recording the send still null. That is the whole reason a
 * bare status write is the wrong tool here.
 *
 * A `PurchaseOrderSend` row is written too, so the manual sends sit in the same trail P12's
 * emails will. `sentByName` is snapshotted beside the id because that model deliberately
 * carries no foreign key to User — a send trail outlives the buyer who sent it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("purchase_orders", "edit");
    const { id } = await params;

    const parsed = markSentSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request", 400);
    }
    const { channel, note } = parsed.data;

    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { id: true, poNumber: true, status: true, sendCount: true },
    });
    if (!po) return errorResponse("Purchase order not found", 404);

    if (!canTransition(po.status, "SENT_TO_VENDOR")) {
      return errorResponse(transitionError(po.status, "SENT_TO_VENDOR"), 409);
    }

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      // Claimed, not asserted. A plain update({ where: { id } }) lets two taps both succeed
      // and drives sendCount to 2 for one send — the same shape of bug P7 fixed on inbound
      // receiving. The status in the WHERE is the idempotency key: exactly one caller wins.
      const claim = await tx.purchaseOrder.updateMany({
        where: { id, status: po.status },
        data: {
          status: "SENT_TO_VENDOR",
          sentAt: now,
          sentById: user.id,
          sentVia: channel,
          // Incremented, not set to 1: a re-send after a correction should read as a re-send
          // rather than overwrite the first one silently.
          sendCount: { increment: 1 },
        },
      });

      if (claim.count === 0) {
        // Somebody else got there first between the read and this write.
        throw new AlreadySentError();
      }

      const row = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id },
        include: { vendor: { select: { name: true } }, items: true },
      });

      await tx.purchaseOrderSend.create({
        data: {
          purchaseOrderId: id,
          channel,
          status: "SENT",
          note: note ?? null,
          sentById: user.id,
          sentByName: user.name,
          completedAt: now,
        },
      });

      await logActivity(tx, {
        module: "purchase_orders",
        action: "sent",
        entityType: "PurchaseOrder",
        entityId: id,
        entityRef: po.poNumber,
        fromValue: po.status,
        toValue: "SENT_TO_VENDOR",
        details: `Marked sent via ${channel.toLowerCase()}${
          po.sendCount > 0 ? ` (send ${po.sendCount + 1})` : ""
        }`,
        userId: user.id,
        userName: user.name,
      });

      return row;
    });

    log.info("purchase order marked sent", {
      poId: id,
      poNumber: po.poNumber,
      channel,
      sendCount: po.sendCount + 1,
    });
    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof AlreadySentError) return errorResponse(error.message, 409);
    const message = error instanceof Error ? error.message : "Failed to mark the purchase order sent";
    log.error("mark sent failed", { message });
    return errorResponse(message, 400);
  }
}
