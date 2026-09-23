# Notifications — how it works, how to turn it on, what to watch out for

> **23 Sep 2026 (plan 2309): push is the only notification channel.** Staff are never notified
> by email. SMTP stays for one job only — emailing purchase orders to vendors — and has no on/off
> switch any more. Every user also has a **Notifications** list (`/notifications`) with an unread
> count on the header bell and, where supported, on the installed app's icon. Sections below are
> updated to match.

For whoever picks this up next: the staff member who configures it, the developer who adds an
event, and the person asking "why didn't I get that?".

**State as of 2 Sep 2026: installed and switched OFF.** Every event is wired, every screen
exists, the tables are in the database — and push is off at the master switch in **Settings →
Notifications**. Nothing is sent, and nothing reaches anyone's Notifications list, until someone
turns it on.

Plan and decisions: `docs/implementation/pending/notifications-and-settings-rbac-plan.md`.

---

## 1. Cautions — read these before enabling anything

| # | Caution | Why | Where in the code |
|---|---|---|---|
| 1 | **Push links must be `https` in production.** Set `NEXTAUTH_URL` to the real `https://` origin on deploy. | FCM rejects `webpush.fcm_options.link` unless it is https — a relative path or `http://localhost` fails the **whole send** with `INVALID_ARGUMENT`. In dev the sender omits `fcm_options` and the service worker opens `data.link` instead, so clicking still works locally. | `src/lib/notify/push.ts` (the `webpush` block), `public/sw.js` (`notificationclick`) |
| 2 | **(PO email) A Gmail App Password is not your Gmail password.** 2-Step Verification must be on first; then Google Account → Security → App Passwords → generate. It is 16 characters shown as `abcd efgh ijkl mnop`. | Gmail refuses plain passwords over SMTP (error 535). If the first test fails with 535, retry with the spaces removed before anything else. | `src/lib/notify/email.ts` |
| 3 | **Email is not a notification channel.** Do not add one back without the owner. | Withdrawn on 23 Sep 2026 (plan 2309); the `email` columns and the `EMAIL` channel value were dropped. SMTP sends only purchase orders. | `src/lib/notify/index.ts` |
| 4 | **`zoho.pull_finished` will say "partial" on most real pulls.** | `trigger-pull` counts *"already imported"* bills as errors (pre-existing behaviour). If that is noise, untick **Push** on that row in the Events table — do not change the sender. | `src/app/api/zoho/trigger-pull/route.ts`, Events table on `/settings/notifications` |
| 5 | **A device token is a credential.** Logs and the outbox store only the **last 6 characters**. Never paste a full token into a ticket or a chat. | Anyone holding a token can push to that phone. | `src/lib/notify/push.ts` (`tokenTail`), `src/lib/logger.ts` (`redact` masks any key containing `token`) |
| 6 | **The service-account JSON and the SMTP password are stored in plaintext in the database** and never returned to a browser — the API shows `••••••••` / `configured (client_email …)`. | Same accepted trade-off as S3 keys in `StorageConfig`. Anyone with database read access holds them. Rotate in Google if that ever changes hands. | `src/app/api/notifications/config/route.ts` |
| 7 | **Changing a credential un-proves the channel.** Saving a new password / service account flips `Connected` back to "Untested". Press **Send test** again. | `Connected` is set only by a real successful send, never by saving the form — otherwise a typo would look configured. | `config/route.ts`, `test/route.ts` |
| 8 | **Nothing here runs on a schedule.** No overdue-bill reminders, no stale-sync alerts. Every notification is caused by a person doing something. | The app has no cron and none may be added (`CLAUDE.md`). | — |
| 9 | **Developers: never call `notify()` inside `prisma.$transaction`.** | Prisma allows a transaction 5 s; FCM fan-out takes longer. Inside the transaction it times out and **rolls back the stock write**, and a push already delivered cannot be recalled. Collect inside, send after, wrapped in `after()` from `next/server`. | Every call site; pattern in `src/lib/notify/stock.ts` and plan §F.0 |
| 10 | **Android 13+ needs the runtime `POST_NOTIFICATIONS` permission** and **iOS is out of scope** (no `apns` block). | Applies to the separate Expo app, not this repo. Without the permission, registration succeeds and nothing is ever displayed. | Plan §D.3, D10 |

---

## 2. The thirty-second tour

