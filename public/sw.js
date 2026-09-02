const CACHE_NAME = "bike-inventory-v2";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([OFFLINE_URL]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_URL))
    );
  }
});

// ─── Push ──────────────────────────────────────────────────────────────────────
//
// This is the ONLY push handler. The Firebase SDK on the page is handed THIS registration
// (src/components/enable-push-button.tsx passes `serviceWorkerRegistration`), so it never
// installs its own firebase-messaging-sw.js and no second worker can show the same
// notification twice. It also means the message arrives raw: FCM v1 webpush delivers
//   { notification: { title, body, icon }, data: { ...string values }, fcmOptions: { link } }
// and nothing has unpacked it for us.
//
// Every push is shown, focused tab or not. Firebase's own worker would hand a foreground
// message to the page instead, but that hand-off is private to its worker (the page-side
// onMessage() ignores anything without its `isFirebaseMessaging` flag), and on Android
// Chrome a page cannot construct a Notification anyway — it has to come back through this
// registration. For an ops app a notification while the tab is open is the wanted behaviour.
//
// No logger here: a service worker cannot import src/lib/logger.ts. console.error in the
// catch blocks is the one thing that is allowed to speak.

const PUSH_ICON = "/icons/icon-192.png";
const PUSH_DEFAULT_TITLE = "BCH OPS";

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (err) {
      // Not JSON — DevTools' "Push" button and some test tools send plain text. Show it rather
      // than drop it, so a manual test still proves the handler runs.
      console.error("[sw] push payload was not JSON; showing it as text", err);
      payload = { notification: { body: event.data.text() } };
    }
  }

  const notification = payload.notification || {};
  const data = payload.data || {};
  // data.link is what the sender always sets; fcmOptions.link only when it could be https.
  const link = data.link || (payload.fcmOptions && payload.fcmOptions.link) || "/";

  const title = notification.title || PUSH_DEFAULT_TITLE;
  const options = {
    body: notification.body || "",
    icon: notification.icon || PUSH_ICON,
    // Whatever the sender attached, plus the resolved link — notificationclick reads it back.
    data: Object.assign({}, data, { link }),
  };

  event.waitUntil(
    self.registration.showNotification(title, options).catch((err) => {
      console.error("[sw] showNotification failed", err);
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const link = (event.notification.data && event.notification.data.link) || "/";
  // Relative links resolve against this worker's origin, so the same payload opens the right
  // page on localhost and in production.
  const url = new URL(link, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Prefer a tab that already has the app open: focus it and steer it to the link.
        // navigate() is only allowed on clients this worker controls, so an uncontrolled tab
        // (or a cross-origin link) rejects — fall through to a new window in that case.
        const existing = clients.find((c) => "focus" in c);
        if (!existing) return self.clients.openWindow(url);
        return existing
          .focus()
          .then((focused) => (focused && "navigate" in focused ? focused.navigate(url) : focused))
          .catch((err) => {
            console.error("[sw] could not navigate the existing tab; opening a new one", err);
            return self.clients.openWindow(url);
          });
      })
      .catch((err) => {
        console.error("[sw] notificationclick failed", err);
      })
  );
});
