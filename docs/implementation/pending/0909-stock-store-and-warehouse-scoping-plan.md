# Stock is held at two scopes — the shop floor becomes a location, the store becomes a total — and the two screens that show scope learn to say which

Status: pending — every question in §1 is answered or delegated; no code written
Branch: **`feat/stock-store-and-warehouse-scoping`** — create it with exactly this name. **The base branch is NOT decided in this file. Owner, 9 Sep 2026: *"i will let u know when i am creating it"* — so at implementation time, before any `git checkout -b`, Claude ASKS the owner which branch to base on and waits.** Do not default to `main` (it is behind), and do not assume `feat/taxonomy-inactive-and-audit-approval` either: on 9 Sep its tip and `docs/plan-requirements-rule`'s tip carried the same commit message with different hashes, so the two lines have diverged and only the owner knows which one this work continues.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (9 Sep 2026, across one conversation)

> i need u to updat this uapplicaton create a plan to do thei the requirement is tell the scope
> of stock holding as of now the stocks are holded at the warehouse level not the store level if u
> need it in both the level then tell me this how does the stock and from where do u want to
> reduce -> inbound - outbound -> stock transfer

> Aanswer -> in this we need the stock count for both the warehouse and shope level where at the
> time of the inbound it must effect respect to the selected warehouse

> i need to see the stocks where i have the by location button in the tocks where i need same as
> by store which must take me to the screen which list the card of store where it must show the
> number of products and on clickin that store it must show the stocks per store where u can add
> the filter of it in the /stocks filter too and remove the size filer form the /stocks filter
> screen

> [on the store filter] when the stocks are filtered by the store it must list the stocks that
> are present in the store only not the whare house

> [on the store filter control] searchable selecttion

> o k this is ok i just need to store the stock in two scopes that is store level and warehosue
> level do what ever u want to to implment the requiremnt in the related implemnation plan file

The same conversation also asked for four things that are **not** in this plan — the store step on
`/stock-audit/brand-count`, the time on inbound timestamps, the Warehouses entry leaving the
sidebar, and `size` becoming a searchable category. Those, and the removal of the Size filter from
`/stock`, are the sibling plan
**`0909-stock-screens-size-category-and-sidebar-plan.md`**. Their verbatim lines live there.

### 0.2 Restated as requirements

| # | Requirement | The owner's words that produced it |
|---|---|---|
| **R1** | Stock is held and visible at **two scopes: warehouse level and store level.** | *"i just need to store the stock in two scopes that is store level and warehosue level"*; *"we need the stock count for both the warehouse and shope level"* |
| **R2** | An **inbound** receipt affects the **warehouse the user selected**. | *"at the time of the inbound it must effect respect to the selected warehouse"* |
| **R3** | Where **outbound** and **stock transfer** reduce from is decided in this plan (delegated). | *"how does the stock and from where do u want to reduce -> inbound - outbound -> stock transfer"* → *"do what ever u want to to implment the requiremnt"* |
| **R4** | `/stock` gets a **By Store** button beside By Location → a screen of **store cards showing the number of products**; tapping a store shows **that store's stock**. | *"i have the by location button in the tocks where i need same as by store which must take me to the screen which list the card of store where it must show the number of products and on clickin that store it must show the stocks per store"* |
| **R5** | `/stock`'s filter panel gains a **Store filter**, as a **searchable selection**. When it is set, the list shows **only what is present in that store**, with that store's quantities. | *"u can add the filter of it in the /stocks filter too"*; *"when the stocks are filtered by the store it must list the stocks that are present in the store only not the whare house"*; *"searchable selecttion"* |

**Renumbering note.** These were R1, R2, R3, R8 and R9 in the source plan
`0909-stock-store-level-and-stock-screens-plan.md`, which this plan and its sibling replace. Its
R4–R7 and R10 are the sibling's. Its R11 (*"should i merge the plan into one"*) is answered in §6.

---

## 1. Questions and clarifications

Every question below was put to the owner on 9 Sep 2026. The ones the owner answered are in
§1.1; the ones the owner delegated with *"do whatever you want"* are in §1.2 as **assumptions
that a one-line reply can overturn**. Nothing in §3 rests on an unrecorded choice.

| # | Question | Why it changes the build | Options | Recommended | Answer |
|---|---|---|---|---|---|
| Q1 | When "BCH Store" is tapped on By Store, is the number the **shop floor only** (3) or **floor + godown** (8)? | Decides whether `/api/stock/by-location/[STORE]` (which sums warehouses today) is right or must change, and whether By Store can ship before a floor exists | (A) floor only · (B) store total | **(B)** — the existing drill-in stays correct, nothing reads 0 while opening balances are still being split, and the 3/5 split is one tap away on By Location | **(B)** — "ok this is ok … store level and warehouse level" |
| Q2 | When `/stock` is filtered by store, what does the Stock column show? | `Product.currentStock` is a global cache; showing it under a store filter lies | (a) scoped qty · (b) rows only, global number | **(a)** | **(a)** — "the stocks that are present in the store only" |
| Q3 | "Number of products" on a store card — non-zero only? | Distinct-count vs sum; zero rows | non-zero ACTIVE, `COUNT(DISTINCT productId)` | as stated | **as recommended** |
| Q4 | What else goes on the store card? | Reuse vs new card | same card as By Location | as stated | **as recommended** |
| Q5 | Where does a store card link? | New screen vs existing | `/stock/by-location/<STORE_CODE>` — already works | as stated | **as recommended** |
| Q7 (part) | Store filter control — plain or searchable? | Component choice | `<select>` · `SearchableSelect` | plain (two stores) | **searchable** |

The other half of Q7 — *should the Category and Brand filters become searchable too* — and Q6
(*how much of `size` comes out*) and Q8 (*merge the plans*) are recorded in the sibling plan and
in §6 respectively.

