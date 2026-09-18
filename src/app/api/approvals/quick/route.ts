export const dynamic = "force-dynamic";

export const runtime = "nodejs";
// nodejs, explicitly: approving an outward sends a notice through notify(), which signs an
// FCM JWT with node crypto and may open an SMTP socket. Neither exists on the edge runtime.

import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { approveInbound } from "@/lib/approvals/actions/inbound";
import { approveTransfer } from "@/lib/approvals/actions/transfer";
import {
  APPROVAL_SELECT,
  DeliveryApprovalError,
  approveDelivery,
  sendDeliveryApprovalNotice,
  type DeliveryApprovalNotice,
} from "@/lib/approvals/actions/delivery";
import { createLogger } from "@/lib/logger";

const log = createLogger("approvals:quick");

/**
 * One-tap approve from a push notification (plan 1709 §3.8, R24, Q19).
 *
 * The caller is `public/sw.js` — a service worker, with the session cookie and nothing else.
 * There is no screen behind it, no CSRF token, no way to show a form and no way to collect a
 * note. So this route is deliberately narrow:
 *
 *   - It approves. It never returns a record for correction — a return needs a note (R25),
 *     and the "Reject" button on the notification opens the record instead.
 *   - It re-reads nothing the action libraries already read. `approveInbound` /
 *     `approveTransfer` / `approveDelivery` hold the whole decision, and every one of them
 *     RE-CHECKS its own `approve` grant. `requireAuth` here establishes *who* is asking;
 *     the libraries decide whether they may.
 *   - Self-approval is allowed (Q15): the grant is the authority, and the `ApprovalEvent`
 *     records who approved, so the error-rate report still counts it against them.
 *
 * ─── STALE AND DUPLICATE TAPS ─────────────────────────────────────────────────────────────
 *
 * A notification can sit on a lock screen for a day, and a second approver can already have
 * dealt with the record. Nothing here guesses: every action library claims its row with a
 * conditional `updateMany` (or, for an outward, `isDeliveryApproved` inside the transaction)
 * and answers 409 — "This transfer has already been reviewed.", "Already approved", "This
 * outward is already approved." — which the worker shows as the notification's result. Two
 * taps on the same button therefore produce one approval and one honest sentence, not two
 * approvals and not a silent failure.
 *
 * ─── THE RESPONSE SHAPE ───────────────────────────────────────────────────────────────────
 *
 * `{ ok, message }`, not `successResponse`'s envelope. The only consumer is a service worker
 * that puts `message` straight into a notification body, and a worker parsing
 * `{success,data}` for one string would be ceremony with a failure mode. `ok` is also on the
 * 4xx bodies so the worker never has to read the status to know what happened.
 */

const ACTIVITIES = ["INBOUND", "OUTBOUND", "TRANSFER", "STOCK_AUDIT"] as const;

const bodySchema = z.object({
  // STOCK_AUDIT is accepted and then refused with a sentence (below) rather than rejected by
  // the schema: a zod failure would reach the approver as "Invalid request", which tells them
  // nothing about what to do.
  activity: z.enum(ACTIVITIES),
  recordId: z.string().trim().min(1),
  action: z.literal("approve"),
});

/** A refusal the worker can show verbatim. */
function refuse(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(req: NextRequest) {
  let activity: string | undefined;
  let recordId: string | undefined;

  try {
    const parsed = bodySchema.parse(await req.json());
    activity = parsed.activity;
    recordId = parsed.recordId;

    // Authentication only. Authorisation belongs to the action library for the activity —
    // a `requireFeature` here would have to name ONE module, and this route dispatches to
    // four with four different grants.
    const user = await requireAuth();
    const actor = { id: user.id, name: user.name };
    log.debug("-> quick approve", { activity, recordId, userId: user.id });

    if (parsed.activity === "STOCK_AUDIT") {
      // Approving a count is not one decision: it also chooses how the counted quantities are
      // applied. That choice cannot be made from a notification, so there is nothing sensible
      // for this route to do beyond saying where to make it.
      log.info("quick approve declined for a stock audit", { recordId, userId: user.id });
      return refuse(
        "A stock audit is approved on its own screen, where you choose how to apply the counts. Open it to continue.",
        400
      );
    }

    if (parsed.activity === "OUTBOUND") {
      // The outward functions take the caller's transaction client (they are also used by the
      // approval route and the Requests page), so this route supplies one — and the grant check
      // the other two libraries do internally.
      if (!(await userCan(user.id, "deliveries", "approve"))) {
        log.warn("quick approve refused", { activity, recordId, userId: user.id, status: 403 });
        return refuse("You do not have permission to approve outwards", 403);
      }

      let notice: DeliveryApprovalNotice | null = null;
      const delivery = await prisma.$transaction(async (tx) => {
        // Re-read inside the transaction: two approvers tapping at the same moment must not
        // both write.
        const row = await tx.delivery.findUnique({ where: { id: parsed.recordId }, select: APPROVAL_SELECT });
        if (!row) throw new DeliveryApprovalError("That outward no longer exists.", 404);
        const outcome = await approveDelivery(tx, row, actor);
        notice = outcome.notice;
        return outcome.delivery;
      });

      // Committed. `approveDelivery` returns no notice today, but sending whatever it asks for
      // is the contract — a caller that drops it would go quietly wrong the day it does.
      after(() => sendDeliveryApprovalNotice(notice));

      log.info("outward approved from a notification", {
        deliveryId: delivery.id,
        invoiceNo: delivery.invoiceNo,
        approverId: user.id,
      });
      return NextResponse.json({ ok: true, message: `Outward ${delivery.invoiceNo} approved` });
    }

    const result =
      parsed.activity === "INBOUND"
        ? await approveInbound(actor, parsed.recordId)
        : await approveTransfer(actor, parsed.recordId);

    if (!result.ok) {
      log.warn("quick approve refused", {
        activity,
        recordId,
        userId: user.id,
        status: result.httpStatus,
        reason: result.error,
      });
      return refuse(result.error, result.httpStatus);
    }

    log.info("approved from a notification", {
      activity,
      recordId,
      recordRef: result.recordRef,
      approverId: user.id,
    });
    return NextResponse.json({ ok: true, message: `${result.recordRef} approved` });
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("quick approve unauthenticated", { activity, recordId, status: error.status });
      return refuse(error.message, error.status);
    }
    if (error instanceof DeliveryApprovalError) {
      log.warn("quick approve refused", { activity, recordId, status: error.status, reason: error.message });
      return refuse(error.message, error.status);
    }
    if (error instanceof z.ZodError) {
      log.warn("quick approve body rejected", { activity, recordId });
      return refuse("This notification did not say what to approve. Open the record instead.", 400);
    }
    log.error("quick approve failed", {
      activity,
      recordId,
      error: error instanceof Error ? error.message : String(error),
    });
    return refuse("Could not approve it. Open the record and try there.", 500);
  }
}
