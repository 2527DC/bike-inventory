export const dynamic = "force-dynamic";

import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { googleContactsStatus } from "@/lib/integrations/google-contacts";
import { createLogger } from "@/lib/logger";

const log = createLogger("integrations:google-contacts");

/**
 * Is Google Contacts connected (plan 1709, P14a)?
 *
 * Read by the Settings card AND by the Customers list, which shows the Sync to Google button only
 * when this says connected. Never returns the client secret — `hasClientSecret` is the only signal
 * that one is stored.
 */
export async function GET() {
  try {
    await requireFeature("settings", "edit");
    return successResponse(await googleContactsStatus());
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("google status failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not read the Google Contacts status.", 500);
  }
}
