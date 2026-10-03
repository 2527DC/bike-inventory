# Bins can be deleted when empty; a home-bin rule takes many categories; transfers run Floor/Godown in four directions

Status: in-progress — Parts A–D built 3 Oct 2026, tsc + eslint + `npm run build` green; migration applied to the `.env` database; pushed and merged by PR on the owner's instruction without the §4 browser walk, which is still owed (§6).
Branch: **`feat/0310-bins-rules-transfer-directions`** — create it with exactly this name, off `main`.

Every `file:line` below was read from disk on 3 Oct 2026 on `feat/stock-zoho-fetch-active-products`
(`2fa61af`). Check rather than trust.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (3 Oct 2026)

> in this applicaton  i need the delete option for the bin after creation of  the validation are like if the bin has any  linked item then it must not be deleted it should only be delted if there is no items in the bin and  so that they must move the items form the  bin to another one to delete it and the home bin rule that we apply  for this at the bin wh er i must be able to selet multiple category  in the home bin rule I must  multi category section for home rule at once in one rule creation and in the https://bike-inventory-delta.vercel.app/transfers/new i have  only  store to   store and warehouse to store   i need warehouse to warehouse and warehouse to store storck tarnsfer too and  another one is  ie make it as flore to gowdon ,  gowdon to  flore , flore to flore , , gowdown to flore   and while adding the bin rule make the brand like searchable like category  ie home bin rule

> if u have any questions related to it ask me i will clear it out

The owner's answers to the questions, the same day, are in §1.1.

### 0.2 Restated as requirements

1. **R1** — On `/bins`, an existing bin has a **Delete** option.
2. **R2** — A bin that holds **any item** cannot be deleted. The refusal says what is still in it.
3. **R3** — A bin that holds **no items** can be deleted.
4. **R4** — To delete a bin with items, staff **move the items to another bin first**, so moving a bin's contents out has to work.
5. **R5** — Creating a home-bin rule lets you **select multiple categories at once**: one brand, one bin and many categories, saved in one go.
6. **R6** — The home-bin rule's **Brand** field is **searchable**, like the Category field.
7. **R7** — `/transfers/new` offers four directions: **Floor → Godown, Godown → Floor, Floor → Floor, Godown → Godown**. These replace today's "Store → Store" and "Store → Warehouse" buttons. (The owner wrote "gowdown to flore" twice; Q6 confirmed the fourth direction is Godown → Godown.)

**Follow-up, after PR #70 was merged (3 Oct 2026), verbatim:**

> i need it like when it form transfer the user select what type of transfer and i need to see the respected like if its flore to gowdowen then it must list all the flores in the left side and which must show which storr does it belongs to and in the right side respectde gowdon w hich also show the name of it and it store i need it like that

> i need u to chnage the name in the ui that is what we have like floor as hub in the ui in the stock transfer do this change and push to git and create a pr and merge it

8. **R8** — Each side of the transfer route is **one list of every warehouse of the kind the direction needs, across all stores**, and each entry shows its **store**. Hub → Godown lists every hub on the left and every godown on the right. The store-then-warehouse two-step goes.
9. **R9** — On the stock transfer screens a FLOOR warehouse is called a **Hub** ("Hub → Godown", "From (hub)"). Wording only: the stored kind and enum stay `FLOOR`, and warehouse names (e.g. "BCH Floor") are data, renamed on `/stores` if wanted.

---

## 1. Questions and clarifications

