# Push + email notifications, and the Settings RBAC tidy-up

Status: pending
Branch: **`feat/notifications-and-settings-rbac`** — create it with exactly this name, off `main`.

**Companion documents:**
- `docs/implementation/pending/ai-provider-config-and-task-routing-plan.md` — **no longer
  collides.** Its `settings_ai` child module is the same shape this plan adopts. See §9.
- `docs/agents/database-architect.md`, `docs/agents/integration-architect.md` — consulted for
  Part B and Part D; the deviations from each are named where they occur.

> **Revision, 2 Sep 2026.** Part A originally collapsed `settings_storage` and
> `whatsapp_templates` into section-scoped actions on one `settings` module
> (`storage_edit`, `whatsapp_view`, …). **That approach is abandoned.** It required widening a
> closed union duplicated in four files, rewriting ten guards, and deleting two modules from
> the catalog — and the seeder cascade-deletes the grants of any module it drops. The same
> navigation outcome is available from one nullable field. See §A0 for the finding that
> changed it, and §12 for which questions that closed.
>
> **Second revision, same day. Capacitor is gone.** `android/` and `capacitor.config.ts` are
> deleted; native Android and iOS move to a separate React Native / Expo app that talks to FCM
> directly. This app is now a **pure PWA**. Part D loses its entire native section, finding F4
> is void, and push needs no new dependency at all. See §D.5. Phasing is in §8.

---

## 1. What this changes, in one paragraph

Today the app sends nothing by itself — `src/lib/services/whatsapp.ts` only builds `wa.me`
links a human clicks, and there is no email path anywhere in `src/`. After this plan the app
sends **push** (to the Android app and to desktop browsers, both via FCM) and **email** (via
SMTP, using a Gmail App Password), driven by real events rather than a scheduler, with a
per-event on/off switch for admins and a per-user opt-out for everyone else. In the same
change, the Settings area stops spilling into the sidebar: `settings_storage`, `zoho`,
`whatsapp_templates` and the new `settings_notifications` all become **routeless children of
`settings`**, so the sidebar shows one Settings link and the Settings index page becomes the
only way in. Every module key, every action and every guard is left exactly as it is.

---

## 2. Decisions already taken (owner, 1–2 Sep 2026)

| # | Decision | Consequence |
|---|---|---|
| D1 | **FCM only** for push — app *and* web | One provider. AWS SNS rejected: it cannot reach a browser, and it still needs FCM underneath for Android. |
| D2 | **Event-only. No scheduler.** | Honours the no-cron rule in `CLAUDE.md`. **Accepted loss: nothing will ever report an overdue bill or a stale sync.** |
| D3 | **SMTP now**, own Gmail + App Password | No Google Cloud project needed. Provider kept pluggable so `GMAIL_OAUTH` / `SES` are rows, not migrations. |
| D4 | ~~Full collapse to `settings.storage_edit`-style actions~~ → **superseded 2 Sep.** Keep child modules; hide them with `route: null`. | The cheap option, and also the better one. Zero action-union changes, zero guard rewrites, zero grants destroyed. Itemised in §A0.1. |
| D5 | `zoho` **hidden from the sidebar, key and parent kept** | `route: null`, and `parentKey: "settings"` is **retained** (the first draft dropped it). All 12 guards outside Settings stay untouched, and it still renders indented under Settings in the admin grid. |
| D6 | ~~Migration script for grants~~ → **no longer needed, 2 Sep.** | Nothing is dropped from the catalog, so the seeder's cascade never fires. See §A4. |
| D7 | **One page** at `/settings/notifications` | Push and Email tabs. **AI is not a tab here** — see §9. |
| D8 | **Capacitor deleted; native moves to a separate Expo app** | This repo is a pure PWA. One FCM sender serves the browser and the Expo app alike. Part D.3 becomes a contract, not a build. See §D.5. |
| D9 | **Expo uses FCM directly, not Expo Push** | `getDevicePushTokenAsync()`, not `getExpoPushTokenAsync()`. A second sender would mean a second credential and a second failure mode for no gain. |
| D10 | **Firebase (FCM) is the one provider, and it covers both surfaces** — the web PWA and the Expo app | `PushPlatform` is `WEB | ANDROID`. One project, one service account, one `messages:send` call, one outbox. **iOS is out of scope for now**; no `apns` branch is written. Adding it later is one enum value plus one config block. |
| D11 | **Build the Firebase integration against a placeholder config** | The code path, the screen and the tests ship now; a real service account is pasted in later through the settings screen. See §D.4. |
| D12 | **The `@capacitor/*` packages are removed inside this plan**, not deferred | Phase 1. Nothing imports them. |
| D13 | **Every `notify()` call fires AFTER the transaction commits**, never inside one | Prisma 6 allows an interactive transaction 5 s; an SMTP + FCM round trip inside one rolls the stock write back. Collect inside, send outside. See §F.0. |
| D14 | **The `firebase` npm package is approved** for the web client | It is the only way a browser obtains an *FCM token*; raw `PushManager.subscribe()` yields a W3C subscription that `messages:send` cannot address. Phase 5 is no longer dependency-free. See §D.2. |
| D15 | **Bulk stock writers do not fire `stock.below_reorder`** | `stock-reset` and stock-count approval would cross hundreds of products below the line in one request, and there is no batching or rate cap in this plan. See §F.1. |
| D16 | **The Zoho pull announces the request, not only the failure** | One event became two: `zoho.pull_started` and `zoho.pull_finished`. See §F.4. |

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

## Part A — The Settings RBAC tidy-up

Still first, but no longer the risky half. As rewritten it changes four `route` values, adds
one module, re-parents one — and touches no guard, no action and no existing grant.

### A0. The finding that replaced the collapse

The original Part A existed to solve one problem: **Storage, Integrations and WhatsApp
Templates each appear as their own sidebar entry**, so "Settings" is not really an index of
anything. Collapsing them into actions on a single module was one way to remove those
entries. It is not the cheapest way, and it is not the safest.

`route` is nullable on `Module` (`schema.prisma:29`) and is read in exactly three places:

| Where | Line | Behaviour when `route` is null |
|---|---|---|
| `src/components/app-sidebar.tsx` | `:101` | **A child is skipped** — `if (!m.route) continue;` — and no parent placeholder is built from it. |
| `src/components/app-sidebar.tsx` | `:157` | C3: a *root* is skipped only when routeless **and** childless. `settings` keeps `route: "/settings"`, so it renders as one plain link. |
| `src/app/(dashboard)/more/page.tsx` | `:68` | Same skip. Hidden from the `/more` directory too. |

Two things keep working regardless:

- **`src/app/(dashboard)/settings/page.tsx`** — `ENTRIES` carries a **hardcoded `href`** and
  uses `module` only for the permission test. A routeless module still gets its card.
- **`src/app/api/modules/route.ts`** — returns every `isActive` module regardless of `route`,
  and selects `parentId` *specifically* so the Roles & Permissions grid can indent children
  (`team/permissions/page.tsx` renders `mod.parentId ? "ml-4" : undefined`). A routeless child
  still renders as an indented card in the admin editor.

So `route: null` on the children delivers the whole objective — **one Settings entry in the
sidebar, the Settings index as the only way in** — while the modules, their actions, their
guards and their existing grants all stay exactly where they are.

### A0.1 What the collapse would have cost, for the record

Kept so it is not re-proposed on the grounds that it looked tidier.

| | Routeless children (**chosen**) | Section-scoped actions (rejected) |
|---|---|---|
| Files in the `ActionKey` / `PermAction` union to edit | **0 of 4** | **4 of 4** |
| Guard call sites to rewrite | **0** | 10 |
| Modules deleted from the catalog | **0** | 2 |
| Grants destroyed by the next re-seed | **none** | every custom role holding storage or WhatsApp |
| `prisma/migrate-settings-permissions.ts` | **not written** | mandatory, two-phase, run around the re-seed |
| Admin grid | 4 indented cards, 2–3 boxes each | 1 card, 13+ ungrouped checkboxes |
| Permission label, from `${ACTION_LABELS[action]} ${m.label}` | `"View Storage"` | `"View Storage Settings"` |
| Guard reads as | `requireFeature("settings_storage", "approve")` | `requireFeature("settings", "storage_approve")` |
| Cost of the next settings section | one catalog entry | 2–3 literals × 4 files, forever |

**The union really does live in four files, not three** — the first draft missed one, and it is
the one the client uses:

| File | Symbol |
|---|---|
| `prisma/rbac-catalog.ts:10` | `ActionKey` |
| `src/lib/rbac.ts:20` | `PermAction` |
| `src/stores/permissions.ts:17` | `PermAction` — typed into `can(moduleKey: string, action?: PermAction)` at `:64`, re-exported by `src/lib/use-permissions.ts:15` |
| `src/app/(dashboard)/team/permissions/page.tsx:38` | `ACTION_ORDER` |

Because `can()` is typed, `can("settings", "storage_edit")` would have been a **compile-time
error**, not the silent runtime failure the first draft described. `ACTION_ORDER` is the
genuinely silent one: it sorts with `indexOf`, so an action missing from it gets `-1` and
renders **ahead of `view`**. Both risks disappear by not growing the union.

The one thing the collapse would have done better: the module tree is capped at **exactly two
levels** (`seed-rbac.ts` throws on a grandchild; the sidebar walks two). If Settings ever needs
a sub-sub-section, children cannot express it and actions could. Not worth pre-paying for — a
section that deep becomes its own root module, which is what `store_management` already does.

### A1. The action union does not change

`ActionKey` stays `view | create | edit | delete | approve | fetch`. `ACTION_LABELS` stays as
it is. `PermAction` stays as it is, in both copies. `ACTION_ORDER` stays as it is.

**Nothing in this plan adds an action literal anywhere.** If a later change needs one, it must
be added to all four files in the table above, and in display order in `ACTION_ORDER`.

