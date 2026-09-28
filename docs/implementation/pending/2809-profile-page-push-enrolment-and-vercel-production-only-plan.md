# A profile page where every user turns on push; the app asks for permission itself; Vercel builds production only

Status: pending — **built 28 Sep 2026** on `feat/2809-profile-push-enrolment`; `tsc`, `eslint`, `npm run build` pass. Not yet clicked through on a phone. Old Vercel previews: owner deletes in the dashboard (Q2).
Branch: `feat/2809-profile-push-enrolment` (from `main` @ `e3ede04`).

Every `file:line` below was read from disk on 28 Sep 2026.

## 0. Requirement

### 0.1 The owner's words, verbatim (28 Sep 2026)

> i the versel i dont need the preview  thing delete it keep only the production where in
> versel i treat it as the test application  stage and vps as production  so i need u to fix
> this and all the  user must see this enable push notification  where it must register so i
> think we can have a profile page and buttons there for the user and i need u to implment
> that and fix this push notification where the pwa users must get the push notfication in
> their android app if u can perform a thing like ask permission u can make it too so that the
> application can ask and allow the permission

Context from the same conversation: the owner, signed in as admin in the Android PWA, pressed
"Enable push on this device" and got *"Registration failed - push service error"*; and a stock
audit assigned to a user reached that user's /notifications inbox but never their phone.

### 0.2 Restated as requirements

1. **R1** — Vercel stops building **Preview** deployments. Only the Production deployment (from
   `main`) is built. Vercel is the *test* stage; the VPS is production.
2. **R2** — The existing Preview deployments on Vercel are deleted.
3. **R3** — **Every** signed-in user — not only holders of `settings_notifications` — can
   register their device for push.
4. **R4** — That happens on a new **profile page**, with the buttons for it.
5. **R5** — PWA users on Android actually receive the push, including with the app closed.
6. **R6** — The application asks for the notification permission itself, so the user only has
   to allow it.

## 1. Questions and clarifications — answer before build

| # | Question | Why it changes the build | Options | Recommended |
|---|---|---|---|---|
| Q1 | How is R1 enforced? | Code vs dashboard setting | (a) `vercel.json` → `git.deploymentEnabled: { "*": false, "main": true }` — in git, reviewable (b) Vercel dashboard → Ignored Build Step (c) both | **(a)** |
| Q2 | Who deletes the existing previews (R2)? | The Vercel CLI is not installed here and deletion is irreversible and outward-facing | (a) owner, in the Vercel dashboard → Deployments → filter Preview → delete (b) install the CLI and Claude runs `vercel remove` with each command shown for approval | **(a)** |
| Q3 | What is on `/profile`? | Scope of the page | (a) identity card (name, role, email/phone) + **This device: Enable push / Send me a test** + **My devices** (list, remove) + **My notifications** (the mute switches, moved from /more) (b) (a) + change password | **(a)** — password change is its own plan |
| Q4 | How is `/profile` reached? | Navigation | (a) the user card on /more becomes a link to /profile, and the header menu gets a "Profile" row (b) a bottom-nav tab | **(a)** |
| Q5 | R6 — browsers only show the permission prompt after a tap (Chrome on Android auto-blocks a prompt with no tap and can mark the site as spammy). Acceptable to ask with a one-tap card instead of on page load? | Whether R6 is buildable as literally worded | (a) after login, a card "Turn on notifications — [Allow] [Not now]" when this device is not registered; Allow triggers the native prompt; Not now hides it for 7 days (b) prompt with no tap — **not possible reliably** | **(a)** |
| Q6 | Once permission is granted, re-register silently on every app open? | FCM tokens rotate; a stale token is a dead device | (a) yes — no prompt needed once granted (b) no | **(a)** |
| Q7 | Keep "Enable push on this device" on Settings → Notifications too? | Admin test flow | (a) keep, same component (b) remove there | **(a)** |

### 1.1 Decisions on record

| Date | Q | Answer |
|---|---|---|
| 28 Sep 2026 | Q5, Q6 | (a) one-tap card, "Not now" hides 7 days; once granted, silent re-register on every open |
| 28 Sep 2026 | Q3, Q4 | (a) identity + this device (enable, test) + my devices + my notifications; reached from the /more user card and a header-menu "Profile" row |
| 28 Sep 2026 | Q2 | (a) owner deletes existing previews in the Vercel dashboard |
| 28 Sep 2026 | Q1, Q7 | recommended defaults taken: `vercel.json` `git.deploymentEnabled`; the button stays on Settings → Notifications too |

## 2. How it works today — verified against the code

### 2.1 Only an admin can register a device

- The only render of `<EnablePushButton />` is `src/app/(dashboard)/settings/notifications/page.tsx:578`,
  a page gated by `settings_notifications` (`page.tsx:53`, API `src/app/api/notifications/config/route.ts:170`).
- The APIs behind the button are already open to every signed-in user and self-scoped:
  `push-config` `requireAuth()` (`src/app/api/notifications/push-config/route.ts:25`),
  `devices` GET/POST/DELETE `requireAuth()` (`src/app/api/notifications/devices/route.ts:65,84,145`),
  ownership from the session, never the body. **No API or RBAC change is needed for R3.**
- `/more` shows every user a user card (`src/app/(dashboard)/more/page.tsx:74`) and the mute
  switches `<NotificationPreferences />` (`:90`) but no enable button.
