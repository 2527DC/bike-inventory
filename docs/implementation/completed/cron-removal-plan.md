# Cron Removal Plan

Status: **PLAN ONLY — not implemented.** Awaiting go-ahead.
Branch: `chore/remove-cron-jobs` (separate from the storage work).
Prepared 28 Aug 2026.

---

## 1. Decision

**Remove every cron job from this application. No scheduled work remains.** All syncing
becomes a manual fetch triggered by a person pressing a button. Automatic screen polling is
removed at the same time — screens load once and refresh when asked.

This was raised, discussed, and reaffirmed. §5 records what is knowingly given up so that
nobody later reads this as an oversight.

## 2. Scope

In scope:
- the 6 cron route handlers
- the `crons` array in `vercel.json`
- `CRON_SECRET` and every code path that reads it
- automatic `setInterval` polling on 9 screens
- documentation that describes any of the above

Explicitly **not** in scope — these are externally invoked, not scheduled:
- `/api/services/earn-sync` — shared-key guarded, called by an external poller
- `/api/analytics/counts`, `/api/analytics/heartbeat`, `/api/v1/*` — the store Python agent
  posts to these. The agent keeps running; only the *server-side watchdog that watches it*
  is being removed.

## 3. What gets deleted

### Route handlers (6 files, deleted outright)

| File | Was scheduled | Replacement |
|---|---|---|
| `src/app/api/cron/zoho-pull/route.ts` | daily 07:30 | **already exists** — `/api/zoho/trigger-pull` + Pull button |
| `src/app/api/cron/invoice-pull/route.ts` | daily 09:00 | **already exists** — the Bulk Fetch tab on `/deliveries` (§4) |
| `src/app/api/cron/overdue-alerts/route.ts` | daily 08:00 | new manual button (§4) |
| `src/app/api/cron/counter-watchdog/route.ts` | daily 05:00 | **none** — see §5 |
| `src/app/api/cron/footfall-rollup/route.ts` | daily 19:30 | **none** — see §5 |
| `src/app/api/services/cron/zoho-deliver/route.ts` | never registered | **none** — already orphaned, absent from `vercel.json` |

Both `src/app/api/cron/` and `src/app/api/services/cron/` directories disappear entirely.

### Library code

| File | Why |
|---|---|
| `src/lib/analytics/alerts.ts` | `sendOwnerAlert` is imported by **exactly one** file, `counter-watchdog/route.ts:20`. With that gone the module is dead code. `overdue-alerts` inlines its own sender and does not use it. |

### Configuration

| File | Change |
|---|---|
| `vercel.json` | delete the whole `crons` array (5 entries). Keep `regions: ["bom1"]`. |
| `.env` | remove `CRON_SECRET` |

### Code edits

| File | Change |
|---|---|
| `src/middleware.ts:45` | remove `api/cron\|api/services/cron` from the public matcher. Leaving them would keep a hole open to routes that no longer exist. |
| `src/middleware.ts:32-43` | the comment block explaining cron auth becomes wrong — rewrite for `earn-sync` and the agent endpoints only |
| `src/lib/logger.ts:29` | comment mentions crons |
| `src/lib/auth-helpers.ts:100` | comment mentions cron handlers |
| `src/lib/analytics/time.ts:75` | comment cites `api/cron/invoice-pull` as the reason a date helper exists. The **helper stays** — its callers change, its reason does not. Comment only. |

### UI copy

| File | Change |
|---|---|
| `src/app/(dashboard)/more/app-logic/page.tsx:429` | documents "Cron: Zoho Auto-Pull" as a live rule — delete the entry |
| `src/app/(dashboard)/more/zoho/pull-review/page.tsx:233` | says "Daily cron runs at 1 PM IST" — remove (also factually wrong today; the schedule was 07:30) |

### Screen polling (9 files)

Every one of these is a silent background refetch. All are replaced by an explicit refresh
control; initial load on mount stays.

| File | Interval |
|---|---|
| `src/app/(dashboard)/analytics/page.tsx:134` | 15s |
| `src/app/(dashboard)/stock/page.tsx:417` | 30s |
| `src/app/(dashboard)/services/billing/page.tsx:51` | 60s |
| `src/app/(dashboard)/services/counter/queue/page.tsx:105` | 60s |
| `src/app/(dashboard)/services/manager/page.tsx:122` | 60s |
| `src/app/(dashboard)/services/mechanic/page.tsx:74` | 60s |
| `src/app/(dashboard)/services/supervisor/page.tsx:103` | 60s |
| `src/app/(dashboard)/services/supervisor/assign/page.tsx:44` | 60s |
| `src/app/(dashboard)/services/updates/page.tsx:38` | 60s |

