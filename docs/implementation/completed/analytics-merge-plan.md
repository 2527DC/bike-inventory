# Merging `bch-store-analytics` into `bch_management`

**Status:** plan. Nothing implemented yet.
**Prerequisite:** `npm run build` green before phase 1 starts.
**Precedent:** this follows the shape of [`service-merge-plan.md`](./service-merge-plan.md) —
the `bch-service` merge. Roughly one third the size.

---

## 0. Decisions taken

These override anything below that contradicts them.

| # | Question | Decision |
|---|---|---|
| 1 | Live pilot data | **None.** The analytics Postgres holds nothing worth keeping. Phase 1 is a clean `prisma migrate` — **no baseline, no data-copy phase.** |
| 2 | `storeId` representation | **Map onto the `StockLocation` enum.** No `Store` table. `storeId` is typed `StockLocation`, not `String`. |
| 3 | Bill count source | **Both, shown separately.** Counter bills from `PosSession.invoiceCount` and total invoices from `CustomerInvoice`, as two distinct tiles. No blending, no guessing. |
| 4 | Device API keys | **`AnalyticsDevice` table, sha-256 hashed.** Managed from `/analytics/devices`. `STORE_KEYS` env JSON is not ported. |

### Consequences

- **No data-migration phase**, exactly as in the service merge. §3.4's warning about reading the
  generated SQL before applying still holds, but there is nothing to preserve if it goes wrong.
- **`storeId` becomes an enum column**, not text. This is only free *because* there is no live
  data — with rows already written as `'store-1'` it would need a backfill. The models in §3.1
  are written accordingly.
- **The pilot's `store-1` identifier disappears.** The agent still sends `store_id` in its body,
  and the ingest route still ignores it — the store comes from the authenticated key
  (`DAT-002`). That existing behaviour is what makes the enum switch invisible to the agent.
- **Two bill tiles means conversion stays plural.** "Visitors per counter bill" is the headline;
  total invoices sits beside it. Neither is labelled "conversion" (§7.4).
- **Q1, Q2, Q3 and Q5 in §9 are closed.** Four questions remain open; none blocks phase 1.

---

## 1. What this merge is

Fold the **cloud half** of the store-analytics pilot (`F:\bharath  Cycle\bch-store-analytics`)
into the inventory app so there is:

- **one database** — analytics tables become Prisma models, no second `pg.Pool`
- **one login** — the analytics password + HMAC cookie is deleted; NextAuth + RBAC governs it
- **one sidebar** — footfall appears as an `analytics` module under **Insights**
- **one deploy** — no second Vercel project to keep alive

The **edge half stays out**. `agent/` is Python running on the store laptop; it is device
software, not app code. See §8 for why that is not negotiable.

### Measured size of what moves

| | Count | Lines |
|---|---:|---:|
| Pages (dashboard + login + layout) | 3 | 155 |
| API routes | 4 | 132 |
| Lib files | 4 | 473 |
| `proxy.js` | 1 | 46 |
| **Total source moving** | | **~700** |
| Prisma models to add | 2–4 | — |
| Docs to carry across | 18 | — |
| *Agent — NOT merged* | *13 files* | *2,444* |

---

## 2. Three findings that shape the whole plan

### 2.1 The analytics app creates its own tables at runtime

`bch-store-analytics/lib/db.js` holds a `SCHEMA` constant and runs it through
`ensureSchema()` on the first query of every cold start:

```js
async function ensureSchema() {
  if (!schemaReady) schemaReady = getPool().query(SCHEMA);   // CREATE TABLE IF NOT EXISTS ...
  await schemaReady;
}
```

In a Prisma repo this is a landmine. The tables exist in Postgres but not in `schema.prisma`,
so the next `prisma migrate dev` sees three unmanaged tables and offers to **drop them**.
Someone accepts that prompt at 11pm and the pilot's history is gone.

**Consequence:** `lib/db.js` is deleted outright, not ported. Every table it creates becomes a
Prisma model in phase 1, and `pg` leaves the dependency tree.

### 2.2 The middleware matcher will silently block the edge agent

`src/middleware.ts:13` protects everything except a fixed list:

```
"/((?!login|fill|api/auth|api/public|_next/static|_next/image|.*\\.(?:svg|png|...)).*)"
```

`/api/analytics/counts` is not on that list, so `withAuth` intercepts the agent's POST and
returns a redirect to `/login`. The agent treats any non-2xx as retryable
(`counter.py` → `pusher()`), so it backs off to a 300-second ceiling and **keeps the events
queued in `buffer.db`**. Nothing errors loudly. Three days later `purger()` starts deleting
acked rows and the dashboard just shows fewer people than walked in.

This is the same class of bug `CLAUDE.md` already warns about under *"Routes that must stay
public"* — *"it has already happened once."*

**While you are in that file, verify two related things:**

- `/api/cron/*` is listed in `CLAUDE.md` as needing to stay public, but it is **not** in the
  matcher's negative lookahead either. `zoho-pull`, `overdue-alerts` and `invoice-pull` may
  already be failing in production.
- `CRON_SECRET` does not appear in `.env`. `overdue-alerts` returns 500 without it.

Neither is caused by this merge, but the analytics watchdog cron walks into both.

### 2.3 The TRD explicitly says "NOT Vercel serverless"