### 1.1 Decisions on record — owner, 9 Sep 2026

- **Both scopes are real.** Store level = the sum of that store's locations (Q1 = B).
- **Store filter shows scoped quantities** (Q2 = a) and is a **searchable selection** (Q7).
- Q3, Q4, Q5 on the recommendations.
- Everything else: *"do whatever you want"* → §1.2.

### 1.2 Delegated decisions — recorded as assumptions, each overturnable by one reply

The identifiers **D1–D5, D7, D8 are kept exactly as they were numbered in the source plan**, so a
comment or a migration that cites "D2" still resolves. D6 (two plans, this one first) is §6 here;
D9–D14 belong to the sibling plan.

| # | Decision | Why this and not the alternative |
|---|---|---|
| **D1** | **The shop floor is a second `Warehouse` row under each store.** Seeded as `BCH_FLOOR` "BCH Floor" and `BCC_FLOOR` "BCC Floor". `StockLevel` is untouched. | `StockLevel` is keyed `(productId, warehouseId)` (`prisma/schema.prisma:576`) and the model's own comment says a second warehouse *"is an INSERT rather than a migration"* (`:283-284`). A `storeId` on `StockLevel` would hold the same units in two places, and two places drift — the codebase already carries three cache-only writes of exactly that shape (§2.10). |
| **D2** | **`Warehouse.kind { FLOOR, GODOWN }`**, one additive column, default `GODOWN`. No "one floor per store" constraint. | Three call sites need *"the shop of this store"* — outbound ordering, the inbound default, and the transfer plan's left panel — and a naming convention cannot be enforced by anything. The 0409 plan chose *"no kind, a floor is a warehouse named that way"* (`stock-audit/new/page.tsx:233-234`); that held while nothing needed to resolve a floor. Now three things do. A store with two floors is plausible (two display areas), so uniqueness is not enforced; *"the floor"* means the first by `sortOrder`. |
| **D3** | **The floor starts at 0.** Every unit is in the godown today. The split is done by **two warehouse-scoped stock audits** — count the floor, count the godown — each of which sets absolute quantities via `setWarehouseQty` (`api/stock-counts/[id]/route.ts:421`). | Nothing can guess how many of the 5 units are on display. A transfer godown → floor would also work, but dispatch needs a document attached and storage is not configured yet (transfer plan Q8), so the audit is the path that works today. A floor reading 0 until it is counted is **correct, not broken** — §4 says so where the person will see it. |
| **D4** | **Outbound drains floors first, then godowns**, and **logs a `warn`** whenever it reaches a godown. It still refuses only when the **store** total is short, as today. | This is today's behaviour with the order made explicit (`lib/stock-location.ts:96-100` orders by `sortOrder`). Refusing when the floor is short would block a sale at the counter until someone raises a transfer; asking for a warehouse at dispatch adds a field to three routes that have none. The warning is what turns a silent reach-through into a visible one. |
| **D5** | **Inbound pre-selects the first `GODOWN`** instead of `warehouses[0]`. The user can still change it (R2 stays true). | Goods arrive at the back. Also keeps today's behaviour unchanged, since the godown is the only warehouse that exists now. |
| **D7** | **By Store is its own page, `/stock/by-store`, fed by a new `GET /api/stock/by-store`.** The location card is extracted into a shared component and both listing pages use it. Each store card also prints its per-warehouse split. | A second header button is what the owner asked for. Extracting the card rather than copying it keeps one dialect. Printing *"Floor 3 · Godown 5"* on the store card is R1 on one screen for the cost of one extra query. |
| **D8** | **`GET /api/products?storeId=` restricts to products with quantity > 0 in that store and replaces `currentStock` with the store's quantity.** When the store filter is set, stock-range and stock-sort are applied in memory after the query. | The route sorts and paginates in the database on `currentStock` (`api/products/route.ts:113-115`); Prisma cannot order by a relation aggregate, so the scoped path fetches the matched set (bounded by "products the store holds") and pages it in code. Same response shape, so the page needs no new client logic. |

---

## 2. How it works today — verified against the code, 9 Sep 2026

Everything below was read from the code on disk on **9 Sep 2026** — three read-only sweeps (stock
movement, audit/sidebar/inbound, product edit) plus direct reads of every file cited. No claim is
carried over from an earlier session. Nothing has been changed yet.

### 2.1 Stock lives in one table, keyed by warehouse; the store is derived

| Fact | Where |
|---|---|
| `StockLevel { productId, warehouseId, quantity }`, unique on the pair | `prisma/schema.prisma:563-578` |
| `Warehouse.storeId → Store`, `onDelete: Restrict`; `@@unique([storeId, code])` | `:285-317` |
| **No `storeId` on any stock-holding row.** Store is reachable only via `StockLevel → Warehouse.storeId` | — |
| `Product.currentStock` = cached `SUM(StockLevel.quantity)` across every warehouse | `:512`, comment `:560-562`; recomputed by `recomputeCurrentStock` `src/lib/stock-location.ts:20-28` |
| The only `stockLevel.upsert` calls in the codebase | `stock-location.ts:38-42` (`adjustWarehouseQty`), `:255-259` (`setWarehouseQty`) |
| Two stores, **one warehouse each**, seeded by code | `prisma/seed-stores.ts:28-41` — `BCH_STORE/BCH_WAREHOUSE`, `BCC_STORE/BCC_WAREHOUSE` |
| **No floor / godown notion anywhere.** `by-bin` hard-codes `kind: "Warehouse"` *"because … the screen's Store branch is for a store-floor location that does not exist yet"* | `src/app/api/stock/by-bin/route.ts:46-50` |

### 2.2 The write side is already two-scoped

