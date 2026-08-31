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
| `single-auth-query-plan.md` | `getAccess` is the single reader of the User row: **3 database round trips per guarded request → 1**, across 190 route files, with no route file touched. `getCurrentUser` reads `getAccess` and is `cache()`d, and the next-auth `jwt` callback no longer re-reads the row for a role label nothing authorises on. Code complete; **`npm run build` not yet run**, uncommitted on `perf/single-auth-query-v2` |
| `storage-implementation-plan.md` | 28 Aug 2026, runtime-switchable storage provider and Settings module |
| `store-hierarchy-and-team-plan.md` | 30 Aug 2026, all six phases. The `StockLocation` enum is gone — `Store` and `Warehouse` are tables, `/stores` administers them behind a `store_management` parent module, and `/stock/by-location/[code]` resolves either level. The §2.4 database reset was skipped as unnecessary and no data was lost. **The §6 browser pass has not been run** — an audit after the phases were called done found five bugs the green build could not see |
| `zoho-config-consolidation-plan.md` | 29 Aug 2026, three Zoho config tables and four clients collapsed into one `IntegrationConfig` row per provider, one `IntegrationClient` base class and three `[provider]` routes |
| `zoho-pull-timeout-plan.md` | 30 Aug 2026, both `items` loops and `contacts` batched into a fixed number of queries; `maxDuration` 30 -> 60 (headroom, not the fix). Commits `8f143d2`, `947781f`. **§8 not yet run** — the acceptance test is a real 90-day pull returning without a 504, plus the `ZOHO_BOOKS` fallback exercised separately |
<!-- END:completed -->

### pending/

<!-- BEGIN:pending -->
| Plan | State |
|---|---|
| `imported-product-data-quality-plan.md` | imported products show a brand of `Imported` and a category of `Uncategorized` with no size — values the import **invents** because `Product.brandId`/`categoryId` are non-null. **Part 0 first**: log one raw Zoho item to settle whether the list API carries `brand`/`category_name` at all; Parts B and C cannot be specified until it answers. Part A (de-emphasise placeholders, add a "Needs details" filter feeding the existing bulk assign) is ready now |
| `ledger-merge-plan.md` | schema, RBAC, backend and frontend shipped; PDF statement import and the 219-gap migration remain |
| `pdi-module-plan.md` | nothing built, no schema changed. Two blocking questions (Q11, Q17) |
| `product-type-and-brand-lead-time-plan.md` | not started. Two commits on one branch. **Part B** — `BrandLeadTime` (0 rows) folds into `Brand.leadDays`, plus a real guard bug (`brands.create` should be `edit`); no open questions. **Part A** — the `ProductType` enum becomes a table with a screen and a `stock_product_types` sub-module; three questions in §8. `Category` is deliberately NOT merged in — it mirrors Zoho |
| `sequence-race-fix-plan.md` | five sites allocate unique numbers with a read-then-write race |
| `service-module-mobile-readiness-plan.md` | what /api/services/* needs before bch-service-app can be pointed at it |
| `sidebar-categories-and-accounts-trim-plan.md` | two catalog-and-seed changes. **Part A** hides Bills & Payments and Expenses from the sidebar with `route: null` — hidden, NOT removed, because `bills` is referenced by 20 files including the Zoho pull and settlement. **Part B** is the Categories module (Purchase group, sortOrder 225), its screen at `/more/categories`, and the missing PATCH/DELETE/merge routes — moved here out of `master-data-screens-and-filter-ui-plan.md` so it can ship alone. No open questions |
| `zoho-import-reliability-and-observability-plan.md` | from a live 504 on `pull-review/approve`. Five parts: S3 `Content-Length`, `apiFetch` in 6 screens, batching the import loop (~5 round trips per record to ~8 total), the three swallowed failures in `/deliveries`, and integration credentials surviving a disconnect. **Five questions in §8 block the logging half only** |
| `zoho-provider-endpoint-registry-plan.md` | specified and ready to start. No blocking questions. |
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
