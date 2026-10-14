# Add stock directly from /stock — a quantity, assembled or not, a reason; no stock audit

Status: completed — 14 Oct 2026, released: PR #79 merged into `main` at the owner's instruction (this feature alone; `test` was not merged), then deployed to the VPS by hand from `main` (§6). No migration. Left for the owner: the browser pass (§4.3), granting `inventory_adjustments.create` beyond ADMIN, and merging this branch into `test` (Branch line). **§7 follow-up, 14 Oct 2026:** the ⋮ row menu, the product's own bin read-only, no bin = no add, and the unclipped sheet footer — to `main` by its own PR from `feat/1410-stock-row-menu` (§7.5).
Branch: **`feat/1410-stock-quick-add`** — off `origin/main` @ `e3b20bc` (owner: "it has to have a code of main branch", needed immediately). It goes to `main` by PR without the features waiting on `test`, and is merged into `test` afterwards so the two do not drift. The same branch already holds the `/stock` table fix (scrolling table, a table at every width, page numbers — 14 Oct, uncommitted).

Every `file:line` below was read from disk on 14 Oct 2026 at `e3b20bc`.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (14 Oct 2026)

> https://bicyclecare.in/stock
>
> Okay, check this out. I need you to switch to a branch where it has to be having the code of main branch, not the test branch. It has to have a code of main branch. Okay. I need you to switch it respected to that and I have a requirement over there where in the given path we list the stocks we list the items products and I need a functionality where I can have a need a functionality or action where I can handle it like I think that I have a product of GT lock and if I have that product right and I need to update the product stock and I don't want to do it from stock audit where I can directly think that I have a product of GT locks it has a product of 599 if I need to increment the stock i should be able to do it like be able to add it normal it should be able to add it like normal like give me take the input from the user and add it means it should take is it an assembly or a non assembled one assembled or non assembled if the bin respect of the product is under unassemblable I think we don't need to ask for the assembly or non-assemblable so it's just that we can just add the product directly from the slash stocks this is my requirement go through this requirement and tell me your implementation plan how do you implement it and ask me any doubts if you have regarding the application and what I will be doing is that when you take the reference of the main branch right I will be this is an other feature which is needed immediately so all the features that are updated in the test won't be included in it so only I am telling you that I will have a reference of main branch

### 0.2 Restated as requirements

1. **R1** — The work is on a branch made from **`main`**, not `test`. None of the features waiting on `test` are included.
2. **R2** — On `/stock`, an action on a product **adds stock directly** — e.g. GT lock at 599, add 5 → 604 — **without a stock audit**.
3. **R3** — It takes the person's input: the quantity, and **whether the units are assembled or not assembled**.
4. **R4** — When the product's bin is **non-assemblable**, the assembled question is **not asked**.

---

## 1. Questions and clarifications

### 1.1 Decisions on record (14 Oct 2026)

| # | Question | Answer | What it does |
|---|---|---|---|
| Q1 | Who may add stock directly? | **A separate permission**: the existing, unused `inventory_adjustments.create` | Admin has it; other roles get it on `/team/permissions`. The button and the route check the same permission. |
| Q2 | A product whose stock has no unit codes yet (GT lock at 599, no codes)? | **Add without codes, and show the count without codes** | "+5" makes 604 and creates no codes, so the bin still shows 604, not 5. The stock row and the bin view show "604 without codes". Codes for the whole bin come later from a stock audit. |
| Q3 | Assembled vs not assembled in a normal bin? | **Split by number**: "assembled __" + "not assembled __" = the quantity | Not-assembled units appear in the assembly queue by themselves. |
| Q4 | How is it recorded? | **As a stock adjustment, with a reason required** | It is not a purchase, so it does not inflate the "stock in" movement report. |
| — | Go-ahead ("go ahead and build it with related recommended things") | Build, plus the recommendation from the table fix: **Excel / PDF export and the Low Stock chip cover every product**, not just the 100 on the current page. |

Defaults taken without asking (each reversible):

