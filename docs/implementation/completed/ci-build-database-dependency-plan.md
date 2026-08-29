# CI Build fails without a database — plan

Status: completed — the three Staff LMS pages are client components and the CI trigger no
longer filters on `main`. Verified 29 Aug 2026.

---

## 1. The symptom

`npm run build` fails whenever no database is reachable:

```
Error occurred prerendering page "/staff-lms/playbooks"
PrismaClientInitializationError: Can't reach database server at `localhost:5432`
Export encountered an error on /(dashboard)/staff-lms/playbooks/page
⨯ Next.js build worker exited with code: 1
```

Observed locally on 28 Aug 2026 when Postgres happened to be stopped. It will reproduce in
GitHub Actions on **every** run, because the CI runner has no Postgres at all.

## 2. Why it happens

Next.js decides per page whether to render it **once at build time** (static) or **per
request** (dynamic), and it prefers static wherever it can.

Three pages are server components that call Prisma directly and never read the session,
cookies or headers. With no per-request input, Next concludes it can bake them at build
time — so the build opens a database connection.

| Route | Build output |
|---|---|
| `/staff-lms/playbooks` | ○ static, queries Prisma |
| `/staff-lms/product-learning` | ○ static, queries Prisma |
| `/staff-lms/products` | ○ static, queries Prisma |

**Only these three.** The application has 107 static and 285 dynamic routes; of all 107
static ones, exactly these three touch the database. Every other Staff LMS page — including
`/staff-lms/products/[id]` and `/staff-lms/playbooks/[id]` — is already dynamic, because a
`[param]` segment forces it.

> An earlier reading of this put the count at 23, inferred from source by looking for
> server components that import Prisma and do not read the session. That method was wrong:
> 20 of those pages end up dynamic for reasons the source does not show. **The build's own
> route table is the authority**, not a grep.

## 3. Why CI fails where a developer machine usually does not

`.github/workflows/typecheck.yml` gives the Build job placeholder credentials:

```yaml
DATABASE_URL: postgresql://ci:ci@localhost:5432/ci
```

with **no Postgres service container**. The comment above it states the assumption that made
that safe:

> *"Every page in this app is a client component that fetches at runtime, so nothing queries
> a database during the build. If that ever stops being true, this job needs a real service
> container rather than a longer placeholder."*

That assumption stopped being true when the Staff LMS pages landed. The comment even names
the required fix. A developer only avoids it because Postgres is usually already running.

## 4. Second defect in the same three pages

Independent of CI: a statically prerendered page **bakes its data at build time**. Content a
Staff LMS Admin adds — a playbook, a product — will not appear until the next deploy. The
screens exist to be edited at runtime, so this quietly defeats their purpose.

`/staff-lms/products/[id]` is dynamic and shows current data, while the `/staff-lms/products`
list that links to it is frozen. Adding a product means it is reachable by URL but invisible
in the list.

## 5. The fixes considered, and what was actually done

### Option A — give CI a database *(implemented 28 Aug, then reverted)*

Add a `postgres` service container to the Build job, point `DATABASE_URL` at it, and run
`prisma db push` before building. The three pages prerender against empty tables, which
succeeds.

- ✅ Keeps the pages static, as decided on 28 Aug 2026
- ❌ Does not fix §4 — content stays frozen until redeploy
- ❌ Keeps a database in the build path permanently
- ❌ Adds roughly 20–30s to the job

This was built and worked. It was then removed, because it treated the symptom.

### Option B — `export const dynamic = "force-dynamic"` on the three pages

Three lines. The build stops needing a database; the pages render per request. Rejected on
29 Aug: it fixes the build, but the pages stay server-rendered, and the ask was to remove
server rendering from them entirely.

### Option C — make the three pages client components *(CHOSEN, implemented 29 Aug)*

Convert them to `"use client"` components that fetch from the API, which is the pattern
**130 of this app's 153 pages already use**. The 200 `force-dynamic` declarations in this
repo are all in `route.ts` files — no page used it, so Option B would have introduced a
pattern rather than followed one.

**No new API routes were needed.** Both already existed and were permission-guarded:

| Endpoint | Guard |
|---|---|
| `GET /api/staff-lms/learning/playbooks` | `staff_lms_learning` / `view` |
| `GET /api/staff-lms/products` | `staff_lms_products` / `view` |

