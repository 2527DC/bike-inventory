# A bin audit gives its products their bin, and /stock finds products by the bin they are in

Status: completed — 22 Sep 2026, approving a bin audit gives each counted product with no bin that bin, the /stock bin filter matches home bin OR items OR bin quantity, and "Needs details" stops flagging binned stock; on `feat/2209-audit-bin-transfers-list-permissions`; 10/10 rollback checks pass on bch_local; tsc and lint clean; owner owes `npm run build` + browser walk.
Split out of `2209-transfer-and-outward-by-bin-plan.md` (its former R6–R8,
Q6 / Q7 / Q9 and Phase 4) on the owner's instruction.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (22 Sep 2026)

> and check for this when i do the stock audit respecetd to bin and comple the stock auit if the
> product does not have the bin assigned it should be assigne respectadly because in the /stock
> filering product by bin doens shown even though the product was audited by stock audit
> respected to bin

> and also plan for the bin assingin to the product at the time of stock audit completion

> let the implmentation has there related zquestion respected to the plan and i need this
> implemnatation also A bin audit's approval creates the units in the audited bin and recounts
> that bin's BinStock (stock-counts/[id]/route.ts:461, 534). But it never touches Product.binId.
> So after you audit and approve bin L1: - L1 correctly holds the items, as the Bins screen shows
> - /stock filtered by L1 shows nothing - those products still show no bin, and count as "Needs
> details" for this

> create a differe implmenattion plan for the audit thing

### 0.2 Restated as requirements

| # | Requirement |
|---|---|
| R1 | **Finishing a bin audit gives each counted product that has no bin that bin** (`Product.binId`). When exactly "finishing" is, Complete or Approve, is Q3. |
| R2 | **The `/stock` bin filter shows the products actually in that bin**: its home bin, its live units, or its bin quantity. After auditing and approving L1, `/stock` filtered by L1 lists every product counted there. |
| R3 | **An audited product no longer shows "no bin" or counts as "Needs details"** once it has stock in a bin. |

---

## 1. Questions and clarifications

| # | Req | Question | Why it changes the build | Options | Default |
|---|---|---|---|---|---|
| Q1 | R1 | A product already has a bin (say L1) and is counted in L2. Change it? | `Product.binId` holds one bin only. | (a) **only fill it when empty**; the R2 filter finds the product in L2 anyway (b) overwrite with the latest audited bin | **(a)** |
| Q2 | R2 | What counts as "in bin X" for the `/stock` filter? | Defines the filter. | (a) **`Product.binId = X` OR a live unit in X OR a `BinStock` row in X with quantity > 0** (b) units only | **(a)** |
| Q3 | R1 | **When** is the bin assigned: when the counter presses **Complete**, or when the approver **approves**? | Stock and `U-` codes change only on approval (plan 2109 R31, R33), and a count can still be sent back or approved as record-only. | (a) **on approval with "apply to stock"**, in the same transaction that creates the units, so the product's bin never points at a count that was later rejected (b) on Complete, before anyone has checked the count | **(a)** |
| Q4 | R1 | Products counted as **0** in the bin: give them the bin? | A 0 means "not on this shelf". | (a) **no**, only lines counted above 0 (b) yes | **(a)** |

### 1.1 Decisions on record

| Date | Q | Answer |
|---|---|---|
| 22 Sep 2026 | — | The owner asked for this as its own plan. |
| 22 Sep 2026 | Q1–Q4 | **All defaults** (owner): fill the bin only when empty; "in bin X" = home bin OR items in X OR a bin quantity in X; assign on approval with "apply to stock"; nothing for lines counted 0. |

---

## 2. The problem — verified against the code (22 Sep 2026)

The symptom, in the owner's words: after you audit and approve bin L1,
- L1 correctly holds the items, as the Bins screen shows
- `/stock` filtered by L1 shows **nothing**
- those products still show **no bin**, and count as **"Needs details"**

Why, in the code:

- There are **two separate bin records**:
  - **`Product.binId`**: one "home bin" per product. **`/stock` reads only this**: the bin filter
    (`src/app/api/products/route.ts:112`), the bin shown on each row (`:136`), and "Needs
    details" = no brand OR `binId: null` (`:96–105`).
  - **`InventoryUnit.binId` and `BinStock`**: where each item actually is. The Bins screen, the
    bin drawer and the audit read these.
- `Product.binId` is written **only by inbound** (`src/app/api/inbound/[id]/route.ts:298`,
  `src/app/api/inbound/[id]/putaway/route.ts:183`).
- Approving a bin audit with "apply to stock" creates or retires the units **in the audited
  bin** (`src/app/api/stock-counts/[id]/route.ts:461`, through `applyBinCountLine` in
  `src/app/api/stock-counts/_lib/apply-bin-line.ts`) and recounts that bin's `BinStock` (`:534`).
  It **never sets `Product.binId`**. The only product write on approval is the suggested-brand
  fix (`:430`).
- Since the seed loads products with no stock and no bin (plan 2109, Q31), **every product that
  enters the building through a bin audit keeps `Product.binId = null`**. It is invisible to the
  `/stock` bin filter and stays under "Needs details" for good.