`docs/pilot/TRD.md:30` specifies the cloud tier as *"small always-on service — Railway /
Render / Fly / VPS, **NOT Vercel serverless**"*. The inventory app is on Vercel
(`vercel.json`, region `bom1`). The merge contradicts that spec line, so state why it is now
acceptable rather than ignoring it:

| Original objection | Status after merge |
|---|---|
| No durable store — in-memory state dies on cold start | Resolved. Postgres via Prisma, same instance as inventory. |
| Cold-start latency on ingest | Acceptable. Ingest is a fire-and-forget batch POST with backoff; the agent does not care about p99. |
| Needs an always-on watchdog for heartbeat gaps | **Open.** Vercel Cron is the mechanism, and cron granularity is a plan question — see Q6 in §9. |

The one genuinely unresolved item is the watchdog. A heartbeat-gap alert that fires once a day
is not an alert, it is a postmortem.

---

## 3. Schema merge

Both sides are Postgres. There is **no table-name collision** — `count_events`, `heartbeats`
and `invoices` do not exist in the inventory schema. The conflicts are conceptual.

| Analytics table | Action | Notes |
|---|---|---|
| `count_events` | **port** | Becomes `CountEvent`, `@@map("count_events")`. |
| `heartbeats` | **port** | Becomes `AgentHeartbeat`, `@@map("heartbeats")`. |
| `invoices` | **drop** | Stub for a Zoho connector this app already owns. See §3.2. |

### 3.1 The two models to add

```prisma
// Footfall events pushed by the store edge agent. One row = one confirmed line crossing.
// `id` is the agent's own UUID and is the idempotency key (DAT-001): the agent retries a
// batch until acked, so the same event arrives more than once by design.
model CountEvent {
  id            String        @id              // NOT @default(cuid()) — supplied by the agent
  storeId       StockLocation                  // decision 2 — enum, not text
  entranceId    String    @default("main")
  adapter       String    @default("RTSP_CV")
  direction     String                          // "in" | "out"
  eventTs       DateTime                        // when the crossing happened
  receivedTs    DateTime  @default(now())
  businessDate  DateTime  @db.Date              // store-local, computed on ingest (DAT-004)
  count         Int       @default(1)
  trackId       String?
  confidence    Float?
  agentVersion  String?
  configVersion String?
  quality       String    @default("ok")

  @@index([storeId, businessDate])
  @@map("count_events")
}

// Agent liveness. Kept as a series, not one current value — the gap IS the alert, and
// distinct heartbeat-minutes per day is what data-coverage % is computed from (DAT-005).
model AgentHeartbeat {
  id            BigInt        @id @default(autoincrement())
  storeId       StockLocation
  agentId       String
  ts            DateTime  @default(now())
  businessDate  DateTime  @db.Date
  queueDepth    Int?
  cameraOk      Boolean?
  lastFrameTs   DateTime?
  agentVersion  String?

  @@index([storeId, ts(sort: Desc)])
  @@index([storeId, businessDate])
  @@map("heartbeats")
}
```

Two details that are easy to get wrong and expensive to fix later:

- **`id` must not be `@default(cuid())`.** The idempotency guarantee is that the *agent* names
  the row. Let Prisma generate it and every retry becomes a new person walking through the door.
- **`businessDate` is `@db.Date`, not `DateTime`.** `lib/time.js` computes it in
  `Asia/Kolkata` precisely because Vercel runs UTC and `toISOString().slice(0,10)` is wrong for
  every event after 18:30 UTC. Storing it as a timestamp reintroduces the timezone bug the
  column exists to remove.

Per decision 2, `storeId` is `StockLocation`. Only `BCH_STORE` and `BCC_STORE` are meaningful
values — the two warehouse values have no doorway to count and the two legacy values
(`STORE`, `WAREHOUSE`) are dead. Nothing in the schema enforces that subset, so the
`AnalyticsDevice` admin screen should offer only the two store values in its picker.

### 3.2 Dropping `invoices` — the point of the whole merge

`bch-store-analytics/README.md` TODO #2:

> **Zoho POS** — add a poller that pulls invoices → `addInvoices()` (OAuth refresh token).
> Currently `bought` = 0 until wired.

That poller already exists in this app. `PosSession.invoiceCount`, `DailySettlement`,
`CustomerInvoice`, `/api/cron/invoice-pull` and `/api/cron/zoho-pull` are live. So:

- delete the `invoices` table and `addInvoices()` from `lib/store.js`
- `dashboard()` reads bill counts for a business date from the existing POS models

Per decision 3, it returns **both counts, separately** — they measure different things and
blending them produces a plausible wrong number:

| Field | Source | Means |
|---|---|---|
| `counterBills` | `PosSession.invoiceCount` for the session date | Sales rung up at the counter — the ones a person walking through the door produces |
| `totalInvoices` | `CustomerInvoice` rows for the date | All invoicing including credit sales and business that never walked in |

`counterBills` is the one that pairs with footfall. `totalInvoices` sits beside it as context.
The dashboard labels them distinctly and never adds them together.

**Date semantics, settled in phase 3.** `PosSession.sessionDate` and `CustomerInvoice.invoiceDate`
are plain `DateTime` columns that the rest of the app anchors at **UTC midnight** as a calendar
date — `api/pos/settlement/route.ts` writes `new Date(date + "T00:00:00Z")` and
`api/cron/invoice-pull` writes `new Date(inv.date)` on a Zoho `"YYYY-MM-DD"`. A few rows carry a
real timestamp instead (`api/deliveries/route.ts` writes `new Date()`), so the join uses a
half-open `[gte, lt)` full-day range, which is correct for both shapes where an equality test on
UTC midnight would silently miss every timestamped row. See `calendarDayRange()` in
`src/lib/analytics/time.ts`.