| Movement | Call | Scope | How the place is chosen |
|---|---|---|---|
| **Inbound** | `adjustWarehouseQty(tx, productId, warehouse.id, qty)` — `src/app/api/inbound/[id]/route.ts:253` | **warehouse** | `warehouseId` **required** (`src/lib/validations.ts:608-612`), resolved with no default (`src/lib/warehouses.ts:92-105`); the page pre-selects `warehouses[0]` and lets the user change it (`inbound/[id]/page.tsx:149-155`, `:740`) |
| **Outbound** — delivery, walk-out, batch, manual outward | `deductFromStore(tx, productId, storeId, qty)` — `api/deliveries/[id]/route.ts:250`, `deliveries/batch/route.ts:115`, `api/inventory/outwards/route.ts:98` | **store** | `Delivery.storeId`, else invoice prefix, else the primary store (`deliveries/[id]/route.ts:207-217`). Inside the store: active warehouses ordered `sortOrder, name` (`stock-location.ts:96-100`), summed first and refused before any write if short (`:221-227`), then drained in that order (`:230-237`) |
| **Transfer** | `moveOutOfWarehouse` / `moveIntoWarehouse` — `transfer-orders/[id]/dispatch/route.ts:147`, `receive/route.ts:155` | **warehouse → warehouse** | `TransferOrder.fromWarehouseId / toWarehouseId` (`dispatch:81`, `receive:88`) |
| **Audit** | `setWarehouseQty` (warehouse-scoped) / `adjustWarehouseQty` + `deductFromStore` (whole-store) — `api/stock-counts/[id]/route.ts:421-430` | either | `StockCount.warehouseId` or the approver's `correctionWarehouseId` |

**So R2 is already true** — an inbound lands in the warehouse the user picked. Part A keeps it that
way and only changes the *default*.

Verified **not** to move stock: POS (`api/pos/**`, zero stock references), service jobs
(`api/services/**`, zero), transfer approve (`approve/route.ts:27`), Zoho pull-review approve
(creates products at `currentStock: 0`, `pull-review/approve/route.ts:414`).

### 2.3 The read side has no scope at all

| Screen / API | Reads | Scoped? |
|---|---|---|
| `/stock` list — `GET /api/products` | `currentStock` from the `Product` row (`api/products/route.ts:102`); sorted and paginated in the database on it (`:113-115`) | **no** |
| `/stock/[id]` — `GET /api/products/[id]` | does **not** select `stockLevels` at all | **no** |
| `/api/stock/summary`, reports, reorder | `Product.currentStock` | **no** |
| **`/stock/by-bin`** ("Stock by Location") — `GET /api/stock/by-bin` | raw SQL `SUM(quantity)` … `GROUP BY warehouseId` (`by-bin/route.ts:15-25`), then mapped over `listWarehouses()` so a zero-stock warehouse still appears (`:29-31`) | **by warehouse** |
| **`/stock/by-location/[code]`** — `GET /api/stock/by-location/[code]` | resolves a **warehouse code first, then a store code** (`by-location/[location]/route.ts:36-37`); a store aggregates its warehouses — `where: { warehouse: { storeId } }` (`:45-47`); sums per product in code (`:67-89`); returns `level: "warehouse" \| "store"`, per-warehouse `warehouses[]` totals at store level (`:94-110`) | **either — the one route that already does store level** |
| stock audit `systemQty` | `getStoreQtyMap` when whole-store (`api/stock-counts/route.ts:184-186`, helper `stock-location.ts:285-303`) | by store |

### 2.4 The By Location screen already has a Store branch that never renders

- `/stock` header: one purple link, **By Location** → `/stock/by-bin` (`src/app/(dashboard)/stock/page.tsx:411-417`). There is no By Store.
- `by-bin/page.tsx` draws one card per warehouse, grouped by `site` — the store code's prefix (`by-bin/route.ts:45`, `SITE_NAMES` at `page.tsx:21-24`) — each linking to `/stock/by-location/${loc.key}` (`:86`).
- The card has a `kind === "Warehouse" ? amber Warehouse icon : blue Store icon` branch (`:91-93`) that is **dead**: `kind` is always `"Warehouse"` (`route.ts:50`).
- The detail page has the matching store branch, alive and correct: `kind = data?.level` (`by-location/[location]/page.tsx:46-48`), blue Store icon at `:88-90`, label from the API.
- `/stores/page.tsx:237` already tells the admin *"`/stock/by-location/{code}`"* is what a store code resolves.
- Both listing pages call `fetch().then(r => r.json())` directly (`by-bin/page.tsx:35-39`, `by-location/[location]/page.tsx:51-55`) — the pattern CLAUDE.md bans.

**Consequence:** `/stock/by-location/BCH_STORE` renders a store-level view today. R4's drill-in
exists; only the store *listing* and the button are missing.

### 2.5 The `/stock` filter panel and the searchable picker — only the parts this plan touches

| Piece | Where |
|---|---|
| Category and Brand: plain `<select>`s | `stock/page.tsx:509-534` |
| Filter state / active count / query params / deps / clear-all | `:148`, `:269`, `:284`, `:287`, `:355-359`, `:391` |
| The quick-filter chips (In Stock / No Stock) | `stock/page.tsx:75-85`, filtering `currentStock` server-side at `api/products/route.ts:91-95` |
| The one searchable picker in the app: **`src/components/ui/searchable-select.tsx`** | props `{ options, value, onChange(id\|null), placeholder, emptyText, disabled, className, id, name }` (`:15-26`), option `{ id, label, hint? }` (`:8-13`); dropdown is **unportalled**, so the container must not clip (`:218-220`) |
| It is already used as a picker on a form | `inbound/[id]/page.tsx:691-698` (category, tree flattened parent-as-hint at `:189-197`) |
| `Card` sets no `overflow` | `components/ui/card.tsx` — so a filter panel inside a card does not clip the dropdown |
| `useStores()` → `GET /api/stores` nests active warehouses `{ id, code, name, sortOrder }` | `api/stores/route.ts:50-54`; `StoreOption` at `src/hooks/use-sites.ts:27-32` |