- A product can also sit in **several bins**, and transfers and outward move units without
  touching `Product.binId`. So even a filled `Product.binId` goes stale. That is why R2 filters on
  where the stock actually is, not only on the home bin.

---

## 3. Implementation plan

No migration, no RBAC change, no screen change: `/stock` already sends `binId` and renders
`p.bin`.

### Part A: approval assigns the bin (R1)

**Questions for this part:** Q1, Q3, Q4. Defaults: Q1a fill only when empty; Q3a on approval
with "apply to stock"; Q4a only lines counted above 0.

- **`src/app/api/stock-counts/[id]/route.ts`** (approval with "apply to stock"), in the same
  transaction as the units, after the lines are applied:
  - collect the product ids of lines with `countedQty > 0`
  - `tx.product.updateMany({ where: { id: { in: ids }, binId: null }, data: { binId: target.binId } })`
  - add `productsGivenBin` to the approval summary returned to the screen
  - log at info `{ stockCountId, binId, productsGivenBin }`
- A record-only approval, a rejection or a Complete assigns nothing (Q3a).

### Part B: /stock filters by where stock is (R2, R3)

**Questions for this part:** Q2. Default: Q2a.

- **`src/app/api/products/route.ts`:**
  - The `binId` filter changes from `{ binId }` to
    `OR [{ binId }, { units: { some: { binId, status: { in: LIVE_UNIT_STATUSES } } } }, { binStocks: { some: { binId, quantity: { gt: 0 } } } }]`
    (Q2a). It combines with the existing `AND` list, never replaces it, so search, brand,
    category and store filters still apply.
  - The "Needs details" bin test changes from `{ binId: null }` to
    `{ binId: null, units: { none: { binId: { not: null }, status: { in: LIVE_UNIT_STATUSES } } }, binStocks: { none: { quantity: { gt: 0 } } } }`
    (R3).
  - The store-scoped path (`:170–190`) reuses the same `where`, so it needs no separate change.
    The build confirms this.
- The bin shown on each row stays `Product.binId`, which Part A now fills after an audit.

**Board of agents:** inventory consultant (what "in a bin" means); backend (the query shape, and
indexes on `InventoryUnit.binId` / `BinStock.binId`, which both already exist).

---

## 4. Verification

- `npx tsc --noEmit`, and a rollback script on localhost `bch_local`. `npm run build` is run by
  the owner.
- **Part A:**
  - approve a bin audit of L1 that counted product P (no bin) above 0 → P's bin is L1
  - a product already on L2 keeps L2 (Q1a)
  - a product counted 0 gets no bin (Q4a)
  - a record-only approval changes nothing
- **Part B:**
  - `/stock` filtered by L1 lists P, and a product with units in both L1 and L2 appears under
    both
  - P is not under "Needs details"
  - a product with no home bin and no stock in any bin still is
- The browser walk on `/stock`, and the same checks after a real audit.

---

## 5. Out of scope

- Transfers and outward by bin (`2209-transfer-and-outward-by-bin-plan.md`).
- Showing several bins per product row on `/stock`. The row keeps one home bin; the filter
  covers the rest.
- Back-filling `Product.binId` for audits approved before this ships. The R2 filter already finds
  those products. A one-off script can be added if the owner wants the row to show a bin too.

---

## 6. Build record — 22 Sep 2026

On `feat/2209-audit-bin-transfers-list-permissions` (stacked on `c56c6d1`).

- **Part A:**
  - `src/app/api/stock-counts/_lib/assign-product-bin.ts`: `assignBinToCountedProducts(tx, binId,
    lines)` sets `Product.binId` on products counted above 0 that have none, with one `updateMany`.
  - `src/app/api/stock-counts/[id]/route.ts` calls it after `syncBinStock`, inside the
    apply-to-stock branch and the same transaction. The approval summary gains `productsGivenBin`,
    and an info log is written. A record-only approval, a reject or a Complete never reach this
    code.
- **Part B:**
  - `src/lib/products/bin-filter.ts`: `productInBinWhere(binId)` (home bin OR a live unit in the
    bin OR a `binStocks` quantity above 0) and `productHasNoBinWhere()`. The relation is
    `inventoryUnits`.
  - `src/app/api/products/route.ts`: the bin filter is pushed onto the `and` list, so it combines
    with search and the other filters. The "Needs details" bin test uses `productHasNoBinWhere()`.
    The store-scoped path spreads the same `where`.
- `scripts/db/verify-audit-assigns-bin.mjs`: localhost only, always rolls back. It runs
  `getBinQtyMap` → `applyBinCountLine` → `syncBinStock` → `assignBinToCountedProducts`. **All 10
  checks pass** on `bch_local`:
  - P (no bin) → L1
  - Q (L2) keeps L2
  - R (counted 0) stays null
  - a re-run assigns nothing
  - filter L1 → P and Q; filter L2 → Q; filter L3 → S (units only)
  - "Needs details" → R and T only
  - the bin filter combined with search → P and Q
- `tsc --noEmit`: 0 source errors. ESLint: clean.
- Not done: `npm run build`, browser walk. `productsGivenBin` is not shown on the receipt screen
  yet (no screen change, as planned).
