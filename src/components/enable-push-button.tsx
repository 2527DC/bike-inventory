"use client";

// ─── Enable push on this device ────────────────────────────────────────────────
//
// Rendered on /profile (every signed-in user, plan 2809) and on Settings → Notifications
// (admins testing the setup). The enrolment itself lives in src/lib/push-enrol.ts, shared with
// the prompt card and the silent refresh — read the rules at the top of that file.
//
// On mount nothing asks for permission. If permission is ALREADY granted, the device is
// re-filed straight away (no prompt is involved) so the screen can say "Enabled" instead of
// offering a button that would do nothing new.

import { useEffect, useState, type ReactNode } from "react";
import { Bell, BellOff, BellRing, Loader2, Send } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import {
  enrolThisDevice,
  isPushCapable,
  loadPushConfig,
  messageOf,
  PushPermissionError,
} from "@/lib/push-enrol";
import type { DeviceView, PushWebConfig } from "@/lib/notify/types";

const log = createLogger("push:client");

type Phase =
  | "loading" // waiting for /api/notifications/push-config
  | "unsupported" // no service worker / Notification / PushManager in this browser
  | "not-ready" // push-config said ready:false — admin has not finished Settings → Notifications
  | "blocked" // Notification.permission === "denied"
  | "ready" // button shown
  | "working" // click in progress
  | "enabled"; // token minted and registered

export function EnablePushButton({
  showTest = false,
  onEnrolled,
}: {
  /** Offer "Send me a test" once enabled — sends to the caller's own devices only. */
  showTest?: boolean;
  /** Called after this device is (re-)registered, so a device list can refresh. */
  onEnrolled?: (device: DeviceView) => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [config, setConfig] = useState<PushWebConfig | null>(null);
  const [tail, setTail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isPushCapable()) {
        log.info("push unsupported in this browser");
        setPhase("unsupported");
        return;
      }

      const { config: data, error: loadError } = await loadPushConfig();
      if (cancelled) return;
      if (loadError || !data) {
        setError(loadError);
        setPhase("not-ready");
        return;
      }

      setConfig(data);
      if (!data.ready) {
        log.debug("push not ready — settings incomplete or switched off");
        setPhase("not-ready");
        return;
      }
      if (Notification.permission === "denied") {
        setPhase("blocked");
        return;
      }
      if (Notification.permission === "granted") {
        // Already allowed: re-file without a prompt. A failure falls back to the button with
        // the reason shown, so the person can retry and read why.
        setPhase("working");
        try {
          const device = await enrolThisDevice(data, { ask: false });
          if (cancelled) return;
          setTail(device.tokenTail);
          setPhase("enabled");
          onEnrolled?.(device);
        } catch (e) {
          if (cancelled) return;
          log.warn("re-registration on mount failed", { error: messageOf(e) });
          setError(messageOf(e));
          setPhase("ready");
        }
        return;
      }
      setPhase("ready");
    }

    load().catch((e: unknown) => {
      if (cancelled) return;
      log.error("push config bootstrap failed", { error: messageOf(e) });
      setError(messageOf(e));
      setPhase("not-ready");
    });

    return () => {
      cancelled = true;
    };
    // onEnrolled is a notification hook for the parent, not an input to this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enable() {
    if (!config) return;
    setPhase("working");
    setError(null);
    try {
      // Inside the click handler — the user gesture is what makes the prompt appear.
      const device = await enrolThisDevice(config, { ask: true });
      setTail(device.tokenTail);
      setPhase("enabled");
      onEnrolled?.(device);
    } catch (e) {
      if (e instanceof PushPermissionError && e.permission === "denied") {
        setPhase("blocked");
        return;
      }
      const msg = messageOf(e);
      log.error("enable push failed", { error: msg });
      setError(msg);
      setPhase(Notification.permission === "denied" ? "blocked" : "ready");
    }
  }

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiFetch<{ ok: boolean; detail: string }>("/api/notifications/devices/test", {
        method: "POST",
      });
      log.info("self test push requested", { ok: result.ok });
      setTestResult(result);
    } catch (e) {
      log.error("self test push failed", { error: messageOf(e) });
      setTestResult({ ok: false, detail: messageOf(e) });
    } finally {
      setTesting(false);
    }
  }

  switch (phase) {
    case "loading":
      return (
        <Status icon={<Loader2 className="h-4 w-4 animate-spin" />} tone="muted">
          Checking this browser…
        </Status>
      );

    case "unsupported":
      return (
        <Status icon={<BellOff className="h-4 w-4" />} tone="muted">
          This browser cannot receive push.
          <span className="block text-xs text-slate-500">
            On iPhone, add BCH OPS to the Home Screen first and open it from there.
          </span>
        </Status>
      );

    case "not-ready":
      return (
        <Status icon={<Bell className="h-4 w-4" />} tone="muted">
          Push is not configured yet — an admin has to finish Settings → Notifications.
          {error && <span className="block text-xs text-red-600">{error}</span>}
        </Status>
      );

    case "blocked":
      return (
        <Status icon={<BellOff className="h-4 w-4" />} tone="warn">
          Notifications are blocked for this app.
          <span className="block text-xs text-slate-600 mt-0.5">
            Android: long-press the BCH OPS icon → App info → Notifications → Allow. In Chrome:
            tap the icon left of the address → Permissions → Notifications → Allow. Then reload.
          </span>
        </Status>
      );

    case "enabled":
      return (
        <div className="flex flex-col gap-2">
          <Status icon={<BellRing className="h-4 w-4" />} tone="ok">
            Enabled on this device · …{tail}
          </Status>
          {showTest && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={sendTest}
                disabled={testing}
                className="w-fit gap-2"
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {testing ? "Sending…" : "Send me a test"}
              </Button>
              {testResult && (
                <p className={`text-xs ${testResult.ok ? "text-emerald-700" : "text-red-600"}`}>
                  {testResult.ok ? `Sent ${testResult.detail} — it should appear in a few seconds.` : testResult.detail}
                </p>
              )}
            </>
          )}
        </div>
      );

    case "ready":
    case "working":
      return (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={enable}
            disabled={phase === "working"}
            className="w-fit gap-2"
          >
            {phase === "working" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
            {phase === "working" ? "Enabling…" : "Enable push on this device"}
          </Button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      );
  }
}

function Status({
  icon,
  tone,
  children,
}: {
  icon: ReactNode;
  tone: "muted" | "warn" | "ok";
  children: ReactNode;
}) {
  const color =
    tone === "ok" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-slate-600";
  return (
    <div className={`flex items-start gap-2 text-sm ${color}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>{children}</div>
    </div>
  );
}
