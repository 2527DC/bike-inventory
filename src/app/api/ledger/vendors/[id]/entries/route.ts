export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { ledgerEntryWriteSchema } from "@/lib/validations";
import { parseLedgerDate } from "@/lib/brand-ledger/reconcile";
import { ENTRY_TYPE_FROM_VIEW, type LedgerViewEntryType } from "@/lib/brand-ledger/view-types";
import type { LedgerEntryType, LedgerSide } from "@prisma/client";

const log = createLogger("ledger:entries");

/** The ledger app's own rules (store.js:109-117): what a type does to the balance, and whose side it sits on. */
function directionForView(type: LedgerViewEntryType): number {
  if (type === "invoice" || type === "debit-note") return 1;
  if (type === "note") return 0;
  return -1;
}
function sideForView(type: LedgerViewEntryType): LedgerSide {
  return type === "payment" || type === "debit-note" ? "BCH" : "VENDOR";
}

// POST — add a single ledger row by hand (the ledger app's "+ Add entry", App.jsx:676-686).
//
// Always `source: MANUAL`: it is the escape hatch for a real payment Accounts has not recorded
// yet, and MANUAL is also what lets the × delete it later — an imported row is never deleted,
// only marked IGNORED (D3).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("brand_ledger", "create");
    const { id } = await params;
    const data = ledgerEntryWriteSchema.parse(await req.json());

    const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true } });
    if (!vendor) return errorResponse("Vendor not found", 404);

    const entryDate = parseLedgerDate(data.date);
    if (!entryDate) return errorResponse(`Could not read the date "${data.date}"`, 400);

    const type = ENTRY_TYPE_FROM_VIEW[data.type] as LedgerEntryType;
    const entry = await prisma.brandLedgerEntry.create({
      data: {
        vendorId: id,
        entryDate,
        type,
        ref: data.ref || null,
        // A note carries no money; the balance loop multiplies by direction 0 either way.
        amount: data.type === "note" ? (data.amount ?? 0) : (data.amount as number),
        direction: directionForView(data.type),
        side: sideForView(data.type),
        note: data.note || null,
        source: "MANUAL",
      },
      select: { id: true, entryDate: true, type: true, amount: true, direction: true },
    });

    log.info("entry added", { vendorId: id, entryId: entry.id, type: entry.type });
    return successResponse(entry, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "ledger:entries", status: 400 });
  }
}

// DELETE — remove a hand-entered row. Imported rows are left alone: they are a record of what
// the brand sent, and deleting one would quietly rewrite that history. The screen sends those
// to the review endpoint as IGNORED instead.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("brand_ledger", "delete");
    const { id } = await params;

    const entryId = new URL(req.url).searchParams.get("entryId");
    if (!entryId) return errorResponse("entryId is required", 400);

    const entry = await prisma.brandLedgerEntry.findUnique({
      where: { id: entryId },
      select: { id: true, vendorId: true, source: true, statementId: true },
    });
    if (!entry) return errorResponse("Entry not found", 404);
    if (entry.vendorId !== id) return errorResponse("That entry belongs to a different vendor", 400);

    if (entry.statementId || entry.source !== "MANUAL") {
      log.warn("delete of imported row refused", { vendorId: id, entryId, source: entry.source });
      return errorResponse(
        "This row came from an imported statement and cannot be deleted. Mark it IGNORED instead — the brand's record stays intact.",
        400
      );
    }

    await prisma.brandLedgerEntry.delete({ where: { id: entryId } });
    log.info("entry deleted", { vendorId: id, entryId });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "ledger:entries", status: 400 });
  }
}
