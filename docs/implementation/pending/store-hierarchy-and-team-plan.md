# Store Hierarchy & Team Management Plan

Status: in-progress — building on branch `feat/store-hierarchy`. Revised 30 Aug 2026 on two owner decisions: RBAC is a `Store Management` parent module with `stores` and `warehouses` as its two children (§4 Phase 6), and the database reset is **skipped** (§2.4) — five of the six migrated columns hold no rows and the sixth holds one.
Rewritten 29 Aug 2026: the three open re-validation questions are now answered, the
hierarchy shape is settled, and `hasEntrance` is dropped.

Scope: replace the hardcoded `StockLocation` enum with a real `Store → Warehouse`
hierarchy, and rebuild `/team` as a paginated table with row actions.

**Runs after the database reset** — now a five-step manual runbook, not a plan. See §2.4.

---

## 1. The problem

Stores and locations are **not data**. They are a Prisma enum:

```prisma
// prisma/schema.prisma:234
enum StockLocation { STORE WAREHOUSE BCH_WAREHOUSE BCH_STORE BCC_WAREHOUSE BCC_STORE }
```

…mirrored by a hardcoded array in `src/lib/inventory-config.ts:17`, and consumed by
**6 columns** across 6 models and **20 files** under `src/`. Adding a store today means a
schema edit, a `db push` and a redeploy.

This is the same failure mode the RBAC rewrite already fixed for permissions. `CLAUDE.md`
states the principle — *access control is DATA, not code* — and store structure belongs in
the same category: it is operational configuration an admin changes, not a fact about the
program.

Second problem: `/team` renders users as role-grouped cards with no pagination, no row
actions, and no way to see or set which store a person belongs to.

### Where the enum is used today

| Model | Column | Line | Becomes |
|---|---|---|---|
| `StockLevel` | `location` (in `@@unique([productId, location])`) | 451 | → **Warehouse** |
| `TransferOrderItem` | `fromLocation`, `toLocation` | 1297–1298 | → **Warehouse** |
| `CountEvent` | `storeId` | 2216 | → **Store** |
| `AgentHeartbeat` | `storeId` | 2254 | → **Store** |
| `AnalyticsDevice` | `storeId` (in `@@unique([storeId, agentId])`) | 2279 | → **Store** |
| `FootfallDaily` | `storeId` | 2304 | **model dropped** — see §2.3 |

`grep -n StockLocation prisma/schema.prisma` returns seven hits: the enum declaration plus
these six columns. `TransferOrder` itself carries no location — only `TransferOrderItem` does.

---

## 2. Decisions taken

Settled before planning, plus the four confirmed with the owner on 29 Aug 2026 (marked ★).
Recorded here so the reasoning is not lost.

| Question | Decision | Why |
|---|---|---|
| Depth of change | Full migration to tables | A half-fix leaves two sources of truth |
| Child model name | **`Warehouse`**, not `Location` | Matches how the business already speaks |
| Store ↔ Warehouse | One store, many warehouses; a warehouse has exactly one store | The FK enforces it — no application code |
| ★ Store codes | **`BCH_STORE`, `BCC_STORE`** | The store *is* the shop — the name the business uses |
| ★ Seeded warehouses | **One per store**: `BCH_WAREHOUSE`, `BCC_WAREHOUSE` | The godown behind each shop |
| Second warehouse under one store | Allowed | No constraint prevents it; add a row, no schema change |
| Store with zero warehouses | Allowed | Created first, warehouses added after, shown with a warning badge |
| `kind` enum on the child | **Dropped** | The name carries the meaning; a second thing to sync |
| `hasEntrance` flag | **Dropped** — never built | Made redundant by the shape above; see §2.2 |
| Legacy `STORE` / `WAREHOUSE` enum values | Deleted with the enum | Nothing references them |
| ★ `FootfallDaily` | **Model deleted**, not migrated | Dead since the cron removal; see §2.3 |
| ★ Existing data | None — the database reset runs first | See §2.4 |
| User delete | Hard delete when clean, deactivate when linked | Preserves stock audit trails |
| `/team` on mobile | Table ≥ `sm`, cards below | 7 columns cannot fit a phone; PWA + Capacitor |
| Build order | Team table before the stock migration | Ships something visible before the risky work |
| Plan file | Stays one document | Phases 2–3 and 1/4/5/6 do not overlap, but share the schema |

### 2.1 ★ The shape, spelled out

Four rows are seeded — two stores, one warehouse each:

```
Store  BCH_STORE  "BCH Store"                    ← the shop; footfall camera lives here
  └ Warehouse  BCH_WAREHOUSE  "BCH Warehouse"    ← the godown; stock lives here

Store  BCC_STORE  "BCC Store"
  └ Warehouse  BCC_WAREHOUSE  "BCC Warehouse"
```

