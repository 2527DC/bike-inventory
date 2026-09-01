# Push + email notifications, and the Settings RBAC collapse

Status: pending
Branch: **`feat/notifications-and-settings-rbac`** — create it with exactly this name, off `main`.

**Companion documents:**
- `docs/implementation/pending/ai-provider-config-and-task-routing-plan.md` — **collides with
  this plan's Part A.** See §9. Whichever ships second must adopt the other's RBAC shape.
- `docs/agents/database-architect.md`, `docs/agents/integration-architect.md` — consulted for
  Part B and Part D; the deviations from each are named where they occur.

---

## 1. What this changes, in one paragraph

Today the app sends nothing by itself — `src/lib/services/whatsapp.ts` only builds `wa.me`
links a human clicks, and there is no email path anywhere in `src/`. After this plan the app
sends **push** (to the Android app and to desktop browsers, both via FCM) and **email** (via
SMTP, using a Gmail App Password), driven by real events rather than a scheduler, with a
per-event on/off switch for admins and a per-user opt-out for everyone else. In the same
change, `settings_storage` and `whatsapp_templates` stop being sidebar modules: **Settings
becomes one module whose actions name the section** (`storage_edit`, `whatsapp_edit`,
`push_edit`, `email_edit`), and the Settings index page becomes the only way in.

---

## 2. Decisions already taken (owner, 1 Sep 2026)

| # | Decision | Consequence |
|---|---|---|
| D1 | **FCM only** for push — app *and* web | One provider. AWS SNS rejected: it cannot reach a browser, and it still needs FCM underneath for Android. |
| D2 | **Event-only. No scheduler.** | Honours the no-cron rule in `CLAUDE.md`. **Accepted loss: nothing will ever report an overdue bill or a stale sync.** |
| D3 | **SMTP now**, own Gmail + App Password | No Google Cloud project needed. Provider kept pluggable so `GMAIL_OAUTH` / `SES` are rows, not migrations. |
| D4 | **Full collapse** to `settings.storage_edit`-style actions | The expensive option, chosen knowingly. Cost is itemised in Part A. |
| D5 | `zoho` **hidden from the sidebar, key kept** | `route: null`, `parentKey` dropped. All 19 guards outside Settings stay untouched. |
| D6 | **Migration script** for grants | Mandatory — the seeder cascade-deletes grants. See §A4. |
| D7 | **One tabbed page** at `/settings/notifications` | Push and Email tabs. **AI is not a tab here** — see §9. |

### 2.1 Why AWS was rejected, recorded so it is not re-proposed

Android has exactly one push transport: FCM. AWS SNS and AWS End User Messaging are *senders
that call FCM for you* — choosing them means creating the Firebase project anyway, then
maintaining a second system of per-device SNS endpoints, and still building a separate
VAPID web-push path because **SNS has no browser transport at all**. For ~40 staff devices
that is two subsystems where one does the job. AWS remains the right answer for *email* the
day this app mails customers rather than staff (`aws4fetch` is already a dependency and
already signs SigV4 in `src/lib/storage/s3.ts`), which is exactly why Part C keeps the
provider field pluggable.

---

## Part A — The Settings RBAC collapse

This is the risky half of the plan and it is deliberately first: it is destructive, and if it
is going to be reverted, better to find that out before the notification code is stacked on it.

### A1. The action union grows, in three files

`ActionKey` is a closed union duplicated in three places. All three must change together, and
**they have no compile-time link to each other** — a mismatch fails silently at runtime, not
at build.

| File | Symbol | Change |
|---|---|---|
| `prisma/rbac-catalog.ts:10` | `ActionKey` | add the 9 new literals |
| `prisma/rbac-catalog.ts:13` | `ACTION_LABELS` | add a label for each — the admin editor renders from this map |
| `src/lib/rbac.ts:20` | `PermAction` | add the same 9 literals |
| `src/app/(dashboard)/team/permissions/page.tsx:38` | `ACTION_ORDER` | add them **in display order** |

