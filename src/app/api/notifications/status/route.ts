export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { checkEmailReady } from "@/lib/notify/email";
import { createLogger } from "@/lib/logger";

const log = createLogger("notifications:status");

/**
 * Can this app send email right now?
 *
 * `requireAuth`, NOT `requireFeature`. `GET /api/notifications/config` is gated on
 * `settings_notifications.view`, which a purchasing clerk does not hold — so the screen that
 * needs to grey out "Send to vendor" and say why cannot ask the route that knows. Without this
 * the button either lies (enabled, then 503) or is hidden (reading as "this PO cannot be
 * sent" rather than "email is not set up").
 *
 * Same reasoning as `push-config/route.ts`, which is `requireAuth` because every signed-in
 * user registers their own device.
 *
 * NO SECRETS. It returns a boolean and a sentence. The sentence comes from
 * `NotConfiguredError`, whose messages name fields and where to set them — never a value.
 */
export async function GET(_req: NextRequest) {
  try {
    await requireAuth();
    const status = await checkEmailReady();
    return successResponse(status);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    // A database fault reaches here, and must NOT be reported as "email is not configured" —
    // that would send somebody to Settings to fix a connection problem. checkEmailReady
    // rethrows anything that is not a NotConfiguredError precisely so this branch can exist.
    const message = error instanceof Error ? error.message : "Could not check email status";
    log.error("email status check failed", { message });
    return errorResponse(message, 500);
  }
}