### ⚠ 3.2a The bills are NOT store-scoped

Found while implementing phase 3, and it qualifies decision 3.

**Neither `PosSession` nor `CustomerInvoice` has a store column.** The only
`storeId StockLocation` columns in the whole schema are the four analytics models added in
phase 1. So a bill cannot be attributed to a store at all — the counts are estate-wide.

While exactly one store is counted this is harmless: every bill belongs to the one store whose
door is being watched. The moment a second store gets a camera, dividing store A's footfall by
every store's bills is precisely the un-auditable number this project exists to avoid.

`dashboard()` therefore checks how many distinct stores have an active `AnalyticsDevice` and,
if more than one, returns `counter_bills` and `total_invoices` as **null** with
`bills_unavailable_reason` set, rather than returning a wrong number. `bills_store_scoped` is
`false` in every response so no client can mistake the scope.

Fixing this properly means adding a store column to the POS models and backfilling it — a
schema change on live financial tables, well outside this merge. It should be its own piece of
work, and it is a **hard prerequisite for counting a second store**.

### 3.3 Two additions worth making at the same time

**`AnalyticsDevice`** — replaces the `STORE_KEYS` env JSON. Confirmed by decision 4.

```prisma
model AnalyticsDevice {
  id         String        @id @default(cuid())
  storeId    StockLocation
  agentId    String    @default("edge-1")
  label      String
  keyHash    String    @unique     // sha-256 of the API key. The key itself is shown once.
  isActive   Boolean   @default(true)
  lastSeenAt DateTime?
  createdAt  DateTime  @default(now())

  @@index([isActive])
  @@map("analytics_devices")
}
```

The architecture rule in `CLAUDE.md` is *"access control is DATA, not code."* A JSON blob in an
env var means rotating a camera key is a redeploy, and it means the key sits in plaintext in
the Vercel dashboard. Hashing also removes the `timingSafeEqual` loop over every configured key
in `lib/auth.js` — a hash lookup is one indexed query.

**`FootfallDaily`** — rollup, so the dashboard stops scanning raw events.

```prisma
model FootfallDaily {
  id              String        @id @default(cuid())
  storeId         StockLocation
  businessDate    DateTime @db.Date
  inCount         Int      @default(0)
  outCount        Int      @default(0)
  observedMinutes Int      @default(0)
  counterBills    Int?                        // snapshotted from POS at rollup time
  totalInvoices   Int?                        // decision 3 — kept separate, never summed
  computedAt      DateTime @default(now())

  @@unique([storeId, businessDate])
  @@map("footfall_daily")
}
```

`count_events` grows at roughly one row per person per direction, forever, and the current
`dashboard()` does a `GROUP BY` over raw events on every 15-second poll. Past days should read
the rollup; only today aggregates live.

### 3.4 Migration mechanics — use `db push`, NOT `migrate`

**This repo has no `prisma/migrations/` folder.** `docs/agents/database-architect.md` records the
practice: *"Prisma (schema-first, `prisma db push` for schema sync — no formal migrations
folder)."*

That makes `prisma migrate dev` actively dangerous here. Run against a database that has never
been under migration control, it finds no `_prisma_migrations` table, reports drift, and offers
to **reset the database** — which would drop every inventory table in the app. Do not run it.
An earlier draft of this document recommended it; that was wrong.

The correct sequence:

```bash
npx prisma validate                 # schema parses
npx prisma format                   # canonical formatting
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel  prisma/schema.prisma \
  --script                          # PREVIEW the SQL — applies nothing
npm run db:push                     # apply
npm run db:generate                 # regenerate the client
```

`migrate diff` is read-only. It is the safe way to see exactly what `db push` will do before
letting it do it, which is what the "read the SQL first" instruction was really asking for.

Per decision 1 there is no live analytics data, so this is a pure additive create — four new
tables, no existing table touched. Confirm that in the diff output: **if the preview contains
`DROP` or `ALTER … DROP COLUMN` against any existing table, stop.** Additive-only is the whole
safety property here.

Note `prisma generate` fails with `EPERM` while the dev server is running (`CLAUDE.md`,
"Environment gotchas") — stop it first.

Adopting formal migrations is worth doing eventually, but it is a repo-wide change that must not
ride along with a feature merge.

---

## 4. RBAC — ✅ DONE

One new module, seeded in `prisma/rbac-catalog.ts` under `Insights`:

```ts
{
  key: "analytics",
  label: "Store Analytics",
  description: "Entrance footfall, counter health and the bills join",
  icon: "Activity",
  route: null,             // → "/analytics" in phase 5, see below
  group: "Insights",
  sortOrder: 410,          // sits after reports (400)
  actions: ["view", "edit"],
},
```

Three things the implementation turned up that the original draft of this section missed:

**`route` must be `null` until the page exists.** `src/components/app-sidebar.tsx:36` does
`if (!m.route) continue;`, so a module with no route is granted but hidden. Seeding
`"/analytics"` before phase 5 puts a link in everyone's sidebar that 404s. This is the same
call the service modules already made — see the comment above `service_jobs` in the catalog.
Flip it to `"/analytics"` and re-seed when the screen ships; that one line is the whole change.

