export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { StorageNotConfiguredError } from "@/lib/storage";
import { deleteLedgerFile } from "@/lib/brand-ledger/uploads";

const log = createLogger("ledger:evidence");

// DELETE — the object first, then the row. A refusal from storage is a 502, so the row never
// says "gone" over a file that is still there.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let step = "load";
  try {
    const user = await requireFeature("brand_ledger_gaps", "edit");
    const { id } = await params;

    const evidence = await prisma.ledgerGapEvidence.findUnique({
      where: { id },
      select: { id: true, url: true, gapId: true },
    });
    if (!evidence) return errorResponse("Evidence not found", 404);

    step = "delete-object";
    try {
      await deleteLedgerFile(evidence.url);
    } catch (e) {
      if (e instanceof StorageNotConfiguredError) return errorResponse(e.message, 501);
      const reason = e instanceof Error ? e.message : String(e);
      log.error("evidence delete refused by storage", { evidenceId: id, gapId: evidence.gapId, reason });
      return errorResponse(`The file could not be deleted from storage: ${reason}`, 502);
    }

    step = "delete-row";
    await prisma.ledgerGapEvidence.delete({ where: { id } });
    log.info("evidence deleted", { evidenceId: id, gapId: evidence.gapId, userId: user.id });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "ledger:evidence", step });
  }
}