`ACTION_ORDER` is used as `indexOf(a.action) - indexOf(b.action)`. **An action missing from
that array gets `-1` and sorts to the front**, ahead of `view`. That is the silent failure.

New actions:

```
storage_view    storage_edit    storage_approve
whatsapp_view   whatsapp_edit
push_view       push_edit
email_view      email_edit
```

`settings` keeps `view / create / edit / delete` — those still gate Alerts, Bins and the
Label Designer, which have no section-specific action and are not worth inventing one for.

**`settings.view` remains the sidebar gate.** `READ_ACTION` is `"view"`
(`rbac-catalog.ts:23`, `rbac.ts:25`), so a user with `storage_edit` but no `settings.view`
sees no Settings entry at all and cannot reach the page that links to Storage. The migration
in A4 must therefore grant `settings.view` alongside every section action it re-grants.

### A2. Catalog changes (`prisma/rbac-catalog.ts`)

1. **`settings`** — actions become
   `["view","create","edit","delete","storage_view","storage_edit","storage_approve","whatsapp_view","whatsapp_edit","push_view","push_edit","email_view","email_edit"]`.
2. **`settings_storage`** — **deleted from the catalog.**
3. **`whatsapp_templates`** — **deleted from the catalog.**
4. **`zoho`** — keep the key and all four actions; set `route: null` and remove
   `parentKey: "settings"`.

On (4): `app-sidebar.tsx` skips a node only when it is *routeless **and** childless* (its own
"C3" comment). `zoho` as a routeless, childless root is therefore skipped — the same mechanism
that already hides `cost_price`. The Settings index still links to `/settings/integrations`
because `ENTRIES` in `settings/page.tsx` carries a **hardcoded `href`** and uses `module` only
for the permission test. Nothing else changes, and the 19 `requireFeature("zoho", …)` call
sites across `api/zoho/*`, `api/sync/clear` and `api/integrations/*` are untouched.

### A3. Guard rewrites — the complete list

Ten call sites. There are no others; this is the full result of grepping both module keys.

| File | Line | From | To |
|---|---|---|---|
| `src/app/api/settings/storage/route.ts` | 47 | `settings_storage`,`view` | `settings`,`storage_view` |
| `src/app/api/settings/storage/route.ts` | 77 | `settings_storage`,`edit` | `settings`,`storage_edit` |
| `src/app/api/settings/storage/test/route.ts` | 18 | `settings_storage`,`edit` | `settings`,`storage_edit` |
| `src/app/api/settings/storage/cors/route.ts` | 22 | `settings_storage`,`edit` | `settings`,`storage_edit` |
| `src/app/api/settings/storage/activate/route.ts` | 25 | `settings_storage`,`approve` | `settings`,`storage_approve` |
| `src/app/(dashboard)/settings/storage/page.tsx` | 39 | `can("settings_storage","edit")` | `can("settings","storage_edit")` |
| `src/app/(dashboard)/settings/storage/page.tsx` | 40 | `can("settings_storage","approve")` | `can("settings","storage_approve")` |
| `src/app/api/whatsapp-templates/route.ts` | 48 | `whatsapp_templates`,`view` | `settings`,`whatsapp_view` |
| `src/app/(dashboard)/settings/page.tsx` | 33 | `module: "settings_storage"` | `module:"settings"`, `action:"storage_view"` |
| `src/app/(dashboard)/settings/page.tsx` | 68 | `module: "whatsapp_templates"` | `module:"settings"`, `action:"whatsapp_view"` |

Two prose comments also name the old key and must be corrected, or the next reader trusts
them: `src/app/api/settings/storage/route.ts:21` and `:56`.

`settings/page.tsx` types `action?: "view" | "edit"` on its `Entry` interface — widen it to
`PermAction`, or the two new entries will not typecheck.

#### A3.1 A real inconsistency this collapse fixes

