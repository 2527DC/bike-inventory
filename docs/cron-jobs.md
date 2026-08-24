# Scheduled jobs (cron)

Every scheduled endpoint in `bch_management`: what it does, why it exists, and what breaks
when it does not run.

**Last verified:** 21 Aug 2026, all endpoints exercised against a running server.

---

## 1. What a cron is here

A cron is work that **has nobody to trigger it**. Nobody signs in at 7:30am to press "sync".

Vercel Cron reads the `crons` array in `vercel.json` and, on schedule, makes an ordinary
**HTTP GET** to that path in your deployed app, carrying:

```
Authorization: Bearer <CRON_SECRET>
```

There is no special runtime. A cron endpoint is a normal route handler; the only things that
make it a cron are the schedule entry and the fact that it checks the secret instead of a
session.

That means you can always run one by hand:

```bash
curl -H "authorization: Bearer $CRON_SECRET" \
     https://your-app.vercel.app/api/cron/counter-watchdog
```

---

## 2. ⚠ Schedules are UTC, not IST

**This is the single most common mistake with Vercel Cron, and this repo already has it.**

Vercel evaluates cron expressions in **UTC**. India is **UTC+5:30**. So every schedule reads
five and a half hours earlier than the clock on the wall in Bangalore.

| Path | Schedule | Runs at (UTC) | Runs at (IST) |
|---|---|---|---|
| `/api/cron/zoho-pull` | `30 7 * * *` | 07:30 | **13:00** |
| `/api/cron/overdue-alerts` | `0 8 * * *` | 08:00 | **13:30** |
| `/api/cron/invoice-pull` | `0 9 * * *` | 09:00 | **14:30** |
| `/api/cron/counter-watchdog` | `0 5 * * *` | 05:00 | **10:30** |
| `/api/cron/footfall-rollup` | `30 19 * * *` | 19:30 | **01:00** next day |

`src/app/api/cron/overdue-alerts/route.ts` carries the comment:

> *"Vercel Cron: daily 8 AM… Pushes the Daily Accountability scorecard every morning"*

It does not run in the morning. `0 8 * * *` is **13:30 IST** — after lunch. If the intent is
a genuine 8:00am IST scorecard, the expression needs to be `30 2 * * *`.

**Left unchanged deliberately** — it is a business-timing decision, not a bug to fix in a
technical pass. Decide what time the owner should get it, then set UTC = IST − 5:30.

**Conversion rule:** subtract 5:30 from the IST time you want.
`10:30 IST → 05:00 UTC`. `01:00 IST → 19:30 UTC (previous day)`.

---

## 3. Authentication

Every scheduled route checks the same shared secret:

```ts
const secret = process.env.CRON_SECRET;
if (!secret) return errorResponse("CRON_SECRET not configured", 500);
if (req.headers.get("authorization") !== `Bearer ${secret}`) {
  return errorResponse("Unauthorized", 401);
}
```

**A missing secret denies.** It never falls open — which matters, because these routes are
reachable without a session (§4).

`CRON_SECRET` must be set in **both** `.env` (local) and the Vercel project's environment
variables. It was added to `.env` on 21 Aug 2026; **confirm it exists in Vercel** or production
crons return 500.

---

## 4. ⚠ Cron routes must be excluded from the middleware matcher

`src/middleware.ts` wraps the app in NextAuth's `withAuth`, which reads the **session cookie**
and knows nothing about the `Authorization` header. A cron request has no cookie, so if its
path is inside the matcher, withAuth redirects it to `/login` **before the handler ever runs** —
Bearer token and all.

**This had actually happened.** Measured 21 Aug 2026, before the fix:

```
/api/cron/overdue-alerts  -> 307  /login?callbackUrl=%2Fapi%2Fcron%2Foverdue-alerts
/api/cron/zoho-pull       -> 307
/api/cron/invoice-pull    -> 307
```

All three had never successfully run. `CLAUDE.md` already listed them under *"routes that must
stay public"*; the matcher had simply never been updated to match the documentation.

The matcher now excludes `api/cron`, `api/services/cron` and `api/earn-sync` by prefix.

