export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { toAiErrorResponse, aiErrorKind } from "@/lib/ai";
import { sanitizeUserPrompt } from "@/lib/brand-ledger/ai-prompts";
import { requireImportAccess } from "@/lib/brand-ledger/import-access";
import { importInputSchema, IMPORT_PROMPT_MAX_CHARS } from "@/lib/brand-ledger/prompted-import";
import { runPromptedImport } from "@/lib/brand-ledger/prompted-import-run";

const log = createLogger("ledger:import");

const bodySchema = z.object({
  prompt: z.string().trim().min(1, "Say what to do differently").max(IMPORT_PROMPT_MAX_CHARS),
});

// POST { prompt } — "re-run with a new prompt" (plan 1310 §1.1). Reads the cells or text the
// first run kept on `source`; no upload, and the file was never stored (R6). The earlier run
// stays listed beside the new one.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let step = "auth";
  let newRunId: string | null = null;
  try {
    const user = await requireImportAccess();
    const { id } = await params;

    step = "parse";
    const parsed = bodySchema.safeParse(
      await req.json().catch((e: unknown) => {
        log.warn("rerun body is not JSON", { runId: id, reason: e instanceof Error ? e.message : String(e) });
        return null;
      })
    );
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "Send a prompt", 400);
    const { prompt, refused } = sanitizeUserPrompt(parsed.data.prompt);
    if (refused) {
      log.warn("prompt refused", { runId: id, userId: user.id, length: parsed.data.prompt.length });
      return errorResponse(refused, 400);
    }
    if (!prompt) return errorResponse("Say what to do differently", 400);

    step = "load";
    const run = await prisma.ledgerAiRun.findUnique({
      where: { id },
      select: { id: true, task: true, status: true, vendorId: true, uploadId: true, source: true },
    });
    if (!run) return errorResponse("Run not found", 404);
    if (run.task !== "PROMPTED_IMPORT") return errorResponse("Only an import made with a prompt can be re-run this way", 409);
    if (run.status === "ACCEPTED") return errorResponse("This run was accepted; its rows are in the ledger", 409);
    const source = importInputSchema.safeParse(run.source);
    if (!source.success || source.data.kind === "attachment") {
      return errorResponse("Nothing was kept from this run to re-read. Upload the file again.", 410);
    }

    step = "create";
    const next = await prisma.ledgerAiRun.create({
      data: { uploadId: run.uploadId, vendorId: run.vendorId, task: "PROMPTED_IMPORT", userPrompt: prompt, createdById: user.id },
      select: { id: true },
    });
    newRunId = next.id;
    log.info("import re-run created", { runId: next.id, fromRunId: run.id, vendorId: run.vendorId, inputKind: source.data.kind, promptLength: prompt.length, userId: user.id });

    step = "execute";
    await runPromptedImport(next.id, source.data);
    return successResponse({ id: next.id, uploadId: run.uploadId }, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const ai = toAiErrorResponse(error);
    if (ai) {
      log.warn("re-run ended in an AI error", { runId: newRunId, kind: aiErrorKind(error) });
      return ai;
    }
    return failure(error, { scope: "ledger:import", step, runId: newRunId });
  }
}