```
something happens (sale, job READY, shipment DELIVERED, Zoho pull)
        │  after the database transaction commits, after the HTTP response (after())
        ▼
notify(eventKey, { recipients, title, body, refId, link })      src/lib/notify/index.ts
        │
        ├─ master switch off?    → one SKIPPED row, stop — reaches nobody  (Settings → Notifications)
        ├─ event switched off?   → one SKIPPED row, stop — reaches nobody  (Events table)
        ├─ INBOX → a notification_inbox row for EVERY active recipient     → src/lib/notify/inbox.ts
        │          (even one who muted it or has no device), trimmed to 200 per user
        ├─ user opted out?       → SKIPPED row for that user              (/more → My notifications)
        └─ PUSH  → every registered device of every remaining user  → src/lib/notify/push.ts  (FCM v1)
                   carrying data.unread = that user's inbox count, for the app-icon badge
        │
        ▼
one row per recipient in notification_outbox: SENT / FAILED / SKIPPED + reason
```

**Who receives what** — resolved from permissions at send time, never from a stored list:

| Event | Fires when | Recipients | Default push |
|---|---|---|---|
| `stock.below_reorder` | an outward sale/delivery takes a product **below** its reorder level (downward crossing only — no repeat while it stays below) | holders of `reorder.edit` | on |
| `service.job_ready` | a workshop job is set to READY | holders of `service_jobs.approve` + the job's mechanic | on |
| `inbound.delivered` | a shipment is set to DELIVERED (not partial) | holders of `inbound.approve` | on |
| `zoho.pull_started` | someone starts a bills-and-invoices pull | holders of `zoho.fetch` | on |
| `zoho.pull_finished` | that pull ends — `success` or `partial` | holders of `zoho.fetch` | on |

The person who triggered the event is never a recipient. Deactivated users are never recipients.

**Deliberately excluded from `stock.below_reorder`:** stock-reset, stock-count approval, inbound,
cleanup. The first two would fire hundreds of notifications from one button; the rest move stock
up and cannot cross downward.

### File map

| Concern | File |
|---|---|
| Event registry — the only place an event key is defined | `src/lib/notify/events.ts` |
| Shared types / API payload shapes | `src/lib/notify/types.ts` |
| `notify()` core | `src/lib/notify/index.ts` |
| SMTP sender — **PO email to vendors only** | `src/lib/notify/email.ts` |
| Inbox write, 200-row trim, unread count | `src/lib/notify/inbox.ts` |
| Inbox API (own rows only) | `src/app/api/notifications/inbox/route.ts`, `inbox/read/route.ts` |
| Inbox screen | `src/app/(dashboard)/notifications/page.tsx` |
| Unread count store, chime, app-icon badge | `src/stores/inbox.ts`, bell in `src/components/notifications-bell.tsx` |
| FCM sender (JWT → OAuth → `messages:send`, no firebase-admin) | `src/lib/notify/push.ts` |
| Reorder-crossing helper | `src/lib/notify/stock.ts` |
| Reverse permission lookup `usersWithPermission()` | `src/lib/rbac.ts` |
| Admin screen | `src/app/(dashboard)/settings/notifications/page.tsx` |
| Config (masked read / partial write) | `src/app/api/notifications/config/route.ts` |
| Per-event switches | `src/app/api/notifications/events/route.ts` |
| Test send | `src/app/api/notifications/test/route.ts` |
| Device registry (own devices only) | `src/app/api/notifications/devices/route.ts` |
| Public Firebase web config for browsers | `src/app/api/notifications/push-config/route.ts` |
| Personal opt-out | `src/app/api/notifications/preferences/route.ts`, `src/components/notification-preferences.tsx` (rendered on `/more`) |
| "Enable push on this device" | `src/components/enable-push-button.tsx` |
| Service worker (`push`, `notificationclick`) | `public/sw.js`, registered by `src/components/sw-register.tsx` |
| Tables | `notification_config`, `push_devices`, `notification_event_settings`, `notification_preferences`, `notification_outbox`, `notification_inbox` |

**Access:** the admin screen and its routes need the `settings_notifications` module (`view` /
`edit`), a child of Settings — grant it at Team → Roles & Permissions. Registering a device and
setting personal preferences need only a login.

---

## 3. SMTP — for emailing purchase orders to vendors only

