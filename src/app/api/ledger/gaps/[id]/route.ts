export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { createLogger } from "@/lib/logger";
import { ledgerGapWriteUpdateSchema } from "@/lib/validations";
import { GAP_STATUS_FROM_VIEW, GAP_TYPE_FROM_VIEW } from "@/lib/brand-ledger/view-types";
import type { GapStatus, GapType } from "@prisma/client";

const log = createLogger("ledger:gaps");

const CLOSING_STATUSES: GapStatus[] = ["RESOLVED", "REJECTED"];

// PUT — update a claim: the ledger app's Edit form (Object.assign, App.jsx:416-417) and its
// "Set status" row (App.jsx:372-375), which appends "Marked resolved" when the new status is
// resolved. Both arrive here as a partial of the app's own vocabulary.
//
// Closing one (RESOLVED / REJECTED) needs `approve`, not `edit`: writing off a ₹1.3L claim
// against a supplier is a financial decision, not a text edit.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("brand_ledger_gaps", "edit");
    const { id } = await params;
    const data = ledgerGapWriteUpdateSchema.parse(await req.json());

    const existing = await prisma.ledgerGap.findUnique({
      where: { id },
      select: { id: true, vendorId: true, status: true },
    });
    if (!existing) return errorResponse("Claim not found", 404);

    const nextStatus = data.status ? (GAP_STATUS_FROM_VIEW[data.status] as GapStatus) : undefined;
    const isClosing =
      nextStatus !== undefined &&
      CLOSING_STATUSES.includes(nextStatus) &&
      !CLOSING_STATUSES.includes(existing.status);

    if (isClosing && !(await userCan(user.id, "brand_ledger_gaps", "approve"))) {
      log.warn("close without approve refused", { gapId: id, vendorId: existing.vendorId, to: nextStatus });
      return errorResponse(
        "Closing a claim requires approve permission on Ledger Claims — writing off money owed is an approval, not an edit.",
        403
      );
    }

    const becomesResolved = nextStatus === "RESOLVED" && existing.status !== "RESOLVED";

    const gap = await prisma.$transaction(async (tx) => {
      const updated = await tx.ledgerGap.update({
        where: { id },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.type !== undefined ? { gapType: GAP_TYPE_FROM_VIEW[data.type] as GapType } : {}),
          ...(nextStatus !== undefined ? { status: nextStatus } : {}),
          ...(data.amt !== undefined ? { amount: data.amt } : {}),
          ...(data.amtText !== undefined ? { amountNote: data.amtText || null } : {}),
          ...(data.evidence !== undefined ? { evidenceText: data.evidence || null } : {}),
          ...(data.action !== undefined ? { action: data.action || null } : {}),
          ...(isClosing ? { resolvedAt: new Date() } : {}),
        },
        select: { id: true, number: true, status: true },
      });
      if (becomesResolved) {
        await tx.ledgerGapNote.create({ data: { gapId: id, body: "Marked resolved", authorId: user.id } });
      }
      return updated;
    });

    log.info("claim updated", {
      vendorId: existing.vendorId,
      gapId: id,
      status: gap.status,
      closed: isClosing,
      fields: Object.keys(data),
    });
    return successResponse(gap);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "ledger:gaps", status: 400 });
  }
}

// DELETE — remove a claim outright (the ledger app's Delete, App.jsx:385-396, after a confirm).
//
// Deliberately narrow: a claim that turned out to be wrong should be REJECTED with a reason,
// which keeps the reasoning visible. Deletion is for genuine mistakes (a duplicate, a typo),
// so it is blocked once the claim carries evidence or linked ledger rows.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("brand_ledger_gaps", "delete");
    const { id } = await params;

    const gap = await prisma.ledgerGap.findUnique({
      where: { id },
      select: { id: true, vendorId: true, number: true, title: true, _count: { select: { evidence: true, entries: true } } },
    });
    if (!gap) return errorResponse("Claim not found", 404);

    if (gap._count.evidence > 0 || gap._count.entries > 0) {
      log.warn("delete of evidenced claim refused", { gapId: id, vendorId: gap.vendorId, evidence: gap._count.evidence, entries: gap._count.entries });
      return errorResponse(
        `"${gap.title}" has evidence or linked ledger rows attached. Set it to REJECTED with a reason instead — that keeps why it was dropped.`,
        409
      );
    }

    await prisma.ledgerGap.delete({ where: { id } });
    log.info("claim deleted", { vendorId: gap.vendorId, gapId: id, number: gap.number });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "ledger:gaps", status: 400 });
  }
}