The **Size** filter block (`:553-567`, `showSizeFilter` at `:397`), the row's size badge
(`:690-692`) and everything else about `Product.size` are the sibling plan's — see
`0909-stock-screens-size-category-and-sidebar-plan.md` §2. This plan does not read, write or
remove `size`.

### 2.10 Live defects found on the way — not this requirement, listed so nobody trips on them

*(Kept at 2.10, the number the source plan gave it, so existing pointers still resolve. The
sibling plan points here rather than repeating the list.)*

1. **Deleting a completed stock count reverses the cache only.** `api/stock-counts/[id]/route.ts:563-570` writes `product.currentStock = txn.previousStock` and never touches `StockLevel`; the next recompute undoes the reversal.
2. **The bin-mode inbound branch does the same** — `api/inbound/[id]/route.ts:235`. Unreachable while `BIN_TRACKING_ENABLED` is off, but live code.
3. **`StockLevel.reservedQuantity` is never written or read** (`schema.prisma:572`). Reservations live on `Product.reservedStock`, a global number with no scope.
4. `src/lib/warehouses.ts:44` caches the warehouse set at module scope for the life of the process; multi-instance deployments serve a stale set (documented at `:25-42`). **Part A adds a column to that cached shape, so it is the first thing to break if the cache is ever wrong.**

---

## 3. Implementation plan

Three parts. **A is the architectural change and the only one with a migration; B and C depend on
it only for the floor's *visibility*, not for their code.** One commit per part, in the order
given, on the one branch.

### Part A — the shop floor is a location; a store is the sum of its locations

**A1. Schema** — `prisma/schema.prisma`, beside `model Warehouse` (`:285`):

```prisma
/// What kind of place a warehouse is. FLOOR is the shop — where a customer sees the bike;
/// GODOWN is storage. Decided 9 Sep 2026 (plan 0909-stock-store-and-warehouse-scoping, D2):
/// three call sites need "the shop of this store" — outbound ordering, the inbound default and
/// the transfer form's store panel — and a naming convention cannot be enforced by anything.
/// Not unique per store on purpose: a shop may have two display areas. "The floor" is the first
/// by sortOrder.
enum WarehouseKind {
  FLOOR
  GODOWN
}
```

and on the model, after `name`:

```prisma
kind      WarehouseKind @default(GODOWN)
```

No index — every reader already filters by `storeId` (indexed) and sorts a handful of rows in
code. `npx prisma migrate dev --name warehouse_kind` on **localhost only** (CLAUDE.md rule 2).
The SQL is a `CREATE TYPE` and an `ALTER TABLE … ADD COLUMN … NOT NULL DEFAULT 'GODOWN'`:
additive, old code ignores it (rule 7). Read it before committing (rule 3). `npm run db:snapshot`
before the PR merges (rule 9).

**A2. Seed** — `prisma/seed-stores.ts:28-41`: each store gains a second warehouse,
`{ code: "BCH_FLOOR", name: "BCH Floor", kind: "FLOOR", sortOrder: 5 }` (and `BCC_`). `sortOrder`
5 puts the floor **before** the godown in every picker, matching the drain order. `kind` goes in
the `create` clause **only** — not `update` — for the same reason `isActive` is excluded (`:48-50`):
a kind an admin changed on `/stores` must survive a re-seed. The existing godown rows need no
edit; the column default makes them `GODOWN`. Applied with `npm run db:seed:stores`
(`package.json:14`), which is idempotent on `code`.

**A3. The warehouse shape everywhere it is typed** — `kind` is added to:

| File | Line | Change |
|---|---|---|
| `src/lib/validations.ts` | `:1057-1066` | `warehouseSchema` gains `kind: z.enum(["FLOOR", "GODOWN"]).optional()`; `warehouseUpdateSchema` inherits it |
| `src/app/api/warehouses/route.ts` | `:81-92` | `create` writes `kind: data.kind ?? "GODOWN"`; select returns it |
| `src/app/api/warehouses/[id]/route.ts` | `:46-50` | `update` spreads `kind` when present |
| `src/app/api/warehouses/route.ts` | `:33-41` | `GET` select includes `kind` |
| `src/app/api/stores/route.ts` | `:50-54` | nested `warehouses` select includes `kind` |
| `src/lib/warehouses.ts` | `:52-62` | `listWarehouses` select includes `kind`; `WarehouseRef` type follows |
| `src/hooks/use-sites.ts` | `:9-24`, `:27-32` | `WarehouseOption.kind`, `StoreOption.warehouses[].kind` |
| `src/app/(dashboard)/stores/page.tsx` | `:49`, `:174-193`, `:353-365` | the warehouse draft carries `kind`; a two-button **Floor / Godown** toggle beside Code and Name in the draft card; each warehouse row prints a small `Floor` / `Godown` label after its name |

**A4. Outbound order and the warning** — `src/lib/stock-location.ts`:

- Add `const log = createLogger("stock:location")` — the file has none (`:12-13`).
- `deductFromStore` (`:85-116`): select `{ id, kind, name }`, then order in code — every `FLOOR`
  first, then every `GODOWN`, each group by `sortOrder, name`. Ordering in code rather than
  `orderBy: { kind }` because Postgres orders an enum by declaration order, which is a fact a
  reader should not have to know to trust this function.
- `deductAcrossWarehouses` (`:206-249`) returns `{ total, taken: Array<{ warehouseId, qty }> }`
  instead of a bare number. Its two callers — `deductFromStore` and `deductAnywhere` (`:134-156`) —
  adapt; every external caller of those two sees no change.