`settings.view` remains the sidebar gate (`READ_ACTION`, `rbac-catalog.ts:23`, `rbac.ts:25`).
A user granted `settings_notifications.view` but not `settings.view` sees no Settings entry and
cannot reach the index that links to it — the children are routeless, so they build no
placeholder heading of their own (`app-sidebar.tsx:101`). **Every role granted a settings child
must also hold `settings.view`.** This is the same constraint the collapse would have had, and
it is now the only migration-shaped concern in Part A. See §A4.

### A2. Catalog changes (`prisma/rbac-catalog.ts`) — the complete list

Five entries. Three have exactly one field changed, one has two, one is new.

```ts
// 1. settings — UNCHANGED. Its view/create/edit/delete still gate Alerts, Bins and the
//    Label Designer, and `view` is still the sidebar gate.
{ key: "settings", label: "Settings", icon: "Settings",
  route: "/settings", group: "Admin", sortOrder: 520,
  actions: ["view", "create", "edit", "delete"] },

// 2. settings_storage — `route` becomes null. Everything else untouched.
{ key: "settings_storage", label: "Storage", icon: "HardDrive",
  route: null,                    // was "/settings/storage"
  group: "Admin", sortOrder: 521, parentKey: "settings",
  actions: ["view", "edit", "approve"] },

// 3. zoho — `route` becomes null. parentKey KEPT (this is the change from D5's first draft).
{ key: "zoho", label: "Integrations", icon: "Cloud",
  route: null,                    // was "/settings/integrations"
  group: "Admin", sortOrder: 522, parentKey: "settings",
  actions: ["view", "edit", "approve", "fetch"] },

// 4. settings_notifications — NEW.
{ key: "settings_notifications", label: "Notifications", icon: "Bell",
  description: "Email and push delivery — providers, credentials and per-event switches",
  route: null, group: "Admin", sortOrder: 523, parentKey: "settings",
  actions: ["view", "edit"] },

// 5. whatsapp_templates — re-parented under settings, `route` nulled. KEY UNCHANGED.
{ key: "whatsapp_templates", label: "WhatsApp Templates", icon: "MessageSquare",
  route: null,                    // was "/more/whatsapp-templates"
  group: "Admin", sortOrder: 524, parentKey: "settings",
  actions: ["view", "edit"] },
```

Four notes, each load-bearing:

1. **`whatsapp_templates` keeps its key even though `settings_whatsapp` would read better.**
   Renaming drops the old module from the catalog, and `seed-rbac.ts:143-149` deletes any
   module not in it — cascading through `Permission.module` (`schema.prisma:74`,
   `onDelete: Cascade`) into `RolePermission` (`:108`, same). Every existing
   `whatsapp_templates.*` grant would vanish, silently, with ADMIN unaffected so it would look
   fine to whoever tested it. This is the identical argument the catalog already writes above
   the `zoho` entry. The naming inconsistency is cosmetic; the grant loss is not.
2. **`zoho` keeps `parentKey: "settings"`.** The first draft made it a routeless *root*, which
   also hides it, but as a routeless *child* it stays indented under Settings in the admin
   grid. Same sidebar result, better editor.
3. **`group` must equal the parent's** — all five are `"Admin"`. `seed-rbac.ts` asserts it, and
   the sidebar renders the section twice if they differ.
4. **`settings_notifications` gets `view`/`edit`, not `approve`.** `settings_storage` has
   `approve` because repointing every photo in the company is not the same decision as fixing a
   typo in a bucket name. Flipping `pushEnabled` is instantly reversible and low-blast. If the
   master send-switch later deserves a second pair of eyes, adding `approve` to this one module
   is a one-line catalog change — which is the point of this shape.
5. **523 and 524 are the last two free slots in the Settings band.** `store_management` sits at
   540 with children at 541/542, and `rbac-catalog.ts:52` warns that a group whose modules leave
   their band renders split in two. A sixth settings child needs a renumber, not a 543.

### A3. Guard rewrites — there are none

All ten call sites the first draft listed stay exactly as they are:

| File | Line | Guard — unchanged |
|---|---|---|
| `src/app/api/settings/storage/route.ts` | 47 | `requireFeature("settings_storage", "view")` |
| `src/app/api/settings/storage/route.ts` | 77 | `requireFeature("settings_storage", "edit")` |
| `src/app/api/settings/storage/test/route.ts` | 18 | `requireFeature("settings_storage", "edit")` |
| `src/app/api/settings/storage/cors/route.ts` | 22 | `requireFeature("settings_storage", "edit")` |
| `src/app/api/settings/storage/activate/route.ts` | 25 | `requireFeature("settings_storage", "approve")` |
| `src/app/(dashboard)/settings/storage/page.tsx` | 39–40 | `can("settings_storage", "edit" / "approve")` |
| `src/app/api/whatsapp-templates/route.ts` | 48 | `requireFeature("whatsapp_templates", "view")` |
| `src/app/(dashboard)/settings/page.tsx` | 33, 68 | `module: "settings_storage"` / `"whatsapp_templates"` |

The 12 `requireFeature("zoho", …)` / `userCan(…, "zoho", …)` sites across `api/zoho/*`,
`api/sync/clear` and `api/integrations/*` are likewise untouched. *(The first draft said 19;
the real count is 12 guard sites out of 21 total `"zoho"` references. It changes nothing —
none of them move — but the number was wrong.)*

The two prose comments at `src/app/api/settings/storage/route.ts:21` and `:56` name
`settings_storage` and are now **correct as written**. Leave them.

`settings/page.tsx` types `action?: "view" | "edit"` on its `Entry` interface (`:23`). It needs
**no widening** — the one new entry uses `view`.

### A3.1 The one real inconsistency, and it still needs fixing

Independent of the shape decision; survives from the first draft intact.

WhatsApp templates are **read** through `GET /api/whatsapp-templates` gated on
`whatsapp_templates.view` (`:48`), but **written** through `PUT /api/alerts/config` gated on
`settings.edit` (`api/alerts/config/route.ts:22`, which accepts a `whatsappTemplates` body
field). So today a user can hold the WhatsApp module and still not edit templates, while a user
with plain `settings.edit` can edit them without holding the module at all.

**Fix:** split the PUT per field, not per request. The route already builds `updateData`
conditionally, so the guard goes beside each `!== undefined` branch — `whatsappTemplates`
requires `whatsapp_templates.edit`, `redFlagPhones` keeps `settings.edit`.

**The first draft's file list missed the page this breaks.**
`src/app/(dashboard)/more/whatsapp-templates/page.tsx` saves through
`fetch("/api/alerts/config", { method: "PUT" })` at `:77`. It must be included, and while it is
open it needs three `CLAUDE.md` violations fixed that predate this plan:

- `:64` and `:79` — `fetch().then(r => r.json())` from the browser. **Banned.** Use `apiFetch` /
  `apiTry` from `src/lib/api-client.ts`; raw `.json()` on a 307-to-`/login` HTML response
  produces `Unexpected token '<'` and hides an expired session.
- `:84` — a bare `catch { /* */ }`. **Every catch logs before it swallows.**
- No `usePermissions` gating at all. Add `can("whatsapp_templates", "edit")` to disable Save.
  Cosmetic only; the route above is the real gate.

The page keeps living at `/more/whatsapp-templates`. Only its sidebar entry goes; the Settings
index card points at the same URL.

### A4. There is no migration script

The first draft required `prisma/migrate-settings-permissions.ts`, a two-phase snapshot-and-
restore run either side of the re-seed, because dropping two modules from the catalog would
cascade-delete every custom role's grants on them.

**This shape drops nothing.** `seed-rbac.ts:143-149` (stale modules) and `:169` (stale
permissions) compute their `notIn` lists from the catalog, and all five keys above stay in it.
`settings_notifications` is a pure addition. Re-parenting `whatsapp_templates` is an *update* —
the seeder writes `parentId` in both the create and the update branch, so a re-seed performs the
move with no delete. Nulling `route` is an update to the same row.

**Therefore `npm run db:seed:rbac` is safe to run with no preparation, and no grant is lost.**
*(Note the script name — it is `db:seed:rbac`. The first draft said `seed:rbac`, which does not
exist in `package.json`.)*

What the re-seed will do, and nothing else:

```
modules      : 5 touched (1 created, 4 updated — route nulled, one re-parented)
permissions  : 2 created (settings_notifications.view, settings_notifications.edit)
ADMIN role   : 2 new grants
roles        : 0 created, N left untouched (already existed)
```

