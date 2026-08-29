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

This is strict because it is parsed. Before it existed, plans wrote their status as prose —
*"PLAN ONLY — not implemented"*, *"plan, plus the RBAC groundwork already seeded"* — which
no script can classify, and which drifted out of date without anyone noticing. Two files
sat in `completed/` still claiming they were not implemented.

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
| `ci-build-database-dependency-plan.md` | 29 Aug 2026, the three Staff LMS pages became client components so the build opens no database connection, and the CI trigger no longer filters on `main` |
| `cron-removal-plan.md` | 28 Aug 2026, all cron jobs and screen polling removed |
| `database-reset-preserving-integrations-plan.md` | 29 Aug 2026, closed WITHOUT implementation — only `ZOHO_BOOKS` was ever connected and its row is backed up by hand in `.env`, so the export/restore scripts were unnecessary. Kept for §0 and the reset runbook |
| `service-merge-plan.md` | bch-service merged; /services/* and the SERVICE_* roles are live |
| `storage-implementation-plan.md` | 28 Aug 2026, runtime-switchable storage provider and Settings module |
| `zoho-config-consolidation-plan.md` | 29 Aug 2026, three Zoho config tables and four clients collapsed into one `IntegrationConfig` row per provider, one `IntegrationClient` base class and three `[provider]` routes |
<!-- END:completed -->

### pending/

<!-- BEGIN:pending -->
| Plan | State |
|---|---|
| `app-logic-and-problems-removal-plan.md` | ready to execute — delete `/more/app-logic` and `/more/problems`, the `problems` module and `AppProblem`; all questions settled and the inventory re-verified 29 Aug 2026. Runs BEFORE the role-check plan |
| `frontend-role-check-removal-plan.md` | ready to build — 23 dead role-name gates found, 21 in scope across 18 files; all three questions answered, one catalog line (`activity.approve`); runs after the app-logic removal plan |
| `ledger-merge-plan.md` | schema, RBAC, backend and frontend shipped; PDF statement import and the 219-gap migration remain |
| `pdi-module-plan.md` | nothing built, no schema changed. Two blocking questions (Q11, Q17) |
| `sequence-race-fix-plan.md` | five sites allocate unique numbers with a read-then-write race |
| `service-module-mobile-readiness-plan.md` | what /api/services/* needs before bch-service-app can be pointed at it |
| `store-hierarchy-and-team-plan.md` | ready to build — replace the StockLocation enum with Store → Warehouse tables; rewritten 29 Aug 2026, all questions answered, `/stock/by-location/[code]` resolves either level; runs after the database reset |
| `zoho-pull-timeout-plan.md` | ready to build — `items` (two loops) and `contacts` do one database round trip per record while `bills`/`invoices` already batch; §10 answered, both in one branch as two commits |
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