- After the drain, `deductFromStore` calls
  `log.warn("outbound reached the godown", { productId, storeId, fromFloor, fromGodown })` when
  any `taken` row is a `GODOWN`. Identifiers only, never the product body.

**A5. Inbound default** — `src/app/(dashboard)/inbound/[id]/page.tsx:152-155`: pre-select the
first `GODOWN` (`warehouses.find(w => w.kind === "GODOWN") ?? warehouses[0]`), still only when
nothing is selected. The comment at `:145-148` is updated to say why. The server side
(`api/inbound/[id]/route.ts:177-179`) is untouched — the warehouse is still required and still
the user's.

**A6. By Location learns the difference** — `src/app/api/stock/by-bin/route.ts:50`:
`kind: w.kind === "FLOOR" ? "Store" : "Warehouse"`. The dead branch on the card (`by-bin/page.tsx:91-93`)
comes alive: a floor draws the blue Store icon, a godown the amber Warehouse icon. The comment
at `:40-48` is rewritten — it currently explains that the floor does not exist.

### Part B — By Store

**B1. `GET /api/stock/by-store`** — new `src/app/api/stock/by-store/route.ts`, `requireFeature("stock", "view")`
like `by-bin`. One raw query, then mapped over `listStores()` so a store with no stock still
appears at zero:

```sql
SELECT w."storeId"                                                 AS store_id,
       COALESCE(SUM(sl.quantity), 0)::int                          AS total_stock,
       COALESCE(SUM(sl.quantity * p."sellingPrice"), 0)::float     AS total_value,
       COUNT(DISTINCT sl."productId") FILTER (WHERE sl.quantity > 0)::int AS product_count
FROM "StockLevel" sl
JOIN "Warehouse" w ON w.id = sl."warehouseId" AND w."isActive"
JOIN "Product"   p ON p.id = sl."productId"
WHERE p.status = 'ACTIVE'
GROUP BY w."storeId"
```

`COUNT(DISTINCT …)` is the point — a product held on the floor **and** in the godown is one
product (Q3). A second query is the `by-bin` per-warehouse SQL (`by-bin/route.ts:15-25`) grouped
under each store, so every store row also carries
`warehouses: [{ code, name, kind, units }]`. Response shape mirrors `by-bin`'s `locations[]` —
`{ key: store.code, id, label: store.name, kind: "Store", totalStock, totalValue, productCount,
lowStockCount: 0, outOfStockCount: 0, warehouses }` — so the shared card renders both without a
branch. `lowStockCount`/`outOfStockCount` are 0 for the same reason they are 0 on `by-bin`
(`:51-52`); §5 records that.

**B2. The shared card** — new `src/app/(dashboard)/stock/_components/location-card.tsx`, lifted
verbatim from `by-bin/page.tsx:86-124`, plus an optional line under the units that prints the
per-warehouse split when `warehouses` is present: *"Floor 3 · Warehouse 5"*. `by-bin/page.tsx`
uses it in place of its inline markup, and its `fetch().then(r => r.json())` at `:35-39` becomes
`apiTry` while the file is open (CLAUDE.md non-negotiable; the change is in the same file).

**B3. `/stock/by-store`** — new `src/app/(dashboard)/stock/by-store/page.tsx`, the `by-bin`
page's shape with the site grouping removed (stores *are* the top level): header *"Stock by
Store"* with total units and value, loading and empty states as `by-bin` has them (`:64-75`), a
`sm:grid-cols-2` grid of `LocationCard`s each linking to `/stock/by-location/${store.code}`.
`createLogger("stock:by-store")`; `apiTry` for the load; `log.error` on failure.

**B4. The button** — `stock/page.tsx:411-417`: a second link beside By Location, same classes,
`Store` icon, label **By Store**, `href="/stock/by-store"`, hidden in select mode like its
neighbour.

**B5. The drill-in** — `/stock/by-location/[code]` is **unchanged**. It already resolves a store
and sums its warehouses. Its `goBack` fallback (`by-location/[location]/page.tsx:60`) pushes
`/stock/by-bin`; it becomes *"`/stock/by-store` when `level === "store"`, else `/stock/by-bin`"*
so the back arrow returns to the list the person came from. Its raw `fetch` at `:51-55` becomes
`apiTry` in the same edit.

### Part C — the `/stock` store filter

**C1. `GET /api/products?storeId=`** — `src/app/api/products/route.ts`:

- Parse `storeId` beside the others (`:26-33`); resolve with `storeById` (`src/lib/stores.ts:47`),
  400 *"Unknown store"* if it does not resolve.
- When set:
  1. `prisma.stockLevel.groupBy({ by: ["productId"], where: { warehouse: { storeId, isActive: true } }, _sum: { quantity: true } })`,
     keep rows with `_sum.quantity > 0` → `qtyOf: Map<productId, number>`. *"Present in the
     store"* is quantity above zero; `adjustWarehouseQty` clamps at zero (`stock-location.ts:37`),
     so `> 0` and `≠ 0` are the same set today and `> 0` says what it means.
  2. `where.id = { in: [...qtyOf.keys()] }`. `minStock`/`maxStock` are **removed from `where`** —
     they describe the scoped number now — and applied in step 4.
  3. `findMany` with the same `select` and **no `skip`/`take`**; `orderBy` as today unless
     `sortBy === "currentStock"`.
  4. Replace each row's `currentStock` with `qtyOf.get(id)`, apply the stock range, sort by the
     scoped number when asked, then slice `skip, skip + limit`. `paginatedResponse(rows, total,
     page, limit)` with `total = rows.length` — the response shape the page already reads.
  5. `log.debug("scoped product list", { storeId, held: qtyOf.size, returned })`.
- The set is bounded by *"products the store holds with quantity above zero"*, which is small
  today and stays proportional to stock rather than to the catalog.
