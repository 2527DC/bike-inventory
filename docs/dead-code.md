# Dead code and dead tables

Audit date: 24 Aug 2026 · commit `e1dac67` · 75 models, 138 files containing `fetch(`

Companion to `docs/schema-review.md`, which reviews schema *design*. This document answers a
narrower question: **what can be deleted.**

---

## Definitions used

**A table is dead when no backend code path reaches it.** Not when it is empty.

This distinction is the whole point of the audit. An empty table may be a shipped feature
nobody has used yet — `FootfallDaily` had no rows on audit day and was alive then, because
`api/cron/footfall-rollup` wrote it every evening. Conversely a table can hold thousands of
legacy rows and still be dead, because nothing reads or writes it any more.

> **Superseded 28 Aug 2026 — all cron jobs were removed from this application.**
> `FootfallDaily` is now genuinely dead: nothing writes it and nothing ever read it. Every
> `api/cron/*` and `api/services/cron/*` entry below refers to a route that no longer
> exists. See `docs/cron-removal-plan.md`.

**Row counts were never consulted.** Reachability was established from source only:

| Signal | How it was checked |
|---|---|
| Direct query | `prisma.<model>.` and `tx.<model>.` |
| Nested write | the relation field name in `{ create: … }` on the parent |
| Relation read | the relation field in `include:` / `select:` / `_count:` |
| Seed / script | `prisma/*.ts`, `prisma/*.sql`, `scripts/` |

All four matter. A first pass using only the first signal wrongly flagged
`TransferOrderItem`, which is written through `items: { create: … }` and is very much alive.

---

## 1. Dead tables

### Tier 1 — no code path at all

Nothing reads them, nothing writes them, no seed touches them. The model name appears
nowhere outside `schema.prisma`.

| Model | Line | Evidence |
|---|---|---|
| `DailySnapshot` | 1515 | 0 references outside the schema |
| `TaskAssignment` | 1727 | 0 references outside the schema |

**Safe to drop.** Both are also listed in `schema-review.md` §5.2.

### Tier 2 — read-only, with no write path anywhere

Worse than dead, and the reason the "is it empty?" test misleads. The app **reads** these
tables and branches on the result, but **no code can ever populate them**. They are
permanently empty by construction, so every branch that depends on them is unreachable.

| Model | Read at | Write path |
|---|---|---|
| `LedgerGapEvidence` | `api/ledger/gaps/[id]`, `api/ledger/vendors/[id]/gaps`, `api/ledger/vendors/[id]` | **none** |
| `LedgerGapNote` | `api/ledger/vendors/[id]/gaps/route.ts:20` | **none** |
| `BrandVendor` | `api/ledger/vendors/route.ts:31`, `api/ledger/vendors/[id]/route.ts:37` | **none** |
| `SerialTransactionItem` | — | only `deleteMany({})` in `api/zoho/import/clean` |

Two consequences worth acting on rather than deleting:

- **`api/ledger/gaps/[id]/route.ts:80`** refuses to delete a gap when
  `gap._count.evidence > 0 || gap._count.entries > 0`. The evidence half of that guard can
  never fire. The safety rail reads as protective and protects nothing.

- **`BrandVendor` is the brand→vendor billing mapping the whole ledger module rests on** —
  the "Raleigh is billed via Naren International, EMotorad via Inkodop" relationship
  documented in the schema. The ledger vendor screens read it and will always render an
  empty brand list, because nothing in the app can create the mapping.

**Decide per table: build the write path, or drop the read.** Deleting these outright would
remove real intent — unlike Tier 1, someone meant to finish these.

### Explicitly NOT dead

Recorded so the next audit does not re-flag them:

| Model | Why it looks dead | Why it isn't |
|---|---|---|
| `TransferOrderItem` | no `prisma.transferOrderItem.*` call | written via `items: { create }` — `api/transfer-orders/route.ts:154` |
| `PurchaseOrderItem` | 1 delegate call | written via nested create on the PO |
| `FootfallDaily` | table empty | ~~`api/cron/footfall-rollup` writes it nightly~~ — **no longer true as of 28 Aug 2026; the cron was deleted and this table is now dead** |
| `TokenCounter` | 1 call site | single-row sequence; one call site is correct |

**Tally: of 75 models — 2 fully dead, 4 reachable but never written, 69 live.**

---

## 2. Dead files

Zero imports anywhere. Verified by module-specifier search across `src/`.

| File | Lines | Note |
|---|---|---|
| `src/lib/mock-data.ts` | 174 | pre-database fixtures; sole consumer of most of `src/types/index.ts` |
| `src/lib/ops-constants.ts` | 144 | SOP/task/WhatsApp builders for a module that never shipped |
| `src/components/services/CheckoffGate.tsx` | 155 | |
| `src/components/services/PhotoUpload.tsx` | 108 | `JobCard.tsx:833` has its own inline `AfterPhotoUpload` |
| `src/lib/pincode-lookup.ts` | 77 | |
| `src/types/next-pwa.d.ts` | 26 | declares a module never imported — `next.config.ts` has no PWA wrapper |

**~684 lines.** Deleting `mock-data.ts` makes roughly 20 further exports in
`src/types/index.ts` dead (446 lines, only 4 types still used, by `vendors/[id]/page.tsx`).

---

## 3. Dead code inside live files

