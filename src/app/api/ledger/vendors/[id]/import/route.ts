export const dynamic = "force-dynamic";
// A planned sheet is one AI call; a long text or a PDF can take most of a minute. 60 is what
// the other AI routes declare and what every Vercel plan allows.
export const maxDuration = 60;

import { NextRequest } from "next/server";
import type { LedgerUploadKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { toAiErrorResponse, aiErrorKind } from "@/lib/ai";
import { sanitizeUserPrompt } from "@/lib/brand-ledger/ai-prompts";
import { requireImportAccess } from "@/lib/brand-ledger/import-access";
import { importBodySchema, type ImportInput } from "@/lib/brand-ledger/prompted-import";
import { runPromptedImport } from "@/lib/brand-ledger/prompted-import-run";

const log = createLogger("ledger:import");

function uploadMeta(input: ImportInput): { kind: LedgerUploadKind; fileName: string; contentType: string; sizeBytes: number } {
  if (input.kind === "sheet") {
    return {
      kind: "STATEMENT",
      fileName: input.fileName,
      contentType: "application/json; sheet-cells",
      sizeBytes: JSON.stringify(input.sheets).length,
    };
  }
  if (input.kind === "text") {
    const chat = /\.(txt|zip)$/i.test(input.fileName ?? "") && /\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}/.test(input.text.slice(0, 2000));
    return {
      kind: chat ? "CHAT" : "DOCUMENT",
      fileName: input.fileName ?? "Typed text",
      contentType: "text/plain",
      sizeBytes: input.text.length,
    };
  }
  return {
    kind: input.mediaType === "application/pdf" ? "DOCUMENT" : "SCREENSHOT",
    fileName: input.fileName,
    contentType: input.mediaType,
    sizeBytes: Math.floor((input.base64.length * 3) / 4),
  };
}

// POST { prompt, input } — read what was sent, in memory, and propose. NOTHING IS STORED but the
// file's name and size (plan 1310 R6): no storage call anywhere on this path. The run's
// proposals go to the review page; only `runs/[id]/accept` writes the ledger (R5).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let step = "auth";
  let runId: string | null = null;
  try {
    const user = await requireImportAccess();
    const { id: vendorId } = await params;

    step = "parse";
    const parsed = importBodySchema.safeParse(
      await req.json().catch((e: unknown) => {
        log.warn("import body is not JSON", { vendorId, reason: e instanceof Error ? e.message : String(e) });
        return null;
      })
    );
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "Send the file and a prompt", 400);
    const { input } = parsed.data;

    const { prompt, refused } = sanitizeUserPrompt(parsed.data.prompt);
    if (refused) {
      log.warn("prompt refused", { vendorId, userId: user.id, length: parsed.data.prompt.length });
      return errorResponse(refused, 400);
    }
    if (!prompt) return errorResponse("Say what this is and what to do with it", 400);

    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
    if (!vendor) return errorResponse("Vendor not found", 404);

    step = "create";
    const meta = uploadMeta(input);
    const run = await prisma.$transaction(async (tx) => {
      const upload = await tx.ledgerUpload.create({
        // fileUrl stays null: the file is not kept (R6). The row is the provenance of the run.
        data: { vendorId, ...meta, fileUrl: null, uploadedById: user.id },
        select: { id: true },
      });
      return tx.ledgerAiRun.create({
        data: { uploadId: upload.id, vendorId, task: "PROMPTED_IMPORT", userPrompt: prompt, createdById: user.id },
        select: { id: true, uploadId: true },
      });
    });
    runId = run.id;
    log.info("import created", { runId, uploadId: run.uploadId, vendorId, inputKind: input.kind, size: meta.sizeBytes, promptLength: prompt.length, userId: user.id });

    step = "execute";
    await runPromptedImport(run.id, input);

    return successResponse({ id: run.id, uploadId: run.uploadId }, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const ai = toAiErrorResponse(error);
    if (ai) {
      log.warn("import ended in an AI error", { runId, kind: aiErrorKind(error) });
      return ai;
    }
    return failure(error, { scope: "ledger:import", step, runId });
  }
}
