# /stock by location and bin — pick Bch store or Bch warehouse, then one of its bins, and see what that bin holds

Status: completed — 14 Oct 2026, released: PR #84 (`d93da76`) merged into `main` at the owner's instruction, deployed to the VPS (run 38561471706), merged into `test` (`9dd7d3c`). No migration. Left for the owner: the browser pass on bicyclecare.in, and whether "Low" should show under a bin.
Branch: **`feat/1410-stock-location-bin`** — off `origin/main` @ `f93ec68` (owner: "Branch from main → PR to main"). After it reaches `main` it is merged into `test`.

Every `file:line` below was read at `origin/main` @ `f93ec68` on 14 Oct 2026. The production figures were read the same day, read-only.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (14 Oct 2026)

> I need you to update with respected where I need to list down the products that are there with respect to the store and the store specific bin with store specific bin not the store with respect to the like Veros Gordon or thing when I select with respect to Veros Gordon I need to select the respected listing I need to see that respected bins when i selected respected bins i need to see that is bin's respected products

"Veros Gordon" is read as **"warehouse / godown"**. Production has two locations: **Bch store** (`FLOOR`, the shop floor) and **Bch warehouse** (`GODOWN`).

The owner answered four questions the same day:

| Question | Answer, verbatim |
|---|---|
| Where should it live? | "On /stock (Recommended)" |
| Which products count as in a bin? | "Where stock physically is (Recommended)" |
| What should each row show? | "it must show the product  lsiting related   details respected to the warehouse  and warehouse level chosen bin like it must be like store and ware houses selction  a nd that respected warehouse bin selcton" |
| How should it reach production? | "Branch from main → PR to main" |

### 0.2 Restated as requirements

| # | Requirement |
|---|---|
| R1 | On `/stock`, a **Location** picker chooses one of a store's locations: Bch store (shop floor) or Bch warehouse (godown), listed under its store. |
| R2 | Once a location is chosen, the **Bin** picker offers only that location's bins. |
| R3 | Choosing a location lists the products held there. Choosing a bin lists the products **physically in that bin**: live coded units plus stock without codes counted into it. A product whose home bin merely points there, with its stock elsewhere, is not listed. |
| R4 | Each row keeps the normal `/stock` details: name, SKU, category, brand, price and the ⋮ actions. Its **stock figure and its assembled / not-assembled split are the chosen location's or bin's**, not the product's total everywhere. |
| R5 | It works for everyone who can open `/stock` (`stock.view`), not only ADMIN. |
| R6 | Built from `main`, released by a PR into `main`, then merged into `test`. |

---

## 1. Questions and clarifications — answer before build

The four answers in §0.1 settle where it goes, what "in a bin" means, what a row shows and the release path. The questions below have a **default** that the build follows unless the owner says otherwise.

| # | Question | Default |
|---|---|---|
| Q1 | Stock held at a location but in **no bin**: for example, 6 of the 9 Doodle V4 at Bch store. The transfer screen cannot move these ("Not in any bin of …"). | The Bin picker offers **"No bin"** first, with its count, and it lists those products with the unbinned quantity. |
| Q2 | The current **Store** picker scopes the list to a whole store. Production has one store, BCH, so it shows the same total as no filter. | The Location picker replaces it. It offers "All locations", then for each store "<store> · all locations" (the old store-wide view, kept), then each location. |
| Q3 | Which bins the Bin picker lists. | Every active bin of the location, each with what it holds now: "L3 · Rack 3 — 2 products · 9 items". Empty bins come last, marked "empty". |
| Q4 | Keep the choice in the address bar. | Yes: `?warehouseId=…&binId=…`, so a refresh or a shared link reopens the same view, as `storeId` does today. |
| Q5 | Excel and PDF export under a location or bin. | Exports the same scoped list with the scoped quantities. Export already reuses the list's parameters. |
| Q6 | Sorting by Stock, and the In stock / No stock / Low Stock chips, under a scope. | They use the scoped quantity, as the store scope does today. Under a bin, only products in the bin are listed, so "No stock" is empty by definition. |

### 1.1 Decisions on record (14 Oct 2026)

- The four answers in §0.1.
- Q1–Q6: the owner approved the plan with these defaults on 14 Oct 2026 ("Yes, build it").

---

