export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getApprovalRules, type ApprovalRules } from "@/lib/settings/approval-rules";
import { createLogger } from "@/lib/logger";
import type { ApprovalActivity } from "@prisma/client";

const log = createLogger("approvals:error-rate");

/**
 * GET: the approver-error rate, per approver (plan 1709-priority-build-and-stock-flow, R26, Q18).
 *
 * ─── WHAT AN "ERROR" IS ───────────────────────────────────────────────────────────────────
 *
 * The rule is a SETTING (`src/lib/settings/approval-rules.ts`), so this route computes rather
 * than reads a stored number. Three kinds of event count against the person who approved:
 *
 *   CORRECTED       a stock audit moved a product this approver had approved into stock,
 *                   within `windowDays` of that approval
 *   SHORT_RECEIVED  a transfer they approved arrived short
 *   REVERSED        an approval of theirs was undone (a cancelled approved transfer, a deleted
 *                   approved shipment)
 *
 * FLAGGED (a customer complaint) is recorded but NOT counted unless `countFlag` is switched on —
 * the owner's Q18 answer: a customer flag is about the goods, not about the approval.
 *
 * ─── HOW A CORRECTION IS MATCHED TO AN APPROVAL, AND WHY THIS WAY ─────────────────────────
 *
 * A CORRECTED event knows its product, sometimes its warehouse, and when. An APPROVED event
 * knows its record — a shipment or a transfer — and nothing about products, because at approval
 * time nobody has said which shelf anything is going on. So the two are joined THROUGH THE
 * APPROVED RECORD'S LINES:
 *
 *   INBOUND   `InboundLineItem.productId` of that shipment. Matched on PRODUCT ONLY: an inbound
 *             shipment has no warehouse column at all — the receiving clerk picks the warehouse
 *             later, per line — so there is no place on the record to compare against.
 *   TRANSFER  `TransferOrderItem.productId`, and the order's `toWarehouseId` must equal the
 *             correction's warehouse when the correction recorded one. A transfer DOES know
 *             where it was going, so a correction in a different building is somebody else's
 *             mistake.
 *
 * The LATEST qualifying approval wins, one error per correction — two approvals of the same
 * product inside the window are not both blamed for one miscount. A correction that matches
 * nothing is not an error at all: it counts nobody and is reported as `unmatchedCorrections`,
 * which is the honest answer for stock that drifted without an approval behind it.
 *
 * Matching happens HERE and not at write time on purpose: `windowDays` is a setting, and an
 * owner who changes 7 days to 1 expects the table to be recomputed, not to apply only to
 * corrections made from now on.
 *
 * ─── SCALE ────────────────────────────────────────────────────────────────────────────────
 *
 * Everything is read inside `?days=` (default 90, max 365) and matched in memory. The window is
 * a few thousand events at this shop's volume; the `[approverId, event, createdAt]` and
 * `[productId, warehouseId, createdAt]` indexes serve both reads. If the event table ever
 * outgrows that, this becomes a SQL join, not a bigger loop.
 */

const MAX_DAYS = 365;
const DEFAULT_DAYS = 90;

interface ApproverRow {
  approverId: string;
  approverName: string;
  approvals: number;
  errors: { corrections: number; shortReceives: number; reversals: number; flags: number };
  totalErrors: number;
  /** errors ÷ approvals, 0–1. Null when they have approved nothing in the window. */
  rate: number | null;
}

