# Unified plan — purchasing loop, PO email, deliveries fetch, stock transfers, stock audit, inbound receiving, activity log and the post-go-live removals

> **To continue this work:** read **[▶ RESUME HERE](#-resume-here--the-only-place-that-holds-current-state)** below. It is the only section that holds current state — branch, database, what is done, what is next. Everything else is design or history.

Status: in-progress — 4 Sep 2026, P2 + P3 done (R4 complete, on one branch); P1 next
Branch: **`chore/remove-type-ui-moving-level-customer-add`** — carries **P2 + P3 together** (R4).
One branch and one PR per phase in the order of §0.6, each cut from the **reference branch
`feat/notifications-and-settings-rbac`** (owner, 4 Sep — NOT `main`; local `main` is stale) after
the previous phase merged. Update this line as work moves. See the Progress log at the end.

Written 4 Sep 2026. Merges and **replaces** two plans written the same day:
`0409-purchasing-deliveries-transfers-plan.md` (PLAN-1: §A–§G) and
`stock-audit-inbound-zoho-window-and-cleanup-plan.md` (PLAN-2: Parts 0–7). Every line citation
below was re-verified against the working tree on 4 Sep 2026; where a source plan cited a
model's leading comment instead of its declaration the number here is the declaration.
Plan files are named `ddmm-<name>-plan.md` from now on.

---

## ▶ RESUME HERE — the only place that holds current state

**Everything needed to pick this up is in this section.** Sections 1–10 are the design; the
`Clarifications` sections at the end are decision history and explain *why*, not *where we are*.
Update THIS section as work moves, and nowhere else.

Last updated: **5 Sep 2026**, session 3.

### 1. Where the code is

**TWO branches, stacked. Nothing on `main`. The owner opens and merges every PR — Claude
commits and pushes only.**

| Branch | Cut from | Carries |
|---|---|---|
| `chore/remove-type-ui-moving-level-customer-add` | `feat/notifications-and-settings-rbac` | R4 = P2 + P3 — **pushed** |
| `feat/activity-log-counter-and-scope-columns` | the branch above | P1 — **pushed** |
| `feat/stock-ledger-integrity` | the branch above | P1b — **pushed** |
| `feat/zoho-fetch-window` | the branch above | P4 — **pushed** |

**Branch rule confirmed by the owner, 5 Sep:** keep stacking each phase on the previous
phase's tip, **and ask before creating each branch**. Claude cut P1 and P1b on its own
judgement before being asked to stop doing that.

**Why P1 stacks on P3 instead of being cut from the reference branch:** `bch-local` already
has MIG-1b applied. A branch without that folder puts Prisma in drift the moment a migration
command runs, and the fix would be resetting the one database holding the 5,739 products and
the only copy of the Zoho credentials. Stacking is what the plan's "cut after the previous
phase merged" means while the previous phase has not merged yet. Merge in branch order.

| Commit | Contains |
|---|---|
| `12de6be` | R13 — `scripts/vercel-build.mjs`, `vercel.json` buildCommand, `scripts/db/assert-localhost.mjs`, `db:push` removed, `scripts/db/restore-integrations.mjs`, plan rewrite |
| `61e03cd` | perf — `turbopack.root` pinned (unrelated to R4; separate so it can be dropped) |
| `730ad5a` | **P2** — screens stop reading product type, `movingLevel`, customer quick-add (15 files) |
| `1287226` | **P3** — the migration folder + 26 files; `.gitignore` gains `backups/` |
| `8e4e2cf` | docs — RESUME updated for P3 |
| `2ccbe10` | **P1** — MIG-1a, `ActivityLog`, `counter`, `PurchaseOrderSend`, both helpers, `db:snapshot`, three Restrict-FK delete-path fixes (12 files) |
| `a156c13` | docs — RESUME updated for P1 |
| `be0b6e1` | **P1b** — the stock ledger fix, `deductFromStore`/`deductAnywhere`/`addAnywhere`, `storeIdForInvoice()`, `/stores` invoice prefix (13 files) |
| `109edc4` | docs — RESUME updated for P1b |
| `97d2759` | **P4** — Zoho window + failures visible + inline panel; `date-window.ts`, `zoho-fetch-panel.tsx`, `inbound/sequence.ts`, RBAC `fetch` cleanup (20 files) |

### 2. ⚠ Which database — read before running any Prisma command

`.env` points at **`bch-local`**, NOT `bch`. Two different databases on the same local server:

| DB | products | state |
|---|---|---|
| `bch` | 0 | `0_init` applied, seeded, **empty** — not in use |
| **`bch-local`** | **5,739** | the real catalogue; **baselined 4 Sep**, now carries both migrations |

`bch-local` had no `_prisma_migrations`, so `migrate dev` offered to **reset and lose everything**.
It was not reset. `migrate diff` proved the gap was 21 lines — exactly P3's change — so it was
**baselined**: `pg_dump` -> `backups/bch-local-pre-p3-20260904-230251.dump`, then
`migrate resolve --applied 0_init`, then the folder applied with `migrate deploy`.

**`migrate dev` cannot apply a data-losing migration here** — it demands an interactive
confirmation and the session is non-interactive. Write the folder from `migrate diff` and apply it
with **`migrate deploy`**. This will come up again for MIG-1a and MIG-2.

If the database is ever reset: `npm run db:restore:integrations` puts the Zoho credentials back
(they live in `bch-local`; it is also their only source — do not drop that database).

### 3. What is DONE

**R4 is complete** (P2 + P3, merged onto one branch because they are one requirement and the
production deploy gap that justified splitting them does not exist).

- Product type removed from every screen, every API reader, validations, types, the RBAC catalog
  and the import script; `api/product-types/`, `(dashboard)/product-types/` and
  `lib/product-type.ts` deleted.
- `Category.movingLevel` removed. Customer quick-add removed (`customer-form-sheet.tsx` ->
  `customer-edit-sheet.tsx`, edit-only). `POST /api/customers` kept — the Zoho import needs it.
- Migration `20260904173412_drop_product_type_and_moving_level` applied to `bch-local`.
  Destroyed: 3 `ProductType` rows + the `productTypeId` column. `movingLevel` and
  `StockCount.productType` held zero non-default values. **5,739 products intact.**
- `npm run db:seed:rbac` run -> `1 stale removed` (`product_types`). **Re-run this wherever else
  the app is deployed.**

**R13 is complete** and shipped ahead of P1, so **P1 is smaller than §7 describes** — it no longer
builds the Vercel wiring.

Two behaviour changes for the R4 PR body:
1. **Non-editors lose the pencil on `/stock/[id]`** — `canEditType` was hardcoded `true`; product
   type was the only field it unlocked, so the button now follows `canEdit("stock")`.
2. **`products/[id]` PATCH is status-only** — a body without `status` now returns 400.

**P1 is complete** (MIG-1a + helpers), on its own branch.

- Migration `20260905170804_add_activity_log_counter_and_scope_columns` applied to `bch-local`.
  **Additive except one statement.** `ActivityLog` replaces `OpsActivityLog`; the `DROP TABLE`
  is safe by measurement, not assumption — `SELECT count(*)` returned **0**, its only writer
  (`api/ops-activity-logs/route.ts`) is deleted in the same commit, and no client called it
  (`/activity` reads `/api/activity`). **5,739 products intact.**
- Also created: `counter`, `PurchaseOrderSend`, five enums, the two `TransferOrderStatus`
  values, and the nullable scope / lane / send / brand-stock columns from §4 MIG-1a.
- Two hand-written backfills below the generated SQL, both no-ops on `bch-local` (0 rows in
  both tables) and both written for the databases where they are not: the `StockCount.location`
  → `warehouseId`/`storeId` resolution, and the 4→5 digit `poNumber` normalisation.
- `src/lib/activity-log.ts` and `src/lib/sequence.ts` created. `db:snapshot` built and **proved
  by running it** — `pg_restore -l` lists the new tables in the dump.
- `transfers/page.tsx` status union, `StatusFilter`, badge icon and row accent extended to
  `IN_TRANSIT`/`RECEIVED`. `status-colors.ts` already knew both.

**Three latent bugs found and fixed in P1** — all the same shape: a new `Restrict` FK made a
delete that used to return a readable sentence start failing on a raw constraint string.
1. `api/categories/[id]/merge` deletes the source category **inside a transaction**. With
   `InboundShipment.categoryId` Restrict it would abort the merge; it now moves shipments to
   the target alongside the products.
2. `api/categories/[id]` DELETE now counts `inboundShipments` as a blocker.
3. `api/stores/[id]` DELETE now counts `deliveries` + `stockCounts`; `api/warehouses/[id]`
   DELETE now counts `stockCounts` + both transfer-header lanes.

**P1b is complete** (R12 — the stock ledger fix), on its own branch. No migration: MIG-1a
already added `Delivery.storeId` and `Store.invoicePrefix`.

**Proven, not asserted.** The plan's own acceptance scenario was run against `bch-local`
inside a transaction that rolls back, importing the real helper:

```
start                 : currentStock=10 StockLevel=10   PASS
after selling 3       : currentStock=7  StockLevel=7    PASS   <- ledger moved, not just cache
after receiving 5     : currentStock=12 StockLevel=12   PASS   <- THE FIX
oversell refused      : Insufficient stock ... Available: 12, Needed: 9999.
after refused oversell: currentStock=12 StockLevel=12   PASS   <- no partial deduction

--- reproducing the OLD code path (cache-only write) ---
old: after selling 3  : currentStock=7  StockLevel=10
old: after receiving 5: currentStock=15 StockLevel=15   <- 15, not 12. This is R12.
```

The scaffolding was deleted afterwards; the repo has no test infrastructure and the plan did
not ask for a committed script. **If this should become a permanent regression test, say so** —
a silent return of this bug is exactly the risk, and nothing currently guards it.

- New in `stock-location.ts`: `deductFromStore` (store-scoped, cascades across the store's
  warehouses in `sortOrder`), `deductAnywhere` and `addAnywhere` (reversals, which have no
  recorded warehouse), over one shared core. **The up-front sum is load-bearing**:
  `adjustWarehouseQty` clamps at zero, so deducting 3 from a warehouse holding 0 would write 0
  and report success — the original bug in a new costume.
- New `src/lib/deliveries/zoho-invoice.ts`: `storeIdForInvoice()` (pure, longest-prefix wins,
  case-insensitive) and `resolveStoreIdOrPrimary()`, which falls back to the primary store and
  **logs a warning every time**, so a guessed attribution is visible.
- Fixed: `deliveries/[id]`, `deliveries/batch`, `inventory/outwards` (+ optional `storeId` on
  `outwardSchema`), `inbound/[id]` DELETE, `stock-reset` (zeroes `StockLevel` too, or the next
  recompute undid the reset), `inventory/cleanup`.
- `/stores` gains the **invoice prefix** field (owner's option B): `storeSchema`, both routes
  (each naming the other store on a 409 rather than leaking a raw P2002), the form input, and
  an amber **"No invoice prefix"** badge on any store still missing one — because a blank
  prefix silently sends that store's sales to the primary store. `""` normalises to null; a
  stored empty string would prefix-match every invoice. The GET `select:` had to be extended
  too, or every row would have rendered the warning badge regardless.

**One site the plan's table MISSED**, found by the phase's own proof grep:
`inventory/inwards/verify/route.ts:38`. It is the same bug mirrored — an INWARD writing only
the cache, so the next recompute made verified stock *disappear* rather than reappear. Fixed
the same way, and it now accepts an optional `warehouseId`.

**P4 is complete** (R1 — the Zoho fetch window and the deliveries panel). No migration:
MIG-1a already added `IntegrationConfig.lastAuthErrorAt`.

All five root causes in §7 P4's table are closed:

| # | Was | Now |
|---|---|---|
| 5 | Client did IST-local arithmetic then `toISOString()`; server used its own UTC date. "3 days" on 3 Sep at 02:00 IST fetched 30 Aug–2 Sep — an extra day at the front, today's bills missing | `src/lib/zoho/date-window.ts`, pure, `Date.UTC` only. **12 spot-checks pass**, including the plan's four. The FY floor is DERIVED, not the literal `"2026-04-01"` that goes wrong next 1 April |
| 1 | Disconnected Zoho → HTTP 200 `invoicesNew: 0` → "No new invoices found" | **409 with a sentence.** `lastAuthErrorAt` separates "never connected" from "token refused" |
| 2 | `init` created the `running` SyncLog row BEFORE the source check, so a refusal wedged the next attempt for 2 minutes | Source check moved first; `closeRunningSync()` on every early exit |
| 3 | `if (previewRes.success)` with **no else** — the panel stuck in "fetching", button grey, nothing said | Every branch sets state; `apiFetch` throws, so there is no silent path |
| 4 | Provider exception swallowed into `errors[]` beside `success: true`, which no client read | **502 `Zoho <source>: <message>`** |

Also: already-imported records moved out of `errors[]` into `skipped` (§5.2) — a normal
re-fetch no longer reports itself as a partial failure; the inbound screen renders them as a
neutral card linking to each shipment. `zohoPullSchema` replaces the bare cast that silently
dropped `days` and `toDate`. `apiFetch` gained `timeoutMs` + `ApiError.isTimeout`; the four
screens use it and the hand-rolled `fetchWithTimeout` on `/inbound` is gone. Import runs in
chunks of 25 with the un-imported rows left selected on a mid-chunk failure.

**The `BCC/` skip is gone from all three routes** (O8): `trigger-pull`, `search-zoho`,
`import-zoho`. A store name hardcoded in three filters had made a store with its own GSTIN
invisible — its invoices never imported, so its stock never moved. Invoices now carry
`storeId`, resolved from `Store.invoicePrefix`, and unmatched ones are counted rather than
dropped. `deliveryFieldsFromInvoiceDetail` is shared, so the review-flow import finally gets
the address, area, pincode and salesperson that only the single-invoice path used to read.

**`pull-review/approve`:** picks the client by the preview's `provider` (a Zakya-only setup
got no detail at all before, because only `getBooks()` was tried); the silent dedup `continue`
became `results.skipped++` **and** marks the preview APPROVED — it used to leave it PENDING
forever, so the pull could never leave PARTIAL. Both `IB-` allocators now use `nextSequence`.

**Permissions (Option B), server and client flipped in one commit:** `search-zoho` →
`zoho.fetch`, `import-zoho` → `zoho.approve` (it WRITES Delivery rows and was gated on a
read-shaped grant), four screens → `canFetch("zoho")`, and the Import button gained the client
gate it never had.

**⚠ The plan expected FOUR orphaned `fetch` actions; there were SIX.** `vendors.fetch` and
`brand_ledger.fetch` are orphaned too — proven by grep: no route guards any module `fetch`
except `zoho`, and no client reads one. All six are removed under the plan's own rule
("delete the action when no route guards on it"); `zoho.fetch` is the only survivor.
**`npm run db:seed:rbac` after deploy** or the six stay grantable and keep implying access.

**The panel is INLINE** (R1, "no popup modal"). `zoho-fetch-panel.tsx` is split out as a pure
presentational picker; `zoho-import-flow.tsx` keeps the request state and renders trigger →
panel → progress → error → summary → results as siblings. The `BottomSheetModal` wrapper,
`sheetOpen`, `handleOpenSheet/CloseSheet` and the two-tab bar are gone from this component;
the two tabs became one segmented toggle over a single panel.

That last part removed a real defect, not just markup: each tab carried **its own copy** of
the error banner, the progress strip and the result card, so a message could be sitting on the
tab nobody was looking at. There is now one of each. Four near-identical progress strips
collapsed into one, and both banners gained a **retry that re-runs the request** — they only
offered "dismiss" before.

`deliveries/page.tsx`'s header is `flex flex-wrap … gap-y-2` and that is load-bearing: the
panel, banners and result cards are `w-full` flex items, so each wraps onto its own line under
the title instead of being squeezed into the header row. `BottomSheetModal` itself stays — the
page's delete and pre-book sheets still use it, as §7 P4 requires.

**⚠ One limitation, deliberately not solved here.** Undoing an inbound receipt cannot deduct
from *the warehouse the receipt went into*, as §7 P1b specifies, because nothing records it:
`inbound/[id]/route.ts` takes the warehouse from the request body at receive time and
`InboundLineItem` has no column for it. Storing it is a schema change and P1b carries no
migration. `deductAnywhere` reverses against the rows that exist, largest first — exactly
equivalent today, when each store has one warehouse. **The precise fix is
`InboundLineItem.warehouseId`, written at receive time; it needs a migration and a phase.**

### 4. What is VERIFIED, and what is not

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **green** (61 errors -> 0) |
| Proof greps, §7 P2 and P3 | **clean** — only explanatory comments remain |
| `npx eslint` on every changed file | **zero issues.** 7 exist repo-wide, all pre-existing in untouched files, confirmed by linting HEAD's copy |
| `npx prisma migrate status` | **up to date, 3 migrations** (`0_init`, MIG-1b, MIG-1a) |
| Product created from brand + category alone | **PASSES** — P3's acceptance criterion |
| `npm run build` | **PASSES for R4, P1, P1b and P4** (5 Sep). Full route table, exit 0; **no `/product-types` and no `/api/ops-activity-logs` in it** |
| P4 date-window spot-checks | **12/12 PASS**, including the plan`s four and the owner`s "3 days on 4 Sep" case |
| P1b acceptance scenario | **PASSES** — 10 → sell 3 → 7 → receive 5 → **12**; the old path reproduced alongside gives **15**. Ran against `bch-local` in a rolled-back transaction |
| `npm run db:snapshot` | **PASSES** — ran it; `pg_restore -l` lists `ActivityLog`, `counter`, `PurchaseOrderSend`, and no `OpsActivityLog` |
| Browser walk | **NOT DONE for any phase** — the one check still outstanding |

P1 additionally: `tsc --noEmit` **green**, `eslint` on all 7 changed files **zero issues**,
`migrate deploy` applied cleanly, and the new tables confirmed present in Postgres with the
5,739 products untouched.

One straggler found on 5 Sep and folded into `1287226`: the Stock Management hub subtitle
(`(dashboard)/stock-management/page.tsx:47`) still read "Stock, product types, categories, …".
P3's file list named only `rbac-catalog.ts:108`; this page hardcodes its own copy of that
sentence, so the grep for `product-types` missed it and the grep for `product type` found it.
Both now read "Stock, categories, audits, inbound, dispatch and transfers."

### 5. NEXT STEPS, in order

1. **Walk the screens.** A green build proves nothing here: `brand-count` carried a
   `p.type.replace()` that only throws at runtime.
   - `/stock` — no type tabs; filters and bulk bar work
   - `/stock/[id]` — pencil only with `stock.edit`; edit form saves
   - `/categories` — name only; an unchanged save just closes the row
   - `/customers` — no Add; edit sheet saves; empty state explains where customers come from
   - `/receivables/new` — no quick-add; the hint shows
   - `/stock-audit/brand-count` — walk to the product list
   - `/product-types` -> **404**  ·  `/reports/stock-value` -> **two** tabs
   Then walk P1's screens too — nothing there should have changed: `/transfers` (two new
   filter tabs, no order in them yet), `/stores`, `/warehouses`, `/categories` delete + merge,
   `/purchase-orders`, `/stock-audit`.
2. **PRs — the owner's job, not Claude's** (owner, 5 Sep: "u dont do anything related to pr").
   All FOUR branches are pushed. **Merge in stacking order: R4 → P1 → P1b → P4.**
   - **R4** — the two behaviour changes in §3, and **run `npm run db:seed:rbac` after merge**
     or the sidebar keeps a "Product Types" entry that 404s.
   - **P1** — the three Restrict-FK delete-path fixes in §3, and **`npm run db:snapshot`
     before merging**: it carries a migration and Prisma has no down migrations.
   - **P1b** — a live data-integrity fix; the before/after numbers are in §3.
   - **P4** — **`npm run db:seed:rbac` after merge as well**, or six dead `fetch` permissions
     stay grantable on `/team/permissions`. Then grant **Settings › Integrations: fetch +
     approve** to every role that had **Deliveries: fetch**, or their Fetch button vanishes.
3. **Data step, as soon as P1b is merged:** on `/stores`, set the **invoice prefix** to `BCH/`
   and `BCC/`. **Until that is done every sale deducts from the primary store** — a BCC sale
   takes BCH stock. Two things make that impossible to miss rather than silent: the row shows
   an amber **"No invoice prefix"** badge until it is set, and `resolveStoreIdOrPrimary` logs
   a `warn` on every invoice that falls back. The input is built (P1b) — it is one field on
   the store form.
4. **Then P6** — stock audit scope and assignee (R2). Its schema dependency is already met:
   MIG-1a added `StockCount.storeId`, `StockCount.warehouseId` and the indexes, so P6 writes
   code only — no migration folder.
   **Ask which branch to base it on before creating it** (owner, 5 Sep); the stack tip is
   `feat/zoho-fetch-window`.

### 6. Owner actions still outstanding

- Delete the stray **93-byte** `F:\bharath  Cycle\package-lock.json` (no `package.json` beside it)
  — it is why Next mis-detected the workspace root.
- Dev speed: Defender exclusions, and moving `.next` (1.9 GB) off the 5400rpm HDD onto the SSD.
- **BL12** — create a non-admin test role. Every phase's gate walk needs one; ADMIN holds every
  permission, so testing as admin proves no gate works.
- **Q5** a real vendor `.xlsx` before P11 · **BL8** Gmail App Password before P12 · **BL9** vendor
  data before P10.

---

## 0. Requirements

Written 4 Sep 2026 with the owner. **Every phase in §3 names the requirement it satisfies; every
requirement below names the phases that deliver it.** If a phase traces to no requirement it is
scope creep and comes out. If a requirement is dropped, the phases in its row go with it.

### 0.1 Bugs — a module is unusable until these are fixed

| # | Requirement | Phases |
|---|---|---|
| **R1** | **`/deliveries` can fetch and import Zoho invoices.** A disconnected or token-refused Zoho says so, instead of reporting "no new invoices". A failed attempt is retryable immediately (no 2-minute wedge). "3 days" means 3 **IST** days. Custom range has a **To** date. **The fetch and import UI is INLINE on the page, laid out like `/stock` — no popup modal** (owner, 4 Sep). | P4 |
| **R2** | **An assigned stock audit opens and is scoped to a store or one warehouse**, instead of a free-text location plus a product type. The assignee can Start even when they also hold approve. | P6 |
| **R3** | **Inbound receiving works per line, and "Report Issue" actually creates something.** The issue is written to the **vendor issues data and appears on `/vendor-issues`** (owner, 4 Sep). The Cycles/Spares/Accessories category is saved on the shipment row, not in one phone's `localStorage`. | P7 |
| **R12** | **APPROVED TO BUILD (owner, 4 Sep: "update the plan to fix the bug").** **Stock stops silently inflating.** A sale must survive the next receipt, audit or transfer. Today the outward path updates only the cached total and never the warehouse ledger, so `recomputeCurrentStock` puts the sold units back. Deduction is **store-scoped** — a delivery names a store, never a warehouse. | P1b |

### 0.2 Removals — built, and not wanted

| # | Requirement | Phases |
|---|---|---|
| **R4** | **Remove `ProductType`, the category fast/normal/slow field, and manual customer creation.** Customers arrive from a Zoho invoice import or a service job. **Owner, 4 Sep: this goes FIRST, before every other phase.** | P2 → P3 |

### 0.3 The purchasing loop

| # | Requirement | Phases |
|---|---|---|
| **R5** | **One-tap reorder level on `/stock`** — set reorder level, reorder qty and optionally the vendor from a sheet on the row, without opening the product. | P8 |
| **R8** | **A purchase order cannot be raised twice for the same thing.** Sequential PO numbers with no race, a real state machine, a 409 naming the existing PO, and approval by whoever holds the permission (self-approval allowed and logged). | P9 |
| **R6** | **The PO vendor is derived from the product and shown read-only** — product's reorder vendor, else the brand's primary vendor, else the brand's only vendor. Mixed vendors in one selection produce one PO per vendor. | P10 |
| **R7** | **The vendor's colour-coded availability sheet decides what can be ordered.** **No AI and no API key** (owner decision, 4 Sep — see §6): a row's fill colour is a stored property of the `.xlsx` and is read deterministically with `exceljs`. The app never interprets a colour; the user labels each colour once (Available / Not available / Ignore) and the legend is remembered per brand. AI remains only for PDF/image sheets. | P11 |
| **R9** | **An approved PO is emailed to the vendor with the PO PDF attached**, over the Gmail App Password already in Settings › Notifications. No Google Cloud project, no OAuth, no AI. "Mark sent" is kept for WhatsApp and other channels. | P12 |

### 0.4 Stock transfers

