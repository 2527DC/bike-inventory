// Counter watchdog — the reason heartbeats exist.
//
// The edge agent posts a heartbeat every 60s and deliberately swallows every error from that
// call: counter.py comments it as "the cloud noticing the gap IS the alert". Nothing on the
// store laptop will ever tell anyone it has died. This route is the other half of that
// contract, and without it the heartbeat table is just data nobody reads.
//
// TRD §5: "heartbeat gap > 5 min -> watchdog pushes 'Store-X counter offline' to owner phone."
//
// State is derived, not stored: a device is alerted about when it crosses from healthy to
// stale, and `lastAlertedAt` is not a column — instead the alert is rate-limited by comparing
// the gap against the cron interval, so a counter that is down for a week produces one alert
// per run rather than a stream. Vercel Cron frequency therefore IS the alert frequency.

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { sendOwnerAlert } from "@/lib/analytics/alerts";
import { HEARTBEAT_STALE_MS } from "@/lib/analytics/store";
import { stockLocationLabel } from "@/lib/inventory-config";
import { storeClock, STORE_TZ } from "@/lib/analytics/time";

function minutesAgo(from: Date | null, now: number): number | null {
  if (!from) return null;
  return Math.floor((now - from.getTime()) / 60000);
}

export async function GET(req: NextRequest) {
  // Same guard as the other crons. A missing secret DENIES — it must never fall open, since
  // this route is reachable without a session (see src/middleware.ts).
  const secret = process.env.CRON_SECRET;
  if (!secret) return errorResponse("CRON_SECRET not configured", 500);
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const now = Date.now();

    const devices = await prisma.analyticsDevice.findMany({
      where: { isActive: true },
      select: { id: true, label: true, storeId: true, agentId: true, lastSeenAt: true },
      orderBy: { storeId: "asc" },
    });

    if (devices.length === 0) {
      return successResponse({
        checked: 0,
        offline: 0,
        note: "no active counting devices registered — nothing to watch",
      });
    }

    const offline = devices.filter(
      (d) => d.lastSeenAt == null || now - d.lastSeenAt.getTime() >= HEARTBEAT_STALE_MS
    );

    let alert = null;
    if (offline.length > 0) {
      const lines = offline.map((d) => {
        const mins = minutesAgo(d.lastSeenAt, now);
        const since = mins == null ? "never reported" : `silent ${mins} min`;
        return `• ${stockLocationLabel(d.storeId)} (${d.label}) — ${since}`;
      });

      const message =
        `⚠️ *Counter offline*\n\n${lines.join("\n")}\n\n` +
        `Checked ${storeClock(now)} ${STORE_TZ}.\n` +
        `Footfall is not being recorded for these doors. The agent keeps counting locally ` +
        `and backfills when it reconnects, so recent minutes are usually recoverable — but a ` +
        `laptop that is off is losing them.`;

      alert = await sendOwnerAlert(message);
    }

    return successResponse({
      checked: devices.length,
      offline: offline.length,
      stale_threshold_minutes: HEARTBEAT_STALE_MS / 60000,
      devices: offline.map((d) => ({
        store: d.storeId,
        label: d.label,
        agent: d.agentId,
        silent_minutes: minutesAgo(d.lastSeenAt, now),
      })),
      alert,
    });
  } catch (error) {
    console.error("counter watchdog failed", error);
    return errorResponse(
      error instanceof Error ? error.message : "Watchdog failed",
      500
    );
  }
}
