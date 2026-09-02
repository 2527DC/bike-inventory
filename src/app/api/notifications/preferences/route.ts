export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { NOTIFICATION_EVENTS, EVENT_KEYS, isEventKey } from "@/lib/notify/events";
import type { PreferenceView, PreferenceUpdate } from "@/lib/notify/types";

const log = createLogger("notify:preferences");

// The SESSION user's own notification preferences — one row per event they have opted out of.
//
// THE SELF-PREFERENCE CONTRACT — userId comes from the session, never the body.
// A mechanic must be able to silence their own notifications without holding any
// `settings.*` grant, so this route is `requireAuth()` ONLY — deliberately not
// `requireFeature`. That is safe precisely because the only row it can ever touch is the
// caller's own: `ItemSchema` is `.strict()` and declares no userId, so a forged userId in the
// body is a 400, not a way to mute someone else. Plan §E.2.
//
// Absence of a row means "not opted out". The column defaults on NotificationPreference are
// push=true / email=true and the view below says the same, so a user who has never touched
// this screen sees every switch on and the server treats them as reachable on both channels.
// (Whether a channel is CONFIGURED, or an event is enabled at all, is the admin's call in
// NotificationEventSetting — this table only ever narrows, never widens.)

const ItemSchema = z
  .object({
    eventKey: z.string().trim().min(1).max(100),
    push: z.boolean(),
    email: z.boolean(),
  })
  .strict();

// A body is one or more rows. The screen sends exactly the one row the user just flipped, but
// accepting a batch costs nothing and lets a future "mute everything" button use the same
// route. Capped at the registry size — nothing legitimate needs more.
const BodySchema = z.array(ItemSchema).min(1).max(EVENT_KEYS.length);

/**
 * The full list in registry order, defaults merged in. Shared by GET and PUT so the client
 * always receives the same shape and never has to merge on its own.
 *
 * A stored row whose key is no longer in NOTIFICATION_EVENTS (an event that was removed from
 * the registry) is simply not shown — the registry, not the table, decides what exists.
 */
async function buildView(userId: string): Promise<PreferenceView[]> {
  const rows = await prisma.notificationPreference.findMany({
    where: { userId },
    select: { eventKey: true, push: true, email: true },
  });
  const byKey = new Map(rows.map((r) => [r.eventKey, r]));

  return EVENT_KEYS.map((eventKey) => {
    const def = NOTIFICATION_EVENTS[eventKey];
    const row = byKey.get(eventKey);
    return {
      eventKey,
      label: def.label,
      description: def.description,
      push: row?.push ?? true,
      email: row?.email ?? true,
    };
  });
}

export async function GET() {
  try {
    const user = await requireAuth();

    const view = await buildView(user.id);
    log.debug("<- GET preferences", { userId: user.id, events: view.length });

    return successResponse(view);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("could not read preferences", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not read your notification preferences", 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuth();

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message || "Invalid preferences", 400);
    }

    // zod checked the SHAPE; the KEY is checked against the registry here rather than with a
    // zod enum, because events.ts is the one place an event is defined and a stale enum copy
    // would let the two drift. The loop also narrows `eventKey` from string to EventKey
    // without a cast, and names the offending key so a client bug is diagnosable from the 400.
    const updates: PreferenceUpdate[] = [];
    for (const row of parsed.data) {
      if (!isEventKey(row.eventKey)) {
        log.warn("rejected unknown event key", { userId: user.id, eventKey: row.eventKey });
        return errorResponse(`Unknown event key: ${row.eventKey}`, 400);
      }
      updates.push({ eventKey: row.eventKey, push: row.push, email: row.email });
    }

    log.debug("-> PUT preferences", {
      userId: user.id,
      eventKeys: updates.map((u) => u.eventKey),
    });

    // One upsert per row, all-or-nothing. The `where` is pinned to the SESSION userId — this
    // is the line that makes the route safe to leave on requireAuth alone.
    await prisma.$transaction(
      updates.map((u) =>
        prisma.notificationPreference.upsert({
          where: { userId_eventKey: { userId: user.id, eventKey: u.eventKey } },
          update: { push: u.push, email: u.email },
          create: { userId: user.id, eventKey: u.eventKey, push: u.push, email: u.email },
        })
      )
    );

    log.info("preferences updated", { userId: user.id, count: updates.length });

    return successResponse(await buildView(user.id));
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("could not save preferences", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not save your notification preferences", 500);
  }
}
