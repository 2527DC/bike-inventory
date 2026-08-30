# Remove the App Logic and App Problems modules — plan

Status: pending — ready to execute. All three questions were settled 29 Aug 2026 (§9) and the full inventory was re-verified against the tree the same day (§10). Nothing blocks; nothing has been deleted yet.
Suggested branch: `chore/remove-app-logic-and-problems` (3 directories deleted, 4 files edited, one reseed).
Runs BEFORE `frontend-role-check-removal-plan.md` — see §10.

---

## 1. What is being removed

Two admin-only screens that document or track the application itself rather than the
business:

| Feature | Route | Backend | Table |
|---|---|---|---|
| **App Logic** | `/more/app-logic` | none — the page is a hardcoded constant | none |
| **App Problems** | `/more/problems` | `GET`/`POST`/`PATCH /api/problems` | `AppProblem` |

Everything either one touches goes: the pages, the route handler, the Prisma model, the
`User` back-relation, the RBAC module and its four permissions, the Settings card, and the
two documentation references that name them as live features.

> **"App issues" and "App Problems" are the same feature.** There is no separate `AppIssue`
> model, route or screen anywhere in the repository — a case-insensitive search for
> `app issue` / `app-issues` / `appIssues` across `src`, `prisma` and `docs` returns nothing.
> The screen is titled *App Problems*, the table is `AppProblem`, the module key is
> `problems`. One thing, three names.

### What is NOT being removed

Named explicitly, because the words overlap and a wrong deletion here is expensive:

- **`/vendor-issues`** and the `vendor_issues` module — brand/client quality issues raised
  against a *vendor*. Business data, unrelated. Stays.
- **`/more/alerts`**, `AlertRecipient`, `POST /api/alerts/scorecard` — operational alerting.
  Stays.
- **`AppSetting`** (`prisma/schema.prisma`) — a generic key/value settings table read by the
  storage provider and the integrations config. The `App` prefix is the only thing it shares
  with `AppProblem`. **Stays.**
- **`OpsActivityLog`**, `Update` — the activity feed. Stays.
- The other seven entries under `src/app/(dashboard)/more/` (`alerts`, `bins`,
  `brand-lead-times`, `brands`, `label-designer`, `whatsapp-templates`, and `page.tsx`
  itself). Only two of the nine go.

---

## 2. Why

**App Logic** is an 809-line React file whose entire body is a `LOGIC_SECTIONS` constant —
prose about how twenty other screens behave, typed as data and rendered as an accordion. It
is documentation that has to be hand-edited every time a screen changes, and it has not
been. It is already known to be wrong in at least three places:

| Flagged in | Says | Reality |
|---|---|---|
| `docs/data-flow-and-modules.md:167` | inbound Zoho fetch "creates inward transactions, increases product currentStock" | it does not — approving a bill creates a shipment awaiting receipt; stock moves later, when someone confirms arrival |
| `docs/implementation/completed/cron-removal-plan.md:75` | documents "Cron: Zoho Auto-Pull" as a live rule | there are no cron jobs; that plan flagged this entry for deletion and it was never deleted |
| `docs/implementation/completed/storage-implementation-plan.md:186` | references `/more/zoho` | that route no longer exists |

Its whole navigation section is also written in terms of role names (`CEO Tabs`,
`SUPERVISOR Tabs`) — a model this codebase deliberately abandoned when permissions moved
into the database. `docs/data-flow-and-modules.md` is the accurate, maintained version of
what this page tries to be.

**App Problems** is an in-app bug tracker — its own subtitle reads *"Log bugs, improvements,
or feature requests. Pull these into Claude Code to fix."* It is a scratchpad that duplicates
the real issue tracker, with no notification, no assignment, and no `DELETE` handler despite
the catalog advertising a `delete` action.

**Side benefit — and for App Logic it is not a side benefit, it is a live exposure.**

Both pages gate on role *names*, which CLAUDE.md calls a bug even when the build passes.
A full sweep on 29 Aug 2026 (`frontend-role-check-removal-plan.md` §5) found **23 such gates
across 20 files** — an earlier count of 17 was low. This plan removes 2 of them.

