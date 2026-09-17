import type { ApprovalActivity, ApprovalEventType, Prisma } from "@prisma/client";
import { createLogger } from "@/lib/logger";

const log = createLogger("approvals:events");

/**
 * The approval event writer (plan 1709-priority-build-and-stock-flow, R26).
 *
 * One `ApprovalEvent` row per approval fact on the four controlled activities — inbound,
 * outbound, transfer, stock audit. It is what the approver-error rate counts, so it is
 * EVIDENCE, and it is written only inside the transaction that makes the change: if the event
 * cannot be recorded, the approval (or correction, or short receive) does not happen either.
 * That is why this takes `tx` and throws, unlike `logActivity(prisma, …)`, which is best effort.
 *
 * ActivityLog stays the human-readable trail. Write both when a screen needs both.
 */

export interface ApprovalEventInput {
  activity: ApprovalActivity;
  event: ApprovalEventType;
  /** InboundShipment / Delivery / TransferOrder / StockCount id, per `activity`. */
  recordId: string;
  /** The human reference shown in lists: IB-202609-0001, TRF-202609-0007, an invoice no. */
  recordRef?: string | null;
  /** Who did this event (from the session). */
  actorId: string;
  /**
   * The approval this outcome judges. On CORRECTED / SHORT_RECEIVED / REVERSED / FLAGGED this is
   * the user who APPROVED the record — not the actor — so the error counts against them. On
   * APPROVED it is the actor. Null where no approval exists yet (REQUESTED, a pre-approval REJECTED).
   */
  approverId?: string | null;
  productId?: string | null;
  warehouseId?: string | null;
  quantity?: number | null;
  note?: string | null;
}

/**
 * Record one approval event. Call inside `prisma.$transaction(async (tx) => …)`.
 * Throws on failure, after logging, so the caller's change rolls back with it.
 */
export async function recordApprovalEvent(
  tx: Prisma.TransactionClient,
  input: ApprovalEventInput,
): Promise<{ id: string }> {
  try {
    const row = await tx.approvalEvent.create({
      data: {
        activity: input.activity,
        event: input.event,
        recordId: input.recordId,
        recordRef: input.recordRef ?? null,
        actorId: input.actorId,
        approverId: input.approverId ?? null,
        productId: input.productId ?? null,
        warehouseId: input.warehouseId ?? null,
        quantity: input.quantity ?? null,
        note: input.note ?? null,
      },
      select: { id: true },
    });
    // Identifiers only — `note` is free text and stays out of the log line.
    log.debug("approval event recorded", {
      eventId: row.id,
      activity: input.activity,
      event: input.event,
      recordId: input.recordId,
      actorId: input.actorId,
      approverId: input.approverId ?? null,
    });
    return row;
  } catch (error) {
    log.error("approval event write failed", {
      activity: input.activity,
      event: input.event,
      recordId: input.recordId,
      recordRef: input.recordRef ?? null,
      actorId: input.actorId,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