> The service screens are shared shop-floor displays. A queue that no longer advances by
> itself is a real behaviour change for the people standing in front of it — worth telling
> the workshop staff, not just shipping.

### Documentation

| File | Change |
|---|---|
| `docs/cron-jobs.md` | 300 lines describing a system that will not exist — **delete** |
| `CLAUDE.md:118` | lists `/api/cron/*` and `/api/services/cron/*` under "Routes that must stay public" — remove those two lines |
| `docs/dead-code.md:16,82,143,145` | cites the crons as live invokers; `FootfallDaily` is reclassified from "written nightly" to permanently empty |
| `docs/implementation/completed/analytics-merge-plan.md` | references the rollup and watchdog |
| `docs/implementation/pending/store-hierarchy-and-team-plan.md`, `docs/water-flow-chart.md` | passing mentions |
| `docs/postman/bch-ops-service.postman_collection.json` | drop the cron requests |

## 4. Manual replacements to build

| Trigger | Where it goes |
|---|---|
| **Pull Zoho data** | already built — `/api/zoho/trigger-pull`, button on the integrations page |
| **Pull invoices** | already built — the **Bulk Fetch** tab in `ZohoImportFlow` on `/deliveries`. A one-click `/api/deliveries/invoice-pull` route was written during this work and then **deleted as redundant**: nothing referenced it, so it would have been dead code on arrival, and it imported blind where Bulk Fetch imports after review. |
| **Send daily scorecard** | new button; lift the body of `overdue-alerts` into a guarded route |

Each becomes an ordinary authenticated endpoint — no `CRON_SECRET`, no public matcher
entry, `requireFeature` like every other route in the app. That is a genuine security
improvement: three formerly-public endpoints become permission-gated.

## 5. Consequences knowingly accepted

Recorded deliberately, because both were raised before the decision was made.

**A dead store counter will never be reported.** The counter software on the store laptop
swallows its own errors on purpose — `counter.py` comments it as *"the cloud noticing the
gap IS the alert"*. The watchdog was the other half of that contract. After this change,
nothing in the system notices a stopped heartbeat. Footfall data simply stops arriving, and
the first sign is someone looking at a flat graph and asking why.

**`count_events` grows without bound.** Roughly one row per person per direction, forever.
The nightly rollup was also the retention job. Two follow-on effects:
- `FootfallDaily` is written by nothing, so it stays permanently empty (see
  `docs/dead-code.md:82`).
- The analytics page rebuilds the whole day from raw rows on every load. With the 15s poll
  also removed this is now once per manual refresh rather than four times a minute — which
  softens it — but the per-load cost still grows month over month.

## 6. Open decisions

1. **Drop the `FootfallDaily` table?** Nothing will write to it. Leaving an empty table is
   harmless but misleading; dropping it is a schema change. *Note: editing
   `prisma/schema.prisma` now triggers the schema-reviewer hook, by design.*
2. **`syncType: "cron-pull"`** — `src/app/api/zoho/trigger-pull/route.ts:39,46,51,459`
   writes and queries this **string value in the database**, on the manual trigger. It is a
   stored label, not a schedule. Renaming it to `"manual-pull"` needs an `UPDATE` over
   existing rows or the history query at `:46` silently stops matching. Recommendation:
   **leave the string as-is**, add a one-line comment explaining the legacy name.
3. Should the workshop screens get an auto-refresh **toggle** (default off) rather than no
   auto-refresh at all? Costs little and leaves the shop-floor displays usable.

## 7. Execution order

1. Create branch `chore/remove-cron-jobs`.
2. Build the two manual replacement routes and their buttons **first**, so no capability is
   ever absent from `main`.
3. Delete the 6 route handlers and `src/lib/analytics/alerts.ts`.
4. Strip `vercel.json` crons, `.env` `CRON_SECRET`, the middleware matcher and comments.
5. Remove the 9 `setInterval` blocks, add refresh controls.
6. Update `CLAUDE.md`, delete `docs/cron-jobs.md`, correct the other docs.
7. `npm run build`.
8. Grep for stragglers: `grep -rn "cron\|CRON_SECRET" src/ docs/ *.json *.md`.

## 8. Verification

- `npm run build` passes.
- No file under `src/` matches `CRON_SECRET`.
- `vercel.json` has no `crons` key — Vercel stops scheduling on the next deploy.
- Manual pull, invoice pull and scorecard each work from their button while signed in, and
  return **403 when signed out** — proving they are no longer public.
- Analytics, stock and the seven service screens load once and refresh only on demand.
