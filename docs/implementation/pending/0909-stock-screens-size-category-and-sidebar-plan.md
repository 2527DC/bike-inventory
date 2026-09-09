# Four stock screens catch up: brand-count starts at the store, inbound shows the time, Warehouses leaves the sidebar, and Size becomes the Category it always meant

Status: pending — §1 Q6–Q7 and §1.3 Q8–Q11 answered (Q8 base branch deferred to implementation time); no code written
Branch: **`feat/stock-screens-size-category-sidebar`** — create it with exactly this name. **The base branch is not assumed:** the owner names it before anything is checked out.

**This plan has NO migration.** Nothing in it changes `prisma/schema.prisma` in a way that needs
one — `Product.size` keeps its column this release on purpose (D9, CLAUDE.md migration rule 7) and
the only schema *file* edit is a comment. Part G is applied by `npm run db:seed:rbac`, which is
data, not a migration (CLAUDE.md, *"RBAC catalog changes are data, not migrations"*).

**Relation to `0909-stock-store-and-warehouse-scoping-plan.md`:** these two are the split halves of
one conversation. That plan carries the two-scope architecture (the shop floor as a location, the
By Store screen, the `/stock` store filter) and the single additive migration. **This plan depends
on nothing in it and can ship in either order.** One soft link: **Part E** prints a small
`Floor` / `Godown` tag taken from the `Warehouse.kind` column that plan introduces, and **degrades
gracefully if that column is not there yet** — the tag is rendered only when `kind` is present, so
the warehouse buttons read exactly as they do today until the sibling ships.

Everything in §2 was read from the code on disk on **9 Sep 2026**, and the two data claims in §2.1
were measured against the **local `bch` database** the same day. No claim is carried over from an
earlier session. Nothing has been changed yet.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (9 Sep 2026, across one conversation)

The four items below are numbered 2–5 in the owner's own message; the sentences around them that
belong to the sibling plan are left in place so the quote is not doctored.

> 2nd -> stock-audit/brand-count where i need to list the store tooo where i need to list the
> store and store related warehouse 3rd ->need to show the time stamp the time to insde the
> inbound details 4 remove the warehosue from the siedbar which is the submodule for the stores
> 5 . -> stock/pr717080451a0a7dac077ca in this what i need is while editing the stock i have a
> field called size where i need to make that as category like searchable and selection --> for
> this implmenattion create a requiremnet listing inside the implmenation plan and i need u to
> ask question if u need any lariifcation

> i need to see the stocks where i have the by location button in the tocks where i need same as
> by store which must take me to the screen which list the card of store where it must show the
> number of products and on clickin that store it must show the stocks per store where u can add
> the filter of it in the /stocks filter too and remove the size filer form the /stocks filter
> screen

> [on size] i need to remove the size in th ui where i see in the filter anda also the size in
> the stock edit is texted that user input text but i need that to be categorie selction do the
> related things respect to this with backednn i dont need a column size where we have the
> categories

> [on the store filter control] searchable selecttion

### 0.2 Restated as requirements

| # | Requirement | The owner's words it came from |
|---|---|---|
| **R1** | `/stock-audit/brand-count` lists the **store first, then that store's warehouses**. | *"2nd -> stock-audit/brand-count where i need to list the store tooo where i need to list the store and store related warehouse"* |
| **R2** | The inbound detail screen shows the **time**, not only the date, of its timestamps. | *"3rd ->need to show the time stamp the time to insde the inbound details"* |
| **R3** | The **Warehouses** entry under Store Management is **removed from the sidebar**. | *"4 remove the warehosue from the siedbar which is the submodule for the stores"* |
| **R4** | On `/stock/[id]` edit, the free-text **Size** input becomes a **searchable Category selection**, with the backend changed to match. **The `size` column is not wanted** — categories carry that meaning. | *"5 . -> stock/pr717… while editing the stock i have a field called size where i need to make that as category like searchable and selection"* · *"i dont need a column size where we have the categories"* |
| **R5** | The **Size filter is removed** from `/stock`. | *"remove the size filer form the /stocks filter screen"* · *"i need to remove the size in th ui where i see in the filter"* |

The remaining requirements from the same conversation — the two stock scopes, the inbound
warehouse, outbound and transfer scope, By Store, the `/stock` store filter — are **R1, R2, R3, R8,
R9 of `0909-stock-store-and-warehouse-scoping-plan.md`** and are not restated here.

---

## 1. Questions and clarifications

Both questions below were put to the owner on 9 Sep 2026 and both are answered. **Question numbers
are kept from the source conversation (Q6, Q7) so the answers stay traceable**; the other six
questions of that conversation belong to the sibling plan.

| # | Question | Why it changes the build | Options | Recommended | Answer |
|---|---|---|---|---|---|
| Q6 | How much of `size` comes out? | Filter only vs every use vs the column | filter · all UI · all UI + column | all UI now, column next release (rule 7) | **all UI + the column is not wanted** — column drop scheduled, see D9 |
| Q7 | The `/stock` filter pickers — plain or searchable? | Component choice | `<select>` · `SearchableSelect` | plain | **searchable** |