> **The contract that makes a prefix safe:** every route beneath those prefixes **must** check
> `CRON_SECRET` (or its own shared key) in the handler. All six do today. **A new route added
> under `/api/cron/` without that check is open to the internet.**

*(Contrast with the analytics ingest paths in the same matcher, which are listed individually
rather than by prefix — `/api/analytics/dashboard` is business data and must stay behind the
session, so `api/analytics` as a prefix would have been wrong.)*

---

## 5. The endpoints

### 5.1 `/api/cron/zoho-pull` — 13:00 IST daily

**Does:** pulls contacts, items and bills from Zoho Books into the local database.

**Why:** the app is the operational system of record for stock and deliveries, but Zoho is
where accounting lives. Without a scheduled pull, someone has to open the sync screen and press
a button every morning, and everything downstream — reorder levels, vendor balances — is as
stale as the last time anyone remembered.

**Without it:** the app silently drifts from Zoho. Nothing errors; the numbers just age.

---

### 5.2 `/api/cron/overdue-alerts` — 13:30 IST daily

**Does:** builds the Daily Accountability scorecard (`src/lib/accountability.ts`) and sends it
over the WhatsApp Cloud API to the numbers in `AlertConfig.redFlagPhones`.

**Why:** its own comment puts it best — *"the REVIEW step of the system loop, so the founder
gets the number without pulling it."* A report nobody opens is not a report. This pushes.

**Without it:** the accountability loop has no review step. Overdue items age unnoticed until
someone thinks to look.

**Note:** needs `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID`. Neither is currently in `.env`, so
the scorecard is computed and then not delivered.

---

### 5.3 `/api/cron/invoice-pull` — 14:30 IST daily

**Does:** pulls invoices created in Zoho since the last successful pull, using `SyncLog` as the
cursor.

**Why:** customer invoices drive receivables and the delivery pipeline. Cursor-based so a
missed day catches up automatically rather than needing a manual date range.

**Without it:** receivables and delivery status go stale.

---

### 5.4 `/api/cron/counter-watchdog` — 10:30 IST daily · **added phase 7**

**Does:** finds every active `AnalyticsDevice` whose last heartbeat is older than five minutes
and sends one WhatsApp alert listing them.

**Why — this is the important one.** The camera agent will **never** tell you it has died.
That is deliberate. `agent/counter.py` swallows every error from its heartbeat call, commented:

> *"the cloud noticing the gap IS the alert; a failed heartbeat must not crash counting"*

The laptop's job is to count, not to complain. So something server-side has to notice the
silence — and that is this endpoint. It is the entire reason heartbeats are stored as a
**series** rather than as one "last seen" value.

**Without it:** a camera can be dead for a week and the dashboard just shows low numbers —
**which is indistinguishable from a quiet week at the shop.** That is the exact failure mode
this project exists to prevent, and it would be invisible.

**Timing rationale:** 10:30 IST is shortly after the store opens, so a counter that failed to
come up with the shutters is caught at the start of trading rather than the end.

**The schedule *is* the alert latency.** There is no other signal:

| Schedule | Camera dies 10:00 | Runs/day | Plan |
|---|---|---|---|
| `*/15 * * * *` | known by 10:15 | 96 | **Pro** |
| `0 * * * *` | known by 11:00 | 24 | **Pro** |
| `0 5 * * *` (current) | known next day 10:30 | 1 | Hobby ✓ |

**Currently daily** because Vercel Hobby caps cron at once per day and all existing schedules
are daily, implying Hobby. On Pro, change to `*/15 * * * *` — that is what `TRD.md` §5 intends
("heartbeat gap > 5 min → watchdog pushes 'Store-X counter offline'").

**Response shape:**

```json
{ "checked": 2, "offline": 1, "stale_threshold_minutes": 5,
  "devices": [{ "store": "BCH_STORE", "label": "BCH front door", "silent_minutes": 41 }],
  "alert": { "attempted": 1, "sent": 1, "skipped": null, "errors": [] } }
```

Alerting is **best-effort and never throws**: a watchdog that crashes because WhatsApp is down
stops watching, which is the opposite of its purpose. When it cannot send it reports
`skipped` with the reason, and that lands in the Vercel log.

---

### 5.5 `/api/cron/footfall-rollup` — 01:00 IST daily · **added phase 7**

