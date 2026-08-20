export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { ledgerGapUpdateSchema } from "@/lib/validations";

const CLOSING_STATUSES = ["RESOLVED", "REJECTED"];

// PUT — update a claim.
//
// Closing one (RESOLVED / REJECTED) needs `approve`, not `edit`: writing off a ₹1.3L claim
// against a supplier is a financial decision, not a text edit.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("brand_ledger_gaps", "edit");
    const { id } = await params;
    const data = ledgerGapUpdateSchema.parse(await req.json());

    const existing = await prisma.ledgerGap.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) return errorResponse("Claim not found", 404);

    const isClosing =
      data.status && CLOSING_STATUSES.includes(data.status) && !CLOSING_STATUSES.includes(existing.status);

    if (isClosing && !(await userCan(user.id, "brand_ledger_gaps", "approve"))) {
      return errorResponse(
        "Closing a claim requires approve permission on Ledger Claims — writing off money owed is an approval, not an edit.",
        403
      );
    }

    const gap = await prisma.ledgerGap.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.gapType !== undefined ? { gapType: data.gapType } : {}),
        ...(data.tier !== undefined ? { tier: data.tier } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.amount !== undefined ? { amount: data.amount } : {}),
        ...(data.amountNote !== undefined ? { amountNote: data.amountNote || null } : {}),
        ...(data.promisedBy !== undefined ? { promisedBy: data.promisedBy || null } : {}),
        ...(data.promisedOn !== undefined ? { promisedOn: data.promisedOn ? new Date(data.promisedOn) : null } : {}),
        ...(data.evidenceText !== undefined ? { evidenceText: data.evidenceText || null } : {}),
        ...(data.action !== undefined ? { action: data.action || null } : {}),
        ...(data.result !== undefined ? { result: data.result || null } : {}),
        ...(isClosing ? { resolvedAt: new Date() } : {}),
      },
      include: { evidence: true },
    });

    return successResponse(gap);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 400);
  }
}

// DELETE — remove a claim outright.
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
      select: { id: true, title: true, _count: { select: { evidence: true, entries: true } } },
    });
    if (!gap) return errorResponse("Claim not found", 404);

    if (gap._count.evidence > 0 || gap._count.entries > 0) {
      return errorResponse(
        `"${gap.title}" has evidence or linked ledger rows attached. Set it to REJECTED with a reason instead — that keeps why it was dropped.`,
        409
      );
    }

    await prisma.ledgerGap.delete({ where: { id } });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 400);
  }
}