Q7 was asked about the Store filter (the sibling plan's control). Its consequence **here** is D11:
Category and Brand cannot stay plain `<select>`s beside a searchable one.

### 1.3 Second round — clarify-plan, 9 Sep 2026 (all answered)

Raised after re-verifying §2 against the code on disk. Numbers continue from the source
conversation so the ids stay unique across both halves.

| # | Question | Why it changes the build | Options | Recommended | Answer |
|---|---|---|---|---|---|
| Q8 | Which branch is `feat/stock-screens-size-category-sidebar` created from, and what happens to the uncommitted docs work on `docs/plan-requirements-rule`? | The base decides whether the sibling's tip is included; uncommitted files follow the checkout | current branch · `feat/taxonomy-inactive-and-audit-approval` · commit docs first | — | **"ask me when I am implementing"** — deferred; the question is put again, before any checkout, when the owner says go |
| Q9 | A product already in an **inactive** category (15 products sit in inactive `12`) — what does `PUT /api/products/[id]` do when the edit form sends that id back unchanged? | D2 as first written would 400 every save on those 15 products; D3 pre-fills the inactive id on purpose | refuse only on **change** · refuse always | refuse only on change | **Refuse only on change.** Keeping the current category/brand is allowed even if inactive; switching *to* an inactive or unknown one is a 400. Applied to `brandId` the same way |
| Q10 | `GET /api/categories` returns every child twice (own row + nested), and the inbound flatten copies that into 12 duplicate options. How does D3 flatten? | Copying `inbound/[id]/page.tsx:189-196` verbatim copies the bug | fix in D3 **and** inbound · D3 only · change the API to roots-only | fix both | **Fix in D3 and in inbound**, same commit: iterate only rows whose `parent` is `null`, push the row, then its `children` with the parent as hint |
| Q11 | The `/stock` CSV export has a **Size** column (`stock/page.tsx:33`) that always emits blanks. Remove it with the rest of `size`? | An unlisted reader; leaving it keeps a dead field alive in `ExportColumn` | remove · keep | remove | **Remove it** — added to C′2 |

### 1.1 Decisions on record — owner, 9 Sep 2026

- **`size` goes** — from the filter, the edit form, and eventually the schema (Q6).
- The `/stock` pickers are **searchable selections** (Q7), which pulls Category and Brand with them.
- Everything else in this half: *"do whatever you want"* → §1.2.

### 1.2 Delegated decisions — recorded as assumptions, each overturnable by one reply

Carried **verbatim** from the source plan, D-numbers unchanged so the two halves keep one set of
decision ids.

| # | Decision | Why this and not the alternative |
|---|---|---|
| **D9** | **Every read and write of `Product.size` is removed in this release. The column is dropped in the next release** by a one-line migration whose SQL is in §5. | CLAUDE.md rule 7: a column is dropped the release after the code stops using it, because the migration runs before the new code is live. The owner said the column is not wanted; this is *when*, not *whether*. |
| **D10** | **`PUT /api/products/[id]` validates `categoryId` and `brandId` exist and are active**, the same two lookups `POST` already does (`api/products/route.ts:137-140`). | The update route accepts a dangling or inactive id today (§2.5). Routing the category through `/reclassify` instead would make the form two calls with a half-saved failure mode. |
| **D11** | **Category and Brand filters on `/stock` become searchable too.** | The panel would otherwise have two dialects side by side, and Category now carries 32 values and the meaning `size` used to have. |
| **D12** | **Brand-count keeps the warehouse required.** Store → warehouse, no whole-store option. | A brand count exists to correct stock (`brand-count/page.tsx:268-269`), and correction is per warehouse. |
| **D13** | **Inbound timestamps are header-level.** Created, Approved, Delivered, Putaway get the time. No per-line time. | `InboundLineItem` has no `DateTime` column at all (`prisma/schema.prisma:1916-1944`); a per-line time is a schema change the owner did not ask for. |
| **D14** | **The Warehouses sidebar entry is removed by setting the module's `route` to `null`**, not by deleting the module. | `warehouses.create/edit/delete` gate `POST /api/warehouses` and `PUT/DELETE /api/warehouses/[id]` (`api/warehouses/route.ts:60`, `[id]/route.ts:15,85`). Deleting the module revokes the grants that let anyone add a floor on `/stores`. A routeless child is skipped by the sidebar (`app-sidebar.tsx:99`) and cannot be pinned (`team/[id]/page.tsx:153`). |

---

## 2. How it works today — verified against the code, 9 Sep 2026

Subsection numbers are renumbered 2.1–2.5 for this file; the source plan's number is given in each
heading so a reader can put the two halves back together. **Every `file:line` citation is exactly
as it was verified.**

### 2.1 The `/stock` filter panel, and `size` (source plan §2.5)

| Piece | Where |
|---|---|
| Category and Brand: plain `<select>`s | `stock/page.tsx:509-534` |
| **Size** select, from `BICYCLE_SIZES` | `:553-567`, `showSizeFilter = true` at `:397` |
| Size in state / count / params / deps / clear / fuzzy fields | `:148`, `:269`, `:284`, `:287`, `:357`, `:391` |
| Size badge on each row | `:690-692` |
| **Size column in the CSV export** — `{ header: "Size", key: "size" }` in `STOCK_COLUMNS` (found by clarify-plan, 9 Sep 2026; always blank) | `:33` |
| `?size=` param and exact-match where clause | `api/products/route.ts:29`, `:90` |
| **free-text search matches on `size`** | `api/products/route.ts:50`; also `api/products/search/route.ts:50` |
| `size: true` in list select | `api/products/route.ts:102` |
| Zod: `size: z.string().optional()` — free text, no enum | `src/lib/validations.ts:52` |
| Column: `size String?` | `prisma/schema.prisma:520` |
| Other selects carrying it | `api/inventory/inwards/route.ts:34`, `outwards/route.ts:37`, `api/stock-counts/[id]/items/route.ts:91` |
| Other readers | `stock-audit/brand-count/page.tsx:19,221,588-589`; `stock-audit/[id]/page.tsx:37,173`; `src/types/index.ts:91` |
| `src/lib/product-size.ts` — `BICYCLE_SIZES` (`:27`) and `parseBicycleSize` (`:89`, **never called**) | sole importer: `stock/page.tsx` |

**`size` is dead data, and this is measured, not asserted.** Against the **local `bch` database on
9 Sep 2026**:

```sql
SELECT count(*) FILTER (WHERE size IS NOT NULL AND btrim(size) <> '') FROM "Product";
--  0   (of 5,738 products)
```

**0 of 5,738 products carry a `size`.** That matches the code: the catalog seed writes no `size`
(`prisma/data/catalog.sql` has no such column in its `INSERT`), `scripts/import-products.ts:106-109`
says the size derivation was *"dropped by instruction"*, and `product-size.ts:4` says *"every
imported bicycle arrives with `size = null`"*. The filter sends `26"` and matches exactly, **so it
can never select anything.**

Meanwhile **20 of the 32 seeded categories are wheel sizes** (`12'`, `20'`, `26 MS`, `700C SS` …
— `categories/page.tsx:24` notes the mix), and those 20 categories hold **3,495 of 5,738 products
(~61%)** — also measured against the local `bch` database on 9 Sep 2026. The category tree already
carries what `size` was for, for nearly two products in three.

Not `Product.size`, and not touched: `SecondHandCycle.size` (`schema.prisma:1665`),
`BrandStockItem.rawSize` (`:2234`), `PriceItem.wheelSize` (`:2390`).

### 2.2 `/stock/[id]` edit — Size is a text input; there is no Category control (source plan §2.6)

- Inline edit form: `src/app/(dashboard)/stock/[id]/page.tsx:267-356`; state init `:101`, `startEdit` `:167-181`.
- **Size** `<Input placeholder='e.g. 26"'>` at `:297-301`, beside Color.
- **No category control anywhere on the page.** `categoryId`/`category` are in `ProductDetail` (`:59-60`) and on the wire; nothing renders or edits them.
- Brand is a plain `<select>` (`:279-286`) with the inactive-brand append pattern at `:161-165`.
- `handleSave` strips empty strings (`:190-191`), posts `PUT /api/products/${id}` (`:198-202`), refetches.
- Identity badges: `product.size` at `:363,366`; the comment about `type === "BICYCLE"` is `:359-362`.
- **`PUT /api/products/[id]`** (`api/products/[id]/route.ts:61-108`) — `productUpdateSchema.parse`, validates only `reorderVendorId`; **`categoryId` and `brandId` are written unchecked** (`:92-96`). `POST` on the same resource does check both (`api/products/route.ts:141-156`), as does `PUT /api/products/[id]/reclassify` (`reclassify/route.ts:49-56` — its wording is *"Selected category no longer exists"* at `:54` and *"`<name>` is inactive. Activate it on /categories first."* at `:55`). **Correction, 9 Sep 2026 (clarify-plan):** `/reclassify` **does** have a caller — `stock-audit/brand-count/page.tsx:190`. The route is not touched by this plan, so nothing breaks, but the earlier "no caller" claim was wrong.
- **`productUpdateSchema = productSchema.partial()`** (`validations.ts:59`), so on update `categoryId` is optional; the edit form still always sends it (initialised from the product).
- `Product.categoryId` is **required** (`schema.prisma:497-498`), zod `min(1, "Category is required")` (`validations.ts:26`).
- The one searchable picker in the app: **`src/components/ui/searchable-select.tsx`** — `{ options, value, onChange(id|null), placeholder, emptyText, disabled, className, id, name }` (`:15-26`), option `{ id, label, hint? }` (`:8-13`); dropdown is unportalled, so the container must not clip (`:218-220`). Already used as a **category picker** on `inbound/[id]/page.tsx:691-698`, with the tree flattened parent-as-hint at `:189-196`. `Card` sets no `overflow` (`components/ui/card.tsx`), so the edit form's `CardContent` (`stock/[id]/page.tsx:269`) is safe.
- `GET /api/categories` — active only by default, `?includeInactive=1` for all, gated on `stock.view` (`api/categories/route.ts:21-35`). **Shape, verified 9 Sep 2026 (clarify-plan): a flat array of EVERY category row — parents and children alike — each row carrying `children: {id,name,isActive}[]`, `parent: {id,name} | null` and `_count`.** It is not a tree. Because children appear both as their own row and nested under their parent, the inbound flatten at `:189-196` pushes each child twice; **12 of 32 categories have a parent, so `/inbound/[id]`'s picker shows 12 duplicate options today.** D3 must not copy that loop verbatim.
- **Inactive categories still hold products.** On local `bch`, 9 Sep 2026: category `12` is inactive and has **15 products**. Any edit-form save on one of those sends the inactive id back — see Q9 in §1.3.

### 2.3 `/stock-audit/brand-count` — warehouses only, no store step (source plan §2.7)

- `useWarehouses()` at `brand-count/page.tsx:41`; step 2 maps every warehouse as a button with the store name as a subtitle (`:463-482`, `loc.store.name` at `:473`).
- `selectedLocation` (`:54`) holds a **warehouse id**; the POST derives `storeId` from `selectedWarehouseFor(selectedLocation)?.storeId` (`:246`, `:266-272`).
- The pattern to copy is already on `/stock-audit/new`: `useStores()` (`new/page.tsx:31`), store buttons (`:203-218`) then `selectedStore.warehouses` buttons (`:234-244`).
- `useStores()` → `GET /api/stores` nests active warehouses `{ id, code, name, sortOrder }` (`api/stores/route.ts:50-54`); `StoreOption` at `src/hooks/use-sites.ts:27-32`.

**Note for Part E:** that nested select carries **no `kind`** today. The sibling plan adds it
(`0909-stock-store-and-warehouse-scoping-plan.md`, its A3). Part E therefore reads `kind`
optionally and renders the Floor/Godown tag only when it is present.

### 2.4 Inbound detail — the times are stored, the page throws them away (source plan §2.8)

- `formatDate` = `toLocaleDateString("en-IN", { day, month, year })` — **date only** (`inbound/[id]/page.tsx:96-98`).
- Rendered: Bill Date `:607`, Expected `:612`, Delivered `:618`, *"Created by X on date"* `:639`, *"Approved by X on date"* `:644`; **Delivered by** `:650` and **Putaway by** `:656` show a name with **no time**.
- `InboundShipment` carries `approvedAt :1881`, `deliveredAt :1884`, `putawayAt :1887`, `createdAt :1893` as full `DateTime` (`prisma/schema.prisma`). The detail `GET` uses `include` (`api/inbound/[id]/route.ts:33-52`), so **every scalar including `putawayAt` is already on the wire**; the client `Shipment` interface simply omits `putawayAt` (`page.tsx:64-90`).
- `InboundLineItem` has **no `DateTime` column** (`schema.prisma:1916-1944`).

### 2.5 The sidebar "Warehouses" entry links to a page that does not exist (source plan §2.9)

- The nav is **data**: `app-sidebar.tsx:75` reads `modules` from the permission store, which comes from the `modules` table via `/api/my-permissions` (`src/lib/rbac.ts:111,168-171,211-215`). No static nav array exists.
- `warehouses` is **not a child of `stores`** — both are children of the container `store_management` (`prisma/rbac-catalog.ts:762-793`). Its `route: "/stores/warehouses"` is at **`:788`**.
- **`/stores/warehouses` does not exist.** `src/app/(dashboard)/stores/` holds only `page.tsx`; the string appears nowhere else in `src/`. The link is a 404. Warehouse management lives inside `/stores` (`stores/page.tsx:109-110`, `:353-381`).
- The seeder **upserts `route`** on every run (`prisma/seed-rbac.ts:107-118`, the `route: m.route` at `:113`), and a child with `route: null` is skipped by the sidebar builder — *"A child with no route is unreachable and renders nothing — skip it, but do NOT let that skip remove its parent heading"* (`app-sidebar.tsx:99-101`). **Precisely:** the heading survives while **at least one** child keeps a route (`:102-118`, `:157`). `store_management` is itself `route: null`, so it stays only because `stores` keeps `/stores` — if `stores` were ever nulled too, the heading would vanish at `:157`. Eleven other catalog entries already use `route: null`, two of them ex-routed modules deliberately unlinked (`rbac-catalog.ts:408`, `:680-686`).
- Bottom-nav pins resolve by `modules.find(m => m.route === href)` (`src/lib/use-bottom-nav.ts:60`); a pin whose module lost its route is skipped silently. The pin picker only offers modules with a route (`team/[id]/page.tsx:153`).
- The permissions matter: `POST /api/warehouses` → `warehouses.create` (`api/warehouses/route.ts:60`); `PUT`/`DELETE /api/warehouses/[id]` → `warehouses.edit`/`.delete` (`[id]/route.ts:15,85`). `GET` is `requireAuth` only (`route.ts:26`, warned about at `:16-22`).

### 2.6 Live defects found on the way

Four unrelated live defects were found while mapping this area. They are listed once, in the
sibling plan: **`0909-stock-store-and-warehouse-scoping-plan.md` §2.10**. None of them is touched
by this plan.

---

## 3. Implementation plan

**Five parts, no migration.** Part letters are kept from the source plan (C′, D, E, F, G) so the
two halves keep one vocabulary. **Every part is independent of every other part and of the sibling
plan** — one commit per part, in the order given, on the one branch. C′ and D are companions (the
UI half and the backend half of `size`) and are best committed together in that order.

### Part C′ — the `/stock` filter panel: searchable pickers, and the Size filter out

The two pieces of the source plan's Part C that need no store scoping. The Store filter itself and
`GET /api/products?storeId=` belong to the sibling plan.

**C′1. Searchable Category and Brand (D11)** — `stock/page.tsx:509-534`: the Category and Brand
`<select>`s become `SearchableSelect` with the same option shape and the product counts as hints.
The `grid grid-cols-2` container has no clipping class and `Card` sets no overflow, so the
unportalled dropdown is fine; confirmed in §4 on a phone.

**C′2. The size filter goes** — the entire block at `:553-567`, `showSizeFilter` (`:397`), the
`BICYCLE_SIZES` import and the comment at `:79-81`, `selectedSize` at `:148`, `:269`, `:284`,
`:287`, `:357`, and `p.size` in the fuzzy fields at `:391`. Row badge at `:690-692` goes. **The
`Size` export column at `:33` goes too (Q11, 9 Sep 2026)**, and `size` leaves the local
`ProductItem` interface at `:43`.

### Part D — `size` out, category picker in

**D1. Backend** — every use in §2.1 is removed:

| File | Line | Change |
|---|---|---|
| `src/lib/validations.ts` | `:52` | `size` removed from `productSchema` (and so from `productUpdateSchema`) |
| `src/app/api/products/route.ts` | `:29`, `:50`, `:90`, `:102` | param, search clause, where, select — removed |
| `src/app/api/products/search/route.ts` | `:50` | search clause removed |
| `src/app/api/inventory/inwards/route.ts` · `outwards/route.ts` · `src/app/api/stock-counts/[id]/items/route.ts` | `:34` · `:37` · `:91` | `size: true` removed from the selects |
| `src/types/index.ts` | `:91` | `size?` removed from the shared type |
| `src/lib/product-size.ts` | whole file | **deleted** — its only importer is `stock/page.tsx`, and `parseBicycleSize` has no caller |
| `stock-audit/brand-count/page.tsx` | `:19`, `:221`, `:588-589` | interface member, literal `size: null`, badge — removed |
| `stock-audit/[id]/page.tsx` | `:37`, `:173` | interface member, fuzzy field — removed |
| `prisma/schema.prisma` | `:520` | **column stays this release** (D9). A `// dropped next release — plan 0909-stock-screens-size-category-and-sidebar §5` comment marks it. This is a comment only — **no migration** |

**D2. `PUT /api/products/[id]` validates its foreign keys — on change only** (edited 9 Sep 2026, Q9) —
`api/products/[id]/route.ts:92-96`, before the `update`. Read the current row's `categoryId` and
`brandId` first (one `findUnique` with `select`). Then, for each of `categoryId` / `brandId`
that is present in `data` **and differs from the current value**, look it up `{ id, name,
isActive }`; 400 *"Selected category no longer exists"* or *"`<name>` is inactive. Activate it
on /categories first."* — the wording at `reclassify/route.ts:54-55` — and the brand
equivalents. **An unchanged id is never checked**, so the 15 products sitting in the inactive
category `12` stay editable; only a move *to* an inactive or unknown row is refused (D10).
`log.warn("product update refused", { productId, field, value })` on each refusal, using the
file's existing `createLogger("api:products:id")` (`:10`).

**D3. The edit form** — `stock/[id]/page.tsx`:

- Fetch `/api/categories` in the existing brands effect (`:105-119`); flatten parent-as-hint
  **correctly** (edited 9 Sep 2026, Q10): iterate only rows whose `parent` is `null`, push the
  row, then push each of its `children` with the parent name as `hint`. **Do not** copy
  `inbound/[id]/page.tsx:189-196` verbatim — that loop iterates every row and so pushes each
  child twice (§2.2). **The same fix is applied to the inbound loop in this commit** (filter on
  `c.parent === null`; one line), which removes the 12 duplicate options `/inbound/[id]` shows
  today. If the product's own category is not in the active list, append it as
  `"<name> (inactive)"` — the brand pattern at `:161-165` — so the control never renders blank
  and a save never silently moves the product. With D2 refusing only on change, saving with the
  inactive id still in place succeeds.
- `editData.categoryId` replaces `editData.size` at `:101` and `:171`, initialised from
  `product.categoryId`.
- The **Size** `<Input>` at `:297-301` becomes a **Category** `SearchableSelect`
  (`value={editData.categoryId}`, `onChange={(id) => setEditData({ …, categoryId: id ?? "" })}`),
  still beside Color. The strip-empty loop at `:190-191` never drops it: a category is required,
  so it is never empty.
- Identity badges at `:362-368`: the size badge becomes the category name, in the violet chip
  `stock/page.tsx:686-688` already uses, so the two screens agree. The comment at `:359-362`
  (about `type === "BICYCLE"`) is replaced.
- The `ProductDetail` interface loses `size`.

### Part E — brand-count: store, then that store's warehouses

`stock-audit/brand-count/page.tsx`:

- `useWarehouses()` (`:41`) → `useStores()`. `selectedWarehouseFor` and `locationName`
  (`:42-44`) look up across `stores.flatMap(s => s.warehouses)`.
- New `selectedStoreId` state. Step 2 (`:463-482`) becomes two rows on one step: the store
  buttons first (copy `stock-audit/new/page.tsx:203-218`), then — once a store is chosen — that
  store's warehouses (copy `:234-244`), each labelled with its name and a small `Floor` /
  `Godown` tag from `kind`. No **Whole store** button (D12).
- The POST (`:264-272`) sends `storeId: selectedStoreId, warehouseId: selectedLocation`. The
  server already refuses a warehouse that is not the store's (`api/stock-counts/route.ts:124-134`).
- The "Select a location first" guard (`:245`) also requires a store. Header, sticky bar and
  success copy (`:388`, `:786`, `:818`) print *"<warehouse> · <store>"*.
- `createLogger("stock-audit:brand-count")` if the file has none; `log.error` on the create
  failure at `:279`.

**The `kind` tag is optional.** `Warehouse.kind` is introduced by
`0909-stock-store-and-warehouse-scoping-plan.md`; until it ships, `StoreOption.warehouses[]` has no
`kind` (§2.3). Type it `kind?: "FLOOR" | "GODOWN"` and render the tag only when it is set, so this
part compiles and runs correctly on its own and gains the tag for free when the sibling lands. No
other behaviour depends on it.

### Part F — inbound timestamps

`src/app/(dashboard)/inbound/[id]/page.tsx`:

- `formatDateTime(d)` — **exported from `src/lib/utils.ts` beside the existing `formatTime`
  (`:17-25`)**, not local to the page (edited 9 Sep 2026: no shared date-time formatter exists
  anywhere in `src/`, and the next screen that needs one should not write a second copy):
  `toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit",
  minute: "2-digit" })`. The page imports it next to its `formatDate` (`:96-98`).
- `Shipment` gains `putawayAt: string | null` (`:64-90`). It is already on the wire (§2.4).
- Summary card: **Created by** (`:639`) and **Approved by** (`:644`) use `formatDateTime`;
  **Delivered by** (`:650`) becomes *"<name> on <deliveredAt>"*; **Putaway by** (`:656`) becomes
  *"<name> on <putawayAt>"*. The **Delivered** row at `:618` shows the time too. **Bill Date** and
  **Expected Delivery** stay date-only — they are dates, not moments.
- No API change, no schema change (D13).

### Part G — the Warehouses sidebar entry

`prisma/rbac-catalog.ts:788`: `route: "/stores/warehouses"` → `route: null`, with the comment:
*"No page. Warehouses are managed inside /stores; this module exists to hold the
`warehouses.create/edit/delete` grants that gate /api/warehouses. A routeless child renders
nothing in the sidebar and cannot be pinned — plan 0909-stock-screens-size-category-and-sidebar,
D14."* The catalog's own design note at `:746-761` is amended to say the second child is
permission-only.

**Applied by `npm run db:seed:rbac`, not by a migration** — the upsert writes `route`
(`seed-rbac.ts:111`). No code change: `app-sidebar.tsx:99` skips it, `use-bottom-nav.ts:60-61`
drops any existing pin, `team/[id]/page.tsx:153` stops offering it. The `store_management` heading
stays because `stores` is still granted. **The `warehouses` module and its permissions are not
deleted** (D14).

### Phases and dependencies

```
C′ searchable Category/Brand + size filter out     (independent; commit with D)
D  size out of the backend + category picker in    (independent)
E  brand-count store → warehouse                   (independent; reads kind if present)
F  inbound timestamps                              (independent)
G  catalog route: null + db:seed:rbac              (independent)
```

No part depends on another, and no part depends on
`0909-stock-store-and-warehouse-scoping-plan.md`. Either plan can ship first.

### Migration

**None.** `prisma/schema.prisma` is touched only by a one-line comment in D1, so no
`prisma/migrations/` folder is created and `npx prisma migrate dev` is not run for this plan.
CLAUDE.md migration rule 7 is the reason `Product.size` keeps its column — the drop is a separate,
one-line migration in the **next** release (D9, §5).

### RBAC

No new module, no new action, no new grant. `warehouses.route` becomes `null` (Part G) and the seed
is re-run — **data, not a migration** (CLAUDE.md, *"RBAC catalog changes are data"*). No role name
appears anywhere in this plan.

### Logging

| Where | Logger | Lines |
|---|---|---|
| `api/products/[id]/route.ts` | existing | `warn` on a refused category/brand `{ productId, field, value }` |
| `brand-count/page.tsx` | `stock-audit:brand-count` | `error` on create failure |

Identifiers only, never the row body. No `console.log`.

### Board of agents — checked

| Agent | Principle | Finding |
|---|---|---|
| Inventory consultant | product identity must be unambiguous | Category replaces a field that is empty on **all 5,738 products** and is carried today by 20 of 32 categories (~61% of products). Nothing that moves stock is touched by this plan. |
| Database architect | additive first; no speculative drop | No migration. The `size` drop is deferred to the next release by rule 7, with its SQL written down in §5 so it is not forgotten. |
| Backend engineer | zod for every input; validate FKs | `size` leaves `productSchema`; `PUT /api/products/[id]` finally validates `categoryId`/`brandId` (D10) — a real defect fixed on the way. |
| Frontend engineer | loading, error and empty states; mobile | The unportalled `SearchableSelect` dropdown is checked in a narrow viewport in §4; the inactive-value append keeps a picker from rendering blank; nothing new is gated client-side only. |
| Warehouse consultant | a count corrects one place | Part E keeps the warehouse required (D12) — a brand count still corrects exactly one location. |
| Integration architect | — | No external call is touched. |

---

## 4. Verification

The owner runs the build (21–45 min): `npm run build` — must pass. Before the browser:

1. **No `prisma migrate` step** — this plan has no migration. If `npx prisma migrate status` is run
   anyway it must report **no new migration**, which is the check that nothing schema-shaped crept in.
2. `npm run db:seed:rbac` → the `warehouses` module row has `route = NULL`.

Browser walk, in this order:

| # | Where | See |
|---|---|---|
| 1 | Sidebar | under **Store Management**, **Stores** only — no Warehouses entry. The heading itself is still there. A user who had Warehouses pinned to the bottom bar loses the pin silently and everything else on the bar is unchanged. |
| 2 | `/stores` | **Add warehouse** and the per-warehouse edit/delete still work — the grants were not deleted (D14). |
| 3 | `/stock` filter panel | Category and Brand are **searchable**; type to filter each; **no Size control anywhere**; clear all resets them; the active-filter count is right. On a phone, open each dropdown at the bottom of the panel and confirm it is not clipped. |
| 4 | `/stock` list rows | **no size badge**; free-text search still finds products by name, SKU and the other fields. |
| 5 | `/stock/[id]` → edit | **Category** is a searchable picker where Size was, pre-filled with the product's own category; type to filter; save; the violet category chip updates; **no size badge anywhere on the page**. `PUT` with an inactive category id (curl) → 400 naming it; the same with an unknown `brandId` → 400. |
| 6 | `/inbound/[id]` | the summary shows *"Created by X on 9 Sep 2026, 14:32"* and *"Approved by X on …"* with the time; **Delivered by** and **Putaway by** carry a time once set; the **Delivered** row shows the time; **Bill Date** and **Expected Delivery** are still date-only. |
| 7 | `/stock-audit/brand-count` | pick a brand → **store buttons** appear → choosing a store reveals that store's warehouses → pick one → count. The header and sticky bar read *"<warehouse> · <store>"*; the review page names the warehouse. Choosing a brand with no store selected is refused. (With the sibling plan shipped, each warehouse button also carries a **Floor** / **Godown** tag; without it, no tag and no error.) |
| 8 | `/stock-audit/[id]` | an existing count still opens and its item list renders with no size column. |

---

## 5. Out of scope, deliberately

- **Dropping `Product.size`.** Scheduled for the **next release** (D9, CLAUDE.md migration rule 7).
  The migration is `npx prisma migrate dev --name drop_product_size` and its SQL is one line:

  ```sql
  ALTER TABLE "Product" DROP COLUMN "size";
  ```

  Ship it once this plan is live and no deployed code selects the column. Rule 7 is the whole
  reason it is not in this release: the migration runs minutes before the new code, so the old code
  must survive the new schema.
- **Per-line inbound receive time.** Needs a `DateTime?` on `InboundLineItem` (D13) — a schema
  change, and therefore a migration, that the owner did not ask for.
- **`SecondHandCycle.size`, `BrandStockItem.rawSize`, `PriceItem.wheelSize`** (`schema.prisma:1665`,
  `:2234`, `:2390`). Different columns on different models; the requirement was about
  `Product.size`.
- **A "Whole store" option on brand-count** (D12). A brand count corrects stock, and correction is
  per warehouse.
- **The `warehouses` module's `view` action** gates nothing (`GET /api/warehouses` is
  `requireAuth`). Left as is; removing an action is a catalog change with its own blast radius.