| # | Requirement | Phases |
|---|---|---|
| **R10** | **Transfers have a header lane, an in-transit state, and a mandatory document** — a tax invoice between stores with different GSTINs, a delivery challan within one store. Stock leaves on dispatch and arrives on receipt, with shortfalls recorded. | P13 → P14 → P15 |

### 0.5 Cross-cutting

| # | Requirement | Phases |
|---|---|---|
| **R11** | **An activity log records who / module / from → to / when** for every business action, readable as a feed on the correct IST day. | P1 (table + helper), P5 (feed) |
| **R13** | **BUILT 4 Sep, ahead of the phases (see Clarifications part C).** **Schema changes are safe and repeatable** — one additive migration, `prisma migrate deploy` inside the Vercel build, and a guard that makes `migrate dev` against anything but localhost impossible. | P1 |

### 0.6 Execution order (owner, 4 Sep — removals first)

Phase IDs are stable and referenced throughout this file; only the **order** below changed.

```
R4  P2   screens stop reading type / movingLevel / customer quick-add   (no schema)
R4  P3   drop ProductType + movingLevel                                 (MIG-1b)
R13 P1   MIG-1a, ActivityLog, counter, helpers, build wiring            (MIG-1a)
R12 P1b  stock ledger integrity — outward writes StockLevel
R1  P4   Zoho fetch window + inline deliveries panel
R2  P6   stock audit scope and assignee
R3  P7   inbound per-line receiving, category, Report Issue
R11 P5   activity feed
R5  P8   one-tap reorder + search fix
R8  P9   PO state machine, numbers, duplicates, approval
R6  P10  vendor derived from product
R7  P11  colour-coded availability sheet
R9  P12  PO email with PDF
R10 P13  stores: GSTIN + state code
R10 P14  transfer lane, in-transit flow                                 (MIG-2)
R10 P15  transfer documents
```

**Why P2 and P3 moved to the front:** the owner asked for the removals first, and they are the only
phases with no dependency on anything else. P3 carries MIG-1b, which becomes the first migration
folder after `0_init`; MIG-1a (P1) then applies on top. The two are independent DDL, so the order
between them is free — what is *not* free is P2 before P3, because a screen still reading
`product.type` after the column is dropped throws (`brand-count/page.tsx:584`).

**Unchanged dependencies:** P1 → P1b, P5, P6, P9. P3 → P6, P8. P8 + P9 → P10 → P11. P9 → P12.
P13 → P14 → P15 (promote P14 and P15 together). P4, P5, P6, P7 remain pairwise independent.

---

## 1. Context

The owner walked the app the day after go-live (3 Sep 2026) and listed what does not match the
shop, then on 4 Sep described the purchasing loop and transfer rules they want. Together:

**Bugs that make a module unusable**
- `/deliveries` cannot fetch invoices from Zoho: a disconnected or token-refused Zoho is reported
  as "no new invoices", a failed attempt blocks retries for two minutes, and one client path has
  no `else`, so the button freezes. "3 days" from Zoho returns the wrong days on every fetch
  screen (IST vs UTC), and the Custom range has no To date.
- An assigned stock audit shows an empty page; audits are scoped by a free-text location and a
  product type instead of a store/warehouse.
- "Report Issue" on inbound receiving never creates anything (wrong permission, missing vendor);
  the Cycles/Spares/Accessories choice that gates receiving lives in `localStorage` on one phone.

**Removals of things built and not wanted**: the `ProductType` table (added 2 Sep), the category
fast/normal/slow field, manual customer creation.

**New behaviour**: audit scope = whole store or one warehouse; per-line receiving with a saved
category; one-tap reorder level on `/stock`; PO vendor derived from the product and shown
read-only; the vendor's colour-coded availability sheet deciding what can be ordered; duplicate-PO
refusal; approval by permission holders; a real email to the vendor with the PO PDF attached
(Gmail App Password, no API key); stock transfers with a header lane, in-transit state, and a
mandatory document (tax invoice across stores, delivery challan within a store); an activity log
recording who / module / from → to / when for every business action.

Exploration found most pieces exist and are not wired together: a full `/brand-stock` upload
feature, a PO approve route, a production-grade SMTP sender with a Gmail App Password in Settings,
a jspdf export helper, an S3/local storage layer, a `BrandVendor` join table with `isPrimary` that
nothing reads, and `IN_TRANSIT`/`RECEIVED` already in `status-colors.ts`.

## 2. Decisions recorded from the owner (3–4 Sep 2026)

| # | Decision | Effect in this plan |
|---|---|---|
| D1 | "Mark All / Partial / Report Issue / blue button" are on **inbound receiving**, not stock audit | P7 |
| D2 | "Audit a store" = **whole store OR one warehouse** of it | P6 |
| D3 | **One release, one migration**; owner accepts the short old-code/new-schema window; deploy after closing | §4: three migration folders applied by the Vercel build (O11); the one old-code/new-schema window is MIG-1b's drops during the P3 build |
| D4 | Customer quick-add on the receivable form: **remove too** | P2 |
| D5 | Category on a shipment: **one per shipment, saved on the row** | P7 |
| D6 | Blue button = **receive the full bill qty**; shortages via Report Issue; shipment completes itself | P7 |
| D7 | Fix all three fetch-panel defects (range ignored with search text; Retry reloads list; no To date) | P4 |
| D8 | The two missing 3-Sep bills were **simply absent** → the date window is the cause | P4 |
| D9 | ~~Migration reaches production by hand~~ **Superseded 4 Sep (review, Q8):** `main` auto-deploys on merge, so the migrate step goes **into the Vercel build** in P1 | §4 |
| O8 | (4 Sep review) **BCC/ invoices are imported and tagged by store** | `Store.invoicePrefix`, `Delivery.storeId` in MIG-1a; store chip on `/deliveries` (P4) |
| O9 | (4 Sep review) **BCH buys for both stores** | PO header = primary store; no `PurchaseOrder.storeId` |
| O10 | (4 Sep review) **Receiving may go to either the floor or the godown, chosen at receiving** | ~~kind labels~~ **superseded 4 Sep:** pickers list the store’s warehouses by name; no `kind` exists |
| O11 | (4 Sep review) Vercel: **auto-deploys on merge; put migrate in the build** | `scripts/vercel-build.mjs` + `vercel.json` `buildCommand` in P1 |
| O1 | **Every store has its own GSTIN**; stores are dynamic rows | `Store.gstin`; transfer document derived from GSTIN inequality, never names |
| O2 | **Both the shop floor and the godown hold stock** | ~~a FLOOR warehouse via `Warehouse.kind`~~ **superseded 4 Sep:** a store already holds many warehouses; add one named "BCH Floor" on `/stores` when wanted. No enum, no column, no seeding |
| O3 | Brand-sheet availability = **row background fill colour** | P11 parser reads `cell.fill` |
| O4 | PO header uses the **primary store's** details; no Company settings page | `loadCompanyIdentity()` = active store with lowest `sortOrder` + email settings |
| O5 | BCC/ invoices in the Zoho fetch: owner asked for a recommendation | §7 P4 "BCC invoices" — decide at P0 |
| O6 | Keep **both** PO send paths (real email, and Mark sent for WhatsApp/other) | `PurchaseOrderSend.channel` EMAIL / WHATSAPP / MANUAL |
| O7 | Whoever holds the approve permission approves; no separate-user rule | self-approval allowed, logged |

**Defaults set by the plan (say so if wrong):** DRAFT POs count as open for the duplicate check;
a PO is created straight into PENDING_APPROVAL unless "Save draft"; `purchase_orders.edit` may
send; a product absent from a confirmed sheet shows "Not on sheet" and is not excluded; e-way bill
over ₹50,000 warns, does not block; a user assigned to a warehouse may dispatch only from it and
receive only into it; the PDF is stored best-effort; deliveries fetch/import gate on `zoho.fetch` /
`zoho.approve`; whole-store audits are verify-only (see §5.1).

**Decided at the 4 Sep review (were "decide at P0"):** BCC invoices are imported and tagged by
store (O8); BCH buys for both stores, so the PO header uses the primary store and no
`PurchaseOrder.storeId` is added (O9); `main` auto-deploys on merge, so the migrate step goes into
the Vercel build in P1 and no migration is applied by hand (O11).

The full list of open questions and blockers, each with a recommended answer and its current
status, is **§10**.

## 3. Phases — small, one PR each

Size: S ≤ 8 files, M ≤ 15, L > 15. `npm run build` takes >10 minutes, so each phase is verified
with `npx tsc --noEmit` + opening the affected screens, and the full build runs once per phase
before the PR. Bugs first, removals second, features third, transfers last.

| # | Branch | Goal | Source | Migration | Size | Needs | Key verification |
|---|---|---|---|---|---|---|---|
| P0 | — | Commit/merge `feat/notifications-and-settings-rbac`; production `migrate status` shows `0_init` and nothing pending; `.env` → localhost; local = scrubbed production dump; decide the two P0 questions | both | — | 0 | — | `npx prisma migrate status` on production: `0_init` applied |
| P1 | `chore/mig1-additive-schema-and-helpers` | MIG-1a (every additive column for P4–P15, `ActivityLog` replacing `OpsActivityLog`, `counter`, StockCount FKs + backfill); `src/lib/activity-log.ts`; `src/lib/sequence.ts`; delete `api/ops-activity-logs`; `scripts/vercel-build.mjs` + `vercel.json` `buildCommand` (O11); `scripts/db/assert-localhost.mjs` | PLAN-2 Part 0/1, PLAN-1 M1–M3a | MIG-1a | S | P0 | `tsc` green after `prisma generate` with no app file edited except the delete |
| P1b | `fix/stock-ledger-integrity` | **NEW 4 Sep (owner).** Outward stops writing `Product.currentStock` directly; every stock movement goes through `StockLevel`. Delivery deduction is **store-scoped** | owner, 4 Sep | none | S (~6) | P1 | sell 5, then receive a shipment of the same product -> the 5 stay sold |
| P2 | `chore/remove-type-ui-moving-level-customer-add` | Screens stop reading `product.type`, `movingLevel`, and the customer quick-add | PLAN-2 Parts 5 (screens), 6, 7 | none | M (11) | none | `/stock` no type tabs, `/customers` no Add, `/categories` edit = name only |
| P3 | `chore/drop-product-type-and-moving-level` | Schema drops + MIG-1b; delete product-type routes/page/lib; every API reader; catalog; import script | PLAN-2 Parts 5 (API), 6 | MIG-1b | L by count (~23 mechanical deletions) | P1, P2 | proof greps clean; bill import creates a product with brand + category |
| P4 | `fix/zoho-fetch-window-and-deliveries-panel` | Deliveries fetch root causes; shared IST date window; merged `trigger-pull`; `skipped` shape; approve invoice branch; permission gating; `apiFetch timeoutMs`; deliveries modal → inline panel; inbound/bills/receivables panel fixes | PLAN-1 §F, PLAN-2 Part 4 + zoho activity row | none | M (14) | P1, P3 | Zoho disconnected → 409 sentence, immediate retry works; "3 days" on 4 Sep = 2–4 Sep |
| P5 | `feat/activity-log-feed` | `/api/activity` IST day + `ActivityLog` source + dedupe; clients; category/customer edit rows | PLAN-2 Part 1 feed | none | S (7) | P1 | rename a category → one row with from → to; 02:00 IST rows file under yesterday |
| P6 | `fix/stock-audit-scope-and-assignee` | Store/warehouse scope, assignee gates, verify-only whole-store rule, `0 ✓`, dashboard card | PLAN-2 Part 2 + §5.1 | none | M (12) | P1, P3 | assignee holding `approve` sees Start; whole-store correct-stock → readable 400 |
| P7 | `feat/inbound-per-line-receiving` | Shared finalisation, per-line receive, saved category, delete status route, Report Issue route, `SearchableSelect`, page | PLAN-2 Part 3 + `Counter` for ISS | none | M (10) | P1 | Report Issue without a Zoho bill creates ISS-…; double-tap adds stock once |
| P8 | `feat/stock-reorder-action` | `isLowStock`; reorder sheet on `/stock`; `reorderVendorId` on product PUT; search returns cost/GST (the `₹NaN` fix) | PLAN-1 §A + search half of §B | none | M (10) | P3 | 375 px: Reorder → sheet → OK → badge flips; card link not triggered |
| P9 | `feat/po-state-machine-and-numbers` | PO transitions, `nextSequence("PO")`, duplicate 409 with advisory lock, approval on PENDING_APPROVAL, `generate-po` fixes, detail/list buttons | PLAN-1 §D | none | M (12) | P1 | two tabs create at once → distinct numbers; duplicate → 409 card |
| P10 | `feat/po-vendor-resolution` | `resolveVendors`, `/reorder` groups + v2 handoff, `prepare`, read-only vendor sections, vendor-scoped search, `vendors/[id]/brands` | PLAN-1 §B | none | M (10) | P8, P9 | two vendors selected → two read-only sections; unresolved item blocks |
| P11 | `feat/brand-stock-colour-availability` | `exceljs` parser with `rowColor`, legend card + route, `getVendorAvailability`, badges, `generate-po` exclusions | PLAN-1 §C | none | M (12) | P10 | colour-coded `.xlsx` → legend → confirm → unavailable excluded |
| P12 | `feat/po-send-to-vendor` | Mailer attachments, PDF renderer, `/pdf`, `/send`, `/mark-sent`, `notifications/status`, bottom sheet | PLAN-1 §E | none | M (14) | P9 | send to own address → PDF attached, status flips only after SMTP accepts |
| P13 | `feat/stores-gstin` | `Store.gstin/stateCode` UI, `clearWarehouseCache()` on warehouse create, legacy `/api/transfers` removal. **No floor/godown — rescoped 4 Sep** | PLAN-1 §G (stores) | none | S (~5) | P1 | `/stores` saves GSTIN; a warehouse added to a store appears in the pickers same session |
| P14 | `feat/transfer-in-transit-flow` | MIG-2; header lane, derived type/doc, approve = check only, dispatch/receive/cancel, detail page, list filters | PLAN-1 §G (flow) | MIG-2 | M (15) | P13 | legacy APPROVED read RECEIVED; dispatch −qty; receive with shortfall |
| P15 | `feat/transfer-documents` | `transfers/` upload prefix + PDF, document route, dispatch gate, Document card | PLAN-1 §G (documents) | none | S (6) | P14 | floor → godown says delivery challan; BCH → BCC says tax invoice; dispatch 400 until the right document |

**Dependencies.** P2 needs nothing and runs first. P1 → P1b, P5, P6, P9. P2 → P3 (a screen reading
`type` after the drop throws: `brand-count`). P3 → P6, P8. **P4, P5, P6, P7 are pairwise
independent** (single-hunk overlaps only: `dashboard/page.tsx` P5/P6, `categories/[id]/route.ts`
P5/P7); bug-first order is P4, P6, P7, P5. P8 and P9 are independent of each other and of P4–P7.
P10 needs P8 + P9; P11 needs P10; **P12 needs only P9** — pull it ahead if emailing the PO
matters more than vendor derivation. P13 needs only P1 (its dependency on P6 was about floor rows,
which no longer exist); P14 needs P13; P15 needs P14. **Promote P14 and P15 together** — between them,
inter-store transfers dispatch without a tax-invoice gate. **Order changed 4 Sep (owner: removals first) — see §0.6.**
The old "P1 must merge before P3" no longer applies and is withdrawn: its reason was that P1's
`schema.prisma` still declares `ProductType`, so a MIG-1b that had already dropped the table would
make P1's next `migrate dev` try to re-create it. That is only true when branches are cut in
parallel from a stale base. Each phase branch is cut from the reference branch **after the previous
phase merged** (§3 "Done" step 1), so P1's branch already carries P3's removal and the diff is
clean. P2 before P3 still holds absolutely (a screen still reading `type` after the drop throws:
`brand-count/page.tsx:584`).

**Shared-file sequences** (each phase finishes both plans' work on the file):
`products/search` P3→P8→P10→P11 · `products/[id]` P3→P8 · `api/reorder` P3→P8→P10 ·
`stock/page`, `stock/[id]` P2→P8 · `stock-counts/**` P3→P6 · `pull-review/approve` P3→P4 ·
`api-client.ts` P4→P9 · `validations.ts` one block per phase · `types/index.ts` P3→P12 ·
`api/purchase-orders/route.ts`, `purchase-orders/new` P9→P10→P11 · `generate-po` P9→P11 ·
`dashboard/page.tsx` P5→P6→P13 · `activity/route.ts` P5→P14 · `trigger-pull`,
`zoho-import-flow`, `inbound/page.tsx` P4 only · `rbac-catalog.ts` P3 only.

**"Done" for every phase**
1. Branch cut from the reference branch with the table's name; the `Branch:` line above updated.
2. Dev server stopped → `npx prisma generate` (schema phases) → `npx tsc --noEmit` green →
   `npm run lint` clean (unused imports are the tell: `Plus`, `PRODUCT_TYPE_SELECT`, `Truck`).
3. Dev server up on localhost; walk the phase's browser check at 375 px and desktop; every new
   route exercised once as a non-admin role holding only the phase's permission.
4. Proof greps where the phase has them (P2, P3, P7).
5. `npm run build` in the background, Postgres up; must pass.
6. Schema phases: migration folder and `schema.prisma` in one commit; SQL read line by line; the
   PR body names the migration folder, the snapshot taken before merge, and the data step.
7. PR to `main`: what changed / what is affected / what to test / the data step the owner runs.

## 4. Migrations — three folders, applied by the Vercel build (O11), snapshot before each merge

`npx prisma migrate dev` on localhost only; read the SQL; commit schema + folder together. The
Vercel build applies each PR's folder before its code goes live (O11 — P1 builds the wiring from
adoption plan §4), so nothing is applied by hand; a snapshot precedes every merge that carries a
folder. Three folders: MIG-1a (P1), MIG-1b (P3), MIG-2 (P14).

### MIG-1a — P1, folder `add_activity_log_counter_and_scope_columns`

- `ActivityLog` (+4 indexes; **no FK to `User`** — `userId String` + `userName String` snapshot,
  the same "a log outlives its user" policy as `PurchaseOrderSend.sentById` and
  `NotificationOutbox.userId`, so one policy covers every log table in this migration);
  `DROP TABLE "OpsActivityLog"` — the `SELECT count(*) FROM "OpsActivityLog"` = 0 pre-check is
  the **proof** that nothing wrote it, not an assumption: a live writer exists at
  `src/app/api/ops-activity-logs/route.ts:37`, which P1 deletes in the same PR; `User.opsActivityLogs`
  (`schema.prisma:387`) removed. This is the migration's only irreversible statement.
- `counter(key TEXT PK, current INT DEFAULT 0)` — **no seed INSERT** (see "Counter" below).
- `StockCount` (`schema.prisma:662-684`): add `storeId`, `warehouseId` (nullable, FK Restrict);
  indexes `[assignedToId, status]` (the `mine=1&status=` dashboard query), `[storeId]`,
  `[warehouseId]` (FK lookups and Restrict checks — Postgres does not index FKs); on
  `StockCountItem` (`schema.prisma:686-698`, which has **no index at all** today) add
  `[stockCountId]` and `[productId]` — the item table is the one that grows per product per
  audit, so it earns the indexes; a five-value `status` alone on a few hundred `StockCount`
  rows does not. **Hand-inserted backfill** — `location` held the warehouse CODE
  (`api/stock-counts/route.ts:161` writes `scopedWarehouse?.code ?? locationScope ?? null`):
  `UPDATE "StockCount" sc SET "warehouseId" = w.id, "storeId" = w."storeId" FROM "Warehouse" w WHERE sc."location" IS NOT NULL AND upper(sc."location") = w.code;`
  Rows whose `location` is not a warehouse code (the bin-tracking branch wrote values like
  `"BCH-GF"`, see the model comment at `schema.prisma:679` and `stock-counts/route.ts:95-97`)
  are left with **both FKs null = "legacy audit, no location"** — an explicit third state
  (§5.1), never mistaken for "whole store". `location` **stays** for now (dropped in MIG-2).
  `productType` is already gone: MIG-1b (P3) now runs BEFORE this folder under the §0.6 order.
- `InboundShipment.categoryId` + index + FK Restrict; `Category.inboundShipments`.
- `Store.gstin`, `Store.stateCode`, `Store.invoicePrefix String? @unique` ("BCH/", "BCC/");
  `Delivery.storeId String?` + FK Restrict + `@@index([storeId])` (O8). No `PurchaseOrder.storeId` (O9).
- `IntegrationConfig.lastAuthErrorAt DateTime?` — set when a token refresh is refused
  (`base.ts:196-199`), so `/settings/integrations` can stop showing a green badge for a dead
  connection (P4).
- ~~`WarehouseKind { GODOWN FLOOR }`; `Warehouse.kind`~~ **REMOVED 4 Sep (owner).** There are only
  two scopes, store and warehouse, and `Warehouse.storeId` (`schema.prisma:289`) already lets a store
  hold any number of warehouses — `/stores` already creates them (`stores/page.tsx:104` →
  `POST /api/warehouses`). A "floor" is just a warehouse named "BCH Floor". No enum, no column.
- `BrandStockAvailability { AVAILABLE UNAVAILABLE UNKNOWN }`; `BrandStockItem.availability`
  default UNKNOWN, `rowColor String?`; `BrandStockUpload.colorLegend Json?`, `legendConfirmedAt`.
- `PurchaseOrderSendStatus { PENDING SENT FAILED }`, `PurchaseOrderSendChannel { EMAIL WHATSAPP MANUAL }`;
  `PurchaseOrder.sentAt/sentById/sentToEmail/sentVia/sendCount`; `PurchaseOrderSend` table
  (`purchaseOrderId` → `PurchaseOrder` **`onDelete: Restrict`, written explicitly with its
  reason** — a PO that has been sent to a vendor keeps its send trail and is cancelled, not
  deleted; `channel`, `status`, `toEmail?`, `ccEmail?`, `subject?`, `note?`, `sentById`,
  `sentByName` — no FK, a log outlives its user — `messageId?`, `error?`, `pdfUrl?`,
  `attemptedAt`, `completedAt?`, index `[purchaseOrderId, attemptedAt]`); `User` back-relation
  for `PurchaseOrder.sentBy` only.
- `ALTER TYPE "TransferOrderStatus" ADD VALUE 'IN_TRANSIT', 'RECEIVED'` (added here so MIG-2 may
  use them); `TransferType { INTRA_STORE INTER_STORE }`, `TransferDocType { DELIVERY_CHALLAN TAX_INVOICE }`;
  all-nullable `TransferOrder` columns: `fromWarehouseId`, `toWarehouseId` (FK Restrict),
  `transferType`, `requiredDocType`, `docType`, `docNumber`, `docDate`, `docUrl`,
  `docUploadedById/At`, `eWayBillNo`, `consignmentValue Decimal(12,2)`, `dispatchedById/At`,
  `vehicleNo`, `transporterName`, `receivedById/At`, `receiveNote`; indexes `[fromWarehouseId]`,
  `[toWarehouseId]` (the existing `[status]` index bitmap-ANDs with either; the composite
  `[status, toWarehouseId]` is dropped until a query needs it — P14 adds a `?toWarehouseId=`
  filter to the list route for the receiving clerk, served by `[toWarehouseId]`);
  `TransferOrderItem.receivedQty Int?`, `unitCost Decimal(12,2)?`; `Warehouse.orderTransfersFrom/To`.

`RECEIVED`/`IN_TRANSIT` exist in the enum before code writes them, and **`tsc` will not catch
that**: there is no `Record<TransferOrderStatus, …>` anywhere in `src/` (`status-colors.ts:4` is
`Record<string, string>`). P1's worklist is a grep for the string literals —
`transfers/page.tsx:39` declares a four-value status union and `StatusFilter` at `:50` offers
three filters — and both are extended in P1 so the list page cannot meet an unknown status.
`reports/daily` and the activity feed keep counting APPROVED until P14.

### MIG-1b — P3, folder `drop_product_type_and_moving_level` (runs FIRST under §0.6)

Names from `prisma/migrations/0_init/migration.sql:1964,1967,2624`; FK before table:
```sql
ALTER TABLE "Product" DROP CONSTRAINT "Product_productTypeId_fkey";
DROP INDEX "Product_productTypeId_idx";  DROP INDEX "Product_status_productTypeId_idx";
ALTER TABLE "Product" DROP COLUMN "productTypeId";
DROP TABLE "ProductType";
ALTER TABLE "StockCount" DROP COLUMN "productType";
ALTER TABLE "Category" DROP COLUMN "movingLevel";
```
Pre-merge check on local (populated `ProductType` rows, products pointing at them):
`SELECT "location", count(*) FROM "StockCount" WHERE "location" IS NOT NULL AND upper("location") NOT IN (SELECT code FROM "Warehouse") GROUP BY 1;`
→ no rows (an unresolvable code becomes an unscoped, verify-only audit).