- **The bin.** The product's home bin is pre-selected and can be changed to another active bin. The bin decides the warehouse. A product with no bin must have one picked, and that bin becomes its home bin (the stock-audit rule, `assign-product-bin.ts:15-29`).
- **The home-bin rule lock** (`src/lib/inbound/rule-bin.ts`) is respected: a product locked to a rule bin offers only that bin. This is the inbound behaviour.
- **No approval step** — the owner asked for "directly". The permission is the gate, and the trail is the ledger row, the activity log and the bin movement, all naming the person and the reason.
- **No Zoho write.** The app never pushes stock quantities (`src/lib/integrations` — only reads of `stock_on_hand`).

---

## 2. How it works today — verified

- **The truth is per warehouse.** `StockLevel` holds one row per product and warehouse (`schema.prisma:645-663`). `Product.currentStock` (`:586`) is its cached sum, recomputed by `adjustWarehouseQty` (`src/lib/stock-location.ts:49-63`, `:21-31`). It must never be written directly: that was the R12 bug (`stock-location.ts:68-79`) and the reason `db:repair:stock-total` exists.
- **Units.** `InventoryUnit` is one row per physical item, coded `U-000481` (`schema.prisma:785-854`). An assembled unit has `assembledAt` set; an unassembled one is in the assembly queue by query (`api/assembly/tasks/route.ts:226-233`).
  - `createUnits` (`src/lib/units/create.ts:31-100`) makes them in a bin and calls `syncBinStock`. It takes codes from the locked counter (`src/lib/sequence.ts:123-147`), so it must run inside the same transaction as the stock write.
- **Non-assemblable** is a flag on the bin, `Bin.nonAssemblable` (`schema.prisma:724-728`), set only at creation. A unit entering such a bin is stamped (`create.ts:34-45, 61`), and the audit forces such a bin to "unassembled, no assembly" (`apply-bin-line.ts:11, 48-49`). **R4 is the same rule.**
- **Bin counts.** For a product with any units, the bin count is the number of live units in it (`src/lib/units/bin-stock.ts:7-16, 38-74`). For a product with no units anywhere, `BinStock.quantity` keeps the typed figure. **This is why Q2 matters:** coding only the 5 new units of an uncoded product would turn its bin from 604 into 5.
- **No direct add exists.** Stock rises only through inbound receive (`api/inbound/[id]/route.ts` PUT, the cleanest pattern, `:245-447`), Zoho inward verify, stock-audit apply, and transfer receive.
- **The ledger** is `InventoryTransaction` (`schema.prisma:993-1027`), with types `INWARD OUTWARD TRANSFER ADJUSTMENT` (`:126-131`). It has **no warehouse column and no reason column** — both go in `notes` (`src/lib/transfers/stock.ts:105-106`). The movement report counts only INWARD and OUTWARD (`api/reports/movement/route.ts:28-35`).
- **The /stock screen** (`page.tsx`, 1,066 lines; `stock-table.tsx`) has row actions for reorder, assembly level and deactivate — no stock action. It gets per-product unit counts (`assembledUnits` / `unassembledUnits` / `noAssemblyUnits`, `api/products/route.ts:231-242`). The list's bin select has no `nonAssemblable` or `warehouseId` (`:147`).
- **The permission** `inventory_adjustments` exists with view/create/edit/approve and is used by no route (`prisma/rbac-catalog.ts:308-316`).
- **Concurrency.** `adjustWarehouseQty` reads and then writes an absolute value (`stock-location.ts:52-61`), so two adds at once could lose one. Every existing raising path claims a row first; a quick add has none to claim.

---

## 3. Implementation plan

### Part A — the route `POST /api/products/[id]/add-stock`

- **Guard:** `requireFeature("inventory_adjustments", "create")`.
- **Body** (zod, `src/lib/validations.ts`):
  `{ binId, assembled: int ≥ 0, unassembled: int ≥ 0, reason: string 3–300, requestId: uuid }`
  - The quantity is `assembled + unassembled`, 1–5,000.
  - In a non-assemblable bin `assembled` must be 0.
- **Checks before the transaction** (400 with a sentence):
  - the product exists and is active;
  - the bin exists, is active, and its warehouse is active;
  - the home-bin rule lock;
  - for an **uncoded** product, the split is not asked: the whole quantity is "not assembled", and no codes are made.
