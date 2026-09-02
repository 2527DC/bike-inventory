export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { NOTIFICATION_EVENTS, EVENT_KEYS, isEventKey, type EventKey } from "@/lib/notify/events";
import type { EventSettingView } from "@/lib/notify/types";

const log = createLogger("notify:events");

// The global per-event switches — "does this event go out by push? by email?" — for the whole
// business. One row per event key in NotificationEventSetting; an ABSENT row means the code
// default in src/lib/notify/events.ts applies, which is why the response always carries every
// registered key whether or not the table has heard of it. Personal opt-outs are a different
// table (NotificationPreference) and a different route.

const UpdateSchema = z
  .array(
    z.object({
      eventKey: z.string().min(1).max(100),
      push: z.boolean(),
      email: z.boolean(),
    })
  )
  .min(1, "Send at least one event")
  // A client can only ever have as many rows as there are events; more is a bug or a probe.
  .max(EVENT_KEYS.length, `At most ${EVENT_KEYS.length} events can be saved at once`);

/** Every registered event, in registry order, with any stored row merged over its defaults. */
async function listMerged(): Promise<EventSettingView[]> {
  const rows = await prisma.notificationEventSetting.findMany();
  const byKey = new Map(rows.map((r) => [r.eventKey, r]));

  return EVENT_KEYS.map((eventKey) => {
    const def = NOTIFICATION_EVENTS[eventKey];
    const row = byKey.get(eventKey);
    return {
      eventKey,
      label: def.label,
      description: def.description,
      push: row ? row.pushEnabled : def.defaults.push,
      email: row ? row.emailEnabled : def.defaults.email,
      isDefault: !row,
    };
  });
}

export async function GET() {
  try {
    await requireFeature("settings_notifications", "view");
    return successResponse(await listMerged());
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("could not read event settings", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not read the event settings", 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireFeature("settings_notifications", "edit");

    const parsed = UpdateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message || "Invalid event settings", 400);
    }

    // Zod proved the shape; the registry proves the key. A row for an unknown key would sit in
    // the table forever, matched by nothing, so it is refused by name rather than stored.
    const updates: { eventKey: EventKey; push: boolean; email: boolean }[] = [];
    for (const item of parsed.data) {
      if (!isEventKey(item.eventKey)) {
        return errorResponse(`Unknown event key: ${item.eventKey}`, 400);
      }
      updates.push({ eventKey: item.eventKey, push: item.push, email: item.email });
    }

    // One transaction so the table never ends up half-saved if a later upsert fails.
    await prisma.$transaction(
      updates.map((u) =>
        prisma.notificationEventSetting.upsert({
          where: { eventKey: u.eventKey },
          update: { pushEnabled: u.push, emailEnabled: u.email },
          create: { eventKey: u.eventKey, pushEnabled: u.push, emailEnabled: u.email },
        })
      )
    );

    log.info("event settings saved", {
      userId: user.id,
      count: updates.length,
      keys: updates.map((u) => u.eventKey),
    });

    return successResponse(await listMerged());
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("could not save event settings", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not save the event settings", 500);
  }
}