| # | Req | Question | Why it changes the build | Options | Default | Answer |
|---|---|---|---|---|---|---|
| Q1 | R2 | Items always block a delete. What about home-bin rules that point at the bin? | Inbound would keep suggesting a deleted bin | block until moved / delete the rules too / block on every link | block | **delete its rules too**; products whose default bin it is are cleared |
| Q2 | R4 | Fix the bin's **Move Out** so it moves **everything** in one go? (It is broken today, §2.2) | One move vs one per bike | all at once / one at a time | all at once | **all at once** |
| Q3 | R1 | Can a deleted bin's code be used again? | `@@unique([warehouseId, code])` keeps the retired row | reusable / retired forever | reusable | **reusable**: creating that code again brings the row back with the new details |
| Q4 | R5 | How does the multi-category picker work? | Component shape | one searchable checklist / pick a parent, tick children | checklist | **one searchable checklist** of every subcategory, with full paths |
| Q5 | R5 | A ticked brand + category pair already points to another bin | Overwrite or skip | re-point and report / skip and report | re-point | **re-point, then say so** ("3 created, 1 moved from A2") |
| Q6 | R7 | Can the two sides of a transfer be in different stores? | Which pickers the form shows | any store, all four / floor↔godown same-store only | any store | **any store, all four directions** |
| Q7 | R7 | Which document travels with each direction? | Dispatch is gated on it | by store / Floor→Floor invoice only / no document within a store | by store | **by store**: different stores → **tax invoice**; same store → **delivery challan** |
| Q8 | R7 | `/transfers/new` cannot create any transfer today (§2.4.1). How is that fixed? | Without a fix, R7 ships a screen that cannot create anything | bin pickers now / drop the bin requirement / separately | bin pickers | **add bin pickers now**: Phase 1 of `pending/2209-transfer-and-outward-by-bin-plan.md`, built here as Part C |
| Q9 | R2 | What counts as "an item in the bin"? | Defines the delete check | — | **live units** (`LIVE_UNIT_STATUSES`), **loose quantity > 0** of uncoded products, **second-hand cycles `IN_STOCK`**. Sold, lost or in-transit units that still carry the old `binId` **do not count**, and neither do 0-quantity rows | *confirm* |
| Q10 | R2 | An **unfinished stock audit** of the bin (`PENDING` / `IN_PROGRESS` / `COMPLETED`, not yet approved or rejected) | Approving an audit writes units and product bins into its bin (plans 2109 R33, 2209) | block / allow | **block**: "finish or reject SC-… first" | *confirm* |
| Q11 | R2 | The bin Edit form's **Active** checkbox retires a bin with no check at all (§2.1) | It is a second way to delete that skips R2 | remove it / gate it by the same check | **remove it**: Delete becomes the one way to retire a bin, and `PATCH` refuses `isActive: false` | *confirm* |
| Q12 | R7 | Floor → Floor or Godown → Godown **inside one store** needs two warehouses of that kind there | A store with one godown has nothing to send to | — | that combination simply has no destination to offer ("BCH has no other godown"); nothing is invented | *confirm* |
| Q13 | R7 | Transfers raised before this change | History labels | — | keep their old labels ("Store → Store", "Store → Warehouse"). New orders write the four new modes | *confirm* |
| Q14 | Q8 | The 2209 plan's Phase 1 defaults: from-bin lists only bins holding the product, with quantities; to-bin is **locked by the destination's home-bin rule**, otherwise picked; a from-bin holding too few is **refused**, naming the bins that do, and the line can be **split** across bins | Decides the line UI | see 2209 §1 Q1/Q2 | 2209 Q1a, Q2a | *confirm* |

**Note on Q8: read this before approving Part C.** Phase 1 of the 2209 plan makes transfers
*creatable* again and *records* a from-bin and a to-bin on every line. Dispatch still takes
units from any bin of the source warehouse, and receive still lands them with **no bin**
(`src/lib/units/lifecycle.ts:34,38`). Acting on the recorded bins is 2209 Phase 2. It is not
in this plan (§5).

### 1.1 Decisions on record

| Date | Q | Decision |
|---|---|---|
| 3 Oct 2026 | Q1 | Delete its rules too (default-bin links cleared) |
| 3 Oct 2026 | Q2 | Yes, move all at once |
| 3 Oct 2026 | Q3 | Yes, the code is reusable |
| 3 Oct 2026 | Q4 | One searchable checklist |
| 3 Oct 2026 | Q5 | Re-point them, then report |
| 3 Oct 2026 | Q6 | Any store, all four directions |
| 3 Oct 2026 | Q7 | By store: tax invoice between stores, delivery challan within one |
| 3 Oct 2026 | Q8 | Add bin pickers now (2209 Phase 1) |
| 3 Oct 2026 | Q9–Q14 | Defaults accepted with the go-ahead ("is there anything to be confirmed … if not start implementing") |
| 3 Oct 2026 | R8 | The owner skipped the layout questions and asked to build it: lists are **grouped by store** (each option also reads "Warehouse — Store"), and the destination is **not pre-selected** unless it has only one possible warehouse |

---

## 2. How it works today: verified against the code

### 2.1 Deleting a bin

- **There is no Delete button.** `src/components/bins/bins-manager.tsx` imports `Trash2`, but
  uses it only on home-bin rules (`:1934`). The bin card offers Edit and Inspect (`:733-753`),
  and the drawer offers Edit, Move Out and Print labels (`:1451-1499`).