- **One `$transaction`**, timeout 30 s:
  1. **Lock and dedupe.**
     - `SELECT … FOR UPDATE` on the product's `StockLevel` row for that warehouse, creating it first if missing, so two adds at once queue up.
     - The `requestId` is written into the ledger row's `referenceNo` as `QA-<requestId>`. A row already carrying it means a double tap: answer the first result, change nothing.
  2. `adjustWarehouseQty(tx, productId, warehouseId, +qty)`. The shown total recomputes.
  3. **Units, only if the product already has unit codes anywhere** (Q2):
     - `createUnits` in the bin for `assembled` (as ASSEMBLED) and `unassembled` (as not assembled) — non-assemblable bins stamp them automatically;
     - `sourceTransactionId` points at the ledger row, so an undo can retire exactly these;
     - **no `AssemblyLog`** — that feeds mechanic pay.

     Otherwise, `BinStock` for that bin goes up by the quantity.
  4. **The ledger row:**
     - `InventoryTransaction { type: "ADJUSTMENT", quantity, previousStock, newStock, referenceNo: QA-…, userId }`;
     - `notes`: `[QUICK_ADD] +5 to Bch warehouse / bin B-12 (3 assembled, 2 not) — <reason>` — a new tag, no existing one reused;
     - the product page's history labels it "Adjust" (`stock/[id]/page.tsx:117-126`).
  5. A `BinMovementLog` "Quick add".
  6. The product's home bin is set if it had none.
  7. `logActivity(tx, { module: "inventory_adjustments", action: "stock_added", … })`.
- **No `ApprovalEvent`.** A `CORRECTED` event would count against the last inbound approver (`api/approvals/error-rate/route.ts`).
- **No notification.** An add never crosses below the reorder level.
- **Logger** `stock:quick-add`: `info` `{ productId, warehouseId, binId, qty, coded, userId }`; `warn` on every refusal; `error` in the catch.

### Part B — the screen

- **On `/stock`**, each row's actions gain **"Add stock"**, shown with `canCreate("inventory_adjustments")`. It opens a sheet (`_components/add-stock-sheet.tsx`, new):
  - the product, its current stock, and its home bin (a select of active bins, from `/api/bins`, which already returns `nonAssemblable`);
  - **assembled __ / not assembled __** — hidden for a non-assemblable bin and for an uncoded product, where it becomes one **quantity __**;
  - **reason** (required);
  - a preview line: "599 → 604 in Bch warehouse · 5 new unit codes";
  - **Add**, disabled while busy.
  - On success the row refreshes in place, keeping the current page of the new pagination, and a line says what was added.
- **"Without codes" (Q2):**
  - the Stock column shows "604 · 604 without codes" when `currentStock` exceeds the product's live units — computed from the unit counts the list already loads, no new query;
  - `/stock/by-bin` shows the same per bin (`BinStock.quantity` minus live units in that bin).
- The `/api/products` bin select gains `warehouseId` and `nonAssemblable`.

### RBAC, schema, logging

- **No migration.** No new column: the reason and the warehouse live in `notes`, as on every other path.
- **RBAC:** the catalog description of `inventory_adjustments` gains "add stock directly from /stock". Data, not a migration — run **`npm run db:seed:rbac`** after the deploy, then grant `inventory_adjustments.create` on `/team/permissions` to whoever should add stock.
- **Board of agents:**
  - **inventory-consultant:** its first rule, "Never estimate stock — count it", is relaxed by the owner's explicit ask. A reason is required, and every add is logged with the person.
  - **warehouse-consultant:** bins and warehouses as on inbound.
  - **backend-engineer:** zod, the transaction, the lock, the idempotency key.
  - **frontend-engineer:** the sheet, at 375 px.

---

## 4. Verification