**A new icon name needs a line in `src/lib/module-icons.ts`.** The DB stores an icon *name*
and `moduleIcon()` resolves it through an explicit `ICONS` map. An unknown name does not
crash — it silently falls back to `Package`, so the only symptom is a box icon on a footfall
dashboard. `Activity` was added to both the import and the map.

**The seed cannot grant to existing roles.** `seed-rbac.ts` §5 is create-only by design:
*"an admin who tightened or widened a role in the UI must not have that silently reverted."*
Only ADMIN receives new permissions automatically (§4 of the seed). Granting `analytics.view`
to any other role is a deliberate act in `/team/permissions`, not something a re-seed does.

- `view` — see the dashboard.
- `edit` — manage `AnalyticsDevice` rows (issue/revoke a camera key, set opening hours).
  Deliberately narrower than `view`; a shop assistant seeing footfall should not be able to
  mint a device key.

**No new role.** The `SERVICE_*` sprawl noted in `service-merge-plan.md` §7.3 is a warning, not
a pattern to repeat.

**Q4 answered itself.** The rule was "grant `analytics.view` to whoever already holds
`reports.view`". Queried against the database, that set is **ADMIN alone** — every other role
(`MANAGER`, which currently holds zero permissions, and the six `SERVICE_*` roles) has no
reports grant. ADMIN receives every permission from the seed automatically, so **no additional
grant work was needed**. Revisit when real staff roles are created.

### ⚠ Running the seed against production resets the admin login

`seed-rbac.ts` §6 upserts the admin user with
`update: { name, roleId, accessCode, password, isActive: true }`, sourced from
`ADMIN_ACCESS_CODE` (default `ADMIN123`). That variable is **not in `.env`**. So
`npm run db:seed:rbac` against production would silently reset the administrator's access code
to `ADMIN123` — a working credential, published in this repo, on a live system.

Locally this was a no-op because the dev admin already sits at the defaults. For the phase 8
deploy, either export the real `ADMIN_ACCESS_CODE` first, or run only the module/permission
sync. This is a pre-existing hazard in the seed, not something this merge introduced, but the
merge is what makes someone run the seed on production.

**The ingest routes take no module guard.** They are machine-authenticated with an API key and
no user exists — exactly like `/api/services/earn-sync` in the public-routes list. Guarding them
with `requireFeature` would break them; leaving them unauthenticated would be worse. They use
`authDevice()` and nothing else.

---

## 5. Route mapping

| bch-store-analytics | bch_management | Guard |
|---|---|---|
| `/` (dashboard) | `/analytics` | `requireFeature("analytics","view")` |
| `/login` | **deleted** | — |
| `POST /api/auth/login` | **deleted** | — |
| `POST /api/v1/counts` | `POST /api/analytics/counts` | `authDevice()` |
| `POST /api/v1/heartbeat` | `POST /api/analytics/heartbeat` | `authDevice()` |
| `GET /api/v1/dashboard` | `GET /api/analytics/dashboard` | session + `analytics.view` |
| — | `GET /api/cron/counter-watchdog` | `CRON_SECRET` bearer |
| — | `/analytics/devices` | `requireFeature("analytics","edit")` |

### Keep `/api/v1/*` as aliases

`CLOUD_URL` is baked into `.env` on the store laptop. Changing the path means someone drives to
the store, or the agent quietly buffers until `BUFFER_PURGE_DAYS` eats the backlog. Keep
`/api/v1/counts` and `/api/v1/heartbeat` as thin re-exports of the new handlers, and retire them
only after every deployed agent is confirmed on a new `CLOUD_URL`.

### Folder structure after merge

```
src/app/(dashboard)/analytics/          page.tsx, devices/page.tsx
src/app/api/analytics/                  counts, heartbeat, dashboard, devices
src/app/api/v1/                         counts, heartbeat  — aliases only
src/app/api/cron/counter-watchdog/      heartbeat-gap alert
src/lib/analytics/                      store.ts, time.ts, device-auth.ts
docs/analytics/                         the 18 pilot docs, moved verbatim
```

**Not carried over:** `lib/db.js` (Prisma replaces it), the human half of `lib/auth.js`
(NextAuth replaces it), `app/layout.js` (the dashboard layout provides it), `proxy.js` (folded
into `src/middleware.ts`).

### Dependency deltas to resolve during the port

| Concern | analytics | bch_management | Resolution |
|---|---|---|---|
| DB access | `pg` + raw SQL | Prisma | Port to Prisma; drop `pg` |
| Language | plain JS | strict TS | Port ~700 lines to TS |
| Styling | inline style objects, `#0f1211` dark | Tailwind v4 + design-system | Restyle |
| Human auth | HMAC cookie + shared password | NextAuth JWT + RBAC | Delete the analytics half |
| Validation | hand-rolled in `addCounts` | `zod` | Add a schema for the ingest body |
| Next convention | `proxy.js` (Next 16) | `src/middleware.ts` | Keep `middleware.ts` |
| Versions | next ^16.2.11 / react 19.0.0 | next 16.2.3 / react 19.2.4 | Host wins |

---

## 6. Phases