WhatsApp templates are **read** through `GET /api/whatsapp-templates` gated on
`whatsapp_templates.view`, but **written** through `PUT /api/alerts/config` gated on
`settings.edit` (`api/alerts/config/route.ts:25`, which accepts a `whatsappTemplates` body
field). So today a user can hold the WhatsApp module and still not edit templates, while a
user with plain `settings.edit` can edit them without holding the module at all. After the
collapse both sides read from one module: `whatsapp_view` to read, `whatsapp_edit` to write —
and `api/alerts/config` PUT must be split so the `whatsappTemplates` field requires
`whatsapp_edit` while `redFlagPhones` keeps `settings.edit`.

### A4. The migration script — mandatory, and it must run *before* the re-seed

`prisma/seed-rbac.ts:143-149` deletes any module whose key is not in the catalog, and
`:169` deletes any permission whose key is not in the seed list. The schema cascades twice:
`Permission.module` is `onDelete: Cascade` (`schema.prisma:74`) and
`RolePermission.permission` is `onDelete: Cascade` (`schema.prisma:108`).

**Therefore: the instant the re-seed runs, every custom role holding a storage or WhatsApp
grant loses it, with no record of what was lost.** ADMIN is unaffected (it is re-granted every
permission by `seed-rbac.ts`), so this will look fine to whoever tests it as an admin and be
broken for everyone else.

New script `prisma/migrate-settings-permissions.ts`, run in two phases:

```
Phase 1  (BEFORE npm run seed:rbac)
  read role_permissions -> permissions -> modules
  for every role holding settings_storage.* or whatsapp_templates.*
  write the pairs to a JSON snapshot on disk, and print the table

Phase 2  (AFTER npm run seed:rbac)
  read the snapshot
  map old -> new:
     settings_storage.view     -> settings.storage_view
     settings_storage.edit     -> settings.storage_edit
     settings_storage.approve  -> settings.storage_approve
     whatsapp_templates.view   -> settings.whatsapp_view
     whatsapp_templates.edit   -> settings.whatsapp_edit
  ALSO grant settings.view to each affected role (see A1 — without it the
  section actions are unreachable)
  createMany({ skipDuplicates: true }) inside one $transaction
```

Idempotent by construction: `RolePermission` has `@@unique([roleId, permissionId])`
(`schema.prisma:110`) and `skipDuplicates` makes a second run a no-op. Per
`database-architect.md` rule 4, both phases run inside `prisma.$transaction()`.

Windows note: seed scripts here run with `--project prisma/tsconfig.json` because inline JSON
breaks `ts-node` on Windows (`CLAUDE.md`). Follow that, not the pattern from another repo.

**Before writing the script, run Phase 1 read-only and show the owner the table.** If it comes
back empty — no custom role holds these — Phase 2 is unnecessary and can be skipped rather
than written. That check costs one query and may delete half of this section.

---

## Part B — Schema

Five models. Reviewed against `docs/agents/database-architect.md`; the two deliberate
deviations are named.

