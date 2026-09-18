// Bumped whenever this file changes behaviour. The browser reinstalls a worker whose BYTES
// differ, so the bump is not what triggers the update — but the old cache is keyed on this
// name and `activate` deletes every key that is not it, so a stale offline page cannot
// survive the new worker. v3: notification action buttons + quick approve (plan 1709 §3.8).
const CACHE_NAME = "bike-inventory-v3";
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

// ─── Action buttons (plan 1709 §3.8, R24, Q19) ────────────────────────────────
//
// An approval notification carries two buttons: "Approve" (action id `approve`) and "Open"
// (action id `reject`, named for the plan's vocabulary — see src/lib/approvals/notify-actions.ts
// for why the label is not "Reject"). Everything else — the body tap included — opens data.link.
//
// The buttons arrive one of two ways and we accept either. FCM merges `webpush.notification`
// into the delivered payload's `notification`, so `notification.actions` is normally already
// there; `data.actions` is the same list as a JSON string, sent because every FCM data value
// must be a string and because that merge is Google's behaviour rather than our contract.
//
// A browser with no action support (iOS Safari) drops the whole thing silently: showNotification
// ignores an `actions` option it does not know, no button is drawn, and the body tap still opens
// the record. That is why the buttons are a shortcut and never the only route.
const QUICK_APPROVE_ENDPOINT = "/api/approvals/quick";

function readActions(notification, data) {
  if (Array.isArray(notification.actions) && notification.actions.length) return notification.actions;
  if (typeof data.actions === "string" && data.actions) {
    try {
      const parsed = JSON.parse(data.actions);
      if (Array.isArray(parsed)) return parsed;
    } catch (err) {
      // A malformed list costs the buttons, never the notification.
      console.error("[sw] could not parse data.actions; showing the notification without buttons", err);
    }
  }
  return null;
}

/**
 * The record this notification is about. `activity` + `recordId` is what the senders write
 * (src/lib/approvals/notify-actions.ts); the older per-activity keys are read as a fallback so
 * a notification queued before this worker shipped still works instead of failing silently.
 */
function approvalTarget(data) {
  const activity = data.activity;
  const recordId = data.recordId || data.deliveryId || data.transferOrderId || data.shipmentId || data.refId;
  if (!activity || !recordId) return null;
  return { activity: activity, recordId: recordId };
}

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      // `?? {}` matters: the body "null" is VALID JSON, so json() resolves to null without
      // throwing and the catch below never runs. Reading payload.notification off null then
      // threw a TypeError that escaped the listener, so nothing was shown and nothing was
      // logged — from the very DevTools Push box this handler is meant to be testable with.
      payload = event.data.json() ?? {};
      if (typeof payload !== "object") payload = { notification: { body: String(payload) } };
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
  const actions = readActions(notification, data);
  const options = {
    body: notification.body || "",
    icon: notification.icon || PUSH_ICON,
    // Whatever the sender attached, plus the resolved link — notificationclick reads it back.
    data: Object.assign({}, data, { link }),
    // Only when there are some: passing `actions: []` is legal but pointless, and passing
    // `undefined` on an older browser has been reported to upset the options object.
    ...(actions ? { actions: actions } : {}),
  };

  event.waitUntil(
    self.registration.showNotification(title, options).catch((err) => {
      console.error("[sw] showNotification failed", err);
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const link = data.link || "/";
  // Relative links resolve against this worker's origin, so the same payload opens the right
  // page on localhost and in production.
  const url = new URL(link, self.location.origin).href;

  // "Approve" is the ONLY action that does something without a screen. Everything else —
  // "Open", an unknown action id from an older payload, and the body tap — falls through to
  // the focus-or-open logic below, which is also what a browser with no buttons always does.
  if (event.action === "approve") {
    event.waitUntil(quickApprove(data, url));
    return;
  }

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

// ─── Quick approve ─────────────────────────────────────────────────────────────
//
// Tapping "Approve" runs the approval from here, with no page open. The worker holds no
// session of its own — `credentials: "include"` is what sends the NextAuth cookie, and the
// route (src/app/api/approvals/quick/route.ts) re-checks the grant for the activity. Nothing
// is decided in this file; it only carries the ids and shows the answer.
//
// It ALWAYS shows a result notification. A button that silently does nothing is worse than
// one that fails out loud: the approver has no screen to check, so the notification is the
// only place the outcome can appear.
//
// Never throws: notificationclick's waitUntil gets a promise that always resolves, so a
// failure here cannot kill the handler.

function quickApprove(data, url) {
  const target = approvalTarget(data);
  if (!target) {
    // A payload with no ids — an old notification, or a non-approval one that somehow carried
    // the button. Say so and let them open it.
    console.error("[sw] approve pressed on a notification with no activity/recordId");
    return showApprovalResult("Could not approve", "This notification does not say what to approve. Open it instead.", url);
  }

  return fetch(QUICK_APPROVE_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ activity: target.activity, recordId: target.recordId, action: "approve" }),
  })
    .then((res) => readResult(res))
    .catch((err) => {
      // Offline, or the app is unreachable. The record is untouched, so the honest answer is
      // "nothing happened, try again".
      console.error("[sw] quick approve could not reach the server", err);
      return { ok: false, message: "Could not reach BCH OPS. Nothing was approved — open the record and try again." };
    })
    .then((result) => showApprovalResult(result.ok ? "Approved" : "Not approved", result.message, url))
    .catch((err) => {
      console.error("[sw] quick approve failed", err);
    });
}

/**
 * Read the route's `{ ok, message }`.
 *
 * The content-type check is not politeness. An expired session does not 401 here: middleware
 * 307s to /login, fetch follows it, and the worker gets a perfectly good HTML page with
 * status 200 — so `res.ok` says success and `res.json()` throws "Unexpected token '<'" over
 * the top of the real problem. Anything that is not JSON is therefore treated as "you are
 * signed out", which is what it always is.
 */
function readResult(res) {
  const type = res.headers.get("content-type") || "";
  if (type.indexOf("application/json") === -1) {
    console.error("[sw] quick approve got a non-JSON reply", res.status, type);
    return { ok: false, message: "Your session has expired. Open BCH OPS, sign in, and approve it there." };
  }
  return res
    .json()
    .then((body) => ({
      ok: res.ok && !!(body && body.ok),
      message:
        (body && (body.message || body.error)) ||
        (res.ok ? "Approved" : "Could not approve it. Open the record and try there."),
    }))
    .catch((err) => {
      console.error("[sw] quick approve reply was not readable", err);
      return { ok: false, message: "Could not read the answer. Open the record to check whether it was approved." };
    });
}

/** Show the outcome. Tapping it opens the record, so a refusal is one tap from being fixed. */
function showApprovalResult(title, body, url) {
  return self.registration
    .showNotification(title, {
      body: body,
      icon: PUSH_ICON,
      // Replaces its own previous result rather than stacking one per tap.
      tag: "approval-result",
      data: { link: url },
    })
    .catch((err) => {
      console.error("[sw] could not show the approval result", err);
    });
}
