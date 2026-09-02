"use client";

// ─── Enable push on this device ────────────────────────────────────────────────
//
// The browser half of Part D. Two rules shape everything here:
//
// 1. Notification.requestPermission() runs ONLY inside the click handler. Browsers refuse an
//    unprompted request outright, and Chrome scores the origin down for trying, which then
//    makes the real prompt quieter for everyone (plan D.2). So nothing on mount touches
//    permission or Firebase — mount only asks our API whether push is configured.
//
// 2. getToken() is handed the EXISTING service-worker registration. Without it the SDK
//    registers its own /firebase-messaging-sw.js, and two workers means two push handlers and
//    every notification shown twice. public/sw.js is the one handler, and it shows every push
//    whether or not the tab is focused — so there is deliberately no onMessage() here: the SDK
//    only fires that for messages posted by its own worker (it checks an `isFirebaseMessaging`
//    flag), and on Android Chrome a page cannot construct a Notification itself anyway.
//
// `firebase/*` is imported ONLY from client files like this one. It touches window and
// IndexedDB at import time and must never land in a server bundle.

import { useEffect, useState, type ReactNode } from "react";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { getMessaging, getToken } from "firebase/messaging";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import type { DeviceView, PushWebConfig, RegisterDeviceInput } from "@/lib/notify/types";

const log = createLogger("push:client");

type Phase =
  | "loading" // waiting for /api/notifications/push-config
  | "unsupported" // no service worker / Notification / PushManager in this browser
  | "not-ready" // push-config said ready:false — admin has not finished Settings → Notifications
  | "blocked" // Notification.permission === "denied"
  | "ready" // button shown
  | "working" // click in progress
  | "enabled"; // token minted and registered

// navigator.serviceWorker.ready never settles if registration failed (sw-register.tsx logs
// why). Without a cap the button would spin forever with no message.
const SW_READY_TIMEOUT_MS = 10_000;

export function EnablePushButton() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [config, setConfig] = useState<PushWebConfig | null>(null);
  const [tail, setTail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isPushCapable()) {
        log.info("push unsupported in this browser");
        setPhase("unsupported");
        return;
      }

      const { data, error: loadError } = await apiTry<PushWebConfig>("/api/notifications/push-config");
      if (cancelled) return;

      if (loadError || !data) {
        log.error("could not load push config", { error: loadError });
        setError(loadError ?? "Could not load the push configuration");
        setPhase("not-ready");
        return;
      }

      setConfig(data);
      if (!data.ready) {
        log.debug("push not ready — settings incomplete or switched off");
        setPhase("not-ready");
        return;
      }
      // Read, never requested, on mount. A denied permission cannot be re-asked from code;
      // the person has to change it in the browser, so say so instead of showing a dead button.
      setPhase(Notification.permission === "denied" ? "blocked" : "ready");
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
  }, []);

  async function enable() {
    if (!config) return;
    setPhase("working");
    setError(null);

    try {
      // Inside the click handler — the user gesture is what makes the prompt appear.
      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        log.warn("notification permission denied");
        setPhase("blocked");
        return;
      }
      if (permission !== "granted") {
        // "default": the prompt was dismissed, not refused. Pressing again re-asks.
        log.info("notification prompt dismissed");
        setError("The permission prompt was dismissed — press the button again to retry.");
        setPhase("ready");
        return;
      }

      const options = firebaseOptions(config);
      const vapidKey = config.vapidKey;
      if (!options || !vapidKey) {
        // push-config said ready:true, so this is the server and client disagreeing.
        throw new Error("Push configuration is incomplete — reload the page and try again");
      }

      // Re-renders and a second click must not initialise a second default app — the SDK
      // throws on a duplicate name. A changed config mid-session needs a reload; acceptable.
      const app = getApps().length > 0 ? getApp() : initializeApp(options);
      const messaging = getMessaging(app);

      const registration = await activeRegistration();
      const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
      log.debug("fcm token minted", { tail: token.slice(-6) });

      const body: RegisterDeviceInput = {
        token,
        platform: "WEB",
        userAgent: navigator.userAgent,
      };
      const device = await apiFetch<DeviceView>("/api/notifications/devices", {
        method: "POST",
        json: body,
      });

      log.info("device registered for push", { deviceId: device.id, tail: device.tokenTail });
      setTail(device.tokenTail);
      setPhase("enabled");
    } catch (e) {
      const msg = messageOf(e);
      log.error("enable push failed", { error: msg });
      setError(msg);
      // The permission may have flipped during the attempt (the SDK asks too if needed).
      setPhase(Notification.permission === "denied" ? "blocked" : "ready");
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
          Push is not configured yet.
          {error && <span className="block text-xs text-red-600">{error}</span>}
        </Status>
      );

    case "blocked":
      return (
        <Status icon={<BellOff className="h-4 w-4" />} tone="warn">
          Notifications are blocked for this site — allow them in the browser settings, then
          reload.
        </Status>
      );

    case "enabled":
      return (
        <Status icon={<BellRing className="h-4 w-4" />} tone="ok">
          Enabled on this device · …{tail}
        </Status>
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
            {phase === "working" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Bell className="h-4 w-4" />
            )}
            {phase === "working" ? "Enabling…" : "Enable push on this device"}
          </Button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      );
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────────

function isPushCapable(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "Notification" in window &&
    "PushManager" in window
  );
}

/** The four public values initializeApp() needs, or null if the server sent an incomplete set. */
function firebaseOptions(config: PushWebConfig): FirebaseOptions | null {
  const { apiKey, projectId, messagingSenderId, appId } = config;
  if (!apiKey || !projectId || !messagingSenderId || !appId) return null;
  return { apiKey, projectId, messagingSenderId, appId };
}

async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("The service worker did not become active — reload the page and try again")),
      SW_READY_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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