- Dashboard routes have no per-route permission gate (`src/middleware.ts:62` is authentication
  only), so a new `/profile` is reachable by every signed-in user without an RBAC module.

### 2.2 Why pushes are not arriving

Read-only query against the database in `.env` (the Vercel/Supabase one), 28 Sep 2026:

- `NotificationConfig`: push on, provider FCM, project `bharathcycleops`; API-key sender id and
  app-id sender id agree (`471343117410`); VAPID key is 87 chars, starts `B`, base64url, no
  whitespace — the shape of a valid public key.
- `PushDevice`: **1 row in total** (WEB).
- `NotificationOutbox`, last 7 days: 9 × SKIPPED "push is switched off", **3 × SKIPPED
  "no registered device"**, 0 SENT, 0 FAILED.

So the server side decides correctly (`src/lib/notify/index.ts:149` skips users with no
device); users simply have no device on file, because only the admin page can create one.

The admin's *"Registration failed - push service error"* is a browser `DOMException` from the
push subscription inside Firebase `getToken()` (`src/components/enable-push-button.tsx:129`),
before our POST. With the config shape correct, the remaining causes are outside our code:
the VAPID key pair belonging to a different Firebase project than the other four values (the
shape check cannot see that), the phone's Google Play services / network (FCM port 5228), or
stale site data. §4 has the check that separates them.

### 2.3 The permission prompt

`Notification.requestPermission()` runs only inside the click handler
(`enable-push-button.tsx:102`) — correct; browsers reject or quiet-block a prompt with no user
gesture. Nothing re-registers a token on later app opens.

### 2.4 Vercel

`vercel.json` holds only `regions` and `buildCommand`; nothing limits which branches deploy, so
every pushed branch builds a Preview. `deploy-vps.yml` is `workflow_dispatch` only and is not
affected by anything here.

## 3. Implementation plan

### Part A — Vercel production only (R1, R2)

- `vercel.json`: add `"git": { "deploymentEnabled": { "**": false, "main": true } }` (`**` so branch names with a `/` match; a branch matching any `true` rule deploys).
- R2 per Q2: the owner deletes existing previews in the dashboard (steps in §4), or Claude runs
  the CLI with each command approved.

### Part B — `/profile` (R3, R4)

- New `src/app/(dashboard)/profile/page.tsx` (client component, BCH OPS styling):
  1. Identity card — name, role, from session + `usePermissions()`.
  2. **This device** — `<EnablePushButton />` plus a "Send me a test" button once enabled.
  3. **My devices** — list from `GET /api/notifications/devices`, remove via `DELETE`.
  4. **My notifications** — `<NotificationPreferences />`, moved here from /more.
- New `POST /api/notifications/devices/test` (`requireAuth`, sends only to the caller's own
  devices via `sendTestPush(target, "/profile")`, removes dead tokens, logged). Not a reuse of
  `/api/notifications/test`: that route is `settings_notifications.edit` and writes
  `pushConnected` / `pushLastTestError` on the shared config row, which one user's broken phone
  must not flip.
- `/more`: the user card becomes a `Link` to `/profile`; `<NotificationPreferences />` moves out.
- `src/components/header-menu.tsx`: a "Profile" row beside "More, settings and sign out".

### Part C — the app asks (R5, R6)

- Refactor `enable-push-button.tsx`: extract the enable flow into `src/lib/push-enrol.ts`
  (`enrolThisDevice()`, `isEnrolled()`), used by the button, the card and the silent refresh.
- New `src/components/push-prompt-card.tsx` in the dashboard layout: shown when push is ready,
  the browser is capable, `Notification.permission === "default"` and not dismissed in the last
  7 days (localStorage, try/catch). **Allow** → `enrolThisDevice()`; **Not now** → hide 7 days.
  If permission is `denied`, the card instead says how to unblock it on Android.
- Silent refresh (Q6): on app mount, if permission is `granted` and push-config is ready, mint
  the token and POST it (upsert, cheap). No prompt, no polling — once per load.
- Clearer error: map "push service error" to a sentence naming the likely causes.

### Logging

`createLogger("push:enrol")` on the client (`debug` token minted, `info` registered, `warn`
dismissed/blocked, `error` failures with the browser's message — never the token, only
`tokenTail`). The new API route logs `info` on send and `error` on failure with `userId`.

### Board of agents

Frontend engineer (new page, mobile layout, loading/error states); backend engineer (the
self-test route: requireAuth, self-scoped); integration architect (FCM token lifecycle).
No schema change, no migration, no RBAC catalog change.

## 4. Verification

- `npm run build` passes.
- As a non-admin user on Android Chrome PWA: the card appears → Allow → native prompt → a
  `PushDevice` row exists for that user → "Send me a test" arrives with the app closed.
- Assign a stock audit to that user → push arrives; `NotificationOutbox` shows SENT.
- On the admin phone: if it still says "push service error", press the button on desktop Chrome
  at the same URL. Works there → the phone/network; fails there too → re-copy the VAPID key from
  Firebase → Project `bharathcycleops` → Cloud Messaging → Web Push certificates.
- Push a non-`main` branch → no Vercel Preview is built.

## 5. Out of scope

- Password change on the profile page.
- A native (Expo) Android app — this is the PWA.
- Any change to who receives which event (`notify()` recipients).
- Deploying to the VPS.
