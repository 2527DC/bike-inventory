"use client";

import { useEffect } from "react";
import { createLogger } from "@/lib/logger";

const log = createLogger("sw:register");

// Registers public/sw.js once per page load. Only registration happens here — asking for
// notification permission on mount is exactly what browsers penalise, so that lives behind a
// click in src/components/enable-push-button.tsx, which reuses THIS registration via
// navigator.serviceWorker.ready.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => log.debug("service worker registered", { scope: reg.scope }))
      .catch((error: unknown) => {
        // This used to be `.catch(() => {})`. A registration that fails silently leaves push
        // and offline mode broken with nothing in the console to say so — on plain http, in a
        // browser that blocks workers, or when sw.js has a syntax error.
        log.error("service worker registration failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, []);
  return null;
}