But the two are not equivalent, and the difference matters for scheduling:

| Page | Guard | Effect today |
|---|---|---|
| `/more/problems:25` | `role === "ADMIN" \|\| role === "CEO"` | allow-list → `role` is `""` → **hidden from everyone** |
| `/more/app-logic:581` | `if (role && role !== "CEO" && role !== "ADMIN")` | deny-list → `role` is `undefined`, so the guard is **skipped entirely** |

`session.user` carries no `role` field at all (`src/lib/auth.ts:103-105` sets only `userId`,
`roleKey`, `roleName`), so `role` is falsy — and a falsy value short-circuits the *whole*
condition on line 581 before either name is compared.

**`/more/app-logic` therefore renders for every signed-in user, not just admins.** It is an
809-line in-file dump of every screen, API endpoint, permission rule, role-tab layout and
Zoho flow in the application, and it is currently readable by anyone with an account. It
fetches nothing, so no API guard limits it — the page *is* the payload.

That does not make this urgent in a security sense (it is internal documentation, behind
login, and much of it is wrong). It does mean **deleting the page closes an exposure as well
as removing dead weight**, and it is the reason this plan now gates another one — see §10.

---

## 3. Complete inventory

Every location, verified by grep. Nothing else in `src/` references either feature.

### Delete outright

| Path | Notes |
|---|---|
| `src/app/(dashboard)/more/app-logic/page.tsx` | 809 lines — delete the directory |
| `src/app/(dashboard)/more/problems/page.tsx` | delete the directory |
| `src/app/api/problems/route.ts` | 65 lines — `GET`, `POST`, `PATCH` |

### Edit

| Path | Line(s) | Change |
|---|---|---|
| `prisma/schema.prisma` | 1568–1579 | delete `model AppProblem` |
| `prisma/schema.prisma` | 305 | delete `reportedProblems AppProblem[] @relation("ProblemReportedBy")` from `User` |
| `prisma/rbac-catalog.ts` | 486–494 | delete the `problems` module entry |
| `src/app/(dashboard)/settings/page.tsx` | 56–62 | delete the `/more/app-logic` entry from `ENTRIES` |
| `docs/data-flow-and-modules.md` | 167–170 | delete the ⚠️ note about `/more/app-logic:182` — with the page gone, the contradiction it warns about is gone too |
| `docs/data-flow-and-modules.md` | 315 | remove `· /more/problems` from the Admin nav line |

### Leave alone, deliberately

| Path | Why |
|---|---|
| `docs/implementation/completed/cron-removal-plan.md:75` | a shipped plan is a record of what was true then — completed plans are not rewritten |
| `docs/implementation/completed/storage-implementation-plan.md:186` | same |
| `src/components/app-sidebar.tsx`, `src/app/(dashboard)/more/page.tsx` | both build their menus from the `modules` table, not from any list in source — removing the catalog entry and reseeding *is* the change |
| `src/lib/module-icons.ts` | `AlertCircle` is still used by other modules |

### Nothing grants it

`problems` appears **nowhere** in `ROLE_CATALOG` — no seeded role asks for it. Only ADMIN
holds it, and only because ADMIN is granted every permission that exists. So no role's
capability set changes in a way anyone will notice.

---

## 4. Order matters

Three couplings decide the sequence. Getting them wrong produces errors that name a
constraint rather than a cause:

1. **`prisma generate` removes `prisma.appProblem` from the client.** If the schema loses the
   model while `src/app/api/problems/route.ts` still exists, typecheck fails on three lines
   that look unrelated to the schema edit. **Delete the route first**, in the same commit.
2. **A relation field pointing at a deleted model fails schema validation.**
   `User.reportedProblems` and `model AppProblem` must go together, or `prisma generate`
   refuses to run at all.
3. **`seed-rbac.ts` prunes from the catalog.** Its stale-module `deleteMany` removes every
   `Module` row whose key is not in `MODULE_CATALOG`, cascading to that module's permissions
   and to any `RolePermission` rows pointing at them. So the catalog edit must land *before*
   the seed runs — the seed is what actually deletes the four `problems` permissions from the
   database.

