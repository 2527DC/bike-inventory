export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// GET — pull summary (by pullId or latest) + history
export async function GET(req: NextRequest) {
  try {
    await requireFeature("zoho", "fetch");

    const pullIdParam = req.nextUrl.searchParams.get("pullId");

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

    const grouped = {
      contacts: previews.filter((p) => p.entityType === "contact"),
      items: previews.filter((p) => p.entityType === "item"),
      bills: previews.filter((p) => p.entityType === "bill"),
      invoices: previews.filter((p) => p.entityType === "invoice"),
    };

    // Recent pull history (last 10)
    const history = await prisma.zohoPullLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
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
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch pull review", 500);
  }
}