ADMIN is re-granted every permission by `seed-rbac.ts` §4, so it picks up the two new ones
automatically. No other role gains or loses anything — the seeder is create-only for non-ADMIN
roles by design (`§5`: "an admin who tightened a role in the UI must not have that silently
reverted").

**Two manual follow-ups, because there is nothing to migrate from:**

1. Granting `settings_notifications` to any non-admin role is a manual step at
   Team → Roles & Permissions after the re-seed.
2. Per §A1, any role holding a settings *child* also needs `settings.view`, or the Settings
   entry never appears for them and the child is unreachable. **This is worth checking once
   against live data** — it is a read-only query, and it is the only thing left in Part A that
   depends on what is actually in the database. See Q2.

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

// Two values because FCM v1 takes a different config block per platform (see D.1), and that
// is the only thing push.ts branches on. WEB = the PWA service worker; ANDROID = the separate
// Expo app. Both are FCM tokens sent through one messages:send call.
//
// iOS is OUT OF SCOPE (owner, 2 Sep 2026). Adding it later is one enum value plus one `apns`
// block in push.ts — a trivial migration. Do NOT add it speculatively.
enum PushPlatform { WEB ANDROID }

model PushDevice {
  id         String       @id @default(cuid())
  userId     String
  token      String       @unique          // dedupe key: FCM reissues, never duplicates.
                                          // Browser: getToken({vapidKey}). Expo:
                                          // getDevicePushTokenAsync() - NOT an Expo token.
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

  // No separate @@index([userId]): the composite unique below is already a userId-leading
  // btree, so "this user's preferences" is served by it. PushDevice DOES need its own
  // @@index([userId]) because its unique is on `token`, not on userId.
  @@unique([userId, eventKey])
  @@map("notification_preferences")
}

enum NotificationChannel { PUSH EMAIL }
enum NotificationStatus  { SENT FAILED SKIPPED }

// NOT to be confused with `NotificationLog` (table `notification_logs`, schema.prisma:1912),
// which is the SERVICE module's record of WhatsApp messages a human chose to send. Different
// table, different audience, no collision — but the names are close enough to mislead, so each
// carries a comment pointing at the other (Q10, 2 Sep: keep both, cross-reference them).
//
// Retention: nothing prunes this. There is no cron and none is being added (Q3, 2 Sep: accept
// the growth and keep the rows in the database). ~200 bytes/row, ~8 MB/year at 40 staff x 20
// events/day. No "clear older than N days" button is built in this plan.
model NotificationOutbox {
  id        String              @id @default(cuid())
  eventKey  String
  channel   NotificationChannel
  status    NotificationStatus
  // Deliberately NOT a relation. This is a log that must outlive the user it names — a
  // `User` relation would cascade on delete and quietly erase the delivery history.
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
`settings_notifications.edit`. **Recommend: accept the growth, add the button.**

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

**Capacitor is gone.** `android/` and `capacitor.config.ts` were deleted on 2 Sep 2026. Native
Android and iOS move to a **separate React Native / Expo app**, which talks to Firebase Cloud
Messaging directly. This application is now a **pure PWA**, and that makes Part D substantially
smaller than the first draft — see D.4 for what was removed and why it no longer applies.

One consequence worth stating plainly: **every transport in this plan is FCM v1.** The web push
subscription, the Expo Android token and the Expo iOS token are all sent through the same
`messages:send` call. There is one sender, one credential, one outbox.

### D.1 Server — the only sender

`src/lib/notify/push.ts` — no Firebase Admin SDK. Mint a Google OAuth access token from the
service-account JSON (JWT grant, RS256 via node `crypto`), then
`POST https://fcm.googleapis.com/v1/projects/{id}/messages:send`.
Cache the token in module scope for its ~55-minute life; that cache is safe because it is
derived from the config rather than being the config.

`export const runtime = "nodejs"` on every route that sends — the JWT signing uses node `crypto`
and is not available on Edge.

**Per-platform message blocks.** FCM v1 takes one `token` plus optional `webpush`, `android` and
`apns` config objects, and the right one must be attached or the notification renders wrong (or
silently not at all, on iOS). This is the reason `PushDevice.platform` exists and is the only
thing `push.ts` branches on:

| `platform` | Block attached | Carries |
|---|---|---|
| `WEB` | `webpush` | `notification.icon`, `fcm_options.link` for `notificationclick` |
| `ANDROID` | `android` | `priority`, `notification.channel_id` |

**iOS is out of scope** (D10). No `apns` branch is written. When it is wanted: add `IOS` to the
enum, add an `apns` block here, and upload an APNs key to the Firebase project — nothing else
in this plan changes.

Per `integration-architect.md` rule 6, WhatsApp is fire-and-forget and the app tracks *intent*.
**Push is different and the plan exploits that**: FCM returns a message name on success and a
typed error on failure, so `NotificationOutbox` records a real outcome, not an intention.
`UNREGISTERED` / `INVALID_ARGUMENT` means the token is dead → delete that `PushDevice` row in
the same pass. Without that, dead tokens accumulate forever and every send gets slower.

### D.2 Web — and this is now the whole of push for *this* codebase

`public/sw.js` is 26 lines and handles offline only. Add `push` and `notificationclick`
listeners. Registration already exists at `src/components/sw-register.tsx:8` — extend it to
request permission **on a user gesture, never on mount** (browsers reject an unprompted request
and Chrome penalises the origin), then POST the token to `/api/notifications/devices` with
`platform: "WEB"`.

While that file is open, fix what is already there: `sw-register.tsx:8` ends
`.catch(() => {})` — a bare swallowing catch, the exact `CLAUDE.md` violation this plan fixes
in `more/whatsapp-templates/page.tsx`. Log it.

The token comes from the Firebase JS SDK's `getToken({ vapidKey })`, which wraps the browser's
own Push API subscription and hands back an FCM token — so the server side stays one code path.
That is the reason `NotificationConfig.fcmWebApiKey` and `fcmVapidKey` exist in Part B.

**This costs a dependency, and an earlier draft of this plan said it did not.** `firebase` is
**not** in `package.json` today and is **required** for the web half (D14, approved 2 Sep).
There is no way around it: the raw browser API, `PushManager.subscribe({ applicationServerKey })`,
returns a **W3C push subscription** (`endpoint` + `p256dh` + `auth`), which FCM v1
`messages:send` **cannot address** — that shape needs a Web Push protocol sender instead. Only
the Firebase SDK converts a browser subscription into an **FCM token**, and the FCM token is
what makes "one sender, one credential, one outbox" true.

**One trap when wiring it.** `getToken()` registers its own `/firebase-messaging-sw.js` unless
it is handed a registration, and a second service worker means two `push` handlers and a
duplicated notification. Pass the existing one explicitly:

```ts
const reg = await navigator.serviceWorker.register("/sw.js");
const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: reg });
```

With that, the `push` and `notificationclick` listeners added to `public/sw.js` above are the
only handlers, and no `firebase-messaging-sw.js` file is created.

**This reaches more devices than the first draft assumed.** Installed PWAs on Android Chrome
support the Push API, and iOS Safari 16.4+ supports it for home-screen PWAs. The old claim that
the service-worker path "reaches desktop browsers and not the app" was true only of the
Capacitor WebView, which no longer exists.

The service worker is hand-written and safe to edit: `next-pwa` is in `package.json` but is
**not wired into `next.config.ts`**, so nothing generates or overwrites `public/sw.js`.

### D.3 The Expo app — a separate codebase, the same endpoint

The React Native / Expo app is built and shipped independently of this repository. **Nothing in
this plan builds it.** What this plan owes it is a contract:

1. The Expo app obtains a **native FCM device token** — `getDevicePushTokenAsync()` with
   Firebase configured, *not* `getExpoPushTokenAsync()`. Expo's own push service
   (`exp.host/--/api/v2/push/send`) is deliberately **not** used: it would be a second sender,
   a second credential and a second failure mode for no gain, since the app already has Firebase.
2. It POSTs that token to `POST /api/notifications/devices` — the same route the browser uses —
   with `platform: "ANDROID"`. (No `IOS` — D10.)
3. It authenticates with **the same access code as the web app** — one `User` table, one
   credential. `src/lib/auth.ts` has a single `CredentialsProvider` named "Access Code" with
   exactly one field, and `session.strategy` is `"jwt"`, so the session *is* the cookie: there
   is no server-side session table to be out of step with.

   **The one practical detail (Q11, answered):** the app POSTs the access code to
   `/api/auth/callback/credentials`, captures the `Set-Cookie`
   (`__Secure-next-auth.session-token` over https) and returns it on every later request.
   `middleware.ts` excludes `api/auth` from its matcher, so the login POST is reachable
   unauthenticated, and `withAuth` accepts the cookie on everything after it.

   React Native `fetch` does **not** persist cookies dependably across platforms — the Expo app
   must keep the cookie itself (a cookie store, or setting the `Cookie` header by hand). If it
   silently does not, the symptom is the one `CLAUDE.md` already warns about for the analytics
   agent: the request is redirected to `/login`, which returns **HTML with status 200**, and a
   naive client reads that as success. The device registration route must therefore answer
   JSON-only and the app must check the parsed body, never just the status.

Two things the Expo app must handle on its own side, noted here only so they are not assumed to
be this repo's job: Android 13+ requires the runtime `POST_NOTIFICATIONS` permission (without it
registration succeeds and nothing is ever displayed), and iOS needs an APNs key uploaded to the
Firebase project before FCM can deliver anything.

The server needs **no code change** to serve it. A row in `push_devices` with
`platform: "ANDROID"` is sent exactly like a `WEB` row, with a different config block per D.1.

### D.4 Shipping before Firebase exists — the placeholder config

**Q7, answered 2 Sep: build the integration now, supply the real credentials later.** Nothing
in Parts D or E needs a live Firebase project to be written, reviewed or built — only to be
*sent through*. The plan therefore ships the whole path against a placeholder.

**`docs/examples/fcm-service-account.example.json` — new, committed, and deliberately fake.**
It carries the exact shape Google emits so the parser and the JWT signer can be written and
reviewed against something real-looking:

```json
{
  "type": "service_account",
  "project_id": "REPLACE_ME",
  "private_key_id": "0000000000000000000000000000000000000000",
  "private_key": "-----BEGIN PRIVATE KEY-----
REPLACE_ME
-----END PRIVATE KEY-----
",
  "client_email": "firebase-adminsdk-xxxxx@REPLACE_ME.iam.gserviceaccount.com",
  "client_id": "000000000000000000000",
  "token_uri": "https://oauth2.googleapis.com/token"
}
```

**It is an example file, never a config source.** `src/` must not read it — the real JSON is
pasted into `/settings/notifications` and stored in `NotificationConfig.fcmServiceAccount`,
exactly as S3 credentials are stored in `StorageConfig`. A file under `docs/` that the runtime
imported would be the same mistake as importing `prisma/rbac-catalog.ts` from `src/`.

**How the code behaves with no real credentials**, which is the state it will be in for a while:

- `pushEnabled` and `pushConnected` both default `false`. `notify()` skips the push channel and
  writes a `SKIPPED` outbox row with a reason — it does not error, and it does not block email.
- **Send test push** is enabled but returns a named failure —
  `"FCM is not configured: fcmServiceAccount is empty"` — never a stack trace and never a 500.
- `pushConnected` flips true **only** on a real `messages:send` returning a message name, the
  same rule `StorageConfig.isConnected` follows. Saving the form never sets it.
- Parse the JSON on save and reject a malformed one *then*, with the field named. A bad service
  account discovered at send time is far harder to diagnose.

**Real credentials must never be committed.** The value lives in the database, is masked on read
(§E.1), and the example file above holds nothing usable. `google-services.json` is not needed by
this repository at all — that belongs to the Expo app.

### D.5 What Capacitor removal deleted from this plan

Recorded so none of it is reintroduced by someone reading an older draft.

| Removed | Was |
|---|---|
| `@capacitor/push-notifications` | A dependency in §10 |
| `android/app/google-services.json` | A new uncommitted file; the gradle hook at `android/app/build.gradle` applied it conditionally |
| `npx cap sync android`, rebuild, **reinstall on every device** | Steps 3 of the old D.3 |
| `Capacitor.isNativePlatform()` guards in client code | The branch that served one bundle to both webview and browser |
| The "verify on a real device first" warning | It flagged the native-bridge-into-remote-`server.url` interaction as the one untested part of the plan |
| **Finding F4** | "Android WebView does not implement the Web Push API" — true of the Capacitor webview, irrelevant to a PWA |

The Firebase project is **still required** — for the web VAPID key pair, the service-account JSON
and the FCM sender. What is no longer required is registering an Android app inside it *for this
repository*. The Expo app registers its own.

---

## Part E — Screens

### E.1 `/settings/notifications` — one page, two tabs

Client component, cosmetic gating with `can("settings_notifications", "edit")`, real
gating in the API.

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

**Answered 2 Sep (Q6): it lives as a section on `/more`.** There is no profile page in this app
and this plan does not add one — `/staff-lms/profile` is LMS-only (XP and rank) and
`src/components/header.tsx` has no user menu.

`/more` is the right home for three reasons: every signed-in user already reaches it regardless
of grants, sign-out already lives there, and the page **already opens with a user card**
(`more/page.tsx`, the name + role badge block) that this section sits naturally beneath.

**Where exactly it goes, and why that matters.** `more/page.tsx` renders five blocks in order:
the user card, a grouped menu, the Clear-and-Reset sync box, Sign Out, and the version line.
The new section goes **between the user card and the grouped menu**, as ordinary JSX.

It must NOT be added to the grouped menu, and the reason is worth stating because it is easy to
get wrong:

```tsx
for (const m of modules) {
  if (!m.route) continue;   // <- more/page.tsx
  ...
}
```

That menu is generated from `modules` — the RBAC list of what this user has been granted. Two
things follow. First, to appear there at all, notification preferences would have to **be a
module**, which means having a permission — and the entire point (§E.2 above) is that every
mechanic reaches this **without holding any grant**. Second, a module with `route: null` is
skipped by the line above, so even adding one would render nothing.

So it is plain JSX outside the loop: no module, no permission, no sidebar entry, visible to
everyone who is signed in. Reads and writes `GET`/`PUT /api/notifications/preferences`,
`requireAuth` only, userId from the session, never from the body.

### E.3 Settings index

`ENTRIES` in `settings/page.tsx` gains one card (Notifications → `settings_notifications`/`view`) and
**leaves its two existing module keys alone** — `settings_storage` and `whatsapp_templates` are
still correct. Storage, Integrations and WhatsApp keep their cards, and the index is now the
only route to any of them, which is the point of Part A.

The `Entry` interface needs no change: `action?: "view" | "edit"` already covers the new card,
which uses `view`.

---

## Part F — Event wiring

D2 means every notification is raised by an action someone took. **Five** events, with the
**real** call sites. *(The first draft said "all of which already have a natural call site",
which was true of two of them and optimistic about the rest. It also had four events; Q9 split
the Zoho one in two.)*

| Event key | Fires at | Sites | Default push / email |
|---|---|---|---|
| `stock.below_reorder` | an **outbound** stock write that crosses `reorderLevel` | **3 — see F.1** | on / off |
| `service.job_ready` | `ServiceJob` status → `READY` | **3 — see F.2** | on / off |
| `inbound.delivered` | shipment marked `DELIVERED` | **2 — see F.3** | on / off |
| `zoho.pull_started` | someone triggers a provider pull | **1 — see F.4** | on / off |
| `zoho.pull_finished` | that pull ends — `success` or `partial` | **1 — see F.4** | on / **on** |

`src/lib/notify/index.ts` exposes one entry point:

```ts
notify(eventKey, { recipients, title, body, refId, data })
```

It resolves the global `NotificationEventSetting`, subtracts each user's
`NotificationPreference`, fans out to push and email, and writes one `NotificationOutbox` row
per channel per recipient. **It never throws into its caller** — a failed notification must not
roll back the stock write that triggered it. It logs and records `FAILED`.

Not throwing is necessary but **not sufficient** — see §F.0 for where the call has to sit.

`zoho.pull_finished` defaults email **on** because it is the one event that can report something
already broken, and it is the event most likely to happen while nobody is looking at the screen.

### F.0 Every `notify()` call fires AFTER the transaction commits — never inside one

*(D13, decided 2 Sep 2026.)* This is a rule about **placement**, and getting it wrong breaks the
stock write rather than the notification.

Every site in F.1 mutates `Product.currentStock` inside `prisma.$transaction(async (tx) => …)`
— `api/inventory/outwards/route.ts:70`, `api/deliveries/batch/route.ts:77`, and the rest. Prisma
6 defaults an interactive transaction to **`maxWait` 2 s / `timeout` 5 s**, and none of these
routes override it. A `notify()` inside that block opens an SMTP socket to Gmail and an HTTPS
call to FCM — seconds of network I/O inside a transaction that is allowed five. Two failures
follow, and the first is the serious one:

1. **The transaction times out and the stock write rolls back.** The goods left the shop; the
   database says they did not. The rule *"a failed notification must not roll back the stock
   write"* is then violated by the call's **position**, not by its code.
2. **A sent notification cannot be recalled.** If any later line in the same transaction throws
   — the `inventoryTransaction.create`, an insufficient-stock check on the next item in a batch
   — the database rolls everything back, but the push has already reached forty phones.

**The shape, at every site:**

```ts
const crossings: ReorderCrossing[] = [];

await prisma.$transaction(async (tx) => {
  await tx.product.update({ where: { id }, data: { currentStock: newStock } });
  await tx.inventoryTransaction.create({ /* … */ });
  crossings.push({ productId: id, previousStock, newStock });   // collect only
});                                                              // ← committed here

await maybeNotifyBelowReorder(crossings);                        // then send
```

The transaction stays exactly as fast as it is today, nothing is sent unless the write really
committed, and a notification failure cannot touch stock.

**The same rule applies to every other event in Part F** — `service.job_ready`,
`inbound.delivered` and both Zoho events. Collect inside, send after.

### F.1 `stock.below_reorder` — outbound paths only, and the helper takes a batch

`Product.currentStock` is written in **twelve** places, not the seven the first draft counted.
The extra five were found on 2 Sep and they change the answer to Q8:

```
OUTBOUND — wired in this plan (Q8)
src/app/api/inventory/outwards/route.ts          :72
src/app/api/deliveries/batch/route.ts            :80, :91
src/app/api/deliveries/[id]/route.ts             :212, :224

INBOUND / correction — not wired: stock moves UP, a downward crossing is impossible
src/app/api/inbound/[id]/route.ts                :129, :234
src/app/api/inbound/[id]/status/route.ts         :153
src/app/api/inventory/inwards/verify/route.ts    :38
src/app/api/inventory/cleanup/route.ts           :32   (increment)

BULK — deliberately EXCLUDED (D15)
src/app/api/stock-counts/[id]/route.ts           :244, :276, :358
src/app/api/stock-reset/route.ts                 :39
src/app/api/zoho/pull-review/approve/route.ts    :267
```

**Q8, answered: the three outbound paths, and only those.** They are normal trading — the one
place stock genuinely runs down and somebody needs to reorder. The inbound and cleanup routes
move stock *up*; wiring them buys nothing because they cannot cross the line downward.

**The bulk writers are excluded on purpose.** `stock-reset` sets `currentStock: 0` across
products and a stock-count approval overwrites every short-counted line at once — either would
push hundreds of products below their reorder level in a single request and fan out hundreds of
notifications. **There is no batching, dedupe or rate cap anywhere in Part B or Part F, and this
plan does not add one.** Both are also *corrections*, performed by a person who is already
looking at the screen.

> A stock audit that finds **less** than the book figure is genuinely worth notifying — but as
> its own event, with **one summary message** rather than one per line. That is a separate
> piece of work and it is not in this plan.

`src/lib/notify/stock.ts` exports:

```ts
type ReorderCrossing = { productId: string; previousStock: number; newStock: number };

export async function maybeNotifyBelowReorder(crossings: ReorderCrossing[]): Promise<void>;
```

**A batch, not one product.** The first draft's
`maybeNotifyBelowReorder(productId, previousStock, newStock)` was written for one row;
`deliveries/batch` touches many products in a single transaction, so a per-product signature
means N sequential sends after the commit. Taking the array instead reads every `reorderLevel`
in one `findMany` and fires only the **downward crossings**
(`previousStock > reorderLevel >= newStock`), so a product already below the line does not
re-notify on every subsequent sale. Every site above already holds both numbers — most compute
`previousStock` explicitly for the `InventoryTransaction` row — so the collect step is one line
each.

Per §F.0 the array is filled **inside** the transaction and the call is made **after** it.

### F.2 `service.job_ready` — three sites

```
src/app/api/services/checkoff/route.ts          :12
src/app/api/services/jobs/bulk-status/route.ts  :48
src/app/api/services/jobs/update-status/route.ts:99
```

All three set `READY`. `update-status` is the single-job path and the natural first one; the
other two are bulk paths and should notify **once per job**, not once per batch.

### F.3 There is no `RECEIVED` status — the event key was wrong

`InboundShipmentStatus` is `IN_TRANSIT | DELIVERED | PARTIALLY_DELIVERED`
(`schema.prisma:1407`). The first draft's `inbound.received` names a status that does not
exist. Renamed to **`inbound.delivered`**, fired on the transition to `DELIVERED` at
`api/inbound/[id]/status/route.ts` and `api/inbound/[id]/route.ts`.

Open: whether `PARTIALLY_DELIVERED` should notify too. **Recommended: no** — a partial delivery
is a normal mid-flight state, and the person who set it is standing at the shipment.

### F.4 The Zoho events — announce the request, not only the failure

*(Q9, answered 2 Sep — and widened beyond the question as asked.)* The first draft had a single
event, `zoho.pull_partial`, fired only when a pull half-failed. The owner asked for the
**request itself** to be announced — *"notify them with that action saying that they made a
request to Zoho or the respective provider."* That is two events, not one.

**`zoho.pull_started`** — fired in `api/zoho/trigger-pull/route.ts` at `step === "init"`, right
after the `SyncLog` row is created (`:62` — `syncType: "cron-pull"`, `triggeredBy: "manual"`).
The body names **who** triggered it and **which provider** the step resolved to: Zoho Books,
Zakya POS or Zoho Inventory (`getBooks` / `getZakya` / `getInventory`, `:10-14`).
**Recipients exclude the person who pressed the button** — they are standing at the screen. The
value of this event is that everyone *else* holding the integration knows a sync is running,
which also explains the 409 they get if they try to start their own (`:59`).

**`zoho.pull_finished`** — fired at the finalize step, `:315`, carrying
`status: allErrors.length > 0 ? "partial" : "success"` plus the new-record counts. This
**replaces** `zoho.pull_partial`. One event with the outcome in its body reads better than an
event that exists only when something goes wrong, and it means a clean pull is confirmed rather
than silent. Email defaults **on** for this one.

**Which "partial" — settled.** Two unrelated things in this codebase end in "partial":

| Site | Writes | Chosen? |
|---|---|---|
| `api/zoho/trigger-pull/route.ts:315` | `SyncLog.status = "partial"` — the pull itself completed with errors | **Yes** — nobody is watching it |
| `api/zoho/pull-review/approve/route.ts:459` | `pullLog.status = "PARTIAL"` — some previews approved, others errored | No — a review screen with a human already on it |

**One correction to the owner's recollection, and it matters here.** `api/zoho/trigger-pull` has
**not** been removed — the route is live and still guarded by `requireFeature("zoho", "fetch")`
(`:39`). What *was* removed is its **items and contacts** steps; the header comment reads:
*"ITEMS and CONTACTS are gone. Products no longer come from Zoho at all — the catalog is loaded
by `scripts/import-products.ts`."* The route pulls **bills and invoices only**. Both events above
fire from a bills-and-invoices pull, and nothing in this plan reintroduces an items pull.

Per §F.0, both fire **after** their surrounding write commits.

### F.5 Recipients — there is no reverse resolver yet

`src/lib/rbac.ts` exports `getAccess(userId)` and `userCan(userId, …)`. Both are **forward
only**: given a user, what can they do. Nothing answers *"which users hold permission X"*, and
the answer to Q5 — **everyone holding `zoho.fetch`, resolved at send time** — needs exactly
that. Resolving at send time rather than storing a recipient list means the audience follows the
grant instead of drifting out of date.

Add it to `rbac.ts` beside the others — one query through `role_permissions → permissions →
modules`, filtered to active users:

```ts
export async function usersWithPermission(moduleKey: string, action: PermAction): Promise<string[]>
```

**Not** `cache()`-wrapped like `getAccess`: React's `cache` dedupes per request, which is right
for a permission check made several times in one request and wrong for a recipient list read
once at send time.

Two rules for every caller:

- **Drop the actor from the list.** `zoho.pull_started` in particular must not notify the person
  who pressed the button (§F.4). `notify()` takes the recipient array already filtered; it does
  not know who triggered it.
- **Filter to `isActive` users.** A deactivated account keeps its role and would otherwise keep
  receiving mail.

---

## 8. Phases — what ships in what order

Eight phases. Each one ends at a state where the project type-checks and something is visibly
true in the browser, so any phase can be the last one of a session and none of them leaves the
app half-wired. Phases 1–2 are reversible on their own; from Phase 3 onward each depends on the
one before it.

**Not every phase needs a full `npm run build`** — that command runs `prisma generate && next
build` and requires a live database. Which phases genuinely need it, and what to run instead of
it, is in §11.1. Read that before working through these.

**The order of Phases 4 and 5 depends on Q14** — see the note on Phase 4. The two channels are
independent of each other; only their order relative to one another is in question.

**Nothing is committed to `main`.** Branch `feat/notifications-and-settings-rbac` off `main`
first; every phase is a commit on it.

### Phase 1 — Cleanup and the RBAC tidy-up *(Part A, plus the Capacitor remnants)*

> **Done — 2 Sep 2026, on `feat/notifications-and-settings-rbac`.** Branched from
> `refactor/stock-management-module` at `7b1eff7`, **not from `main`**: `main`'s catalog has no
> `stock_management` tree, and the database is seeded with it, so a branch off `main` would
> re-seed those modules away (finding F2). `tsc --noEmit` 37 s clean, `eslint` clean,
> `npm run build` clean. `db:seed:rbac` ran: 49 modules synced, 180 permissions, ADMIN +2,
> **no stale-removed line**, 7 custom roles untouched. Verified in the database: four routeless
> children under `settings` at 521–524, correct actions, and **zero** non-admin grants on any
> settings child — which answers Q2 empirically. **Owed: the §11 steps 4–6 browser pass** —
> the sidebar, `/more`, the Roles grid and the WhatsApp Templates save have not been opened.

**Two pieces of pure housekeeping in one commit.** Neither contains a line of notification code,
and that is deliberate: if Part A is going to be reverted, it must be discovered before anything
is stacked on it.

**1 — finish the Capacitor removal (Q13).** `android/` and `capacitor.config.ts` were deleted on
2 Sep; three package entries and two documentation lines were left behind.

| Step | State |
|---|---|
| Delete `android/` (60 files, 385 KB) | **done** — backed up outside the repo |
| Delete `capacitor.config.ts` | **done** — it was the only file importing `@capacitor/cli` |
| `npm uninstall @capacitor/android @capacitor/cli @capacitor/core` | **pending** |
| `README.md:35` — drop "**Capacitor** — Android wrapper" | **pending** |
| `docs/dead-code.md:169-173` — delete both rows | **pending** — they claim the packages *"must stay — consumed by the native Android build"*, which is now false |

*(This was Phase 0 in an earlier draft. It was folded in here because it cannot fail on its own
and cannot be verified on its own — nothing in `src/` has ever imported Capacitor, so
`grep -r "@capacitor" src/` returning nothing IS the verification. A phase whose only content is
three uninstalls and two doc lines does not earn a build cycle of its own.)*

**2 — the Settings RBAC tidy-up (Part A).** The Settings area stops spilling into the sidebar.
Four `route` values become `null`, `whatsapp_templates` is re-parented under `settings`, and
`settings_notifications` is added as a new child module with `view`/`edit`. Then
`npm run db:seed:rbac`.

**Also fixes** the pre-existing WhatsApp read/write inconsistency (§A3.1): splits
`PUT /api/alerts/config` so `whatsappTemplates` needs `whatsapp_templates.edit`, and cleans the
three `CLAUDE.md` violations in `more/whatsapp-templates/page.tsx`.

**Verify:** `grep -r "@capacitor" src/` is empty. Then §11 steps 3–6 — sidebar shows one Settings
entry; the admin grid still shows four indented cards; a non-admin custom role can still reach
Storage and WhatsApp from the index. The app still installs to a phone home screen from Chrome.

### Phase 2 — Schema *(Part B)*

**Does:** adds `NotificationConfig`, `PushDevice`, `NotificationEventSetting`,
`NotificationPreference`, `NotificationOutbox`, three enums, and two relations on `User`.
Migration only — **nothing reads or writes these tables yet.**
**Verify:** `prisma generate` succeeds (stop the dev server first — `EPERM`), `npm run build`
passes, tables exist in the database.

### Phase 3 — Config storage and screen *(Part E.1, config route)*

**Does:** `/settings/notifications` with Email and Push tabs, and
`GET`/`PUT /api/notifications/config` behind `requireFeature("settings_notifications", …)`.
Credentials can be saved and read back **masked** — `smtpPassword` and `fcmServiceAccount` never
leave the server, exactly as `api/settings/storage/route.ts:56` does for `secretAccessKey`.
Adds the Settings index card.
**Still sends nothing.** The two test buttons render disabled.
**Verify:** save SMTP and FCM credentials, reload, confirm the password field comes back masked
and not as the real value. Confirm a user without `settings_notifications.view` gets no card and
a 403 from the route.

### Phase 4 — Email *(Part C)*

**Gated on Q14, and Q14 also decides whether this phase runs before or after Phase 5.**
Do not start it until it is known whether the `User.email` values are real, deliverable
addresses. If they are placeholders, everything below builds and sends to nobody, and the
bounces degrade the sending account for the addresses that *are* real.

- **Q14 = the addresses are real** — keep this order. Email first is the right call: a Gmail App
  Password takes five minutes and needs no Google Cloud project, so this is the earliest point
  in the whole plan at which something genuinely leaves the building. Push cannot say the same
  — it needs a Firebase project to exist first (D11).
- **Q14 = they are placeholders** — **swap Phases 4 and 5.** Do push first and let email wait
  until real addresses have been collected on `/team`. Nothing else moves: the two channels do
  not depend on each other, and §F.0's `notify()` already writes a `SKIPPED` outbox row for a
  channel that is not configured rather than failing the other one.

Every other phase is unaffected either way.

**Does:** `npm i nodemailer @types/nodemailer`, `src/lib/notify/email.ts`, and
`POST /api/notifications/test` for email. `export const runtime = "nodejs"` — SMTP is a raw
socket on 587 and Edge cannot open one. The transport is built per call, never cached in module
scope, so a credential change takes effect immediately.
**This is the first thing that actually leaves the building.**
**Verify:** §C.1 — 2-Step Verification on, App Password generated, test email arrives, and
`emailConnected` flips true **only** on a real 250 from Gmail. Confirm the App Password appears
in no log line, no error message and no API response.

### Phase 5 — Push, server and web *(Part D.1, D.2)*

*(Runs before Phase 4 if Q14 comes back "placeholders" — see the note on Phase 4. Nothing in
this phase changes if it does.)*

**Does:** `src/lib/notify/push.ts` (JWT grant → OAuth token → FCM v1 `messages:send`, token
cached ~55 min), `push`/`notificationclick` listeners in `public/sw.js`, permission requested on
a **user gesture** in `sw-register.tsx`, and `POST`/`DELETE /api/notifications/devices`. Dead
tokens (`UNREGISTERED` / `INVALID_ARGUMENT`) delete their `PushDevice` row in the same pass.
**Server side needs no new dependency** — it is `fetch` plus node `crypto`. **The web client does**:
`npm i firebase` (D14). **Web + Android only; no `apns` branch** (D10).
**Ships without a Firebase project** (§D.4): the whole path is written against the placeholder
example file, `pushConnected` stays `false`, and **Send test push** returns a named
"not configured" failure rather than a 500. Real credentials get pasted into the settings screen
whenever they exist.
**Verify, with credentials:** §11 steps 8–9. Test push arrives in a desktop browser *and* on an
installed PWA on a real Android handset. Revoke a device and confirm it stops receiving.
**Verify, without credentials:** the test button reports "FCM is not configured", `notify()`
writes a `SKIPPED` push row, and **email still sends** — a missing push config must not take the
email channel down with it.

### Phase 6 — The `notify()` core *(Part F entry point, no call sites)*

**Does:** `src/lib/notify/index.ts` — resolve `NotificationEventSetting`, subtract each user's
`NotificationPreference`, fan out to both channels, write one `NotificationOutbox` row per
channel per recipient. **It never throws into its caller.** Adds the events table to the
settings screen, and `usersWithPermission()` to `src/lib/rbac.ts` (§F.5) so recipients can be
resolved from a grant.
**Verify:** trigger `notify()` from a test route. Turn an event off and confirm a `SKIPPED`
outbox row rather than a send. Break the SMTP password deliberately and confirm `FAILED` is
recorded and **nothing throws**.

### Phase 7 — Personal preferences *(Part E.2)*

**Does:** the surface where any signed-in user silences their own notifications, writing
`NotificationPreference` for the **session's** userId, gated on `requireAuth` alone — never
`settings.*`, and never taking `userId` from the request body.
**Lives as a section on `/more`** (Q6, answered 2 Sep) — beneath the user card that page already
opens with. Rendered unconditionally, **outside** the granted-modules loop, which skips anything
routeless and would hide it. No new route, no new module, no nav change.
**Verify:** a user holding no `settings.*` grant can reach it and mute one event; confirm they
cannot mute anyone else's by editing the request.

### Phase 8 — Event wiring *(Part F call sites)*

**Does:** the five events fire from real actions. The `maybeNotifyBelowReorder()` batch helper
plus the **three outbound** stock paths (Q8; the bulk writers are excluded per D15),
`service.job_ready` at its three sites, `inbound.delivered` at its two, and `zoho.pull_started` /
`zoho.pull_finished` in `trigger-pull` (Q9). **Every one of them fires after its transaction
commits, never inside it** (§F.0, D13) — this is the part most likely to be got wrong, and
getting it wrong rolls back stock writes rather than losing a notification.
**Verify:** §11 step 12 — trip one real event end to end and confirm the outbox row.

### Deferred, and not this repository's work

The **Expo app** registering its FCM token against `/api/notifications/devices` (§D.3). The
contract is fixed by Phase 5; the client is built elsewhere. Q11 — how a React Native client
authenticates against a NextAuth cookie session — must be answered before that can happen, but
it blocks nothing in Phases 1–8.

---

## 9. AI — deferred, and no longer a collision

The first draft had a blocking conflict here: `ai-provider-config-and-task-routing-plan.md` §8
creates a `settings_ai` **child module** at `/settings/ai` and says it follows `settings_storage`
*"exactly"* — which was the pattern the old D4 abolished. Both plans defined the same RBAC
shape and disagreed.

**Adopting routeless children dissolves it.** `settings_ai` as a child of `settings` with
`view`/`edit`/`approve` **is** the shape this plan now uses. The AI plan's §8 needs no
amendment except the same one-field change every other child gets:

- `route: null` instead of `/settings/ai`
- a Settings index card in `ENTRIES` with a hardcoded `href: "/settings/ai"`

Its three-action split is **kept intact**, including `approve` = "point a task at a different
provider or model" behind an activate route that makes one real call and refuses the switch on
failure. The first draft's §9 proposed reserving only `ai_view` / `ai_edit`, which would have
silently destroyed that split.

**Nothing AI-related is built or reserved in this plan.** No module, no action, no card, no
tab. When the AI plan ships it adds its own catalog entry, exactly as
`settings_notifications` does here. The AI provider and configuration UI can move into this
Settings area later without touching anything built now.

**Q1 is closed.** It was blocking §A1 and §A2 and it no longer is, because neither section
changes an action union any more.

---

## 10. Files touched

**Schema and seed**
- `prisma/schema.prisma` — 5 models, 4 enums, 2 relations on `User`
- `prisma/rbac-catalog.ts` — 4 `route` values nulled, 1 `parentKey` added, 1 new module. **No
  action-union change, no module deleted.**
- ~~`prisma/migrate-settings-permissions.ts`~~ — **not needed.** See §A4.

**RBAC**
- ~~`src/lib/rbac.ts` — `PermAction`~~ — unchanged
- ~~`src/stores/permissions.ts` — `PermAction`~~ — unchanged
- ~~`src/app/(dashboard)/team/permissions/page.tsx` — `ACTION_ORDER`~~ — unchanged
- ~~the 10 guard sites in §A3~~ — unchanged
- `src/lib/rbac.ts` — **add** `usersWithPermission()` (§F.5). This is the only RBAC code change.
- `src/app/api/alerts/config/route.ts` — split `whatsappTemplates` onto
  `whatsapp_templates.edit` (§A3.1)
- `src/app/(dashboard)/more/whatsapp-templates/page.tsx` — `apiFetch`, a logging catch, and
  cosmetic `can()` gating (§A3.1). **Missing from the first draft's list.**

**Notifications**
- `src/lib/notify/{index,email,push,events}.ts` — **new**
- `src/lib/notify/stock.ts` — **new**, the reorder-crossing helper (§F.1)
- `src/app/api/notifications/{config,devices,events,preferences,test}/route.ts` — **new**
- `src/app/(dashboard)/settings/notifications/page.tsx` — **new**
- `src/app/(dashboard)/settings/page.tsx` — **one card added.** The two existing module keys
  stay as they are.
- `public/sw.js`, `src/components/sw-register.tsx` — push listener + registration

**App**
- `package.json` — **add** `nodemailer`, `@types/nodemailer` (Part C) and `firebase` (the web
  client only — D14; the server sender uses `fetch` and node `crypto`). **Remove**
  `@capacitor/android`, `@capacitor/cli`, `@capacitor/core` (see below).

**Capacitor removal — done 2 Sep 2026, ahead of this plan**
- `android/` — **deleted** (60 files, 385 KB). Backed up outside the repo.
- `capacitor.config.ts` — **deleted.** It was the only file importing `@capacitor/cli`; nothing
  in `src/` ever imported Capacitor, so the web build is unaffected.
- `package.json` — the three `@capacitor/*` packages are now unused. **Still present**; removing
  them is a pending follow-up, not a blocker.
- `README.md:35` — drop "**Capacitor** — Android wrapper". **Pending.**
- `docs/dead-code.md:169-173` — it lists the Capacitor packages under *"must stay — consumed by
  the native Android build"*, which is now false. **Pending.**

**Call sites** — the four events in Part F, at the sites named in F.1–F.4.

---

## 11. Verification

1. `npm run build` passes. *(Postgres must be up — three Staff LMS pages are prerendered and
   query Prisma at build time; `CLAUDE.md`.)*
2. Stop the dev server before `prisma generate` — it holds the query engine and fails `EPERM`.
3. `npm run db:seed:rbac` — **note the `db:` prefix**; `seed:rbac` does not exist.
   **What the seeder actually prints** (`seed-rbac.ts:131`, `:165`) is a *synced* count, not a
   created/updated split — `modules : N synced (R root, C child)` and `permissions : N synced`.
   There is no `1 created, 4 updated` line to look for; an earlier draft of this plan asked for
   one that does not exist.
   **The line that matters is the one that must NOT appear.** `modules : N stale removed` and
   `permissions : N stale removed` print only when the count is non-zero. If either appears, a
   key was changed by mistake and role grants have just been cascade-deleted — stop and
   restore. A clean run of this plan prints neither.
4. Log in as a **non-admin custom role** holding `settings_storage.*` or `whatsapp_templates.*`
   and confirm both are still reachable from the Settings index. Testing as ADMIN proves
   nothing — it holds every permission.
5. Sidebar shows **one** Settings entry: no Storage, no Integrations, no WhatsApp Templates
   child rows, and no collapsible chevron. `/more` shows the same.
6. Roles & Permissions still shows Storage, Integrations, Notifications and WhatsApp Templates
   as **indented cards under Settings**. If any renders flush-left, its `parentKey` was lost.
7. Test email arrives; `emailConnected` true only after it does.
8. Test push arrives in a desktop browser.
9. Test push arrives on an **installed PWA on an Android phone** (Chrome → Add to Home Screen).
   This is the path that replaces the old Capacitor webview and it must be checked on a real
   handset, not only on desktop.
10. *(Deferred to the Expo app, not this repo.)* A native FCM token POSTed to
    `/api/notifications/devices` with `platform: "ANDROID"` receives a push. Verifiable from
    this side with a token pasted by hand once the Expo app can produce one.
11. Revoke `settings_storage.approve` from a role → that user can still edit credentials, cannot
    switch the live provider.
12. Trip one real event end to end and confirm the `NotificationOutbox` row.

---

## 11.1 Build economy — what to run, and how often

`AGENTS.md` requires `npm run build` to pass before a change is called done, and that does not
change. What follows is about **not paying for it thirty times inside one phase.**

**What `npm run build` actually costs here.** The script is `prisma generate && next build`, and
it carries two constraints from `CLAUDE.md`:

- **It needs a reachable database.** `/staff-lms/playbooks`, `/staff-lms/product-learning` and
  `/staff-lms/products` are server components that query Prisma and are statically prerendered,
  so the build connects to `DATABASE_URL` and dies with `PrismaClientInitializationError` if
  nothing answers. Postgres must be up.
- **`prisma generate` fails `EPERM` while the dev server is running** — it holds the query
  engine. Stop the dev server first.

**The cheap check that covers most of this plan.** `npx tsc --noEmit` type-checks the whole
project, needs **no database**, and does not care whether the dev server is running.
**Measured 2 Sep 2026: 67 seconds, exit 0 on a clean tree.**

This plan is mostly cross-file signature work — a new helper called from six routes, a widened
`Entry` type, a new module key threaded through guards — and that is exactly the class of error
`tsc` catches. Run it after every edit. Run the full build once, at the end of a phase, before
committing.

**What only `next build` catches, and `tsc` never will:**

- server/client boundary violations — a server-only import pulled into a `"use client"` file, or
  a missing `"use client"` altogether
- route handler export-shape errors, which Next validates with generated types at build time
- a prerendered page that crashes while rendering
- bundler and `next.config.ts` failures

Phases 3 and 7 add new client pages and new route handlers, so they are the two that most need
a real build. The rest are caught by `tsc` long before.

**Per phase:**

| Phase | While working | Before committing |
|---|---|---|
| 1 — cleanup + RBAC | `grep -r "@capacitor" src/` · `npx tsc --noEmit` | full build — `npm uninstall` rewrote `node_modules`, and a truncated install is a known failure mode here (`CLAUDE.md`) |
| 2 — schema | `npm run db:generate` then `npx tsc --noEmit` | full build |
| 3 — config screen + routes | `npx tsc --noEmit` | **full build, non-negotiable** — new client page, new route handlers |
| 4 / 5 — email, push | `npx tsc --noEmit` | full build, then a real send test (§C.1, §11 steps 7–9) |
| 6 — `notify()` core | `npx tsc --noEmit` | full build |
| 7 — personal preferences | `npx tsc --noEmit` | **full build** — new UI on `/more` |
| 8 — event wiring | `npx tsc --noEmit` | full build, then §11 step 12 end to end |

**Two optional changes that would make this cheaper, neither taken yet:**

1. **Add a `typecheck` script** — `"typecheck": "tsc --noEmit"` in `package.json`, so the cheap
   check has a name rather than being remembered. One line; not done, because this plan does not
   touch `package.json` scripts.
2. **Drop the build's database requirement.** Adding `export const dynamic = "force-dynamic"` to
   the three Staff LMS pages would make them render per request and the build would stop needing
   Postgres. `CLAUDE.md` says this is deliberate — their content is baked at build time and only
   changes on redeploy — and that it should be done **only if asked**. It is recorded here as an
   available trade, not as a recommendation.

---

## 12. Questions

Raised 1 Sep 2026, revised 2 Sep after the Part A rewrite. **Nothing in this plan has been
implemented** — no file changed, no dependency installed.

### The findings these questions rest on

| # | Finding | Written up in | Status |
|---|---|---|---|
| F1 | The action union lives in **four** files, not three — the first draft missed `src/stores/permissions.ts:17`, which types `can()`. `ACTION_ORDER` sorts with `indexOf`, so a missing action gets `-1` and renders **ahead of `view`**. | §A0.1 | **Neutralised** — the union no longer changes. |
| F2 | The seeder **cascade-deletes role grants** for any module dropped from the catalog. ADMIN is re-granted everything, so it looks fine to an admin tester and is broken for everyone else. | §A2 note 1, §A4 | **Neutralised** — nothing is dropped. Still the reason `whatsapp_templates` keeps its key. |
| F3 | WhatsApp templates are **read** on `whatsapp_templates.view` but **written** on `settings.edit` via `PUT /api/alerts/config`. | §A3.1 | **Live** — still needs fixing. |
| F4 | ~~Android WebView does not implement the Web Push API.~~ | §D.5 | **Void, 2 Sep.** True of the Capacitor webview, which has been deleted. Installed PWAs on Android Chrome *do* support the Push API. |
| F8 | Nothing in `src/` ever imported Capacitor — the Android app was a webview pointed at `server.url`, and its `webDir: "out"` named a directory that was never built (`next.config.ts` has no `output: "export"`). Deleting it cannot affect the PWA. | §D.5 | **Acted on** — deleted 2 Sep. |
| F5 | `route` is nullable and read in exactly three places, all of which skip a routeless child. `/api/modules` and the Settings index both ignore it. | §A0 | **This is what replaced the collapse.** |
| F6 | There is **no reverse permission resolver** — `rbac.ts` is forward-only. | §F.5 | **Live** — one new function. |
| F7 | `stock.below_reorder` has **no single write site**; `currentStock` is mutated in **12** routes, not the 7 first counted. `inbound.received` names a status that does not exist. `"PARTIAL"` means two different things. | §F.1, §F.3, §F.4 | **Acted on** — Q8 wires 3, D15 excludes the bulk writers, Q9 picks `trigger-pull`. |
| F9 | **Every stock write site sits inside `prisma.$transaction`.** Prisma 6 allows an interactive transaction 5 s by default; an SMTP + FCM round trip inside one **times out and rolls the stock write back**, and a notification already sent cannot be recalled by the rollback. | §F.0 | **Acted on** — D13. Collect inside, send after the commit. |
| F10 | **The web client cannot obtain an FCM token without the `firebase` package**, which is not a dependency today. `PushManager.subscribe()` returns a W3C subscription that `messages:send` cannot address. An earlier draft claimed Phase 5 needed no dependency. | §D.2 | **Acted on** — D14, approved. |
| F11 | **`api/zoho/trigger-pull` was believed deleted. It is not** — the route is live at `requireFeature("zoho", "fetch")`. What was removed from it is the **items and contacts** steps; it pulls bills and invoices only. | §F.4 | **Corrected** — both Zoho events fire from it. |
| F12 | **`User.email` is required and unique but never validated as an address**, and staff sign in with an access code. The addresses may be placeholders, which would make Part C send to nobody and damage the sending account's bounce rate. | Q14 | **Live** — unanswered, blocks Phase 4. |

### Blocking — both answered

**Q6. Where does the personal notification-preferences surface live?** *(Answered 2 Sep:
option (a) — a section on `/more`.)* See §E.2 and Phase 7.

<details><summary>Original question and options</summary>

**Q6. Where does the personal notification-preferences surface live?**
§E.2 assumed a profile page. **There isn't one** — `/more` is a module directory,
`/staff-lms/profile` is LMS-only, and `header.tsx` has no user menu. Every staff member needs to
reach this without holding any `settings.*` grant, so it cannot sit inside
`/settings/notifications`, which is gated on `settings_notifications.view`.
*Options:*
- **(a) A section on `/more`.** Every user already reaches it, sign-out already lives there, and
  the page already opens with a user card the section can sit under. No new route, no new
  module, no nav change. **Recommended.**
- (b) A new `/profile` route with no module, linked from a new user menu in `header.tsx`.
  Cleaner long-term home, but adds a route with no navigation path until the menu is built.
- (c) A "My notifications" tab on `/settings/notifications` that renders for anyone
  authenticated while the other tabs stay permission-gated. Fewest new files; makes one page
  serve two audiences under two different guards.
*Blocks:* Part E.2 and the `/api/notifications/preferences` route.

</details>

**Q7. Dependencies and Firebase credentials.** *(Answered 2 Sep.)*
**`nodemailer` + `@types/nodemailer`: approved.** **Firebase: build against a placeholder now**
— see §D.4. The FCM path ships fully written, `pushConnected` stays `false`, and the real
service-account JSON is pasted into the settings screen whenever the project exists. Push needs
no npm dependency at all.

<details><summary>Original question</summary>

**Q7. Do `nodemailer` and `@types/nodemailer` get approved?**
Needed before any of Part C can be written. **Part D now needs no new dependency at all** — the
FCM sender is a `fetch` call and the JWT is signed with node `crypto`.
*Default:* approve. `nodemailer` is the only mature SMTP client for Node.
A **Firebase project** is still needed before push can be tested — for the web VAPID key pair,
the service-account JSON and the sender id. Registering an Android app inside that project now
belongs to the Expo app, not to this repository.

</details> *(`npm` is no longer gated by `.claude/settings.json` as of 1 Sep,
so these install without a prompt — the approval being asked for here is the dependency itself,
not the command.)*

### Non-blocking — all answered 2 Sep 2026

**Q2. Which roles hold a settings child but not `settings.view`?** *(Answered — no audit needed.)*
**`settings_notifications` is granted to ADMIN only**, and the seeder does that by itself
(`seed-rbac.ts` §4 re-grants every permission to ADMIN). No other role is given a settings child
in this plan, so no role can end up holding a child without `settings.view`, and there is nothing
to query.

The constraint does not disappear, it just has no subject yet: **the day someone grants a
settings child to a custom role** at Team → Roles & Permissions, `settings.view` must be ticked
in the same edit, or that user sees no Settings entry at all and the child is unreachable
(§A1 — children are routeless, so they build no placeholder heading of their own). Worth a line
in the hand-over notes; not worth a migration.

**Q3. `NotificationOutbox` retention.** *(Answered — accept the growth. Keep the rows in the
database.)* Nothing prunes it and nothing will: there is no cron and none is being added. At
~200 bytes a row and ~40 staff × 20 events/day that is ~8 MB/year, which is affordable.
**No "clear older than 90 days" button is built in this plan** — it was offered and not taken.
It stays a one-screen addition behind `settings_notifications.edit` if the table ever becomes a
nuisance. The trade-off is recorded on the model itself in Part B so the next reader sees it
without coming back here.

**Q4. Are the events in Part F the right starting set?** *(Answered — yes, ship them.)*
Now **five**, not four: Q9 split the Zoho event into `zoho.pull_started` and
`zoho.pull_finished`. Add more from what staff actually say they stand around waiting for,
rather than guessing a sixth now.

**Q5. Who receives the Zoho events?** *(Answered — everyone holding `zoho.fetch`, resolved at
send time.)* Resolved from the grant at the moment of sending, via the new
`usersWithPermission()` (§F.5), so the audience follows the permission instead of drifting out of
date the way a stored recipient list would. Two filters at every call site: **drop the actor**
(the person who pressed Pull does not need telling) and **drop inactive users**.

**Q8. How many stock write sites get wired now?** *(Answered — three.)*
The outbound paths only: `inventory/outwards`, `deliveries/batch`, `deliveries/[id]`. The
inbound and cleanup routes move stock *up* and cannot cross the reorder line downward. The bulk
writers — `stock-reset` and stock-count approval — are **deliberately excluded** (D15): each
would push hundreds of products below the line in one request and there is no rate cap. Full
list of all twelve write sites, with the reason for each grouping, in §F.1.

**Q9. Which "partial" fires the Zoho event?** *(Answered — `trigger-pull`, and the event was
split in two.)* `SyncLog.status = "partial"` at `api/zoho/trigger-pull/route.ts:315`, not
`pull-review/approve`'s `PARTIAL` — the review screen already has a human on it. The owner also
asked for the **request itself** to be announced, which added `zoho.pull_started` at the `init`
step. See §F.4, which also corrects the belief that `trigger-pull` had been deleted: the route
is live, and what was removed from it is the **items and contacts** steps.

**Q10. `NotificationLog` already exists.** *(Answered — keep both, cross-reference them.)*
`NotificationLog` (`schema.prisma:1912`, table `notification_logs`) stays the service module's
record of WhatsApp messages a human sent; `NotificationOutbox` (`notification_outbox`) is this
plan's delivery log. Separate tables, separate audiences, no database collision. Each gets a
comment naming the other so the next reader is not left guessing which is which.

**Q11. How does the Expo app authenticate?** *(Answered 2 Sep — same access code as the web.)*
Verified against `src/lib/auth.ts`: one `CredentialsProvider` named "Access Code", one field,
one `User` table, `session.strategy: "jwt"`. The app POSTs the code to
`/api/auth/callback/credentials` and keeps the returned session cookie. Detail and the
HTML-200 trap in §D.3.

<details><summary>Original question</summary>

**Q11. How does the Expo app authenticate against `/api/notifications/devices`?**
The web client is authorised by a NextAuth **session cookie**, and `middleware.ts` redirects any
unauthenticated request to `/login`. A React Native client has no cookie jar by default, so a
plain POST from Expo will be redirected to an HTML login page and — per the warning already in
`CLAUDE.md` about the analytics agent — will look like a **success**, not a failure.
This blocks the Expo side only; Phases 1-8 do not depend on it.
*Options:* (a) the Expo app performs the NextAuth credentials flow and persists the cookie
itself; (b) a short-lived bearer token minted by this app for a signed-in user to hand to the
device; (c) treat device registration as its own shared-key route, like `api/services/earn-sync`.
*Recommendation:* **(a)** — no new auth surface, and the device row is tied to a real session
user, which is what `PushDevice.userId` requires anyway.

</details>

**Q12. iOS?** *(Answered 2 Sep — no. Android and web only.)*
`PushPlatform` is `WEB | ANDROID`. No `apns` branch is written and no APNs key is needed.
Adding iOS later is one enum value, one config block in `push.ts` and an APNs key in Firebase;
nothing else in this plan changes. Recorded as D10.

**Q13. Remove the three `@capacitor/*` packages now, or later?** *(Answered 2 Sep — now, inside
this plan — folded into Phase 1.)*

<details><summary>Original question</summary>

`android/` and `capacitor.config.ts` are deleted. The packages are unused but still in
`package.json`, along with the false claim at `docs/dead-code.md:169-173` that they *"must stay —
consumed by the native Android build"*, and the `README.md:35` line calling Capacitor the Android
wrapper.
*Default:* remove all three plus both doc lines. Nothing imports them, so it cannot break the
build.

</details>

### Still open — one question, and it blocks Phase 4

**Q14. Are the `User.email` values real, deliverable addresses?** *(New, 2 Sep. Nobody has
answered this yet.)*

`User.email` is `String @unique` and **required** (`schema.prisma`), but nothing validates it as
an address: `src/app/api/users/route.ts:104` writes whatever was posted, and there is no
`z.string().email()` anywhere under `src/app/api`. Staff sign in with an **access code**, never
with an email, so the column has never had to be real for anyone to use the system.

If those rows hold placeholders (`ravi@bch.local` and the like) then:

- **Part C cannot work at all.** Every send bounces, `emailConnected` is meaningless, and
  Phase 4 ships a feature with no recipients.
- **§C.2's quota arithmetic is void** — it assumes 40 deliverable addresses.
- **Bounces damage the sending account.** Gmail scores a free account on its bounce rate, so a
  batch of invalid recipients degrades delivery for the addresses that *are* real.

*Answer needed before Phase 4 starts. Phases 0–3 and 5–8 do not depend on it* — push has no
equivalent problem, because a `PushDevice` row can only exist if a real browser registered it.

*If the answer is "no, they are placeholders":* the cheapest fix is to make `email` optional in
practice — collect a real address on `/team` for whoever should receive mail, and have
`notify()` skip any recipient whose address does not resolve, writing a `SKIPPED` outbox row
with a reason rather than attempting a send. That is a small addition to Phase 6, not a
re-plan — but it needs deciding, not discovering at the first send.

### Answer log

| Q | Question | Answer | Decided on |
|---|---|---|---|
| Q1 | Amend the AI plan, or AI as a third tab | **Closed — neither.** Routeless children make the two plans agree; AI is deferred entirely. | 2 Sep 2026 |
| Q2 | Roles holding a settings child without `settings.view` | **No audit needed.** `settings_notifications` goes to **ADMIN only**, which the seeder does itself. Re-opens only when a custom role is first granted a settings child — then `settings.view` must be ticked in the same edit. | 2 Sep 2026 |
| Q3 | `NotificationOutbox` retention | **Accept the growth; keep the rows in the database.** ~8 MB/year. **No clear-older-than button is built** — offered and not taken. | 2 Sep 2026 |
| Q4 | The starting events | **Ship them.** Now **five**, not four — Q9 split the Zoho event in two. | 2 Sep 2026 |
| Q5 | Zoho event recipients | **Everyone holding `zoho.fetch`, resolved at send time** via `usersWithPermission()`. Minus the actor, minus inactive users. | 2 Sep 2026 |
| Q6 | Home for personal preferences | **(a) A section on `/more`**, under the existing user card. | 2 Sep 2026 |
| Q7 | Dependency approval | **`nodemailer` approved.** Firebase built against a placeholder (§D.4); real credentials pasted in later. *(Superseded in part by D14 — the **web client does** need the `firebase` package. The original "push needs no dependency" was true of the server only.)* | 2 Sep 2026 |
| Q8 | How many stock write sites to wire now | **Three — the outbound paths only.** `inventory/outwards`, `deliveries/batch`, `deliveries/[id]`. Inbound cannot cross downward; bulk writers excluded per D15. | 2 Sep 2026 |
| Q9 | Which "partial" | **`trigger-pull`'s `SyncLog.status`** — and the event was **split in two**, `zoho.pull_started` + `zoho.pull_finished`, so the request itself is announced. | 2 Sep 2026 |
| Q10 | `NotificationLog` / `NotificationOutbox` naming | **Keep both, separate.** Different tables, different audiences. Each carries a comment pointing at the other. | 2 Sep 2026 |
| Q11 | Expo auth against `/api/notifications/devices` | **Same access code as the web.** One `CredentialsProvider`, one `User` table, JWT-in-cookie session. | 2 Sep 2026 |
| Q12 | Does the Expo app ship on iOS too | **No. Android + web only.** `PushPlatform` is `WEB \| ANDROID`; no `apns` branch. | 2 Sep 2026 |
| Q13 | Remove the `@capacitor/*` packages now or later | **Now — inside this plan, Phase 1.** | 2 Sep 2026 |
| **Q14** | **Are the `User.email` values real, deliverable addresses?** | **OPEN.** Blocks Phase 4 only. | — |
| B1 | Where does `notify()` sit relative to the transaction | **After the commit, never inside.** Collect crossings in the transaction, send once it has committed. D13, §F.0. | 2 Sep 2026 |
| B2 | The `firebase` package for the web client | **Approved.** D14, §D.2. Server sender still needs no dependency. | 2 Sep 2026 |
| B3 | Do bulk stock writers fire `stock.below_reorder` | **No.** `stock-reset` and stock-count approval are excluded. D15, §F.1. | 2 Sep 2026 |
| — | Capacitor deleted; native moves to Expo + FCM | **Yes, both.** `android/` and `capacitor.config.ts` deleted; Expo uses FCM directly. | 2 Sep 2026 |
