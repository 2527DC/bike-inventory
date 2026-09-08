export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("stock-counts:zero");

/**
 * Record 0 — "none found" — for every line of this audit that has not been counted (R4,
 * 0809-brand-category-inactive-and-audit-approval-plan §3 B1).
 *
 * This is the bulk zero that used to live inside the COMPLETED transition during the 2026
 * baseline period, resurrected as a named action the counter presses on purpose. It is the
 * one place this screen lets a person record a number they did not physically count, so:
 *
 *   - it is the ASSIGNEE's action, on an IN_PROGRESS audit, and nothing else;
 *   - `expected` is the uncounted count the screen showed when the button was pressed. If
 *     the live count differs — an auto-save landed, another tab moved on — the request is
 *     refused with both numbers rather than zeroing lines the person never saw;
 *   - it is written to the activity log under the person's name, so "who zeroed 300 lines"
 *     is a question the feed can answer.
 *
 * Idempotent by construction: a second press finds nothing uncounted and returns
 * `{ zeroed: 0 }` without writing or logging anything.
 */

const bodySchema = z.object({
  /** The uncounted count shown on screen when the person confirmed. */
  expected: z.number().int().min(0),
});

/** Thrown inside the transaction so the mismatch can surface as a 409, not a 500. */
class UncountedChanged extends Error {
  constructor(public readonly live: number, public readonly expected: number) {
    super(`The uncounted list changed (now ${live}, you were shown ${expected}). Reload and try again.`);
    this.name = "UncountedChanged";
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("stock_audit", "edit");
    const { id } = await params;

    const sc = await prisma.stockCount.findUnique({
      where: { id },
      select: { assignedToId: true, status: true, countNo: true, title: true },
    });
    if (!sc) return errorResponse("Stock count not found", 404);

    // Same rule as saving a single line (items/route.ts): counting belongs to the assignee.
    if (sc.assignedToId !== user.id) {
      return errorResponse(
        "Only the person this audit is assigned to can start, count or complete it",
        403
      );
    }
    if (sc.status !== "IN_PROGRESS") {
      log.warn("zero uncounted refused by status", { stockCountId: id, status: sc.status, userId: user.id });
      return errorResponse(
        `This audit is ${sc.status.toLowerCase().replace(/_/g, " ")}; counts can only be recorded while it is in progress`,
        409
      );
    }

    const raw = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse("expected — the number of uncounted lines shown on screen — is required", 400);
    }
    const { expected } = parsed.data;

    const zeroed = await prisma.$transaction(async (tx) => {
      const live = await tx.stockCountItem.count({ where: { stockCountId: id, countedQty: null } });
      if (live !== expected) throw new UncountedChanged(live, expected);
      if (live === 0) return 0;

      const now = new Date();
      const { count } = await tx.stockCountItem.updateMany({
        where: { stockCountId: id, countedQty: null },
        data: { countedQty: 0, countedAt: now },
      });
      // variance = counted − system, per line. `updateMany` cannot reference another column,
      // so the one statement that can. Scoped to the rows this call just zeroed: variance is
      // still NULL on exactly those.
      await tx.$executeRaw`
        UPDATE "StockCountItem"
        SET variance = 0 - "systemQty"
        WHERE "stockCountId" = ${id} AND "countedQty" = 0 AND variance IS NULL
      `;

      // Inside the transaction on purpose: a bulk zero that fails to record itself fails.
      await logActivity(tx, {
        module: "stock_audit",
        action: "zeroed_uncounted",
        entityType: "StockCount",
        entityId: id,
        entityRef: sc.countNo ?? sc.title,
        details: `${count} line${count === 1 ? "" : "s"} recorded as 0`,
        userId: user.id,
        userName: user.name,
      });
      return count;
    });

    log.info("uncounted zeroed", { stockCountId: id, zeroed, userId: user.id });
    return successResponse({ zeroed });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof UncountedChanged) {
      log.warn("zero uncounted refused — count changed", { live: error.live, expected: error.expected });
      return errorResponse(error.message, 409);
    }
    log.error("zero uncounted failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to record zeros", 500);
  }
}