SMTP is **not** a notification channel. It exists so **Send to vendor** on a purchase order can
email the PO PDF. There is no on/off switch: PO email works as soon as the fields are filled in.
Until then the PO screen shows an amber line saying email to vendors is not set up.

1. On the sending Google account: turn on **2-Step Verification**, then create an **App Password**
   (Google Account → Security → App Passwords). Copy the 16 characters.
2. As an admin: **Settings → Notifications → Email (PO sending) tab.**
   Host `smtp.gmail.com` · Port `587` · TLS toggle **off** (587 uses STARTTLS; the sender
   requires the upgrade, so the password never travels in clear) · Username = the full Gmail
   address · Password = the App Password · From address = the same Gmail address (Gmail rejects
   any other) · From name optional. **Save.**
3. Press **Send test email.** Expect the badge to read **Connected** and the mail to arrive within
   ~10 s. Failures come back as a named message — "rejected the username or password (SMTP
   535)", "Could not resolve SMTP host", etc. — never a 500.
4. Open an approved PO: **Send to vendor** is enabled and the amber line is gone.

Port `465` with TLS **on** also works (implicit TLS). Anything else is a misconfiguration the
test button will name.

---

## 4. Turning on PUSH (when the time comes)

Prerequisite: a Firebase project. Free tier is fine; ~40 devices is nothing.

**In the Firebase console** (`console.firebase.google.com`):

1. Create a project (or reuse one). Cloud Messaging API (V1) is on by default for new projects.
2. **Project settings → General → Your apps → Add app → Web.** Register it; copy from the config
   shown: `apiKey`, `projectId`, `messagingSenderId`, `appId`.
3. **Project settings → Cloud Messaging → Web Push certificates → Generate key pair.** Copy the
   key — that is the **VAPID public key**.
4. **Project settings → Service accounts → Generate new private key.** A JSON file downloads. This
   is the server credential. Do not commit it, do not email it, do not put it in `.env`.

**In the app**, as an admin: **Settings → Notifications → Push tab.**

5. Paste the whole JSON into **Service account JSON**. Fill **Web API key**, **Messaging sender
   id**, **Web app id**, **VAPID key**. Project id fills itself from the JSON. Switch **Push
   enabled** on. **Save.** A malformed JSON is refused on save with the missing field named.
6. On the same tab, **This device → Enable push on this device.** The browser asks for permission
   (it only ever asks on that click). The device appears under **My devices** with the last six
   characters of its token.
7. **Send test push to my devices.** A notification arrives; clicking it opens the settings page.
   Badge reads **Connected**.
8. Every staff member who wants push does step 6 once per browser/phone. **On a phone: install
   the app to the home screen first** (Chrome → Add to Home Screen) — an installed PWA receives
   push on Android Chrome and on iOS Safari 16.4+.
9. Production deploy: `NEXTAUTH_URL` must be the `https://` origin (Caution 1).

**The separate Expo app** talks to the same endpoints: it signs in with the same access code
(`POST /api/auth/callback/credentials`, keep the session cookie), obtains a **native FCM token**
(`getDevicePushTokenAsync()`, *not* an Expo push token), and `POST`s it to
`/api/notifications/devices` with `platform: "ANDROID"`. Nothing in this repo changes for it.

---

## 5. Per-event switches and personal preferences

- **Events table** (admin, `/settings/notifications`): one Push checkbox per event. "(default)"
  means the admin has never touched that row and the code default applies. **Off reaches
  nobody** — no push and no Notifications-list entry.
- **My notifications** (everyone, `/more`, under the name card): each person's own push opt-out
  per event. Only affects that person's push; the item still lands in their Notifications list.
  Written from the session — the API refuses a `userId` in the body.
- Precedence: master switch → event switch → (inbox row written) → personal preference → does the
  user have a device. Any "no" produces a `SKIPPED` row saying which.

### The Notifications list, the count and the sound

- **`/notifications`** — each user's own, newest first, 30 a page, newest 200 kept. Unread rows
  are bold; tapping one marks it read and opens its link; **Mark all read** clears the lot.
- **The count** — the bell in the phone header and in the slim bar at the top of laptop screens.
  Read once per navigation and whenever a push arrives while the app is open. Never on a timer.
- **The app icon** — `setAppBadge` puts the same number on the installed app's icon on Windows /
  macOS (Chrome, Edge) and iOS 16.4+ Home Screen apps. Android draws its own dot from the tray.