## 2. How it works today — verified against the code

### 2.1 The `/stock` filter panel

`src/app/(dashboard)/stock/page.tsx:756-842` has four pickers: Category, Brand, **Store** and **"Bin / Location"**.

- **Store** (`page.tsx:799-818`): Store rows from `useStores()` (`src/hooks/use-sites.ts`), which read `GET /api/stores` and `GET /api/warehouses`. Both are `requireAuth()` only, so every signed-in user can read them.
  - `storeId` reaches `GET /api/products` and takes the **scoped path** (`src/app/api/products/route.ts:163-214`). The quantity is SUM(`StockLevel.quantity`) over the store's active warehouses; it replaces `currentStock`; sorting, the stock range and Low Stock are applied to it in code.
  - The caption reads "Showing what <store> holds. Quantities are that store's."
- **Bin / Location** (`page.tsx:820-836`): one flat `<select>` of every bin of every location, loaded from `GET /api/bins` (`page.tsx:304`).
  - `GET /api/bins` is guarded by **`bins.view`** (`src/app/api/bins/route.ts:16`). In production only **ADMIN** holds `bins.view`, while `stock.view` is held by ADMIN, INVENTORY_INWARDS, OUTWARDS and SALES_STAFF. For those three roles the call is refused, so the picker stays "All Bins (0)".
  - Each option reads `name (_count.products)`. That count is products whose **home bin** is this bin, not what the bin holds. Bins of both locations are mixed, with no location shown.
- **The bin filter** (`route.ts:125`, `productInBinWhere` in `src/lib/products/bin-filter.ts`) matches the home bin **or** a live unit **or** `BinStock` > 0. So a product whose home bin is X but whose stock is elsewhere is listed under X.
  - It does not take the scoped path, so the Stock column still shows the product's **total everywhere** (`currentStock`).
  - `/stock` is the only screen that passes `binId` to `GET /api/products`. The other list callers (`stock-audit/brand-count`, `transfers/new`, `transfers/[id]` edit sheet, `desktop/stock`, `desktop/barcode`) do not.

### 2.2 What a bin holds

`getBinQtyMap` and `getWarehouseBinQty` (`src/lib/units/bin-qty.ts:22`, `:74`) are the one definition. Units are the truth: a product that has unit records counts its **live** units in the bin. A product that has never had a unit keeps its typed-in `BinStock.quantity`. Stock counts and the transfer screen's From-bin list read the same figures.

### 2.3 The assembled / not-assembled split

`conditionByProduct(ids, { storeId })` (`src/lib/stock-condition.ts:38`) counts live units by condition. It is scoped by store only; there is no per-location or per-bin option.

### 2.4 Production, 14 Oct 2026

| Location | Kind | Active bins | Bins holding stock | Products in bins |
|---|---|---|---|---|
| Bch store | FLOOR | 13 | 5 | 110 |
| Bch warehouse | GODOWN | 10 | 6 | 94 |

One Store row, BCH, holds both. Example: Doodle V4 Military Blue (7002) has 9 at Bch store, of which 3 are in bin E CYCLE and 6 are in no bin, and 0 at Bch warehouse.

---

## 3. Implementation plan

### Part A — the API

**A1. `GET /api/stock/locations`** (new, `requireFeature("stock", "view")`). It lists each store's active locations and each location's active bins with what they hold now.

```
{ stores: [{ id, name, warehouses: [{ id, code, name, kind,
    noBin: { products, items },
    bins: [{ id, code, name, products, items }] }] }] }
```

- `items` and `products` per bin use the same rule as `getBinQtyMap` (§2.2), so the picker's numbers agree with the list.
- It is computed per warehouse in grouped queries (live units grouped by bin and product, plus `BinStock` rows), not one query per bin.
- `noBin` per product is `max(0, StockLevel.quantity − Σ its bin quantities in that warehouse)`.
- It is a stock-view route, so all four roles that open `/stock` can load it. `GET /api/bins` stays the admin bins screen's route, unchanged.

**A2. `GET /api/products` scopes** (`src/app/api/products/route.ts`). The existing store-scoped path is generalised. A scope yields a map *product → quantity here*; the path then lists only products above zero, replaces `currentStock` with that quantity, and sorts, ranges and applies Low Stock on it in code, exactly as the store path does today.

