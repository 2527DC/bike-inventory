export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { isProviderKey } from "@/lib/integrations";

const log = createLogger("integrations:disconnect");

// Replaces three identical disconnect routes.
export async function POST(_req: Request, ctx: { params: Promise<{ provider: string }> }) {
  try {
    const user = await requireFeature("zoho", "create");

    const { provider } = await ctx.params;
    if (!isProviderKey(provider)) return errorResponse("Unknown integration", 400);

    const config = await prisma.integrationConfig.findUnique({ where: { provider } });

    // Best-effort revoke on Zoho's side before clearing locally. If this fails the local
    // row is still cleared: leaving the app believing it is connected when the user asked
    // to disconnect is the worse outcome.
    if (config?.refreshToken) {
      try {
        await fetch(
          `https://accounts.zoho.in/oauth/v2/token/revoke?token=${config.refreshToken}`,
          { method: "POST" }
        );
      } catch (e) {
        log.warn("remote token revoke failed; clearing locally anyway", {
          provider,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const cleared = {
      isConnected: false,
      accessToken: null,
      refreshToken: null,
      accessTokenExpiresAt: null,
    };

    await prisma.integrationConfig.upsert({
      where: { provider },
      update: cleared,
      create: { provider, ...cleared },
    });

    log.info("integration disconnected", { userId: user.id, provider });
    return successResponse({ disconnected: true, provider });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to disconnect";
    log.error("disconnect failed", { error: message });
    return errorResponse(message, 500);
  }
}
