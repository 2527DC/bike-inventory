export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { rejectInbound } from "@/lib/approvals/actions/inbound";
import { createLogger } from "@/lib/logger";

const log = createLogger("inbound:reject");

const schema = z.object({
  rejectionNote: z.string().max(1000).optional(),
});

/**
 * POST: send an inbound shipment back to whoever raised it (R25, Q17).
 *
 * ─── THIS IS NEW. THERE WAS NO WAY TO SAY NO ──────────────────────────────────────────────
 *
 * Until now a shipment could only be approved. A bill with the wrong quantities, the wrong
 * brand or an unreadable photo simply sat unapproved: nobody was told, no note said what was
 * wrong, and the person who raised it had no way to learn that anything was. The record went
 * back to being a mystery every time somebody opened the list.
 *
 * Reject does NOT delete anything and does not create a second shipment. It stamps
 * `rejectedAt` / `rejectedById` / `rejectionNote`, the creator gets a push with the note, they
 * fix the SAME shipment and press Resubmit.
 *
 * Refused once the shipment is approved: at that point the stock is receivable and may already
 * be in the building, so "please fix this" is the wrong sentence. DELETE is the way back, and
 * it reverses the stock.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireFeature("inbound", "approve");
    const body = await req.json().catch(() => ({}));
    const { rejectionNote } = schema.parse(body ?? {});

    const result = await rejectInbound({ id: user.id, name: user.name }, id, rejectionNote);
    if (!result.ok) {
      log.warn("shipment return refused", { shipmentId: id, status: result.httpStatus });
      return errorResponse(result.error, result.httpStatus);
    }

    return successResponse({
      message: result.message,
      shipmentNo: result.recordRef,
      status: result.newStatus,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message ?? "Invalid request", 400);
    }
    const message = error instanceof Error ? error.message : "Could not send this shipment back";
    log.error("shipment return failed", { shipmentId: id, message });
    return errorResponse(message, 400);
  }
}