- **The API exists:** `DELETE /api/bins/[id]` (`src/app/api/bins/[id]/route.ts:79-115`), guarded
  by `bins.delete` (`:81`). The action is in the catalog (`prisma/rbac-catalog.ts:225`). It
  soft-deletes (`isActive: false`, `:108`) to keep movement history.
- **Its emptiness check is wrong in both directions** (`:84-104`). It adds up `_count` of
  `products + binStocks + units`:
  - `units` counts **every** unit carrying the `binId`, including sold and lost units. Those
    can keep their old bin (`src/app/api/bins/[id]/inventory/route.ts:30-31`), so an empty bin
    is refused.
  - `binStocks` counts **rows**, and `syncBinStock` leaves 0-quantity rows behind
    (`src/lib/units/bin-stock.ts:38-46`), so an emptied bin is refused.
  - `products` counts products whose **default bin** this is (`Product.binId`,
    `prisma/schema.prisma:604`). That is a pointer, not stock.
  - It does **not** count second-hand cycles (`SecondHandCycle.binId`, `status IN_STOCK`), or
    an unfinished stock audit of the bin (`StockCount.binId`, `schema.prisma:1035`).
- **A second, unchecked way to retire a bin:** the Edit form's **Active** checkbox
  (`bins-manager.tsx:1341-1352`) reaches `PATCH` and is written straight through
  (`[id]/route.ts:58`). A bin holding bikes can be hidden that way.
- **Retired bins are already safe for the readers that matter:** home-bin rules ignore an
  inactive bin (`src/lib/bins/rule-match.ts:94`), inbound receive refuses one
  (`src/app/api/inbound/[id]/route.ts:223`), and so does every placement
  (`src/lib/units/bins.ts:51`). `GET /api/bins` lists active bins only (`src/app/api/bins/route.ts:19`).
- **The code stays taken after a delete:** `POST /api/bins` looks the code up across active and
  inactive rows and answers 409 (`route.ts:51-64`).
- Cascades if a row were ever hard-deleted: `BinStock` and `HomeBinRule` cascade
  (`schema.prisma:755,777`), and units go to SetNull (`:793`). This plan keeps the soft delete.

### 2.2 Moving a bin's items out

- **Move Out is broken.** The drawer's Move Out (`bins-manager.tsx:1463-1473`) sets only the
  source bin. `handleExecuteMove` then sends `unitId: undefined` and no `productId` (`:531-540`),
  and the route refuses: "Either unitId or productId must be provided"
  (`src/app/api/bins/move/route.ts:20`).
- A cancelled **Relocate** leaves `moveUnitId` set, because only a successful move resets it
  (`:547-551`). A later Move Out would then move that one bike.
- The target list is **every** loaded bin except the source (`:1701-1707`), including bins in
  other warehouses, which the route then refuses (`move/route.ts:30-35`).
- **Relocate** (one unit) works through `placeUnitsInBin`, which already accepts many unit ids
  (`src/lib/units/bins.ts:39-43`).

### 2.3 Home-bin rules

- The form is one brand `<select>` (`bins-manager.tsx:1793-1804`, **not searchable**), a root
  category picker (`CategoryTreeSelect`, `mode="roots"`, `:1811-1822`, searchable), a
  subcategory picker when that root has children (`:1826-1848`), and a bin.
- `POST /api/bins/home-rules` (`src/app/api/bins/home-rules/route.ts:92-209`) takes **one**
  category (`subcategoryId` ?? `categoryId`, `:100-103`). It requires a brand and a category
  (`:115-118`) and a **leaf** (active children = 0, `:131-139`). It **re-points** an existing
  identical rule instead of creating a duplicate (`:171-190`). It has no zod schema.
- One brand + category pair per warehouse is one row (`HomeBinRule`, `schema.prisma:766-783`), so
  a multi-category save is N rows. **No schema change is needed.**
- A searchable flat picker already exists: `src/components/ui/searchable-select.tsx`
  (`options: {id,label,hint}`, `:8-26`).

### 2.4 Transfers

#### 2.4.1 The create screen cannot create a transfer (live on production)

- `src/app/(dashboard)/transfers/new/page.tsx:251` sends `{ productId, quantity }` per line,
  with no bins.
