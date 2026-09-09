export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// GET — one run with its proposals, for the review card. The raw model reply is not returned;
// it is provenance for a later check, not something the screen renders.
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
        upload: { select: { id: true, fileName: true, kind: true, fileUrl: true, deletedAt: true } },
      },
    });
    if (!run) return errorResponse("Run not found", 404);
    return successResponse(run);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "ledger:ai", step: "get-run" });
  }
}