| Parameter | Scope | Quantity |
|---|---|---|
| `storeId` | unchanged | SUM(`StockLevel`) over the store's active warehouses |
| `warehouseId` (new) | one active location; unknown or inactive → 400 | that location's `StockLevel.quantity` |
| `binId` | **changed to "physically in this bin"** (R3); unknown bin → 400 | `getBinQtyMap(binId)` |
| `warehouseId` + `binId=none` (new) | stock at the location in no bin (Q1) | the `noBin` figure of A1 |

- A `binId` must belong to the given `warehouseId` when both are sent; a mismatch → 400.
- `productInBinWhere` stays exported. The Needs-details filter's `productHasNoBinWhere` is untouched.

**A3. The split per scope.** `conditionByProduct` gains `{ warehouseId }` and `{ binId }` options beside `{ storeId }`. Under a bin, the assembled and not-assembled counts are of the units in that bin.

### Part B — the `/stock` screen

**B1. The pickers.** The Store and "Bin / Location" pickers are replaced by two searchable pickers (`SearchableSelect`, the same as Brand):

- **Location:** "All locations", then for each store "<store> · all locations", then its locations, e.g. "Bch store · Shop floor" and "Bch warehouse · Godown".
- **Bin:** disabled until a single location is chosen. It offers "No bin (6 items)" first, then the location's bins with their counts ("L3 · Rack 3 — 2 products · 9 items"), empty bins last.
- Changing the location clears the bin.

**B2. The address bar.** `warehouseId`, `binId` and `storeId` are read once as the initial state, as `storeId` is today. A change rewrites the URL with `router.replace`.

**B3. The caption under the pickers** says what the numbers are, e.g. "Showing what Bch warehouse › L3 holds. Quantities are that bin's." The Stock column header is unchanged.

**B4. Rows.** These are the same rows, ⋮ menu and sheets as today; only the numbers come from the scope (R4). Export reuses the parameters (Q5).

**B5. Bins load from A1**, not `GET /api/bins`, so the pickers work for every role with `stock.view` (R5). A failed load says so under the picker ("Could not load bins") and logs. It is never an empty list with no explanation.

### RBAC, schema, logging

- **No schema change and no migration.** No new permission: A1 and A2 are `stock.view`.
- **Logging:** A1 is scoped `stock:locations`; it logs counts at debug and the failure at error. The products route's scoped-list debug line gains the scope kind and id. The page logs a failed picker load at error. Ids and counts only.
- **Consulted before build:** inventory consultant and warehouse consultant (bins, what a location holds), database architect (the grouped queries), backend engineer (A1, A2 guards and 400s), frontend engineer (pickers, URL state, 375 px).

---

## 4. Verification

1. `npm run build` passes; `tsc` is clean; `eslint` shows 0 errors on the changed files.
2. **Locally, against a restore of production**, with the database URL passed explicitly. Never `.env`, which points at production today.
   - As ADMIN, and as a throwaway role with only `stock.view`: both pickers load.
   - **Bch warehouse** → the Bin picker lists only its 10 bins. **L3** → E CYCLE E2R ROSSO GRY **7** and ROSSO RED **2**, with Stock showing 7 and 2.
   - **Bch store › E CYCLE** → Doodle V4 Military Blue shows **3**, not 9. **Bch store › No bin** → Doodle V4 shows **6**.
   - A product whose home bin is X but whose stock is elsewhere is **not** listed under X.
   - **Bch store · all locations** gives the same list as the old Store scope.
   - Export under a bin has the bin's quantities.
   - Changing the location clears the bin. A refresh keeps the choice.
   - An unknown `warehouseId` or `binId`, or a bin of another location, is answered 400.
3. The page at 375 px and on a desktop: the pickers fit, and the menu and sheets work under a scope.

---

## 6. Build record — 14 Oct 2026

Built on `feat/1410-stock-location-bin`, from `origin/main` @ `f93ec68`.

**Built.**