- `src/lib/transfers/items.ts:124-130` refuses any line without both `fromBinId` and
  `toBinId`: "Source and destination bins are required". It became unconditional in
  `ce3605d` (21 Sep), which is on `origin/main`.
- The **Edit items** sheet for a RETURNED order has the same defect: it sends no bins
  (`transfers/[id]/_components/edit-items-sheet.tsx:96`) through the same validator
  (`api/transfer-orders/[id]/route.ts:232`).
- Only **Find stock** on an outward still creates transfers. It writes the order directly and
  never calls the validator (`api/deliveries/[id]/find-stock/route.ts:315`).
- This was already written up as the merge blocker of `pending/2209-transfer-and-outward-by-bin-plan.md` §2.1.

#### 2.4.2 Modes

- `enum TransferMode { STORE_TO_STORE, STORE_TO_WAREHOUSE, GODOWN_TO_FLOOR }` (`schema.prisma:2258-2262`).
- The screen offers two (`route-picker.tsx:12,130,139`). The source is always a **store**, and
  it resolves to its floor (`sourceFloor`, `:23-25`; server `resolveStoreWarehouse`,
  `src/lib/transfers/mode.ts:40-63`).
- The server already accepts `GODOWN_TO_FLOOR` (`api/transfer-orders/route.ts:94-99,240-256`).
  The screen never sends it; only Find stock writes it (`find-stock/route.ts:84-90`).
- Document: `docTypeForMode` gives Store → Store a tax invoice and everything else a delivery
  challan (`mode.ts:21-23`). Find stock already behaves "by store": different stores →
  `STORE_TO_STORE` → tax invoice, same store → challan (`find-stock/route.ts:88-89`). Q7's
  answer therefore matches what Find stock does today.
- The detail page labels only the first two modes (`transfers/[id]/page.tsx:35,104-108`), so
  a Find-stock `GODOWN_TO_FLOOR` order already shows the legacy "Within one store" wording.
- Each of `POST /api/transfer-orders`, `POST /api/bins/move` and `POST /api/bins/home-rules`
  has exactly **one** caller: `transfers/new/page.tsx:258`, `bins-manager.tsx:531` and
  `bins-manager.tsx:450`.

---

## 3. Implementation plan

Four parts, one commit each, in the order below. Only Part D has a migration. No RBAC catalog
change: `bins.delete` already exists, and whoever should delete bins needs it granted on
`/team/permissions`.

### Part A: delete a bin (R1–R4, Q1, Q2, Q3, Q9, Q10, Q11)

**A1: one emptiness check.** New `src/lib/bins/delete-check.ts`:
`binDeleteBlockers(db, binId)` returns `{ items, liveUnits, looseQty, secondHand, openAudits[] }`.
- `items` is the sum of `getBinQtyMap(binId)` (`src/lib/units/bin-qty.ts:22`). That is the
  helper the bin audit already trusts: live units count, and so does the loose quantity of
  uncoded products. Sold units and 0-quantity rows count as nothing.
- `secondHand` is `secondHandCycle.count({ binId, status: "IN_STOCK" })`.
- `openAudits` is `stockCount.findMany({ binId, status in PENDING|IN_PROGRESS|COMPLETED })`, returning `countNo`.

`DELETE`, `PATCH` and the code-reuse branch of `POST` all ask this one function.

**A2: `DELETE /api/bins/[id]`.**
- Replace the `_count` sum (`[id]/route.ts:84-104`) with `binDeleteBlockers`, run inside a
  `$transaction`.
- **Refuse with 409**, naming the cause:
  - "Bin A1 still holds 4 items (3 bikes, 1 loose). Move them to another bin first."
  - "…has an unfinished stock audit SC-202610-0003. Approve or reject it first."
- **Otherwise, in the same transaction:**
  1. Delete the bin's `HomeBinRule` rows (Q1).
  2. `product.updateMany({ binId } → null)` (Q1).
  3. Set `isActive: false`.
- Return `{ deleted, rulesRemoved, productsCleared }`.

**A3: `PATCH /api/bins/[id]` (Q11).**
- `isActive: false` is refused with "Use Delete on the bin". The other fields are unchanged.
- Renaming onto a deleted bin's code answers "A1 belonged to a deleted bin. Create A1 with New
  Bin to bring it back."

