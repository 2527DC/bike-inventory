export const dynamic = "force-dynamic";

export const runtime = "nodejs";
// nodejs, explicitly: the token exchange is a plain fetch, but `GoogleContactsClient` reads and
// writes `IntegrationConfig` through Prisma, which is not an edge client here.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import {
  GOOGLE_CONTACTS_PROVIDER,
  OAUTH_STATE_COOKIE,
  GoogleContactsClient,
  exchangeGoogleCode,
  googleRedirectUri,
} from "@/lib/integrations/google-contacts";
import { createLogger } from "@/lib/logger";

const log = createLogger("integrations:google-contacts");

const SETTINGS_PATH = "/settings/integrations";

/** Back to the settings screen with a message the card can show. Never leaks a code or a token. */
function back(req: NextRequest, outcome: string, message?: string) {
  const url = new URL(SETTINGS_PATH, req.nextUrl.origin);
  url.searchParams.set("google", outcome);
  if (message) url.searchParams.set("googleMessage", message);
  return NextResponse.redirect(url);
}

/**
 * Where Google sends the admin back (plan 1709, P14a).
 *
 * Validates `state` against the httpOnly cookie the connect route set — without that check, any
 * page on the internet could link the shop's integration to a Google account of its choosing.
 * Then exchanges the code, stores the tokens, and marks the row connected.
 */
export async function GET(req: NextRequest) {
  const jar = await cookies();
  try {
    await requireFeature("settings", "edit");

    const params = req.nextUrl.searchParams;
    const error = params.get("error");
    if (error) {
      log.warn("google consent refused", { error });
      return back(req, "error", error === "access_denied" ? "You cancelled the Google sign-in." : error);
    }

    const code = params.get("code");
    const state = params.get("state");
    const expected = jar.get(OAUTH_STATE_COOKIE)?.value;
    if (!code || !state || !expected || state !== expected) {
      log.warn("google callback rejected: state mismatch", { hasCode: !!code, hasState: !!state });
      return back(req, "error", "That sign-in did not match the one this browser started. Try Connect again.");
    }
    // Single use: consumed whether the exchange succeeds or fails.
    jar.delete(OAUTH_STATE_COOKIE);

    const cfg = await prisma.integrationConfig.findUnique({
      where: { provider: GOOGLE_CONTACTS_PROVIDER },
      select: { clientId: true, clientSecret: true, organizationName: true },
    });
    if (!cfg?.clientId || !cfg.clientSecret) {
      return back(req, "error", "The client ID and secret are no longer saved. Enter them and Connect again.");
    }

    const tokens = await exchangeGoogleCode(
      cfg.clientId,
      cfg.clientSecret,
      code,
      googleRedirectUri(req.nextUrl.origin)
    );

    await prisma.integrationConfig.update({
      where: { provider: GOOGLE_CONTACTS_PROVIDER },
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
        isConnected: true,
        lastAuthErrorAt: null,
      },
    });

    // Best effort, and only to label the card: the `contacts` scope alone cannot read the
    // account's email, so this usually returns null and whatever the admin typed stands.
    const client = await GoogleContactsClient.create();
    const email = client ? await client.accountEmail() : null;
    if (email && email !== cfg.organizationName) {
      await prisma.integrationConfig.update({
        where: { provider: GOOGLE_CONTACTS_PROVIDER },
        data: { organizationName: email },
      });
    }

    log.info("google contacts connected", { labelled: !!(email ?? cfg.organizationName) });
    return back(req, "connected");
  } catch (err) {
    jar.delete(OAUTH_STATE_COOKIE);
    if (err instanceof AuthError) {
      log.warn("google callback refused", { status: err.status });
      return back(req, "error", "Sign in again and retry Connect.");
    }
    log.error("google callback failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return back(req, "error", err instanceof Error ? err.message : "Google connection failed.");
  }
}