| Location | Symbol | Status |
|---|---|---|
| `src/lib/rbac.ts:158` | `getGrantedModules()` | defined, never called |
| `prisma/rbac-catalog.ts:37` | `MODULE_GROUPS` | exported with the comment "Groups render in this order in the sidebar" — **nothing imports it**; the real order is incidental to `sortOrder`, and renders Admin before Service, contradicting the declared order |
| `src/lib/rbac.ts:23` + `prisma/rbac-catalog.ts:23` | `READ_ACTION` | declared twice; the `rbac.ts` copy is used only inside its own file |
| `src/lib/nav-config.ts` | whole file | reduced to one 3-line function after the RBAC migration |

**92 exported symbols are never referenced outside their own file.** Concentrated in
`src/types/index.ts` (21), `ops-constants.ts` (15), `mock-data.ts` (11),
`brand-ledger/reconcile.ts` (9).

---

## 4. Orphan API routes

27 routes have no caller in the codebase. These are still live HTTP endpoints behind auth —
dead code that is also attack surface.

**Destructive, and reachable by anyone holding the permission:**

| Route | Risk |
|---|---|
| `api/zoho/import/clean` | `tx.serialTransactionItem.deleteMany({})` |
| `api/stock-reset` | resets stock |
| `api/deliveries/backfill` | bulk write |

**The rest:** `api/upload`, `api/settings`, `api/ops-stats`, `api/vcard`, `api/credits`,
`api/store-updates`, `api/ops-activity-logs`, `api/stock/summary`, `api/products/stale`,
`api/vendors/stale`, `api/products/auto-classify`, `api/customers/[id]`,
`api/expenses/[id]`, `api/bills/[id]/follow-up`, `api/ledger/gaps/[id]`,
`api/ledger/vendors/[id]/entries`, `api/services/assembly/upload`,
`api/transfers/[id]/approve`, `api/inventory/inwards/verify`,
`api/inventory/outwards/verify`, and the four `api/zoho/import/*` siblings.

**Not orphans — invoked externally, keep them:** `api/v1/counts`, `api/v1/heartbeat`,
`api/analytics/counts`, `api/analytics/heartbeat` (the store Python agent), `api/earn-sync`.
All are documented in `middleware.ts`.

> **28 Aug 2026:** this list previously also named `api/cron/*` (5 routes) and
> `api/services/cron/zoho-deliver`. All six were deleted with the removal of scheduled jobs.
> `zoho-deliver` was never registered in `vercel.json`, so it had not been running at all.

---

## 5. Unused dependencies

**Safe to remove — no import anywhere in `src/`, `prisma/`, `scripts/`:**

`@auth/prisma-adapter` (auth uses JWT + credentials, no adapter) ·
`@google/generative-ai` (AI calls go to Anthropic) · `react-hook-form` ·
`@hookform/resolvers` (forms are hand-rolled) · `class-variance-authority` ·
`next-pwa` (never wired into `next.config.ts`)

**Do NOT remove — flagged by import-scanning, but required:**

| Package | Why it must stay |
|---|---|
| `react-dom` | React/Next runtime peer |
| `@capacitor/core`, `@capacitor/android` | consumed by the native Android build, not by JS imports |
| `@capacitor/cli` | type-only import in `capacitor.config.ts` |

---

## 6. Intentionally unused (new, awaiting adoption)

Not dead — added 24 Aug 2026 and not yet rolled out. Excluded from the counts above.

- `src/lib/logger.ts`
- `src/lib/api-client.ts` — `apiFetch` / `apiTry`
- `src/lib/http-json.ts` — `readJson` (already adopted by the three Zoho clients)

Migrating the ~380 remaining browser `fetch` call sites onto `apiFetch` is tracked
separately; see the "Logging is mandatory" section of `CLAUDE.md`.

---

## Removal log

### Done — 24 Aug 2026

**Files deleted (6, ~684 lines):** `src/lib/mock-data.ts`, `src/lib/ops-constants.ts`,
`src/lib/pincode-lookup.ts`, `src/components/services/CheckoffGate.tsx`,
`src/components/services/PhotoUpload.tsx`, `src/types/next-pwa.d.ts`

**Code removed:**
- `getGrantedModules()` — `src/lib/rbac.ts`
- `MODULE_GROUPS` — `prisma/rbac-catalog.ts`, replaced by a comment recording that sortOrder
  bands *are* the group order (the array disagreed with the rendered order, so keeping it
  would have preserved a second, wrong source of truth)
- `READ_ACTION` in `rbac.ts` un-exported — still used inside the module, and
  `rbac-catalog.ts` keeps its own seed-time copy

**Tables dropped (75 → 73):** `DailySnapshot`, `TaskAssignment` (plus the
`User.taskAssignments` back-relation). **Both verified to hold 0 rows before the DROP** —
row count is not the deadness test, but it is the safety check before an irreversible
operation. Applied with `prisma db push`; this project has no `migrations/` directory.

Verified after: `tsc --noEmit` clean, `eslint` clean on all touched files, no residual
references to any deleted symbol.

> ⚠️ `prisma generate` failed with `EPERM` on `query_engine-windows.dll.node` because the dev
> server holds it open. The database is correct and types still check, but **restart the dev
> server** to regenerate the client.

### Remaining

| # | Action | Risk | Effort |
|---|---|---|---|
| 1 | Remove the 6 unused deps (§5) — needs `npm uninstall`, touches the lockfile | none | 10 min |
| 2 | Delete the 3 destructive orphan routes (§4) | none — no caller | 15 min |
| 3 | Triage the remaining 24 orphan routes | low | 1–2 h |
| 4 | Decide Tier 2: build write paths or drop the reads (§1) | **needs a product call** | — |
| 5 | Prune `src/types/index.ts` — most of its 446 lines died with `mock-data.ts` | low | 30 min |