1. `npm run build` passes.
2. **Locally, against a restore** (the URL passed explicitly):
   - **A coded bicycle** in a normal bin, 2 assembled + 3 not:
     - stock +5;
     - 5 new codes, 2 ASSEMBLED and 3 in the assembly queue;
     - the bin count +5;
     - one ADJUSTMENT row `[QUICK_ADD]` with the reason.
   - **A product in a non-assemblable bin:** no split is asked, and 5 units are stamped "no assembly".
   - **An uncoded product at 599:**
     - +5 → 604;
     - no codes, and the bin count is 604, not 5;
     - the row shows "604 without codes".
   - **The same `requestId` twice:** one add.
   - **Two different adds at the same moment:** both land (+10).
   - **A user without `inventory_adjustments.create`:** no button, and the API answers 403.
   - **A product locked to a rule bin:** another bin is refused.
3. The page, at 375 px and on a desktop.

---

## 5. Out of scope

- **Removing stock** from `/stock` (write-offs, damage). That belongs to the same `inventory_adjustments` module, but was not asked.
- **Giving codes to an uncoded product's existing stock.** The stock audit does that.
- **An approval step** before the add applies.
- **The features waiting on `test`** (R1).

---

## 6. Build record — 14 Oct 2026

On `feat/1410-stock-quick-add`, from `origin/main` @ `e3b20bc`.

**Built.**

- **The route** `src/app/api/products/[id]/add-stock/route.ts` (GET for the sheet, POST to add), guarded by `inventory_adjustments.create`:
  - one transaction holding a `FOR UPDATE` lock on the product's `StockLevel` row for that warehouse;
  - the `QA-<requestId>` reference, which turns a double tap into a no-op;
  - stock through `adjustWarehouseQty`;
  - units through `createUnits` for tracked products, or a `BinStock` increment for untracked ones;
  - the ledger row `ADJUSTMENT [QUICK_ADD]`, a `BinMovementLog` and `logActivity`.
- **Supporting changes:**
  - zod `quickAddStockSchema` in `validations.ts`;
  - the catalog description of `inventory_adjustments` updated;
  - the activity feed labels the module "Stock".
- **On `/stock`:**
  - an **Add stock** row action and its sheet (`_components/add-stock-sheet.tsx`);
  - "N without codes" under the stock figure;
  - the **Low Stock chip** is a server-side filter (`lowStock=1` on `/api/products`, the `isLowStock` rule, noted in `src/lib/reorder.ts`);
  - **export pages through every matching product**, 500 at a time, stopping at 10,000 with a sentence.
- **On `/stock/by-bin`:** a "Stock without unit codes" section per warehouse.
- **Already on the branch:** the `/stock` table fix — a scrolling table, a table at every width, 100 rows per page.

**Checks run:**

- `npx tsc --noEmit` is clean.
- `eslint` on the changed files: 0 errors (2 warnings in `page.tsx` that were already there).
- `npm run build` exits 0.
- **23 end-to-end checks** on localhost against the local database — all passed, and every seeded row was deleted:
  - the GET context, both tracked and untracked;
  - a coded cycle, 2 assembled + 3 not → +5, 5 codes, the bin recounted to 6, a `[QUICK_ADD]` ledger row naming the warehouse, bin, split and reason, the units linked to that row, and no `AssemblyLog`;
  - a non-assemblable bin refuses an assembled figure, and +2 is stamped "no assembly";
  - **GT lock 599 +5 → 604, no codes, and the bin reads 604, not 5**;
  - the same `requestId` twice → added once;
  - **two adds at the same moment (+7, +3) → 614, none lost**;
  - the refusals: a short reason, quantity 0, an unknown bin;
  - activity rows written, and none for the double tap.
- **Smoke tests:** `lowStock=1`, a 500-row export page, `/api/stock/by-bin` with the new figures, and `/stock` and `/stock/by-bin` answer 200. No errors in the server log.

**Not run:** the signed-in browser pass at 375 px.

**Release.**

- **No migration.**
- `inventory_adjustments.create` already exists in production's catalog, and ADMIN holds it. Grant it on `/team/permissions` to anyone else who should add stock.
- `npm run db:seed:rbac` only refreshes the module's description text, so it is optional.

**Released — 14 Oct 2026.**

