export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// GET — show stuck syncs
export async function GET() {
  try {
    await requireFeature("zoho", "fetch");

    const [runningSyncs, stuckPulls] = await Promise.all([
      prisma.syncLog.findMany({
        where: { status: "running" },
        select: { id: true, syncType: true, status: true, startedAt: true, triggeredBy: true },
        orderBy: { startedAt: "desc" },
      }),
      prisma.zohoPullLog.findMany({
        where: { status: { in: ["PENDING_REVIEW", "PARTIAL"] } },
        select: { id: true, pullId: true, status: true, createdAt: true, billsNew: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return successResponse({
      runningSyncs,
      stuckPulls,
      hasStuck: runningSyncs.length > 0 || stuckPulls.length > 0,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}

// POST — clear all stuck syncs
export async function POST() {
  try {
    await requireFeature("zoho", "fetch");

    const [clearedSyncs, clearedPulls] = await Promise.all([
      prisma.syncLog.updateMany({
        where: { status: "running" },
        data: { status: "failed", completedAt: new Date(), errors: JSON.stringify(["Manually cleared by admin"]) },
      }),
      prisma.zohoPullLog.updateMany({
        where: { status: { in: ["PENDING_REVIEW", "PARTIAL"] } },
        data: { status: "APPROVED", approvedAt: new Date() },
      }),
    ]);

    return successResponse({
      clearedSyncs: clearedSyncs.count,
      clearedPulls: clearedPulls.count,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}
