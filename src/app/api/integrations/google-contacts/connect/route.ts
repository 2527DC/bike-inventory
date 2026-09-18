export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import {
  GOOGLE_CONTACTS_PROVIDER,
  OAUTH_STATE_COOKIE,
  googleConsentUrl,
  googleRedirectUri,
} from "@/lib/integrations/google-contacts";
import { createLogger } from "@/lib/logger";

const log = createLogger("integrations:google-contacts");

const bodySchema = z.object({
  clientId: z.string().trim().min(1, "Paste the OAuth client ID."),
  // Blank means "keep the stored one" — the secret is never sent back to the browser, so an
  // admin editing the client id alone cannot be asked to re-type a value they cannot read.
  clientSecret: z.string().trim().optional(),
  /** A label for the settings card when the `contacts` scope alone cannot read the account email. */
  accountEmail: z.string().trim().max(200).optional(),
});

/**
 * Start the Google consent flow (plan 1709, P14a).
 *
 * Saves the client id (and secret, when one was typed), mints a one-time `state`, drops it in an
 * httpOnly cookie and hands the browser the consent URL to navigate to. The state is what stops
 * someone else's callback from attaching THEIR Google account to this shop's integration.
 */
export async function POST(req: NextRequest) {
  try {
    await requireFeature("settings", "edit");
    const body = bodySchema.parse(await req.json());

    const existing = await prisma.integrationConfig.findUnique({
      where: { provider: GOOGLE_CONTACTS_PROVIDER },
      select: { clientSecret: true },
    });
    const secret = body.clientSecret || existing?.clientSecret || null;
    if (!secret) return errorResponse("Paste the OAuth client secret as well, the first time.", 400);

    await prisma.integrationConfig.upsert({
      where: { provider: GOOGLE_CONTACTS_PROVIDER },
      update: {
        clientId: body.clientId,
        clientSecret: secret,
        ...(body.accountEmail ? { organizationName: body.accountEmail } : {}),
      },
      create: {
        provider: GOOGLE_CONTACTS_PROVIDER,
        clientId: body.clientId,
        clientSecret: secret,
        organizationName: body.accountEmail || null,
        isConnected: false,
      },
    });

    const state = randomUUID();
    const jar = await cookies();
    jar.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax", // lax, not strict: the callback arrives as a top-level navigation FROM Google.
      secure: req.nextUrl.protocol === "https:",
      path: "/api/integrations/google-contacts",
      maxAge: 10 * 60,
    });

    const url = googleConsentUrl(body.clientId, googleRedirectUri(req.nextUrl.origin), state);
    // The client id is not a secret, but it is still an identifier — the log says only that a
    // consent was started, never the id, the secret or the state.
    log.info("google consent started");
    return successResponse({ url });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message ?? "Invalid connection details", 400);
    }
    log.error("google connect failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not start the Google connection.", 500);
  }
}
