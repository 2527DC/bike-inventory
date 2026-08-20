export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET() {
  try {
    await requireFeature("zoho", "view");

    const config = await prisma.zohoConfig.findUnique({
      where: { id: "singleton" },
      select: {
        isConnected: true,
        organizationId: true,
        organizationName: true,
        lastSyncAt: true,
        accessTokenExpiresAt: true,
      },
    });

    if (!config || !config.isConnected) {
      return successResponse({ connected: false });
    }

    const tokenValid = config.accessTokenExpiresAt
      ? new Date(config.accessTokenExpiresAt).getTime() > Date.now()
      : false;

    return successResponse({
      connected: true,
      organizationId: config.organizationId,
      organizationName: config.organizationName,
      lastSyncAt: config.lastSyncAt,
      tokenValid,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to check status", 500);
  }
}
