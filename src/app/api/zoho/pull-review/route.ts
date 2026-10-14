export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { ZOHO_PULL_ENTITY, ZOHO_PULL_MODULES } from "@/lib/zoho/pull-modules";

const log = createLogger("zoho:pull-review");
const moduleParam = z.enum(ZOHO_PULL_MODULES);

// GET — pull summary (by pullId or latest) + history
//
// `?module=` is the screen asking (plan 1410-per-module-fetch-permissions, D1). It needs that
// screen's Fetch tick, and it sees only that screen's kind of preview — Receivables never
// lists the bills of a pull, Inbound never lists its invoices.
export async function GET(req: NextRequest) {
  try {
    const parsedModule = moduleParam.safeParse(req.nextUrl.searchParams.get("module"));
    if (!parsedModule.success) {
      return errorResponse("This screen is out of date — reload the page and fetch again", 400);
    }
    const moduleKey = parsedModule.data;
    await requireFeature(moduleKey, "fetch");
    const entityType = ZOHO_PULL_ENTITY[moduleKey];

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
      where: { pullId: effectivePullId, entityType },
      orderBy: { createdAt: "asc" },
    });
    log.debug("pull review read", { pullId: effectivePullId, module: moduleKey, previews: previews.length });

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
    log.error("pull review read failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch pull review", 500);
  }
}
