export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { isProviderKey } from "@/lib/integrations";
import { createLogger } from "@/lib/logger";

const log = createLogger("integrations:status");

// Replaces three identical status routes (zoho, zakya, zoho-inventory).
//
// Returns the SAVED credentials whether or not the integration is currently connected.
//
// It used to return `{ connected: false }` and nothing else when disconnected, and never
// returned `clientId` even when connected. Disconnect only clears the tokens — clientId,
// clientSecret, organizationId and organizationName all survive it — so the details were
// sitting in the row the whole time and the screen simply could not see them. That is why
// reconnecting felt like re-entering everything from scratch.
//
// `clientSecret` is NEVER returned. CLAUDE.md: "Never log a secret. No tokens, access codes,
// passwords, refresh tokens, cookies" — the same rule governs responses. The screen only
// needs to know a secret EXISTS, so it can render the field as "saved, leave blank to keep";
// `hasClientSecret` is that signal and the value never leaves the server.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  try {
    await requireFeature("zoho", "view");

    const { provider } = await ctx.params;
    if (!isProviderKey(provider)) return errorResponse("Unknown integration", 400);

    const config = await prisma.integrationConfig.findUnique({
      where: { provider },
      select: {
        isConnected: true,
        clientId: true,
        clientSecret: true, // read to derive hasClientSecret; never sent
        organizationId: true,
        organizationName: true,
        lastSyncAt: true,
        accessTokenExpiresAt: true,
        lastAuthErrorAt: true,
      },
    });

    // No row at all — nothing has ever been saved for this provider.
    if (!config) {
      return successResponse({
        connected: false,
        clientId: null,
        organizationId: null,
        organizationName: null,
        hasClientSecret: false,
        lastSyncAt: null,
        tokenValid: false,
        lastAuthErrorAt: null,
      });
    }

    const tokenValid = config.accessTokenExpiresAt
      ? new Date(config.accessTokenExpiresAt).getTime() > Date.now()
      : false;

    log.debug("status read", {
      provider,
      connected: config.isConnected,
      hasSavedCredentials: Boolean(config.clientId),
    });

    return successResponse({
      connected: config.isConnected,
      clientId: config.clientId,
      organizationId: config.organizationId,
      organizationName: config.organizationName,
      hasClientSecret: Boolean(config.clientSecret),
      lastSyncAt: config.lastSyncAt,
      tokenValid,
      // When set, a token refresh was REFUSED (base.ts). `connected` alone cannot express
      // that: it is only ever written by a successful connect, so a revoked refresh token
      // leaves it true forever while every fetch quietly returns nothing. Cleared on the
      // next successful refresh.
      lastAuthErrorAt: config.lastAuthErrorAt,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to check status";
    log.error("status failed", { message });
    return errorResponse(message, 500);
  }
}
