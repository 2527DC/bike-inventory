# Service module — mobile readiness plan

Status: pending — what /api/services/* needs before bch-service-app can be pointed at it
Suggested branch: `fix/service-module-readiness` (Phases 0–3), then `feat/service-app-port`
(Phase 4, in the `bch-service-app` repo).
Prepared 28 Aug 2026.

Companion repo: `../bch-service-app` — Expo SDK 54, expo-router 6, currently mock-backed.

---

## 1. What this plan is, in one sentence

`/api/services/*` was ported from the standalone `bch-service` app and has never had a second
client; before `bch-service-app` is pointed at it, the module needs six things that are
outright broken fixed, one response contract settled, and three missing capabilities either
built or cut from scope.

## 2. Why now, and not after the port

Two of the items below are **one-way doors** once a mobile binary ships:

- The response shape (§5). Every service route returns `{ jobs }` / `{ prices }` instead of
  the app-wide `{ success, data }`. Changing it after an app is in someone's hand means
  supporting both shapes forever.
- The photo URL shape (§0.5). The upload route returns relative proxy paths. A React Native
  `<Image>` cannot resolve those, and the workaround people reach for — string-concatenating
  a base URL in the client — is the thing that becomes permanent.

Everything else can be fixed later at ordinary cost. These two cannot.

## 3. Scope

**In scope:** the 25 routes under `src/app/api/services/`, the 11 pages under
`src/app/(dashboard)/services/`, and the API contract the Expo app consumes.

**Not in scope:** the workshop UI redesign (the ported screens still carry the old styling —
a known, accepted follow-up), Zoho behaviour, and Staff LMS.

---

# Phase 0 — Blockers

Nothing in the module works until these are done. All six are small.

## 0.1 `/api/auth/me` does not exist

Three pages fetch it and gate their entire data load on the result:

| File | Line | Consequence |
|---|---|---|
| `(dashboard)/services/mechanic/page.tsx` | 44 | `mechId` never set → `fetchJobs()` returns early → **the mechanic screen never loads a single job** |
| `(dashboard)/services/assembly/page.tsx` | 55 | `mechId` never set → assembly logs never load |
| `(dashboard)/services/counter/page.tsx` | 147 | `currentUser` never set |

`src/app/api/auth/` contains only `[...nextauth]/` and `mobile-login/`. The 404 returns an
HTML body, `res.json()` then throws `Unexpected token '<'` — precisely the failure CLAUDE.md
names as a non-negotiable.

**Fix: do not add a route.** `GET /api/my-permissions` already returns exactly this and is
already documented as authentication-only (gating it would deadlock the permission
bootstrap). Repoint the three call sites:

```ts
// before
fetch("/api/auth/me").then(async (res) => {
  const data = await res.json();
  if (data.user) setMechId(data.user.id);
});

// after — apiTry unwraps { success, data } and survives a 307-to-login
const me = await apiTry<MeResponse>("/api/my-permissions");
if (me) setMechId(me.user.id);
```

Note the payload differs: `{ user: {id,name,email}, role: {key,name}, permissions, modules }`.

## 0.2 Five routes are gated on role names no role has

`ROLE_CATALOG` names are `"Service Manager"`, `"Service Supervisor"`, `"Service Counter
Staff"`, `"Service Billing"`. Nothing in `prisma/rbac-catalog.ts` is *named* `MANAGER`,
`SUPERVISOR`, `STAFF` or `BILLING`. These five lines therefore reject **every user, including
a Service Manager**, after `serviceGuard` has already approved them:

| File | Line | Currently broken |
|---|---|---|
| `api/services/jobs/assign/route.ts` | 8 | mechanic assignment |
| `api/services/jobs/delete/route.ts` | 11 | job deletion |
| `api/services/jobs/bulk-status/route.ts` | 10 | bulk status change |
| `api/services/prices/route.ts` | 19 | price create / edit |
| `api/services/export/route.ts` | 9 | CSV export |

These are the **only five role-name comparisons in the entire codebase** — a direct violation
of CLAUDE.md's first architectural rule.

**Fix: delete all five lines.** The `serviceGuard` call directly above each one is already
the correct check. Where the intent was narrower than the guard, express it as a permission,
not a name:

| Route | Guard today | Intent | Action |
|---|---|---|---|
| `assign` | `service_jobs, edit` | supervisor+ | tighten to `approve` — `SERVICE_MECHANIC` holds only view+edit, so this is the exact line the name-check was groping for |
| `bulk-status` | `service_jobs, edit` | supervisor+ | tighten to `approve` |
| `delete` | `service_jobs, delete` | manager only | already correct — only `SERVICE_MANAGER`/`SERVICE_SUPERVISOR` hold `delete`. Delete the line, change nothing else |
| `prices` POST | `service_prices, create` | already correct | delete the line |
| `export` | `service_reports, view` | already correct | delete the line |

The client twin, `counter/page.tsx:150,161`:

```ts
setCurrentUser({ id: data.user.id, role: data.user.role });  // `role` is a relation now
const isMechanic = currentUser?.role === "MECHANIC";         // never true
```

becomes a permission check via the permissions store — frontend checks are cosmetic, and the
API re-checks regardless.

## 0.3 The app calls an endpoint that does not exist

`bch-service-app/src/services/apiClient.ts` ends with:

```ts
async updateJobStatus(jobId: string, status: string, notes?: string) {
  return this.instance.patch(`/api/services/jobs/${jobId}`, { status, notes });
}
```

There is no `[id]` route and no `PATCH` handler anywhere under `api/services/jobs/`. The real
call is `POST /api/services/jobs/update-status` with `{ jobId, newStatus }`. 405 today.

**Fix:** rewrite the client method against the real route (Phase 4), and add
`GET /api/services/jobs/[id]` for drill-downs.

## 0.4 Two routes have no authentication at all

| File | Line | Exposes |
|---|---|---|
| `api/services/prices/route.ts` | 6 | the full price list, unauthenticated |
| `api/services/upload/route.ts` | 98 | the photo index for any `jobId`, unauthenticated |

`prices` GET carries the comment "any logged-in user" and then never checks. Add
`serviceGuard("service_prices", "view")` and `serviceGuard("service_jobs", "view")`
respectively. Note `SERVICE_MECHANIC` does **not** hold `service_prices.view` — if mechanics
need the price list, grant it in the catalog rather than leaving the route open.

## 0.5 Job shape drifts between endpoints

`GET /api/services/jobs` returns `mechanic: { id, name, emoji }` and `review`.
`update-status`, `assign` and `bill` return `mechanic: { name, emoji }` — **no `id`, no
`review`**.

The Expo store merges a mutation response back into `jobs[]`, so one status change silently
strips `mechanic.id` and the review from that job, and mechanic filtering
(`j.mechanic?.id === user.id`) drops it from the mechanic's own list.

**Fix:** one shared `include` constant, used by every route that returns a job.

```ts
// src/lib/services/queries.ts
export const JOB_INCLUDE = {
  customer: { select: { name: true, phone: true } },
  mechanic: { select: { id: true, name: true, emoji: true } },
  review:   { select: { rating: true, googleReview: true } },
} as const;
```

Same fix covers the photo URLs: `upload/route.ts` returns relative
`/api/services/upload/photo?jobId=…` paths that a React Native `<Image>` cannot resolve.
Return absolute URLs.

## 0.6 Assembly photos are half-migrated between storage providers

`api/services/assembly/route.ts` POST writes through `tryGetStorage()` (R2).
`api/services/assembly/photo/route.ts:24` reads them back with:

```ts
const res = await fetch(log.photos[index], {
  headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
});
```

That is a Vercel Blob token sent at an R2 URL. Every assembly photo uploaded since the
storage switch 502s. The job-photo route was migrated (`upload/photo/route.ts` redirects);
this one was missed.

**Fix:** mirror `upload/photo/route.ts` — keep the permission check, then redirect.

---

# Phase 1 — The response contract

**Do this before the app ships, not after.** It is the one-way door from §2.

## 1.1 Current state

| Convention | Rest of the app | `api/services/*` |
|---|---|---|
| Response shape | `successResponse(data)` → `{ success, data }` | raw `{ jobs }`, `{ prices }`, `{ log }` |
| Validation | zod schemas | **zero** — 0 of 25 routes import zod |
| Error handling | `failure(e, { scope })` | **20 of 25 routes have no `try/catch`** |
| Logging | `createLogger(scope)` | 1 of 25 routes (`upload/delete`) |

The Expo client's axios interceptor unwraps only `{ success, data }`:

```ts
if (resData && resData.success !== undefined) { ... return resData.data; }
return resData;   // ← service routes fall through here
```

so `getJobs()` hands the store an **object**, not an array.

## 1.2 The work

For each of the 25 routes:

1. Wrap the body in `try/catch`, return `failure(error, { scope: "services:<name>" })`.
2. Parse the body/query with a zod schema. `rating`, `amount`, `index`, `priority` and
   `jobIds` are all currently read off the request unvalidated.
3. Return `successResponse(...)` / `errorResponse(...)`.
4. Scope a logger: `const log = createLogger("services:jobs-create")`, and log the business
   event with identifiers only (`jobId`, `tokenNumber`, `mechanicId` — never the payload).

Without step 1, a malformed body makes `await req.json()` throw unhandled → a 500 with an
HTML body the mobile client cannot parse. That is the same class of bug as §0.1.

## 1.3 Migration order

Do the routes the app actually calls first, so Phase 4 can start against a settled contract:
`jobs` → `jobs/update-status` → `jobs/create` → `jobs/notes` → `prices` → `incentives` →
`mechanics` → `assembly` → `audit` → `upload*` → the rest.

---

# Phase 2 — Missing capabilities

Three things the Expo app already assumes, that the backend does not provide. Each needs a
decision before it needs code.

## 2.1 Staff roster — needs a schema change 🔴 DECISION REQUIRED

`bch-service-app/app/(app)/staff/index.tsx` (164 lines) and `staff/[id].tsx` (197 lines) are
**already built** against `mockApi.getStaff()` / `getStaffWorkload()`. They render:

| Field | In `User`? |
|---|---|
| `name`, `emoji`, `role`, `email` | ✅ |
| `phone` | ❌ |
| `joinedAt` | ❌ (`createdAt` is close enough) |
| `shift` (`MORNING`/`EVENING`/`FULL`) | ❌ |
| `skills` (`String[]`) | ❌ |
| `active` | ✅ `isActive` |
| `open` / `deliveredToday` workload | ❌ no endpoint |

`GET /api/services/mechanics` returns `{ id, name, emoji, _count.assignedJobs }` — name,
emoji and an open count, and nothing else.

**Three options:**

| | Cost | Result |
|---|---|---|
| **A. Extend `User`** — add `phone`, `shift`, `skills`, migration, `/team` UI fields, new `GET /api/services/staff` | 1 migration + 1 route + `/team` form changes | both screens ship as designed |
| **B. Cut to what exists** — drop phone/shift/skills from the screens, extend `mechanics` with `deliveredToday` | 1 route change, 2 screen edits | screens ship thinner; search-by-phone/skill goes away |
| **C. Defer** — leave both screens as `ComingSoon` | zero | ship the workshop without a roster |

**Recommendation: B.** `shift` and `skills` are not used anywhere else in either codebase and
have no owner in `/team`; adding columns nobody maintains produces a roster that is wrong
within a month. `phone` is the one genuine loss — and staff phone numbers live in the
existing HR process, not here.

## 2.2 Service billing — module, page, permission, no API

`service_billing` is in the catalog, `SERVICE_BILLING` is a seeded role,
`(dashboard)/services/billing/page.tsx` (271 lines) exists — and there is **no
`api/services/billing` route**. The page calls `jobs` and `jobs/bill` instead.

Worse: `paymentStatus` is written in exactly one place in the whole module —
`checkoff/route.ts:56` — and `checkoff` is dead code (§3.4). **Every normally-delivered job
stays `UNPAID` forever.**

**Decision:** if the app is to show paid/unpaid, `update-status` must set `paymentStatus`
when it sets `DELIVERED`, and a real billing route needs designing. If not, say so here and
drop `paymentStatus` from the mobile job type rather than shipping a field that is always
wrong.

## 2.3 Push notifications — nothing exists

`../push-notifications-plan.md` sits at the repo root. There is no device-token model, no
registration route, no send path. `api/services/notifications` only **logs** WhatsApp
messages a human already sent by tapping a `wa.me` link — it sends nothing.

This is greenfield, it is a large piece of work, and it is **not required for the port**.
Explicitly out of scope for this plan; raise it as its own.

---

# Phase 3 — Correctness bugs

Real bugs, none of which block the port. Fix alongside Phase 1 while each file is open.

## 3.1 "Today" is server-local, not IST

`src/lib/services/timezone.ts` exists, is correct, and is imported by exactly one file
(`services/manager/page.tsx`). Meanwhile:

| File | Lines |
|---|---|
| `api/services/incentives/route.ts` | 12, 15, 19 |
| `api/services/earn-sync/route.ts` | 16, 18 |
| `(dashboard)/services/assembly/page.tsx` | 52 — `new Date().toISOString().slice(0,10)` |
| `(dashboard)/services/counter/queue/page.tsx` | 206 |
| `(dashboard)/services/supervisor/page.tsx` | 264 |

On Vercel (UTC) the incentive day boundary is off by 5½ hours: between 00:00 and 05:30 IST
every mechanic sees yesterday's numbers, and the assembly screen queries the wrong date.

**Fix:** `getStartOfTodayIST()` / `getEndOfTodayIST()` / `getTodayIST()` at every site.

## 3.2 `bulk-status` bypasses two rules `update-status` enforces

`update-status` requires a `Review` before `DELIVERED` and a parts breakdown before `READY`
on paid job types. `bulk-status` validates `STATUS_FLOW` and nothing else — the same
transition, two different rule sets, and the bulk path is the lenient one.

**Fix:** extract the transition rules into `src/lib/services/transitions.ts` and call it from
both.

## 3.3 `checkoff` approve is a loop, not a transaction

`checkoff/route.ts:50` iterates and issues one `update` per job. Partial failure leaves jobs
half-delivered. Wrap in `prisma.$transaction`.

## 3.4 `checkoff` is dead code

It filters on `deliveryProposedAt: { not: null }` (line 13). **Nothing anywhere writes that
column** — it was fed by the nightly Zoho poll deleted in the cron removal. It returns an
empty list permanently, and no page calls it.

**Fix:** per the cron-removal pattern, either wire it to a button behind `requireFeature`, or
delete the route and the three `delivery*` columns. Do not leave it.

## 3.5 Smaller items

| # | File | Issue |
|---|---|---|
| a | `api/services/jobs/route.ts` | no `take` — returns every non-delivered job with three joins on every call. Add a limit before mobile clients on cellular hit it |
| b | `api/services/customers/route.ts:15` | `findFirst({ phone: { contains } })` on a 4-digit fragment returns an arbitrary match, then the counter auto-fills that customer's name onto a new job. Require 10 digits, or use `findMany` + disambiguate |
| c | `lib/services/constants.ts` | `JOB_TYPE` covers 6 of the `JobType` enum's 10 values — `PSVC`, `A50`, `A85`, `FULL` are missing, so a legacy job makes `JOB_TYPE[j.jobType].emoji` throw. The Expo app reads the same map |
| d | `api/services/jobs/assign/route.ts` | does not verify `mechanicId` is an active user with a workshop role, and writes no audit log — the only mutating job route that doesn't |
| e | `api/services/mechanics/route.ts:10` | filters `role.key === "SERVICE_MECHANIC"` only, so a supervisor who also works jobs can never be assigned one. Same at `incentives/route.ts:22` |
| f | `api/services/jobs/create/route.ts:69` | `estimatedHrs: 1` hardcoded on every job, making TAT-vs-estimate reporting meaningless |
| g | `(dashboard)/services/*` | 51 raw `fetch()` calls, 0 `apiFetch`/`apiTry` — CLAUDE.md's other non-negotiable |

---

# Phase 4 — The port (`bch-service-app`)

Only start once Phases 0 and 1 are merged.

## 4.1 Swap the data layer

`src/services/mockApi.ts` (324 lines) was deliberately written to mirror the REST surface
1:1, so this is close to a one-file change. `src/store/data.ts` calls `mockApi.*` and needs
no restructuring — repoint each function at `apiClient`.

| `mockApi` fn | Real endpoint |
|---|---|
| `getJobs(opts)` | `GET /api/services/jobs` — all five filters exist |
| `updateJobStatus(params)` | `POST /api/services/jobs/update-status` — **not** the `PATCH` in `apiClient` today |
| `saveNotes` | `POST /api/services/jobs/notes` |
| `deleteJob` | `POST /api/services/jobs/delete` |
| `saveReview` | `POST /api/services/reviews` (public — no bearer needed) |
| `getPrices` / `savePrice` / `deletePrice` | `GET/POST/DELETE /api/services/prices` |
| `getIncentives` | `GET /api/services/incentives` — same ₹100-per-10 rule |
| `getAssemblies` | `GET /api/services/assembly` |
| `getAudit` | `GET /api/services/audit` |
| `addAfterPhoto` / `deletePhoto` | `POST /api/services/upload` (multipart) / `upload/delete` |
| `getStaff` / `getStaffWorkload` | **per §2.1 decision** |
| `listUsers` / `login(name, pin)` | delete — there is one login, `mobile-login` |

Delete the mock-login fallback in `store/session.ts` (the `catch` in `loginWithCode`). It
silently logs a user in against `src/mock/users.ts` when the real call fails, which will mask
exactly the auth failures this phase needs to surface.

## 4.2 Build the three stub screens

`counter.tsx`, `assembly.tsx` and `supervisor.tsx` are 5-line `ComingSoon` components. The
APIs behind all three exist once Phase 0 lands.

| Screen | Web reference | Endpoints | Notes |
|---|---|---|---|
| **supervisor** | `services/supervisor/page.tsx` (436) + `supervisor/assign/page.tsx` (197) | `jobs`, `jobs/assign`, `jobs/bulk-status`, `mechanics` | smallest; do first — unblocks assignment |
| **assembly** | `services/assembly/page.tsx` (226) | `assembly` GET/POST | needs `expo-image-picker` + multipart |
| **counter** | `services/counter/page.tsx` (1009) | `jobs/create`, `mechanics`, `prices`, `customers`, `upload` | largest; phone lookup, price picker, KYC-skip rules, photo capture, WhatsApp inward message |

## 4.3 Close the JobCard parity gap

| | Web | Mobile |
|---|---|---|
| `JobCard` | 1097 lines | 366 lines |
| `PartsSelector` | 257 | 278 ✅ |

The web card does Zoho invoice verification, review capture before delivery, notification
logging, photo upload + delete, and notes. The mobile card does roughly a third.

Critically, the mock backend never made the app handle the delivery flow's real
preconditions. All three need UI:

- `400 { needsReview: true }` — review is mandatory before `DELIVERED`
- `400 "Invoice … is already used on job BCH-nnnn"`
- `400 "Add parts/service breakdown before marking Ready"`

## 4.4 WhatsApp

`src/lib/services/whatsapp.ts` builds `wa.me` URLs for the browser to open. The app already
has `src/lib/whatsapp.ts`; it needs `Linking.openURL` rather than `window.open`, then a
`POST /api/services/notifications` to log what was sent. No server-side send exists and none
is planned here.

---

# 5. Sequencing

```
Phase 0  ── blockers ─────────────┐  1 day     same branch
Phase 1  ── contract ─────────────┤  2–3 days  fix/service-module-readiness
Phase 3  ── correctness ──────────┘  1–2 days  (do while each file is open)
                │
Phase 2  ── decisions ─── §2.1 staff · §2.2 billing  ← BLOCKS Phase 4 scope
                │
Phase 4  ── port ────────────────── feat/service-app-port (other repo)
```

Phase 3 rides along with Phase 1 — both touch every route file, and splitting them means
reading each file twice. Phase 2 needs answers before Phase 4 is scoped, not before it starts.

# 6. Decisions required before starting

| # | Question | Recommendation |
|---|---|---|
| 1 | §2.1 — extend `User` for the staff roster, cut the screens to what exists, or defer? | **cut to what exists** |
| 2 | §2.2 — does `paymentStatus` become real, or come out of the mobile job type? | make it real in `update-status`; a permanently-`UNPAID` field is worse than no field |
| 3 | §3.4 — `checkoff`: wire to a button, or delete it and the three `delivery*` columns? | delete; nothing has written those columns since the cron removal |
| 4 | §0.4 — do mechanics need the price list? | if yes, grant `service_prices.view` to `SERVICE_MECHANIC` in the catalog |
| 5 | §2.3 — confirm push is out of scope for this plan | out of scope |

# 7. Definition of done

**BCH-Management**
- [ ] `npm run build` passes (Postgres running — three `/staff-lms/*` pages prerender)
- [ ] No `roleName ===` / `roleName !==` / role-name `includes()` anywhere under `src/`
- [ ] All 25 service routes: `try/catch` + `failure()` + zod + `successResponse` + a scoped logger
- [ ] No `console.log` added; no secret logged
- [ ] Every job-returning route uses the shared `JOB_INCLUDE`
- [ ] No bare `new Date()` for a business date under `api/services/` or `(dashboard)/services/`
- [ ] Every service page uses `apiFetch`/`apiTry`, never raw `fetch().json()`
- [ ] `/services/mechanic`, `/services/assembly` and `/services/counter` verified in a browser as a real `SERVICE_*` user — this is the §0.1 regression test
- [ ] Assignment, deletion, bulk status, price create and CSV export verified working as a Service Manager, and correctly refused as a Service Mechanic

**bch-service-app**
- [ ] `npx tsc --noEmit` clean (~2 min — give it a real timeout)
- [ ] `src/mock/*` and the `session.ts` mock-login fallback deleted
- [ ] Every screen handles loading, empty, error and populated
- [ ] Verified for all three roles: `SERVICE_MECHANIC`, `SERVICE_SUPERVISOR`, `SERVICE_MANAGER`
- [ ] A 401 mid-session lands on `/login`, not a blank screen
- [ ] The three delivery-flow 400s (§4.3) each render a usable message
- [ ] No new raw hex colours, no inline status emoji, no bare `new Date()`

---

## Appendix — what the app needs, and whether it exists

| App need | Endpoint | State |
|---|---|---|
| list jobs, filtered | `GET /api/services/jobs` | ✅ |
| change status / update bill | `POST .../jobs/update-status` | ✅ |
| create job | `POST .../jobs/create` | ✅ atomic token mint |
| save notes | `POST .../jobs/notes` | ✅ |
| delete job | `POST .../jobs/delete` | ⚠️ §0.2 |
| assign mechanic | `POST .../jobs/assign` | ⚠️ §0.2 |
| bulk status | `POST .../jobs/bulk-status` | ⚠️ §0.2, §3.2 |
| link invoice | `POST .../jobs/bill` | ✅ |
| assignable mechanics | `GET .../mechanics` | ⚠️ §3.5e |
| customer by phone | `GET .../customers` | ⚠️ §3.5b |
| price list | `GET .../prices` | ⚠️ §0.4 |
| save / delete price | `POST/DELETE .../prices` | ⚠️ §0.2 |
| incentives | `GET .../incentives` | ⚠️ §3.1 |
| assembly log | `GET/POST .../assembly` | ⚠️ §0.6 |
| audit trail | `GET .../audit` | ✅ |
| customer review | `GET/POST .../reviews` | ✅ public |
| photo up / down / delete | `.../upload`, `/photo`, `/delete` | ⚠️ §0.4, §0.5 |
| Zoho invoice lookup | `GET .../zoho` | ✅ |
| CSV export | `GET .../export` | ⚠️ §0.2 |
| login | `POST /api/auth/mobile-login` | ✅ JWT + permission map |
| **current user / refresh perms** | — | ❌ §0.1 |
| **single job by id** | — | ❌ §0.3 |
| **staff roster + workload** | — | ❌ §2.1 |
| **billing / payment state** | — | ❌ §2.2 |
| **push notifications** | — | ❌ §2.3, out of scope |