```prisma
// Singleton, deliberately mirroring StorageConfig: one row, secrets in plaintext,
// `*Connected` set ONLY by a real round-trip test and never by saving the form.
model NotificationConfig {
  id              String  @id @default("singleton")

  // ── Email ──
  emailProvider   String  @default("SMTP")   // SMTP | GMAIL_OAUTH | SES
  smtpHost        String?
  smtpPort        Int?
  smtpSecure      Boolean @default(false)    // true = 465 implicit TLS, false = 587 STARTTLS
  smtpUser        String?
  smtpPassword    String?                    // Gmail App Password. NEVER returned to browser.
  fromName        String?
  fromEmail       String?
  emailEnabled    Boolean @default(false)
  emailConnected  Boolean @default(false)

  // ── Push ──
  pushProvider      String  @default("FCM")
  fcmProjectId      String?
  fcmServiceAccount String? @db.Text         // service-account JSON. NEVER returned.
  fcmWebApiKey      String?                  // web SDK config
  fcmVapidKey       String?                  // web push, public half only
  pushEnabled       Boolean @default(false)
  pushConnected     Boolean @default(false)

  lastTestAt      DateTime?
  updatedById     String?
  updatedAt       DateTime @updatedAt

  @@map("notification_config")
}

enum PushPlatform { ANDROID WEB }

model PushDevice {
  id         String       @id @default(cuid())
  userId     String
  token      String       @unique          // dedupe key: FCM reissues, never duplicates
  platform   PushPlatform
  userAgent  String?
  lastSeenAt DateTime     @default(now())
  createdAt  DateTime     @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("push_devices")
}

// Global, admin-controlled. One row per event key. Absent row = use the code default.
model NotificationEventSetting {
  eventKey     String   @id
  pushEnabled  Boolean  @default(true)
  emailEnabled Boolean  @default(false)
  updatedAt    DateTime @updatedAt

  @@map("notification_event_settings")
}

// Per-user opt-out. Written from the SESSION userId, never from the request body.
model NotificationPreference {
  id       String  @id @default(cuid())
  userId   String
  eventKey String
  push     Boolean @default(true)
  email    Boolean @default(true)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, eventKey])
  @@index([userId])
  @@map("notification_preferences")
}

enum NotificationChannel { PUSH EMAIL }
enum NotificationStatus  { SENT FAILED SKIPPED }

model NotificationOutbox {
  id        String              @id @default(cuid())
  eventKey  String
  channel   NotificationChannel
  status    NotificationStatus
  userId    String?
  target    String              // masked: "a***@gmail.com" or the last 6 of a token
  refId     String?             // the record this was about (jobId, shipmentId, productId)
  error     String?
  createdAt DateTime            @default(now())

  @@index([eventKey, createdAt])
  @@index([userId, createdAt])
  @@map("notification_outbox")
}
```

**Deviation 1 — `emailProvider` / `pushProvider` are `String`, not enums.** The architect doc
says "< 20 fixed values → use a Prisma enum". This follows the *stronger* local convention
instead, stated verbatim in `schema.prisma` above both `IntegrationConfig` and `StorageConfig`:
*"adding a fourth integration should be a row, not a migration"*. Values are validated with zod
in the route, exactly as those two already do. `channel`, `status` and `platform` **are** enums
because they are closed sets that only a code change can extend.

**Deviation 2 — `NotificationOutbox` is a hard-delete table.** The doc prefers soft delete for
business entities. This is a log, not a business entity, and it is explicitly ephemeral. Note
the consequence honestly: **`CLAUDE.md` says there are no scheduled jobs, so nothing will prune
it.** `count_events` already grew unbounded for exactly this reason after the footfall rollup
cron was removed. Either accept the growth (a row is ~200 bytes; at 40 staff × 20 events/day
that is ~8 MB/year — acceptable) or add a "clear older than 90 days" button behind
`settings.push_edit`. **Recommend: accept the growth, add the button.**

`target` is masked at write time. Per `CLAUDE.md`, a device token is a credential — the last
six characters are enough to correlate with a `PushDevice` row and are not enough to send.

---

## Part C — Email over SMTP

New dependency: **`nodemailer`** (+ `@types/nodemailer`). Nothing in the repo can send mail
today, so there is no existing sender to extend.

`src/lib/notify/email.ts`:

- Reads `NotificationConfig`; if `emailProvider !== "SMTP"` throws a named error rather than
  falling through — the other providers are declared, not implemented.
- Builds the transport per call. Do **not** cache a transport in module scope: on Vercel that
  outlives a config change and keeps mailing through revoked credentials.
- `export const runtime = "nodejs"` on every route that sends. SMTP is a raw socket on port
  587; **the Edge runtime cannot open one** and the failure is not obvious.
- Scoped logger `createLogger("notify:email")`. `log.debug` the recipient count and timing,
  `log.info` on a completed send, `log.error` with the SMTP response code on failure. **The
  App Password never appears in a log line, an error message, or an API response.**

### C.1 What the owner must do in Google (no Google Cloud project required)

1. Turn on **2-Step Verification** on the sending account — App Passwords do not exist without it.
2. Google Account → Security → **App Passwords** → generate → copy the 16-character value.
3. Enter into `/settings/notifications` → Email: host `smtp.gmail.com`, port `587`,
   secure `false`, user = the full address, password = the App Password.
