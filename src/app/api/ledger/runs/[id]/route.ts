export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import type { LedgerProposals } from "@/lib/brand-ledger/ai-run";
import { isoDay } from "@/lib/brand-ledger/view-types";

// GET — one run with its proposals, for the review card / review page. The raw model reply is not
// returned; it is provenance for a later check, not something the screen renders.
//
// For a PROMPTED_IMPORT (plan 1310) it also returns:
//   source        the kept cells or text (never a file) — the review page re-applies a corrected
//                 column mapping to it in the browser, with no new AI call;
//   siblings      the other runs over the same upload ("re-run with a new prompt" keeps them);
//   existing      this vendor's ledger entries, for the duplicate check — all of them, not just
//                 the first read's period, because a corrected mapping can widen the dates.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("brand_ledger", "view");
    const { id } = await params;

    const run = await prisma.ledgerAiRun.findUnique({
      where: { id },
      select: {
        id: true,
        vendorId: true,
        task: true,
        status: true,
        userPrompt: true,
        provider: true,
        model: true,
        usageIn: true,
        usageOut: true,
        latencyMs: true,
        chunks: true,
        proposals: true,
        error: true,
        acceptedAt: true,
        statementId: true,
        createdAt: true,
        source: true,
        uploadId: true,
        upload: { select: { id: true, fileName: true, kind: true, fileUrl: true, deletedAt: true } },
      },
    });
    if (!run) return errorResponse("Run not found", 404);
    if (run.task !== "PROMPTED_IMPORT") {
      const { source: _source, ...rest } = run;
      void _source;
      return successResponse(rest);
    }

    const proposals = run.proposals as unknown as LedgerProposals | null;
    const [siblings, existing] = await Promise.all([
      prisma.ledgerAiRun.findMany({
        where: { uploadId: run.uploadId, id: { not: run.id } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, status: true, userPrompt: true, createdAt: true },
      }),
      proposals?.kind === "statement" && run.status === "DONE"
        ? prisma.brandLedgerEntry.findMany({
            where: { vendorId: run.vendorId },
            select: { entryDate: true, amount: true, direction: true, ref: true },
            take: 20_000,
          })
        : Promise.resolve([]),
    ]);
    return successResponse({
      ...run,
      siblings,
      existing: existing.map((e) => ({ date: isoDay(e.entryDate), amount: Number(e.amount), direction: e.direction, ref: e.ref ?? "" })),
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "ledger:ai", step: "get-run" });
  }
}
