export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("zoho:pull-review");

// GET — pull summary (by pullId or latest) + history
export async function GET(req: NextRequest) {
  const pullIdParam = req.nextUrl.searchParams.get("pullId");
  try {
    await requireFeature("zoho", "fetch");

    // Find the target pull log (may not exist if finalize failed)
    const targetPull = pullIdParam
      ? await prisma.zohoPullLog.findUnique({ where: { pullId: pullIdParam } })
      : await prisma.zohoPullLog.findFirst({ orderBy: { createdAt: "desc" } });

    // Even if no pullLog found, check for preview records directly by pullId
    const effectivePullId = pullIdParam || targetPull?.pullId;

    if (!effectivePullId) {
      return successResponse({ latest: null, history: [], previews: [] });
    }

    // Preview items — query by pullId directly (works even if pullLog missing)
    const previews = await prisma.zohoPullPreview.findMany({
      where: { pullId: effectivePullId },
      orderBy: { createdAt: "asc" },
    });

    if (!targetPull && previews.length === 0) {
      return successResponse({ latest: null, history: [], previews: [] });
    }

    // One group per entity type. `vendorCredits` and `creditNotes` (plan 1210 credit notes,
    // Part 3.4) carry each preview's `action` — new / update / void — beside its data, as the
    // bills now carry "existing".
    const grouped = {
      contacts: previews.filter((p) => p.entityType === "contact"),
      items: previews.filter((p) => p.entityType === "item"),
      bills: previews.filter((p) => p.entityType === "bill"),
      invoices: previews.filter((p) => p.entityType === "invoice"),
      vendorCredits: previews.filter((p) => p.entityType === "vendorcredit"),
      creditNotes: previews.filter((p) => p.entityType === "creditnote"),
    };

    // Recent pull history (last 10)
    const history = await prisma.zohoPullLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    log.debug("pull review read", {
      pullId: effectivePullId,
      previews: previews.length,
      bills: grouped.bills.length,
      invoices: grouped.invoices.length,
      vendorCredits: grouped.vendorCredits.length,
      creditNotes: grouped.creditNotes.length,
    });

    return successResponse({
      latest: targetPull
        ? { ...targetPull, previews: grouped }
        : { pullId: effectivePullId, previews: grouped, status: "PENDING_REVIEW" },
      previews,
      history,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : String(error);
    log.error("pull review failed", { pullId: pullIdParam, message });
    return errorResponse("Could not load the pull review. Try again.", 500);
  }
}