The split between the two models is not cosmetic — it decides which table each FK points at:

| Concern | Points at | Reason |
|---|---|---|
| Stock quantity, transfers | **Warehouse** | Stock is held in a physical space |
| Footfall counting, devices, heartbeats | **Store** | A camera counts people through the shop door |

Three of the four analytics columns are **already named `storeId`**. They change type
(`StockLocation` → `String` FK) and keep their name. That is a smaller Phase 4 than the
previous draft, which renamed all of them to `warehouseId`.

> **Consequence, stated deliberately.** Today stock splits four ways
> (`BCH_WAREHOUSE` / `BCH_STORE` / `BCC_WAREHOUSE` / `BCC_STORE`). After this change it
> splits two ways — one warehouse per site. The question *"3 on display, 5 in the godown"*
> stops being answerable; *"8 at BCH"* is what remains.
>
> **This is reversible without a migration.** Warehouses are rows. Adding a second warehouse
> under `BCH_STORE` through `/stores` restores the split with a single insert and no
> redeploy — which is the entire point of the change. The seed picks the starting shape, not
> the permanent one.

### 2.2 Why `hasEntrance` is gone

`src/lib/validations.ts:509` restricts camera devices to `z.enum(["BCH_STORE", "BCC_STORE"])`,
with the comment *"narrowed to the two values that have a doorway to count."* The previous
draft replaced that with a `Warehouse.hasEntrance` boolean.

It is no longer needed. `AnalyticsDevice.storeId` now points at **`Store`**, and every store
is a shop with a doorway. The rule *"only a place with a door can host a camera"* is
expressed by the foreign key itself. The zod check becomes *"must be an active store id"* —
no flag, no column, nothing to keep in sync.

### 2.3 Why `FootfallDaily` is deleted rather than migrated

`grep -rn "FootfallDaily\|footfallDaily" src/` returns **zero hits** — the only reference
anywhere is the model declaration at `schema.prisma:2302`. CLAUDE.md records
`cron/footfall-rollup` as *"removed, not replaced — `count_events` is no longer pruned and
`FootfallDaily` is never written."*

Migrating a column on a table nothing reads or writes buys nothing, and leaving the model in
place tells the next reader that footfall rollups exist. Phase 4 deletes the model. If
rollups are rebuilt later they will want a schema designed for whatever that feature actually
needs, not this one.

### 2.4 Sequencing — the reset is SKIPPED, decided 30 Aug 2026

> **Reversal, recorded because this section previously said the opposite.** Earlier drafts
> opened *"Reset the database, then start Phase 1"*. That is no longer the instruction, and
> running `--force-reset` now would destroy live data for no technical gain.

Phase 4 converts six enum columns into foreign keys. Postgres cannot change an enum column
into a text FK in place while rows exist, which is why an empty database made Phase 4 a
single `db push`. The plan therefore demanded a reset.

**Counted on 30 Aug 2026, five of the six columns have nothing in them:**

```
TransferOrderItem    0        CountEvent         0
AgentHeartbeat       0        AnalyticsDevice    0
FootfallDaily        0        StockLevel         1   <- the only row in scope
```

So the migration is not a data problem, it is a **one-row** problem:

```
location=BCH_STORE   qty=2   SKU 9733   BSA REVX 14T GRY/ORG/WHT
```

That single row is exactly the case this section used to call *"no correct backfill"* — after
§2.1, `BCH_STORE` is a shop with a door and stock lives in a Warehouse, so a row claiming
stock at a Store has nowhere valid to land. At one row that is a decision, not a migration.

**Decision: move it to `BCH_WAREHOUSE`, then migrate normally.** Stock cannot live in a Store
under the new model, `BCH_WAREHOUSE` is the godown for that same site, and 2 units are
trivially correctable from `/stock` afterwards if they really are on the shop floor.

```sql
-- run BEFORE Phase 4, and confirm it reports 1 row
UPDATE "StockLevel" SET location = 'BCH_WAREHOUSE' WHERE location = 'BCH_STORE';
UPDATE "StockLevel" SET location = 'BCC_WAREHOUSE' WHERE location = 'BCC_STORE';
SELECT location, count(*) FROM "StockLevel" GROUP BY location;   -- no *_STORE rows may remain
```

The second statement is a safety net, not an expectation — there are no `BCC_STORE` rows
today, but Phase 4 must not run while any `*_STORE` row exists and the check above is what
proves it.

**What skipping the reset preserves:** 21 products, 17 brands, 9 categories, 1 vendor, and
**3 users** including the two non-admin accounts. It also preserves the only cash-discount
data in the database — four `Brand` rows (BSA 1.5%/10d, Firefox 3%/20d, Hero 2%/15d,
Trek 2.5%/30d) which no `Vendor` row duplicates.