- ✅ Fixes §4 — admin-added content appears immediately
- ✅ Build opens no connection at all, so CI needs no database and no `db push` step
- ✅ Loading, error and empty states now exist; the server versions could not fail visibly
- ❌ Each page load costs an API round trip rather than being served from cache

#### What it cost, beyond the three pages

The server pages passed their data through `products={serialized as any[]}`. That cast was
suppressing two genuine type errors, both of which surfaced the moment it was removed:

| Type | Was | Should be | Why |
|---|---|---|---|
| `Competitor.price` | `number` | `number \| null` | `lmsCompetitorSchema` declares `.nullable()` |
| `ProductReview.rating` | `number` | `number \| null` | `lmsReviewSchema` declares `.nullable()` |

The UI already wrote `c.price?.toLocaleString(...)`, so it had always expected null — only
the type disagreed. Fixing `rating` then exposed `Array.from({ length: r.rating })` in both
copies of `product-detail.tsx`, which yields an empty star row when the rating is null.
Now `r.rating ?? 0`.

#### Verification actually run

`npm run build` with `DATABASE_URL` pointed at a **dead port** (`localhost:5433`):

```
✓ Compiled successfully in 99s
✓ Generating static pages using 3 workers (160/160) in 12.6s
EXIT=0
```

The three routes still appear as `○ (Static)` in the route table, and that is now correct:
a client component's shell is prerendered as static HTML, but it runs **no Prisma query** at
build time. The dead port is the proof — before this change the same command died with
`PrismaClientInitializationError`.

## 6. Also fixed in the same pass: CI does not run on stacked PRs

```yaml
on:
  pull_request:
    branches: [main]
```

This fires only for PRs targeting `main`. The current branch chain targets each other:

```
feat/staff-lms              -> main                    CI runs
chore/remove-cron-jobs      -> feat/staff-lms          NO CI
feat/storage-settings       -> chore/remove-cron-jobs  NO CI
refactor/integration-config -> feat/storage-settings   NO CI
```

Three of four PRs get no verification at all. Worse, once the checks are made **required**,
those three become permanently unmergeable — a required check that never runs leaves the PR
waiting for a result that will never arrive.

Fix: drop the `branches` filter so the workflow runs on every pull request.

## 7. Order of operations — this matters

1. Fix the trigger (§6) and the Build job (§5A).
2. Open the pull requests.
3. Confirm both checks go green.
4. **Only then** enable the ruleset on `main` requiring `Type check` and `Build`.

Enabling required checks before they can pass locks every PR, including the one that would
fix it.

## 8. Verification — what was actually confirmed

Option C was chosen, so §7's ordering and the service-container step it sequences no longer
apply: **CI needs no database at all**, and there is nothing to stage before enabling
required checks.

| Claim | How it was confirmed | Result |
|---|---|---|
| The build opens no connection | `npm run build` with `DATABASE_URL` on a dead port (`localhost:5433`) | ✓ `EXIT=0`, 160/160 pages |
| The three pages no longer query Prisma | `grep -c prisma` on each of the three `page.tsx` files | ✓ `0` in all three |
| They are client components | each file opens with `'use client'` plus a comment saying why | ✓ |
| The Build job has no database | no `services:` block and no `DATABASE_URL` in `.github/workflows/typecheck.yml` | ✓ |
| A PR whose base is not `main` triggers CI | the `branches: [main]` filter is gone; trigger is `types: [opened, synchronize, reopened]` | ✓ |

The three routes still appear as `○ (Static)` in the route table, and that is now correct: a
client component's shell prerenders as static HTML while running **no Prisma query** at build
time. The dead port is the proof — before this change the same command died with
`PrismaClientInitializationError`.

## 9. The open decision, resolved

The plan asked: *"Does §4 matter to you — should an admin's new playbook appear without a
redeploy?"*

**Option C answered it by making the question moot.** The pages fetch at runtime, so
admin-added content appears immediately. §4 is fixed, not traded away — which is why Option A
was reverted rather than shipped alongside it.

## 10. What is left, and it is not a code change

Making the checks **required** is a GitHub branch-protection setting, not a file in this repo.
The workflow header records the command:

```
gh api -X PUT repos/:owner/:repo/branches/main/protection \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=Type check' \
  -f 'required_status_checks[contexts][]=Build'
```

Safe to run now: both checks pass and both run on every PR, so enabling the rule cannot lock a
branch the way §7 warned about.