### MIG-2 — P14, `--create-only`, hand-written, folder `backfill_transfer_lanes_and_drop_stock_count_location`

```sql
-- header lane from each order's earliest item
UPDATE "TransferOrder" o SET "fromWarehouseId" = i."fromWarehouseId", "toWarehouseId" = i."toWarehouseId"
FROM (SELECT DISTINCT ON ("transferOrderId") "transferOrderId", "fromWarehouseId", "toWarehouseId"
      FROM "TransferOrderItem" ORDER BY "transferOrderId", "createdAt", "id") i
WHERE i."transferOrderId" = o.id AND o."fromWarehouseId" IS NULL;
-- transferType for history; requiredDocType stays NULL = "pre-policy"
UPDATE "TransferOrder" o SET "transferType" = CASE WHEN f."storeId" = t."storeId" THEN 'INTRA_STORE' ELSE 'INTER_STORE' END::"TransferType"
FROM "Warehouse" f, "Warehouse" t WHERE f.id = o."fromWarehouseId" AND t.id = o."toWarehouseId" AND o."transferType" IS NULL;
-- legacy APPROVED rows moved stock instantly on approval: they are RECEIVED
UPDATE "TransferOrder" SET status = 'RECEIVED', "dispatchedAt" = "reviewedAt", "dispatchedById" = "reviewedById",
  "receivedAt" = "reviewedAt", "receivedById" = "reviewedById" WHERE status = 'APPROVED';
UPDATE "TransferOrderItem" i SET "receivedQty" = i.quantity FROM "TransferOrder" o
WHERE o.id = i."transferOrderId" AND o.status = 'RECEIVED' AND i."receivedQty" IS NULL;
-- StockCount.location is dead since P6: re-run the idempotent backfill, then drop
UPDATE "StockCount" sc SET "warehouseId" = w.id, "storeId" = w."storeId" FROM "Warehouse" w
WHERE sc."warehouseId" IS NULL AND sc."location" IS NOT NULL AND upper(sc."location") = w.code;
ALTER TABLE "StockCount" DROP COLUMN "location";
```
Pre-check on a restored snapshot for mixed-lane orders:
`SELECT "transferOrderId" FROM "TransferOrderItem" GROUP BY 1 HAVING COUNT(DISTINCT ("fromWarehouseId","toWarehouseId")) > 1;`
— historical only; the first item's lane is recorded and the detail page renders item lanes for
those rows. `TransferOrderItem` lane columns are dropped in the release after P15. Kept separate
from MIG-1 because it USES the enum value MIG-1a adds: Postgres refuses that inside the
transaction that added the value (error 55P04, documented core behaviour), and Prisma applies a
folder as one transaction. The second half is documented Prisma behaviour, **not independently
verified against 6.19.3 on this machine** — confirm once on localhost by putting the `ADD VALUE`
and the `UPDATE` in a single throwaway folder; if it applies cleanly, MIG-2 folds into MIG-1 and
MIG-2 folds into MIG-1b and there are two folders, not three.

### Counter — self-seeding, atomic, one allocator per series

`counter` lands weeks before P7/P9/P14 switch allocators, so a migration-time `INSERT … MAX(...)`
would be stale at cutover. `nextSequence(tx, key, pad, seedSql)` in `src/lib/sequence.ts`:

```ts
// seed = the caller's NUMERIC max for this key, parsed from the tail — never a string sort:
//   SELECT COALESCE(MAX(NULLIF(regexp_replace("poNumber", '\D', '', 'g'), '')::int), 0) FROM "PurchaseOrder"
//   (monthly keys add  WHERE "orderNo" LIKE 'TRF-202609-%')
// then ONE statement, atomic under concurrency — the row lock on DO UPDATE serialises callers,
// and two first-callers racing on a missing key both succeed (insert 43, then update to 44):
//   INSERT INTO counter(key, current) VALUES ($1, $2 + 1)
//   ON CONFLICT (key) DO UPDATE SET current = counter.current + 1
//   RETURNING current
```

Every existing allocator sorts **strings** (`orderBy: { poNumber | orderNo | countNo: "desc" }`
at `generate-po:38`, `transfer-orders:155`, `stock-counts:147`) — `"PO-0002"` sorts above
`"PO-00010"` — which is why the seed must parse numerically (the warning already in
`sequence-race-fix-plan.md:159-160`). Keys carry the month where today's format does
(`TRF-202609`, `ISS-202609`, `SC-202609`; `PO` has no month).

**PO width.** The two PO allocators disagree on width *and* order: `api/purchase-orders/route.ts:79`
pads to 5 by `createdAt`; `generate-po/route.ts:42` pads to 4 by `poNumber`. P9 fixes **5 digits**
(`PO-00042`). MIG-1a normalises any legacy 4-digit rows so ordering is sane again — after a
pre-check that no `PO-0042`/`PO-00042` pair already exists (the unique index would refuse):
`UPDATE "PurchaseOrder" SET "poNumber" = 'PO-' || lpad(substring("poNumber" from '\d+$'), 5, '0') WHERE "poNumber" ~ '^PO-\d{4}$';`
(`VendorBill` references POs by id, not number.)

**A series switches every one of its allocators in one phase** — two allocators on one unique
series is the merge's own hazard: `PO` (both creators, P9, through one shared
`createPurchaseOrder` helper — §7 P9); `ISS-` (the new issues route and
`api/vendor-issues/route.ts:104-121`, P7); `TRF-` (`transfer-orders/route.ts:151-160`, P14);
`SC-` (`api/stock-counts/route.ts:142-151`, the only allocator, P6); **`IB-` has two allocators —
`inbound/route.ts:158-169` and `zoho/pull-review/approve/route.ts:326-337`, the latter looping
inside a 60-second import — and P4 rewrites the second file, so P4 switches both** (fifteen lines
in `inbound/route.ts`). That leaves nothing for `sequence-race-fix-plan.md`: its five sites
(`sequence-race-fix-plan.md:20-25`, all with stale line numbers, and no PO site) are all
covered here, and its §7 helper (`nextSequence(tx, prefix, pad = 4)` with a separate backfill
script) is **superseded** by the self-seeding signature above. Mark that plan and
`pdi-module-plan.md` "landed by 0409 P1/P4/P6/P7/P9/P14" when P1 merges.

### Data steps and the owner's runbook

- After MIG-1 + P3 promote: `npm run db:seed:rbac` (prunes the `product_types` module; until then
  the sidebar shows "Product Types" → 404).
- After P4 promote: on `/team/permissions` grant **Settings › Integrations: fetch + approve** to
  every role that had **Deliveries: fetch**, or their Fetch button vanishes.
- After P13 promote: on `/stores` enter the **GSTIN and state code for every store** — P14 refuses
  an inter-store transfer while either is missing (§10 BL11). No `db:seed:stores` run and no floor
  audit: floor warehouses were dropped 4 Sep. If the owner later adds a warehouse to a store, its
  opening stock is established by a per-warehouse audit (§5.1).

**How a migration reaches production (O11, replaces the hand-apply runbook).** P1 adds
`scripts/vercel-build.mjs` — `prisma migrate deploy` → `prisma generate` → `next build`, with
`DIRECT_URL` (the 5432 session pooler) used by the deploy step and a log line per applied
folder — and `"buildCommand": "node scripts/vercel-build.mjs"` in `vercel.json`. A failed
migration is a failed build and no deploy; the previous deployment keeps serving. Per PR that
carries a migration folder (P1, P3, P14):
1. Before merging: `npx prisma migrate status` against production (`DIRECT_URL`, never printed)
   → `0_init` and every earlier folder applied, nothing failed; resolve adoption plan Q1 (which
   project is production — §10 BL3) before P1.
2. `npm run db:snapshot` (built in P0/P1 — §10 BL5): `pg_dump -Fc` into `backups/` — the only
   rollback. Merge after closing time.
3. Merge the PR. The build applies the folder, then generates, then builds; watch the build log
   for the applied-folder line and `migrate status` afterwards → up to date.
4. **The deploy gap is now the build duration, in the safe direction only:** the old code serves
   while the new schema is already applied. MIG-1a is additive and harmless to old code. MIG-1b's
   drops mean old product and stock-count reads 500 for the minutes the P3 build takes (owner
   accepted, D3). MIG-2 is harmless to old code. There is no longer a "new code on old schema"
   window at all.
5. Run the data step for that phase (above); open the phase's screen once as a non-admin.

## 5. Cross-cutting rules decided by the merge

### 5.1 Whole-store audits are verify-only; three scope states, not two
PLAN-2 resolved "correct stock" on a whole-store audit to "the store's single active warehouse,
else 400". A store may hold any number of warehouses (`Warehouse.storeId`), so "the store's single
active warehouse" is not a rule that can be relied on. From P6: a whole-store count yields one number per product while `StockLevel` is per
warehouse; any split of the variance invents a location. Corrections require a per-warehouse
audit — also how the owner populates a new floor warehouse.

**Today's code has no backstop — it has the opposite bug.** `api/stock-counts/[id]/route.ts:187-191`
says an unresolvable location "is NOT applied to stock", but `:194` sets `isLocCount = false` and
`:241-248` / `:273-280` then overwrite `Product.currentStock` **globally**. P6 therefore *adds* the
400, and the PR says so: this is a live data-integrity fix, not a scoping choice.

Scope states after MIG-1a: `warehouseId` set = one warehouse (corrections allowed); `storeId`
set, `warehouseId` null = whole store (verify only); **both null = legacy audit whose old
`location` did not resolve** (verify only, header "Legacy audit — no location"). UI: the "Whole
store" chip on `/stock-audit/new` carries "Verify only — to correct stock, audit one warehouse";
`/stock-audit/[id]` hides the "correct stock levels" checkbox unless `warehouseId` is set; the
API refuses with "This audit covers the whole store. Approve as verify-only, or raise one audit
per warehouse to correct stock." The picker lists the store’s warehouses by NAME (no `kind` — see
MIG-1a). Say in P6's PR that this lands before any store gains a second warehouse, or it reads as
a regression.

### 5.2 One Zoho pull response shape (bills and invoices)
```ts
{ step, source, window: { from, to, clampedToFy } | null, fetched, billsNew | invoicesNew,
  skipped: { counts: { alreadyImported: number; void?: number; centre?: number },   // centre → byStore under the BCC decision
             items: Array<{ ref: string; reason: "alreadyImported"|"void"|"centre";
                            where?: "inbound"|"accounts"|"deliveries"; id?: string; no?: string; status?: string }> },
  apiCalls, errors }   // errors = real failures only
```
`inbound/page.tsx` card reads `items`; the deliveries summary strip reads `counts`; `bills` and
`receivables` read `counts.alreadyImported` for the zero-new sentence. `finalize`'s `pullStatus`
becomes "partial" only on real errors (a clean re-fetch of imported bills no longer reports
"partial" in the `zoho.pull_finished` notification) — a correction, no code change there.

### 5.3 Activity log events
`logActivity` (P1) is called by every business transition both plans touch. Module keys verified
in `prisma/rbac-catalog.ts`; `entityRef` is the human number; user id from `requireFeature`;
inside the existing `$transaction` where one exists, root client otherwise (never throws there).

| Module / action | Where | from → to / details |
|---|---|---|
| stock_audit / created, status_changed, approved, rejected | `api/stock-counts` POST (tx), `[id]` PUT (tx) | `existing.status → data.status`; approve details `verify only` / `stock corrected at <warehouse>`; reject reason |
| inbound / approved, updated (category), received, status_changed, delivered | `inbound/[id]/approve` (tx), `[id]` PUT branches, `lib/inbound/complete-shipment.ts` | `<old ?? —> → <new>`; `"<product> ×<qty> → <warehouse>"`; the **first** receipt logs one `status_changed` `IN_TRANSIT → PARTIALLY_DELIVERED` (P7 makes that a first-class transition; without this row a partial shipment shows N receipts and no state change); the last logs `PARTIALLY_DELIVERED → DELIVERED` |
| vendor_issues / issue_reported | `inbound/[id]/issues` | `"<shipmentNo> · <product> ×<qty> <type>"` |
| zoho / pulled, imported | `trigger-pull` bills + invoices (root), `pull-review/approve` per batch (root) | `<from> → <to>`, `"<n> new via <source>"`; `"<n> deliveries, <m> skipped"` |
| categories / updated; customers / updated | `categories/[id]` PATCH, `customers/[id]` PUT | name `<old> → <new>`; changed field **names only** |
| purchase_orders / created, status_changed, approved, sent | create, `generate-po`, PUT, `approve` (self-approval in details), `send` (channel EMAIL, masked address), `mark-sent` (channel) | `poNumber` |
| transfers / created, approved, rejected, dispatched, received, cancelled | P14 routes | `orderNo`; shortfall in details |

Saving individual counts is deliberately not logged. PO and transfer rows use the existing
`PO` / `TRANSFER` / `DELIVERY` feed categories (`activity/page.tsx:19,40,43`); P5 adds
`AUDIT | ISSUE | ZOHO | MASTER_DATA`.

### 5.4 Shared helpers (created in the phase named)

| File | Exports | Phase |
|---|---|---|
| `src/lib/activity-log.ts` | `logActivity(db, entry)` with `as const` unions; throws inside a tx, `log.error`s on the root client | P1 |
| `src/lib/sequence.ts` | `nextSequence(tx, key, pad, seedFrom?)` | P1 |
| `src/lib/zoho/date-window.ts` | `resolveBillWindow({ days?, fromDate?, toDate? }, todayIST) → { from, to, clampedToFy }` — pure, `Date.UTC` arithmetic, FY floor derived (1 Apr of the Indian FY containing today), `from > to` throws | P4 |
| `src/lib/services/timezone.ts` (extend) | `istDayBounds(dateStr?)` beside `getTodayIST` (does not exist yet; `src/lib/analytics/time.ts` is a second IST module — do not add a third) | P5 |
| `src/lib/deliveries/zoho-invoice.ts` | prefix rule as data; `deliveryFieldsFromInvoiceDetail(inv)` lifted from `import-zoho/route.ts:74-116` | P4 |
| `src/lib/stock-location.ts` (extend) | `getStoreQtyMap(ids, storeId)` beside `getWarehouseQtyMap` (L59) | P6 |
| `src/lib/inbound/complete-shipment.ts` | `finaliseDelivered(tx, …)`, `scheduleDeliveredSideEffects(snapshot, actor)` | P7 |
| `src/components/ui/searchable-select.tsx` | combobox, 44 px rows, keyboard, click-outside | P7 |
| `src/lib/reorder.ts` | `isLowStock(p)`, `suggestedOrderQty(p)` (client-safe) | P8 |
| `src/components/reorder-sheet.tsx` | bottom sheet built from `filter-sheet.tsx` | P8 |
| `src/lib/api-utils.ts` (edit) | `errorResponse(message, status, data?)` (two args today, L8) | P9 |
| `src/lib/api-client.ts` (edit) | `timeoutMs` + `ApiError.isTimeout` (P4); `ApiError.data` (P9); `signal` already flows through `init` (`Omit<RequestInit,"body">`, L81) | P4, P9 |
| `src/lib/purchase-orders/status.ts`, `duplicates.ts` | `PO_TRANSITIONS`, `canTransition`, `applyTransition`; `findOpenPoConflicts` | P9 |
| `src/lib/purchase-orders/resolve-vendor.ts`, `vendor-availability.ts` | `resolveVendors`, `vendorProductScope`; `getVendorAvailability` | P10, P11 |
| `src/lib/purchase-orders/pdf.ts`, `email.ts`, `company.ts` | `renderPurchaseOrderPdf`, `buildPoEmail`, `loadCompanyIdentity` | P12 |
| `src/components/ui/bottom-sheet.tsx` | copy of the deliveries pattern, `pb-safe`, Esc | P12 |
| `src/lib/transfers/required-doc.ts`, `transitions.ts`, `in-transit.ts` | `deriveTransferPolicy`, `assertTransition`, `getInTransitMap` | P14 |

**RBAC catalog:** two changes. (1) P3 deletes `product_types`. (2) P4 resolves the orphaned
`fetch` actions: today four screens gate one server permission through four different modules —
`deliveries/page.tsx:25` `canFetch("deliveries")`, `inbound/page.tsx:99` `canFetch("inbound")`,
`bills/page.tsx:67` `canFetch("bills")`, `receivables/page.tsx:49` `canFetch("customers")` — while
every one of them calls a route guarded by `zoho.fetch` (`trigger-pull/route.ts:48`). After
Option B those four module actions guard nothing; leaving four grantable no-ops is how the
current confusion started, and `rbac-catalog.ts:126-131` removed `stock.fetch` for exactly this
reason. P4 greps each `<module>.fetch` guard and **deletes the action from the catalog when no
route guards on it** (expected: all four — `search-zoho`/`import-zoho`, the only other users of
`deliveries.fetch`, move to `zoho.*` in the same commit); the seed's stale-permission sweep prunes
the rows. Everything else fits an existing grant: reorder editor and vendor picker →
`stock.edit`; bulk product edits → **`stock.edit`** (the route is `stock.create` today,
`bulk/route.ts:19`, and P8 changes it — rewriting existing rows is an edit, and it is the only
practical path to populate reorder vendors); legend confirm → `purchase_orders.edit`;
prepare/create → `purchase_orders.create`; approve → `purchase_orders.approve`; send and
mark-sent → `purchase_orders.edit`; brand links on a vendor → `vendors.edit`; inbound issues →
`inbound.edit`; transfer attach/dispatch/receive → `transfers.edit`; transfer cancel →
`transfers.delete`; deliveries fetch/import → `zoho.fetch` / `zoho.approve`.
`customers.create` stays (three routes and the Zoho import guard on it).

**Cost visibility, stated once:** `purchase_orders.view` already shows unit prices on the PO
detail page, and a PO *is* its prices, so `/pdf` on `view` changes nothing. `cost_price.view`
gates the product master's cost on stock screens. In transfers, `consignmentValue` is
Σ qty × cost and would leak unit cost through the dispatch panel — P14 returns it only with
`cost_price.view` and exposes `eWayBillRequired: boolean` to everyone else.

**Conventions every phase honours:** `requireFeature(module, action)` with two args, never a
role name; Zod at the boundary in `src/lib/validations.ts`; `successResponse/errorResponse`;
`$transaction` for multi-row writes; `createLogger` and a log in every catch; `apiFetch`/`apiTry`
in the browser, never `fetch().then(r => r.json())`; routes that reach SMTP/FCM declare
`export const runtime = "nodejs"`; mobile-first, 44 px targets, no shadcn Dialog (patterns:
`filter-sheet.tsx`, `action-confirmation.tsx`, `ErrorBanner`).

## 6. Answers to the owner's direct questions

- **Reading the colour-coded sheet needs no AI and no API key.** Cell fill colour is a property
  `exceljs` reads deterministically. AI stays only for PDF/image sheets (`parsePdfWithAI`), and only
  that path needs `ANTHROPIC_API_KEY`.
- **Emailing the PO needs no API key.** It uses the Gmail App Password already in Settings ›
  Notifications over SMTP. No Google Cloud project, no OAuth (a free `@gmail.com` cannot get the
  `gmail.send` scope without a security review; the testing-mode token dies every 7 days). About
  500 recipients a day.
- **Generating the PO PDF needs no AI.** Fixed fields plus a table of stored numbers; jspdf draws
  the database in ~50 ms, offline, identical every time. An "AI" version would only draft a cover
  note per vendor. Recommendation: no AI for the document or the body; a "Note to vendor" box now,
  an optional "AI draft" button later once `ai-provider-config-and-task-routing-plan.md` lands.
- **Why the deliveries fetch does nothing:** §7 P4.

---

## 7. Phase details

### P0 — prerequisites (no code)
1. Commit the dirty tree onto `feat/notifications-and-settings-rbac` (25 modified files: the
   `runtime = "nodejs"` headers incl. `trigger-pull` and `inbound/[id]/status`, `validations.ts`,
   `CLAUDE.md`, `middleware.ts`, `sw.js`, `login/page.tsx` + untracked `login-form.tsx`, docs) and
   push it and open a PR **the owner merges on GitHub** (Claude never merges locally). Every phase
   branch is cut from the **reference branch `feat/notifications-and-settings-rbac`**, which the
   owner names; local `main` is stale and is never used as a base. A clean base means P7 deletes
   `inbound/[id]/status/route.ts` without an uncommitted edit on it.
2. Production: `npx prisma migrate status` shows `0_init` applied, nothing pending (adoption plan
   §3; resolve its Q1 first — §10 BL3). Local = scrubbed production dump with `ProductType` rows
   and products pointing at them, so MIG-1b is exercised on populated tables (§10 BL5, BL6).
3. **`.env` points at the Supabase pooler right now** (checked 4 Sep 2026: `DATABASE_URL` →
   `…pooler.supabase.com:6543`, `DIRECT_URL` → `…:5432`). Switch both to `localhost:5432/bch`
   before any `migrate dev` (the cloud values live in `.env.bak-partB`). Verify with a command
   that prints only the host, never the URL:
   `node -e "const u=new URL(require('fs').readFileSync('.env','utf8').match(/^DATABASE_URL=\"?([^\"\n]+)/m)[1]);console.log(u.hostname)"`
   Then make the mistake impossible: `scripts/db/assert-localhost.mjs` (10 lines: read `.env`,
   exit 1 unless both hosts are `localhost`/`127.0.0.1`) and
   `"db:migrate": "node scripts/db/assert-localhost.mjs && prisma migrate dev"` in `package.json`.
4. Decided (O11): `main` auto-deploys on merge, so P1 builds the Vercel migrate wiring (§10 BL4).
   Create the non-admin test role (§10 BL12). Build `db:snapshot` / `db:restore:local` (§10 BL5)
   or run the two commands by hand once.
5. The three former P0 questions are answered (O8, O9, O11).

### P1 — MIG-1a + helpers
- `prisma/schema.prisma` per §4 MIG-1a; replace `OpsActivityLog` (`schema.prisma:1832-1842`) with:
```prisma
model ActivityLog {
  id         String   @id @default(cuid())
  module     String   // RBAC module keys: stock_audit | inbound | vendor_issues | zoho | categories | customers | purchase_orders | transfers
  action     String   // created | updated | status_changed | approved | rejected | received | delivered | issue_reported | pulled | imported | sent | dispatched | cancelled
  entityType String   // StockCount | InboundShipment | VendorIssue | Category | Customer | ZohoPull | PurchaseOrder | TransferOrder
  entityId   String
  entityRef  String?  // SC-202609-0003, IB-202609-0001, PO-00042, TRF-202609-0007
  fromValue  String?  // not "from"/"to": SQL keywords
  toValue    String?
  details    String?  @db.Text
  userId     String   // deliberately NOT a relation — a log outlives the user it names (NotificationOutbox precedent)
  userName   String   // snapshot for "by Ravi" without a join
  createdAt  DateTime @default(now())

  @@index([createdAt])
  @@index([userId, createdAt])
  @@index([module, createdAt])
  @@index([entityType, entityId])
}
```
- `src/lib/activity-log.ts` (~50 lines): `logActivity(db: PrismaClient | Prisma.TransactionClient, e: ActivityEntry)`.
  Inside a transaction the row is part of the change (a failed insert fails the action); on the
  root client it never throws — `log.error` with identifiers. Detected by `"$transaction" in db`.
- `src/lib/sequence.ts` per §4 "Counter".
- Delete `src/app/api/ops-activity-logs/route.ts` (its only model is gone; nothing calls it).
- `npx prisma migrate dev --create-only`, hand-insert the StockCount backfill, read every line
  (expect `CREATE TYPE`, `ALTER TYPE … ADD VALUE`, `ADD COLUMN`, `CREATE TABLE`, indexes, FKs, one
  `DROP TABLE "OpsActivityLog"`), `npx prisma migrate dev`, `prisma generate`, `tsc`. `tsc` will
  flag nothing for the new enum values (there is no exhaustive status map), so the P1 worklist
  is `rg -n "APPROVED|TransferOrderStatus" src/app/\(dashboard\)/transfers src/lib/status-colors.ts`
  and extending the union at `transfers/page.tsx:39` and the filter list at `:50`.
- `scripts/db/assert-localhost.mjs` + the `db:migrate` guard (P0 step 3);
  `scripts/vercel-build.mjs` + `vercel.json` `buildCommand` (O11; ~20 lines: spawn
  `prisma migrate deploy`, then `prisma generate`, then `next build`, each with `stdio: "inherit"`,
  exit non-zero on the first failure, and print the folder names `migrate deploy` reports so the
  build log is the audit trail); `package.json` `db:snapshot` if not done in P0. Verify the
  wiring on a **preview** deployment first (a branch push): the preview build must run the
  three steps against the preview's `DIRECT_URL` and pass with "No pending migrations".
- Verify: open `/stock`, `/transfers`, `/purchase-orders`, `/stock-audit` — nothing changed.

