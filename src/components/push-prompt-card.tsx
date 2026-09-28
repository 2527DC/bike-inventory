"use client";

// ─── "Turn on notifications" — the app asks ───────────────────────────────────
//
// Plan 2809-profile-page-push-enrolment, Part C (R5, R6; Q5/Q6 answered 28 Sep 2026).
//
// Mounted once in the dashboard layout, above every screen. Two jobs:
//
// 1. ASK. When this browser has never answered the permission question ("default"), show a card
//    with one Allow button. The tap is what lets the native prompt appear — browsers refuse a
//    prompt with no user gesture, and Chrome on Android quietens the site for trying. "Not now"
//    hides the card for 7 days on this browser (localStorage; a private window just sees it
//    again, which is harmless).
//
// 2. KEEP FRESH. When permission is already granted, re-file this device's token silently, at
//    most once a day (src/lib/push-enrol.ts). FCM rotates tokens; a stale one is a device that
//    silently stops receiving. No prompt, no timer — it runs once per app load.
//
// A blocked ("denied") browser gets no card: it cannot be re-asked from code, and /profile
// explains how to unblock it.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BellRing, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createLogger } from "@/lib/logger";
import {
  enrolThisDevice,
  isPushCapable,
  loadPushConfig,
  messageOf,
  PushPermissionError,
  refreshEnrolmentSilently,
} from "@/lib/push-enrol";
import type { PushWebConfig } from "@/lib/notify/types";

const log = createLogger("push:prompt");

const DISMISS_KEY = "bch_push_prompt_dismissed_at";
const DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1000;

export function PushPromptCard() {
  const pathname = usePathname();
  const [config, setConfig] = useState<PushWebConfig | null>(null);
  const [show, setShow] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!isPushCapable()) return;

      if (Notification.permission === "granted") {
        await refreshEnrolmentSilently();
        return;
      }
      if (Notification.permission !== "default") return; // denied — /profile explains
      if (recentlyDismissed()) return;

      const { config: data } = await loadPushConfig();
      if (cancelled || !data?.ready) return;
      setConfig(data);
      setShow(true);
      log.debug("push prompt shown");
    }

    run().catch((e: unknown) => log.error("push prompt bootstrap failed", { error: messageOf(e) }));
    return () => {
      cancelled = true;
    };
  }, []);

  // /profile carries the full control; two asks on one screen is one too many.
  if (!show || !config || pathname === "/profile") return null;

  async function allow() {
    if (!config) return;
    setWorking(true);
    setError(null);
    try {
      await enrolThisDevice(config, { ask: true });
      log.info("push enabled from prompt card");
      setShow(false);
    } catch (e) {
      if (e instanceof PushPermissionError) {
        // Denied: nothing more this card can do. Dismissed: leave it up to retry.
        if (e.permission === "denied") setShow(false);
        else setError(e.message);
      } else {
        log.error("push enable from prompt card failed", { error: messageOf(e) });
        setError(messageOf(e));
      }
    } finally {
      setWorking(false);
    }
  }

  function notNow() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (e) {
      log.debug("prompt dismissal not stored", { error: messageOf(e) });
    }
    log.info("push prompt dismissed for 7 days");
    setShow(false);
  }

  return (
    <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3.5">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-indigo-100 p-2 text-indigo-700 shrink-0">
          <BellRing className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900">Turn on notifications</p>
          <p className="text-xs text-slate-600 mt-0.5">
            Get stock audits, approvals and jobs assigned to you on this phone — even when the app
            is closed.
          </p>
          <div className="flex items-center gap-2 mt-2.5">
            <Button type="button" size="sm" onClick={allow} disabled={working} className="gap-1.5">
              {working && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {working ? "Enabling…" : "Allow"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={notNow} disabled={working}>
              Not now
            </Button>
          </div>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>
        <button
          type="button"
          onClick={notNow}
          aria-label="Dismiss"
          className="p-1 text-slate-400 hover:text-slate-600 rounded-lg focus-ring shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_FOR_MS;
  } catch (e) {
    log.debug("prompt dismissal unreadable", { error: messageOf(e) });
    return false;
  }
}
