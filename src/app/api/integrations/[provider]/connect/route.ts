export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { exchangeGrantToken, isProviderKey, PROVIDER_LABELS } from "@/lib/integrations";

const log = createLogger("integrations:connect");

// Replaces three identical connect routes. Self-client OAuth2: the user generates a grant
// token in the Zoho console and pastes it here, and we trade it for a refresh token.
export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  try {
    const user = await requireFeature("zoho", "create");

    const { provider } = await ctx.params;
    if (!isProviderKey(provider)) return errorResponse("Unknown integration", 400);

    const body = await req.json().catch(() => null);
    const { clientId, clientSecret, grantToken, organizationId, organizationName } = body || {};

    if (!clientId || !clientSecret || !grantToken) {
      return errorResponse("Client ID, Client Secret and Grant Token are required", 400);
    }

    // A grant token is single-use and short-lived, so this is the step that fails most
    // often. exchangeGrantToken turns Zoho's invalid_code into a message that says so.
    const tokens = await exchangeGrantToken(provider, clientId, clientSecret, grantToken);
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    const data = {
      clientId,
      clientSecret,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: expiresAt,
      organizationId: organizationId || null,
      organizationName: organizationName || null,
      isConnected: true,
    };

    await prisma.integrationConfig.upsert({
      where: { provider },
      update: data,
      create: { provider, ...data },
    });

    // Identifiers only — never the credentials.
    log.info("integration connected", { userId: user.id, provider, organizationId });

    return successResponse({
      connected: true,
      provider,
      label: PROVIDER_LABELS[provider],
      organizationName,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to connect";
    log.error("connect failed", { error: message });
    return errorResponse(message, 500);
  }
}
