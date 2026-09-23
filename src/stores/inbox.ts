"use client";

// ─── Inbox unread count ──────────────────────────────────────────────────────
// One number for the whole client (plan 2309, Part D): the header bell on a phone, the slim bar
// on a laptop, the /notifications page and the installed app's icon badge all read it here, so
// they can never disagree and two mounted bells never fire two requests.
//
// It does NOT poll. It is refreshed once per navigation and whenever the service worker says a
// push arrived (useInboxSync below) — CLAUDE.md, "There are no scheduled jobs".

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { create } from "zustand";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("notifications:bell");

/** The message public/sw.js posts to every open window when a push arrives. */
export const PUSH_RECEIVED = "bch:push-received";

interface InboxState {
  unread: number;
  /** Set the count from a response that already carries it (list load, mark read). */
  setUnread: (n: number) => void;
  /** Re-read the count from the server. Concurrent callers share one request. */
  refresh: () => Promise<void>;
}

let inFlight: Promise<void> | null = null;

/**
 * Mirror the count onto the installed app's icon (Badging API). Supported on installed PWAs on
 * Windows/macOS Chrome and Edge and on iOS 16.4+ Home Screen apps; elsewhere this is a no-op.
 * Android draws its own dot from the notification tray and ignores it.
 */
function setAppBadge(n: number) {
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  const call = n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.();
  call?.catch((err: unknown) => {
    log.debug("app badge not set", { error: err instanceof Error ? err.message : String(err) });
  });
}

export const useInboxStore = create<InboxState>((set) => ({
  unread: 0,
  setUnread: (n) => {
    set({ unread: n });
    setAppBadge(n);
  },
  refresh: () => {
    inFlight ??= (async () => {
      const { data, error } = await apiTry<{ unread: number }>("/api/notifications/inbox?count=1");
      if (error) {
        // A badge is not worth an error banner — log it and keep the last known number.
        log.debug("unread count unavailable", { message: error });
        return;
      }
      const n = data?.unread ?? 0;
      set({ unread: n });
      setAppBadge(n);
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  },
}));

/** Optional chime file, played only when the app is the tab in front (plan 2309, Q11 b). */
const CHIME_SRC = "/sounds/notify.wav";

/**
 * Mount ONCE, in the dashboard layout. Refreshes the count on every navigation and on each
 * push the service worker reports, and plays the chime when this tab is the one being looked
 * at. A background tab stays silent here — the device's own notification sound covers it, so
 * nobody hears two sounds.
 */
export function useInboxSync() {
  const pathname = usePathname();
  const refresh = useInboxStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== PUSH_RECEIVED) return;
      log.debug("push received while open", { visible: document.visibilityState });
      void refresh();
      if (document.visibilityState === "visible" && document.hasFocus()) {
        // Browsers refuse audio until the person has interacted with the page; that refusal is
        // expected, not a fault.
        new Audio(CHIME_SRC).play().catch((err: unknown) => {
          log.debug("chime not played", { error: err instanceof Error ? err.message : String(err) });
        });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [refresh]);
}