- **A1:** `GET /api/stock/locations` (`src/app/api/stock/locations/route.ts`, `stock.view`), from the new `getWarehouseHoldings` in `src/lib/units/bin-qty.ts`.
- **A2:** `GET /api/products` takes `warehouseId`, a physical `binId` and `binId=none`, through one scoped path (`scopedQuantities`), and refuses a bad id with a 400 that names it.
- **A3:** `UnitScope` in `src/lib/stock-condition.ts`; `conditionByProduct` and `hasNoAssemblyUnitsWhere` take it.
- **B1–B5:** on `/stock`:
  - the Location and Bin pickers (`_components/use-stock-locations.ts` feeds them)
  - the scope kept in the URL
  - the scope caption
  - picker counts that reload after Add stock, a deactivate or restore, a bulk assign, or a Zoho import
  - export names that carry the scope

**Different from §3, each deliberate:**

| Where | §3 said | Built | Why |
|---|---|---|---|
| A1 | counts per bin and location | **ACTIVE products only** | The list opens on ACTIVE (every chip but Inactive sends `status=ACTIVE`). Counting a deactivated product that still holds stock made a bin's count larger than its list (review finding 2). |
| A1 | the `getWarehouseBinQty` rule | Units are placed by their **bin's** warehouse, as `getBinQtyMap` places them. The "never had a unit" lookup is a `groupBy` that skips products with live units. | The picker equals the list by construction. `distinct` made Prisma fetch every unit row, sold history included (review finding 3). |
| B1 | the label "Bch store · Shop floor" | The label is the location's name; the kind is in the hint ("Shop floor · 4,197 items · 13 bins"). | Shorter labels fit 375 px. |
| B1, Q2 | an "All locations" option | It is the placeholder, reached with the picker's clear (×). | That is how `SearchableSelect` expresses "none chosen". |
| B2 | `router.replace` | `window.history.replaceState` | It is how the page already writes `?sort=`; a filter is not a navigation. |
| B3 | a caption under the pickers | A caption **above the list**, outside the Filters panel. A link to a location or bin that no longer exists says so in red. | The panel opens closed, so a refreshed or shared link showed a bin's quantities with nothing saying so (review finding 1). |
| — | — | A successful load clears the error banner. A failed picker load offers Retry. At 375 px each picker takes a full row. | Review findings 5, 6 and 9. |