4. Press **Send test email**. `emailConnected` flips to true only on a real 250 from Gmail.

### C.2 The limit that will actually bite

| | Free @gmail.com | Google Workspace |
|---|---|---|
| Daily cap | ~500 recipients/day | ~2,000/day |
| `From` | locked to the account or a verified alias | same |

**One event mailing 40 staff burns 8% of a free account's daily quota.** This is the concrete
reason the per-user preference table in Part B is not optional, and the reason email defaults
to **off** per event (`NotificationEventSetting.emailEnabled @default(false)`) while push
defaults to on. Push is free and unlimited; email is a scarce resource here.

If this ever mails customers rather than staff, SMTP is the wrong tool and the provider field
exists so SES can take over without touching a call site.

### C.3 Why Gmail OAuth was not chosen (recorded so it is not revisited blindly)

It needs a Google Cloud project, the Gmail API enabled, a consent screen and an OAuth client —
and then hits two walls on a free `@gmail.com`: `gmail.send` is a Google **restricted** scope,
so publishing an External app requires verification plus a third-party security assessment;
and staying in "Testing" mode to dodge that **expires the refresh token every 7 days**, which
is not a production integration. Both walls disappear on a Google Workspace domain, where the
consent screen can be Internal or a service account can use domain-wide delegation. **If the
business moves to Workspace, revisit this; on a free Gmail account, do not.**

---

## Part D — Push over FCM

### D.1 Server

`src/lib/notify/push.ts` — no Firebase Admin SDK. Mint a Google OAuth access token from the
service-account JSON (JWT grant), then `POST https://fcm.googleapis.com/v1/projects/{id}/messages:send`.
Cache the token in module scope for its ~55-minute life; that cache is safe because it is
derived from the config rather than being the config.

Per `integration-architect.md` rule 6, WhatsApp is fire-and-forget and the app tracks *intent*.
**Push is different and the plan exploits that**: FCM returns a message name on success and a
typed error on failure, so `NotificationOutbox` records a real outcome, not an intention.
`UNREGISTERED` / `INVALID_ARGUMENT` means the token is dead → delete that `PushDevice` row in
the same pass. Without that, dead tokens accumulate forever and every send gets slower.

### D.2 Web

`public/sw.js` is 26 lines and handles offline only. Add `push` and `notificationclick`
listeners. Registration already exists at `src/components/sw-register.tsx:8` — extend it to
request permission **on a user gesture, never on mount** (browsers reject an unprompted request
and Chrome penalises the origin), then POST the token to `/api/notifications/devices`.

### D.3 The Android app — and the thing that must be said out loud

`capacitor.config.ts` sets `server.url` to `https://bike-inventory.vercel.app`, so the app is a
webview of the live site and web changes normally reach it with no rebuild.

**Push breaks that property.** Android's System WebView does not implement the Web Push API, so
the service-worker path in D.2 reaches desktop browsers and *not* the app. The app needs the
native plugin:

1. `npm i @capacitor/push-notifications`
2. Firebase console → add an Android app with applicationId `com.bharathcyclehub.inventory`
   → download `google-services.json` → place at `android/app/google-services.json`.
   The gradle hook is **already present** at `android/app/build.gradle:50`
   (`apply plugin: 'com.google.gms.google-services'`), applied conditionally on that file.
3. `npx cap sync android`, rebuild, **reinstall on every device.**
4. Android 13+ requires the runtime `POST_NOTIFICATIONS` permission — request it explicitly;
   without it registration succeeds and nothing is ever displayed, which is a miserable bug to chase.

Client code guards on `Capacitor.isNativePlatform()` so the same bundle serves the browser.
Both paths register to the same `/api/notifications/devices` endpoint with different `platform`
values.

> **Verify on a real device before the plan is called done.** The native bridge is injected into
> a remote `server.url` — this is the same mechanism live-reload uses — but that interaction
> between a remote-hosted bundle and a native plugin is the one part of this plan I have not
> seen run in this project. Test it early; if it fails, the fallback is shipping the web bundle
> locally (`webDir: "out"`) and that is a much larger change.