- The owner, 14 Oct 2026: *"no dont mege the test  to main i need u to merge the two feature  that were developed from the reference of main i need those implmentaton to direcly merge with the main branch"*. Of the four branches cut from `main`, the owner chose this one alone. `test` → `main` was not merged, and the expenses feature, the `.gitignore` change and PR #76 stay where they are.
- PR #79 merged into `main` (a merge commit); its Type check and Build passed.
- Deployed by hand: Actions ▸ Deploy to VPS ▸ `main`. No migration, so the migrate job finds nothing to apply.
- Not done here: the browser pass, the grant, and merging this branch into `test`.

## 7. Changes after the first build — 14 Oct 2026

### 7.1 The owner's words, verbatim

> And I need you to update the related actions button in the stock listing where I let it have three dots on pressing that we can get the related actions button.

> in this add stock thing it must show the product reladed bin not all bin it should show and that bin  must be only readabel  and fix the model ui whhere  the bottom teo buttom

Answers the same day: a product with no bin — *"no bin means ther cant be add stock the add stock action must not happen"*; the clipped footer — fix the shared rule (all sheets).

### 7.2 Restated

| # | Requirement |
|---|---|
| C1 | Each `/stock` row's actions sit behind one ⋮ button that opens a menu (Add stock, Reorder settings, Assembly level, Deactivate / Restore — same permissions as before). |
| C2 | Add stock shows the product's OWN bin, read-only — not a list of all bins. |
| C3 | A product with no bin cannot take stock: the add does not happen. |
| C4 | The sheet's Cancel / Add buttons are no longer clipped at the bottom. |

### 7.3 Built

- **C1** — `stock/_components/stock-row-menu.tsx` (new), `stock-table.tsx`. Opening or choosing never opens the product; the menu sits above the table's scroll box and opens upward near the bottom; Escape / outside tap / Tab / resize / the row scrolling away close it; arrow keys, Home and End move through it.
- **C2, C3** — `src/lib/stock/add-stock-bin.ts` (new) decides the bin once, for the GET and the POST alike: a home-bin rule's bin in the home bin's warehouse (the rule wins, as on inbound), else the home bin when it and its warehouse are active; with no home bin, the rule's bin when rules place the product in exactly one warehouse. Anything else is "no bin": the GET returns `bin: null` with the reason, the sheet shows that reason and no quantity, reason or Add; the POST answers 409 with the same reason, and 409 for any `binId` other than the product's bin. The GET no longer lists every bin (`bins`, `ruleBins` are gone from its answer). The refusal names the way out: Edit → Bin on the product's page, or a home-bin rule. Local data, 14 Oct: 187 active products have a home bin, 563 more get one from a rule, 5,052 have neither and so cannot take stock this way until they are given one.
- **C4** — the cause was the shared `.pb-safe` rule (`globals.css`): `padding-bottom: env(safe-area-inset-bottom)` is 0 on a desktop and on phones without a home bar, and, being un-layered, it overrode each footer's own `p-4`. Now `max(1rem, env(…))`. Fixes the same clipping on all 13 users of the class; iPhones with a home bar are unchanged.

### 7.4 Checks — 14 Oct 2026

`tsc` clean; `eslint` 0 errors on the changed files; `npm run build` passes. Against the local database on `:3100`: a new 18-check run (one bin in the GET and no list; rule over home bin; rule-only product; no bin and inactive bin refused with a reason and nothing written; any other bin 409; non-assemblable home bin) and the original suite, updated for the three checks that assumed a picker (concurrency, double tap and refusals unchanged) — all pass, all cleaned up. Headless Chrome at 1280 and 390 px: no bin picker, the bin shown read-only, the no-bin product shows only the reason and a disabled Add, and 16–17 px clear below the footer buttons (0 before).

### 7.5 Released — 14 Oct 2026

- The owner, 14 Oct 2026: *"for the main branch related to the action of 3 dot related think is in local but not in the product i need u to merge that in to the main branch"*.
- These changes were built uncommitted on `feat/1410-fetch-permissions`. They reached `main` on their own branch, `feat/1410-stock-row-menu`, cut from `main` @ `144a3bd` after PR #80. The six files are copied unchanged; their base on `main` matched byte for byte.
- No migration and no permission change. It is deployed with the next Deploy to VPS from `main`.