**A4: `POST /api/bins` (Q3).**
- When the code matches an **inactive** row, check that row with `binDeleteBlockers`:
  - **Empty:** update the row with the new name, directions, floor, zone and both flags, set
    `isActive: true`, and return 201. `nonAssemblable` can be re-chosen because the bin is empty.
  - **Holds items** (only a bin retired through the old checkbox can): refuse with 409.
- An active duplicate still gets the existing 409.
- Consequence: the revived bin keeps the old row's movement history.

**A5: `POST /api/bins/move` gains "move everything" (Q2).**
- Body `{ warehouseId, fromBinId, toBinId, reason, all: true }`, validated by zod. The existing
  two branches stay byte-for-byte.
- Inside one transaction:
  1. Move the live units with `placeUnitsInBin(tx, ids, toBinId)`, keeping the no-assembly
     guard (P6). Any refusal rolls back the whole move.
  2. Write one `BinMovementLog` per unit with `createMany`.
  3. Move uncoded loose quantities by decrement/increment.
  4. Run `syncBinStock` on both bins.
- Return `{ unitsMoved, looseMoved }`.

**A6: screen (`bins-manager.tsx`).**
- **Delete** on the card and in the drawer header, behind `canDelete("bins")`. It opens a new
  `src/components/bins/delete-bin-dialog.tsx`:
  - **Empty bin:** "Delete A1? Its N home-bin rules are removed too."
  - **Bin with items:** the counts and a **Move everything out** button that opens the move modal.
  - The server's 409 text is shown verbatim.
- `GET /api/bins` adds `_count.homeBinRules`, so the dialog can state N.
- **Move Out** sends `all: true`:
  - The modal reads "Move all N items from A1 to…".
  - Opening it resets `moveUnitId`.
  - The target list is limited to the source bin's warehouse.
- The Edit form loses the **Active** checkbox and stops sending `isActive`.

### Part B: home-bin rule, many categories, searchable brand (R5, R6, Q4, Q5)

**B1: `POST /api/bins/home-rules`.**
- Body (zod): `{ warehouseId, brandId, binId, categoryIds: string[] }`, 1–200 categories.
  The old `categoryId`/`subcategoryId` pair is still accepted and becomes a 1-item list.
- Every category must exist, be active, and be a **leaf**. One `category.findMany` plus one
  `groupBy` of active children; no per-row query. If any fails, the whole save is refused,
  naming the offenders.
- The brand must exist; the bin must be active and in the warehouse (as today).
- One `$transaction`. For each category, the existing pair is unchanged, **re-pointed** (Q5),
  or created.
- Response `{ created, moved: [{ categoryPath, fromBinCode }], unchanged }`, status 201.
  Paths are built in memory from the one categories query.

**B2: screen.**
- **Brand** becomes `SearchableSelect` (R6).
- **Category** becomes a new `src/components/category-multi-select.tsx` (Q4):
  - a checklist of **every active leaf category**, labelled with its full path;
  - the same search as `SearchableSelect` (substring first, fuzzy as a fallback);
  - **Select all shown** / **Clear**, and an "N selected" count.
  - It fetches nothing; the modal already loads `/api/categories`.
- Both the root and the subcategory pickers go, along with the `ruleSubcategories` memo. A
  checklist of leaves makes "choose a subcategory" impossible to get wrong.
- The button reads **Save N rules**. The result line reads "3 created, 1 moved from A2".

### Part C: transfers can be created again, with bins (Q8, Q14; 2209 Phase 1)

**C1: `GET /api/transfer-orders/bin-options?fromWarehouseId=&toWarehouseId=&productIds=`.**
- Guard: `transfers.view` (changed at build time from `create`: a returned order's creator may
  correct it without holding `create`, see `PATCH /api/transfer-orders/[id]`, and this only reads).
- Per product:
  - `fromBins` — the bins in the source warehouse that hold it, with quantities. One `groupBy`
    of live units by `(binId, productId)`, plus uncoded `BinStock`; never one query per bin.
  - `ruleBin` — the destination's home-bin rule, from `loadHomeBinRules` once and
    `pickHomeBin` per product.
- Once: `toBins`, the destination warehouse's active bins.

**C2: `validateTransferItems`** (`src/lib/transfers/items.ts`). Besides "both present":
- The from-bin is active and in the source warehouse; the to-bin is active and in the destination.
- The from-bin holds at least the line quantity, summed per product and bin. The error names
  the bins that do hold it.
- When a rule matches, the to-bin must be the rule's bin: 409, worded like inbound R34
  (`src/lib/inbound/rule-bin.ts`).