| # | Phase | Depends on | Size |
|---|---|---|---|
| 0 | Resolve blocking decisions | — | ✅ **done** (§0) |
| 1 | Add Prisma models; `db push`; `generate` | 0 | ✅ **done** |
| 2 | Seed the `analytics` module + grants | 1 | ✅ **done** (§4) |
| 3 | Port `lib/` to TS on Prisma; delete `lib/db.js` + human auth | 2 | ✅ **done** (§6.3) |
| 4 | Port ingest routes; **fix the middleware matcher**; add `/api/v1` aliases | 3 | ✅ **done** (§6.4) |
| 5 | Port the dashboard page; restyle to BCH OPS | 4 | ✅ **done** (§6.5) |
| 6 | Device-key admin screen + `AnalyticsDevice` cutover | 5 | ✅ **done** (§6.6) |
| 7 | Watchdog cron + rollup cron | 5 | ✅ **done** (§6.7) |
| 8 | Repoint the agent's `CLOUD_URL`; verify end-to-end; retire the old deploy | 4–7 | medium |

### Phase 3 detail — what landed

Three files under `src/lib/analytics/`, 25/25 assertions green against the local database
(device auth accept/reject/revoked, ingest validation, idempotent retry, the heartbeat
transaction, and the dashboard aggregation):

| File | Notes |
|---|---|
| `time.ts` | Port of `lib/time.js` plus `toDateColumn` / `fromDateColumn` / `calendarDayRange` for the `@db.Date` round-trip. |
| `device-auth.ts` | Device half of `lib/auth.js`, now backed by `AnalyticsDevice` + sha-256. Adds `generateDeviceKey()` for phase 6. |
| `store.ts` | `addCounts`, `beat`, `dashboard`. `addInvoices` deleted. |

**Not ported, as planned:** `lib/db.js` (Prisma owns the schema), the human half of
`lib/auth.js` (NextAuth owns login), and the `memory-volatile` fallback — that mode cannot
occur here, so the `storage` / `durable` fields are now constants kept only so the wire
contract does not change.

Deviations worth knowing:

- **`authDevice` is now async** — it hits the database. Every call site must `await` it.
- **The timing-safe key loop is gone.** Lookup is a single unique-index match on the hash;
  what is compared is a digest, not the secret. A first draft kept a `timingSafeEqual` check
  after the lookup, which could only ever return true — dead code, removed.
- **In-batch duplicates are deduped, not rejected.** `addCounts` keys valid rows by `id` before
  `createMany`, so a batch carrying the same event twice inserts once regardless of how
  Postgres resolves two conflicting rows inside one statement. A retry is not an error.
- **`IngestResult` returns `{ submitted, accepted, rejected }`**, not the pilot's
  `{ accepted, duplicates }` — `createMany` reports only a total. `submitted - accepted` is the
  duplicate count. Rejections keep their reasons.
- **`time.ts` overlaps `src/lib/services/timezone.ts`**, which also knows "today in IST" but
  nothing else. Folding both into one shared IST module is a real follow-up; doing it inside
  this merge would mean editing the workshop module as a side effect.

### Phase 4 detail — the ingest port

Each handler:

1. keeps `authDevice()`, now resolving the store from a hashed `AnalyticsDevice` row
2. gains a zod schema for the event array
3. returns via `successResponse` / `errorResponse`
4. **replaces the per-event INSERT loop with a single `createMany({ skipDuplicates: true })`**

That last point is not cosmetic. `addCounts` currently awaits one round-trip per event:

```js
for (const v of valid) {
  const r = await query(`INSERT INTO count_events ... ON CONFLICT (id) DO NOTHING`, [...]);
}
```

The route accepts batches up to 1000. After an overnight outage the agent pushes 200 at a time
(`push_once()` → `LIMIT 200`), so that is 200 sequential round-trips through the Supabase pooler,
per batch, while the store is opening. `createMany` with `skipDuplicates` preserves the
idempotency semantics in one statement.

The one thing it loses is the `accepted` / `duplicates` split, since `createMany` returns only a
total. That split is reported to the agent today but not acted on. Return
`{ accepted: count, submitted: valid.length }` instead and keep the rejection reasons — those
matter (DAT-002 requires rejections be reported, not swallowed).

### Phase 4 detail — what landed, and the proof

Five routes, one shared handler module, one middleware change. Verified against a running dev
server: **11/11 HTTP assertions, 10/10 database assertions.**

| Path | Auth | Notes |
|---|---|---|
| `POST /api/analytics/counts` | device key | canonical |
| `POST /api/analytics/heartbeat` | device key | canonical |
| `POST /api/v1/counts` | device key | alias, same handler |
| `POST /api/v1/heartbeat` | device key | alias, same handler |
| `GET /api/analytics/dashboard` | session + `analytics.view` | human endpoint |

Both ingest paths mount the *same* function from `src/lib/analytics/ingest-handlers.ts`, so
the alias can never drift from the route it aliases. The route files contain no logic.

**The matcher assertion passed, and the negative control proved it mattered.** Unauthenticated
POSTs to all four device paths now return `401 {"error":"missing x-api-key"}` **from the
handler**. Meanwhile `GET /api/analytics/dashboard` without a session returned **307** — that
route's own `requireFeature` guard never ran, because middleware answered first. That 307 is
exactly what the ingest routes would have returned, and exactly what the agent would have
followed to a 200 login page before deleting unsaved events.

Also confirmed in the database: an event carrying `"store_id":"BCC_STORE"` in its body was
stored as `BCH_STORE`. The store comes from the key (DAT-002), not the payload.

Two decisions worth recording:

- **Every excluded path is listed in full** in the matcher — `api/analytics/counts`, not
  `api/analytics`. A prefix would work today and would silently make every future route
  beneath it public, including `/api/analytics/dashboard`, which is business data.