**Does:** three things for the day that just ended —

1. writes one `FootfallDaily` row per counting store (IN, OUT, observed heartbeat-minutes)
2. snapshots the day's bill counts onto those rows
3. deletes raw `count_events` older than the retention window, **but only for days that already
   have a rollup row**

**Why:** `count_events` grows by roughly one row per person per direction, forever, and the
dashboard polls every 15 seconds. Without a rollup, every page load re-aggregates the day from
raw rows, and within a year the table is the largest object in the database.

**Why 01:00 IST:** the business day ends at midnight IST, so this runs one hour later on the
day that just closed. Running "today" would freeze a partial day into history.

**Idempotent by design.** `@@unique([storeId, businessDate])` plus an upsert, so running it
twice produces the same row. That is not a nicety: the edge agent **backfills after an
outage**, so a day already rolled up can gain events hours later. Re-run it and the row
corrects itself.

**Manual backfill:**

```bash
curl -H "authorization: Bearer $CRON_SECRET" \
     "https://your-app.vercel.app/api/cron/footfall-rollup?date=2026-08-19"
```

**Retention:** 90 days of raw events by default — a full quarter of per-event detail, enough to
review a disputed count or re-tune the crossing rule against real traffic. Rollups are kept
forever. Override with `ANALYTICS_RAW_RETENTION_DAYS`; set it to `0` to disable pruning while
still rolling up.

**The safety property:** pruning only ever touches days that already have a `FootfallDaily`
row. It can never delete the only copy of a day's data.

---

### 5.6 `/api/services/cron/zoho-deliver` — **no schedule**

A cron-shaped route (checks `CRON_SECRET`) that is **not in `vercel.json`**, so nothing calls
it. Either add a schedule or remove it — a scheduled job with no schedule is a maintenance
trap, since it reads as live to anyone auditing the directory.

---

### 5.7 `/api/earn-sync` — not a cron

Guarded by its own shared key and pulled by an **external** poller rather than Vercel Cron. It
is in the middleware exclusions for the same reason the crons are: no session exists.

---

## 6. Adding a new scheduled job

1. Create `src/app/api/cron/<name>/route.ts` with a `GET` handler.
2. **Check `CRON_SECRET` first**, before anything else. A missing secret must return 500, a
   wrong one 401. This is not optional — the middleware exclusion in §4 is a prefix, so the
   route is reachable from the internet without it.
3. Add `export const dynamic = "force-dynamic";` and, for slow jobs,
   `export const maxDuration = 60;`.
4. Add the schedule to `vercel.json` — **in UTC** (§2).
5. Return a summary object. It is the only record of what happened; the Vercel log is where
   you will debug this at 9am on a Monday.
6. Test locally:
   ```bash
   curl -i -H "authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/<name>
   ```
   A **307** means you were redirected to `/login` — the matcher is wrong. A **401** means the
   handler ran and rejected you, which is correct behaviour for a bad token.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `307` redirect to `/login` | Path is inside the middleware matcher | Add it to the exclusions in `src/middleware.ts` (§4) |
| `500 CRON_SECRET not configured` | Env var missing | Set it in `.env` **and** Vercel |
| `401 Unauthorized` with the right secret | `.env` and Vercel values differ | Compare them |
| Job runs at the wrong time | Schedule read as IST | It is UTC (§2) |
| Deploy rejected over cron frequency | Hobby caps at once per day | Reduce frequency, or upgrade |
| Alert cron runs but nothing arrives | `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_ID` unset, or `AlertConfig.redFlagPhones` empty | Check the `alert.skipped` field in the response |

---

## 8. Known follow-ups

- **`overdue-alerts` inlines its own WhatsApp send loop.** `src/lib/analytics/alerts.ts` is the
  extracted version, used by `counter-watchdog`. Folding the older route onto it removes the
  duplication, but it is working production code that cannot be exercised without live
  WhatsApp credentials, so it was left alone rather than changed blind.
- **The 8 AM scorecard is not at 8 AM** (§2). Needs a business decision, not a code change.
- **`zoho-deliver` has no schedule** (§5.6).
- **The watchdog is daily**, which makes it a next-morning postmortem rather than an alert.
  Revisit on Pro.
