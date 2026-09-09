export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { StorageNotConfiguredError } from "@/lib/storage";
import { checkEvidenceFile, contentTypeFor, fileExtension, storeEvidenceFile } from "@/lib/brand-ledger/uploads";
import { parseLedgerDate } from "@/lib/brand-ledger/reconcile";

const log = createLogger("ledger:evidence");

function text(v: FormDataEntryValue | null, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

// POST — multipart `file` + optional `date` (free text, the ledger app's "2024-08 orders"),
// `source`, `note`. Attaches a screenshot or PDF to a claim; this is what turns a FIRM tier
// from an assertion into something that can be shown.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let step = "parse";
  try {
    const user = await requireFeature("brand_ledger_gaps", "edit");
    const { id } = await params;

    const gap = await prisma.ledgerGap.findUnique({ where: { id }, select: { id: true, vendorId: true, number: true } });
    if (!gap) return errorResponse("Claim not found", 404);

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return errorResponse("No file uploaded", 400);
    const refusal = checkEvidenceFile(file.name, file.size);
    if (refusal) return errorResponse(refusal, 400);

    const dateText = text(form.get("date"), 60);
    const source = text(form.get("source"), 200);
    const note = text(form.get("note"), 1000);

    step = "store";
    const bytes = await file.arrayBuffer();
    const url = await storeEvidenceFile(gap.vendorId, file.name, contentTypeFor(file.name), bytes);

    step = "insert";
    const capturedOn = dateText ? parseLedgerDate(dateText) : null;
    const evidence = await prisma.ledgerGapEvidence.create({
      data: {
        gapId: gap.id,
        url,
        kind: fileExtension(file.name) === "pdf" ? "PDF" : "SCREENSHOT",
        capturedOn: capturedOn ?? null,
        capturedLabel: dateText,
        source,
        note,
        uploadedById: user.id,
      },
    });
    log.info("evidence attached", { evidenceId: evidence.id, gapId: gap.id, vendorId: gap.vendorId, number: gap.number, bytes: bytes.byteLength });
    return successResponse(evidence, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof StorageNotConfiguredError) return errorResponse(error.message, 501);
    return failure(error, { scope: "ledger:evidence", step });
  }
}