- **Zod validates the envelope only** (`countEventBatchSchema`, `heartbeatSchema` in
  `src/lib/validations.ts`). Per-event validation stays in `store.ts` because DAT-002 requires
  each bad event to be reported with a reason. A schema over the item shape would reject the
  whole batch — throwing away 199 good crossings because the 200th had a bad timestamp — and
  the agent cannot repair a rejected event, so it would retry the same batch forever.

### ⚠ Environment gotcha found during phase 4

**Killing `next dev` mid-write corrupts `.next/dev/types/routes.d.ts`,** and the next
`npm run build` then fails with a `Type error: ';' expected` pointing at that *generated*
file — not at any source file. The root `tsconfig.json` includes `.next/dev/types/**/*.ts`, so
the truncated artifact becomes a type-check input.

It looks like a code error and is not one; the build log even says
`✓ Compiled successfully` immediately before failing. The fix is `rm -rf .next/dev` — it is a
dev-server artifact that `next dev` regenerates and `next build` does not need.

This belongs alongside the `prisma generate` EPERM note in `CLAUDE.md` → "Environment
gotchas".

### Phase 6 detail — device keys (shipped before phase 5)

`/analytics/devices` plus three API routes. Verified end to end with a real ADMIN session:
**21/21 assertions.**

- The raw key is generated server-side, returned **once**, and stored only as sha-256. No
  endpoint can read a key back — losing one means rotating it.
- `POST /[id]/rotate` invalidates the old key immediately. This is the endpoint that justifies
  the table over the `STORE_KEYS` env var: rotation is one write, not a redeploy.
- **No DELETE.** Revocation is `isActive = false`, because `count_events.deviceId` is
  `onDelete: SetNull` and a hard delete would orphan every crossing the device reported.
- `@@unique([storeId, agentId])` returns a 409 with a message pointing at rotation, rather
  than letting a store accumulate duplicate credentials.
- The store picker is restricted to `BCH_STORE | BCC_STORE` **in the zod schema**, not just in
  the `<select>` — the Prisma column accepts the whole `StockLocation` enum.

Proven behaviours: a rotated key works while the old one 401s immediately; a revoked key 401s
with `"device key revoked"`; and the device list never returns `key` or `keyHash`.

### Phase 5 detail — the dashboard

`/analytics`, and the module route moved from the phase-6 placeholder to the real page.
**18/18 assertions**, driving live events through the ingest API and reading them back.

The rule carried over intact from the pilot, because it is the most important thing in the
original: **a metric that cannot be computed renders as "—" with the reason underneath, never
as 0.** `docs/analytics/findings-2026-08-01.md` and `CHETAN.md §5` both ban the hardcoded zero;
the `Metric` component treats `null` and `0` as genuinely different states.

What the page shows, and what it deliberately withholds:

| Tile | Behaviour |
|---|---|
| Entered / Exited | Live counts for the selected store and business date |
| **Visitors per bill** | The honest headline. Null unless there is both footfall and a counter bill |
| Counter bills / Total invoices | Two tiles, never summed (decision 3) |
| Data coverage | Null with a reason until `STORE_OPEN_HOUR`/`STORE_CLOSE_HOUR` are set (Q-04) |
| **Conversion** | Its own row, permanently `—`, with the full explanation of why |

Conversion gets a dedicated card rather than a tile because its absence is a *business
decision*, not a missing feature — a family of four is one buying decision, not four
(`PRD-v1 §10`, findings B1). Giving it a full explanation is what stops someone "just filling
it in" later.

Two behaviours worth noting:

- **Store isolation is verified.** Events written for BCH_STORE do not appear on BCC_STORE's
  dashboard — findings A1/A2 is the bug where all stores were pooled and one could be reported
  ONLINE while it was dead.
- **The bills caveat fires automatically.** Registering a second store's device flips
  `counter_bills` and `total_invoices` to null with `bills_unavailable_reason` set, exactly as
  §3.2a requires. This was tested, not assumed.

Also fixed during phase 5: the devices screen had its own hardcoded store list from phase 6.
Both screens now derive from `STOCK_LOCATIONS` in `src/lib/inventory-config.ts` — this app
already has three competing location vocabularies (see `schema-review.md` §3.3) and it was not
going to gain a fourth from this merge.

### Phase 7 detail — the crons, and a live bug found on the way

Full documentation now lives in **[`cron-jobs.md`](./cron-jobs.md)**. Summary: two new
endpoints, **18/18 assertions**.

| Endpoint | Schedule | Purpose |
|---|---|---|
| `/api/cron/counter-watchdog` | `0 5 * * *` → 10:30 IST | Alerts when a counter stops heartbeating |
| `/api/cron/footfall-rollup` | `30 19 * * *` → 01:00 IST | Rolls the finished day into `FootfallDaily`, prunes raw events past 90 days |

#### ⚠ All three existing crons were dead

Measured before the fix — and this is a production bug that predates the merge:

```
/api/cron/overdue-alerts  -> 307  /login?callbackUrl=...
/api/cron/zoho-pull       -> 307
/api/cron/invoice-pull    -> 307
```

`withAuth` reads the session **cookie** and never looks at the `Authorization` header, so a
Vercel Cron request carrying a perfectly good Bearer token was still redirected to the login
page. The daily accountability scorecard has never been delivered.