Create and the RETURNED-order edit both pick this up, because they share the validator.

**C3: `/transfers/new` lines**, as a shared `transfers/_components/line-bin-pickers.tsx`:
- A **From bin** select: "L1 · 5".
- A **To bin** select, **locked** when a rule matches.
- The quantity is capped by the from-bin.
- **+ from another bin** splits a line. Lines are keyed by index, not by product.
- Submit waits until every line has both bins.

**C4: Edit items sheet** (RETURNED orders) uses the same pickers and sends the bins.

### Part D: four directions (R7, Q6, Q7, Q12, Q13)

**D1: migration `transfer_mode_floor_godown_directions`**, written by `migrate dev` on
localhost and read before committing. It is additive (CLAUDE.md rule 7):

```sql
ALTER TYPE "TransferMode" ADD VALUE IF NOT EXISTS 'FLOOR_TO_FLOOR';
ALTER TYPE "TransferMode" ADD VALUE IF NOT EXISTS 'FLOOR_TO_GODOWN';
ALTER TYPE "TransferMode" ADD VALUE IF NOT EXISTS 'GODOWN_TO_GODOWN';
```

- `GODOWN_TO_FLOOR` already exists and is reused.
- `STORE_TO_STORE` and `STORE_TO_WAREHOUSE` stay for history and are no longer written by the form (Q13).
- Old code cannot write the new values, so nothing breaks while the migration is ahead of the deploy.

**D2: `src/lib/transfers/mode.ts`.**
- `modeForKinds(fromKind, toKind)` picks one of the four modes.
- `docTypeForLane(fromWh, toWh)` returns **TAX_INVOICE** when the warehouses' `storeId`s
  differ and **DELIVERY_CHALLAN** otherwise (Q7).
- `docTypeForMode` is deleted once its two callers have moved.
- Find stock switches to both helpers. Its document does not change (§2.4.2); only its mode
  label does, and that label was already wrong on the detail page.

**D3: `POST /api/transfer-orders`.**
- `createSchema` becomes `{ mode: the four, fromWarehouseId, toWarehouseId, items, notes, document }`.
- The server checks:
  - both warehouses are active (`listWarehouses`);
  - their **kinds match the mode** — the mode is checked, never trusted;
  - they are different warehouses.
- `fromStoreId` and `toStoreId` are written from the two warehouses, always.
- `requiredDocType` comes from `docTypeForLane`.
- The old body shapes go; the only caller is the page (§2.4.2).

**D4: `route-picker.tsx` and `page.tsx`.**
- Four chips: **Floor → Godown · Godown → Floor · Floor → Floor · Godown → Godown**, 2×2 on a phone.
- Each side: pick a **store** (any store, the same one included, Q6), then that store's
  warehouse of the needed kind. It is chosen automatically when there is one, offered as a
  select when there are several, and replaced by a message when there is none (Q12). The
  source warehouse is never offered as the destination.
- Once both stores are known, the document banner shows the derived document.
- The draft key goes to `-v4`, and `sourceFloor` goes.
- `document-picker.tsx` takes the document type instead of the mode.

**D5: detail page** (`transfers/[id]/page.tsx:35,104`). The mode type covers all six values,
with labels for the four new ones and the old wording kept for old orders.

### Logging (`src/lib/logger.ts`, one scope per module)

| Where | Level | Line |
|---|---|---|
| bin delete | `info` / `warn` | "bin deleted" `{ binId, code, warehouseId, rulesRemoved, productsCleared }` / "bin delete refused" `{ binId, items, secondHand, openAudits }` |
| bin create revives a code | `info` | "bin revived from retired row" `{ binId, code, warehouseId }` |
| move everything | `info` / `warn` | "bin emptied" `{ fromBinId, toBinId, unitsMoved, looseMoved, userId }` / the existing "bin move refused" |
| home rules multi-save | `info` / `warn` | "home bin rules saved" `{ warehouseId, brandId, binId, created, moved, unchanged }` / refused with the offending ids |
| bin-options | `debug` | `{ fromWarehouseId, toWarehouseId, products, ms }` |
| transfer line checks | `warn` | "transfer lines refused: …" `{ productId, binId, warehouseId }` |
| transfer create | `info` | existing line, plus `fromWarehouseId`, `toWarehouseId` |
| every client `catch` / `apiTry` error | `error` | identifiers only, never payloads |

### Board of agents: checked against their red flags