**A reset is still available if wanted**, and the runbook lives in
`completed/database-reset-preserving-integrations-plan.md` §0. It is a preference about data
tidiness — the existing rows carry real defects (a product branded with its *vendor's* name,
a bicycle typed `SPARE_PART`, and 383 of 385 units with no `StockLevel` location at all) —
**not a prerequisite of this plan.** Do not conflate the two. If it is ever run, note that
every non-admin user is destroyed and the `ZOHO_BOOKS` integration row must be pasted back
from the commented block at the end of `.env`.

---

## 3. Schema

```prisma
model Store {
  id        String   @id @default(cuid())
  code      String   @unique          // "BCH_STORE", "BCC_STORE"
  name      String                    // "BCH Store"
  address   String?
  phone     String?
  isActive  Boolean  @default(true)
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  warehouses Warehouse[]
  users      User[]

  // Footfall is counted at the shop door, so these hang off the store, not a warehouse.
  countEvents      CountEvent[]
  agentHeartbeats  AgentHeartbeat[]
  analyticsDevices AnalyticsDevice[]
}

model Warehouse {
  id        String   @id @default(cuid())
  storeId   String
  store     Store    @relation(fields: [storeId], references: [id])
  code      String   @unique          // "BCH_WAREHOUSE", "BCC_WAREHOUSE"
  name      String                    // "BCH Warehouse"
  isActive  Boolean  @default(true)
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  stockLevels   StockLevel[]
  users         User[]
  transfersFrom TransferOrderItem[] @relation("TransferFromWarehouse")
  transfersTo   TransferOrderItem[] @relation("TransferToWarehouse")

  @@unique([storeId, code])
  @@index([storeId])
}
```

`code` on both models reuses the **old enum strings**. That is what keeps
`/stock/by-location/BCH_WAREHOUSE` resolvable through the transition and makes the seed a
plain lookup rather than a mapping table.

`User` gains two nullable columns, `storeId` and `warehouseId`. Both optional — a user may be
assigned to a store, a warehouse, both, or neither.

**Restrict, not cascade.** Neither FK cascades on delete. Deleting a store that still has
warehouses, or a warehouse that still holds stock, must fail at the database and be caught by
the API's delete rule (Phase 6) — never silently orphan a `StockLevel` row.

---

## 4. Phases

Ordered so the visible work lands before the destructive work.

> ### ⚠️ Phase 6 runs BEFORE Phase 5 — added 29 Aug 2026
>
> The numbering is kept so cross-references in this document stay valid, but **the execution
> order is 1 → 2 → 3 → 4 → 6 → 5.**
>
> Three reasons, in order of severity:
>
> 1. **A guard on a module that does not exist denies everyone.** `userCan` resolves
>    `access.permissions["stores"]?.[action] === true` (`src/lib/rbac.ts:193`), and the same
>    for `"warehouses"`. For a module
>    with no row, that is `undefined === true` — **false, including for ADMIN**, which holds
>    every permission only because those permissions exist. Phase 5 rewrites `transfers`,
>    `stock-audit` and `inbound` to read warehouses through the API. If any of that is guarded
>    on `stores` before Phase 6 seeds the module, every location dropdown in the application
>    is empty and those screens are unusable.
> 2. **The nav link would dangle.** Seeding the module makes `Stores & Warehouses` appear
>    under Settings in the sidebar. Building the module before the screen means one phase
>    where clicking it 404s.
> 3. **You need somewhere to create a second warehouse.** Phase 5 rewrites
>    `/stock/by-location/[code]` to resolve a store to the sum across its warehouses — and its
>    verification (§6.2b) requires adding a second warehouse to prove the resolution works at
>    all. With one warehouse per store the store view and the warehouse view are identical
>    numbers, so without `/stores` that check cannot be performed.
>
> Phase 5 remains the last code written either way. Nothing else in the plan depends on the
> swap.

### Phase 1 — Tables

- Add `Store` and `Warehouse` to `prisma/schema.prisma`.
- Add nullable `User.storeId` / `User.warehouseId` plus their relations.
- `npm run db:push`.
- New `prisma/seed-stores.ts` — creates the four rows of §2.1, idempotent on `code`.
- **Amend the header of `prisma/seed.ts`** to record the exception in the same breath as the
  rule. The current text reads *"There is deliberately NO sample data."* It gains: stores and
  warehouses are **infrastructure, not sample data** — the stock system cannot function with
  zero warehouses any more than it can with zero roles, and a stock row has nowhere to point
  until they exist. Unwritten, this looks like the policy quietly eroding.
- Wire it into the seed entry point so `npm run db:seed` produces a working database in one
  command, and expose `npm run db:seed:stores` for the narrow case.

Nothing else is touched. The enum still runs the stock system at the end of this phase.

### Phase 2 — `/team` as a table

New components (neither exists in `src/components/ui/` today, which holds only
`action-confirmation`, `badge`, `button`, `card`, `error-banner`, `input`, `skeleton`):