- **Deleting the `warehouses` module** (D14). It holds the `create/edit/delete` grants that gate
  `/api/warehouses`; deleting it revokes them and nobody could add a warehouse on `/stores`.
- **A `/stores/warehouses` page.** The route was a 404 and is being unlinked, not built — warehouse
  management already lives inside `/stores`.
- **Everything in `0909-stock-store-and-warehouse-scoping-plan.md`:** the two stock scopes, the
  shop floor as a location, `Warehouse.kind` and its migration, By Store, the `/stock` store filter
  and the scoped `GET /api/products?storeId=`.
- **The four live defects** in that plan's **§2.10**. Real, verified, and not this requirement.

---

## Clarifications — 9 Sep 2026 (clarify-plan, second pass)

Every claim in §2 was re-read from the code on disk and the two data claims re-measured on the
local `bch` database on 9 Sep 2026 by this pass, independently of the session that wrote the
plan. Corrections were applied in place above and are dated. No code has been written.

### Verified against code

- `/stock` size filter, state, params, badge, import, `showSizeFilter` — CONFIRMED, `stock/page.tsx:26,148,269,284,287,357,391,397,553-568,690-692`
- **Unlisted `Product.size` reader** — DRIFTED: the CSV export column at `stock/page.tsx:33` and the local interface at `:43`; added to §2.1 and C′2
- Size in `api/products/route.ts:29,50,90,102`, `search/route.ts:50`, `inwards:34`, `outwards:37`, `stock-counts/[id]/items:91`, `validations.ts:52`, `types/index.ts:91` — CONFIRMED
- `product-size.ts` sole importer `stock/page.tsx`; `parseBicycleSize` has zero callers — CONFIRMED (repo-wide grep of `src/`, `scripts/`, `prisma/`)
- No Zoho code, label printing, or import script reads or writes `Product.size` — CONFIRMED
- 0 of 5,738 products carry a size; 20 wheel-size categories hold 3,495 products; 32 categories, 31 active — CONFIRMED by query
- Inactive category `12` holds 15 products — NEW FACT, drives Q9
- `/stock/[id]` edit form, state, brand inactive-append, strip loop, PUT, badges — CONFIRMED with line shifts (`:279-286`, `:161-165`, `:198-202`, `:359-362`); the file already has `createLogger("stock:detail")`
- `PUT /api/products/[id]` writes `categoryId`/`brandId` unchecked — CONFIRMED at `:92-96` (was cited `:96-100`); POST checks at `api/products/route.ts:141-156` (was `:137-140`)
- `/reclassify` "no caller in `src/`" — WRONG: `stock-audit/brand-count/page.tsx:190` calls it. Route untouched by this plan
- Reclassify wording — DRIFTED: "Selected category no longer exists" (`:54`), not "Category not found"
- `GET /api/categories` shape — DRIFTED from the plan's implicit tree: flat list of every row with `children` embedded (`api/categories/route.ts:21-35`); inbound flatten at `:189-196` duplicates every child
- `searchable-select.tsx` props `:15-26`, option `:8-13`, unportalled `:218-220` — CONFIRMED
- Brand-count `useWarehouses` `:41`, `selectedLocation` `:54`, warehouse buttons `:463-482`, POST `:266-272`, guard `:245`, copy `:388,786,818` — CONFIRMED; no logger in the file
- `/stock-audit/new` store→warehouse pattern `:203-218`, `:234-244` — CONFIRMED
- `StoreOption` (`use-sites.ts:27-32`) and `api/stores/route.ts:50-54` carry no `kind`; `Warehouse` model (`schema.prisma:285-317`) and the live table have no `kind` column — CONFIRMED, Part E's optional tag stays optional
- `api/stock-counts/route.ts` refuses a foreign warehouse — CONFIRMED at `:123-134`
- Inbound `formatDate` `:96-98`, render sites `:607-656`, `Shipment` lacks `putawayAt` (`:64-90`), GET uses `include` (`api/inbound/[id]/route.ts:31-57`) — CONFIRMED
- No `formatDateTime` anywhere in `src/`; nearest are `utils.ts:17-25 formatTime` and `services/timezone.ts:69-75 formatIST` — CONFIRMED, Part F now puts the helper in `utils.ts`
- `InboundShipment` `:1881,1884,1887,1893`; `InboundLineItem` `:1916-1945` has no `DateTime` — CONFIRMED
- Sidebar routeless-child skip `app-sidebar.tsx:99-101` (was `:97-99`); parent survives only while one child keeps a route (`:102-118`, `:157`) — CONFIRMED with the precise condition added to §2.5
- `rbac-catalog.ts:788` route, `:30` `route: string | null`, 11 `route: null` precedents; `seed-rbac.ts:113` upserts route (was `:111`); `modules.route` nullable (`schema.prisma:29`); live row is `/stores/warehouses` — CONFIRMED
- `/stores/warehouses` page absent; string nowhere in `src/`; warehouse CRUD in `stores/page.tsx:109-110,353-381` — CONFIRMED
- Warehouse API guards `route.ts:26` (GET, `requireAuth`), `:60` (create), `[id]/route.ts:15,85` — CONFIRMED
- `use-bottom-nav.ts:60-61`, `team/[id]/page.tsx:153` — CONFIRMED
- `db:seed:rbac` at `package.json:13` — CONFIRMED
- Neither this plan's branch nor the sibling's exists yet; sibling status is `pending`; current checkout is `docs/plan-requirements-rule` at `6cbdf4b` with uncommitted docs work; `feat/taxonomy-inactive-and-audit-approval` is at `40eedc9` — CONFIRMED
- Conflicts with CLAUDE.md — none found (no role names, no migration, no scheduler, logger only, `apiFetch` in use)

### Answers

- Q8 base branch and the uncommitted docs work — **deferred by the owner: "ask me when I am implementing"**. Ask again, before any checkout, when the owner says go.
- Q9 inactive category already on the product — **refuse only on change** (D2 rewritten).
- Q10 category flatten duplicates — **fix in D3 and in the inbound picker, same commit** (D3 rewritten).
- Q11 blank Size export column — **remove it** (C′2 extended).

### Applied without asking

- Part F's `formatDateTime` lives in `src/lib/utils.ts`, not in the page.
- Eight stale line citations corrected in place (listed above).
