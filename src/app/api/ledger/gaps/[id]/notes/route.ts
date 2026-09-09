export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { ledgerNoteWriteSchema } from "@/lib/validations";
import { isoDay } from "@/lib/brand-ledger/view-types";

const log = createLogger("ledger:gaps");

// POST — a progress note on a claim (the ledger app's "Add progress note…", App.jsx:381).
// `LedgerGapNote` had no writer before this; the register rendered history it could not add to.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("brand_ledger_gaps", "edit");
    const { id } = await params;
    const data = ledgerNoteWriteSchema.parse(await req.json());

    const gap = await prisma.ledgerGap.findUnique({ where: { id }, select: { id: true, vendorId: true } });
    if (!gap) return errorResponse("Claim not found", 404);

    const note = await prisma.ledgerGapNote.create({
      data: { gapId: id, body: data.text, authorId: user.id },
      select: { id: true, body: true, createdAt: true },
    });

    log.info("note added", { gapId: id, vendorId: gap.vendorId, noteId: note.id });
    return successResponse({ id: note.id, date: isoDay(note.createdAt), text: note.body }, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "ledger:gaps", status: 400 });
  }
}
