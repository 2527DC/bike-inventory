# Implementation plans

Plan documents, filed by whether the work is done.

```
docs/implementation/
  ├── pending/     approved or proposed, not finished
  └── completed/   shipped and verified
```

Reference documents that are not implementation plans stay at `docs/` root:
`data-flow-and-modules.md`, `dead-code.md`, `schema-review.md`, `phase2-architecture.md`,
`water-flow-chart.md`, and the `agents/` board.

---

## The status line — required, and machine-read

Every plan **must** carry a status line in its first 15 lines. The first word after
`Status:` must be exactly one of three tokens. Anything after an em-dash is free text.

```
Status: pending
Status: in-progress
Status: completed — 28 Aug 2026, storage provider is switchable from Settings
```

The token is strict because it is parsed. Before it existed, plans wrote their status as
prose — *"PLAN ONLY — not implemented"*, *"plan, plus the RBAC groundwork already seeded"* —
which no script can classify, and which drifted out of date without anyone noticing. Two
files sat in `completed/` still claiming they were not implemented.

## The branch line — required, directly under the status

Every plan **must** name its branch, on the line after `Status:`:

```
Branch: **`refactor/zoho-endpoint-registry`** — create it with exactly this name, off `main`.
Branch: **`perf/single-auth-query-v2`** — implemented here.
```

One line, one branch name, and the name written here is the name to create. It answers two
questions the file previously could not: *where do I run this?* before the work, and *where
did this ship?* afterwards. If the work lands somewhere else, correct the line rather than
leaving it describing the intent.

Do not bury the branch in prose halfway down the document — this line is where the next
person looks.

## How a plan moves

**Normal path — run `/ship-plan <file>`.** It sets the status to `completed`, moves the
file, refreshes the tables below, and stages the result.

**Safety net — a `PostToolUse` hook.** If you edit a plan in `pending/` and change its
status line to `completed`, `.claude/hooks/plan-status.cjs` moves the file for you and
refreshes the tables. The move is announced, never silent.

**Placement is enforced.** A `PreToolUse` hook blocks writing a `*-plan.md` anywhere under
`docs/` except `docs/implementation/`. Prevention rather than tidying up afterwards.

Regenerate the tables by hand at any time:

```
node .claude/hooks/plan-status.cjs --sync
```

---

## Current contents

The two tables below are generated from disk. Edit the descriptions freely — they are
preserved across regeneration — but do not remove the marker comments.

### completed/