---

## 5. Steps

Stop the dev server first — `prisma generate` fails with `EPERM` while it holds the query
engine.

### Step 1 — confirm the table is empty

`AppProblem` rows are staff-written text that exists nowhere else, and `db push` destroys
them. The project is in development and the database is expected to be empty, so this is a
confirmation rather than a backup:

```sql
SELECT count(*) FROM "AppProblem";
```

**Zero — proceed.** Anything else, stop and export before continuing:

```
psql "%DATABASE_URL%" -c "\copy (SELECT * FROM \"AppProblem\" ORDER BY \"createdAt\") TO 'app-problems-backup.csv' CSV HEADER"
```

### Step 2 — delete the code

```
src/app/(dashboard)/more/app-logic/     (directory)
src/app/(dashboard)/more/problems/      (directory)
src/app/api/problems/                   (directory)
```

### Step 3 — remove the Settings card

In `src/app/(dashboard)/settings/page.tsx`, drop the whole object:

```ts
{
  href: "/more/app-logic",
  title: "App Logic",
  description: "How each screen behaves, and which API it calls",
  icon: "ClipboardList",
  module: "settings",
},
```

Nothing else needs renumbering — `ENTRIES` is a plain array filtered by `can()`.

### Step 4 — remove the RBAC module

In `prisma/rbac-catalog.ts`, delete the `problems` entry (`key`, `label`, `description`,
`icon`, `route`, `group`, `sortOrder`, `actions`). `sortOrder: 550` simply becomes unused —
the surrounding bands (522 for `settings/integrations`, 700 for Staff LMS) do not need to
shift, and shifting them would churn every other module's row for no gain.

### Step 5 — remove the model and the relation

In `prisma/schema.prisma`:

- delete `model AppProblem { … }` (1568–1579)
- delete the `reportedProblems` line from `User` (305)

Both, or neither. See §4.2.

### Step 6 — regenerate, reseed, push

```
npm run db:generate      # prisma generate — dev server must be stopped
npm run db:seed:rbac     # prunes the problems module + its 4 permissions + any grants
npm run db:push          # drops the AppProblem table
```

`prisma db push` will report that dropping `AppProblem` loses data and ask to confirm. That
confirmation is the whole point of Step 1 — do not reach for `--accept-data-loss` until the
export exists.

> This project has **no `prisma/migrations/` directory** — schema is applied with `db push`,
> not migrations. There is no migration file to write and none to review.

---

## 6. Verification

### Static

```
grep -rni "app-logic|appProblem|api/problems|more/problems" src prisma docs/data-flow-and-modules.md
```

Must return nothing. (Matches inside `docs/implementation/completed/` are expected and
correct — see §3.)

```
npm run build
```

Must pass. **The build no longer needs a database** — the three `/staff-lms/*` pages that used
to be prerendered server components are `"use client"` as of
`completed/ci-build-database-dependency-plan.md`, so `next build` opens no connection.

### In the browser

| Check | Expected |
|---|---|
| `/settings` as ADMIN | no **App Logic** card; Storage, Integrations, Alerts, Bins, Label Designer, WhatsApp Templates all still present |
| `/more` as ADMIN | the Admin group no longer lists **App Problems**; `/team`, `/team/permissions`, `/settings` unaffected |
| sidebar | same — it reads the same module list |
| `/more/app-logic` typed directly | 404 |
| `/more/problems` typed directly | 404 |
| `/api/problems` | 404 |
| `/team/permissions` | the **App Problems** row is gone from the permission matrix; every other module still renders |
| any other screen | unchanged — nothing outside these two features read either one |

### Database

```sql
SELECT * FROM "Module" WHERE key = 'problems';   -- 0 rows
SELECT to_regclass('"AppProblem"');              -- NULL
```

---

## 7. Risks