- **The In Stock / No Stock quick chips filter `currentStock` in the `where` clause**
  (`api/products/route.ts:91-95`), i.e. the **global** number. Under a store filter that
  contradicts the Stock column the person is looking at. The scoped path must apply the chip to
  the scoped quantity in step 4 alongside the stock range, or the two disagree; §4 checks it.
- **Not touched:** the unscoped path is byte-for-byte what it is now.

**C2. The Store control on the filter panel** — `stock/page.tsx:503-570`:

- New `selectedStore` state, in `activeFilterCount` (`:269`), `buildParams` (`:284-287`) as
  `storeId`, and `clearFilters` (`:355-359`).
- A **Store** `SearchableSelect` (Q7) fed by `useStores()`; option `{ id, label: name, hint:
  "<n> locations" }`. The `grid grid-cols-2` container has no clipping class and `Card` sets no
  overflow, so the unportalled dropdown is fine; confirmed in §4 on a phone.
- One caption under the Store control when it is set: *"Showing what BCH Store holds. Quantities
  are that store's."* — so the number the person sees is explained where it changes.
- With a store filter set, **No Stock** returns nothing by construction (the list is "what the
  store holds"); the ordinary empty state shows. §5 records it.

**Not in this plan:** removing the Size filter, and making the Category and Brand filters
searchable. Both are in the same file and the same panel, so read
`0909-stock-screens-size-category-and-sidebar-plan.md` before editing `stock/page.tsx` — the two
plans touch neighbouring lines and whichever lands second rebases onto the first.

### Phases and dependencies

```
A  schema + seed + kind everywhere + outbound order + inbound default + by-bin kind
│   (the only migration in this plan)
├─ B  by-store API + shared card + page + button          ← reads kind for the card split
└─ C  ?storeId= + searchable Store filter                  (no dependency on A's code)
```

B and C **compile and run without A** — a store with one warehouse simply shows the same number
at both scopes. A goes first so the walk in §4 sees both scopes from the start.

**Relation to the sibling plan.** `0909-stock-screens-size-category-and-sidebar-plan.md` is
**independent: it needs no migration and no seed**, and the two can ship in **either order**. The
only overlap is the file `src/app/(dashboard)/stock/page.tsx` (this plan adds a Store control to
the filter panel; that one removes the Size block and changes two `<select>`s) and the file
`stock-audit`/`inbound` pages, which this plan does not touch.

### Migration

One folder, additive: `prisma/migrations/<ts>_warehouse_kind/`. Applied by hand —
`npx prisma migrate status` then `npx prisma migrate deploy` against the target **before** the
code goes live (CLAUDE.md rule 4; nothing applies migrations automatically since 7 Sep).
`DIRECT_URL` on 5432 (rule 8). This is the **only** migration across both halves of the split —
the sibling plan has none.

### RBAC

No new module, no new action. `/stock/by-store` and `GET /api/stock/by-store` sit behind
`stock.view` like `by-bin` and `by-location`. No role name appears anywhere in this plan.
(The `warehouses` module's sidebar entry is the sibling plan's Part G and needs `db:seed:rbac`;
nothing here does.)

### Logging

| Where | Logger | Lines |
|---|---|---|
| `src/lib/stock-location.ts` | `stock:location` (new) | `warn` on a godown reach-through with `{ productId, storeId, fromFloor, fromGodown }` |
| `api/stock/by-store/route.ts` | `stock:by-store` | `debug` on load `{ stores, withStock }`; `error` on the query failing |
| `api/products/route.ts` | `products:list` (**new** — verified 9 Sep: the file has no `createLogger`, and its catch at `:121-129` logs nothing) | `debug` on the scoped path `{ storeId, held, returned }`; `warn` on an unknown store |
| `stock/by-store/page.tsx` | `stock:by-store` | `error` on load failure |

Never full row bodies; identifiers only. No `console.log`.

### Board of agents — checked

| Agent | Principle | Finding |
|---|---|---|
| Inventory consultant | *"Negative stock is a data quality failure"*; *"check transfers — was a transfer completed but not received?"* | Unchanged: `adjustWarehouseQty` still clamps at zero; the store-level refusal in `deductAcrossWarehouses` still runs before any write. The floor-first drain makes the *"outward deducted from where?"* question answerable per warehouse for the first time. |
| Warehouse consultant | *"Every item has a home"* | A floor and a godown are both homes. The floor starting at 0 (D3) is flagged in §4 so it reads as "not yet counted", not "missing". |
| Database architect | additive first; no speculative indexes | One enum + one defaulted column; no index (every reader filters on the indexed `storeId` first). |
| Backend engineer | zod for every input; validate FKs | `kind` enters through `warehouseSchema`; `storeId` resolves through `storeById` and 400s when unknown. |
| Frontend engineer | loading, error and empty states; mobile; cosmetic-only client checks | `/stock/by-store` copies `by-bin`'s three states; the unportalled dropdown is checked in a narrow viewport in §4; nothing new is gated client-side only. |
| Integration architect | — | No external call is touched. |

---

## 4. Verification

The owner runs the build (21–45 min): `npm run build` — must pass. Before the browser:

1. `npx prisma migrate status` → `npx prisma migrate deploy` on the target (localhost first).
2. `npm run db:seed:stores` → prints `warehouses : 4 synced (2 new)`.

Browser walk, in this order:

| # | Where | See |
|---|---|---|
| 1 | `/stores` | each store lists **Floor** and **Warehouse** with their kind tags; **Add warehouse** offers the Floor / Godown toggle. |
| 2 | `/stock` header | **By Location** and **By Store** side by side; both hidden in select mode. |
| 3 | `/stock/by-location` (`by-bin`) | four cards — floors with the blue Store icon at **0 units**, godowns amber with today's numbers. A floor at 0 is **correct** until it is counted (D3), not a bug. |
| 4 | `/stock/by-store` | two store cards; product count, units, value, and *"Floor 0 · Warehouse N"*. Tap BCH Store → `/stock/by-location/BCH_STORE`, blue Store header, store total, per-warehouse totals. Back arrow returns to By Store. |
| 5 | `/stock` filter panel | the **Store** control is a searchable selection; type to filter; pick BCC Store → only products BCC holds, quantities are BCC's, the caption says so; low-stock colours follow the scoped number; clear all resets it. On a narrow (phone) viewport the dropdown is not clipped by the panel. |
| 6 | **Move units godown → floor** — a warehouse-scoped audit on the floor that sets N, and one on the godown that removes the same N | the **store TOTAL on `/stock/by-store` and on `/stock/by-location/<STORE>` does not change.** If it moves, `recomputeCurrentStock` (`src/lib/stock-location.ts:20-28`) is double-counting the two warehouses — stop and fix that before anything else, because every scoped number in this plan is built on it. |
| 7 | `/stock` with a store selected, then tap **In Stock**, then **No Stock** | the chips **agree with the Stock column**. They filter `currentStock` in the `where` clause today (`api/products/route.ts:91-95`) — the global cache — so unless C1 moved them onto the scoped quantity they will contradict the scoped column: a product with 0 in this store and 5 elsewhere shows under "In Stock" reading 0. Either outcome is a result; a contradiction is a bug in C1. |
| 8 | `/inbound/[id]` → receive a line | the warehouse pre-selects the **godown**; change it to the floor; receive → By Location shows the unit on the floor. |
| 9 | Deliver a walk-out sale for a product with floor 0, godown N | sale succeeds; server log carries `outbound reached the godown` with the ids; godown falls by the quantity. |
| 10 | The opening-balance split (D3) | raise a warehouse-scoped audit on **BCH Floor**, count, approve with *set system stock* → By Location shows the floor number; repeat on the godown. By Store's total is unchanged only if the two counts sum to what the godown held. |

---

## 5. Out of scope, deliberately

- **A "one floor per store" constraint** (D2). Add a partial unique index if the business rule
  ever hardens; `Brand_name_ci_key` in `20260908151058` is the precedent for a hand-written index.
- **`lowStockCount` / `outOfStockCount` on the location and store cards** stay 0, as `by-bin`
  already returns them (`by-bin/route.ts:51-52`). A per-location low-stock rule is its own
  question.
- **The No Stock chip under a store filter** returns nothing by construction (C2). If *"products
  this store does not hold"* is wanted, it is a different query, not a bug in this one.
- **Scoping the inbound default to the shipment's store.** `InboundShipment` has no `storeId`;
  the default is the first godown in picker order (D5).
- **The site grouping on `by-bin`** by store-code prefix (`route.ts:45`, `page.tsx:21-24`) keeps
  working for `BCH_`/`BCC_` and is left alone.
- **The four defects in §2.10.** Real, verified, not this requirement. Say the word and they get
  their own plan; #1 (`stock-counts/[id]/route.ts:563-570`) is the one worth doing first.
- **`Product.reservedStock` / `StockLevel.reservedQuantity`.** Reservations remain global.
- **Scoping `/stock/[id]`, `/api/stock/summary`, the reports and the reorder screen.** They still
  read the global `Product.currentStock` (§2.3). Only the `/stock` list learns a scope in this
  plan.
- **Everything in the sibling plan** — the Size filter, `Product.size`, the category picker on the
  product edit form, the store step on `/stock-audit/brand-count`, inbound timestamps and the
  Warehouses sidebar entry. See `0909-stock-screens-size-category-and-sidebar-plan.md`.

---

## 6. Relation to the transfer-mode plan, and why this is two plans

`docs/implementation/pending/0909-transfer-mode-and-document-attachment-plan.md` §2 **Q1** asked
*which warehouse stock leaves from when a store is picked*, and offered (a) a floor row by naming,
(b) the primary warehouse, (c) a `kind` column. **This plan's D1 + D2 is (c):** a store on the
transfer form's left panel resolves to its first `FLOOR` warehouse (`sortOrder`, then name);
*Store → Warehouse*'s right panel lists every active warehouse of any kind except the resolved
source (that plan's Q7). Its `resolveStoreWarehouse(storeId)` (§4.2 there) is a one-line lookup on
`kind` once Part A lands. That plan's Q1 carries a dated pointer here; nothing else in it changes.

**Why the transfer plan was not merged into this one** (the owner's *"should i merge the plan into
one which is best recomen me things"*): the transfer plan is already written and its other ten
questions are answered. Merging would make it wait on six unrelated items. Two plans, this one
first, with a pointer between them.

**Why this plan was itself split in two.** The original
`0909-stock-store-level-and-stock-screens-plan.md` carried seven parts. Three of them (A, B, C's
scoping half) share one migration, one seed and one architectural idea — the shop floor as a
location — and are this file. The other four (`size` → category, brand-count's store step, inbound
timestamps, the sidebar entry) share nothing with them: **no migration, no seed, no schema**, and
they are `0909-stock-screens-size-category-and-sidebar-plan.md`. Neither blocks the other and they
can ship in **either order**; the only file both touch is `src/app/(dashboard)/stock/page.tsx`.

---

## Clarifications — 9 Sep 2026 (clarify-plan run against the code on disk)

### Verified against code

Two read-only sweeps plus direct reads. **Nothing from Parts A, B or C exists yet**: zero matches for
`WarehouseKind` / `FLOOR` / `GODOWN` / `BCH_FLOOR` in `src/` and `prisma/`; `api/stock/by-store/`,
`stock/by-store/page.tsx` and `stock/_components/` are absent; `stock/page.tsx` has no `storeId`,
`selectedStore`, `useStores` or `SearchableSelect` import; `api/products/route.ts` parses no `storeId`.
Last migration on disk: `20260908161249_brand_category_is_active`. `.env:13-14` points at localhost.

- `StockLevel` keyed `(productId, warehouseId)`, no `storeId` on any stock row — CONFIRMED, `schema.prisma:563-578`
- `Warehouse` has no `kind`; "second warehouse is an INSERT" comment — CONFIRMED, `schema.prisma:283-310`
- Seed: two stores, one warehouse each — CONFIRMED, `prisma/seed-stores.ts:28-41`
- Inbound `warehouseId` required, resolver has no default — CONFIRMED, `validations.ts:611`, `warehouses.ts:92-105`
- Inbound page pre-selects `warehouses[0]` — CONFIRMED, `inbound/[id]/page.tsx:153-155`
- **Inbound warehouse picker is a `<select>` — DRIFTED: it is a button grid at `inbound/[id]/page.tsx:734-748`.** A5 changes which button is pre-selected; nothing else changes.
- `deductFromStore` orders `sortOrder, name`, sums and refuses before writing — CONFIRMED, `stock-location.ts:96-100`, `:221-227`
- `deductAcrossWarehouses` is private (not exported) — CONFIRMED, `:206`; its only callers are `deductFromStore` (`:108`) and `deductAnywhere` (`:148`). External callers of `deductAnywhere`: `api/inventory/cleanup/route.ts:37`, `api/inbound/[id]/route.ts:413` — both keep the bare-number return, so A4's shape change stays inside the file.
- The only two `stockLevel.upsert` calls — CONFIRMED, `stock-location.ts:38`, `:255`
- `stock-location.ts` has no logger — CONFIRMED, `:12-13`
- `warehouseSchema` / `warehouseUpdateSchema` have no `kind` — CONFIRMED, `validations.ts:1057-1066`; update route spreads fields at `warehouses/[id]/route.ts:48-54` (plan said `:46-50`)
- `WarehouseRef` type is at `warehouses.ts:6-16`, select at `:53-62` (plan said `:52-62` for both)
- `useStores()` exists, returns `{ stores, loading, error }` via `apiTry` — CONFIRMED, `use-sites.ts:70-92`
- **`stores/page.tsx:49` already uses `kind` as the draft union tag (`"store" | "warehouse"`) — DRIFTED (name clash).** A3 carries the new column as `warehouseKind` in that page's client state; the API field stays `kind`.
- `by-bin` hard-codes `kind: "Warehouse"` at `route.ts:50`; card icon branch at `page.tsx:91` — CONFIRMED. `site` prefix code is `route.ts:49`; low/out counts are `:54-55`; card markup `page.tsx:85-123`; states `:67-76`.
- `by-bin` SQL already filters `p.status = 'ACTIVE'` — CONFIRMED, `by-bin/route.ts:22`. B1's SQL matches it as written.
- `by-bin/page.tsx:35-39` and `by-location/[location]/page.tsx:51-55` use raw `fetch().then(r => r.json())` — CONFIRMED
- `by-location/[location]/route.ts` resolves warehouse then store (`:36-37`), `where: { warehouse: { storeId } }` (`:45-47`), returns `level` at `:110`, `warehouses` at `:114` — CONFIRMED; `requireFeature("stock","view")` at `:32`
- `by-location/[location]/page.tsx:60` back fallback pushes `/stock/by-bin` — CONFIRMED
- `stock/page.tsx`: By Location link `:410-417`, no By Store — CONFIRMED; filter panel `:503-575`; Category/Brand `<select>`s `:509-534`; Size block `:553-567`; `activeFilterCount` `:269`; `buildParams` `:271-287`; `clearFilters` `:354-359`; quick chips are `QUICK_CHIPS` at `:66-77` (plan said `:75-85`)
- `api/products/route.ts`: params `:26-34`, `currentStock` in `where` `:91-95`, `currentStock: true` at `:104` (plan said `:102`), `orderBy/skip/take` `:113-115`, `paginatedResponse` `:120`, `requireFeature("stock","view")` `:20` — CONFIRMED
- **`api/products/route.ts` has no logger at all — DRIFTED** (the Logging table said "existing"; corrected above). C1 adds `createLogger("products:list")` and logs in the existing catch.
- `stores.ts`: `listStores` `:30` returns `StoreRef[]` `{ id, code, name, gstin, stateCode }`, cached, active-only; `storeById` `:47` — CONFIRMED
- `SearchableSelect` option `:8-13`, props `:15-26`, unportalled listbox `:221-227` — CONFIRMED; `Card` sets no overflow — CONFIRMED, `card.tsx:11`
- Stock-count approve uses `setWarehouseQty` `:421` / `adjustWarehouseQty` `:424` / `deductFromStore` `:430`; delete reverses the cache only at `:562-569` — CONFIRMED
- Transfer plan Q1 points here and picks (c) — CONFIRMED, transfer plan `:70-79`; sibling plan reads `kind` from A3 — CONFIRMED, sibling `:170-171`
- Base branch = taxonomy tip — **UNVERIFIED**; see the Branch line and Answer A.

### Answers — owner, 9 Sep 2026

- **Q-A Which branch is the base?** — *"i will let u know when i am creating it — mention that in plan to ask while am implementing it."* Recorded on the Branch line: Claude asks before checking anything out.
- **Q-B Which plan edits `stock/page.tsx` first, this or the sibling?** — **This scoping plan first.** The sibling (`0909-stock-screens-size-category-and-sidebar-plan.md`) rebases onto it.
- **Q-C Do By Store product counts count ACTIVE products only, or match by-bin?** — **Match by-bin today.** by-bin already filters `p.status = 'ACTIVE'` (`by-bin/route.ts:22`), so B1's SQL stands as written and by-bin is not changed.