- `table.tsx`
- `pagination.tsx`

`src/app/(dashboard)/team/page.tsx` — **the role-grouped card block at lines 80–137 is
deleted outright.** No toggle, no fallback, no dead code.

| Name / email | Role | Store · Warehouse | Status | Txns | Created | Actions |
|---|---|---|---|---|---|---|

Actions column uses `lucide-react` (already a dependency):

| Icon | Action |
|---|---|
| `Pencil` | → `/team/[id]` |
| `UserCheck` / `UserX` | toggle `isActive` via `PUT /api/users/[id]` |
| `Trash2` | `DELETE /api/users/[id]`, behind `action-confirmation` |

The delete handler **surfaces the message the API returns** rather than assuming success.
`DELETE /api/users/[id]` already returns `{ deleted, deactivated, name, message }` and falls
back to deactivation twice — once when `transactions` or `stockCounts` are non-zero, and
again in a `catch` when any other FK constraint fires. Today the UI reads none of that and
would report both outcomes as "deleted", which is a lie. Render `message` verbatim.

Pagination moves **server-side**. `GET /api/users` already returns `paginatedResponse`; the
page requests `limit: "50"` (`page.tsx:34`) and discards the `pagination` block entirely.
20 rows per page, prev/next plus page numbers.

Below the `sm` breakpoint the table is replaced by a compact card list carrying the same
three action icons.

Two `CLAUDE.md` violations in this file are fixed as part of the rewrite:

- `page.tsx:36` uses `fetch().then(r => r.json())`, which is **banned** — a 307 to `/login`
  returns HTML with status 200 and `res.ok` does not catch it. Replaced with `apiFetch` from
  `src/lib/api-client.ts`. Note `page.tsx:39` also has a bare `.catch(() => {})`, which
  swallows the failure and leaves the user staring at an empty list.
- The file has no logging. Adds `createLogger("team:list")`.

Serving the **Store · Warehouse** column needs `GET /api/users` to select the two new
relations — a `select` addition, no query shape change.

### Phase 3 — Roles search & store assignment

- `/team/permissions`: a search input above the role pill row, filtering on name and key.
  Client-side — every role already arrives in one request, so a round-trip per keystroke
  would be slower, not faster.
- A role filter on the team table as well. *"Search in the roles listing"* could reasonably
  mean either; both are cheap.
- `/team/[id]` and `/team/new`: a **Store** select and a **Warehouse** select, the latter
  filtered to the chosen store's warehouses.

> **Deviation, 30 Aug 2026 — `GET /api/stores` and `GET /api/warehouses` are built HERE, not
> in Phase 5.** The plan assigned them to Phase 5, but the execution order is 1 → 2 → 3 → 4 →
> 6 → 5, so Phase 3 would have had no way to populate its two selects. They are built exactly
> as Phase 5 specifies — `requireAuth()` only, never `requireFeature` — and Phase 5 now
> consumes them instead of creating them. The ⚠️ comment Phase 5 requires is already in both
> files.
>
> Both screens share one `SiteSelect` component (`src/components/site-select.tsx`) so they
> cannot drift, and validation is shared by `POST` and `PUT` through
> `src/lib/site-assignment.ts`. The client-side filter is cosmetic; that module is the gate.
- `POST /api/users` and `PUT /api/users/[id]` accept `storeId` / `warehouseId` and **reject a
  warehouse that does not belong to the chosen store**. The client-side filter is cosmetic;
  the API is the gate.
- `userSchema` in `src/lib/validations.ts` updated.

**Not in scope:** the assignment is stored and displayed only. It does **not** filter what a
user sees — a BCH-assigned user still sees BCC stock. Enforcing visibility means touching
every stock query and the RBAC resolver, and belongs in its own phase with its own plan.

### Phase 4 — Schema migration

⚠️ **Confirm the tables are empty before starting.** See §2.4.

| Model | Before | After |
|---|---|---|
| `StockLevel` | `location: StockLocation` | `warehouseId` FK, `@@unique([productId, warehouseId])` |
| `TransferOrderItem` | `fromLocation` / `toLocation` | `fromWarehouseId` / `toWarehouseId` FK |
| `CountEvent` | `storeId: StockLocation` | `storeId: String` FK → `Store` (**name unchanged**) |
| `AgentHeartbeat` | `storeId: StockLocation` | `storeId: String` FK → `Store` (**name unchanged**) |
| `AnalyticsDevice` | `storeId: StockLocation` | `storeId: String` FK → `Store`, `@@unique([storeId, agentId])` kept |
| `FootfallDaily` | — | **model deleted** |
| `enum StockLocation` | — | **deleted** |

Single `db push --accept-data-loss`, then `npm run db:seed` (RBAC + stores).

