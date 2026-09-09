export const dynamic = "force-dynamic";
// A statement PDF read or a six-chunk chat pass can take most of a minute. 60 is what the
// other AI routes declare and what every Vercel plan allows.
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { toAiErrorResponse, aiErrorKind } from "@/lib/ai";
import { sanitizeUserPrompt } from "@/lib/brand-ledger/ai-prompts";
import { runLedgerAi } from "@/lib/brand-ledger/ai-run";

const log = createLogger("ledger:ai");

const bodySchema = z.object({
  task: z.enum(["STATEMENT_ROWS", "CLAIMS_FROM_CHAT", "CLAIMS_FROM_IMAGE"]),
  prompt: z.string().max(2000).optional(),
});

// POST { task, prompt? } — create a run, execute it, return it. The permission follows what the
// run would produce if accepted: statement rows are ledger entries (brand_ledger.create),
// claims are LedgerGap rows (brand_ledger_gaps.create). The prompt is data, never logged.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let step = "parse";
  let runId: string | null = null;
  try {
    const parsed = bodySchema.safeParse(
      await req.json().catch((e: unknown) => {
        // A non-JSON body fails the schema just below ("task is required"); the reason is kept here.
        log.debug("run body is not JSON", { reason: e instanceof Error ? e.message : String(e) });
        return {};
      })
    );
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "task is required", 400);
    const { task } = parsed.data;

    const user = await requireFeature(
      task === "STATEMENT_ROWS" ? "brand_ledger" : "brand_ledger_gaps",
      "create"
    );
    const { id } = await params;

    const upload = await prisma.ledgerUpload.findUnique({
      where: { id },
      select: { id: true, vendorId: true, kind: true, fileUrl: true, deletedAt: true },
    });
    if (!upload) return errorResponse("Upload not found", 404);
    if (!upload.fileUrl || upload.deletedAt) {
      return errorResponse("This file was deleted from storage. Upload it again to run AI over it.", 410);
    }

    const { prompt, refused } = sanitizeUserPrompt(parsed.data.prompt);
    if (refused) {
      log.warn("prompt refused", { uploadId: id, userId: user.id, length: parsed.data.prompt?.length ?? 0 });
      return errorResponse(refused, 400);
    }

    step = "create";
    const run = await prisma.ledgerAiRun.create({
      data: { uploadId: id, vendorId: upload.vendorId, task, userPrompt: prompt, createdById: user.id },
      select: { id: true },
    });
    runId = run.id;
    log.info("run created", { runId, uploadId: id, vendorId: upload.vendorId, task, promptLength: prompt?.length ?? 0 });

    step = "execute";
    await runLedgerAi(run.id);

    step = "reload";
    const done = await prisma.ledgerAiRun.findUnique({
      where: { id: run.id },
      include: { upload: { select: { id: true, fileName: true, kind: true, fileUrl: true } } },
    });
    return successResponse(done, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const ai = toAiErrorResponse(error);
    if (ai) {
      log.warn("run ended in an AI error", { runId, kind: aiErrorKind(error) });
      return ai;
    }
    return failure(error, { scope: "ledger:ai", step, runId });
  }
}
