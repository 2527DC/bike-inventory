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
| `imported-product-data-quality-plan.md` | **Parts 0, A, C and E shipped** on `fix/import-data-quality`; build passes. Placeholder brand/category now render as absence rather than as facts, a server-side **Needs details** filter feeds the existing bulk assign, wheel size is parsed from the product name (`26''BICYCLE…` → `26"`) at import plus a one-off backfill behind `stock.edit`, and bin joins bulk assign behind `BIN_TRACKING_ENABLED`. The size parse was **widened to search the whole name** (not just the leading position) after a real 132-item pull showed the newer brand-first names carry it mid-name — `HERCULES BRUTE 27.5T SS`; 19 cases pass, model years and codes like `2600 SERIES`/`V26` correctly yield nothing. **Three things remain**, biggest first: **fix `autoType`** — 89 of those 132 items are typed `ACCESSORY` while plainly being bicycles, which caps the size work at 5 recovered where ~94 are available and corrupts the type filter and every by-type report (belongs with `product-type-and-brand-lead-time-plan.md`); run the Part 0 measurement (a Zoho pull at `LOG_LEVEL=0` — the log line is in, nobody has read it); then Part B, whose shape that answer decides and which has **two** import sites, not one. Also raised, not fixed: `/api/products/bulk` is guarded on `stock.create` while the screen gates on `stock.edit` |
| `ledger-merge-plan.md` | schema, RBAC, backend and frontend shipped; PDF statement import and the 219-gap migration remain |
| `notifications-and-settings-rbac-plan.md` | nothing built, no file changed, no dependency installed. Two halves. **Part A** collapses Settings into **one module whose actions name the section** (`storage_edit`, `whatsapp_edit`, `push_edit`, `email_edit`): `settings_storage` and `whatsapp_templates` are deleted as modules, `zoho` gets `route: null` so it leaves the sidebar while all **19** of its guards elsewhere stay untouched — the same routeless-and-childless skip that already hides `cost_price`. §A3 lists all **10** guard call sites with line numbers. **Part A is destructive**: `seed-rbac.ts:143-169` deletes stale modules and permissions, and `Permission.module` + `RolePermission.permission` are both `onDelete: Cascade`, so every custom role holding those grants loses them **the moment the re-seed runs** — and ADMIN is re-granted everything, so it looks fine to whoever tests as an admin. Hence the two-phase migration in §A4, whose Phase 2 should be **deleted rather than written** if the read-only Phase-1 query returns zero rows (Q2). Three further findings: the action union lives in **three files with no compile-time link**, and `ACTION_ORDER` sorts with `indexOf` so a missing action gets `-1` and renders **ahead of `view`** rather than erroring; WhatsApp templates are already inconsistent today, **read** on `whatsapp_templates.view` but **written** on `settings.edit` via `PUT /api/alerts/config`; and §E.2's personal-preferences surface **has nowhere to live** — this app has no profile or account page at all (Q6). **Part B–F** adds push and email. **AWS was considered and rejected** (§2.1): Android has exactly one push transport, FCM, so SNS means creating Firebase anyway, then maintaining per-device SNS endpoints, and *still* building a separate VAPID path because SNS has **no browser transport** — FCM alone covers app and web. Email is SMTP via a Gmail App Password, needing **nothing from Google Cloud**; Gmail OAuth was rejected because `gmail.send` is a Google **restricted** scope (verification + third-party security assessment) and the Testing-mode escape **expires the refresh token every 7 days** — both walls vanish on Workspace, neither does on a free `@gmail.com`. The ~500/day free Gmail cap is why email defaults **off** per event while push defaults on. §D.3 records the cost nobody should discover late: **Android WebView does not implement the Web Push API**, so the service worker reaches desktop browsers and *not* the app — the app needs the native plugin, a rebuild and a **reinstall on every device**, which breaks the current "web changes reach the app instantly" property of `server.url`. Five models, two named deviations from `database-architect.md`. Per the owner's D2 the design is **event-only, no scheduler**, honouring the no-cron rule with the loss stated plainly: nothing will ever report an overdue bill or a stale sync. **§9 collides with `ai-provider-config-and-task-routing-plan.md`** — its §8 creates a `settings_ai` module following `settings_storage` *"exactly"*, the very pattern this plan abolishes; one of the two must be amended. **Three blocking questions (Q1, Q2, Q6)** |
| `pdi-module-plan.md` | nothing built, no schema changed. Two blocking questions (Q11, Q17) |
| `product-type-and-brand-lead-time-plan.md` | not started. Two commits on one branch. **Part B** — `BrandLeadTime` (0 rows) folds into `Brand.leadDays`, plus a real guard bug (`brands.create` should be `edit`); no open questions. **Part A** — the `ProductType` enum becomes a table with a screen and a `stock_product_types` sub-module; three questions in §8. `Category` is deliberately NOT merged in — it mirrors Zoho |
| `sequence-race-fix-plan.md` | five sites allocate unique numbers with a read-then-write race |
| `service-module-mobile-readiness-plan.md` | what /api/services/* needs before bch-service-app can be pointed at it |
| `staff-lms-authoring-and-ai-plan.md` | course creation is **implemented and unreachable**: `staff_lms_learning.create` exists, ADMIN holds it, `POST /api/staff-lms/learning/courses` works — but **7 of the 8 API paths the admin screens call do not exist** (ported from the standalone app, never rewired to `learning/` and `manage/`), the admin screens are in no module, and `/api/auth/me` — fetched by three service screens — was never built, so NextAuth's catch-all answers the **400** being reported. Also records a second `getCurrentUser` in `lib/auth.ts` that decides LMS admin by comparing role KEYS off the session token, which CLAUDE.md bans. **Part A is a bug fix, unblocked.** Part D argues AGAINST a vector database (Postgres `pg_trgm`/`tsvector` first, `pgvector` if ever needed, and Anthropic has no embeddings endpoint) and for AI on content GENERATION with a human approval step. Four questions in §7 |
| `stock-and-master-data-ux-plan.md` | the owner’s five, one branch and one commit per phase. **Two are already done** (S3 fix, stock-audit crash). Remaining: the filter becomes a right drawer (**12 screens**, component-only), `/more/brands` becomes the brand master with lead time inline, and product deactivate / restore / delete-with-refusal plus a status filter. Four questions in §2, none blocking |
| `stock-management-module-and-zoho-item-removal-plan.md` | nothing built; four decisions already taken (§0). Three commits on one branch. **A** the Zoho *item* fetch and every repair built around it are deleted — both entry points (`/stock`'s wizard, the `items` step on `/settings/integrations`), the two already-dead `import/items` and `import/clean` routes, `import-placeholders.ts`, `parseBicycleSize`, `backfill-size` and the fix-up banner. Bills and invoices stay: `/deliveries` Bulk Fetch depends on them. **Decision #6 also deletes the central pull UI** — the `/settings/integrations` card headed *"Auto-Sync: Daily at 1 PM IST"* (a claim untrue since `cron-removal-plan.md` shipped: nothing here runs on a schedule) and the whole `/settings/integrations/pull-review` page. The `trigger-pull` / `pull-review` / `approve` **APIs survive**, because `/inbound`, `/bills`, `/receivables` and `/deliveries` each already run that sequence inline — the central page was the duplicate, not the source. The contacts step goes with it, and §2.1.3 records why that is safe after checking: **fetching stock never creates a vendor** (the item branch writes Product/Brand/Category and never touches `prisma.vendor`), **the bill import already auto-creates vendors** by name (`approve:205-215`, and `/inbound` + `/bills` both survive), and `/vendors/new` carries every field the contacts step wrote. The one real loss is that a bill-created vendor starts with no GSTIN. **Part D**, added later and unrelated: `/customers` finally gets the list screen the `customers` module has always claimed — the API at `/api/customers` was already complete, only the page was missing; outstanding balance comes from one `groupBy` per page, not one sum per row. **Three findings the owner ruled on rather than discovered later:** (1) **no screen in the app creates a product** — `POST /api/products` exists and nothing calls it, so after Part A the seed script is the *only* way a SKU is born; accepted for now, a `/stock/new` form is a follow-up, and until it exists adding one product needs a developer and a terminal. (2) The catalog ships **empty and stays empty** — the product data load became **Part E: a separate `scripts/import-products.ts`, optional and last** (decision #7), so no stock-driven screen has numbers until a stock audit runs; do not run the wipe on a trading day. That split also **dissolved a real blocker** (§15.1): `prisma/tsconfig.json` sets no `transpileOnly`, so a single combined seed referencing `prisma.productType` would fail its typecheck when run *before* `db:generate` — the wipe is now its own delete-only file compiling against the old client. (3) The data file is `.xlsx`/`.csv` and reuses `src/lib/excel-parser.ts` rather than growing a second parser. **§15 is a review of the plan against the code** and found two remaining blockers: `Product.type` has ~23 call sites, not the ten §5.2 listed; and **`npm run build` passes green while the screens break**, because 17 frontend files declare their own `interface { type: string }` over a fetch result — `stock-audit/brand-count:585` then throws on `p.type.replace(...)`. Also: two `@@index` entries name the dropped column, `/stock`'s tab defaults to the literal `"BICYCLE"`, and the desktop sidebar ignores `m.parent` entirely while `/desktop/*` already 404s for five existing modules. Decision #8 deletes the whole `/ai` page and its three AI routes rather than migrating them — with one exception found by reading the code: **`api/ai/dashboard-insights` contains no AI at all** (144 lines of raw SQL, no model call) and is the source of the **Stock Value** and **Low Stock** tiles on both the main and desktop dashboards, so it is renamed to `api/dashboard/stats` instead of deleted. Deleting the folder wholesale would have blanked two real numbers. Per the owner, `npm run build` runs **twice, not five times** — after commit 2, the only one the compiler helps with, and once before the PR; a departure from AGENTS.md recorded in §12. Also approved: strip the now-unused Zoho item client methods and their `endpoints.ts` entries, and delete the whole uncalled `api/zoho/import/` tree. **B** products arrive by `prisma/seed-products.ts` instead, and the `ProductType` enum becomes a plain table (`name`, `sortOrder`, `isActive`) with a list/create/edit screen — explicitly *not* Part A of `product-type-and-brand-lead-time-plan.md`; the two `type === "BICYCLE"` branches are resolved by showing the size badge whenever `size` is set, so no `tracksSize` column is needed. **This is the plan's only schema change and §5.0 records why it is unavoidable**: the owner asked for no schema change *and* for product types creatable from the running system, and an enum is a PostgreSQL type — storing the list in the existing `AppSetting` table or folding it into `Category` were both considered and both leave a Create button that produces something no product can be tagged with. Parts A and C change no schema at all. §12.1: the wipe runs *before* `db:push`, because adding a required `productTypeId` to a populated table means answering `--accept-data-loss`. **C** `stock`, `stock_audit`, `inbound`, `deliveries` and `transfers` are re-parented under a new `stock_management` container **keeping their keys**, so every existing role grant survives; the parent gets a real route because `bottom-nav.tsx:24` filters to roots and a routeless parent would drop Stock off the phone. Product Types is a child of the parent, not of `stock`, because `seed-rbac.ts:48` rejects grandchildren. **Two gates before running:** §4.2's row count across Product's ten child relations — the wipe destroys open PO, inbound and transfer lines, not just products — and the data file itself (§7.1). Supersedes `imported-product-data-quality-plan.md` |
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
