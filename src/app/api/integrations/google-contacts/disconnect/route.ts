export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { GOOGLE_CONTACTS_PROVIDER } from "@/lib/integrations/google-contacts";
import { createLogger } from "@/lib/logger";

const log = createLogger("integrations:google-contacts");

/**
 * Disconnect Google Contacts (plan 1709, P14a).
 *
 * Clears the TOKENS only, exactly as the Zoho cards do: the client id, secret and account label
 * are setup, not authorisation, and survive so a reconnect is one button rather than a trip back
 * to the Cloud Console. Contacts already in Google are left alone — this app does not own them —
 * and `Customer.googleContactId` stays, so a later reconnect does not create every contact twice.
 */
export async function POST() {
  try {
    await requireFeature("settings", "edit");
    await prisma.integrationConfig.updateMany({
      where: { provider: GOOGLE_CONTACTS_PROVIDER },
      data: {
        accessToken: null,
        refreshToken: null,
        accessTokenExpiresAt: null,
        isConnected: false,
        lastAuthErrorAt: null,
      },
    });
    log.info("google contacts disconnected");
    return successResponse({ disconnected: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("google disconnect failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not disconnect Google Contacts.", 500);
  }
}