- **Warehouse:**
  - "Items received without bin assignment": transfer receive still lands units with no bin,
    and that stays (2209 Phase 2, §5). Raised in the Q8 note.
  - Delete cannot strand stock, because a bin with items is refused.
- **Inventory:** "Products with no bin assigned". Deleting a bin clears `Product.binId` on its
  products (Q1). Those products then show under `/stock` → Needs details, which is the intended signal.
- **GST:** separate stores mean separate GSTINs, so a supply carries a tax invoice. Within
  one GSTIN a delivery challan travels. Q7 encodes exactly that, and the GSTIN itself is still
  never read (owner, 9 Sep).
- **Backend:**
  - Every multi-table write is in one `$transaction`: delete, move everything, rules multi-save.
  - The new bodies get zod.
  - Delete and move have existence checks.
  - No role names; guards are `requireFeature` with two arguments.
- **Database:**
  - Additive enum migration only.
  - No N+1: the new routes use `groupBy` and a single categories query.
  - No new FK and no `Float`.
- **Frontend:**
  - Every new button is disabled while its request runs, and every list has a loading and an
    empty state.
  - Pickers are checked at 375 px.
  - `bins-manager.tsx` is already 2,024 lines (a pre-existing red flag), so the new pieces are
    separate components rather than more inline JSX.

---

## 4. Verification

Before the build:
- Restore a snapshot locally (`npm run db:restore:local -- backups/<latest>.dump`).
- Point `.env` at **localhost**. It points at the Supabase pooler today, so `migrate dev` must
  not run until it doesn't (rules 2 and 5).

1. `npx prisma migrate dev --name transfer_mode_floor_godown_directions`. The SQL is three `ADD VALUE` lines and nothing else.
2. `npm run build` passes.
3. **Bins:**
   - A bin with bikes: Delete → refused with the counts → **Move everything out** → Delete succeeds.
   - Its home-bin rules are gone, and products that had it as their default bin show no bin.
   - A bin with an unfinished audit is refused, naming the audit.
   - Create the deleted code again: the bin comes back.
   - The Edit form has no Active checkbox.
   - Move Out lists only same-warehouse bins.
4. **Rules:**
   - The brand field is searchable.
   - Tick 3 subcategories under two different parents → "3 created".
   - Repeat with one of them pointing to another bin → "… 1 moved from A2".
   - A parent category is never offered.
5. **Transfers**, one each:
   - Floor → Godown, same store → **delivery challan**.
   - Godown → Floor, across stores → **tax invoice**.
   - Floor → Floor across stores.
   - Godown → Godown across stores.
   - Godown → Godown inside a one-godown store offers no destination.
6. **Transfer lines:**
   - The from-bin shows quantities; a rule-matched to-bin is locked.
   - Over-quantity is refused, naming the other bins; a split line passes.
   - A RETURNED order's **Edit items** saves with bins.
7. **Find stock** on an outward still creates a transfer, now labelled "Godown → Floor" / "Floor → Floor".
8. **Phone:** the transfer form and the rules modal at 375 px.

---

## 5. Out of scope, deliberately

- **Dispatch from the from-bin, and receive into the to-bin** (2209 Phase 2), plus outward by
  bin (2209 Phase 3). After this plan the bins are recorded and validated, and stock still
  arrives with no bin.
- **Several brands in one rule.** The owner asked for several categories; the brand stays one, and searchable.
- **Hard-deleting bins.** The soft delete keeps `BinMovementLog` history readable.
- **The rules list's per-rule category path walk** in `GET /api/bins/home-rules` (`:12-29`, one
  query per path step). It is untouched; only the new POST avoids it.
- **Find stock running the line validator.** It still writes its own order without bins (`find-stock/route.ts:315`).
- **Dropping `STORE_TO_STORE` / `STORE_TO_WAREHOUSE`** from the enum: old orders carry them.

---

## 6. Build record — 3 Oct 2026

Built on `feat/0310-bins-rules-transfer-directions`, cut from `main` at `555c2c8` after
`git pull --ff-only`. `npx tsc --noEmit` clean; eslint on every touched file reports only the three
findings `main` already has in `bins-manager.tsx` (unused `Layers`, unused `canView`, the
pre-select-warehouse effect); `npm run build` exit 0.

**What exists now, by part**

