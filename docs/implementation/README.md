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

## The requirement comes first — required section order

Owner's instruction, 8 Sep 2026: a plan is not an implementation note with a requirement
pasted somewhere in it. Every plan written from that date opens with what was asked, then
what was unclear about it, and only then how it will be built. In this order:

| § | Section | What it holds |
|---|---|---|
| 0 | **Requirement** | the owner's words **verbatim**, then restated as numbered `R1…Rn` |
| 1 | **Questions and clarifications** | a table — question, *why it changes the build*, options, recommended default, **answer**. Answers are dated as they arrive in a "Decisions on record" sub-table. A question whose answer changes the build blocks the build until answered |
| 2 | **How it works today** | verified against the code, every claim with `file:line` |
| 3 | **Implementation plan** | files, phases, dependencies, migration, RBAC, logging, the board-of-agents check |
| 4 | **Verification** | what to run and what to see |
| 5 | **Out of scope** | what was deliberately left alone, so the next reader does not "finish" it |

`0809-brand-category-inactive-and-audit-approval-plan.md` is the first plan in this shape;
copy its headings.

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
| `0409-unified-purchasing-transfers-cleanup-plan.md` | **SHIPPED and MERGED — every phase P0–P15 built except P11, which the owner dropped** — R1–R13 closed (R9 by P12). **Verified 9 Sep 2026 against the code and against git**: all ten phase commits are ancestors of `main` and `git rev-list --count main..feat/purchasing-transfers-p5-p15` is 0, so the plan's old "nothing merged" line was stale. Two of its rules have since been superseded and are recorded at the top of the plan: R13/O11 (the Vercel build stopped running `migrate deploy` on 7 Sep) and §5.1 (a whole-store audit no longer 400s; from 8 Sep the approver names the receiving warehouse). **P14/P15 found and fixed a pre-existing P9 bug: `Prisma.sql` cooks `'D'` to `'D'`, so `poSeedSql` threw 22P02 and every purchase order would have 500’d once one PO row existed** — all five seed queries corrected. **P11 and its requirement R7 — the colour-coded availability sheet — were DROPPED by the owner on 6 Sep 2026** because the implementation needs to change; nothing depended on P11, so it blocks nothing. `tsc` and `eslint` green, `npm run build` passes; **no phase has been browser-walked** — that is the one outstanding check on all nine. **Branching (owner, 5–6 Sep): P0–P7 each had a branch; P5 and P8–P15 share `feat/purchasing-transfers-p5-p15`, one commit per phase** — see the plan's §3. **Replaces** `0409-purchasing-deliveries-transfers-plan.md` and `stock-audit-inbound-zoho-window-and-cleanup-plan.md` (both deleted 4 Sep 2026, merged by a three-agent reconciliation). **17 phases P0–P15**, bugs first: P4 `/deliveries` Zoho fetch (disconnected Zoho reported as success, a `SyncLog` row that blocks retries for 2 min, a client path with no `else`, UTC dates; one merged `trigger-pull` spec and one `skipped` shape for both plans), P6 stock audit scope by store/warehouse, P7 per-line inbound receiving + Report Issue; then the removals (ProductType, `movingLevel`, manual customers), the activity log, `/stock` one-tap reorder, PO vendor derived from `reorderVendorId` → `BrandVendor.isPrimary`, duplicate-PO 409 + state machine + `Counter`, brand-sheet fill colours via `exceljs` (no AI), real vendor email with a server-side jspdf PDF (no API key), and transfers last (floor + godown per store, `Store.gstin`, derived TAX_INVOICE vs DELIVERY_CHALLAN, IN_TRANSIT/RECEIVED). **Three migration folders applied by the Vercel build** (owner answered 4 Sep: `main` auto-deploys, so P1 wires `migrate deploy` into the build; MIG-1a additive at P1, MIG-1b drops at P3, MIG-2 transfer backfill at P14; snapshot before each). Owner decisions D1–D9 and O1–O7 recorded; **§10 lists 13 blockers and 8 owner questions with a recommendation each** — the first four (`.env` points at the Supabase pooler, a dirty working tree, which project is production, no migrate step in the Vercel build) are half a day of the owner's time and gate everything except P2. **Reviewed 4 Sep against the code** (clarify-plan, ~220 claims, three sweeps + schema review): 14 citations corrected, one blocker (BL13) withdrawn, 13 build-changing corrections applied — atomic `Counter`, one PO creator with advisory-lock timeouts, no ₹0 POs, narrow reorder route, floor rows filtered from receiving, `consignmentValue` gated, at-least-once send semantics, and the live "sales are erased by the next warehouse write" defect promoted to a named risk. Q1, Q2, Q8, Q9 answered 4 Sep (import + tag BCC invoices; BCH buys for both; migrate in the build; receive to floor or godown by choice); Q3–Q7, Q10, Q11 run on stated defaults |
| `0709-bottom-nav-per-user-tabs-plan.md` | 8 Sep 2026, the pinned tabs reach the phone: one `MAX_NAV_TABS` cap, `navTabs` carried through `rbac` → `/api/my-permissions` → the client store, the bar hidden outright when nothing is pinned, and a header drawer as the safety net. |
| `0709-zoho-brand-category-sync-plan.md` | 8 Sep 2026, the Zoho brand and category masters reach the app by id: `zohoBrandId` / `zohoCategoryId`, `listAllBrands` / `listAllCategories`, a preview + import route pair on each side, and one `ZohoTaxonomySheet` on `/more/brands` and `/categories`. The bill import and the stock count stopped inventing brands. |
| `0809-brand-category-inactive-and-audit-approval-plan.md` | **SHIPPED — built and committed 8 Sep 2026 as `ddf0092` on `feat/taxonomy-inactive-and-audit-approval` (30 files, +2224/−565), the single end-of-work commit §1.1 ordered; the first plan in the requirement-first shape. Every §3 artefact re-verified against the code on disk 9 Sep 2026, item by item. `npm run build` and the §4 browser pass are the owner's, not yet run; `db:seed:rbac` and `migrate deploy` on the target still owed (§6) — until the re-seed, `/team/permissions` still shows a Delete checkbox that grants nothing. Not yet merged to `main`. One gap the plan never enumerated, so out of its scope and still open: `stock-audit/new/page.tsx:249` still tells the person creating a whole-store audit "Verify only — to correct stock, audit one warehouse", which this plan made false.** Three parts, one commit each: **A** `Brand.isActive` / `Category.isActive` (one additive migration), both DELETE routes and the `delete` action gone, deactivate cascades to products (and a category's subtree) in one transaction, `GET /api/brands` and `/api/categories` default to active-only so every picker follows for free; **B** `POST /api/stock-counts/[id]/zero-uncounted` — the dead baseline bulk-zero resurrected as a named, status-gated, idempotent action behind a button on the Uncounted tab — and the `+ Add new brand…` option removed from the count screen; **C** the review table becomes the one approval screen, with a per-line Now column, a two-way choice (record differences / set system stock) and a confirm sheet. **Found four live defects on the way:** a counted **0 is never applied** (`[id]/route.ts:270`, `!0` is true), the ledger row records the snapshot rather than live stock, the count-save route has no status check, and brand merge drops SetNull relations. **13 questions in §1**, each with a recommended default; Q9 (per-warehouse vs whole-store audits) decides whether R6 is even possible without a new rule. |
| `0809-remove-per-item-and-by-brand-views-plan.md` | 8 Sep 2026, Per Item, the By Brand screen and the view-tab bar are gone; the product list is untouched and keeps a single By Location link. |
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
| `0809-ai-provider-settings-and-shared-client-plan.md` | written and **built** 8 Sep 2026; **all five phases verified present on disk 9 Sep 2026, but NOTHING IS COMMITTED on any branch** — `git log --all -- src/lib/ai` returns zero commits and `git ls-files src/lib/ai` zero tracked files against ten files on disk. The tree is on `feat/taxonomy-inactive-and-audit-approval`, not the `chore/brand-stock-module-and-tooling` this row used to name; the work travelled with the working tree. Its migration `20260908143858_ai_provider` is **untracked** too, so a deploy from git gets neither the table nor the code. ⚠ Amend `ai-provider-config-and-task-routing-plan.md` §4/§6/§11 before building it — it defines a conflicting `AiProvider` (`enabled`, no `model`/`isConnected`/`lastTestedAt`/`lastTestError`) on the same `ai_provider` table and puts the wrapper at `src/lib/ai.ts`, colliding with the shipped `src/lib/ai/` directory. The small subset of `ai-provider-config-and-task-routing-plan.md` the owner wanted now: one table (`AiProvider`, one row per provider, one `isActive`), `/settings/ai` behind `settings_ai` (view/edit/approve, activate re-tests and refuses on failure), and `src/lib/ai/` — `runAi()` is the only thing a module imports; the four existing AI calls (pdf-parser, parse-screenshot, both in bank-statements) now go through it and no model string or `ANTHROPIC_API_KEY` read remains outside `src/lib/ai/`. Three adapters on official SDKs (Anthropic, `@google/genai`, `openai` Responses API). `integration_config` rejected — OAuth-shaped. Migration `20260908143858_ai_provider` applied to local `bch` only; RBAC re-seeded locally; `tsc` clean; an independent review's 14 findings triaged (9 fixed, incl. two HIGH — thinking-model output caps and the env bootstrap being defeated by the screen); **`npm run build` passed** 8 Sep 2026 (21 min); the owner's browser checks pending. Same `settings_ai` collision with `notifications-and-settings-rbac-plan.md` as the big plan. |
| `0809-brand-category-single-creation-path-plan.md` | written 8 Sep 2026. |
| `0809-stale-architect-doc-and-brand-clash-check-plan.md` | written 8 Sep 2026; **both fixes are on disk and Finding 2's route code is committed inside `ddf0092`, but Part B step 6 — "commit the migration folder with the Part A code" — is UNDONE.** `prisma/migrations/20260908151058_brand_name_ci_unique/` is untracked (not gitignored, never added), while the *later* `20260908161249_brand_category_is_active` **is** committed: git's migration history is out of order, so a fresh clone or deploy gets the `isActive` columns and never the case-insensitive unique index that the committed `api/brands/route.ts:45` cites. `git add` that folder, commit, then flip the plan to `completed`. The declared branch `fix/architect-doc-and-brand-clash` holds none of this work. Two small holes: `docs/agents/database-architect.md:8` still tells the schema-reviewer hook that the Vercel build applies migrations (it stopped on 7 Sep), and `POST /api/brands:29` has no clash pre-check, so `hero` inserts beside `Hero` past a case-sensitive `@unique`. |
| `0809-vendor-catalog-po-search-plan.md` | — |
| `0809-vendor-opening-balance-on-listing-plan.md` | written 8 Sep 2026. `openingBalance` is missing from the `GET /api/vendors` select (`route.ts:31-38`), so it shows on the vendor detail — which uses `include` — and is blank on the listing. Also fixes `desktop/vendors/page.tsx`, which reads `balance` and `isStarred`, neither of which the API sends. |
| `0909-transfer-mode-and-document-attachment-plan.md` | — |
| `ai-provider-config-and-task-routing-plan.md` | nothing built. Moves the AI provider key and the per-task model out of `.env` and out of hardcoded strings into three tables behind a `settings_ai` module, so switching provider for a month is a dropdown rather than a deploy. Writing config back to `.env` at runtime was **considered and rejected** (§2) — Node reads `process.env` once per process, so it would mean "change it, then restart". Adds `AiCallLog`, without which the owner's month-over-month billing comparison is impossible: audit F9 records that real spend today is **unknown**. Follows `StorageConfig` for the 30 s cache, the env bootstrap fallback and the activate-guarded provider switch, and `IntegrationConfig` for never serialising the secret at all. **Two blocking questions (Q1, Q2)**, and §11.1 argues this should run AFTER the audit's F1/F2/F3 data-loss fixes |
| `ledger-merge-plan.md` | schema, RBAC, backend and frontend shipped; PDF statement import and the 219-gap migration remain |
| `mobile-stock-api-plan.md` | nothing built. Prepared 2 Sep 2026: what `bch-service-app` needs from `/api/*` before it can be pointed at this server, checked route by route against the tree that day. **No schema change** — every item is additive at the route layer, so it needs no migration and can ship either side of the migrations baseline. Auth is unchanged: every request uses the `POST /api/auth/mobile-login` route introduced by `service-module-mobile-readiness-plan.md`. Audits the gaps the app hits today — `GET /api/transfer-orders` is creator-scoped with a single `status` filter, a fixed `createdAt desc` sort and no search (§G9 specs search, size sort, rejected-including-cancelled and facets); stock adjustment has **no route at all**. The `filter`/`facets` parameters in §3 are written so the web filter drawer (`stock-and-master-data-ux-plan.md` Phase 3) can adopt the same per-chip counts rather than growing a second counting path. Reads together with the app-side half, `APP:doc/implementation/pending/02-stock-backend-integration.md` |
| `notifications-and-settings-rbac-plan.md` | nothing built, no file changed, no dependency installed. Two halves. **Part A** collapses Settings into **one module whose actions name the section** (`storage_edit`, `whatsapp_edit`, `push_edit`, `email_edit`): `settings_storage` and `whatsapp_templates` are deleted as modules, `zoho` gets `route: null` so it leaves the sidebar while all **19** of its guards elsewhere stay untouched — the same routeless-and-childless skip that already hides `cost_price`. §A3 lists all **10** guard call sites with line numbers. **Part A is destructive**: `seed-rbac.ts:143-169` deletes stale modules and permissions, and `Permission.module` + `RolePermission.permission` are both `onDelete: Cascade`, so every custom role holding those grants loses them **the moment the re-seed runs** — and ADMIN is re-granted everything, so it looks fine to whoever tests as an admin. Hence the two-phase migration in §A4, whose Phase 2 should be **deleted rather than written** if the read-only Phase-1 query returns zero rows (Q2). Three further findings: the action union lives in **three files with no compile-time link**, and `ACTION_ORDER` sorts with `indexOf` so a missing action gets `-1` and renders **ahead of `view`** rather than erroring; WhatsApp templates are already inconsistent today, **read** on `whatsapp_templates.view` but **written** on `settings.edit` via `PUT /api/alerts/config`; and §E.2's personal-preferences surface **has nowhere to live** — this app has no profile or account page at all (Q6). **Part B–F** adds push and email. **AWS was considered and rejected** (§2.1): Android has exactly one push transport, FCM, so SNS means creating Firebase anyway, then maintaining per-device SNS endpoints, and *still* building a separate VAPID path because SNS has **no browser transport** — FCM alone covers app and web. Email is SMTP via a Gmail App Password, needing **nothing from Google Cloud**; Gmail OAuth was rejected because `gmail.send` is a Google **restricted** scope (verification + third-party security assessment) and the Testing-mode escape **expires the refresh token every 7 days** — both walls vanish on Workspace, neither does on a free `@gmail.com`. The ~500/day free Gmail cap is why email defaults **off** per event while push defaults on. §D.3 records the cost nobody should discover late: **Android WebView does not implement the Web Push API**, so the service worker reaches desktop browsers and *not* the app — the app needs the native plugin, a rebuild and a **reinstall on every device**, which breaks the current "web changes reach the app instantly" property of `server.url`. Five models, two named deviations from `database-architect.md`. Per the owner's D2 the design is **event-only, no scheduler**, honouring the no-cron rule with the loss stated plainly: nothing will ever report an overdue bill or a stale sync. **§9 collides with `ai-provider-config-and-task-routing-plan.md`** — its §8 creates a `settings_ai` module following `settings_storage` *"exactly"*, the very pattern this plan abolishes; one of the two must be amended. **Three blocking questions (Q1, Q2, Q6)** |
| `pdi-module-plan.md` | nothing built, no schema changed. Two blocking questions (Q11, Q17) |
| `prisma-migrations-adoption-plan.md` | nothing built, nothing run against production. Decided 2 Sep 2026, the day before go-live: **retire `db push`, adopt Prisma Migrate.** §3 is the one-time baseline (`0_init` written with `migrate diff --from-empty`, then `migrate resolve --applied` — one row in `_prisma_migrations`, no DDL, every row kept); §4 puts `migrate deploy` at the front of the Vercel build via `scripts/vercel-build.mjs` so a failed migration is a failed build and no deploy, production-only until a staging database exists; §7 a CI job that applies the migrations to an empty Postgres and fails the PR if `schema.prisma` wants more; §8 `db:snapshot` / `db:restore:local` so local is a scrubbed replica of production. **Four questions (Q1–Q4)**, all answerable by the owner in a minute; Q4 is answered mechanically by §3 step 1 |
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