export async function GET(req: NextRequest) {
  try {
    await requireFeature("reports", "view");

    const { searchParams } = new URL(req.url);
    const parsedDays = Number(searchParams.get("days"));
    const days =
      Number.isFinite(parsedDays) && parsedDays >= 1 ? Math.min(Math.trunc(parsedDays), MAX_DAYS) : DEFAULT_DAYS;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rules: ApprovalRules = await getApprovalRules();
    // Corrections are matched against approvals that may be up to `windowDays` OLDER than the
    // reporting window — otherwise a correction on day one of the window could never find the
    // approval it judges, and the first week of every report would read as clean.
    const approvalsSince = new Date(since.getTime() - rules.windowDays * 24 * 60 * 60 * 1000);

    const [approvals, outcomes] = await Promise.all([
      prisma.approvalEvent.findMany({
        where: { event: "APPROVED", createdAt: { gte: approvalsSince } },
        select: {
          id: true,
          activity: true,
          recordId: true,
          approverId: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.approvalEvent.findMany({
        where: {
          event: { in: ["CORRECTED", "SHORT_RECEIVED", "REVERSED", "FLAGGED"] },
          createdAt: { gte: since },
        },
        select: {
          id: true,
          event: true,
          activity: true,
          approverId: true,
          productId: true,
          warehouseId: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // ── The lines of every approved record, so a correction can be traced to one ──────────
    const inboundIds = approvals.filter((a) => a.activity === "INBOUND").map((a) => a.recordId);
    const transferIds = approvals.filter((a) => a.activity === "TRANSFER").map((a) => a.recordId);

    const [inboundLines, transferLines] = await Promise.all([
      inboundIds.length
        ? prisma.inboundLineItem.findMany({
            where: { shipmentId: { in: [...new Set(inboundIds)] }, productId: { not: null } },
            select: { shipmentId: true, productId: true },
          })
        : Promise.resolve([]),
      transferIds.length
        ? prisma.transferOrderItem.findMany({
            where: { transferOrderId: { in: [...new Set(transferIds)] } },
            select: { transferOrderId: true, productId: true, transferOrder: { select: { toWarehouseId: true } } },
          })
        : Promise.resolve([]),
    ]);

    /** recordId -> the products it covered, and where it was going (transfers only). */
    const recordProducts = new Map<string, Set<string>>();
    const recordWarehouse = new Map<string, string | null>();
    for (const line of inboundLines) {
      if (!line.productId) continue;
      const set = recordProducts.get(line.shipmentId) ?? new Set<string>();
      set.add(line.productId);
      recordProducts.set(line.shipmentId, set);
    }
    for (const line of transferLines) {
      const set = recordProducts.get(line.transferOrderId) ?? new Set<string>();
      set.add(line.productId);
      recordProducts.set(line.transferOrderId, set);
      recordWarehouse.set(line.transferOrderId, line.transferOrder.toWarehouseId);
    }

    // Approvals newest first (the query already ordered them), so the first hit IS the latest.
    const approvalsWithApprover = approvals.filter(
      (a): a is typeof a & { approverId: string } => a.approverId !== null
    );

    function matchCorrection(correction: {
      productId: string | null;
      warehouseId: string | null;
      createdAt: Date;
    }): string | null {
      if (!correction.productId) return null;
      const windowStart = new Date(
        correction.createdAt.getTime() - rules.windowDays * 24 * 60 * 60 * 1000
      );
      for (const approval of approvalsWithApprover) {
        if (approval.createdAt > correction.createdAt) continue;
        if (approval.createdAt < windowStart) break; // ordered desc: everything after is older
        if (approval.activity !== "INBOUND" && approval.activity !== "TRANSFER") continue;
        if (!recordProducts.get(approval.recordId)?.has(correction.productId)) continue;
        // A transfer knows its destination; an inbound shipment does not (see the header).
        if (approval.activity === "TRANSFER" && correction.warehouseId) {
          const dest = recordWarehouse.get(approval.recordId) ?? null;
          if (dest && dest !== correction.warehouseId) continue;
        }
        return approval.approverId;
      }
      return null;
    }

    const rows = new Map<string, ApproverRow>();
    const blank = (approverId: string): ApproverRow => ({
      approverId,
      approverName: "",
      approvals: 0,
      errors: { corrections: 0, shortReceives: 0, reversals: 0, flags: 0 },
      totalErrors: 0,
      rate: null,
    });
    const rowFor = (approverId: string) => {
      const existing = rows.get(approverId);
      if (existing) return existing;
      const fresh = blank(approverId);
      rows.set(approverId, fresh);
      return fresh;
    };

    // The denominator: approvals made INSIDE the reporting window only. The older ones were read
    // solely so corrections could find them.
    for (const approval of approvalsWithApprover) {
      if (approval.createdAt < since) continue;
      rowFor(approval.approverId).approvals += 1;
    }

    let unmatchedCorrections = 0;
    const byActivity = new Map<ApprovalActivity, number>();

    for (const outcome of outcomes) {
      let approverId = outcome.approverId;
      if (outcome.event === "CORRECTED") {
        if (!rules.countCorrection) continue;
        // A correction never carries its approver — it is resolved here (see the header).
        approverId = matchCorrection(outcome);
        if (!approverId) {
          unmatchedCorrections += 1;
          continue;
        }
        rowFor(approverId).errors.corrections += 1;
      } else if (outcome.event === "SHORT_RECEIVED") {
        if (!rules.countShortReceive || !approverId) continue;
        rowFor(approverId).errors.shortReceives += 1;
      } else if (outcome.event === "REVERSED") {
        if (!rules.countReversal || !approverId) continue;
        rowFor(approverId).errors.reversals += 1;
      } else {
        if (!rules.countFlag || !approverId) continue;
        rowFor(approverId).errors.flags += 1;
      }
      byActivity.set(outcome.activity, (byActivity.get(outcome.activity) ?? 0) + 1);
    }

    const names = new Map(
      (
        await prisma.user.findMany({
          where: { id: { in: [...rows.keys()] } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name])
    );

    const table = [...rows.values()]
      .map((row) => {
        const totalErrors =
          row.errors.corrections + row.errors.shortReceives + row.errors.reversals + row.errors.flags;
        return {
          ...row,
          approverName: names.get(row.approverId) ?? "Removed user",
          totalErrors,
          rate: row.approvals > 0 ? totalErrors / row.approvals : null,
        };
      })
      // Worst rate first — the table exists to find a pattern, not to list everybody.
      .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.totalErrors - a.totalErrors);

    log.info("approver error rate computed", {
      days,
      windowDays: rules.windowDays,
      approvers: table.length,
      outcomes: outcomes.length,
      unmatchedCorrections,
    });

    return successResponse({
      days,
      since: since.toISOString(),
      rules,
      approvers: table,
      unmatchedCorrections,
      errorsByActivity: Object.fromEntries(byActivity),
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to compute the approver error rate";
    log.error("error rate failed", { message });
    return errorResponse(message, 500);
  }
}