Two independent causes, both now fixed: the matcher (`src/middleware.ts` now excludes
`api/cron`, `api/services/cron`, `api/earn-sync`) and a missing `CRON_SECRET`, which was
generated and added to `.env`. **It must also be set in Vercel**, or production still returns
500.

This is exactly the class of failure §2.2 predicted for the ingest routes. It had already
happened elsewhere in the app; nobody had looked.

#### Schedules are UTC, and the existing ones are mistimed

Vercel evaluates cron expressions in UTC. `overdue-alerts` is commented *"daily 8 AM… every
morning"* but `0 8 * * *` is **13:30 IST**. Left unchanged — what time the owner should get the
scorecard is a business decision, not a technical fix — but documented in `cron-jobs.md` §2.

The two new schedules are written in UTC to land at their intended IST times.

#### Decisions taken

- **Daily, not every 15 minutes.** Vercel Hobby caps cron at once per day and all three
  existing schedules are daily, which implies Hobby. A schedule that fails to deploy is worse
  than a conservative one. **The trade-off is real and stated plainly:** a daily watchdog makes
  a dead camera a next-morning postmortem rather than an alert. `TRD.md` §5 wants ~5 minutes.
  On Pro, change one line to `*/15 * * * *`.
- **Q7 answered: 90 days** of raw `count_events`, rollups kept forever, overridable via
  `ANALYTICS_RAW_RETENTION_DAYS`. Pruning only touches days that already have a rollup row, so
  it can never delete the only copy of a day.
- **Alerting is best-effort and never throws.** A watchdog that crashes because WhatsApp is
  down stops watching. When it cannot send, it reports `skipped` with the reason in the
  response body.

#### Proven behaviours

Watchdog with zero devices is a clean no-op; with a live device it does **not** alert; with a
heartbeat backdated 40 minutes it reports `offline: 1`, `silent_minutes: 41`, and skips the
send with a stated reason rather than silently. Rollup writes exactly one `FootfallDaily` row,
is idempotent on re-run, and rejects a malformed date.

#### Follow-up carried forward

`overdue-alerts` still inlines its own copy of the WhatsApp send loop;
`src/lib/analytics/alerts.ts` is the extracted version. Folding the older route onto it was
deliberately **not** done here — it is working production code that cannot be exercised without
live WhatsApp credentials, and a phase-7 change should not put an existing daily alert at risk.

### Phase 8 detail — cutover

The agent must not be repointed until phases 4–7 are verified on the new deployment:

1. deploy with `/api/v1/*` aliases live
2. confirm a test event lands: `curl -H "x-api-key: …" -d '[…]' …/api/v1/counts`
3. change `CLOUD_URL` in the store laptop's `agent/.env`, restart the agent
4. watch `queue_depth` in the heartbeat drain to 0
5. only then retire the old Vercel project

---

## 7. Risks

### 7.1 The matcher blocks ingest and nothing errors
Covered in §2.2. Highest-probability failure in the whole merge, because it fails *silently* —
the agent's own resilience hides it. Add an assertion to phase 4: a request to
`/api/analytics/counts` with no session cookie must return `401 {"error":"missing x-api-key"}`
from the handler, **not** a 307 to `/login`.

### 7.2 Machine write traffic on the operational database
Ingest is 24/7 automated writes into a database that otherwise serves human CRUD. A camera
mis-tuned so a shadow crosses the line repeatedly generates events at frame rate. Mitigations:
the `createMany` batching above, a per-device rate limit on the ingest route, and the
`FootfallDaily` rollup so reads never scan the raw table. If it still worries you after
measurement, the fallback is a separate Postgres **schema** on the same instance — not a
separate database, which puts us back where we started.

### 7.3 `StockLocation` is a stock concept being reused as a store identity — ✅ accepted
Resolved by decision 2: `storeId` is the `StockLocation` enum, not a `Store` table.

The residual risk is conceptual. `StockLocation` answers "where does this inventory sit"; it is
now also answering "which doorway was this person counted at". They agree today because BCH has
two sites, each with one shop floor. They stop agreeing the moment a site gets a second
entrance, or a store exists that holds no stock. The analytics PRD's own 1→2,000-store ambition
(`TRD.md:87`) assumes a real store registry.

Accepted deliberately: a `Store` table is a schema-wide change and this merge should not drag it
in. The exit is cheap while volumes are small — `CountEvent.storeId` is one column on one table,
and `entranceId` already exists for the multi-door case.

### 7.4 Conversion is still not computable, and the merge must not pretend otherwise
Merging supplies the *numerator* (bills). The reason `dashboard()` returns `conversion: null` is
the **denominator**: people ≠ parties (`PRD-v1 §10`, `findings-2026-08-01 §B1`). A family of four
walking in is one buying decision, not four. Nothing in this merge changes that.

Decision 3 helps here rather than hurting: showing `counterBills` and `totalInvoices` as two
labelled tiles makes it obvious they are bill counts, not a conversion rate. Ship
**"visitors per counter bill"** with that exact label, keep `conversion` null with its reason
string, and keep the `Metric` component's rule that a missing value renders `—` and never `0`.
Both `CHETAN.md §5` and `findings-2026-08-01` ban the hardcoded zero, and this merge is exactly
the moment someone would "just fill it in".

### 7.5 Docs become dangling references
The ported code cites spec IDs in comments — `DAT-001`, `DAT-003`, `CAM-005`, `CAM-007`,
`findings-2026-08-01 §C`, `PRD-v1 §10`. Those citations are the best thing about this codebase and
they stop resolving the moment the code moves without the docs. Copy all 18 files to
`docs/analytics/` in the same commit as the code.

