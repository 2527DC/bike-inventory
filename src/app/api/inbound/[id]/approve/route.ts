export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { approveInbound } from "@/lib/approvals/actions/inbound";
import { createLogger } from "@/lib/logger";

const log = createLogger("inbound:approve");

/**
 * POST: approve an inbound shipment — the gate that makes it receivable.
 *
 * The decision itself lives in `src/lib/approvals/actions/inbound.ts` (plan 1709, P17), because
 * the Requests page and Wave 3's push-notification Approve button do the same act with no
 * screen behind them, and one approval rule with three implementations is how they drift.
 *
 * NEW in R25: a shipment that was sent back for correction cannot be approved over the
 * creator's head — `approveInbound` refuses while `rejectedAt` is set, and the creator's
 * resubmit is what clears it.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireFeature("inbound", "approve");
    const { id } = await params;

    const result = await approveInbound({ id: user.id, name: user.name }, id);
    if (!result.ok) {
      log.warn("shipment approval refused", { shipmentId: id, status: result.httpStatus });
      return errorResponse(result.error, result.httpStatus);
    }

    return successResponse({
      message: result.message,
      shipmentNo: result.recordRef,
      status: result.newStatus,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Approval failed";
    log.error("approval failed", { message });
    return errorResponse(message, 400);
  }
}