- **Sound** — when the app is the focused tab, the system notification is shown silently and the
  app plays `public/sounds/notify.wav`. Everywhere else (background tab, minimised, app closed)
  the device's own notification sound plays. Exactly one sound either way. A custom sound while
  the app is closed is impossible — no browser supports it.

---

## 6. "Why didn't I get that?" — where to look

**First: the outbox.** One row per intended recipient (push only):

```sql
select "createdAt", "eventKey", channel, status, "userId", target, error, "refId"
from notification_outbox
order by "createdAt" desc
limit 50;
```

| `status` | `userId` | Meaning |
|---|---|---|
| `SKIPPED` | null | Channel-level: master switch off, event switched off, or push is not configured (`error` says which) |
| `SKIPPED` | set | That person opted out, or has no registered device — the item is still in their Notifications list |
| `FAILED` | set | The send was attempted and FCM refused — `error` carries the FCM error code |
| `SENT` | set | Delivered to FCM. `target` is the token tail |

`refId` is the product / job / shipment / SyncLog id the notification was about.

**Second: the server log.** Scopes to grep for: `notify` (the core — one `notification
processed` line per event with counts), `notify:inbox`, `notifications:inbox`, `notify:push` (including `FCM access
token minted` and `push sent`), `notify:stock`, `notify:config`, `notify:preferences`,
`notify:push:devices`. Set `LOG_LEVEL=0` to see the debug lines (outbound requests, timings).
The App Password and the service-account key never appear at any level.

**Third: the browser.** `NEXT_PUBLIC_LOG_LEVEL=0`, then look for `sw:register` (the worker
registered, with its scope) and `push:client` (the enable flow, token tail).

**Common cases**

| Symptom | Likely cause |
|---|---|
| Every row `SKIPPED`, error "switched off in Settings → Notifications" | Master switch is off — this is the shipped state |
| PO **Send to vendor** fails with `SMTP 535` | Not an App Password, or 2-Step Verification is off. Try the password without spaces |
| `FAILED` with `FCM 400 INVALID_ARGUMENT` mentioning link | `NEXTAUTH_URL` is not https (Caution 1) |
| `FAILED` with `FCM 404 UNREGISTERED` | Stale token — the sender deletes that device row automatically; the user re-enables on the device |
| `FAILED` with `Google OAuth 400 invalid_grant` | The service-account key was revoked or the JSON is from a different project |
| Push works on desktop, not on the phone | The app is not installed to the home screen, or Android notifications are blocked for Chrome |
| Test push says "You have no registered devices" | Do **Enable push on this device** first; this message does not change the Connected badge |
| Nothing at all, no outbox rows | The action did not cross a threshold (stock was already below reorder), or the status did not transition (job was already READY, shipment already DELIVERED) |
| A row per event every pull with `zoho.pull_finished` "partial" | Expected — see Caution 4 |

**Testing the service worker with no Firebase at all:** DevTools → Application → Service Workers
→ the *Push* text box → paste `{"notification":{"title":"Test","body":"hello"},"data":{"link":"/stock"}}`
→ a notification appears; clicking it opens `/stock`.

---

## 7. Developers — adding an event

1. Add the key to `NOTIFICATION_EVENTS` in `src/lib/notify/events.ts` with a label, a one-line
   description and its defaults. That is the **only** place. The Events table, the personal
   preferences list and the type checker pick it up.
2. Find the write that represents the event. Inside its `prisma.$transaction`, **collect** what
   you need (ids, names, previous/new values). Do not send there.
3. After the transaction returns, resolve recipients with `usersWithPermission(moduleKey, action)`
   from `src/lib/rbac.ts`, remove the actor, and call
   `after(() => notify("your.key", { recipients, title, body, refId, link }))` with `after` from
   `next/server`. `notify()` never throws; the route's response is not delayed.
4. Never a role name, never a hardcoded recipient list, never inside the transaction, never a
   `console.log`. Look at `src/app/api/inventory/outwards/route.ts` for the smallest complete example.

Deliberately not built: a "clear old outbox rows" button (growth is ~8 MB/year and was accepted),
iOS/APNs, any scheduled digest, email as a notification channel (withdrawn 23 Sep 2026, plan 2309),
email for customers (SMTP is the wrong tool for that; the provider field exists so SES can take
over later).