> This project has **no `prisma/migrations/` directory** — it uses `prisma db push`. With real
> data present this migration would need a three-step add-nullable → backfill → drop sequence.
> It does not, which is the only reason a single push is safe here.

### Phase 5 — Delete the hardcoded location code

Removed from `src/lib/inventory-config.ts` (`BIN_TRACKING_ENABLED` stays — the file keeps its
bin-dormancy comment and nothing else):

`STOCK_LOCATIONS` · `type StockLocation` · `isStockLocation` · `stockLocationLabel` ·
`DEFAULT_STOCK_LOCATION`

#### `DEFAULT_STOCK_LOCATION` has no replacement — the fallback becomes a 400

Decided 29 Aug 2026. Two routes silently fall back to `BCH_WAREHOUSE` today:

```ts
// api/inbound/[id]/route.ts:84  and  api/inbound/[id]/status/route.ts:25
const location = isStockLocation(body.location) ? body.location : DEFAULT_STOCK_LOCATION;
```

Both become an explicit rejection:

```ts
// A warehouse must be named. There is no default: warehouses are rows now, and guessing
// one puts stock in the wrong building with nothing to report it.
if (!warehouseId) return errorResponse("A warehouse is required to receive this shipment", 400);
// ...then verify the id names an active warehouse, or 400 again.
```

*Why not a default.* The fallback was safe only because the enum guaranteed a valid value
existed at compile time. Once locations are data there is no such guarantee, and the failure
it hides is expensive: stock recorded in BCH that physically arrived at BCC produces a count
discrepancy at both sites and no error anywhere. A 400 is strictly better than a confident
wrong answer.

*Why this costs nothing in practice.* `inbound/[id]/page.tsx:115` initialises the location
picker on mount, so a normal request always carries one. The fallback fires only on a
malformed request — exactly the case that should fail loudly.

Rejected: a `Warehouse.isDefault` flag (a "exactly one row is true" rule the database cannot
enforce), and falling back to the lowest `sortOrder` (the destination would change silently
whenever someone reorders the list).

**Not to be confused with `resolveDefaultStore()`** at `src/lib/analytics/store.ts:233`. That
one returns a store only when exactly one exists and `null` otherwise, and it feeds an
analytics dashboard where "no store selected" is a legitimate state. It needs no change
beyond its type, and its shape is **not** the model for the inbound routes — a dashboard may
decline to pick; a stock write may not.

New `src/lib/warehouses.ts` reads the set from the database with a request-scoped cache, so a
dropdown does not issue four queries.

#### The two read endpoints, and why they are NOT behind `stores` or `warehouses`

`GET /api/warehouses` and `GET /api/stores` — list endpoints for client components filling a
location dropdown.

**These are guarded by `requireAuth()` only, never by `requireFeature("stores"/"warehouses", …)`.** The
distinction is the point:

| Endpoint | Guard | Who needs it |
|---|---|---|
| `GET /api/warehouses`, `GET /api/stores` | `requireAuth()` | **everyone** — anyone creating a transfer, running a stock count or receiving an inbound needs to name a location |
| everything else on those resources (Phase 6) | `requireFeature("stores"/"warehouses", …)` | admins configuring the hierarchy |

Gating the list on `stores.view` would mean every user who creates a transfer must also hold
the stores-admin grant. That is backwards: the dropdown is infrastructure, the CRUD is
administration. This mirrors `/api/my-permissions`, which is authentication-only for the same
reason — gating the bootstrap read deadlocks the thing it bootstraps.

Return **active rows only**, and only `id`, `code`, `name`, `storeId`, `sortOrder`. No
address, no phone. A dropdown needs a label and a value; nothing else should leave the server
on an auth-only route.

Files to rewrite — 20 under `src/`, confirmed by
`grep -rln "StockLocation\|STOCK_LOCATIONS" src/`:

| Layer | Files |
|---|---|
| lib | `inventory-config.ts`, `stock-location.ts`, `validations.ts`, `analytics/store.ts`, `analytics/device-auth.ts` |
| API | `stock/by-location/[location]`, `stock/by-bin`, `inbound/[id]`, `inbound/[id]/status`, `transfer-orders`, `transfer-orders/[id]/approve`, `stock-counts`, `stock-counts/[id]`, `analytics/dashboard` |
| Pages | `transfers`, `transfers/new`, `stock-audit/new`, `stock-audit/brand-count`, `stock/by-location/[location]`, `stock/by-brand`, `inbound/[id]`, `analytics`, `analytics/devices` |

`src/app/api/cron/` **no longer exists** — every cron route was deleted (see
`completed/cron-removal-plan.md`), so the counter watchdog is not on this list.

#### `/stock/by-location/[location]` — resolve both levels, decided 29 Aug 2026

The segment is currently an enum value. It becomes a **code that may name either a store or a
warehouse**, resolved against the database on each request:

| URL | Resolves to | Shows |
|---|---|---|
| `/stock/by-location/BCH_WAREHOUSE` | one `Warehouse` | that warehouse's `StockLevel` rows |
| `/stock/by-location/BCH_STORE` | one `Store` | the **sum across all its warehouses** |
| anything else | nothing | 404 |

Rejected: 404-ing the store codes, and redirecting them to the site's warehouse. Both bake in
today's one-warehouse-per-store shape. **Owner's steer:** the whole reason for this migration
is that stores and warehouses are becoming data — more than one store, and more than one
warehouse per store. A route that only understands warehouses would need rewriting again the
first time a second warehouse is added; one that understands both is correct at every shape,
including the current one.

Rename the segment to `[code]` and the route to reflect that it takes a code, not a location.
The page heading comes from the resolved row's `name`, so `BCH_STORE` renders "BCH Store" and
`BCH_WAREHOUSE` renders "BCH Warehouse" with no lookup table in the component.

Applies to **both** the page (`(dashboard)/stock/by-location/[location]`) and the API
(`api/stock/by-location/[location]`) — the API does the resolution, the page renders what it
returns.

Three further behaviours to preserve deliberately:

- `src/app/api/transfer-orders/route.ts:17–18` hardcodes the four values in a zod enum →
  becomes *"must be an active warehouse id"*.
- `src/lib/validations.ts:509` restricts camera devices to `BCH_STORE` / `BCC_STORE` → becomes
  *"must be an active store id"*. No flag needed — see §2.2.
- `src/lib/stock-location.ts` takes `location: StockLocation` on its exported helpers
  (`adjustLocationQty`, `setLocationQty`, `getLocationQtyMap`, …) → `warehouseId: string`.
  These are the functions that keep `Product.currentStock` correct; every caller changes with
  them.

**The counting agents' ingest contract is unaffected — this is verified, not assumed.**
`src/lib/analytics/device-auth.ts:13–15` records finding DAT-002: the store is derived from
the device key, never from the request body, and callers must ignore any `store_id` in the
payload. Agents send a key and events; they never send a store. Only the internal type of the
value handed back changes.

One externally visible change to decide: `analytics/store.ts` emits `store_id` in its
dashboard payload (lines 245, 371). Its value would go from `"BCH_STORE"` to a cuid. **Emit
`store.code` instead of `store.id`** so the payload keeps its readable value and nothing
downstream that reads that JSON breaks.

### Phase 6 — `/stores`

#### The catalog entries, written out

> **Revised 30 Aug 2026 — owner's decision. THREE modules under a `Store Management` parent.**
>
> An earlier draft made `stores` a child of `settings` at `/settings/stores` and argued
> against a second module: *"warehouses are administered on the same screen and have no
> separate route, so a `warehouses` module would be a second toggle for one screen."*
>
> That reasoning was about **screens**. The owner's is about **authority**, and it is the
> better argument: *"add a warehouse to an existing site"* and *"open a new store"* are
> different decisions. A warehouse supervisor can reasonably do the first and not the second.
> Expressing that as two permissions is exactly what permissions-as-data is for — the same
> reasoning `cost_price` already exists under.
>
> **This forced the hierarchy out of `settings`.** The owner asked for a `Store Management`
> module with Store and Warehouse beneath it. Nesting that under `settings` would put the
> children three levels deep, which `seed-rbac.ts:48` rejects outright. So `store_management`
> is a **root** module in the Admin group — a dedicated sidebar section beside Team, Roles and
> Settings rather than something buried inside Settings — with `stores` and `warehouses` as
> its two children.

Add all three to `MODULE_CATALOG`:

```ts
{
  key: "store_management",
  label: "Store Management",
  description: "Sites and the warehouses inside them",
  icon: "Building2",
  route: null,                    // a pure container — no page of its own
  group: "Admin",
  sortOrder: 540,                 // Admin band: team 500, roles 510, settings 520-522,
                                  // whatsapp_templates 530 -> store management 540
  actions: ["view"],
},
{
  key: "stores",
  label: "Stores",
  description: "Store sites — the shops, their codes and contact details",
  icon: "Building2",
  route: "/stores",
  parentKey: "store_management",
  group: "Admin",                 // MUST equal the parent's group
  sortOrder: 541,
  actions: CRUD,                  // view, create, edit, delete
},
{
  key: "warehouses",
  label: "Warehouses",
  description: "Warehouses under each store — where stock physically lives",
  icon: "Warehouse",
  route: "/stores/warehouses",
  parentKey: "store_management",
  group: "Admin",
  sortOrder: 542,
  actions: CRUD,
},
```

Five things this pins down:

- **`store_management` is a grouping construct, and its own `view` grant does almost nothing.**
  `app-sidebar.tsx:104` builds a placeholder parent from the child's carried parent data, so
  the section heading renders whenever **any child** is granted, with or without the parent's
  own row. It is declared `route: null` — `ModuleSeed.route` is `string | null`, documented as
  *"null = no direct page (permission-only module)"* — with a single `view` action.
  **The real gates are `stores.*` and `warehouses.*`.** Do not give the parent CRUD expecting
  it to gate anything; it would be four permission rows that grant nothing observable.
- **Depth is exactly two.** `stores` and `warehouses` are **siblings** under
  `store_management`, not a chain. `store_management -> stores -> warehouses` would be three
  levels and `seed-rbac.ts:48` throws: *"parent is itself a child. The sidebar renders exactly
  two levels, so a grandchild would exist in the DB and appear nowhere."*
- **All three `group`s are `"Admin"`.** A child declaring a different group from its parent is
  rejected by `seed-rbac.ts:57` — two competing grouping mechanisms render the section twice.
- **`sortOrder` 540 / 541 / 542** continues the Admin band after `whatsapp_templates` (530).
  Do **not** use `550` — that was `problems`, deleted by
  `completed/app-logic-and-problems-removal-plan.md`; taking a slot as it is freed couples two
  unrelated changes for no gain.
- **`icon: "Warehouse"` must be added to `src/lib/module-icons.ts`.** Verified 30 Aug 2026:
  `Building2` is exported, `Warehouse` is **not**. Icons resolve client-side from that map and
  an unmapped name renders nothing rather than erroring — a silent blank in the sidebar.

#### What each permission actually gates

| Permission | Gates |
|---|---|
| `stores.view` | seeing the store list at all |
| `stores.create` | **opening a new site** — the decision the owner wanted separated |
| `stores.edit` | renaming a store, changing its address or phone, deactivating it |
| `stores.delete` | removing a store that has no warehouses |
| `warehouses.view` | seeing the warehouses under a store |
| `warehouses.create` | **adding a warehouse to an existing site** |
| `warehouses.edit` | renaming, reordering, deactivating a warehouse |
| `warehouses.delete` | removing a warehouse that holds no stock |

A warehouse supervisor gets `stores.view` + all four `warehouses.*` and cannot open a new
site. That combination is the point of the split, and it is the case to test in §6.

Then `npm run db:seed:rbac`, which creates **two modules and eight permissions**. **Only
ADMIN holds them** until an admin grants them on `/team/permissions` — no seeded role asks
for either, and ADMIN passes because it holds every permission by construction, never because
of its name.

#### Routes

| Route | Guard |
|---|---|
| `POST /api/stores`, `PUT/DELETE /api/stores/[id]` | `requireFeature("stores", …)` |
| `POST /api/warehouses`, `PUT/DELETE /api/warehouses/[id]` | `requireFeature("warehouses", …)` |
| `GET /api/warehouses`, `GET /api/stores` — the **list** endpoints | `requireAuth()` — built in Phase 5, see above |

The list endpoints are deliberately not repeated here. They are built once, in Phase 5, on
`requireAuth()`; Phase 6 adds the mutations beside them and must not re-guard the reads.

- Screen: `/stores` — store list, expand a store to see its warehouses, create / edit /
  delete at both levels. One screen, two permission sets: the warehouse controls read
  `warehouses.*` and the store controls read `stores.*`, so a warehouse supervisor sees the
  list and the warehouse buttons but not "New store".

**Delete rule**, matching `/team`: hard-delete when nothing references the row; when a
warehouse holds stock or transfer history, refuse with a precise message — *"BCH Warehouse
holds 412 stock rows across 87 products"* — and offer deactivate. A store with warehouses
refuses the same way. Stock is never silently orphaned; the FK is `Restrict` (§3) so the
database is the backstop if the check is ever missed.

This is also where the shop-floor split of §2.1 comes back if it is wanted: create a second
warehouse under `BCH_STORE`. No schema change, no deploy.

---

## 5. Blast radius

- **Phases 4–5 rewrite every stock read in the application.** `StockLevel` is the source of
  the cached `Product.currentStock`. A missed file reads as **zero stock, not as an error** —
  the most dangerous failure here is a silent one.
- **Stock collapses from four locations to two.** Deliberate (§2.1), reversible via Phase 6.
  Anyone who expects a shop-floor number will not find one.
- **`/stock/by-location/[code]` is rebuilt to resolve either level** — see §4 Phase 5. It is
  the one route where the old enum leaked into a URL, and it is fixed by making it read the
  database rather than by picking a redirect target.
- **Transfers are inter-site only *until a second warehouse exists*** — `BCH_WAREHOUSE` ↔
  `BCC_WAREHOUSE` on day one. Adding a warehouse under a store restores intra-site moves with
  no code change, which is the point of the migration.
