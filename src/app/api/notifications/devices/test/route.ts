export const dynamic = "force-dynamic";
// The FCM sender signs a JWT with node crypto — not available on the edge runtime.
export const runtime = "nodejs";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { sendTestPush } from "@/lib/notify/push";
import { NotConfiguredError, type SendResult } from "@/lib/notify/types";

const log = createLogger("notify:push:self-test");

// "Send me a test" on /profile — plan 2809-profile-page-push-enrolment, Part B.
//
// requireAuth, not requireFeature: every signed-in user may test THEIR OWN devices. The
// recipients are the session user's PushDevice rows and nothing else — there is no body, so no
// way to name another user or token.
//
// Deliberately separate from POST /api/notifications/test (settings_notifications.edit): that
// route records pushConnected / pushLastTestError on the shared config row, and one user's
// broken phone must not mark the whole configuration as failing.
//
// Always 200 with { ok, detail } for a send outcome — "you have no devices" is something to
// read, not a server fault.

export async function POST() {
  try {
    const user = await requireAuth();

    const devices = await prisma.pushDevice.findMany({
      where: { userId: user.id },
      select: { id: true, token: true, platform: true },
    });
    if (devices.length === 0) {
      log.info("self test skipped — no devices", { userId: user.id });
      return successResponse({ ok: false, detail: "No device is registered — enable push on this device first" });
    }

    let sent = 0;
    const errors: string[] = [];
    const deadIds: string[] = [];

    for (const device of devices) {
      let result: SendResult;
      try {
        result = await sendTestPush({ token: device.token, platform: device.platform }, "/profile");
      } catch (e) {
        if (e instanceof NotConfiguredError) {
          log.warn("self test: push not configured", { userId: user.id, reason: e.message });
          return successResponse({ ok: false, detail: e.message });
        }
        const message = e instanceof Error ? e.message : String(e);
        log.error("self test: sender threw", { userId: user.id, deviceId: device.id, error: message });
        result = { ok: false, error: message };
      }
      if (result.ok) sent += 1;
      else {
        errors.push(result.error);
        if (result.deadToken) deadIds.push(device.id);
      }
    }

    // A token FCM has declared dead never comes back; keeping it slows every later notify().
    if (deadIds.length > 0) {
      await prisma.pushDevice.deleteMany({ where: { id: { in: deadIds }, userId: user.id } });
      log.warn("self test: dead devices removed", { userId: user.id, count: deadIds.length });
    }

    log.info("self test push", { userId: user.id, devices: devices.length, sent, failed: errors.length });
    if (sent > 0) {
      const note = errors.length > 0 ? ` (${errors.length} failed: ${errors[0]})` : "";
      return successResponse({ ok: true, detail: `to ${sent} device(s)${note}` });
    }
    const detail =
      deadIds.length === devices.length
        ? "Google no longer recognises this device — press Enable push on this device again"
        : errors[0] || "No device accepted the message";
    return successResponse({ ok: false, detail });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("self test push failed", { error: error instanceof Error ? error.message : String(error) });
    return errorResponse("Could not send the test notification", 500);
  }
}