---

## Part E — Screens

### E.1 `/settings/notifications` — one page, two tabs

Client component, cosmetic gating with `can("settings","push_edit")` /
`can("settings","email_edit")`, real gating in the API.

- **Email tab** — provider, host, port, secure, user, password, from-name, from-address,
  a master on/off, and **Send test email**.
- **Push tab** — FCM project id, service-account JSON, web API key, VAPID public key, a master
  on/off, **Send test push to my devices**, and a list of this user's registered devices with a
  revoke button.
- **Events table** (both tabs) — one row per event key, two checkboxes: push, email. Writes
  `NotificationEventSetting`. This is the "just turn on and off" surface.

The API masks `smtpPassword` and `fcmServiceAccount` on read and never returns them, exactly as
`api/settings/storage/route.ts:56` already does for `secretAccessKey`.

### E.2 Personal preferences are NOT under `settings.*`

A mechanic must be able to silence their own notifications without holding any settings
permission. A second, separate surface writes `NotificationPreference` for **the session's
userId only**, gated on `requireAuth` alone.

This mirrors the pattern `rbac-catalog.ts` already documents for Staff LMS, where `view` means
"read the material **and record your own progress**": acting on your own row is not an
administrative right. Taking the request body's `userId` here would let any user mute any other
user — write it from the session, always.

> **Gap — this surface has nowhere to live yet.** There is **no user profile or account page
> in this app.** `/more` is a module directory that renders granted modules by group;
> `/staff-lms/profile` is LMS-specific (XP and rank). `src/components/header.tsx` has no user
> menu, and sign-out lives in the two sidebars and on `/more`. So "put it on the profile page"
> names a page that does not exist. **See Q6** — this must be answered before Part E is built.

### E.3 Settings index

`ENTRIES` in `settings/page.tsx` gains one card (Notifications → `settings`/`push_view`) and
has its two existing module keys rewritten per the A3 table. WhatsApp and Storage keep their
cards — **the index is now the only route to them**, which is the point of Part A.

---

## Part F — Event wiring

D2 means every notification is raised by an action someone took. Proposed initial set, all of
which already have a natural call site:

| Event key | Fires at | Default push / email |
|---|---|---|
| `stock.below_reorder` | stock write that crosses `reorderLevel` | on / off |
| `service.job_ready` | `ServiceJob` status → READY | on / off |
| `inbound.received` | shipment marked received | on / off |
| `zoho.pull_partial` | a pull ends PARTIAL | on / **on** |

`src/lib/notify/index.ts` exposes one entry point:

```ts
notify(eventKey, { recipients, title, body, refId, data })
```

It resolves the global `NotificationEventSetting`, subtracts each user's
`NotificationPreference`, fans out to push and email, and writes one `NotificationOutbox` row
per channel per recipient. **It never throws into its caller** — a failed notification must not
roll back the stock write that triggered it. It logs and records `FAILED`.

`zoho.pull_partial` defaults email **on** because it is the one event that reports something
already broken, and it is the event most likely to happen while nobody is looking at the screen.

---

## 9. Collision with the AI provider plan — resolve before building

`ai-provider-config-and-task-routing-plan.md` §8 creates a **`settings_ai` child module** at
`/settings/ai`, and its own text says it follows `settings_storage` *"exactly"*. That is the
pattern D4 abolishes. The two plans cannot both be right.

The owner chose "one tabbed page" including AI. **This plan deliberately does not build an AI
tab**, for one reason: the AI plan's `/settings/ai` is not a toggle panel — it is a provider
table, a per-task routing matrix and a spend dashboard. Reproducing a stub of that here would
be thrown away the moment that plan ships.

**Proposal, needs the owner's yes:**
- This plan adds `ai_view` and `ai_edit` to the `settings` action union now, and a Settings
  index card pointing at `/settings/ai`, so the RBAC shape is settled once.
- The AI plan's §8 is amended: no `settings_ai` module; its guard becomes
  `requireFeature("settings", "ai_edit")`; `/settings/ai` stays its own page, reached only from
  the Settings index.