### P1b — stock ledger integrity: a sale must survive the next receipt (R12)

**The bug, in the owner's words:** "You sell 3 tyres. Stock goes 10 to 7. Correct. Next week a
shipment of that same tyre arrives. The moment you receive it, the 3 you sold come back. Stock
shows 15 when it should show 12."

**Root cause.** `Product.currentStock` is documented as a cache, not a source of truth —
`schema.prisma:542`: *"StockLevel is the truth for how much, where. Product.currentStock is the
cached SUM of these rows."* Receiving, audits and transfers honour that: they write `StockLevel`
and let `recomputeCurrentStock` (`stock-location.ts:20-28`) rebuild the total. **The outward paths
do not.** They write `currentStock` directly and never touch `StockLevel`, so the next call to
`recomputeCurrentStock` — triggered by any receipt, applied audit or transfer — rebuilds the total
from a ledger that was never told about the sale, and the sold units reappear.

Grepping `deliveries/[id]/route.ts` for `stockLevel|adjustWarehouseQty|setWarehouseQty` returns
**0 hits**. Only five files in `src/` call those helpers at all.

**Every site that writes `currentStock` without a ledger row** (verified 4 Sep):

| File | Lines | What it is | This phase |
|---|---|---|---|
| `deliveries/[id]/route.ts` | 223, 235 | a delivery marked DELIVERED / WALK_OUT | **fix** |
| `deliveries/batch/route.ts` | 91, 102 | the same, in bulk | **fix** |
| `inventory/outwards/route.ts` | 82 | manual outward | **fix** |
| `inbound/[id]/route.ts` | 239 | undoing a receipt | **fix** |
| `stock-reset/route.ts` | 43 | zeroing stock | **fix** |
| `inventory/cleanup/route.ts` | 32 | increment | **fix** |
| `stock-counts/[id]/route.ts` | 244, 276, 358 | applied audit writes globally | **P6 fixes this one** — not here |

The `binId` branches in `inbound/[id]/route.ts:134` and `inbound/[id]/status/route.ts:159` also
write `currentStock` directly, but `BIN_TRACKING_ENABLED = false` (`lib/inventory-config.ts:10`),
so that path is dead. Left compiling, not extended.

**Deduction is STORE-scoped (owner, explicit):** "we must not have the stock reduction on delivery
respected to the warehouse, we must have respected to the store scope." A delivery names a
**store** and nothing else. No screen and no request body mentions a warehouse.

But the units must still land in `StockLevel` rows, because that is the only place stock exists
(`@@unique([productId, warehouseId])`, `schema.prisma:557`). So the store is the interface and the
warehouses are the implementation.

**Changes (~6 files, no migration of its own — needs only `Delivery.storeId` from MIG-1a):**

- **`src/lib/stock-location.ts`** — new `deductFromStore(tx, productId, storeId, qty)`:
  1. load the store's **active** warehouses ordered by `sortOrder`;
  2. sum their `StockLevel.quantity` and **refuse if the store total is short** — a readable error
     naming the product and the shortfall;
  3. otherwise take the quantity across them in `sortOrder` order, cascading to the next when one
     cannot cover it, each through `adjustWarehouseQty`.

  **Step 2 is not optional.** `adjustWarehouseQty` clamps at zero (`stock-location.ts:38`,
  `Math.max(0, ...)`), so deducting 3 from a warehouse holding 0 silently does nothing — which
  would lose the sale exactly as today, in a new costume. Today every store has one warehouse, so
  this resolves to a single write; the cascade exists so that adding a second warehouse to a store
  (which `/stores` already allows) does not quietly reintroduce the bug.
- **`deliveries/[id]/route.ts:214-236`** and **`deliveries/batch/route.ts:85-103`** — call
  `deductFromStore` instead of writing `currentStock`. Store from `Delivery.storeId` (MIG-1a, set
  from the invoice prefix by `storeIdForInvoice()` in P4); no prefix match falls back to the
  primary store (active, lowest `sortOrder`) with a `log.warn`. The idempotency guard stays as it
  is (`:193-196`, an existing OUTWARD `InventoryTransaction` on the invoice number) — it already
  works and is not part of this bug.
- **`inventory/outwards/route.ts:80-83`** — same call. **`outwardSchema` (`validations.ts:77-82`)
  carries no store or warehouse field at all** and gains an optional `storeId`, defaulting to the
  primary store.
- **`inbound/[id]/route.ts:239`** — undoing a receipt deducts from the warehouse the receipt went
  into, via `adjustWarehouseQty`, not from the total.
- **`stock-reset/route.ts:43`** — zero the `StockLevel` rows as well as the cache, or the next
  recompute undoes the reset.
- **`inventory/cleanup/route.ts:32`** — route the increment through the helper.

`reservedStock` stays a product-level number: `recomputeCurrentStock` does not touch it, so
reservations are unaffected by this change.

**Proof grep for the PR:** `rg -n "currentStock:" src --glob "!**/stock-location.ts"` returns only
`select:`/filter uses, never a write. That grep is the phase's real acceptance test — a green build
proves nothing here.

**Verify:**
- Product with 10 in BCH Warehouse. Sell 3 on a `BCH/` invoice, mark DELIVERED → `/stock` shows 7
  **and** `StockLevel` for BCH Warehouse shows 7.
- Then receive a shipment of 5 of that product → `/stock` shows **12**, not 15. *This is the bug;
  run it before and after so the PR can show both numbers.*
- Approve a stock audit, then a transfer, on the same product → still 12.
- A `BCC/` invoice deducts from BCC Store, not BCH.
- Sell more than the store holds → refused with the product name and the shortfall; no partial
  deduction is left behind.
- `/api/inventory/outwards` with no `storeId` → deducts from the primary store.
- Undo an inbound receipt → both the warehouse row and the total fall.

**Say in the PR:** this is a live data-integrity fix, not a refactor. Before it, every sale was
reversed by the next stock movement of that product, so no `/stock` number, no low-stock badge and
no audit variance could be trusted. R5 (P8 reorder), R2 (P6 audits) and R6/R7/R8/R9 (P9-P12
purchasing) all read this number — they cannot be meaningfully verified until this lands, which is
why it runs immediately after P1 rather than after P13 as §10 Q3 originally scheduled.


### P2 — screens stop reading `type`, `movingLevel`, customer quick-add (no schema)
Deployable on the old schema; may precede P1. A green build proves nothing here — open each.
- `stock/page.tsx`: export column `{ header: "Type", key: "type" }` (L29) and the interface
  field `type: string` (L42) — **not L34, which is the Reorder Level column**; the
  `/api/product-types` fetch (L281-286, `.catch(() => {})` at L287 — a 404 into HTML would be
  swallowed), L295, L309, the tab bar L499-522, L154-158.
- `stock/[id]/page.tsx`: L35, L41-44, `canEditType` (L95) and its use (L242) → `canEdit`
  (**non-editors lose the pencil; the only thing they could change was the type; say so in the
  PR**), L101-111, L162, collapse `handleSave` (L167-191) to the PUT branch, Item Type picker L261-285.
- `stock-audit/brand-count/page.tsx` (L19, L24, L219, **L584-586 `p.type.replace` throws**);
  `stock-audit/new/page.tsx` type pills (L47-57, L137-139, L216-234); `scanner/page.tsx` (L12-20,
  L27, L223, L252 → SKU only); `reports/stock-value/page.tsx:36` By Type tab; dead `type: string`
  fields in `stock-audit/[id]`, `[id]/review:26`, `stock/by-brand:26`, `reorder:20`.
- `categories/page.tsx`: L39, L52 (`MOVING_LEVELS`), L66/95/101 (`draftLevel`), L115, the
  `<select>` L276-285, badge L304-306; short-circuit `saveEdit` (L104) when
  `draftName.trim() === c.name` (with only `name` left, an unchanged save sends `{}` and the
  refine answers 400 "Nothing to update").
- `customers/page.tsx`: drop `Plus`, `canCreate`/`mayCreate` (L72-77), `openCreate` (L124-127),
  header Add (L259-264), empty-state CTA (L311-316); mount `{editing && <CustomerEditSheet/>}`;
  empty copy "No customers yet. Customers are created when a Zoho invoice is imported or a service
  job is opened." `customer-form-sheet.tsx` → `customer-edit-sheet.tsx`, edit-only, delete the
  POST/`alreadyExisted` branch (L142-160), titles "Edit customer"/"Save", keep `normalisePhone`,
  `TYPES`, phone validation (PUT still 409s on collision). `receivables/new/page.tsx`: drop `Plus`,
  state L25-29, `handleCreateCustomer` L38-61, toggle row L113-122 → plain `<label>`, inline form
  L137-181; hint "Customer not listed? Import their Zoho invoice or open a service job."
- **Keep** `POST /api/customers` (`api/customers/route.ts:83-125`) — the Zoho invoice import
  (`receivables/page.tsx:206-210`) relies on its create-or-find; update its comment (L95-97).
- Proof: `rg -n "openCreate|handleCreateCustomer|showNewCustomer|canCreate\(\"customers\"\)" src` → nothing.

### P3 — drop `ProductType` and `movingLevel` (MIG-1b)
- **Delete:** `src/app/api/product-types/route.ts`, `[id]/route.ts`,
  `src/app/(dashboard)/product-types/page.tsx`, `src/lib/product-type.ts`.
- **Schema:** `ProductType` (`schema.prisma:232-244`), `Product.productTypeId/productType`
  (L478-479), indexes (L532-533), `StockCount.productType` (L678), `Category.movingLevel` (L426).
- **Validation/types:** `validations.ts` L22-30 (`productTypeSchema`), L38-41
  (`productSchema.productTypeId`), L88 (`movingLevel`), L128-131; `src/types/index.ts` L22-28, L55, L88.
- **API readers** (`tsc --noEmit` after `prisma generate` is the worklist; ⚠ = compiles but
  throws): `products/route.ts` (L29-32, L94-95, L114, L128-133, L154-160 POST lookup, L168);
  `products/[id]/route.ts` (L28, L43-44; PATCH declared at L88, its type block L106-164 →
  status-only, 400 without `status`);
  `products/search` (L4, L35, L44), `products/stale`, `serials/search`, `serials/[id]`, `reorder`
  (L4, L35, L57), `reports/movement` (drop `type`), `reports/stock-value` (L20; delete the
  `groupBy === "type"` branch L101-106); `stock-counts/route.ts` ⚠ (L114-119 conditional spread
  in `where`, L162); `stock-counts/[id]/route.ts`, `[id]/items/route.ts` (imports at L4,
  selects, `withNestedTypeName` maps); `zoho/pull-review/approve/route.ts` (delete L164-181
  default-type lookup + L270 — bill import creates products with brand + category, as §16.1 of
  the completed stock-management plan requires); `categories/[id]/route.ts:68`.
- **RBAC:** delete `product_types` (`rbac-catalog.ts:134-154`); description at L108 → "Stock,
  audits, inbound, dispatch and transfers"; reword L280; customers comment L410-411.
- **Scripts:** `scripts/import-products.ts` (L8-15, L54-65 `DEFAULT_TYPE_NAME`, L262-273, L316).
- **Leave alone:** the Zoho API field `product_type: "goods"` in `integrations/books.ts:25`,
  `inventory.ts:51`, `api/inbound/route.ts:286`, `api/second-hand/route.ts:130`.
- Proof greps: `rg -n "productType|ProductType|product-types|product_types|withTypeName|PRODUCT_TYPE_SELECT|typeFilter" src prisma scripts --glob "!prisma/migrations/**"`
  → only the Zoho field; `rg -n "\.type\b" "src/app/(dashboard)/{stock,stock-audit,scanner,reorder,reports}"`
  → survivors only on transactions and `confirmation.type`; `rg -n "movingLevel|MOVING_LEVELS|draftLevel|opsActivityLog" src prisma --glob "!prisma/migrations/**"` → nothing.
- Verify: `/product-types` 404s; `/reports/stock-value` has two tabs; bill import of a new SKU
  creates the product with brand + category; sidebar shows no Product Types after `db:seed:rbac`.

### P4 — Zoho fetch window, deliveries panel, permission gating

**Root causes of "fetch does nothing", ranked for the owner (an ADMIN):**

| # | Cause | Seen as | 1-minute check |
|---|---|---|---|
| 1 | Disconnected or token-refused Zoho reported as success: `init` passes if any of Books/Zakya/Inventory is up; the `invoices` step then has no client and returns HTTP 200 `invoicesNew: 0` (`trigger-pull/route.ts:267-270`). `init()` returns the same `false` for "never connected" and "refresh token rejected" | "No new invoices found (last 24h)" or "Connection failed (400)" | `/settings/integrations`: Zakya POS or Zoho Books "Connected"? Log `invoices step skipped — no source connected` |
| 2 | SyncLog wedge: `init` creates a `running` row (L70-72) before the source check (L81-92); any mid-flow throw skips `finalize`; the next `init` within 2 min → 409 (L65-68). Shared by all four fetch screens | second click: "Connection failed (409)" | a `SyncLog` row `status='running', syncType='cron-pull'` |
| 3 | Client wedge: `zoho-import-flow.tsx:231-252` reads the preview with no `else`; on `success:false` `fetchStep` stays "fetching", button disabled, sheet stuck. Hits non-admins because the page gates on `deliveries.fetch` while the routes need `zoho.fetch` + `zoho.approve` | spinner gone, button grey, nothing said | role has Deliveries › fetch but not Settings › Integrations › fetch/approve |
| 4 | Zoho listing exception swallowed into `errors[]` with `success:true` (L318-320); client never reads `errors` | "No new invoices found (last 24h)" | log `invoices step finished … errors: 1` |
| 5 | Wrong days: client `toISOString().slice(0,10)` on IST local arithmetic, no `toDate`; server `todayStr = new Date().toISOString()` (L142) = the server's UTC date, yesterday before 05:30 IST. On 3 Sep 02:00 IST "3 days" pulled 30 Aug–2 Sep. Same in `bills/page.tsx:151-160`, `zoho-import-flow.tsx:192-199`, `receivables/page.tsx:129-136`; FY floor is a literal `"2026-04-01"` (L153-156) | today's bills missing, an extra day at the front | "3 days" on 4 Sep must be 2, 3, 4 Sep |

**Merged `POST /api/zoho/trigger-pull` (one spec for both plans):**
- Keep the committed header (`runtime = "nodejs"` L2, `maxDuration = 60` L9). Body gets a Zod
  schema `{ step, pullId?, days?, fromDate?, toDate?, searchText? }` — today L49-50 is a bare
  `req.json()` cast that never reads `days` or `toDate`, which is why a client sending them is
  silently ignored.