| Risk | Severity | Handling |
|---|---|---|
| Staff-written problem reports destroyed | **does not apply** — development database, no real data (see §9) | Step 1 confirms the count is zero before any schema work |
| Someone relied on App Logic as onboarding material | low | `docs/data-flow-and-modules.md` is the accurate replacement and is already maintained — point people there |
| A user session holds a cached `problems` grant | none | permissions are read from the database per request, never carried in the JWT — the next request reflects the deletion |
| `prisma generate` fails with `EPERM` | nuisance | stop the dev server first |
| Reseeding RBAC reverts a role an admin edited by hand | none | `seed-rbac.ts` is create-only for non-ADMIN roles; existing roles' grants are left untouched |

---

## 8. Rollback

Everything is one commit and one seed run:

```
git revert <commit>
npm run db:generate
npm run db:seed:rbac
npm run db:push
```

`db push` recreates `AppProblem` empty. The CSV from Step 1 is the only way to get the rows
back — restore it with `\copy … FROM`.

---

## 9. Decisions — settled 29 Aug 2026

All three questions this plan opened with are answered. Recorded here so the next reader
does not reopen them.

| Question | Decision |
|---|---|
| Salvage any App Logic content? | **No.** Nothing from the App Logic page is carried into the application or into `docs/`. It goes entirely. |
| Keep its table? | **There is no table.** App Logic is a hardcoded constant in one `.tsx` file and reads nothing from the database. `AppProblem` is the only table either feature owns, and it is dropped. |
| Replace `/more/problems`? | **No.** Nothing takes its place — the Admin group simply has one fewer entry. |

**Database state.** The application is still in development and the database holds no real
data, so Step 1's export is a formality. Run the count, confirm it is zero, and proceed —
the one irreversible risk in this plan does not apply.

**Status.** Plan approved in shape, execution not yet started. Nothing has been deleted.

---

## 10. This plan now gates another one

`frontend-role-check-removal-plan.md` fixes the 23 dead role-name gates described in §2.
Its Q2 asked whether to fix `/more/app-logic` and `/more/problems` there, given both are
deleted here. **Owner's decision, 29 Aug 2026: skip both in that plan and let this one delete
them.** That plan's scope dropped to 21 sites in 18 files as a result.

So the ordering is fixed: **this plan runs first.** Two consequences worth stating plainly.

1. **`/more/app-logic` stays readable by every signed-in user until this plan runs.** That
   was an acceptable trade when this was expected to happen promptly. If it slips, the right
   response is to reopen that plan's Q2 for `app-logic` alone — one `usePermissions` call to
   close it in the meantime — rather than leave it sitting. `/more/problems` carries no such
   urgency: it is hidden from everyone, so delay costs nothing but an unusable feature.
2. **Nothing in this plan depends on the other one.** The dependency runs one way. This plan
   can be executed today exactly as written.

### Re-verified 29 Aug 2026

Every path, line number and mechanism in §3 through §6 was checked against the tree:

| Claim | Result |
|---|---|
| `more/app-logic/page.tsx` is 809 lines | ✓ |
| `api/problems/route.ts` is 65 lines, `GET`/`POST`/`PATCH` | ✓ |
| `model AppProblem` at `schema.prisma:1568` | ✓ |
| `User.reportedProblems` at `schema.prisma:305` | ✓ |
| `problems` module in `rbac-catalog.ts` | ✓ at **486–494** (§3 says 485–494) |
| `problems` appears in no `ROLE_CATALOG` grant | ✓ — its only two occurrences are the module's own `key` and `route` |
| `/more/app-logic` entry at `settings/page.tsx:56-62` | ✓ |
| `docs/data-flow-and-modules.md` lines 167 and 315 | ✓ |
| No other `src/` reference to either feature | ✓ — only the three files to delete, plus the settings entry and the catalog row |
| §4.3 — the seed prunes stale modules and cascades | ✓ `seed-rbac.ts:143-149` deletes stale modules; `Permission.module` cascades (`schema.prisma:74`) and `RolePermission.permission` cascades (`:108`), so the module's 4 permissions and any grants go with it |

The inventory is complete. Nothing was found that §3 does not already list.
