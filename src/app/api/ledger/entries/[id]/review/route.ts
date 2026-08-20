export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { ledgerEntryReviewSchema } from "@/lib/validations";

// PUT — a human classifies an unmatched row.
//
// This is safeguard 1 from the merge plan made concrete. The matcher can say "no match found";
// only a person can say WHY. THEY_MISSING ("we paid, they haven't posted it") is a claim
// against the brand; WE_MISSING ("it's on their statement, not in our books") is a gap in our
// own record-keeping. Guessing between them would either accuse a supplier wrongly or hide a
// bookkeeping hole, so the system refuses to guess.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("brand_ledger", "edit");
    const { id } = await params;
    const data = ledgerEntryReviewSchema.parse(await req.json());

    const entry = await prisma.brandLedgerEntry.findUnique({
      where: { id },
      select: { id: true, vendorId: true },
    });
    if (!entry) return errorResponse("Entry not found", 404);

    // Verify any link target belongs to the SAME vendor. Without this a mis-typed id could
    // attach one supplier's payment to another's statement row and silently corrupt both.
    for (const [field, table] of [
      ["billId", "vendorBill"],
      ["paymentId", "vendorPayment"],
      ["creditId", "vendorCredit"],
    ] as const) {
      const value = data[field];
      if (!value) continue;
      const rec = await (prisma[table] as { findUnique: (a: unknown) => Promise<{ vendorId: string } | null> })
        .findUnique({ where: { id: value }, select: { vendorId: true } });
      if (!rec) return errorResponse(`Linked ${field} not found`, 400);
      if (rec.vendorId !== entry.vendorId) {
        return errorResponse(`That ${field} belongs to a different vendor`, 400);
      }
    }

    if (data.gapId) {
      const gap = await prisma.ledgerGap.findUnique({
        where: { id: data.gapId },
        select: { vendorId: true },
      });
      if (!gap) return errorResponse("Linked claim not found", 400);
      if (gap.vendorId !== entry.vendorId) {
        return errorResponse("That claim belongs to a different vendor", 400);
      }
    }

    const updated = await prisma.brandLedgerEntry.update({
      where: { id },
      data: {
        matchStatus: data.matchStatus,
        reviewNote: data.reviewNote ?? null,
        reviewedAt: new Date(),
        ...(data.billId !== undefined ? { billId: data.billId } : {}),
        ...(data.paymentId !== undefined ? { paymentId: data.paymentId } : {}),
        ...(data.creditId !== undefined ? { creditId: data.creditId } : {}),
        ...(data.gapId !== undefined ? { gapId: data.gapId } : {}),
      },
    });

    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 400);
  }
}