- `init`: stale-running sweep (L56-63) → running check 409 → `getBooks/getZakya/getInventory` →
  none: **409** "Zoho is not connected — connect it on Settings › Integrations" (or "…connected
  but its token was refused — reconnect it" when an `IntegrationConfig` row has `isConnected`)
  **before** `syncLog.create` (today the create at L70-72 precedes the check at L81-92, and the
  refusal is a 400 at L90-92) → create row → `after(notify pull_started)` (L102-127, unchanged).
- **Make the settings screen tell the truth.** `base.ts:196-199` returns `false` on a refused
  refresh but leaves `IntegrationConfig.isConnected = true`, so `/settings/integrations`
  (`page.tsx:358,366`) keeps a green badge while the 409 says "reconnect it". In the refresh
  failure branch set `lastAuthErrorAt` (a new nullable column — add it to MIG-1a) and have the
  integrations page show "Token refused on <date> — reconnect" when it is set.
- `closeRunningSync(reason)`: marks the newest `running cron-pull` row failed; called on every
  early return and throw in bills/invoices, including the 400 below.
- Delete `todayStr` (L142) and the literal FY clamp (L153-156). Import `getTodayIST` (not imported
  today). `window = searchText ? null : resolveBillWindow({ days, fromDate, toDate }, getTodayIST())`;
  a throw → 400 (caller's range, not a pull failure). `listAllBills(window?.from, window?.to, searchText)`;
  same for invoices.
- bills and invoices: no client → 409 sentence; provider throws → **502** `Zoho <source>: <message>`
  (replaces L242-244 / L318-320). Bills: L199-209 stop pushing "already imported" into `errors`;
  build `skipped.items` from `existingMap`. Invoices: tally `void`, `alreadyImported`, `centre`;
  write `source` into each preview's `data` (approve picks the client by `d.source`).
- Response per §5.2. `logActivity(prisma, zoho/pulled)` after previews are written.
  `log.info("bills window resolved", { pullId, mode, from, to, clampedToFy })` before the call and
  `{ fetched, new, alreadyImported, apiCalls, errors }` after; same for invoices.
- Old-client safety: a client sending `{ days }` to the old server got today only — that is why
  the four clients change in this same phase.

**Helper spot-checks (node one-liners):** `resolveBillWindow({days:3}, "2026-09-03")` → 1–3 Sep;
`({days:30}, …)` → from 5 Aug; `({fromDate:"2026-02-01"}, …)` → from 2026-04-01, `clampedToFy: true`;
`({fromDate:"2026-02-01", toDate:"2026-03-15"}, …)` → throws.

**`pull-review/approve/route.ts` invoice branch (L400-446):** the provider is written into each
preview as **`data.provider`** ("pos" | "books") — **not `source`**: this route already
destructures a body field named `source` meaning "accounting-only import" (L26-28, L154, L302),
and reusing the name would mislead every reviewer of the file. Pick the client by `d.provider`
(Zakya then Books; today only `getBooks()` is tried at L408-409, so a Zakya-only setup never gets
line items or address); always fetch detail; build the Delivery from
`deliveryFieldsFromInvoiceDetail` merged under the preview (preview wins for
`invoiceNo/date/total/customerName`); replace the silent dedup `continue` (L429-430) with
`results.skipped++` **and** still mark the preview APPROVED (today it stays PENDING forever and
the `continue` also skips `results.invoices++`, so re-imports have always been under-reported);
the bill branch already marks its "already has shipment" preview APPROVED (L137-141) and only
needs the `skipped++`; `logActivity(zoho/imported)` per batch. The bill branch's `IB-` allocator
(L326-337, a read-then-write inside the import loop) switches to `nextSequence(tx, "IB-YYYYMM", 4)`
together with `inbound/route.ts:158-169` (§4 Counter).

**BCC invoices (O5 → O8, decided 4 Sep):** the `BCC/` skip (`trigger-pull/route.ts:289`,
`search-zoho/route.ts:81-83`, `import-zoho/route.ts:60-63`) is a store name hard-coded in three
routes, exactly what the store-hierarchy plan removed everywhere else, and it hides a store with
its own GSTIN and stock. **Remove the skip; import them and tag each delivery with its store.**
`src/lib/deliveries/zoho-invoice.ts` exports `storeIdForInvoice(invoiceNo, stores)` — longest
matching `Store.invoicePrefix` wins; no match → `storeId: null`, counted as `unmatchedPrefix`.
`/stores` gets the prefix field (P13 already adds GSTIN there; the prefix input lands in P4 as a
one-field addition to `storeSchema`). Applied in `pull-review/approve` and `import-zoho` at the
`delivery.create`; `skipped.counts` gains `byStore: Record<storeCode, n>` for the summary strip;
`/deliveries` gets a store chip filter (`?storeId=`) and the list shows the store code on each
card. Deliveries imported before this carry `storeId: null`; a one-off backfill by prefix is one
SQL statement the owner can run after P4 — include it, commented, in the PR body.

**Permissions — Option B: `zoho.*` is the truth, the UI gates on it.** `deliveries/page.tsx:24-25`
→ `canFetch("zoho")` for Fetch, `canApprove("zoho")` for Import; `inbound/page.tsx:99`
`canFetch("inbound")` → `canFetch("zoho")`; `bills/page.tsx:67` `canFetch("bills")` and
`receivables/page.tsx:49` `canFetch("customers")` → `canFetch("zoho")`. **Server and client flip
in the same commit:** `import-zoho/route.ts:16` guards a route that *writes* Delivery rows on
`deliveries.fetch`, so relabelling the button alone would leave a working import reachable by
URL to anyone with the old grant — `search-zoho` → `zoho.fetch`, `import-zoho` → `zoho.approve`.
The component today has no `canImport` prop at all (`zoho-import-flow.tsx:48-51`; `:374` returns
null without `canFetch`), so the Import button has never had a client gate of its own. The four
orphaned `<module>.fetch` actions are deleted from the catalog per §5.4. Rejected: an
entityType-aware guard (a role allow-list in disguise; `requireFeature` takes two args) and seed
grants (ops roles are runtime rows). Precedent: `rbac-catalog.ts:126-131` dropped stock's `fetch`
for the same reason. Data step in §4.

**`src/lib/api-client.ts`:** optional `timeoutMs` (AbortController only when the caller passes no
`signal`), `ApiError.isTimeout`; abort → "Timed out after 60s — Zoho may be slow, try again."

**Deliveries — `zoho-import-flow.tsx` rewritten inline after `/inbound` (L309-458), picker split
into `zoho-fetch-panel.tsx`:** props `{ canFetch, canImport, onImported }`; state
`idle | pickDate | fetching | selecting | importing`, `mode: search | fetch` as a segmented toggle
inside one inline panel (Quick Search kept); the body sends `{ step:"invoices", pullId, days }` or
`{ fromDate, toDate }` (the `fetchCustomTo` input at L609-614 finally wired; state is L74) and the
label comes from `data.window`; persistent `summary` ("12 found in Zoho (2 – 4 Sep) · 9 already
imported · 1 void · 2 BCC"); every call via `apiFetch`/`apiTry` with `timeoutMs` (20 s init/review,
60 s invoices/approve); every step throws or sets state; finalize failure logged; import in chunks
of 25 ("Importing 26–50 of 120…"), a mid-chunk failure keeps the remaining rows selected. JSX:
header trigger (Loader2/Cloud swap) → `bg-slate-50` panel (chips 3/7/14/30/Custom, From/To,
Fetch/Cancel) → blue progress strip → `ErrorBanner` with retry → summary strip → result `Card`
(`border-blue-200 bg-blue-50/50`) with checkboxes, Cancel, `Import N` (only with `canImport`).
Delete the `BottomSheetModal` wrapper (L458-670), `sheetOpen`, `handleOpenSheet/CloseSheet`
(L361-372), the tab bar (L464-486) and duplicated banners; the page's delete/pre-book sheets
(L328, L350) stay. `deliveries/page.tsx` header → `flex flex-wrap … gap-y-2`.

**Inbound / bills / receivables panels (D7):** `inbound/page.tsx` — `handleFetchBills(mode:
"search" | "range")` (explicit argument kills the stale closure: Find at L333/L337 → "search",
Fetch at L381 → "range"); body search → `{ searchText }`, range → `fetchDays === -1 ?
{ fromDate, toDate } : { days }`; delete the date arithmetic (L188-207); label from `data.window`;
`lastFetchRef` so the `ErrorBanner` `onRetry` re-runs the same fetch (today it reloads the local
list); `fetchData`'s own failure (L153-155) gets its own `listError` banner; second
`<input type="date">` "To (default today)" beside L369-377; a neutral "Already imported (n)" card
listing `billNumber → shipmentNo (status)` with a link to `/inbound/[id]`; zero-new message
"Zoho has no bills dated <from> – <to>" or "<n> bills dated …, all already imported"; trigger-pull
calls → `apiFetch(url, { method: "POST", json, signal })` and drop `fetchWithTimeout` (L164-173);
`createLogger("inbound")`. `bills/page.tsx:137-167` and `receivables/page.tsx:129-141`: same body
and `skipped.counts`. The To input is **created** on inbound and bills (neither has one —
`bills/page.tsx:310` is the only date input, From) and **wired** on receivables (state at `:66`,
input at `:306`, never sent at `:141`). The inbound Retry today calls `fetchData()`
(`inbound/page.tsx:406-413`), reloading the local list, not the fetch.

**Verify:** Zoho disconnected → 409 sentence in the banner; immediate retry does not 409; no
`running` SyncLog left. Connected, "3 days" on 4 Sep → bills dated 2, 3, 4 Sep; summary with
counts; result card. From > To → 400 text. Fetch with text in the search box still uses the range;
Find still searches; Retry re-runs the same fetch; Custom From + To works. Import 3 → Delivery rows
carry address/area/pincode, salesperson, lineItems; re-import reports skipped and previews end
APPROVED. Expired session → "session expired", no hang. Role with `deliveries.fetch` only → no
button; `zoho.fetch` → button; `zoho.approve` → Import. `/inbound`, `/bills`, `/receivables` still
fetch. One "Zoho pulled 2026-09-02 → 2026-09-04" row in the log.

### P5 — activity feed and clients
- `src/app/api/activity/route.ts`: the day window (L24-28) uses `setHours` in server-local time
  (UTC on Vercel; the IST day boundary is 05:30) → `istDayBounds(dateStr?)`; return `date: dayStr`
  (L378 otherwise prints the previous UTC date); add `prisma.activityLog.findMany` as the 8th
  source in the `Promise.all` (L42), normalised to the `Activity` shape (`action = "<Module label>
  <verb>"`, `detail = "<ref> · <from> → <to> · <details>"`), categories `AUDIT | ISSUE | ZOHO |
  MASTER_DATA` (extend the union at L176); dedupe the synthesised "Approved Shipment" / "Marked
  Delivered" rows (L233-258) when the log has `(entityId, approved|delivered)`.
- Clients `activity/page.tsx:88`, `desktop/activity/page.tsx:85`, `(dashboard)/page.tsx:53`
  (ShareDailyReport, defined at L45): four categories in `CATEGORY_CONFIG` (L36-44) / `catEmoji`
  (L74); `formatTime` (L50) → `formatIST(ts, { day, month, hour, minute, hour12 })` so rows show
  date + time in IST; raw `fetch` → `apiTry`. The dashboard computes "today" with
  `new Date().toISOString()` in **six** places (`page.tsx:52, 129, 216, 510, 653, 883`) and mounts
  `<ShareDailyReport />` six times — replace all six with `getTodayIST()`, not just L52.
- The transfers source in the feed is `activity/route.ts:95-117` (the plan's earlier "100-117").
- `logActivity` in `categories/[id]` PATCH and `customers/[id]` PUT (field names only).
- Verify: `/activity` at 02:00 IST lists last night's actions under yesterday; rows show
  "3 Sep, 11:42 pm"; approving a shipment → exactly one row; rename a category → one row with
  from → to; edit a customer → field names, never values.

### P6 — stock audit scope and assignee
- **Schema already in place (MIG-1a).** `stockCountSchema` (`validations.ts:122-131`): drop
  `productType`; add `storeId: z.string().min(1, "Choose a store")`, `warehouseId` optional.
  Semantics: `storeId` + null `warehouseId` = whole store; both = one warehouse. Write
  `location: null` (the column is dead until MIG-2 drops it).
- `api/stock-counts/route.ts` POST: load the store with active warehouses; 400 if missing/inactive;
  a given `warehouseId` must belong to it; `systemQty` = `warehouseId ? getWarehouseQtyMap(ids,
  warehouseId) : getStoreQtyMap(ids, storeId)`; `countNo` via `nextSequence(tx, "SC-YYYYMM", 4)`
  + create + `logActivity(tx, created)` in one `$transaction`. GET: `mine=1` (→ `assignedToId:
  user.id` even for approvers) and `status=a,b`; include `store { name }` / `warehouse { name }`.
  Other caller `stock-audit/brand-count/page.tsx:258-265` sends `storeId` + `warehouseId`
  (`useWarehouses()` already returns `storeId`).
- `api/stock-counts/[id]/route.ts`: GET includes `store`, `warehouse`; drop the `items:` override
  (L52). PUT replaces L74-93 with: `isAssignee = existing.assignedToId === user.id; canApprove =
  userCan(stock_audit.approve)`; neither → 403; start/complete/items by a non-assignee → 403
  "Only the person this audit is assigned to can start, count or complete it"; approve/reject
  without `approve` → 403; by the assignee → 403 "You cannot approve or reject your own stock
  count". Holding `approve` no longer blocks the assignee (today L90-93 refuses an approve-holder
  the Start action outright: "Admin can only complete, approve, or reject … not initiate them").
  Base guard stays `requireFeature("stock_audit","edit")`. **`applyToStock` target resolved before
  the tx — a correctness fix, not a move:** today the `$transaction` opens at L122 and
  `warehouseByCode(existing.location)` runs *inside* it at L192-193 on the root `prisma` client
  against a module-level cache; when the lookup fails, `isLocCount` becomes `false` (L194) and
  the code writes `Product.currentStock` globally (L241-248, L273-280) while its own comment at
  L187-191 claims the opposite. Resolve first: `warehouseId` → that warehouse; store scope or
  legacy → 400 per §5.1. Remove those `currentStock` branches — `StockLevel` is the source of
  truth; drop the `warehouseByCode` import (L13). `logActivity(tx, …)` before
  `tx.stockCount.update` (L301). Say in the PR that the old fallback was a data-integrity bug.
- `[id]/items/route.ts`: PUT delete L112 (approve-holders blocked), plain assignee check at
  L115-119; GET `staleCount` (L80) and PATCH refresh (L171-193) compare against the **scoped** qty
  (today the global `currentStock`, so every scoped audit reads stale and Refresh overwrites
  `systemQty` with the wrong number); fall back to `currentStock` only when both FKs are null.
- `stock-audit/[id]/page.tsx`: replace L81; gates from `usePermissions()` + `isAssignee =
  summary.assignedToId === session.user.userId`: Start (L525) `PENDING && isAssignee && !loading`;
  Re-start (L518) `REJECTED && isAssignee`; Save/Complete (L532) `IN_PROGRESS && isAssignee`;
  Approve/Reject (L493) `COMPLETED && canApprove && !isAssignee`; "correct stock levels" (L505)
  additionally `canEdit("stock")` and hidden when `warehouseId` is null; delete icon (L387)
  `canDelete("stock_audit")`. L563: drop the `status !== "PENDING"` wrapper — the item list
  renders read-only while PENDING (the "click does nothing" screen). Header shows the scope. L486-490
  make the `<Link>` the button. **Explicit zero:** `BASELINE_END` (2026-07-31) is past, so Complete
  needs every item counted and −/+ cannot record 0 — add a 44 px `0 ✓` pill left of "−" in both
  row renderers while uncounted (`setCount(item.id, 0)` already marks dirty and autosaves); replace
  the Complete `confirm()` with an inline error when `remaining > 0`. Raw `fetch` (L115, 132, 140,
  195, 226, 253, 273, 304, 314) → `apiFetch`/`apiTry`; `createLogger("stock-audit:detail")`.
- `stock-audit/new/page.tsx`: `useStores()`; two-step picker **store chips → "Whole store"
  (verify-only caption) | one chip per `store.warehouses`** (labelled by warehouse NAME);
  auto-title `Stock Count - <warehouse ?? store>`; body `{ title, dueDate, notes, assignedToId,
  storeId, warehouseId? }`.
- `stock-audit/page.tsx:51-55` → `apiTry`, scope under the title; `[id]/review/page.tsx:26` drop
  `type`. New `(dashboard)/_components/my-stock-audits.tsx`:
  `?mine=1&status=PENDING,IN_PROGRESS&limit=5` and, for approvers, `?status=COMPLETED&limit=5`
  under "Awaiting your approval"; mount above the `pickDashboard()` call (`page.tsx:993`;
  the function is defined at L974) when `can("stock_audit","view")`. The delete icon at
  `stock-audit/[id]/page.tsx:387-390` has no permission gate today — `canDelete("stock_audit")`
  is new, not a relabel.
- Verify: create with store → whole store / warehouse chips, no type pills; whole-store
  `systemQty` = sum across warehouses; the assignee (even holding `approve`) sees Start on PENDING,
  items read-only, then counts with +/− and `0 ✓`; Complete refuses while anything is uncounted; a
  non-assignee approver has Approve/Reject on COMPLETED; correct-stock on a whole-store audit →
  readable 400; Refresh on a scoped audit keeps the scoped `systemQty`; dashboard card lists the
  assignee's audits; brand-count wizard still creates and completes.
- Known follow-up: `StockCount` DELETE reversal (`[id]/route.ts:338-376`) still writes
  `Product.currentStock` directly — unchanged.

### P7 — inbound per-line receiving, saved category, Report Issue
- `src/lib/inbound/complete-shipment.ts`: `finaliseDelivered(tx, shipmentId, userId, fromStatus)`
  claims the transition with `updateMany({ where: { id, status: { not: "DELIVERED" } } })`, and
  **only when `count === 1`** sets `deliveredAt/By`, fulfils MATCHED pre-bookings,
  `logActivity(delivered)` and returns the snapshot — that claim count is the idempotency key, so
  a second caller can never finalise twice. `scheduleDeliveredSideEffects(snapshot, actor)`
  registers `after()` for the `inbound.delivered` notification (today in `after()` at
  `api/inbound/[id]/status/route.ts:236-258`) **and for the Zoho `createBill` push, which today
  runs inline in the request at L260-296** — moving it into `after()` changes it from
  synchronous to deferred, a behaviour change the PR must name (a push failure no longer fails
  the response; it is logged). **Call it only after `await prisma.$transaction()` resolved**
  (`after` also runs when the response throws; a rollback cannot recall a push). Two guards on
  the push: it runs only for the caller whose claim succeeded, and
  **`if (snapshot.zohoBillId) skip`** — a shipment that *came from* a Zoho bill must not create a
  second bill in Books once DELIVERED is reachable on the common path (`zohoBillId` is set only
  by `pull-review/approve/route.ts:357`, so manual shipments rely on the claim guard alone).
- `api/inbound/[id]/route.ts` PUT (L51-215; the per-line branch is L69-183, `existing` fetched
  at L60 and used only for the 404, `wasDelivered` read at L79 outside the `$transaction` that
  opens at L93): `export const runtime = "nodejs"`; Zod
  `inboundReceiveLineSchema { lineItemId, deliveredQty, warehouseId }`, `inboundCategorySchema`,
  `inboundIssueSchema { lineItemId, issueType, issueQty?, notes? }`. Gates before the tx: shipment
  approved (today the per-item route has no approval gate) → 403; `categoryId` set → else 400
  "Choose the shipment category before receiving"; not DELIVERED; line belongs to the shipment;
  `deliveredQty === quantity` (D6) → else 400. Inside the tx: **idempotent claim**
  `updateMany({ where: { id, isDelivered: false } })` — `count === 0` → `alreadyReceived` without
  touching stock (today `wasDelivered` is read outside the tx, so a double-tap double-adds); then
  stock add / INWARD txn / `adjustWarehouseQty` / pre-booking fulfil, `logActivity(received)`,
  `remaining = count(isDelivered:false)`: 0 → `finaliseDelivered`; else first receipt flips
  `IN_TRANSIT → PARTIALLY_DELIVERED`. After the tx: `if (becameDelivered)
  scheduleDeliveredSideEffects(...)`. Respond `{ updated, alreadyReceived, shipmentDelivered }`.
  New `categoryId` branch: category exists; refuse (400) once any line is received; tx = update +
  `logActivity(updated, old → new)`. GET includes `category { id, name, parent { name } }`.
- **Delete `api/inbound/[id]/status/route.ts`** — its only callers are the two buttons removed
  below. `api/inbound/[id]/approve/route.ts`: select `shipmentNo`; update + `logActivity(approved)`
  in a tx.
- `api/categories/[id]/route.ts` DELETE counts `inboundShipments` among its blockers (Restrict FK).
- **New `api/inbound/[id]/issues/route.ts`** — why it fails today: the button is gated on
  `inbound.edit`, the endpoint needs `vendor_issues.create` (no seeded role holds it → 403), and
  shipments without a Zoho bill send no `vendorId` → 400. POST guarded by `inbound.edit`;
  description `[INBOUND] <product> — Short by N of Q / N damaged / Wrong item / Quality — <notes> |
  Bill: … | Shipment: …`; priority HIGH for SHORTAGE/DAMAGE; one tx: vendor = `vendorBill.vendorId`
  ?? Vendor by brand name (insensitive) ?? create one (mirrors `pull-review/approve/route.ts:118-130`);
  `issueNo` via `nextSequence(tx, "ISS-YYYYMM", 4)` **and `api/vendor-issues/route.ts:104-121`
  switched to the same call**; `vendorIssue.create({ issueSource: VENDOR, billId, createdById })`;
  `logActivity(issue_reported)`; 201 `{ id, issueNo }`.
- `src/components/ui/searchable-select.tsx`: no combobox exists (pattern hand-rolled in
  `vendor-issues/new/page.tsx:325-380`). Props `{ options: {id,label,hint?}[], value, onChange,
  placeholder?, emptyText?, disabled? }`; `role=combobox` 44 px input, filter on label/hint
  (`fuzzyMatch` fallback), clear button, `absolute z-20 max-h-60` list of 44 px `role=option`
  buttons, ArrowUp/Down/Enter/Escape, click-outside. No portal.
- `inbound/[id]/page.tsx`: delete `shipmentType` + localStorage + `handleTypeSelect` (L128-156),
  `handleMarkDelivered` (L209-258), `handleRevert`/`showRevertConfirm` + modal (L111, L359-380,
  L906-923), the Mark All / Partial / Undo blocks (L694-729), unused `Truck`/`RotateCcw`. Category
  panel replaces L627-668: while `!shipment.categoryId` the blue panel holds a `SearchableSelect`
  fed by `GET /api/categories` flattened parent + children (`hint` = parent) → `PUT { categoryId }`;
  once set, a grey "Category: <name>" row with Change until the first line is received. Per line
  (replace L835-843): uncounted → **blue** `Receive ×N` (44 px) when `canDeliver && isApproved &&
  categoryId && status !== DELIVERED`; tap → confirm sheet ("Receive <product>? ×N into
  <warehouse>") → `handleReceiveLine` (`apiTry`) → **green** `Received ×N ✓`; `shipmentDelivered`
  shows the existing "Inward Completed" confirmation. Report Issue calls the new route; error shown
  **inside the modal**; success → "Logged as ISS-…" (drop "Sravan will be notified" — nothing
  notifies anyone). All `fetch` → `apiFetch`/`apiTry`; `createLogger("inbound:detail")`.
- Guard check (data): `GET /api/categories` is on `stock.view` (comment `api/categories/route.ts:11-15`, call at L18).
  A receiving role without it gets an empty picker — verify the receiving role's grants on
  `/team/permissions` before release.
- Verify: category select searches, keyboard-navigates, persists across reload/devices; no
  Receive button until approved + category set; `Receive ×N` → confirm → green; Partial after the
  first, Delivered after the last with one Books bill; double-tap adds stock once; category change
  refused after the first receipt; Report Issue on a shipment with no Zoho bill creates ISS-…
  visible on `/vendor-issues`; deleting a category used by a shipment gives the blocker message.
  Grep `rg -n "inbound/.*status" src` → nothing.

### P8 — `/stock` one-tap reorder + search fix
The button opens a bottom sheet; the user types reorder level, reorder qty and optionally the
vendor, presses OK; the card updates in place. **Write path: a new narrow route
`PUT /api/products/[id]/reorder`** (`stock.edit`, `reorderSettingsSchema { reorderLevel, reorderQty,
reorderVendorId? }`). Rejected: the full `PUT /api/products/[id]` parses
`productUpdateSchema = productSchema.partial()` (`validations.ts:68`) — every field including
`costPrice`, `sellingPrice` and `sku` with no per-field check — so wiring a "reorder" sheet to it
would hand any `stock.edit` holder a cost-price write while reading cost needs `cost_price.view`
(that pre-existing gap is noted in §10 as a follow-up); `update-levels` is `reorder.edit` (and
already accepts `reorderVendorId` ungated by Zod at `update-levels/route.ts:26` — it stays, and
gets the Zod schema); `PATCH` is status-only after P3.
- `src/lib/reorder.ts`: `isLowStock = reorderLevel > 0 && currentStock <= reorderLevel`,
  `suggestedOrderQty = reorderQty || max(1, reorderLevel − currentStock)`; replaces the copies in
  `stock/page.tsx:112,118,125,439`, `reorder/page.tsx:127,185,352`, `api/reorder/route.ts:51,83`.
- `validations.ts` (`productSchema` is L32-66; `productUpdateSchema` L68): new
  `reorderSettingsSchema { reorderLevel: int ≥ 0, reorderQty: int ≥ 0, reorderVendorId: string | null }`;
  `productSchema` gains `reorderVendorId` too so `/stock/[id]`'s full edit form can set it;
  `reorderLevelsSchema` (items 1..500) for `PUT /api/reorder/update-levels` (keeps `reorder.edit`,
  gets a logger).
- `api/products/[id]/reorder/route.ts` (new) and the existing PUT: vendor must exist and be
  active → 400 "Vendor not found or inactive".
- `src/components/ui/bottom-sheet.tsx` (new **here**, not in P12): one shared sheet primitive —
  `fixed inset-0 z-[60]` backdrop, Esc, focus trap and focus return from `filter-sheet.tsx`
  (L58-73, L126), `pb-safe`, `items-end` on mobile and a centred `max-w-md` card on `sm+`. P12's
  send sheet and P14's dispatch panel reuse it; the deliveries route keeps its private
  `bottom-sheet-modal.tsx` untouched. Two sheet patterns landing in two phases was the earlier
  draft's mistake.
- `src/components/reorder-sheet.tsx`: built on that primitive; number inputs
  `inputMode=numeric min-h-[44px]`; vendor `<select>` from `apiTry("/api/vendors?limit=500")`
  (the list route's `parseSearchParams` caps at 500, default 50 — `api-utils.ts:67-85`; hidden
  with a note on 403); OK → `apiFetch("/api/products/<id>/reorder", { method: "PUT", json })` →
  `onSaved(updated)`; `ErrorBanner` inside.
- `stock/page.tsx`: `RowBtn` "Reorder" (`RefreshCw`) in the row-action group (L825-860) when
  `canEdit("stock")`, with `preventDefault` + `stopPropagation` (the card is inside a `<Link>`);
  `Reorder @ N` on the card when `> 0`; patch `products` state in place.
- `stock/[id]/page.tsx`: Reorder qty + Vendor select in the edit form (the PUT branch P2 left).
- **Bulk vendor assignment** (§10 BL9): `POST /api/products/bulk` (today `brandId | categoryId |
  binId | status`, guarded `stock.create` at `bulk/route.ts:19` — **changed to `stock.edit`**: it
  rewrites existing rows, the route's own comment calls it the fix-up tool for imported rows, and
  a `stock.edit` role that can use the reorder sheet must not get a 403 on the one screen that
  can assign vendors brand by brand) gains `reorderVendorId` (validated active vendor), and
  the `/stock` bulk bar (`handleBulkApply`, `bulkAction` union) gains "Reorder vendor" with the
  same vendor `<select>`. Filter `/stock` by brand → Select all → set vendor: one action per brand
  instead of one per product. This is how `resolveVendors` tier 1 gets its data before P10.
- `api/products/search/route.ts`: add `costPrice` (gated by `userCan(cost_price.view)` as
  `api/products/route.ts:115`), `gstRate`, `brandId`, `reorderQty`, `reorderVendorId` — fixes the
  `₹NaN` on `/purchase-orders/new` (`ProductOption` expects both; the route selects neither).
  Do not re-add `@/lib/product-type`.
- Verify: 375 px Reorder → sheet → OK → badge flips without reload; the card link is not
  triggered; non-admin with `stock.edit` but no `vendors.view` → picker hidden, save works;
  `/purchase-orders/new` search shows no `₹NaN`.

### P9 — PO state machine, numbers, duplicates, approval
- **Duplicate rule:** refuse with 409 when an open PO (DRAFT, PENDING_APPROVAL, APPROVED,
  SENT_TO_VENDOR, PARTIALLY_RECEIVED) for the same vendor already contains any requested product.
  Response `errorResponse(msg, 409, { conflicts: [{ poId, poNumber, status, productIds }] })`;
  the page shows "Already on PO-00042: Item A, Item B" with **Open PO-00042** and **Remove those
  lines and continue**.
- **One creator, two callers.** `src/lib/purchase-orders/create.ts` `createPurchaseOrder(input, user)`
  owns the whole write and is called by both `POST /api/purchase-orders` and
  `brand-stock/uploads/[id]/generate-po` (today a second, independent `purchaseOrder.create` at
  `generate-po/route.ts:58`, outside any transaction — left alone it would bypass the duplicate
  rule from the one screen most likely to re-order the same brand twice). Inside one
  `prisma.$transaction(fn, { maxWait: 5000, timeout: 15000 })` — the defaults are 2 s / 5 s and a
  second caller waiting on the lock would fail with P2028 instead of a clean 409 —
  `SELECT pg_advisory_xact_lock(hashtext(vendorId))` (the transaction-scoped variant is the only
  safe one on the 6543 `pgbouncer=true` pooler: pgbouncer pins the connection for the
  transaction and the lock dies with it; the session variant would leak onto a pooled
  connection — write this in the PR so nobody "fixes" it; `hashtext` is int4 and may collide
  across vendors, which only over-serialises), then `findOpenPoConflicts`, then
  `nextSequence`, then the insert. First use of advisory locks in this codebase.
- **No silent ₹0 purchase orders.** `createPurchaseOrder` refuses with 400 "Line <sku> has no
  rate — enter a unit price" when any `unitPrice` is 0; a free item is a note, not a zero line.
  This matters because P8 hides `costPrice` from users without `cost_price.view`, and the page
  would otherwise default those lines to 0 and P12 would email that PDF to the vendor.
- **PO number:** `nextSequence(tx, "PO", 5)` → `PO-00042`, replacing both generators
  (`api/purchase-orders/route.ts:77-80` 5-digit, `generate-po/route.ts:37-42` 4-digit;
  `regexp_replace` seeding collapses legacy 4-digit numbers correctly).
- **Transitions** (`PO_TRANSITIONS`, enforced by `PUT /api/purchase-orders/[id]` and `applyTransition`):

| From | To |
|---|---|
| DRAFT | PENDING_APPROVAL, CANCELLED |
| PENDING_APPROVAL | DRAFT, CANCELLED (APPROVED only via the approve route) |
| APPROVED | SENT_TO_VENDOR (P12 email send **or** mark-sent), DRAFT, CANCELLED |
| SENT_TO_VENDOR | PARTIALLY_RECEIVED, RECEIVED, CANCELLED |
| PARTIALLY_RECEIVED | RECEIVED, CANCELLED |
| RECEIVED, CANCELLED | none |

- `POST /api/purchase-orders`: `submit: boolean = true` → PENDING_APPROVAL, else DRAFT;
  `logActivity(created)`.
- `PUT /api/purchase-orders/[id]`: `purchaseOrderUpdateSchema { status?, notes?, expectedDate? }`;
  `status: APPROVED` → 400 "Use the Approve action"; `status: SENT_TO_VENDOR` → 400 "Use Send to
  vendor or Mark sent"; illegal move → 409; notes/date edits only in DRAFT or PENDING_APPROVAL →
  else 409 "Re-open to draft before editing"; back to DRAFT clears `approvedById/approvedAt`.
- `POST /api/purchase-orders/[id]/approve`: `purchase_orders.approve`; PENDING_APPROVAL only;
  self-approval allowed with `log.warn("po self-approved")` and noted in `details` (O7).
- `generate-po/route.ts`: calls `createPurchaseOrder` (so it gets the lock, the duplicate check,
  `nextSequence` and PENDING_APPROVAL for free); drop the non-existent `hsnCode` (built at L50,
  passed at L74 — a runtime Prisma error today); vendor resolution follows in P11.
- `/purchase-orders/[id]`: buttons by state (DRAFT → Submit; PENDING_APPROVAL → Approve
  (`canApprove`) + Send back to draft; APPROVED → Mark sent (kept until P12) + Re-open; pre-RECEIVED
  → Cancel). List page: `STATUS_FILTERS` (`purchase-orders/page.tsx:41`) already includes
  `PENDING_APPROVAL`; only `statusVariant` (L47) and the card accents (L156-165) need the colour.
  `/purchase-orders/new`: 409 card + Submit / Save draft; when `costPrice` is absent from the
  search response the rate input is empty and required, never prefilled 0; `ApiError.data` in
  `api-client.ts`.
- Verify: two tabs create at once → distinct numbers; duplicate → 409 card names the PO; "Remove
  those lines" succeeds; DRAFT → Submit → Approve (hidden and 403 without the permission) →
  APPROVED; PUT notes on APPROVED → 409; Re-open clears approval; PUT `status: APPROVED` → 400.

### P10 — vendor derived from the product, read-only
**Resolution order** (`resolveVendors`, two bulk queries: `vendor.findMany` for the distinct
`reorderVendorId`s + `brandVendor.findMany({ where: { brandId: { in }, vendor: { isActive: true } } })`):
1. `Product.reorderVendorId` if active → `source: "PRODUCT"`;
2. `BrandVendor.isPrimary` for the product's brand (`schema.prisma:2447-2461`, "the usual billing
   route for this brand", read by nothing today) → `"BRAND_PRIMARY"`;
3. exactly one `BrandVendor` row → `"BRAND_ONLY"`;
4. else unresolved (`NO_VENDOR` | `AMBIGUOUS`, with `candidates`).

**Mixed vendors in one selection → one PO per vendor in a single submit.** The API stays
single-PO; the page runs the groups in order and reports each outcome, so a 409 on group 2 never
rolls back group 1's real PO.
- `GET /api/reorder`: select `brandId`, attach `vendor: Resolution`, `groupBy=vendor` groups by the
  resolved vendor. `/reorder` page: group header shows the resolved vendor; unresolved rows show
  amber "No vendor · Set" opening `ReorderSheet`; Create PO blocked while any selected item is
  unresolved (lists them); handoff `sessionStorage["reorder-po-items"] = { v: 2, items: [{
  productId, quantity }] }` — nothing else carried from the client (today `brandName` is written
  and never read, `gstRate` hardcoded 0).
- `POST /api/purchase-orders/prepare` (new, `purchase_orders.create`): `{ productIds (1..200),
  quantities? }` → per product `{ sku, name, stock, levels, suggestedQty, gstRate, costPrice?
  (cost_price.view), vendor, availability }`, `groups[{ vendorId, vendorName, productIds,
  scopeEmpty }]`, `unresolved[]`.
- `/purchase-orders/new`: with a v2 handoff, one vendor section per group, vendor **read-only**
  with caption ("from brand's primary vendor"), editable qty, unit price from `costPrice` (when
  hidden by `cost_price.view` the field is empty and required — see P9's ₹0 rule), GST from the
  product, "Excluded — not available at vendor" sub-list with "Include
  anyway" (filled by P11), per-group Submit / Save draft, "Create all (N)" with a per-vendor
  `ActionConfirmation` report. Manual path: vendor `<select>` stays (`?limit=500`, fixing the
  100-row cap at L34), then product search sends `vendorId`.
- `api/products/search?q=&vendorId=&includeUnavailable=`: with `vendorId` filter to
  `reorderVendorId = vendorId OR brandId IN vendorProductScope(vendorId)`.
- `PUT /api/vendors/[id]/brands` (new, `vendors.edit`, `{ brands: [{ brandId, isPrimary }] }`,
  transaction deleteMany + createMany) + "Brands supplied" chips with a primary star on
  `/vendors/[id]` — without it `BrandVendor` can never be populated. Also an Email field on
  `/vendors/[id]` (the PUT accepts it; only `/vendors/new` has the input, L122-123).
- Create-time check: `POST /api/purchase-orders` re-resolves every product and refuses with 400
  "<product> is not supplied by <vendor>. Set its vendor first." on mismatch.
- Verify: select items across two vendors → two read-only sections, GST prefilled; an unresolved
  item blocks with names; manual path search scoped to the vendor; empty scope shows "No products
  are linked to this vendor yet".

### P11 — brand-stock sheet: colour-coded availability, no AI
- `package.json`: `exceljs` (server-only; `excel-parser.ts` is imported by route handlers only;
  `serverExternalPackages: ["exceljs"]` if the bundler complains; check the on-disk size against
  `npm view exceljs dist.unpackedSize` — truncated installs have happened here).
- `src/lib/excel-parser.ts`: `parseExcelBuffer` becomes async; `.xlsx` via exceljs (`ws.eachRow`,
  unwrap richText/formula/hyperlink/Date), existing header/column detection (`detectHeaderRow`
  over the first 8 rows), per row `rowColor = fillKey(nameCell.fill) ?? first fill among
  sku/qty/price cells ?? null`, `fillKey` → `"argb:FFxxxxxx" | "theme:N:tint" | "indexed:N" |
  null` (pattern fills only); `.xls`/`.csv` stay on SheetJS with `rowColor: null`; keep the
  1000-row cap; skip `qty <= 0` only when a qty column exists.
- **Conditional formatting is the one thing `cell.fill` cannot see** (§10 Q5). If a vendor's
  colours come from a conditional-formatting rule rather than a static fill, every `fillKey` is
  null. Handle it explicitly: when an `.xlsx` yields zero distinct fills, the response carries
  `colorSummary: []` and `conditionalFormattingCount = ws.conditionalFormattings?.length ?? 0`;
  the legend card then says "No row colours were found — this sheet may use conditional
  formatting. Ask the vendor to save it as values (Paste Special → Values and formats) or mark
  availability below", and every row gets a manual Available / Not available toggle (writes
  `availability` per item through the existing items PUT). Get **one real vendor sheet before
  starting P11** and confirm the fills are static; evaluating conditional-formatting rules in
  code is out of scope.
- `POST /api/brand-stock/upload`: persist `rowColor`; AI path gets an `available` field in its
  prompt, `rowColor: null`; `new Anthropic()` moves inside `parsePdfWithAI` and throws "AI parsing
  needs ANTHROPIC_API_KEY. Upload the sheet as .xlsx to parse without AI." before any network call.
- `GET /api/brand-stock/uploads/[id]`: `colorSummary[{ key, argb|null, count, samples[3] }]`,
  `suggestedLegend` (the brand's most recent confirmed legend).
- `PUT /api/brand-stock/uploads/[id]/legend` (new, `purchase_orders.edit`): `{ legend:
  Record<colorKey, AVAILABLE|UNAVAILABLE|IGNORE>, reconfirm? }`; transaction of `updateMany` per
  key (UNAVAILABLE clears `selected`/`orderQty`); stores `colorLegend` + `legendConfirmedAt`; 409
  if already confirmed without `reconfirm`.
- `/brand-stock/[id]`: "Confirm row colours" card (xlsx, until confirmed): swatch, count, three
  sample names, 44 px segmented Available / Not available / Ignore; nothing preselected unless the
  suggested legend matches; Confirm disabled until every key is labelled; "Create PO" disabled
  until confirmed; badges + "Available" filter chip afterwards.
- `getVendorAvailability(vendorId, productIds)`: latest `PARSED|REVIEWED` upload per brand in the
  vendor's scope (`distinct: ["brandId"]`; xlsx without a confirmed legend = no sheet) → `AVAILABLE
  | UNAVAILABLE | NOT_ON_SHEET | NO_SHEET`; badges in search ("In stock at vendor" green, "Not on
  sheet", "No sheet"), in `prepare`, and in `generate-po`.
- `generate-po`: `resolveVendors` instead of the fuzzy `name contains brand` match; exclude
  UNAVAILABLE.
- Verify: colour-coded `.xlsx` → legend card → confirm → unavailable rows unselected and excluded
  from the PO; `.csv` skips the legend; PDF without the key returns the clear message; PO search
  shows availability badges.

### P12 — approved PO → real email with the PDF attached
**Guards:** `GET …/pdf` on `purchase_orders.view`; `POST …/send`, `POST …/mark-sent` on
`purchase_orders.edit`.
- **Company identity (O4):** `loadCompanyIdentity()` = active `Store` with the lowest `sortOrder`
  (name, address, phone, `gstin`) + `NotificationConfig.fromName/fromEmail`; `log.warn` when GSTIN
  is blank. (If P0 chose "BCC orders separately", the PO's `storeId` wins.)
- **Mailer:** `src/lib/notify/types.ts` `EmailMessage` (L70-75) += `attachments?: { filename,
  content: Buffer, contentType }[]`, `cc?`, `replyTo?`; `email.ts:90-103` threads them into
  `sendMail` and counts attachment bytes in the debug log. `notify()` untouched (its only literal
  `EmailMessage` at `notify/index.ts:184` compiles unchanged).
- **PDF:** `src/lib/purchase-orders/pdf.ts` (server-only) `renderPurchaseOrderPdf(po, company):
  Promise<Buffer>` with static `jsPDF` + `autoTable` imports (`jspdf@4.2.1` ships a Node build;
  `exports["."].node`). A4, 14 mm margins: company block | `PURCHASE ORDER`, PO no, date, expected
  by | vendor block (name, code, address, GSTIN, primary contact) | items `# | SKU | Description |
  HSN | Qty | Rate | GST % | Amount` (stored `item.amount`, never recomputed) | totals from the PO
  row | delivery address | notes | "Approved by <name> on <date>" | page x of y. Amounts as
  `Rs. 1,23,456.00` via `Intl.NumberFormat("en-IN")` — the 14 standard fonts are WinAnsi and
  cannot draw `₹`. `Buffer.from(doc.output("arraybuffer"))`. If `next build` reports
  `canvas`/`jsdom` module-not-found, add `serverExternalPackages: ["jspdf", "jspdf-autotable"]`.
  `GET /api/purchase-orders/[id]/pdf` returns it inline (`Content-Disposition: inline`,
  `Cache-Control: no-store` — the response pattern is `api/media/[...key]/route.ts:49-55`, but that
  route sets an immutable cache header for media keys; a PO PDF must not). Commit the PDF first —
  verifiable alone.
- **`POST …/send`** (`runtime = "nodejs"`, `maxDuration = 60`; `purchaseOrderSendSchema { to?:
  email, cc?: email, note?: ≤1000 }`): (1) load PO + vendor + primary `VendorContact` + items.product
  {name, sku, hsnCode, size, color} + approvedBy + last send; (2) APPROVED or SENT_TO_VENDOR → else
  409 "PO must be approved before it can be sent"; (3) recipient = `body.to ?? vendor.email ??
  primaryContact.email` → else 400 "Vendor has no email address. Enter one below or add it to the
  vendor."; (4) last send within 60 s and not FAILED → 429; (5) insert `PurchaseOrderSend` PENDING
  (channel EMAIL) **before** SMTP so a double-tap is caught mid-flight; (6) render PDF (failure →
  row FAILED, 500); (7) `sendEmail({ email: to, name: vendor.name }, { ...buildPoEmail(po,
  company, note), cc, attachments: [{ filename: "PO-00042.pdf", … }] })` — `NotConfiguredError` →
  row FAILED, 503; `ok: false` → row FAILED, 502 with the SMTP sentence; **PO untouched in both**;
  (8) best-effort `tryGetStorage()?.put("purchase-orders/<poNumber>/<sendId>.pdf")` → `pdfUrl`;
  (9) transaction: send row SENT (+ `messageId`, `pdfUrl`), PO `sendCount++`, `sentToEmail`,
  `sentById`, `sentVia = EMAIL`, `sentAt ??= now`, `updateMany({ where: { id, status: "APPROVED" } })
  → SENT_TO_VENDOR`, `logActivity(sent)`; (10) `log.info` with `maskEmail(to)`; 200.

**Delivery semantics are at-least-once, and the plan says so.** Steps 6–9 can die at the
`maxDuration = 60` kill or a crash after Gmail accepted the message. Two mitigations: (a) the
instant `sendMail` resolves, one small `update({ messageId, completedAt })` on the send row
**before** the bigger transaction, so the crash window is one statement wide; (b) on route entry
a sweep marks any PENDING row older than 5 minutes `FAILED` with `error: "unknown — timed out"`,
so a stale PENDING never blocks or misleads. Order Info shows a messageId-bearing row whose PO
never flipped as "sent, not confirmed". The PDF filename and `sendCount` are how the vendor
spots a duplicate.
- **`POST …/mark-sent`** (O6; `{ channel: "WHATSAPP" | "MANUAL", note? }`): APPROVED only → send
  row SENT with that channel, PO `sentVia`, `sentById`, `sentAt`, `sendCount++`, SENT_TO_VENDOR via
  `applyTransition`, `logActivity`. The WhatsApp share link stays a link.
- **Email body** (`buildPoEmail`): subject `Purchase Order PO-00042 from <company>`; text + 600 px
  single-column HTML: PO no, date, item count, grand total (`₹` is fine here), expected date, the
  note, "The purchase order is attached as PDF. Please reply to confirm.", signature; `replyTo =
  company.email ?? fromEmail`.
- **`GET /api/notifications/status`** (new, `requireAuth`, no secrets) → `{ emailReady, reason }`
  (`GET /api/notifications/config` is on `settings_notifications.view`, which a PO clerk lacks).
- **UI `/purchase-orders/[id]`:** replace the three raw `fetch().then(r => r.json())` (L48, L58,
  L68) with `apiFetch`/`apiTry`. APPROVED: **Send to vendor** (primary, `Mail`, 48 px) · **Mark
  sent** (outline; tiny sheet with channel + note) · WhatsApp link. SENT_TO_VENDOR: **Resend** ·
  WhatsApp. Send disabled with "Email not configured — Settings › Notifications" when
  `!emailReady`; hidden without `purchase_orders.edit`. P8's `src/components/ui/bottom-sheet.tsx`
  hosts `_components/send-to-vendor-sheet.tsx`: To (prefilled, required), CC with "Copy me", Note to
  vendor, "Preview PDF" (opens `/pdf`), Cancel | Send (spinner, disabled in flight; API message
  inline on error, sheet stays open). Success → `ActionConfirmation` "Sent to vendor" with address
  and attachment name. Order Info gains "Sent by email to a@b.com on 4 Sep 2026 by Ravi (2×)" or
  "Marked sent via WhatsApp by …". `src/types/index.ts` `PurchaseOrder` (L239) gains the optional
  send fields.
- Verify: `/pdf` opens inline on desktop and phone, `Rs.` amounts, HSN filled, page footer on a
  40-line PO; send to your own address → email with the PDF; DB: SENT_TO_VENDOR, `sentVia EMAIL`,
  one SENT row with `messageId`; resend → `sendCount 2`, status unchanged; double-tap → 429; wrong
  App Password → 502 with the Gmail sentence, PO still APPROVED, FAILED row, no secret in logs
  (grep the console for the password and its base64); email off → button disabled, POST 503;
  Mark sent via WhatsApp → SENT_TO_VENDOR with `sentVia WHATSAPP`; `view`-only role → `/pdf` works,
  send hidden and 403; DRAFT/PENDING_APPROVAL → 409; sheet fits 360 px, keyboard does not hide Send.

### P13 — stores: GSTIN + state code, legacy transfers route
**Rescoped 4 Sep (owner): no floor/godown work.** There are exactly two scopes, store and
warehouse. `Warehouse.storeId` (`schema.prisma:289`) already allows any number of warehouses per
store, and `/stores` already creates them (`stores/page.tsx:104` -> `POST /api/warehouses`,
`api/warehouses/route.ts:55`). A "floor" is a warehouse the owner adds and names. So this phase
drops `Warehouse.kind`, the `<CODE>_FLOOR` seeding, and every kind-label in the pickers.
Size falls from M (11) to **S (~5)**.
- `storeSchema` (`validations.ts:823`) + `POST|PUT /api/stores`: `gstin` (the Vendor regex at
  `validations.ts:270`, `.or(z.literal(""))`), `stateCode` (`/^d{2}$/`, "29" for Karnataka).
  `GET /api/warehouses|stores` return `gstin`, `stateCode` (printed on every invoice; not
  sensitive; both routes stay `requireAuth`).
- `src/lib/warehouses.ts` `WarehouseRef` select (L31) gains `store { gstin, stateCode }` - one
  query, so P14's document derivation does not run a second.
- **`clearWarehouseCache()` after `POST /api/warehouses`** - the module-level cache at
  `warehouses.ts:24` is deliberately never invalidated ("a warehouse created mid-request is not a
  case worth designing for"). The moment the owner can add a warehouse to an existing store from
  `/stores`, that case is real. This is the one cache bug this phase must fix.
- `/stores` page: GSTIN (uppercase, 15 chars) + state code in the store draft; GSTIN under the
  address line. Warehouse rows already render; nothing to relabel.
- **Not done here:** `prisma/seed-stores.ts` is unchanged (still one warehouse per store); the
  receiving picker and brand-count wizard are unchanged (they list active warehouses by name and
  that is now correct); BL14/O10's kind-filtering is void.
- Dashboard EOD summary (`(dashboard)/page.tsx:134`) -> `/api/transfer-orders?dateFrom=...`, uses
  `orderNo`; `api/reports/daily/route.ts:38` counts `status IN [APPROVED, IN_TRANSIT, RECEIVED]` by
  `reviewedAt`; then **delete `src/app/api/transfers/**`** (bin-only, status encoded in `notes`;
  nothing else calls it).
- Verify: `/stores` saves and shows GSTIN + state code; adding a warehouse to an existing store on
  `/stores` makes it appear in the audit and receiving pickers **in the same session** (the cache
  fix); EOD summary still lists today's transfers; `/reports/daily` count sane.

### P14 — transfer lane, derived type, in-transit flow (MIG-2)
**Type and required document are derived at create time, stored, never chosen:**
```
transferType    = from.storeId === to.storeId ? "INTRA_STORE" : "INTER_STORE"
INTRA_STORE                                   → requiredDocType = "DELIVERY_CHALLAN"
INTER_STORE, either store's gstin missing     → 400 "Set the GSTIN for <store> on /stores before transferring between stores"
INTER_STORE, fromStore.gstin !== toStore.gstin → "TAX_INVOICE"
INTER_STORE, gstins equal                     → "DELIVERY_CHALLAN"
```
A missing GSTIN must refuse, not default to a delivery challan: every store has its own GSTIN
(O1), so an inter-store move on a DC is the exact compliance hole the owner asked to close, and
silently defaulting would hide the missing master data (§10 BL11). The `/transfers/new` banner
shows the same sentence in amber with a link to `/stores` before the user builds the list.

| Owner's words | Type | Document | Why (GST) |
|---|---|---|---|
| Store-to-store (different GSTINs, O1) | INTER_STORE | Tax invoice raised in Zoho Books, PDF uploaded here | Distinct registrations are distinct persons (CGST s.25); the movement is a supply even without payment (Schedule I para 2) and needs a tax invoice (s.31, Rule 46). IGST if states differ |
| Floor ↔ godown within one store | INTRA_STORE | Delivery challan | Same registration; Rule 55(1)(c) |

E-way bill applies to movement, not supply: needed on a DC too above ₹50,000 consignment value —
dispatch warns. Both documents are **upload-only in v1** (Zoho Books is the tax system of record;
an app-generated invoice would create a second series). An in-app DC PDF is v1.1 sharing the P12
renderer moved to `src/lib/pdf/`. Orders created before this feature have `requiredDocType = NULL`
and dispatch without a gate. A later GSTIN edit must not rewrite history — hence stored.

**Status flow** (`assertTransition` in `src/lib/transfers/transitions.ts`):

| From | To | Guard | Stock effect |
|---|---|---|---|
| PENDING | APPROVED / REJECTED | `transfers.approve` | none (stock check only) |
| PENDING | CANCELLED | `transfers.delete` or creator | none |
| APPROVED | IN_TRANSIT (dispatch) | `transfers.edit`; from P15 also the document gate | source `adjustWarehouseQty(−qty)`; `InventoryTransaction TRANSFER "[DISPATCHED] … | TRF-…"`; `unitCost` snapshot from `costPrice`; `consignmentValue` |
| APPROVED | CANCELLED | `transfers.delete` | none |
| IN_TRANSIT | RECEIVED (receive) | `transfers.edit`; `receivedQty` per item | destination `+receivedQty`; shortfall → `ADJUSTMENT "[TRANSIT SHORTFALL]"` |

Auto-approve for creators holding `approve` lands in APPROVED **without moving stock** (receipt
copy: "Approved — attach the document and dispatch"). Cancel from IN_TRANSIT is not allowed in
v1. In-transit quantity is a separate number (`getInTransitMap(productIds)` = Σ item qty over
IN_TRANSIT orders, by destination code), never added to `currentStock`, never a fake warehouse
row (`recomputeCurrentStock` unchanged). Site scoping: a user with `User.warehouseId` may dispatch
only from it and receive only into it; unassigned users pass. `transfers.edit` and
`transfers.delete` (consumed by nothing today) gain meaning; no catalog change.
- **Header lane:** `POST /api/transfer-orders` takes `{ fromWarehouseId, toWarehouseId, items:
  [{ productId, quantity }], notes? }`; same lane → 400; both active via `listWarehouses()`; 400
  insufficient at source (`getWarehouseBreakdown`); policy from `WarehouseRef.store`; `orderNo`
  via `nextSequence(tx, "TRF-YYYYMM", 4)` inside the transaction (today a read-then-write at
  L151-160 that runs *before* the transaction; auto-approve at L162-164, which today also moves
  stock at create time, L228-230); header + mirrored item lane (item columns kept this release;
  the API refuses an item lane that differs from the header); no stock move on auto-approve.
- `GET /api/transfer-orders` (L31-88; `transfers.view`, creator-scoped without `approve`):
  `status` accepts all six; new `?toWarehouseId=` filter (the receiving clerk's "incoming to me"
  view, served by the `[toWarehouseId]` index); include header `fromWarehouse { store { name } }`,
  `toWarehouse`, doc fields. `GET /api/transfer-orders/[id]` (new): full order, items with product
  `{ name, sku, hsnCode }`, **`unitCost` and `consignmentValue` only with
  `userCan(cost_price.view)`** — Σ qty × cost on a small transfer is trivially invertible into unit
  cost, so everyone else gets `eWayBillRequired: boolean` — and a server-computed `actions[]` so
  the UI never derives buttons from role names.
- `POST …/[id]/approve` (add Zod `{ action, rejectionNote? }`): `assertTransition`; approve =
  stock check + status only; fills `requiredDocType` for pre-policy rows; `logActivity`.
- `POST …/[id]/dispatch` (new): `{ vehicleNo?, transporterName?, eWayBillNo? }`; APPROVED only;
  tx: recheck source stock, `adjustWarehouseQty(−qty)`, snapshot `unitCost`, `consignmentValue`,
  INVENTORY row, `logActivity(dispatched)`; `warnings[]` when > ₹50,000 and no e-way number.
- `POST …/[id]/receive` (new): `{ items: [{ itemId, receivedQty 0..quantity }], note? }`;
  IN_TRANSIT only; every item present; tx: `adjustWarehouseQty(+receivedQty)`, `TRANSFER
  "[RECEIVED]"`, `ADJUSTMENT −shortfall "[TRANSIT SHORTFALL]"` per short item; RECEIVED;
  `logActivity(received)`.
- `POST …/[id]/cancel` (new): PENDING/APPROVED only; reason reuses `rejectionNote`.
- `/transfers/new`: one "Route" card (From / To grouped by store, kind in the label; To excludes
  From), derived banner ("Inter-store → Tax invoice from Zoho required before dispatch" /
  "Intra-store → Delivery challan required" / amber "Set GSTIN on /stores to decide the document");
  rows are product + qty only (remove the per-row selects at L366-389); draft key
  `transfer-order-draft-v2`; document is not collected here (raise the invoice in Zoho after the
  order is agreed).
- `/transfers/[id]` (new, after `inbound/[id]/page.tsx` as rewritten in P7): header with lane and
  type chip; Items with a per-item receive stepper when IN_TRANSIT (shortfall in red; RECEIVED →
  received/short columns); Timeline (created/approved/dispatched/received by + at, vehicle, e-way);
  bottom action bar rendered from `actions[]`: Approve/Reject · Dispatch (P8's bottom sheet:
  vehicle, transporter, e-way; "Value ≈ ₹x — e-way bill required" only with `cost_price.view`,
  otherwise "E-way bill required for this consignment") · Receive · Cancel.
  `/transfers` list: filters In transit / Received / Cancelled; card → detail link; lane from header.
- `activity/route.ts`: labels for the new statuses (rows come from `logActivity`, not synthesis).
- Verify: both migration folders apply; legacy APPROVED read RECEIVED with `receivedQty`; create →
  PENDING, no StockLevel change; approve → no change; auto-approve creator → APPROVED, no move;
  dispatch → source `−qty`, `currentStock −qty`, `[DISPATCHED]` row; receive with one shortfall →
  destination `+received`, `[TRANSIT SHORTFALL]`, RECEIVED; cancel from IN_TRANSIT refused; every
  illegal pair returns the `assertTransition` message; role with only `transfers.view+create` can
  create, cannot dispatch/receive; value > ₹50,000 without e-way → warning. `npm run db:snapshot`
  before merge (build the script if it still does not exist).

### P15 — transfer documents
- `src/lib/storage/upload-policy.ts`: append `"transfers/"` to `ALLOWED_PREFIXES` (L10-19);
  `checkContentType(contentType, key)` consults a per-prefix map — `transfers/` → `application/pdf`
  or `image/*`; default image/video as today (L40-45). Both callers (`media/presign/route.ts:26`,
  `upload/route.ts:37`) go through `checkUpload`, so no route edits. Key
  `transfers/<orderNo>/<tax-invoice|delivery-challan>-<ts>.<pdf|webp|jpg>`.
- `POST /api/transfer-orders/[id]/document` (new, `transfers.edit` or creator): `{ docType,
  docNumber (1-40), docDate?, docUrl, eWayBillNo? }`; PENDING/APPROVED only; 400 `docType !==
  requiredDocType`; 400 when `docUrl` is not under `/transfers/<orderNo>/`; sets uploadedBy/At;
  replace allowed until dispatch.
- Dispatch gate: APPROVED → IN_TRANSIT requires `docUrl` and `docType === requiredDocType`
  (skipped when `requiredDocType` is null): 400 "Attach the <doc> first".
- `/transfers/[id]` Document card: required doc label; if attached: number, date, uploader,
  View, Replace (pre-dispatch); else hidden `<input type="file" accept="application/pdf,image/*">`
  + number/date fields + Upload — images through `compressImageFull` (as
  `vendor-issues/new/page.tsx:144-148`), PDFs as-is, `uploadMedia(blob, key, type)`, then the
  document route. Action bar gains "Attach document". List: doc badge (`FileCheck`) when `docUrl`.
- Verify: PDF to `transfers/TRF-…/tax-invoice-<ts>.pdf` accepted via presign and via `/api/upload`;
  PDF to `vendor-issues/` still rejected; image to `transfers/` accepted; floor → godown says
  delivery challan; BCH godown → BCC godown says tax invoice; dispatch 400 until the right document;
  wrong `docType` → 400; legacy-policy order (null) dispatches without a document; the banner flips
  when the two stores' GSTINs are equal vs different.

---

## 8. Risks

- **Deploy gap** (owner accepted, D3/D9): migrate → promote back-to-back, after closing, after a
  `pg_dump`. Two events for the whole plan (§4).
- **Front-loaded columns** sit unused for weeks; the two new `TransferOrderStatus` values are
  invisible to `tsc` (no exhaustive map exists) and are handled by grep in P1; nothing writes
  them until P14.
- **Sales are erased by the next warehouse write — today, not hypothetically.** Deliveries
  deduct `Product.currentStock` directly (`api/deliveries/[id]/route.ts:165-225`) and never touch
  `StockLevel`; `adjustWarehouseQty` (`stock-location.ts:43`) and `setWarehouseQty` (L56) both end
  in `recomputeCurrentStock`, which sets `currentStock = Σ StockLevel`. So sell 5, then receive
  any shipment, apply any audit or approve any transfer of that product, and the 5 come back.
  P14's "dispatch → `currentStock −qty`" holds only for products with no sales since their last
  per-warehouse audit. This is pre-existing and outside this plan's scope; §10 Q3 schedules the
  fix (sales deduct from a warehouse) right after P13, and until then the per-warehouse audit is
  the reconciliation. Every PR that touches `adjustWarehouseQty` names this.
- **P4 flips server guards and client gates together** (`import-zoho` writes rows on a `fetch`
  grant today); shipping the UI half alone would leave the write reachable by URL.
- **P7 defers the Zoho bill push** from inline to `after()`; a push failure no longer fails the
  response. The claim-count guard is what keeps that safe.
- **P1 → P2 → P3 in that order, each deploying itself** (O11): the build applies each PR's folder
  before its code is live. The only gap is MIG-1b's drops during the P3 build, when the old
  deployment's product and stock-count reads 500 for a few minutes — merge P3 after closing.
  P2 alone is safe on the old schema.
- **`StockCount.location` dead zone** (P6 promote → MIG-2): audits created by pre-P6 code between
  MIG-1 and P6 have null FKs and show as unscoped verify-only; MIG-2's re-backfill fixes the rows.
  Keep the P3 → P6 gap short. Unresolvable legacy codes → verify-only (pre-check SQL in §4).
- **Whole-store audits are verify-only from P6** — say so in P6's PR.
- **Two allocators on one series** is the merge's own hazard: never leave `vendor-issues` or
  `generate-po` on `MAX+1` after their partner switches to `Counter`.
- **Review order matters**: P9 → P10 → P11 diffs on `api/purchase-orders/route.ts`,
  `purchase-orders/new`, `products/search` read as noise out of order; same for P2 → P3, P14 → P15.
- **P4 Option B is a permission cut**: until the grant step runs, roles that had only Deliveries ›
  fetch lose the button. Put the step in the PR body and the runbook.
- **P14/P15 gap**: inter-store dispatch is ungated between their promotions — promote together.
- **Dirty tree**: `trigger-pull` and `inbound/[id]/status` carry uncommitted notifications-branch
  edits; P4 and P7 must not inherit them by accident (P0).
- **BCC decision deadline is P0**: after MIG-1 the answer costs a third migration.
- **Green-build blind spots**: the ⚠ sites in P3, the `where`-spread in `stock-counts`; verification
  is the grep list plus opening the screens, not `tsc`.
- **Zoho duplicate bill on delivery** — guarded by `zohoBillId` in P7. **`after()` registration** —
  only after the tx resolved. **Feed duplicates** for inbound approve/deliver — dedupe in P5.
- **Custom ranges before 1 Apr** now answer 400 with a message instead of being silently clamped.
  **Zoho filters on bill date, not creation date** — a bill entered today but dated outside the
  window is still not fetched; the logged window + the skipped list make the next "missing bill"
  diagnosable.
- **Stale "Product Types" nav** until `npm run db:seed:rbac` runs.

## 9. Out of scope (say so in each PR)

- `db:restore:local` beyond the minimal script in P0 (adoption plan §8); the CI migrations job
  (adoption plan §7). The build wiring (§4) and `db:snapshot` are built in P0/P1 (O11).
- Bin mode (`BIN_TRACKING_ENABLED=false` branches kept compiling, not extended); ported service
  routes; the `IB-` sequence race (`sequence-race-fix-plan.md`); `StockCount` delete reversal
  bypassing `StockLevel`; dropping `TransferOrderItem` lane columns and `Warehouse.transfersFrom/To`
  (the release after P15); an in-app delivery challan PDF (v1.1); a per-PO "ordering store" picker
  unless decided at P0; an "AI draft" cover-note button (after the AI-provider plan); a second IST
  module — extend `services/timezone.ts` only.
- Converting the 83 existing `Float` money columns (`docs/schema-review.md` §4) — no new ones are
  added here; new money is `Decimal(12,2)`.

---

## 10. Open questions and blockers (raised 4 Sep 2026, before any code)

Each row names what stops or changes the build, the phase it affects, who decides, and the
recommended answer. **Blockers** are facts checked on disk or in the environment; **questions**
are decisions only the owner can make. Update the "Status" column as they close.

### 10.1 Blockers

| # | Blocker | Phase | Recommended resolution | Status |
|---|---|---|---|---|
| BL1 | **`.env` points at the Supabase pooler**, not localhost (checked 4 Sep: `DATABASE_URL` → `…pooler.supabase.com:6543`, `DIRECT_URL` → `…:5432`). `migrate dev` against it is banned and would try to create a shadow database on the cloud project. | P1 (every `migrate dev`) | Switch both URLs to `localhost:5432/bch` (cloud values stay in `.env.bak-partB`); add `scripts/db/assert-localhost.mjs` and gate `db:migrate` on it (P0 step 3) so the check runs itself every time. | open |
| BL2 | **Dirty working tree** on `feat/notifications-and-settings-rbac`: 25 modified files (the `runtime = "nodejs"` headers incl. `trigger-pull` and `inbound/[id]/status`, `validations.ts`, `middleware.ts`, `sw.js`, `CLAUDE.md`, `login/page.tsx`) + untracked `login-form.tsx`, this plan, the runbook. Every phase branches from `main` after this merges; P4 and P7 edit or delete two of those files. Git is gated — nothing moves without the owner's approval. | P0 | One commit on the branch ("chore: nodejs runtime on notify-reaching routes, login form split, docs"), PR, merge. If the branch is not ready to merge as a whole, cut **P2** from `main` now — it has no schema and no overlap — and rebase later. | open |
| BL3 | **Which database is production?** The Supabase project in `.env.bak-partB` is the cloud *test* database, baselined 2 Sep (`0_init` resolved). Whether Vercel's production environment points at the same project is unknown (adoption plan Q1). If it is a different project it has no `_prisma_migrations` and MIG-1 cannot be applied to it. | MIG-1 (after P3) | Open Vercel → Project → Settings → Environment Variables → Production and compare the `DATABASE_URL` host with `.env.bak-partB` (compare hosts, never paste the URL). Same → production is baselined, proceed. Different → run adoption plan §3 there first (snapshot, `migrate diff` must be empty, `migrate resolve --applied 0_init`, `migrate status`). | open |
| BL4 | **No migrate step in the build and no manual-promote gate.** `vercel.json` has only `regions`; `build` = `prisma generate && next build`. If Vercel deploys every merge to `main` automatically, the §4 runbook's "migrate, then promote" cannot be sequenced: the new code is live minutes after merge, before the owner runs `migrate deploy`, and every logged action and audit create fails until they do. | P3 (first migration event), P14 | **Recommended:** build adoption plan §4 inside P1 — `scripts/vercel-build.mjs` (`prisma migrate deploy` → `prisma generate` → `next build`, ~20 lines) and `"buildCommand": "node scripts/vercel-build.mjs"` in `vercel.json`. A failed migration is then a failed build and no deploy; the runbook shrinks to "snapshot, merge", and MIG-2 becomes automatic. The owner accepted hand-apply (D9) only because this wiring did not exist. **Alternative** if hand-apply must stay: turn off automatic production deploys in Vercel (Git settings) and promote by hand after `migrate deploy`. Decide before P3 merges. | **resolved 4 Sep (O11): auto-deploy confirmed; the build wiring is in P1's scope; §4 runbook rewritten** |
| BL5 | **No snapshot/restore tooling.** `scripts/db/` holds only `extract-vendor-backup.js`; there is no `db:snapshot` or `db:restore:local` script, yet the plan says "snapshot before merging a migration" and "local = scrubbed production dump". `pg_dump`/`psql` 17.6 are on PATH, but the Supabase password contains `@`, which libpq needs percent-encoded. | P0, every migration event | Write `scripts/db/snapshot.mjs` (build the encoded URL in node from `DIRECT_URL`, run `pg_dump -Fc` into `backups/<date>.dump`, never print the URL) and `scripts/db/restore-local.mjs` (`pg_restore` into `bch`, then the scrub: null `IntegrationConfig` secrets, `NotificationConfig.smtpPassword`, `StorageConfig` keys, delete `PushDevice`). ~80 lines together; `backups/` gitignored. Do it as P0's only code, or run the two commands by hand once and write the scripts in P1. | open |
| BL6 | **Local `bch` is seeded, not a restore** — no `ProductType` rows, no products pointing at them, no `StockCount` rows with a `location`. MIG-1b's drop and MIG-1a's backfill would pass locally without proving anything; the mixed-lane and unresolved-location pre-checks return nothing meaningful. | P1, P3, P14 | Restore a scrubbed dump before P1 (BL5). If that is not possible in time, at least run `scripts/import-products.ts` locally so `Product.productTypeId` is populated, and insert two `StockCount` rows by hand with `location = 'BCH_WAREHOUSE'` and `location = 'OLD_CODE'` to exercise both branches of the backfill. | open |
| BL7 | **Zoho cannot be exercised on a scrubbed local database** (the restore nulls the `IntegrationConfig` credentials), and re-connecting on localhost only works if the Zoho API console lists a localhost redirect URI. P4's acceptance test is a real pull. | P4 | Two workable options: (a) add `http://localhost:3000/...` to the Zoho app's authorised redirect URIs (Zoho allows several) and connect once locally; (b) verify P4 on a Vercel preview deployment whose env points at the cloud test project, after connecting Zoho there. (a) is faster and keeps the preview clean; ask the owner which console they can reach. | open |
| BL8 | **Email is shipped switched off and no Gmail App Password is stored.** P12's acceptance test is a real send. | P12 | Google account → Security → 2-Step Verification on → App passwords → create one for "Mail" → Settings › Notifications: host `smtp.gmail.com`, port 587, TLS on, user = the Gmail address, the 16-character password, From name/address → "Send test email" → enable email. Needed only before P12 verification; nothing earlier depends on it. | open |
| BL9 | **`BrandVendor` is empty and `Product.reorderVendorId` is null on (almost) every product** — no seed or import writes them and nothing reads them today. After P10 every product resolves to "No vendor" until the data exists, and the reorder → PO flow is blocked on it. | P10 | Two data paths, both in the plan now: **P8 adds `reorderVendorId` to `POST /api/products/bulk` and the `/stock` bulk bar** (filter by brand → select all → set vendor: one action per brand), and **P10 adds brand ↔ vendor chips on `/vendors/[id]`** (`BrandVendor.isPrimary`). Do the bulk assignment right after P8 ships, brand by brand; the primary-vendor chips are the safety net for products added later. | open |
| BL10 | **Vendor email addresses**: `Vendor.email` is optional and `/vendors/[id]` has no email field (only `/vendors/new`). P12 answers 400 "Vendor has no email address" until they are entered. | P12 | P10 adds the Email field to `/vendors/[id]` (already in the plan). Add to P12's send sheet a **"Save this address to the vendor"** checkbox (`PUT /api/vendors/[id]`, needs `vendors.edit`; hidden without it), so an address typed on the first send is captured. Plus a one-off pass over the vendor list before P12 goes live. | open |
| BL11 | **Store GSTINs and state codes must be entered on `/stores` after P13**, before any inter-store transfer. With both GSTINs null the original rule silently produced a delivery challan for a move that legally needs a tax invoice. | P13 → P14 | Rule changed in P14: an INTER_STORE transfer with either GSTIN missing is **refused** ("Set the GSTIN for <store> on /stores before transferring between stores"), never defaulted; the `/transfers/new` banner says the same with a link. Data step added to §4: enter GSTIN + state code for every store right after P13 promotes. | resolved in plan; data step open |
| BL12 | **No non-admin test role exists.** Every phase's "done" needs a walk as a role holding only that phase's permission; the frontend role-check removal plan records that half of its fixes were "not yet tested as a non-admin". | every phase | Create once on `/team/permissions`: role `TEST_STAFF` with no grants, and a user `test.staff@bch.local`. Per phase, grant only that phase's permission (e.g. `deliveries.view` + `zoho.fetch` for P4), walk the screen, remove the grant. Keep the user deactivated between phases. | open |
| BL13 | **CLAUDE.md is stale about the build.** It says three Staff LMS pages prerender against `DATABASE_URL` so `npm run build` needs a database (`CLAUDE.md:202-209`). Checked 4 Sep: all three (`staff-lms/playbooks`, `product-learning`, `products` `page.tsx:1`) start with `'use client'` and say why — converted 29 Aug (`completed/ci-build-database-dependency-plan.md`). Whether any *other* page still opens a DB at build time is unmeasured. The build still exceeds the 10-minute foreground limit. | every phase | Measure once in P1: run `npm run build` with Postgres stopped. If it passes, correct `CLAUDE.md:202-209` in the same PR and drop "Postgres up" from the §3 template; if it fails, the error names the page. Either way build in the background; `npx tsc --noEmit` (40–70 s) is the per-edit check. | open — measure in P1 |
| BL14 | **Floor warehouses would appear in the inbound receiving picker and the brand-count wizard** the moment P13 seeds them (`inbound/[id]/page.tsx:80,126,677`, `stock-audit/brand-count/page.tsx:13,41` consume the flat `useWarehouses()` list; the receive picker defaults to `warehouses[0]`). | P13 | Resolved in the plan: both pickers filter to `kind === "GODOWN"`; `WarehouseOption` gains `kind`. Owner chose "either, chosen at receiving" (O10): both kinds shown and labelled, the shipment's store godown preselected instead of `warehouses[0]`. | resolved in plan |
| BL15 | **Full-product PUT is a cost-price write for every `stock.edit` holder** (`productUpdateSchema = productSchema.partial()`, `validations.ts:68`, no per-field check), while *reading* cost needs `cost_price.view`. Pre-existing; the reorder sheet no longer routes through it (P8), but `/stock/[id]`'s edit form still does. | follow-up | Gate `costPrice` in the PUT on `userCan(cost_price.view)` (strip the field and 403 if it was sent) — a five-line change; add to P8 if the owner wants it now, else a follow-up plan. | open |

### 10.2 Questions for the owner

| # | Question | Why it changes the build | Recommendation | Phase |
|---|---|---|---|---|
| Q1 | **BCC invoices** — import them and tag deliveries by store, or keep skipping? | Decides two MIG-1a columns (`Store.invoicePrefix`, `Delivery.storeId`), a store chip on `/deliveries`, and whether the `centre` count exists. After MIG-1 the answer costs a third migration. | **Import and tag.** The skip is a store name hard-coded in a route; BCC is now a store with its own GSTIN and stock. Tagging also gives Q3 its foundation. **Answered 4 Sep: import and tag (O8).** | P0 → P4 |
| Q2 | **Which store places purchase orders?** Today the primary store (lowest `sortOrder`) is the buyer on every PO PDF. | If BCC orders separately, `PurchaseOrder.storeId` (nullable) goes into MIG-1a and a store picker into P12; the PDF header and GSTIN then follow the PO. | If both stores order from vendors under their own GSTIN, say so now; the column is one line in MIG-1a. If BCH buys for both, keep the primary-store default. **Answered 4 Sep: BCH buys for both (O9); no column.** | P0 → P12 |
| Q3 | **Sales are erased by the next warehouse write — a live defect, not a future one.** Deliveries deduct `Product.currentStock` directly (`api/deliveries/[id]/route.ts:165-225`) and never touch `StockLevel` (zero hits for `stockLevel`/`adjustWarehouseQty` in that file or `batch/route.ts`); `recomputeCurrentStock` (`stock-location.ts:20-30`) sets `currentStock = Σ StockLevel` and **runs on every** `adjustWarehouseQty`/`setWarehouseQty` (L43, L56) — every inbound receipt, applied audit and transfer. So today a sale of 5 is undone by the next shipment of that product. O2 makes it visible; it was already happening. | Decides whether any per-warehouse or total number can be trusted, and whether the fix is scheduled now or later. | **Schedule the follow-up immediately after P13, before P14 goes live:** "a DELIVERED/WALK_OUT delivery deducts `StockLevel` from its store's FLOOR warehouse (GODOWN if the floor has none)", which needs `Delivery.storeId` from Q1 — one more reason to accept Q1. Until then the per-warehouse audit (P6) is the reconciliation, and every PR touching `adjustWarehouseQty` says so. | after P13 |
| Q4 | **How should floor stock be established after P13?** All stock sits in the `_WAREHOUSE` (godown) rows today; the new FLOOR rows start at zero. | Decides whether P13 ships a one-time tool. | **Per-warehouse audit of each floor right after P13** (P6's module is exactly this tool, and it records the count with an assignee and approval). Not a bulk transfer — a transfer needs a document and would be a fiction for stock that never moved. | P13 |
| Q5 | **What does a real vendor sheet look like?** Two assumptions in P11 need one sample file: (a) one brand per upload (the `BrandStockUpload.brandId` model) — do vendors send multi-brand sheets? (b) are the colours static fills or conditional formatting (which `cell.fill` cannot see)? | (a) multi-brand sheets need `vendorId` on the upload and per-row brand detection; (b) conditional formatting means no colour reaches the parser. | Send one `.xlsx` from the most-used vendor before P11 starts. v1 keeps one brand per upload (split a multi-brand file by sheet or ask the vendor); P11 now includes the "no row colours found" fallback with a manual per-row toggle, so P11 ships either way. | before P11 |
| Q6 | **Deliveries permission cut (P4 Option B):** delivery staff need Settings › Integrations *fetch* and *approve* to pull and import invoices. Acceptable? | If not, the alternative is granting nothing and letting only admins fetch, or keeping Quick Search on `deliveries.fetch` (two grants per panel). | **Yes, grant them.** The `zoho` module has no sidebar route, so the grant exposes no screen; it is the one module that already guards the pull for `/inbound`, `/bills` and `/receivables`. Data step is in §4. | P4 promote |
| Q7 | **Zoho test path** — can the owner add a localhost redirect URI in the Zoho API console (BL7 option a), or should P4 be verified on a preview deployment (option b)? | Decides how P4's acceptance test is run and by whom. | Option (a); it also makes every later Zoho change testable locally. | before P4 |
| Q8 | **Vercel deploy mode** (BL4) — is production deployed automatically on merge to `main`, or promoted by hand? And may the migrate step go into the build? | Decides whether §4's runbook is executable, and whether the hand-apply events exist at all. | Put the migrate step in the build (BL4 recommended); keep the snapshot as the rollback. **Answered 4 Sep: auto-deploys on merge; migrate goes into the build (O11).** | P0 |
| Q9 | **Direct-to-floor receiving?** Should a shipment from a brand ever be received straight onto the shop floor, or always into the godown (BL14)? | Decides whether the inbound receive picker filters to GODOWN or shows both kinds. | **Godown only** (default in P13). The floor is stocked by transfer (with its delivery challan) or by a per-warehouse audit; receiving onto the floor would skip the document trail the owner asked for. **Answered 4 Sep: either, chosen at receiving (O10) — pickers show both kinds labelled, godown preselected.** | P13 |
| Q10 | **Delete the four orphaned `fetch` actions** (`deliveries`, `inbound`, `bills`, `customers`) from the RBAC catalog in P4, or keep them as grantable no-ops? | A catalog deletion cascades those permission rows off every role at the next `db:seed:rbac`; keeping them means four grants that do nothing. | **Delete**, after P4's grep confirms no route guards on them (§5.4) — the same reasoning that removed `stock.fetch`. | P4 |
| Q11 | **`ActivityLog` and the user** — the plan drops the FK and snapshots `userName` (one policy for every log table). Acceptable, or do you want a hard FK so a user with history can never be deleted? | Changes the P1 model. Note `DELETE /api/users/[id]/route.ts:200-229` already deactivates instead of deleting on any FK violation. | **No FK + snapshot** (as written): logs outlive users, `NotificationOutbox` set the precedent, and the feed never needs the join. | P1 |

### 10.3 What is not blocked

P2 (screen removals) can start on a branch from `main` today: no schema, no shared files with the
dirty tree, no environment prerequisite. P5, P8 and P9 need only P1 (and P3 for P8). Everything
else waits on the rows above, most of them on BL1–BL4, which are half a day of the owner's time.

---

## Clarifications — decision history (NOT current state; see ▶ RESUME HERE at the top)

### Session 1 — 4 Sep 2026, review pass verified against code

Method: `clarify-plan` — every "the code does X" claim, file:line citation, route, guard, model
field and package in §4–§10 was re-checked on disk by three independent sweeps plus a schema
review of MIG-1a/1b/MIG-2; prior sessions were treated as hypotheses. Roughly 220 claims checked.

### Verified against code
- **CONFIRMED:** every schema citation in §4 and "Verified facts"; every file the plan modifies
  exists with the named export; every file the plan creates is absent (no partial earlier work);
  all package versions (`prisma 6.19.3`, `next 16.2.3`, `xlsx 0.18.5`, `jspdf 4.2.1` with a Node
  build, `jspdf-autotable 5.0.7`, `nodemailer 7.0.13`, `@anthropic-ai/sdk 0.90.0`; `exceljs`
  absent); `vercel.json` = regions only; `build` = `prisma generate && next build`; no
  `db:snapshot`; `.env` on the Supabase pooler; 25 modified + 6 untracked files on
  `feat/notifications-and-settings-rbac`, stash empty, HEAD `6a7bb48`; all five P4 root-cause
  citations; all nine raw-`fetch` lines on the stock-audit detail page; every RBAC module key in
  §5.3; `zoho` module label "Integrations", `route: null`, parent `settings`; `fuzzyMatch`
  exists (`src/lib/utils.ts:81`); `after()` is used by seven routes.
- **DRIFTED (corrected in place):** `stock/page.tsx` L34 is the Reorder Level column, not Type
  (→ L29 + L42); `products/[id]` PATCH block L106-164; `productSchema` L32-66; transfer `orderNo`
  L151-160, auto-approve L162-164, list GET L31-88; `zoho-import-flow` tab bar L464-486;
  `pickDashboard()` call L993; `activity/route.ts` transfers L95-117; `categories/route.ts` guard
  call L18; `inbound/[id]` PUT branch L69-183; `purchase-orders/page.tsx` `statusVariant` L47,
  accents L156-165; `email.ts` `buildTransport` L285; legacy transfers `notes` L94.
- **WRONG, corrected:** §10 BL13 (Staff LMS pages are client components since 29 Aug —
  `CLAUDE.md:202-209` is stale); §5.1 "the API keeps a 400 backstop" (no backstop exists;
  `stock-counts/[id]/route.ts:194` silently writes global `currentStock` when the location does
  not resolve, contradicting its own comment at L187-191); P7 "notification and Zoho push are
  both in `after()`" (only the notification is, L236-258; `createBill` runs inline L260-296);
  P4 "bills has a To input to wire" (it has none — `bills/page.tsx:310` is From; only
  receivables has an unsent one at L66/L306); §4 "`IB-` has one allocator, untouched" (two:
  `inbound/route.ts:158-169` and `pull-review/approve/route.ts:326-337`, the second inside the
  import loop that P4 rewrites); §4 "`tsc` finds exhaustive status maps" (none exist);
  `sequence-race-fix-plan.md` cross-reference (its five sites and stale line numbers; it has no
  PO site; its §7 helper signature differs from §4 and is now superseded).
- **ALREADY DONE (noted):** `update-levels/route.ts:26` already accepts `reorderVendorId`;
  `purchase-orders/page.tsx:41` already lists `PENDING_APPROVAL`; `bill` branch of
  `pull-review/approve` already marks a duplicate preview APPROVED (L137-141).
- **NOT CHECKED (needs the database, the vendor's file or an external console):** row counts
  (`OpsActivityLog`, `BrandVendor`, `reorderVendorId`, App Password), local DB contents (BL6),
  Zoho console redirect URIs (Q7), the vendor sheet's fill type (Q5), Vercel deploy mode (Q8),
  and whether Prisma 6.19.3 wraps a migration folder in one transaction (documented behaviour;
  confirm once on localhost — §4 MIG-2).

### Corrections that changed the build (all applied above)
1. `Counter`: atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING`, numeric seed, PO fixed at 5
   digits with a legacy-row normalisation, `IB-` switched in P4 with both allocators.
2. One `createPurchaseOrder` helper for both PO creators; `$transaction` timeouts raised
   (defaults 2 s/5 s would turn lock waits into P2028); advisory-lock rationale recorded.
3. No ₹0 purchase orders: server refuses a zero-rate line; the page requires a rate when cost is hidden.
4. Reorder sheet writes through a new narrow `PUT /api/products/[id]/reorder`, not the
   full-product PUT (which is a cost-price write for every `stock.edit` holder — BL15).
5. Bulk product route moves to `stock.edit`; one shared bottom-sheet primitive lands in P8.
6. `ActivityLog`: no user FK, `userName` snapshot, valid Prisma; `PurchaseOrderSend` →
   `PurchaseOrder` is `Restrict` with its reason; `StockCount` indexes re-cut; composite transfer
   index dropped in favour of a `?toWarehouseId=` list filter.
7. Three audit scope states (one warehouse / whole store / legacy unresolved), and the P6 change
   is named as a data-integrity fix.
8. P4: `provider` not `source` in preview data (name collision at
   `pull-review/approve/route.ts:26-28,154,302`); `IntegrationConfig.lastAuthErrorAt` so the
   settings badge stops lying after a refused refresh; guards and gates flip in one commit; four
   orphaned `fetch` actions deleted (Q10); To inputs created, not wired, on inbound and bills.
9. P7: `finaliseDelivered` keys on the claim count (`updateMany … status ≠ DELIVERED`), the Zoho
   push becomes deferred (named), `PARTIALLY_DELIVERED` is a logged transition.
10. P13: floor rows filtered out of the inbound receive picker and brand-count wizard;
    `clearWarehouseCache()` after store create; `WarehouseOption.kind`.
11. P14: `consignmentValue` gated like `unitCost`; `eWayBillRequired` boolean for everyone else.
12. P12: at-least-once send semantics stated; messageId written immediately after SMTP accepts;
    stale-PENDING sweep on route entry.
13. §8 gains the live "sales are erased by the next warehouse write" risk; Q3 promoted from
    "if ever run" to "runs on every warehouse write", follow-up scheduled after P13.

### Answers (owner, 4 Sep 2026)
- Q8 Vercel deploy mode — **auto-deploys on merge; put the migrate step in the build.** → O11;
  §4 runbook rewritten; P1 scope gains `scripts/vercel-build.mjs` + `vercel.json`; D9 superseded;
  BL4 resolved.
- Q1 BCC invoices — **import and tag by store.** → O8; `Store.invoicePrefix` + `Delivery.storeId`
  in MIG-1a; P4 removes the three hard-coded skips and adds the store chip.
- Q2 Which store places POs — **BCH buys for both stores.** → O9; primary-store header, no column.
- Q9 Direct-to-floor receiving — **either, chosen at receiving.** → O10; pickers show both kinds
  labelled, godown preselected; BL14 rewritten.
- Still open, defaults in force: Q3 (follow-up after P13), Q4 (per-warehouse audit), Q5 (send a
  sample sheet before P11), Q6 (grant `zoho.fetch/approve`), Q7 (localhost redirect URI), Q10
  (delete the orphaned `fetch` actions), Q11 (no user FK on logs), BL15 (cost-price write gate —
  follow-up unless asked for in P8).

**Status line stays `pending`** until the owner says to start P1; then it becomes
`Status: in-progress — <date>, P1 …` and the `Branch:` line names the branch in play.

---

### Session 2a — 4 Sep 2026, owner review

Method: `clarify-plan`, second pass. The 4 Sep review section above was treated as a hypothesis and
re-checked on disk; its code claims held (spot-checks below). What changed is the **environment and
two owner decisions**, both of which cut scope.

### Reference branch and git workflow (owner, explicit)

- **The reference branch is `feat/notifications-and-settings-rbac`** — the branch this plan lives
  on. Every phase branch is cut from it. `main` is NOT the base.
- **Local `main` is stale** (never pulled from origin). Any measurement against it is void. The
  first pass reported "the branch is 49 commits ahead of main and main has no prisma/migrations"
  as a finding — that is an artefact of the stale local ref and is **withdrawn**.
- **Claude never merges locally.** The owner pushes, opens the PR, and merges it on GitHub.
- **Before creating any branch, Claude asks the owner which branch to use as reference** and checks
  it out first.
- BL2 is closed as written: the tree is clean (HEAD `5a040b7`).

### There is no production deployment (owner, explicit) — this voids a layer of the plan

The app has not been released. Work is local first, then the cloud test project.

| Plan item | Status |
|---|---|
| §1 "the owner walked the app the day after go-live (3 Sep)" | **wrong** — there was no go-live |
| D3, §8 "deploy gap", "merge after closing time" | **void** — nothing is serving |
| §4 step 4 "MIG-1b's drops mean old code 500s during the P3 build" | **void** — no users |
| §4 "snapshot before merging any migration", BL5 | **downgraded** — no production data to lose |
| BL3 "which Supabase project is production?" | **ANSWERED: none exists.** Supabase is the cloud TEST db |
| BL6 "local = scrubbed production dump" | **void** — local is reset from `0_init` + seed |
| §10 Q3 "sales erased in production today" | a real defect, but it corrupts test data, not the shop's |

**BL1 is closed:** `.env` now reads `localhost:5432/bch` for both `DATABASE_URL` and `DIRECT_URL`
(verified 4 Sep). The local database is reset from `0_init` and re-seeded.

### Two scopes only: store and warehouse (owner, explicit) — `Warehouse.kind` removed

> "there is only two scopes, store and warehouse, where per store you can already have more than
> one warehouse"

Verified: `Warehouse.storeId` (`schema.prisma:289`) already permits any number of warehouses per
store, and `/stores` **already creates them** — `stores/page.tsx:104` posts to
`POST /api/warehouses` (`api/warehouses/route.ts:55`). A grep of the whole schema for
`kind|FLOOR|GODOWN` returns 3 hits, all unrelated (`EvidenceKind`, `DiscountKind`, a vendor index);
"godown" appears once as plain English in a doc comment. **A "floor" is just a warehouse the owner
adds and names.**

Removed: `WarehouseKind { GODOWN FLOOR }` and `Warehouse.kind` from MIG-1a; the `<CODE>_FLOOR`
seeding and every kind-label from P13; BL14 and Q9/O10 (nothing to filter). P13 falls from M (11)
to S (~5). O2 stands as a business fact — it just needs no schema change to express.

### Delivery stock deduction is STORE-scoped (owner, explicit)

> "we must not have the stock reduction on delivery respected to the warehouse, we must have
> respected to the store scope"

The delivery route never names, shows or asks for a warehouse. It takes a **store** (from the
invoice prefix — `storeIdForInvoice()`, already built in P4 for O8) and deducts at store scope.
Internally the units must still land in `StockLevel` rows, because that is the only place stock
exists (`@@unique([productId, warehouseId])`, `schema.prisma:557`).
**Assumption in force unless the owner says otherwise:** deduct across the store's active
warehouses in `Warehouse.sortOrder` order, cascading to the next when one cannot cover it. Today
every store has one warehouse, so this is a single write.

### NEW PHASE P1b — stock ledger integrity (promoted from §10 Q3)

`Product.currentStock` is documented as a **cache**: `schema.prisma:542` — "StockLevel is the truth
for how much, where. Product.currentStock is the cached SUM of these rows." Half the code honours
that; half does not.

**Verified 4 Sep — seven routes write `currentStock` directly and never touch `StockLevel`:**
`deliveries/[id]/route.ts:223,235` · `deliveries/batch/route.ts:91,102` ·
`inventory/outwards/route.ts:82` · `inventory/cleanup/route.ts:32` · `stock-reset/route.ts:43` ·
`inbound/[id]/route.ts:239` (receipt reversal) · `stock-counts/[id]/route.ts:244,276,358` (P6 fixes
that one). Grepping `deliveries/[id]/route.ts` for `stockLevel|adjustWarehouseQty|setWarehouseQty`
returns **0 hits**. Only five files in `src/` call those helpers at all.

So a sale edits the cache but writes no ledger row; the next receipt, audit or transfer calls
`recomputeCurrentStock` (`stock-location.ts:20-28`), which rebuilds the cache from the ledger — and
the sale disappears. **The deduction is real, but survives only until the next stock movement.**

The `binId` branches in the inbound routes also write `currentStock` directly, but
`BIN_TRACKING_ENABLED = false` (`lib/inventory-config.ts:10`), so that path is dead.

**Scope (~6 files, no migration of its own):**

1. `lib/stock-location.ts` — new `deductFromStore(tx, productId, storeId, qty)`: check the store's
   total across its warehouses **first**, then take the quantity in `sortOrder` order via
   `adjustWarehouseQty`. The total check is mandatory: `adjustWarehouseQty` clamps at zero
   (`stock-location.ts:38`, `Math.max(0, ...)`), so a naive per-warehouse deduct would silently
   absorb the shortfall and lose the sale exactly as today.
2. `deliveries/[id]/route.ts:214-236` and `deliveries/batch/route.ts:85-103` — call it instead of
   writing `currentStock`. Store from `Delivery.storeId` (MIG-1a); no prefix match falls back to
   the primary store.
3. `inventory/outwards/route.ts:80-83` — same. **`outwardSchema` (`validations.ts:77-82`) carries no
   store or warehouse field at all** and needs one, defaulting to the primary store.
4. `inbound/[id]/route.ts:239` (undo a receipt) — deduct from the warehouse the receipt went into.
5. `stock-reset/route.ts:43` — zero the `StockLevel` rows, not only the cache.
6. Proof grep for the PR: no `currentStock:` write anywhere outside `stock-location.ts`.

`reservedStock` stays product-level — `recomputeCurrentStock` does not touch it.

**Why after P1, not after P13 as §10 Q3 said:** the fix needs only `Delivery.storeId`, which MIG-1a
adds. It never needed floor warehouses, and those no longer exist. With the database being reset
now there is nothing to reconcile — every row is right from the first one. Left until later, nobody
can tell whether `currentStock` or `StockLevel` is the true number, because the drift leaves no
trace. **P6, P8, P9, P10 and P12 all read this number**; verifying them against a lying value
verifies nothing.

### Spot-checks that re-confirmed the first pass

`stock-counts/[id]/route.ts:187-194` (global `currentStock` write when the location does not
resolve) · `inbound/[id]/status/route.ts:236` `after()` vs `:261` inline `createBill` ·
`trigger-pull/route.ts:267-270` (no client, so HTTP 200 with `invoicesNew: 0`) and `:142`
(`todayStr` = server UTC date) · `import-zoho/route.ts:16` (`requireFeature("deliveries","fetch")`
on a route that writes Delivery rows). All CONFIRMED. Every file the plan creates is still absent
(18/18); every file it deletes still exists; package versions unchanged, `exceljs` still absent.

### Answers (owner, 4 Sep 2026, session 2)

- **Reference branch** — `feat/notifications-and-settings-rbac`; never `main`; never merge locally;
  ask before creating a branch.
- **Production** — none exists; local first, then test.
- **Local database** — reset fresh from `0_init` and re-seed.
- **Scopes** — store and warehouse only; a store already holds many warehouses; no `Warehouse.kind`.
- **Delivery deduction** — store scope, never warehouse.
- **BL15** — folded into **P8**: `PUT /api/products/[id]` gates `costPrice` on
  `userCan("cost_price","view")`, stripping the field or 403 if it was sent.
- Still open: Q5 (sample vendor `.xlsx` before P11), BL7/Q7 (Zoho localhost redirect URI before P4),
  BL8 (Gmail App Password before P12), BL9 (vendor data before P10), BL12 (non-admin test role).

**Status line stays `pending`** until the owner says to start.

### Session 2b — 4 Sep 2026, requirement decisions

Five decisions taken with the owner after §0 was written. Each names the requirement it changes.

### R1 — the deliveries fetch/import UI is inline, laid out like `/stock`

> "i thik u have missed the ui of import where i dont need as the popup model make the ui like
> /stock the fetch and import"

Verified: it **is** a modal today — `zoho-import-flow.tsx:6` imports `BottomSheetModal`, `:54`
holds `sheetOpen`, `:354` `handleOpenSheet`, and the banners at `:434`/`:445` are suppressed while
the sheet is open. P4 already replaced it with an inline panel; the owner's instruction pins the
**pattern**: follow `/stock`, which uses an inline expanding panel and an inline bulk-action bar
(`stock/page.tsx:159` `showFilters`, `:202` `bulkAction`) rather than a dialog.

So P4's `zoho-fetch-panel.tsx` is: a header trigger that expands a `bg-slate-50` panel **in the
page flow**, chips for 3/7/14/30/Custom, From/To inputs, Fetch/Cancel, then the results as a normal
`Card` with checkboxes and an `Import N` button. No `BottomSheetModal`, no overlay, no focus trap —
the page scrolls behind nothing. Delete `bottom-sheet-modal.tsx`'s use here entirely.
**Applies to all four fetch screens** (`/deliveries`, `/inbound`, `/bills`, `/receivables`) so they
look the same.

### R4 — removals go first (execution order changed)

> "i think first we need to remove teh product type removeal we can remove the thing at the first"

§0.6 now runs **P2 → P3 → P1 → P1b → …**. Phase IDs are unchanged so every existing cross-reference
still resolves. MIG-1b (P3) becomes the first migration folder after `0_init`, MIG-1a (P1) applies
on top; they are independent DDL so the order between them is free. P2 must still precede P3.

### R3 — an inbound issue is a vendor issue

> "on creating an issue fro the inbound screen respected to the item the repost must be added in
> the vendor issues data"

Confirmed as already specified in P7 and now stated as the requirement: `POST /api/inbound/[id]/issues`
writes a real `VendorIssue` row (`issueSource: VENDOR`, `billId`, `createdById`, `issueNo` from
`nextSequence(tx, "ISS-YYYYMM", 4)`) so it appears on `/vendor-issues` like any other. The three
reasons it fails today are unchanged: the button is gated on `inbound.edit` while the endpoint
needs `vendor_issues.create`, and a shipment with no Zoho bill sends no `vendorId` and 400s.
Vendor resolution: `vendorBill.vendorId`, else a Vendor matched on the brand name
(case-insensitive), else create one.

### R7 — the availability sheet is read WITHOUT AI

> "give me suggestion which is better should i use ai or can it be done without ai"

**Decision: no AI.** A row's fill colour is a stored property of the `.xlsx` (the file is a zip of
XML; a filled row literally carries `fgColor rgb="FF00B050"`). Reading it is a lookup, not a
judgement — deterministic, offline, instant, free.

AI would be strictly worse here, not merely unnecessary: the colour is not in the sheet's *text*,
so an AI path would have to render the sheet to an image and ask a model which rows "look green" —
slower, paid per upload, and non-deterministic against a value the file states as fact.

**Why a new dependency is needed:** the current parser is SheetJS (`xlsx@0.18.5`,
`excel-parser.ts:1`), the community build, which does not expose fill colours. `exceljs` reads
`cell.fill` directly. That is the whole reason `exceljs` is added in P11.

**AI stays exactly where it is:** `parsePdfWithAI` (`lib/pdf-parser.ts:1`, `new Anthropic()`),
used only by `brand-stock/upload/route.ts:39` for PDF and image sheets. `ANTHROPIC_API_KEY` is
needed for that path and no other.

**How it works end to end:** exceljs reads each row's fill and groups rows by colour → the app
shows one card per distinct colour (swatch, row count, three sample product names) with three
44 px buttons, Available / Not available / Ignore → the user labels each colour once → the legend
is stored on the upload (`colorLegend`, `legendConfirmedAt`) and pre-filled on the brand's next
upload → rows labelled Not available are unselected and excluded from the generated PO.
**The app never interprets a colour itself.**

**The one failure mode, handled:** if the vendor's colours come from a *conditional formatting
rule* rather than a painted fill, the file stores the rule and `cell.fill` is empty for every row.
Detected by "zero distinct fills on an `.xlsx`" → the legend card says so, reports
`conditionalFormattingCount`, and offers a manual Available / Not available toggle per row. The
vendor can also be asked to save once with Paste Special → Values and formats. Evaluating
conditional-formatting rules in code stays out of scope. **§10 Q5 still stands: one real vendor
sheet is needed before P11 starts**, only to find out which of the two cases this is.

### R9 — PO email unchanged

Gmail App Password over SMTP, PO PDF attached, no API key and no AI (§6). BL8 stands: the App
Password must exist in Settings › Notifications before P12 can be verified.

### BL7 / Q7 CLOSED — Zoho is testable locally

> "Zoho on localhost in the local databse oit has the itigration data"

Verified 4 Sep: the local server's **`bch-local`** database holds three connected providers —
`ZOHO_BOOKS`, `ZAKYA_POS`, `ZOHO_INVENTORY`, all `isConnected = true`, organisation
"Bharath Cycle Hub", with client id, client secret and refresh token present. (`bch` itself had
zero rows; the credentials were in the other local database.) Access tokens expired 1 Sep, which is
harmless — the client refreshes from the refresh token on first use.

`scripts/db/restore-integrations.mjs` (new, `npm run db:restore:integrations`) copies those rows
from `bch-local` into whatever `DATABASE_URL` points at, so a `migrate reset` no longer costs a
re-connect. It is a **script, not a seed**, deliberately: `integration_config` stores
`clientSecret`, `refreshToken` and `accessToken` in plaintext (`schema.prisma:988-1003`), and a
seed file lives in git — a committed seed would put live Zoho credentials into the repository
history permanently. The script reads database-to-database at run time, writes nothing to disk,
prints no secret value, and refuses any target that is not localhost.

**So P4 no longer needs a Zoho console change.** BL7 option (a) is moot and Q7 is answered: P4 is
verified against the real Zoho API from localhost.

### Session 2c — 4 Sep 2026, migration naming, build wiring, db:push

### Migration naming — the practice, and the names this plan uses

**Decision taken by Claude at the owner's request ("take ur desison respected to migration with
best prctice").** The rules, in order of importance:

1. **Ordering comes from the timestamp, never the name.** Prisma prefixes every folder with a UTC
   timestamp (`20260904103012_`) and applies them in that order. A name that encodes sequence adds
   nothing and can only ever contradict the timestamp.
2. **Name the migration after the CHANGE, never after its position in a plan.** Plans get
   reordered — this one just did, when the owner moved the removals to the front — but a merged
   migration is permanent. `mig1a` / `mig1b` encoded a plan position and became wrong within a day
   of being written. That is the whole argument.
3. **`snake_case`, verb first, object second:** `add_activity_log`, `drop_product_type`,
   `backfill_transfer_lanes`. Readable in `ls`, greppable, and it tells a reviewer what the SQL
   should contain before they open it.
4. **One migration is one coherent change, named for it.** If the name needs an "and" three times,
   the migration is doing too much and probably should not be one folder.
5. **Never rename or edit a merged migration.** Prisma records a checksum of the SQL in
   `_prisma_migrations` and refuses a folder whose contents changed. A rename after merge is a
   failed deploy. Renaming is free only *before* the folder exists — which is the case here: only
   `0_init` exists today.

**The names, therefore:**

| Was (plan shorthand) | Folder name | Phase |
|---|---|---|
| MIG-1b | `drop_product_type_and_moving_level` | P3 (runs first under §0.6) |
| MIG-1a | `add_activity_log_counter_and_scope_columns` | P1 |
| MIG-2 | `backfill_transfer_lanes_and_drop_stock_count_location` | P14 |

**MIG-1a / MIG-1b / MIG-2 stay as prose labels in this document** — they are useful shorthand in
sentences like "MIG-1a is additive". They are not folder names.

### R13 — the Vercel build wiring is BUILT (not deferred to P1)

> "create it where i will use test in versel so that i can check how ci works in versel"

Built 4 Sep, ahead of P1, so the owner can watch a preview deploy run migrations against the
Supabase **test** project before any phase work depends on it:

- **`scripts/vercel-build.mjs`** — `prisma migrate deploy` → `prisma generate` → `next build`,
  each with `stdio: "inherit"`, aborting on the first non-zero exit and printing the elapsed time
  per step. A failed migration is a **failed build**: nothing deploys and the previous deployment
  keeps serving. Prisma prints each applied folder itself, so the build log is the audit trail.
  `spawnSync(..., { shell: true })` so it also runs from Windows locally.
- **`vercel.json`** — `"buildCommand": "node scripts/vercel-build.mjs"` beside the existing
  `"regions": ["bom1"]`.
- `migrate deploy` reads **`DIRECT_URL`** automatically through `directUrl` in the datasource block
  (`schema.prisma:5-9`), which is already set. Migrate takes a session lock; the 6543 transaction
  pooler never releases it, so `DIRECT_URL` must stay the **5432 session pooler** in the Vercel
  environment variables.
- `migrate deploy` is the only Prisma command permitted against a non-local database: it never
  creates a shadow database, never resets, and applies only committed folders.

**P1's scope shrinks accordingly** — it no longer builds this wiring, only the schema, the
`ActivityLog` table, `counter`, and the helpers.

**Before the first preview deploy, check in Vercel → Settings → Environment Variables:**
`DATABASE_URL` (6543 pooler, `pgbouncer=true`) and `DIRECT_URL` (5432 session pooler) both point at
the **test** project. The first preview build should report "No pending migrations to apply",
because the test project was baselined to `0_init` on 2 Sep — that no-op is the proof the wiring
works, before any real migration rides on it.

### `db:push` removed, and `db:migrate` now guards itself

- **`db:push` is gone from `package.json`.** CLAUDE.md has banned `prisma db push` since migrations
  were adopted on 2 Sep; leaving the script in place kept the banned command one habit away.
- **`scripts/db/assert-localhost.mjs`** (new) reads `.env`, prints the **hostnames only** — never a
  URL — and exits 1 unless both `DATABASE_URL` and `DIRECT_URL` are `localhost` / `127.0.0.1`.
- **`"db:migrate": "node scripts/db/assert-localhost.mjs && prisma migrate dev"`** — the check runs
  itself, every time, instead of relying on remembering. `.env` has pointed at both localhost and
  the Supabase pooler within the same week, which is exactly the accident this prevents.
- **`"db:migrate:status": "prisma migrate status"`** added — read-only, safe against any
  environment, and the first thing to run when a deploy looks wrong.
- Verified both directions: with `.env` on localhost it passes and prints
  `DATABASE_URL -> localhost`; against a Supabase URL it exits 1 with the reason and no credential
  in the output.

**These three items were built ahead of the phases** because every phase from P3 onward runs
`migrate dev`, and the guard has to exist before the first one, not alongside it.

### Session 2d — 4 Sep 2026, P1b store resolution

**Owner chose option B, 4 Sep.** P1b was going to depend on `Delivery.storeId`, which nothing
populates until P4 builds `storeIdForInvoice()`. Under §0.6 P1b runs BEFORE P4, so every sale
would have fallen back to the primary store and a **BCC sale would have deducted BCH stock** for
the whole window between them.

**P1b therefore gains store resolution and becomes self-contained (+2 files):**

- `src/lib/deliveries/zoho-invoice.ts` — created HERE, not in P4. Exports
  `storeIdForInvoice(invoiceNo, stores)`: longest matching `Store.invoicePrefix` wins, no match
  returns null (caller falls back to the primary store with a `log.warn`). Pure and unit-testable.
- `/stores` + `storeSchema` (`validations.ts:823`) gain the **`invoicePrefix`** field
  (`String? @unique`, added by MIG-1a in P1) — one input, moved out of P4.
- `deliveries/[id]` and `deliveries/batch` resolve the store from `Delivery.storeId` when set,
  else from `storeIdForInvoice(invoiceNo)`, else the primary store.

**Data step after P1b:** on `/stores`, set `invoicePrefix` to `BCH/` and `BCC/`. Until it is set,
every sale deducts from the primary store — the same behaviour as option C, but it is one field
away instead of a phase away.

**P4 shrinks:** it no longer creates `zoho-invoice.ts` or the prefix input; it imports the helper
and adds only `deliveryFieldsFromInvoiceDetail` and the store chip on `/deliveries`.
