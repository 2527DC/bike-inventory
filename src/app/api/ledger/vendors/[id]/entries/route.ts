export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { ledgerEntrySchema } from "@/lib/validations";
import { directionForType, sideForType, parseLedgerDate } from "@/lib/brand-ledger/reconcile";

// POST — add a single ledger row by hand.
//
// Two legitimate uses: transcribing a row off a statement that wasn't imported, and the
// MANUAL escape hatch — a real payment that Accounts hasn't recorded yet, so an incomplete
// Accounts module never blocks the reconciliation.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("brand_ledger", "create");
    const { id } = await params;
    const data = ledgerEntrySchema.parse(await req.json());

    const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true } });
    if (!vendor) return errorResponse("Vendor not found", 404);

    const entryDate = parseLedgerDate(data.entryDate);
    if (!entryDate) return errorResponse(`Could not read the date "${data.entryDate}"`, 400);

    const entry = await prisma.brandLedgerEntry.create({
      data: {
        vendorId: id,
        brandId: data.brandId || null,
        entryDate,
        type: data.type,
        ref: data.ref || null,
        amount: data.amount,
        // Caller may override the sign: brands do occasionally post a credit on a sales
        // voucher, where the label and the direction disagree.
        direction: data.direction ?? directionForType(data.type),
        side: sideForType(data.type),
        note: data.note || null,
        source: data.source ?? "MANUAL",
      },
    });

    return successResponse(entry, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 400);
  }
}

// DELETE — remove a hand-entered row. Imported rows are left alone: they are a record of what
// the brand sent, and deleting one would quietly rewrite that history.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("brand_ledger", "delete");
    await params;

    const entryId = new URL(req.url).searchParams.get("entryId");
    if (!entryId) return errorResponse("entryId is required", 400);

    const entry = await prisma.brandLedgerEntry.findUnique({
      where: { id: entryId },
      select: { id: true, source: true, statementId: true },
    });
    if (!entry) return errorResponse("Entry not found", 404);

    if (entry.statementId || entry.source !== "MANUAL") {
      return errorResponse(
        "This row came from an imported statement and cannot be deleted. Mark it IGNORED instead — the brand's record stays intact.",
        400
      );
    }

    await prisma.brandLedgerEntry.delete({ where: { id: entryId } });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 400);
  }
}