<!-- BEGIN:completed -->
| Plan | Shipped |
|---|---|
| `analytics-merge-plan.md` | store analytics merged; /analytics, CountEvent and the device endpoints are live |
| `app-logic-and-problems-removal-plan.md` | 30 Aug 2026, `/more/app-logic`, `/more/problems`, `/api/problems`, the `AppProblem` model and the `problems` module all deleted (commit `63d1d37`). The table never existed in this database, so `db push` dropped nothing — the schema had drifted ahead of it |
| `ci-build-database-dependency-plan.md` | 29 Aug 2026, the three Staff LMS pages became client components so the build opens no database connection, and the CI trigger no longer filters on `main` |
| `cron-removal-plan.md` | 28 Aug 2026, all cron jobs and screen polling removed |
| `database-reset-preserving-integrations-plan.md` | 29 Aug 2026, closed WITHOUT implementation — only `ZOHO_BOOKS` was ever connected and its row is backed up by hand in `.env`, so the export/restore scripts were unnecessary. Kept for §0 and the reset runbook |
| `frontend-role-check-removal-plan.md` | 30 Aug 2026, all 21 dead role-name gates replaced with permission checks across 18 files, plus `activity.approve` in the catalog. 19 denied everyone; **2 failed OPEN** — `/price-correction` was rendering for every signed-in user, so fixing it removes access. **Not yet tested as a non-admin**, which is the only test that proves that half |
| `master-data-screens-and-filter-ui-plan.md` | 30 Aug 2026, three of four parts. **A** product delete — soft by default, hard delete behind blocker counts, plus restore (`eda3013`); **C** `BrandLeadTime` folded into `Brand.leadDays` with `/more/brands` as the master (`1e4ed73`); **D** the filter sheet became a right drawer across all 12 screens (`78d388f`). **Part B (Categories) was moved out, not built** — it is now `pending/sidebar-categories-and-accounts-trim-plan.md`. Q1 was answered by the implementation; §7's other questions went with Part B |
| `s3-cors-upload-failure-plan.md` | 30 Aug 2026, on `perf/single-auth-query-v2`. Browser uploads died at the S3 preflight because the bucket allowed no origin — and the storage self-test could not catch it, since every step ran server-side where no preflight exists. Three fixes: a size-capped fallback through `/api/upload` so a missing CORS rule no longer breaks uploads, `applyCors` merging origins instead of replacing them (it used to revoke whichever environment pressed it last), and a real CORS step in the test. **§8 not yet run** — build, plus a browser upload before and after pressing Apply CORS |
| `service-merge-plan.md` | bch-service merged; /services/* and the SERVICE_* roles are live |
| `sidebar-categories-and-accounts-trim-plan.md` | 31 Aug 2026, both parts, `e0cff4f` on `feat/categories-module`. Bills & Payments and Expenses left the sidebar via `route: null` — hidden, NOT removed, because `bills` is referenced by 20 files including the Zoho pull and settlement. The `categories` module (Purchase, 225), `/more/categories` and the missing PATCH/DELETE/merge routes all exist; merge refuses when the source has children, delete refuses with counts, and GET stayed on `stock.view` so no product form loses its dropdown. Seeded. **§6 browser pass NOT run** — the screen has never been opened |
| `single-auth-query-plan.md` | `getAccess` is the single reader of the User row: **3 database round trips per guarded request → 1**, across 190 route files, with no route file touched. `getCurrentUser` reads `getAccess` and is `cache()`d, and the next-auth `jwt` callback no longer re-reads the row for a role label nothing authorises on. Code complete; **`npm run build` not yet run**, uncommitted on `perf/single-auth-query-v2` |
| `stock-management-module-and-zoho-item-removal-plan.md` | 2 Sep 2026, all five parts on `refactor/stock-management-module` (`2ed0202`, `7af57e0`, `91fdef8`, `c02dff9`, `0776795`). **A** the Zoho *item* import is gone — both entry points, the whole uncalled `api/zoho/import/` tree, `backfill-size`, `parseBicycleSize`, the `/settings/integrations` pull card and its `pull-review` page, plus the `/ai` page and its three AI routes. The `trigger-pull` / `pull-review` / `approve` **APIs survive**: `/inbound`, `/bills`, `/receivables` and `/deliveries` each run that sequence inline. `api/ai/dashboard-insights` turned out to contain no AI at all and to feed the Stock Value and Low Stock tiles, so it was **renamed** to `api/dashboard/stats` rather than deleted. Two things the plan marked for deletion were **kept on the owner's decision** — `import-placeholders.ts` and `BooksClient.getItem` — because the bill import remains a product-creation path (§16.1). **B** the `ProductType` enum is now a table (`name`, `sortOrder`, `isActive`) with a `/product-types` screen; `Product.type` became a required `productTypeId` and both indexes were repointed. The plan predicted the build would pass while the screens broke, and §15.2/§15.3 were right — ~23 call sites, not ten. **C** `stock`, `product_types`, `stock_audit`, `inbound`, `deliveries` and `transfers` are children of a new `stock_management` parent, **keys unchanged so every role grant survived**; the parent carries a real route because the phone bottom bar filters to roots. New hub page at `/stock-management`. **D** `/customers` — the list screen the `customers` module always claimed; the API was already complete, only the page was missing, and outstanding balance is one `groupBy` per page. **E** the catalog was loaded from the owner export, active rows only. Seeded: 49 modules, 179 permissions. `npm run build` passes. **Two things still owed:** the §13 browser checklist has never been walked (§17.7, §18.5, §20.5), and `stock_management.view` plus the `product_types` actions are granted to ADMIN only — someone must grant them on `/team/permissions`. Supersedes `imported-product-data-quality-plan.md` |
| `storage-implementation-plan.md` | 28 Aug 2026, runtime-switchable storage provider and Settings module |
| `store-hierarchy-and-team-plan.md` | 30 Aug 2026, all six phases. The `StockLocation` enum is gone — `Store` and `Warehouse` are tables, `/stores` administers them behind a `store_management` parent module, and `/stock/by-location/[code]` resolves either level. The §2.4 database reset was skipped as unnecessary and no data was lost. **The §6 browser pass has not been run** — an audit after the phases were called done found five bugs the green build could not see |
| `zoho-config-consolidation-plan.md` | 29 Aug 2026, three Zoho config tables and four clients collapsed into one `IntegrationConfig` row per provider, one `IntegrationClient` base class and three `[provider]` routes |
| `zoho-provider-endpoint-registry-plan.md` | 31 Aug 2026, all four parts (`67be82d`, `7c16903`, `631db1d`, `0cff195`). **A** `endpoints.ts` lists all 16 endpoints + 2 OAuth grants and `apiCall` logs a stable key instead of an interpolated URL — it also stopped logging entire request bodies. **C** clients are request-scoped, so the approve loop pays one `init()` instead of one per record. **D** the four raw `apiCall` sites are gone and `apiCall` is `protected`, so the compiler enforces the boundary. **B** 34 sites through the factory — which **revived two Zoho writes that had never worked**: inbound's item push and the DELIVERED bill push both skipped `init()` and failed silently. **Part E (batch-size guidance on the approve screen) NOT built**; §7's manual checks unrun |
| `zoho-pull-timeout-plan.md` | 30 Aug 2026, both `items` loops and `contacts` batched into a fixed number of queries; `maxDuration` 30 -> 60 (headroom, not the fix). Commits `8f143d2`, `947781f`. **§8 not yet run** — the acceptance test is a real 90-day pull returning without a 504, plus the `ZOHO_BOOKS` fallback exercised separately |
<!-- END:completed -->

### pending/

<!-- BEGIN:pending -->
| Plan | State |
|---|---|
| `ai-provider-config-and-task-routing-plan.md` | nothing built. Moves the AI provider key and the per-task model out of `.env` and out of hardcoded strings into three tables behind a `settings_ai` module, so switching provider for a month is a dropdown rather than a deploy. Writing config back to `.env` at runtime was **considered and rejected** (§2) — Node reads `process.env` once per process, so it would mean "change it, then restart". Adds `AiCallLog`, without which the owner's month-over-month billing comparison is impossible: audit F9 records that real spend today is **unknown**. Follows `StorageConfig` for the 30 s cache, the env bootstrap fallback and the activate-guarded provider switch, and `IntegrationConfig` for never serialising the secret at all. **Two blocking questions (Q1, Q2)**, and §11.1 argues this should run AFTER the audit's F1/F2/F3 data-loss fixes |
| `ledger-merge-plan.md` | schema, RBAC, backend and frontend shipped; PDF statement import and the 219-gap migration remain |
| `notifications-and-settings-rbac-plan.md` | nothing built, no file changed, no dependency installed. Two halves. **Part A** collapses Settings into **one module whose actions name the section** (`storage_edit`, `whatsapp_edit`, `push_edit`, `email_edit`): `settings_storage` and `whatsapp_templates` are deleted as modules, `zoho` gets `route: null` so it leaves the sidebar while all **19** of its guards elsewhere stay untouched — the same routeless-and-childless skip that already hides `cost_price`. §A3 lists all **10** guard call sites with line numbers. **Part A is destructive**: `seed-rbac.ts:143-169` deletes stale modules and permissions, and `Permission.module` + `RolePermission.permission` are both `onDelete: Cascade`, so every custom role holding those grants loses them **the moment the re-seed runs** — and ADMIN is re-granted everything, so it looks fine to whoever tests as an admin. Hence the two-phase migration in §A4, whose Phase 2 should be **deleted rather than written** if the read-only Phase-1 query returns zero rows (Q2). Three further findings: the action union lives in **three files with no compile-time link**, and `ACTION_ORDER` sorts with `indexOf` so a missing action gets `-1` and renders **ahead of `view`** rather than erroring; WhatsApp templates are already inconsistent today, **read** on `whatsapp_templates.view` but **written** on `settings.edit` via `PUT /api/alerts/config`; and §E.2's personal-preferences surface **has nowhere to live** — this app has no profile or account page at all (Q6). **Part B–F** adds push and email. **AWS was considered and rejected** (§2.1): Android has exactly one push transport, FCM, so SNS means creating Firebase anyway, then maintaining per-device SNS endpoints, and *still* building a separate VAPID path because SNS has **no browser transport** — FCM alone covers app and web. Email is SMTP via a Gmail App Password, needing **nothing from Google Cloud**; Gmail OAuth was rejected because `gmail.send` is a Google **restricted** scope (verification + third-party security assessment) and the Testing-mode escape **expires the refresh token every 7 days** — both walls vanish on Workspace, neither does on a free `@gmail.com`. The ~500/day free Gmail cap is why email defaults **off** per event while push defaults on. §D.3 records the cost nobody should discover late: **Android WebView does not implement the Web Push API**, so the service worker reaches desktop browsers and *not* the app — the app needs the native plugin, a rebuild and a **reinstall on every device**, which breaks the current "web changes reach the app instantly" property of `server.url`. Five models, two named deviations from `database-architect.md`. Per the owner's D2 the design is **event-only, no scheduler**, honouring the no-cron rule with the loss stated plainly: nothing will ever report an overdue bill or a stale sync. **§9 collides with `ai-provider-config-and-task-routing-plan.md`** — its §8 creates a `settings_ai` module following `settings_storage` *"exactly"*, the very pattern this plan abolishes; one of the two must be amended. **Three blocking questions (Q1, Q2, Q6)** |
| `pdi-module-plan.md` | nothing built, no schema changed. Two blocking questions (Q11, Q17) |
| `sequence-race-fix-plan.md` | five sites allocate unique numbers with a read-then-write race |
| `service-module-mobile-readiness-plan.md` | what /api/services/* needs before bch-service-app can be pointed at it |
| `staff-lms-authoring-and-ai-plan.md` | course creation is **implemented and unreachable**: `staff_lms_learning.create` exists, ADMIN holds it, `POST /api/staff-lms/learning/courses` works — but **7 of the 8 API paths the admin screens call do not exist** (ported from the standalone app, never rewired to `learning/` and `manage/`), the admin screens are in no module, and `/api/auth/me` — fetched by three service screens — was never built, so NextAuth's catch-all answers the **400** being reported. Also records a second `getCurrentUser` in `lib/auth.ts` that decides LMS admin by comparing role KEYS off the session token, which CLAUDE.md bans. **Part A is a bug fix, unblocked.** Part D argues AGAINST a vector database (Postgres `pg_trgm`/`tsvector` first, `pgvector` if ever needed, and Anthropic has no embeddings endpoint) and for AI on content GENERATION with a human approval step. Four questions in §7 |
| `stock-and-master-data-ux-plan.md` | the owner’s five, one branch and one commit per phase. **Two are already done** (S3 fix, stock-audit crash). Remaining: the filter becomes a right drawer (**12 screens**, component-only), `/more/brands` becomes the brand master with lead time inline, and product deactivate / restore / delete-with-refusal plus a status filter. Four questions in §2, none blocking |
| `zoho-import-reliability-and-observability-plan.md` | from a live 504 on `pull-review/approve`. Five parts: S3 `Content-Length`, `apiFetch` in 6 screens, batching the import loop (~5 round trips per record to ~8 total), the three swallowed failures in `/deliveries`, and integration credentials surviving a disconnect. **Five questions in §8 block the logging half only** |
<!-- END:pending -->

---

## Caveat: two files were filed against their own status lines

Status headers in this repo had gone stale. These two were classified by **what the code
actually shows**, not by what the document claimed about itself:

- **`analytics-merge-plan.md`** said *"Status: plan. Nothing implemented yet."* — but the
  `analytics` module, `/analytics` screens, `CountEvent`, `FootfallDaily` and the device
  ingest endpoints all exist. Filed as completed.
- **`service-merge-plan.md`** said *"Status: plan, plus the RBAC groundwork already
  seeded"* — but CLAUDE.md documents `/services/*` as the merged former `bch-service` app,
  and the screens, models and `SERVICE_*` roles are all present. Filed as completed.

Both status lines have since been corrected. This is the failure mode the strict token and
the hooks above exist to prevent.
