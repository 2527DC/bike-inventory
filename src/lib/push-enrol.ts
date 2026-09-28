"use client";

// ─── Push enrolment — the browser half, shared ────────────────────────────────
//
// Plan 2809-profile-page-push-enrolment. One implementation of "put THIS device on file for
// push", used by three callers:
//
//   - EnablePushButton (/profile and Settings → Notifications) — a tap, may ask permission
//   - PushPromptCard (every dashboard screen until answered)   — a tap, may ask permission
//   - usePushAutoRefresh (dashboard layout, once per load)     — NEVER asks; only runs when
//     permission is already granted, so a rotated FCM token is re-filed without anyone acting
//
// Rules carried over from enable-push-button.tsx and still load-bearing:
//
// 1. Notification.requestPermission() is only ever called from a tap (`ask: true`). A prompt
//    with no user gesture is refused by browsers, and Chrome on Android marks the origin down
//    for trying, which quietens the real prompt for everyone.
// 2. getToken() is handed the EXISTING service-worker registration (public/sw.js). Without it
//    the Firebase SDK installs its own worker and every push is shown twice.
//
// `firebase/*` is imported ONLY from client files. It touches window and IndexedDB at import time.

import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { getMessaging, getToken } from "firebase/messaging";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { DeviceView, PushWebConfig, RegisterDeviceInput } from "@/lib/notify/types";

const log = createLogger("push:enrol");

// navigator.serviceWorker.ready never settles if registration failed (sw-register.tsx logs why).
const SW_READY_TIMEOUT_MS = 10_000;

// The silent refresh re-files the token at most this often when it has not changed. The POST
// is an upsert and cheap, but there is no reason to send it on every page load.
const REFRESH_EVERY_MS = 24 * 60 * 60 * 1000;
const LAST_SYNC_KEY = "bch_push_last_sync"; // { tail, at } — per-browser convenience only

export class PushPermissionError extends Error {
  constructor(public readonly permission: NotificationPermission) {
    super(
      permission === "denied"
        ? "Notifications are blocked for this site"
        : "The permission prompt was dismissed — press the button again to retry."
    );
  }
}

/** Service worker + Notification + PushManager. iPhone Safari outside the Home Screen fails this. */
export function isPushCapable(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "Notification" in window &&
    "PushManager" in window
  );
}

/** The public Firebase web config, or an error sentence. Never throws. */
export async function loadPushConfig(): Promise<{ config: PushWebConfig | null; error: string | null }> {
  const { data, error } = await apiTry<PushWebConfig>("/api/notifications/push-config");
  if (error || !data) {
    log.error("could not load push config", { error });
    return { config: null, error: error ?? "Could not load the push configuration" };
  }
  return { config: data, error: null };
}

/**
 * Register this browser for the signed-in user. With `ask`, requests permission first (call only
 * from a tap). Without it, requires permission to be granted already. Throws on failure with a
 * sentence the screen can show.
 */
export async function enrolThisDevice(config: PushWebConfig, opts: { ask: boolean }): Promise<DeviceView> {
  if (opts.ask) {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      log.warn("notification permission not granted", { permission });
      throw new PushPermissionError(permission);
    }
  } else if (Notification.permission !== "granted") {
    throw new PushPermissionError(Notification.permission);
  }

  const options = firebaseOptions(config);
  if (!config.ready || !options || !config.vapidKey) {
    // push-config said ready:true to the caller, so this is the server and client disagreeing.
    throw new Error("Push configuration is incomplete — reload the page and try again");
  }

  // A second call must not initialise a second default app — the SDK throws on a duplicate name.
  const app = getApps().length > 0 ? getApp() : initializeApp(options);
  const messaging = getMessaging(app);

  const registration = await activeRegistration();
  let token: string;
  try {
    token = await getToken(messaging, { vapidKey: config.vapidKey, serviceWorkerRegistration: registration });
  } catch (e) {
    const raw = messageOf(e);
    log.error("fcm token could not be minted", { error: raw });
    throw new Error(explainTokenError(raw));
  }
  log.debug("fcm token minted", { tail: token.slice(-6) });

  const body: RegisterDeviceInput = { token, platform: "WEB", userAgent: navigator.userAgent };
  const device = await apiFetch<DeviceView>("/api/notifications/devices", { method: "POST", json: body });
  log.info("device registered for push", { deviceId: device.id, tail: device.tokenTail });

  writeLastSync(device.tokenTail);
  return device;
}

/**
 * Re-file this device's token when permission is ALREADY granted. Never prompts, never throws.
 * Returns the device on success, null when there was nothing to do or it failed (logged).
 */
export async function refreshEnrolmentSilently(opts: { force?: boolean } = {}): Promise<DeviceView | null> {
  if (!isPushCapable() || Notification.permission !== "granted") return null;

  const last = readLastSync();
  if (!opts.force && last && Date.now() - last.at < REFRESH_EVERY_MS) {
    log.debug("push enrolment fresh; skipping refresh", { tail: last.tail });
    return null;
  }

  const { config } = await loadPushConfig();
  if (!config?.ready) return null;

  try {
    return await enrolThisDevice(config, { ask: false });
  } catch (e) {
    log.warn("silent push re-registration failed", { error: messageOf(e) });
    return null;
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────────

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

/**
 * "Registration failed - push service error" is the browser's own text and tells a person
 * nothing. It means the phone could not subscribe with Google's push service — the config shape
 * is checked server-side, so what is left is the device, its network, or a key pair that belongs
 * to another Firebase project.
 */
function explainTokenError(raw: string): string {
  if (/push service error|registration failed/i.test(raw)) {
    return (
      "This phone could not register with Google's push service. Check that Google Play " +
      "services is up to date, try on mobile data instead of Wi-Fi, and clear this site's data " +
      "in Chrome if it persists. (" + raw + ")"
    );
  }
  if (/applicationServerKey|vapid/i.test(raw)) {
    return "The VAPID key in Settings → Notifications is not valid for this Firebase project. (" + raw + ")";
  }
  return raw;
}

export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function readLastSync(): { tail: string; at: number } | null {
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { tail?: unknown; at?: unknown };
    return typeof parsed.tail === "string" && typeof parsed.at === "number"
      ? { tail: parsed.tail, at: parsed.at }
      : null;
  } catch (e) {
    log.debug("last push sync unreadable", { error: messageOf(e) });
    return null;
  }
}

function writeLastSync(tail: string): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, JSON.stringify({ tail, at: Date.now() }));
  } catch (e) {
    log.debug("last push sync not stored", { error: messageOf(e) });
  }
}
