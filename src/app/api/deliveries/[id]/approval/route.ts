export const dynamic = "force-dynamic";

export const runtime = "nodejs";
// nodejs, explicitly: the notice this route sends reaches SMTP (a raw socket on 587) and the FCM
// JWT signer (node crypto) through notify(). Neither works on the edge runtime.

import { NextRequest, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import {
  APPROVAL_SELECT,
  DeliveryApprovalError,
  approveDelivery,
  rejectDelivery,
  requestDeliveryApproval,
  sendDeliveryApprovalNotice,
  type DeliveryApprovalNotice,
} from "@/lib/approvals/actions/delivery";
import { createLogger } from "@/lib/logger";

const log = createLogger("deliveries:approval");

/**
 * Outbound approval (plan 1709, R26a, R25, Q15, Q16).
 *
 * Three actions, two grants:
 *   { action: "request" }              → `deliveries.edit`    — the person preparing the outward
 *   { action: "approve", note? }       → `deliveries.approve`
 *   { action: "reject",  note }        → `deliveries.approve` — note REQUIRED (R25)
 *
 * The decision itself lives in `src/lib/approvals/actions/delivery.ts`, because the Requests page
 * and the notification action button approve the same way and must not diverge. This route is the
 * HTTP skin: permission, body, transaction, then send the notice after the commit (notify §F.0).
 */
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request") }),
  z.object({ action: z.literal("approve"), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("reject"), note: z.string().trim().min(1, "Say what needs correcting.").max(500) }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let deliveryId: string | undefined;
  let action: string | undefined;
  try {
    const { id } = await params;
    deliveryId = id;
    const parsed = bodySchema.parse(await req.json());
    action = parsed.action;

    // The grant is checked BEFORE the row is read, so a user with no business here cannot use
    // the 404 to learn whether an invoice exists.
    const user = await requireFeature("deliveries", parsed.action === "request" ? "edit" : "approve");

    let notice: DeliveryApprovalNotice | null = null;
    const result = await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction: two approvers pressing at once must not both write.
      const delivery = await tx.delivery.findUnique({ where: { id }, select: APPROVAL_SELECT });
      if (!delivery) throw new DeliveryApprovalError("Delivery not found", 404);

      const outcome =
        parsed.action === "request"
          ? await requestDeliveryApproval(tx, delivery, user)
          : parsed.action === "approve"
            ? await approveDelivery(tx, delivery, user, parsed.note)
            : await rejectDelivery(tx, delivery, user, parsed.note);

      notice = outcome.notice;
      return outcome.delivery;
    });

    // Committed. Sent after the response has gone out; nothing is sent if the transaction threw.
    after(() => sendDeliveryApprovalNotice(notice));

    log.info("outbound approval action", { deliveryId: id, action: parsed.action, invoiceNo: result.invoiceNo });
    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("approval refused", { deliveryId, action, status: error.status });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof DeliveryApprovalError) {
      log.warn("approval refused", { deliveryId, action, status: error.status, reason: error.message });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof z.ZodError) {
      log.warn("approval body rejected", { deliveryId, action });
      return errorResponse(error.issues[0]?.message ?? "Invalid approval request", 400);
    }
    log.error("approval failed", {
      deliveryId,
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to update approval", 500);
  }
}
