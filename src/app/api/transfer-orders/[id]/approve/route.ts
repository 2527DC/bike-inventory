export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { z } from "zod";
import { approveTransfer, returnTransfer } from "@/lib/approvals/actions/transfer";
import { createLogger } from "@/lib/logger";

const log = createLogger("transfer-orders:approve");

const schema = z.object({
  action: z.enum(["approve", "reject"]),
  rejectionNote: z.string().max(1000).optional(),
});

/**
 * POST: approve a pending transfer, or send it back to the person who raised it.
 *
 * ─── THE ROUTE IS NOW A TRANSLATOR, NOT THE RULE ──────────────────────────────────────────
 *
 * Everything this used to do — the grant, the state machine, the source stock re-check, the
 * claim, the activity log — moved to `src/lib/approvals/actions/transfer.ts` (plan 1709, P17).
 * It had to: the Requests page (`/approvals`) and Wave 3's push-notification Approve button
 * perform the same act with no screen and no request body behind them, and three copies of an
 * approval rule is how the purchase-order module ended up with three disagreeing opinions
 * about who could do what. This file parses the body and turns the answer into a status code.
 *
 * ─── APPROVAL NO LONGER MOVES STOCK. THAT IS STILL THE HEART OF P14 ───────────────────────
 *
 * Approval agrees to the movement. Dispatch takes the stock out; receipt puts it in. MIG-2
 * rewrote the legacy APPROVED rows to RECEIVED precisely because they mean the OLD thing
 * ("everything has moved") and this route produces the new one ("nothing has moved yet").
 *
 * ─── "REJECT" WRITES RETURNED (R25, Q36) ──────────────────────────────────────────────────
 *
 * The action name in the body is unchanged so an older client keeps working, but the record
 * now goes to RETURNED with the note: the creator fixes THIS order and resubmits it. REJECTED
 * is still in the enum for rows written before R25 and is no longer produced by anything.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("transfers", "approve");
    const { id } = await params;
    const body = await req.json();
    const { action, rejectionNote } = schema.parse(body);

    const actor = { id: user.id, name: user.name };
    const result =
      action === "approve"
        ? await approveTransfer(actor, id)
        : await returnTransfer(actor, id, rejectionNote);

    if (!result.ok) {
      log.warn("transfer review refused", { orderId: id, action, status: result.httpStatus });
      return errorResponse(result.error, result.httpStatus);
    }

    return successResponse({
      message: result.message,
      status: result.newStatus,
      orderNo: result.recordRef,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message ?? "Invalid request", 400);
    }
    const message = error instanceof Error ? error.message : "Failed to process transfer order";
    log.error("transfer approve failed", { message });
    return errorResponse(message, 400);
  }
}