- **Analytics moves three models at once**, and `FootfallDaily` disappears.
- **Existing role grants** — the new `stores` and `warehouses` modules mean every non-system
  role starts with no access to either until granted on `/team/permissions`. ADMIN is
  unaffected: it holds every permission by construction, not by name. **But "by construction"
  means the permission rows must exist first** — before `db:seed:rbac` runs,
  `requireFeature("stores", …)` denies even ADMIN. That is why Phase 6 precedes Phase 5; see
  the note at the top of §4.
- **`stores` is a root module, so it appears as its own sidebar section entry** under Admin,
  beside Team / Roles / Settings rather than inside Settings, with Warehouses nested beneath
  it. Anyone expecting it under Settings will not find it there.
- **The two list endpoints are authentication-only, by design.** `GET /api/warehouses` and
  `GET /api/stores` are not behind `stores` or `warehouses`. If a reviewer "tightens" them to
  `requireFeature("warehouses", "view")`, every location dropdown breaks for every user who is
  not a warehouse admin — and it will look like a permission that was never granted rather
  than a regression. The comment in those two files must say so.
- **Phases 2–3 ship against an enum-based stock layer.** That is the price of doing the visible
  work first. The two areas do not overlap.

## 6. Verification

`npm run build` at the end of Phase 3, Phase 4, Phase 6 and Phase 5 — in execution order
(1 → 2 → 3 → 4 → 6 → 5), and it must pass before the next phase starts. Note that the build itself no longer needs a reachable database — the three `/staff-lms/*`
pages became client components in `completed/ci-build-database-dependency-plan.md`. Postgres
is still required for the `db push` and seed steps in Phases 1, 4 and 6.

Pages to open and check by hand:

`/team` · `/team/[id]` · `/team/new` · `/team/permissions` · `/stores` ·
`/stock/by-location/BCH_WAREHOUSE` · `/stock/by-location/BCH_STORE` · `/stock/by-brand` ·
`/transfers` · `/transfers/new` ·
`/stock-audit/brand-count` · `/stock-audit/new` · `/analytics` · `/analytics/devices` ·
`/inbound/[id]`

Specific things to confirm, not just "the page loads":

1. A stock count at `BCH_WAREHOUSE` updates `Product.currentStock` to the same number the page
   shows. This is the cache that goes silently wrong.
2. A transfer `BCH_WAREHOUSE → BCC_WAREHOUSE` decrements one and increments the other.
2b. `/stock/by-location/BCH_STORE` shows the **sum** of its warehouses, and
   `/stock/by-location/BCH_WAREHOUSE` shows just that one. With one warehouse per store the
   two numbers are equal — so to prove the resolution actually works, add a second warehouse
   under `BCH_STORE` via `/stores`, put stock in it, and confirm the store view
   grows while the warehouse view does not. An unknown code must 404, not render empty.
3. `/team` delete on a user *with* transactions shows the API's "deactivated instead" message,
   not "deleted".
4. `/team` pagination actually pages — 21+ users, page 2 shows different rows.
5. A counting agent POST still authenticates and writes a `CountEvent` against the right store,
   with no change on the agent side.
6. **A non-admin can still use a location dropdown.** Create a role holding `transfers` but
   **not** `stores` or `warehouses`, assign it to a test user, and open `/transfers/new`. The
   warehouse selector must be populated. If it is empty, a read endpoint was guarded — the
   failure this plan's §5 warns about, and the one that looks like a missing grant rather
   than a bug.
7. **`/team/permissions` shows Stores & Warehouses nested under Settings**, indented beside
   Storage and Integrations, with four toggles (view/create/edit/delete). If it renders as a
   top-level row, `parentKey` was omitted; if the seed refused to run, `group` does not match
   the parent's.
8. **Receiving an inbound with no warehouse returns 400, not a guess.** `POST` to
   `/api/inbound/[id]/status` with the `location`/`warehouseId` field omitted and confirm the
   response is a 400 naming the missing warehouse — and that **no `StockLevel` row moved**.
   The old code would have silently credited `BCH_WAREHOUSE`. Check the stock total before
   and after; equal is the pass condition.

Per `AGENTS.md`, every `git`, `npm` and `prisma` command is proposed for approval rather than
run on initiative.

## 7. Board of Agents

Per `CLAUDE.md`, read before the phase and check the implementation against it:

| Phase | Consult |
|---|---|
| 1, 4 | `docs/agents/database-architect.md` — schema, FKs, unique constraints, the single push |
| 2, 3 | `docs/agents/frontend-engineer.md` — table/pagination components, mobile breakpoint |
| 3, 5, 6 | `docs/agents/backend-engineer.md` — zod schemas, guards, delete rules |
| 4, 5 | `docs/agents/inventory-consultant.md` — losing the shop-floor split, `currentStock` |
| 5, 6 | `docs/agents/warehouse-consultant.md` — transfers, inbound receiving, bin dormancy |
