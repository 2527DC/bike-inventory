export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { isProviderKey } from "@/lib/integrations";
import { createLogger } from "@/lib/logger";

const log = createLogger("integrations:save");

const saveSchema = z.object({
  clientId: z.string().min(1, "Client ID is required").max(200),
  // Optional on purpose. Blank or omitted means "keep the stored secret", so an admin can
  // correct an organisation name without re-typing a credential they cannot read back.
  clientSecret: z.string().max(400).optional(),
  organizationId: z.string().max(100).optional(),
  organizationName: z.string().max(200).optional(),
});

/**
 * PUT — save client and organisation details WITHOUT connecting.
 *
 * Before this existed, credentials could only be written as a side effect of a successful
 * token exchange in `connect`. So there was no way to store them, and no way to correct one
 * field without redoing the whole grant dance.
 *
 * This deliberately does NOT touch `isConnected`, `accessToken`, `refreshToken` or
 * `accessTokenExpiresAt`. Saving a client id is not a claim that the credentials work —
 * only a successful `connect` may assert that.
 *
 * Changing the client id or secret while connected does NOT disconnect the session either:
 * the existing refresh token keeps working until it is revoked or expires. The screen tells
 * the admin the new values apply at the next connect, rather than silently breaking a live
 * integration the moment a field is edited.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  try {
    const user = await requireFeature("zoho", "edit");

    const { provider } = await ctx.params;
    if (!isProviderKey(provider)) return errorResponse("Unknown integration", 400);

    const parsed = saveSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid details", 400);
    }
    const { clientId, clientSecret, organizationId, organizationName } = parsed.data;

    const existing = await prisma.integrationConfig.findUnique({
      where: { provider },
      select: { clientSecret: true, isConnected: true },
    });

    // A blank secret means keep what is stored. If nothing is stored either, the admin has
    // to supply one — otherwise `connect` would fail later with a far less obvious message.
    const secret = clientSecret?.trim() || existing?.clientSecret || null;
    if (!secret) {
      return errorResponse("Client secret is required the first time you save", 400);
    }

    await prisma.integrationConfig.upsert({
      where: { provider },
      update: {
        clientId: clientId.trim(),
        clientSecret: secret,
        organizationId: organizationId?.trim() || null,
        organizationName: organizationName?.trim() || null,
      },
      create: {
        provider,
        clientId: clientId.trim(),
        clientSecret: secret,
        organizationId: organizationId?.trim() || null,
        organizationName: organizationName?.trim() || null,
        isConnected: false,
      },
    });

    // Identifiers only — never the secret, and never whether it changed in a way that could
    // be used to probe it.
    log.info("integration details saved", {
      userId: user.id,
      provider,
      organizationId: organizationId?.trim() || null,
      secretReplaced: Boolean(clientSecret?.trim()),
      wasConnected: Boolean(existing?.isConnected),
    });

    return successResponse({
      saved: true,
      provider,
      // Echo back what the screen should now show. Never the secret.
      clientId: clientId.trim(),
      organizationId: organizationId?.trim() || null,
      organizationName: organizationName?.trim() || null,
      hasClientSecret: true,
      connected: Boolean(existing?.isConnected),
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to save the details";
    log.error("save failed", { message });
    return errorResponse(message, 400);
  }
}