---

## 8. Why the Python agent stays on the store laptop

Recorded here so it is not re-derived every time someone asks.

### What the agent actually does

`agent/counter.py` runs a four-stage loop, forever:

```
RTSP sub-stream ──► YOLOv8n person detect ──► ByteTrack track IDs ──► line-cross IN/OUT
                                                                            │
                                          SQLite buffer.db ◄────────────────┘
                                                  │
                              batch POST /api/v1/counts every ~10s, retry with backoff
                              POST /api/v1/heartbeat every 60s
```

Its **input** is a 640×360 video stream, decoded at roughly frame rate, continuously, 12 hours a
day. Its **output** is a handful of JSON rows:

```json
[{"id":"3f2a…","ts":1755764400000,"direction":"in","store_id":"store-1",
  "adapter":"RTSP_CV","agent_version":"0.3.0","confidence":0.71}]
```

Gigabytes in, kilobytes out. That asymmetry is the whole argument.

### What breaks if inference runs in the cloud

**1. The camera is not reachable from the internet, by design.**
`EXISTING_SYSTEM_AUDIT.md:75` records that nothing at the store is published to the internet
today, and `PRD-v1.md:222` requires it stay that way: *"BCH requires no router port forwarding,
DDNS exposure, or public RTSP."* `TRD.md:18` states the principle — *"push not pull, buffer not
hope, heartbeat not trust. No inbound ports; no static IP; NAT-safe."*

Cloud inference inverts that. The cloud would have to *pull* RTSP from the NVR, which means
port-forwarding 554 to a recorder whose cameras are all still named `Camera 01` and which sits on
the shop LAN. A publicly exposed NVR is one of the most reliably compromised devices on the
internet. This alone ends the discussion.

**2. Bandwidth the shop does not have.**
`tech-design-v2.md:67`: 4 cameras × 2 Mbps × 12 h/day ≈ **43 GB per store per day** of upstream if
raw video goes to a cloud. Events are a few hundred KB. Indian retail broadband does not sustain
that upstream, and the vendor said so himself: *"to send it to the cloud you need to expose the
video feed… there is packet drop."*

**3. Counting stops when the internet does.**
Today the broadband drops and nothing is lost: events queue in `buffer.db` and backfill on
reconnect. `BUILD_PLAN.md:23` makes it an acceptance test — *"unplug internet 10 min → 0 data lost
after reconnect."* With inference in the cloud an outage is not a delay, it is **missing hours
that can never be recovered**, because the frames are gone. `coverage_pct` would correctly report
the gap, so the dashboard degrades from "counted" to "we don't know" every time the line blips.

**4. Privacy surface, and cost.**
`PRD-v1.md:80` lists *"uploading or storing continuous CCTV video in the cloud"* as an explicit
non-goal, and `TRD.md:77` ties it to DPDP. Right now no image of any customer leaves the premises,
so the compliance surface is near zero at no functional cost. Streaming the doorway to a cloud GPU
makes BCH a processor of continuous video of identifiable people. Separately: an always-on GPU
instance per store costs more per month than the laptop already sitting in the shop, and YOLOv8n
on a 640×360 sub-stream does not need one.

### What the cloud half is genuinely for

Not inference — **aggregation, comparison, alerting, and the join to sales**. One store's counter
cannot tell you which of your stores is worst, cannot message the owner's phone, and cannot join
footfall to Zoho bills. That is the half being merged here, and it is the half that belongs next
to the inventory data.

The correct split, which `tech-design-v2.md` states outright: **inference on-prem, aggregation in
cloud.** This merge changes only the second half.

### The one thing that could move later

If a purpose-built counting device is fitted at the door (`PRD-v1.md:29` keeps that option open),
it does the counting in its own firmware and posts the same event shape. The laptop disappears;
the ingest API does not change. That is an argument for keeping the ingest contract stable, not
for moving inference.

---

## 9. Open questions

Q1, Q2, Q3 and Q5 are **closed** — see §0. Q4 is **closed** — see §4; the answer turned out to
be "ADMIN only, already handled". Three remain, none blocking the next phase.

| # | Question | Needed by | Why it matters |
|---|---|---|---|
| 6 | **What Vercel plan, and what channel does the watchdog alert on?** | Phase 7 | Heartbeat-gap alerting is the entire reason heartbeats exist. Cron granularity is plan-dependent, and this app already has a WhatsApp path that may be reusable. A once-a-day watchdog is a postmortem, not an alert. |
| 7 | **Retention for `count_events` — how long before rollup-and-prune?** | Phase 7 | Decides whether `FootfallDaily` ships in phase 1 or is deferred. Default if unanswered: raw 90 days, rollups forever. |
| 8 | **Does the old Vercel deployment get retired at cutover?** | Phase 8 | If both apps run against one database, two auth models write the same tables. Strong recommendation: retire it, as `bch-service` was. |

---

## 10. Recommendation summary

Merge the cloud half. It is ~700 lines, it deletes a second login and a second deploy, and it
closes the pilot's largest open TODO — the Zoho bill join — by walking it into a codebase that
already has one. Keep the ingest contract stable, keep the agent on the laptop, and keep
`conversion` honest.

With §0 settled and no data to migrate, **phase 1 can start now.** The four remaining questions
in §9 come due at phases 2, 7 and 8 — none of them gates the schema work.
