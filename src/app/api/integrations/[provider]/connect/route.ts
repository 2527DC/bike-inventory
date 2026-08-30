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
    // `edit`, not `create`. The zoho module declares actions [view, edit, approve, fetch]
    // in rbac-catalog.ts, so there is no zoho.create permission row for any role to hold —
    // the guard returned 403 for everyone, ADMIN included, since ADMIN passes by holding
    // every real permission rather than by short-circuiting. Fixed on main in PR #7 for the
    // three routes this one replaced; the consolidation had copied the bug across.
    const user = await requireFeature("zoho", "edit");

    const { provider } = await ctx.params;
    if (!isProviderKey(provider)) return errorResponse("Unknown integration", 400);

    const body = await req.json().catch(() => null);
    const { clientId, clientSecret, grantToken, organizationId, organizationName } = body || {};

    // Fall back to what is already stored. Disconnect clears only the tokens, so the client
    // id and secret survive it — requiring them in the body meant re-typing credentials the
    // row already held, and the screen could not even show them to copy from.
    //
    // The grant token has no such fallback and never will: it is single-use, Zoho does not
    // reissue one for a spent grant, and storing it would be storing a spent credential.
    const stored = await prisma.integrationConfig.findUnique({
      where: { provider },
      select: { clientId: true, clientSecret: true, organizationId: true, organizationName: true },
    });

    const effectiveClientId = (clientId || stored?.clientId || "").trim();
    const effectiveSecret = (clientSecret || stored?.clientSecret || "").trim();

    if (!effectiveClientId || !effectiveSecret) {
      return errorResponse("Save the Client ID and Client Secret first, then connect", 400);
    }
    if (!grantToken) {
      return errorResponse("A Grant Token is required", 400);
    }

    // A grant token is single-use and short-lived, so this is the step that fails most
    // often. exchangeGrantToken turns Zoho's invalid_code into a message that says so.
    const tokens = await exchangeGrantToken(provider, effectiveClientId, effectiveSecret, grantToken);
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    const data = {
      clientId: effectiveClientId,
      clientSecret: effectiveSecret,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: expiresAt,
      organizationId: organizationId || stored?.organizationId || null,
      organizationName: organizationName || stored?.organizationName || null,
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
