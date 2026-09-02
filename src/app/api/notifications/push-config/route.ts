export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import type { PushWebConfig } from "@/lib/notify/types";

const log = createLogger("notify:push:config");

// The PUBLIC half of the Firebase web configuration — what initializeApp() and getToken()
// need before a browser can mint a registration token.
//
// requireAuth, not requireFeature: every signed-in user registers their own device, and there
// is no module/action pair that would mean anything here. Nothing returned is secret — these
// are the values every Firebase web app ships in its JavaScript bundle. The service account,
// which IS secret, is not even selected below, so it never enters this handler's memory.
//
// `ready` is the client's gate: it must not call getToken() while this is false, because the
// SDK would throw a generic error about a missing option instead of the named reason the
// settings screen can show (plan D.4).

export async function GET() {
  try {
    await requireAuth();

    const row = await prisma.notificationConfig.findUnique({
      where: { id: "singleton" },
      select: {
        pushEnabled: true,
        pushProvider: true,
        fcmWebApiKey: true,
        fcmProjectId: true,
        fcmMessagingSenderId: true,
        fcmWebAppId: true,
        fcmVapidKey: true,
      },
    });

    const view: PushWebConfig = {
      apiKey: row?.fcmWebApiKey ?? null,
      projectId: row?.fcmProjectId ?? null,
      messagingSenderId: row?.fcmMessagingSenderId ?? null,
      appId: row?.fcmWebAppId ?? null,
      vapidKey: row?.fcmVapidKey ?? null,
      ready: false,
    };
    // Only FCM tokens can be minted with the Firebase SDK, so another provider is "not ready"
    // for the browser even if every field happens to be filled in.
    view.ready =
      !!row?.pushEnabled &&
      row.pushProvider === "FCM" &&
      !!view.apiKey &&
      !!view.projectId &&
      !!view.messagingSenderId &&
      !!view.appId &&
      !!view.vapidKey;

    log.debug("push web config served", { ready: view.ready, projectId: view.projectId });
    return successResponse(view);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("could not read push web config", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not read the push configuration", 500);
  }
}