**Checks run.**

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `eslint` on the six changed source files | 0 errors. 2 warnings in `page.tsx` (`session` unused, `toggleSelect`'s ternary) were on `main` already. |
| `npm run build` (local database) | exit 0; `ƒ /api/stock/locations` listed |
| End-to-end, local app `:3100` + `bch_dev_1210` (12 Oct restore), ADMIN and a throwaway `stock.view`-only role | **All pass:**<br>• all 23 bins' counts equal SQL<br>• both locations: bins + No bin = StockLevel (Bch store 4,178 + 19 = 4,197; Bch warehouse 295 + 0)<br>• every stocked bin's list equals SQL with 0 differences, and the condition split equals its live units<br>• 12 products whose home bin points at a bin where they hold nothing are **not** listed there<br>• the store scope is unchanged<br>• every 400<br>• the `stock.view`-only role gets `/api/bins` 403 but the pickers 200<br>• sorting and chips work under a scope<br>The throwaway accounts were deleted. |
| Re-run after the review fixes (same setup) | **All pass:**<br>• all 27 picker figures equal SQL counting ACTIVE products only (23 bins, 2 location totals, 2 No-bin totals)<br>• **picker = list on all 14 scopes** (each location, each No bin, 10 stocked bins), for both roles<br>• deactivating SKU 9173 moved Bch store 114/4,197 → 113/4,190, No bin 11/19 → 10/15 and E CYCLE 38/47 → 37/44 exactly; the Inactive list still showed it; restoring it gave a byte-identical response<br>• `/stock` returns 200, with no errors in the log<br>The product's status was restored and the throwaway accounts were deleted. |

The 12 Oct data differs from §4's production examples: L3 is empty there, and Doodle V4 (7002) is E CYCLE 3 + No bin 4. That is when the data was taken, not the code.

**Not exercised by the local data:**
- the typed-in `BinStock` fallback (no never-coded product has a bin quantity)
- the "not in this store" 400s (there is one store)
- Low Stock actually filtering (no active product has a reorder level)

**Board consulted** (independent review, read against CLAUDE.md):
- **Inventory consultant:** raised that Low under a bin compares a bin's quantity with the product's reorder level, so it can show Low for stock held elsewhere. Kept per Q6 and raised with the owner.
- **Warehouse consultant:** nothing. The "No bin" choice serves "every item has a home".
- **Database architect:** the query cost, fixed as above. The raw SQL is parameterised and indexed.
- **Backend engineer:** nothing. Its role allow-list example is stale; CLAUDE.md wins.
- **Frontend engineer:** the caption, the banner, Retry and 375 px, all fixed. Its raw `fetch().json()` example is stale. `page.tsx` is 1,364 lines against its 300-line guide; it was not split here.

**Left as found:**
- The bulk "assign bin" sheet on `/stock` still lists bins from the admin-only `GET /api/bins`. It is empty for the three non-admin roles, and that was already so before this plan.
- `productInBinWhere` has no callers now. It is kept exported, as §3 said.

**Release:** no migration, no permission change. PR into `main`, Deploy to VPS, then merge into `test`.

## 5. Out of scope, deliberately

- **The transfer line's "Stock: 9" total.** The transfer screen shows the product's overall total instead of the source location's; that is a separate small fix, offered on 14 Oct.
- **The admin Bins screen's drawer** lists coded units only, so stock without codes is missing there. Not changed here.
- **Moving stock into a bin from `/stock`.** "No bin" stock is shown, not fixed, here.

---

## 7. Changes after the first build — 14 Oct 2026

### 7.1 The owner's words, verbatim

> see the '/Users/chethanr/Projects/BCH/bike-inventory/Screenshot 2026-10-14 at 5.06.20 PM.png' fix this where the fileter miust have the warehouse to it must show the warehosue of selected store and  on selecting the ware i need to see the warehouse level bin and on selcting the bin i need u to  list the bin levle products

The screenshot is `localhost:3000/stock` on `main`'s code. That screen has the old Store picker and a flat "Bin / Location" list of all 23 bins, and it does not have this branch.

### 7.2 Restated

| # | Requirement |
|---|---|
| C1 | The filter has a **Warehouse** picker, and it lists only the **selected store's** warehouses. |
| C2 | Choosing a warehouse makes the **Bin** picker list only that warehouse's bins. |
| C3 | Choosing a bin lists only that bin's products. |

### 7.3 Built

- **C1:** the single Location picker (B1) is replaced by three pickers in their own row: **Store**, then **Warehouse** (that store's warehouses only), then **Bin** (that warehouse's bins only).
  - Each picker is disabled until the one before it has a choice: "Choose a store first", "Choose a warehouse first".
  - Changing a level clears the levels after it.
  - On a phone the three stack; from `sm` up they sit in one row.
  - A link that names only a warehouse still shows its store in the Store picker.
  - A link whose store and warehouse don't belong together is shown as "no longer exists".
- **C2, C3:** the same Bin picker and bin scope as §3: "No bin" first, then bins with what they hold now. The list shows what is physically in the chosen bin.
- **The request sends the narrowest level chosen:** `warehouseId` (+ `binId`) when a warehouse is chosen, otherwise `storeId`. A store alone is the store scope of plan 0909, as before. No API change.
- **Wording:** the caption and exports say "warehouse" where they said "location", e.g. "Showing what Bch warehouse holds. Quantities are that warehouse's."

### 7.4 Checks — 14 Oct 2026

- `tsc` is clean, `eslint` shows 0 errors (the same 2 warnings that were already on `main`), and `npm run build` exits 0.
- The API and its parameters are unchanged, so the end-to-end results in §6 stand: picker = list on all 14 scopes.
- Not run: a signed-in browser pass, because there is no browser in this session.

## 8. Released — 14 Oct 2026

- The owner, 14 Oct 2026: *"Okay, I need you to merge it to the main branch and deploy the thing. Yeah."*
- **PR #84** merged into `main` as `d93da76`, carrying §6 and the §7 Store → Warehouse → Bin filter.
- **Deploy to VPS** run `38561471706` succeeded. The migrate job found nothing to apply.
- `main` was merged into `test` as `9dd7d3c`, through PR #85 for CI. The plans README conflicted (both sides added rows) and both sides were kept.
- **Open for the owner:**
  - the signed-in browser pass on bicyclecare.in
  - whether "Low" should be hidden under a bin or No-bin scope (§6, inventory consultant). Today it compares a bin's quantity with the product's overall reorder level.
