export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function POST() {
  try {
    await requireFeature("zoho", "fetch");

    // Revoke token on Zoho's side before clearing locally
    const config = await prisma.zohoInventoryConfig.findUnique({ where: { id: "singleton" } });
    if (config?.refreshToken) {
      try {
        await fetch(`https://accounts.zoho.in/oauth/v2/token/revoke?token=${config.refreshToken}`, {
          method: "POST",
        });
      } catch { /* best-effort revoke */ }
    }

    await prisma.zohoInventoryConfig.upsert({
      where: { id: "singleton" },
      update: {
        isConnected: false,
        accessToken: null,
        refreshToken: null,
        accessTokenExpiresAt: null,
      },
      create: {
        id: "singleton",
        isConnected: false,
        accessToken: null,
        refreshToken: null,
        accessTokenExpiresAt: null,
      },
    });

    return successResponse({ disconnected: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to disconnect", 500);
  }
}
