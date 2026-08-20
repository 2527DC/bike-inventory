export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, parseSearchParams } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("zoho", "fetch");
    const { limit, skip } = parseSearchParams(req.url);

    const logs = await prisma.syncLog.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
      skip,
    });

    return successResponse(logs);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch logs", 500);
  }
}