If the owner would rather AI genuinely be a third tab on `/settings/notifications`, say so —
but then the AI plan needs rewriting, not amending, and that is the larger job.

---

## 10. Files touched

**Schema and seed**
- `prisma/schema.prisma` — 5 models, 4 enums, relations on `User`
- `prisma/rbac-catalog.ts` — action union, `ACTION_LABELS`, `settings` actions, delete two modules, `zoho` route/parentKey
- `prisma/migrate-settings-permissions.ts` — **new**, two-phase, run around the re-seed

**RBAC**
- `src/lib/rbac.ts` — `PermAction`
- `src/app/(dashboard)/team/permissions/page.tsx` — `ACTION_ORDER`
- the 10 guard sites in §A3, plus 2 stale comments
- `src/app/api/alerts/config/route.ts` — split `whatsappTemplates` onto `whatsapp_edit` (§A3.1)

**Notifications**
- `src/lib/notify/{index,email,push,events}.ts` — **new**
- `src/app/api/notifications/{config,devices,events,preferences,test}/route.ts` — **new**
- `src/app/(dashboard)/settings/notifications/page.tsx` — **new**
- `src/app/(dashboard)/settings/page.tsx` — one card added, two rewritten
- `public/sw.js`, `src/components/sw-register.tsx` — push listener + registration

**App**
- `package.json` — `nodemailer`, `@types/nodemailer`, `@capacitor/push-notifications`
- `android/app/google-services.json` — **new, not committed if the repo is public**

**Call sites** — the four events in Part F.

---

## 11. Verification

1. `npm run build` passes. *(Postgres must be up — three Staff LMS pages are prerendered and
   query Prisma at build time; `CLAUDE.md`.)*
2. Stop the dev server before `prisma generate` — it holds the query engine and fails `EPERM`.
3. Phase-1 migration output reviewed **before** the re-seed. Snapshot exists on disk.
4. Re-seed, run Phase 2, then **log in as a non-admin custom role** and confirm Storage and
   WhatsApp are still reachable. Testing as ADMIN proves nothing — it holds every permission.
5. Sidebar shows no Storage, no WhatsApp, no Integrations entry; Settings index shows all three.
6. Test email arrives; `emailConnected` true only after it does.
7. Test push arrives in a desktop browser.
8. Test push arrives in the **rebuilt, reinstalled** Android app (§D.3).
9. Revoke `storage_approve` from a role → that user can still edit credentials, cannot switch
   the live provider.
10. Trip one real event end to end and confirm the `NotificationOutbox` row.

---

## 12. Questions

Raised 1 Sep 2026, to be resolved by the owner before Part A is built. **Nothing in this plan
has been implemented** — no file changed, no dependency installed.

### The four findings these questions rest on

Each question below depends on something discovered while reading the code, not on an opinion.
The findings are written up where they belong; this is the index, so whoever resolves the
questions does not have to hunt for them.

| # | Finding | Written up in |
|---|---|---|
| F1 | The action union lives in **three files with no compile-time link**. `ACTION_ORDER` sorts with `indexOf`, so an action missing from it gets `-1` and sorts **ahead of `view`** — it renders wrong rather than erroring. | §A1 |
| F2 | The seeder **cascade-deletes role grants** for any module dropped from the catalog. ADMIN is re-granted everything, so this looks fine to an admin tester and is broken for everyone else. | §A4 |
| F3 | WhatsApp templates are **read** on `whatsapp_templates.view` but **written** on `settings.edit` via `PUT /api/alerts/config`. The two rights are already inconsistent today. | §A3.1 |
| F4 | **Android WebView does not implement the Web Push API**, so the service-worker path cannot reach the app. The app needs the native plugin and a rebuild + reinstall, which breaks the "web changes reach the app instantly" property of the current `server.url` setup. | §D.3 |

### Blocking

