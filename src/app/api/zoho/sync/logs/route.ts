export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, parseSearchParams } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("zoho:sync-logs");

export async function GET(req: NextRequest) {
  try {
    // zoho.view — reading the sync history is part of the Integrations screen, which opens on
    // view. It was zoho.fetch, so the screen showed and its log list was refused (plan
    // 1410-per-module-fetch-permissions, F6).
    await requireFeature("zoho", "view");
    const { limit, skip } = parseSearchParams(req.url);

    const logs = await prisma.syncLog.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
      skip,
    });

    return successResponse(logs);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("sync log read failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch logs", 500);
  }
}
