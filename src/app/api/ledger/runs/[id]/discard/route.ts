export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireAuth, requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("ledger:ai");

// POST — a person sets a run aside. The row stays (its usage is the spend record); nothing it
// proposed reaches the ledger. An accepted run cannot be discarded: its rows already exist.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // 401 before any read — see the accept route.
    await requireAuth();
    const { id } = await params;
    const run = await prisma.ledgerAiRun.findUnique({ where: { id }, select: { id: true, task: true, status: true, vendorId: true } });
    if (!run) return errorResponse("Run not found", 404);

    const user = await requireFeature(
      run.task === "STATEMENT_ROWS" ? "brand_ledger" : "brand_ledger_gaps",
      "create"
    );
    if (run.status === "ACCEPTED") return errorResponse("This run was accepted; its rows are in the ledger", 409);

    await prisma.ledgerAiRun.update({ where: { id }, data: { status: "DISCARDED" } });
    log.info("run discarded", { runId: id, vendorId: run.vendorId, userId: user.id });
    return successResponse({ discarded: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "ledger:ai", step: "discard" });
  }
}