**Q1. §9 — amend the AI plan's §8, or make AI a real third tab on `/settings/notifications`?**
`ai-provider-config-and-task-routing-plan.md` §8 creates a `settings_ai` child module and says
it follows `settings_storage` *"exactly"* — the pattern D4 abolishes. Both plans currently
define the same RBAC shape and disagree.
*Recommendation:* **amend.** That plan's `/settings/ai` is a provider table, a per-task routing
matrix and a spend dashboard — not a toggle panel. A stub tab here would be deleted the moment
it ships. This plan reserves `ai_view` / `ai_edit` in the union now and adds a Settings index
card pointing at `/settings/ai`; the AI plan drops its own module and guards on
`requireFeature("settings", "ai_edit")`.
*Blocks:* §A1 and §A2 — the action union cannot be settled twice. Also blocks the AI plan.

**Q2. Who runs the Phase-1 read-only grant query, and what does it return?**
Needs a live `DATABASE_URL`. It answers: which custom roles hold `settings_storage.*` or
`whatsapp_templates.*` today? Per the git-and-npm rule in `AGENTS.md`, the owner runs it or
approves it — it is not run unprompted.
*Recommendation:* run it **before** writing the script. If it returns zero rows, §A4 Phase 2 is
unnecessary and should be **deleted rather than written**, and the re-seed becomes safe to run
with no migration at all. If it returns rows, the snapshot is mandatory.
*Blocks:* §A4, and whether the re-seed can be run safely at all (F2).

**Q6. Where does the personal notification-preferences surface live?**
§E.2 assumed a profile page. **There isn't one** — `/more` is a module directory,
`/staff-lms/profile` is LMS-only, and `header.tsx` has no user menu. Every staff member needs
to reach this without holding any `settings.*` grant, so it cannot sit inside
`/settings/notifications`, which is gated on `settings.push_view`.
*Options:*
- **(a) A section on `/more`.** Every user already reaches it and sign-out already lives there.
  No new route, no new module, no nav change. **Recommended.**
- (b) A new `/profile` route with no module, linked from a new user menu in `header.tsx`.
  Cleaner long-term home, but adds a route with no navigation path until the menu is built.
- (c) A "My notifications" tab on `/settings/notifications` that renders for anyone
  authenticated while the other tabs stay permission-gated. Fewest new files; makes one page
  serve two very different audiences and two different guards.
*Blocks:* Part E.2 and the `/api/notifications/preferences` route.

### Non-blocking

**Q3. `NotificationOutbox` retention.**
Nothing prunes it — there is no cron, and `count_events` already grew unbounded for exactly
this reason after the footfall rollup was removed (§B, Deviation 2).
*Default:* accept the growth (~200 bytes/row; ~8 MB/year at 40 staff × 20 events/day) and add a
"clear older than 90 days" button behind `settings.push_edit`.

**Q4. Are the four events in Part F the right starting set?**
`stock.below_reorder`, `service.job_ready`, `inbound.received`, `zoho.pull_partial`.
*Default:* ship these four, then add from what staff say they actually stand around waiting
for. The wiring cost per additional event is one `notify()` call, so starting narrow costs
nothing later.

**Q5. Who receives `zoho.pull_partial`?**
*Default:* everyone holding `zoho.fetch`, resolved at send time so the list follows the grant
rather than drifting. The alternative — a named recipient list on `NotificationConfig` —
duplicates a permission the database already answers.

**Q7. Do `nodemailer` and `@capacitor/push-notifications` get approved?**
Per `AGENTS.md`, every `npm` command is owner-approved. Both are needed before any of Part C or
Part D can be written; `google-services.json` from the Firebase console is needed before push
can be tested at all.
*Default:* approve both. `nodemailer` is the only mature SMTP client for Node, and the Capacitor
plugin is the official one.

### Answer log

| Q | Question | Answer | Decided on |
|---|---|---|---|
| Q1 | Amend the AI plan, or AI as a third tab | | |
| Q2 | Phase-1 grant query — who runs it, what it returns | | |
| Q3 | `NotificationOutbox` retention | | |
| Q4 | The four starting events | | |
| Q5 | `zoho.pull_partial` recipients | | |
| Q6 | Home for personal preferences | | |
| Q7 | Dependency approval | | |
