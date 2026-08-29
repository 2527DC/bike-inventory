export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { isProviderKey } from "@/lib/integrations";

// Replaces three identical status routes (zoho, zakya, zoho-inventory).
//
// The guard is still requireFeature("zoho", ...) and the response shape is unchanged, so
// the integrations screen needs no change beyond the URL it calls.
export async function GET(_req: Request, ctx: { params: Promise<{ provider: string }> }) {
  try {
    await requireFeature("zoho", "view");

    const { provider } = await ctx.params;
    if (!isProviderKey(provider)) return errorResponse("Unknown integration", 400);

    const config = await prisma.integrationConfig.findUnique({
      where: { provider },
      select: {
        isConnected: true,
        organizationId: true,
        organizationName: true,
        lastSyncAt: true,
        accessTokenExpiresAt: true,
      },
    });

    if (!config || !config.isConnected) return successResponse({ connected: false });

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