- **A** — `src/lib/bins/delete-check.ts` (`binDeleteBlockers`, `binDeleteRefusal`); `DELETE`
  rewritten and `PATCH` refusing `isActive: false` in `api/bins/[id]/route.ts`; code reuse in
  `POST /api/bins`; `all: true` branch in `api/bins/move/route.ts`;
  `src/components/bins/delete-bin-dialog.tsx`; Delete on the card and drawer, Move Out fixed,
  Active checkbox removed in `bins-manager.tsx`.
- **B** — `POST /api/bins/home-rules` takes `categoryIds[]` (zod, one transaction, re-point and
  report); `src/components/category-multi-select.tsx`; brand is `SearchableSelect`.
- **C** — `getWarehouseBinQty` in `src/lib/units/bin-qty.ts`; `GET /api/transfer-orders/bin-options`
  with types in `src/lib/transfers/bin-options.ts`; bin checks in `validateTransferItems`;
  `transfers/_components/line-bin-pickers.tsx` + `use-bin-options.ts`, used by `/transfers/new`
  and the Edit items sheet.
- **D** — enum values + migration `20261003040415_transfer_mode_floor_godown_directions`;
  `mode.ts` rewritten (`DIRECTION_MODES`, `DIRECTION_LABEL`, `modeForKinds`, `kindsForMode`,
  `docTypeForLane`; `docTypeForMode` and `resolveStoreWarehouse` deleted); create route takes
  `{ mode, fromWarehouseId, toWarehouseId }`; Find stock uses the same helpers; route picker,
  page, document picker and detail labels rewritten.

**Found and fixed on the way (not in §3)**

- `POST /api/bins` looked the code up raw but stored it trimmed and upper-cased, so `a1` missed
  an existing `A1`; with code reuse that would have died on the unique index. Normalised once,
  before the lookup.
- In the create page, the upload key's `Date.now()` / `Math.random()` moved to a module-level
  helper: once the component compiled, the React Compiler lint flagged them as impure-in-render.

**Database (3 Oct 2026)**

- The migration was written by hand, in Prisma's exact output format: no local database existed
  and `.env` points at the Supabase pooler, where `migrate dev` is banned (rules 2, 5).
- It is **applied** on the `.env` database (Supabase, session pooler 5432): `_prisma_migrations`
  records `20261003040415_transfer_mode_floor_godown_directions` finished 05:53:44 UTC, and
  `pg_enum` lists the six `TransferMode` values. It was not applied by this session — no command
  run here writes to that database. `npx prisma migrate status`: 27 found, up to date.
- `npm run db:snapshot` → `backups/postgres-20261003-055643.dump` (2.5 MB), taken just AFTER the
  migration ran, so it rolls back data but not the enum values. The migration is additive, so
  nothing in it needs rolling back.

**Commits:** Parts A+B together (they share `bins-manager.tsx`), Parts C+D together (they share
the create page). Pushed and merged by PR on the owner's instruction, 3 Oct 2026.

**Merged without the browser walk — still owed**

1. **Nothing has been opened in a browser.** The owner asked to push and merge before the §4
   walk. Walk §4 on the deployed app and record the result here.
2. Grant `bins.delete` on `/team/permissions` to whoever should delete bins.
3. `npm run lint` repo-wide reports 187 errors / 91 warnings, all pre-existing on `main`; the
   only finding in a file this plan touched is the existing `bins-manager.tsx` effect error.

## 7. Follow-up build — R8, R9 (3 Oct 2026)

Branch `feat/0310-transfer-hub-lists`, cut from `main` at `736c2f5` (PR #70 merged).

- `transfers/new/_components/route-picker.tsx`: `RoutePicks` is `{ mode, fromWarehouseId,
  toWarehouseId }`; `resolveRoute` lists every warehouse of each kind across stores; each side is
  one `<select>` with an `<optgroup>` per store. `KIND_WORD.FLOOR` is "hub".
- `src/lib/transfers/mode.ts`: `DIRECTION_LABEL` reads Hub → Godown, Godown → Hub, Hub → Hub,
  Godown → Godown — the chips, the receipt, the create route's refusal and the detail chip all
  read it (the detail page's own copy of the four labels was removed).
- `transfers/new/page.tsx`: store handlers gone; the attached document is kept with the document
  type it was attached as and stops counting when the route needs the other one.
- No server, schema or migration change: the create route already takes two warehouse ids.
- `npx tsc --noEmit` and eslint on the touched files clean; build below. Not browser-checked.

