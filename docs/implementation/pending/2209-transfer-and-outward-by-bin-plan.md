# Transfer and outward move stock bin by bin

Status: pending — written 22 Sep 2026; **waiting for the owner's answers to §1 and the go-ahead.**
Nothing built. **Phase 1 is a merge blocker for `feat/2109-inbound-bins-audit-fixes`** (§2.1).
**The audit part (former R6–R8, Q6 / Q7 / Q9, Phase 4) moved to
`2209-audit-assigns-product-bin-plan.md`** on the owner's instruction, 22 Sep 2026.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (22 Sep 2026)

> and i have a question here that is when u are making a stock transfer liek bch warehouse to bcc
> flore where does the stock sit as of now system does it sits in the bin or where does it sits and
> if its getting outwad how i the stock incress and dcress happening at the operation of outwar and
> transfer because in the other level it happening at the bin level like inbound it is one
> respected to the bin level and even the stock audit so i need to know how this thing done just
> dont see the doc see the real code implemnation and storing and action tables

> eans at the time of outward and transfer its not tracking respected to bin is it correct tell
> yes or no

> and check for this when i do the stock audit respecetd to bin and comple the stock auit if the
> product does not have the bin assigned it should be assigne respectadly because in the /stock
> filering product by bin doens shown even though the product was audited by stock audit
> respected to bin

> i need u to write a implementation plan for the transfer and outward respected to bin check the
> plan must have what was the proble and the requiremnt and the implmentation plan

> and also plan for the bin assingin to the product at the time of stock audit completion

> let the implmentation has there related zquestion respected to the plan and i need this
> implemnatation also A bin audit's approval creates the units in the audited bin and recounts
> that bin's BinStock (stock-counts/[id]/route.ts:461, 534). But it never touches Product.binId.
> So after you audit and approve bin L1: - L1 correctly holds the items, as the Bins screen shows
> - /stock filtered by L1 shows nothing - those products still show no bin, and count as "Needs
> details" for this

Read as: (1) each implementation phase in §3 lists the questions that belong to it; (2) the
audited-product bin problem (§2.4) is in scope and must be fixed. It was R6–R8 and Phase 4 here;
the owner then asked for it as its own plan ("create a differe implmenattion plan for the audit
thing"), so it moved to `2209-audit-assigns-product-bin-plan.md`.

### 0.2 Restated as requirements

| # | Requirement |
|---|---|
| R1 | **Creating a transfer names a from-bin and a to-bin on every line** from the screen. Today the screen sends none and the server refuses (§2.1). |
| R2 | **Dispatch takes the units out of the line's from-bin**, not from any bin in the source warehouse. |
| R3 | **Receive puts the arrived units into the line's to-bin** in the destination warehouse, not "no bin". |
| R4 | **Outward (DELIVERED / WALK_OUT) records which bin each item left**, and shows it. |
| R5 | Every transfer and outward bin movement is written to `BinMovementLog`, as inbound and audits already are. |
| ~~R6~~ | **Moved** to `2209-audit-assigns-product-bin-plan.md` (R1–R3 there). |
| ~~R7~~ | **Moved** to `2209-audit-assigns-product-bin-plan.md` (R1–R3 there). |
| ~~R8~~ | **Moved** to `2209-audit-assigns-product-bin-plan.md` (R1–R3 there). |

---

## 1. Questions and clarifications

| # | Req | Question | Why it changes the build | Options | Default |
|---|---|---|---|---|---|
| Q1 | R1 | How are the bins chosen on `/transfers/new`? | Decides the screen. | (a) **From-bin:** a picker of the source warehouse's bins that hold the product, each with its quantity ("L1 · 5"). **To-bin:** pre-filled and locked from the destination warehouse's home-bin rule (as inbound, plan 2109 R34); otherwise a required picker of the destination's bins. (b) free choice of any bin on both sides | **(a)** |
| Q2 | R2 | The chosen from-bin holds fewer than the line's quantity, but the warehouse has enough elsewhere. | Refuse or silently spread across bins. | (a) **refuse** at creation and at dispatch, naming the bins that hold it ("L1 has 2, L4 has 5"), and let the person split the line (b) take the rest from other bins | **(a)** |
| Q3 | R3 | Is the to-bin fixed at creation, or confirmed at receive? | The receiving clerk sees the real shelf. | (a) **set at creation, shown on the receive screen, changeable there** (destination bins only; a rule-locked product stays locked) (b) fixed at creation | **(a)** |
| Q4 | R4 | Who chooses the bin on outward? | A choice adds a step to every handover. | (a) **the app picks as today** (held → built → oldest), **records the bin of each unit**, and shows "taken from L1 ×2, L3 ×1" on the handover result and the delivery detail (b) the person picks a bin per line at handover | **(a)** |
| Q5 | R4 | On outward, take units with **no bin** (from older transfers) first or last? | Clears the loose stock. | (a) **first**, since loose stock goes out before shelved (b) last | **(a)** |
| ~~Q6~~ | — | **Moved** to `2209-audit-assigns-product-bin-plan.md` (Q1–Q3 there). | — | — | — |
| ~~Q7~~ | — | **Moved** to `2209-audit-assigns-product-bin-plan.md` (Q1–Q3 there). | — | — | — |
| ~~Q9~~ | — | **Moved** to `2209-audit-assigns-product-bin-plan.md` (Q1–Q3 there). | — | — | — |
| Q8 | R3 | Stock already received into **no bin** by past transfers. | It sits outside every bin today. | (a) **list it with `npm run db:check:unbinned`** (plan 2109 R37) **and count it into bins** with a bin audit; no automatic move (b) a one-off script placing it by rule | **(a)** |

### 1.1 Decisions on record

| Date | Q | Answer |
|---|---|---|
| — | — | *none yet* |

---

## 2. The problem — verified against the code (22 Sep 2026)

### 2.1 A transfer cannot be created from the screen (merge blocker)

- `src/app/(dashboard)/transfers/new/page.tsx:251–255` sends `{ productId, quantity }` per line:
  **no `fromBinId`, no `toBinId`**.
- `src/lib/transfers/items.ts:124–130`: "Bins are always on (plan 2109, Q27): every line names
  both bins", so it refuses with 400 "Source and destination bins are required". The check became
  unconditional in `ce3605d`. Before that it applied whenever the bin-tracking setting was on,
  and on `bch_local` it was on.
- The only transfers that still get created come from **Find stock** on an outward
  (`api/deliveries/[id]/find-stock/route.ts:319`), which creates the order directly and skips
  the check.
- The check tests only that both ids are **present**. Nothing checks that the from-bin is in the
  source warehouse or the to-bin in the destination.

### 2.2 Transfers do not move stock bin by bin

| Step | What it writes | Bin behaviour | Where |
|---|---|---|---|
| Dispatch | `StockLevel` of the source −qty (`moveOutOfWarehouse`); units → `TRANSFERRED`, `binId: null`; source bins recounted (`syncBinStock`); `InventoryTransaction` `TRANSFER [DISPATCHED]`; `TransferOrderUnit` rows | Units picked from **any bin** of the source warehouse (`pickUnitsUpTo` filters only `productId` + `warehouseId`, `units/pick.ts:124`). **The line's `fromBinId` is ignored.** | `api/transfer-orders/[id]/dispatch/route.ts:154–230`, `lib/transfers/stock.ts:38`, `lib/units/lifecycle.ts:53` |
| In transit | — | In no warehouse and no bin | — |
| Receive | `StockLevel` of the destination +received (`moveIntoWarehouse`); units → destination as `ASSEMBLED` / `RECEIVED`; missing units `LOST`; `InventoryTransaction` `TRANSFER [RECEIVED]` (+ `ADJUSTMENT [TRANSIT SHORTFALL]`) | **Units get `binId: null`** (`moveUnits`, `lifecycle.ts:26–46`). **The line's `toBinId` is never read** by the receive route. | `api/transfer-orders/[id]/receive/route.ts:160–255` |

No `BinMovementLog` row is written by dispatch or receive. Inbound, audits, assembly and bin
moves all write one.

### 2.3 Outward is not chosen or recorded by bin

At `DELIVERED` / `WALK_OUT` (`api/deliveries/[id]/route.ts:385–433`, `deliveries/batch/route.ts:156–202`):
- `StockLevel.quantity` of the invoice's floor goes down, and the hold is consumed
  (`deductDeliveryFromFloor`, `lib/deliveries/floor-stock.ts:317–380`).
- Units on that floor are picked from **any bin** (held → built → oldest) and set to `SOLD`,
  `binId: null` (`sellDeliveryUnits` → `sellUnits`, `lifecycle.ts:76–110`, `145+`).
- The bins they left are recounted, so **`BinStock` of the right bins does go down**, but **nothing
  records which bin** an item left, and no `BinMovementLog` row is written.

### 2.4 An audited product shows no bin on /stock

Moved to `2209-audit-assigns-product-bin-plan.md` §2.

### 2.5 What already works bin by bin

Inbound (units created in the chosen or rule bin), the stock audit (per bin since plan 2109 R33),
assembly and manual bin moves. `TransferOrderItem` already has `fromBinId` / `toBinId` columns and
relations (`Bin.transfersFrom` / `transfersTo`). **No schema change is needed.**

---

## 3. Implementation plan

No migration. No RBAC change: the transfer and delivery guards stay as they are.

### Phase 1: transfers can be created again, with bins (R1): merge blocker

**Questions for this phase:** Q1 (how the bins are picked), Q2 (from-bin holds too few). Defaults: Q1a pickers, with the to-bin locked by rule; Q2a refuse, naming the bins that hold it.


- **`transfers/new/page.tsx`**, per line:
  - a **From bin** select, filled from a new
    `GET /api/bins/holding?warehouseId=&productId=` that returns the bins holding the product
    with their quantities (`getBinQtyMap` per bin)
  - a **To bin** select of the destination warehouse's active bins, pre-filled and locked when
    the destination's home-bin rule matches the product (`pickHomeBin`)
  - Submit disabled until every line has both
  - payload `{ productId, quantity, fromBinId, toBinId }`
  - store-to-store mode: the source and destination warehouses resolve as today, and the pickers
    follow them
- **`lib/transfers/items.ts`:**
  - the from-bin must be active and in the source warehouse, and the to-bin in the destination
    warehouse
  - the from-bin must hold ≥ the line's quantity (Q2a), with the error naming the bins that do
  - the rule lock applies to the to-bin (same 409 as inbound R34)
  - a non-assemblable to-bin still refuses a unit that needs assembly (the existing
    `placeUnitsInBin` guard)

### Phase 2: dispatch and receive by bin (R2, R3, R5)

**Questions for this phase:** Q2 (short from-bin at dispatch), Q3 (to-bin changeable at receive), Q8 (stock already received with no bin). Defaults: Q2a, Q3a, Q8a.


- **`units/pick.ts`:** `pickUnitsUpTo` takes an optional `binId`, filtering `binId` when given.
- **Dispatch:**
  - pick units per line from `item.fromBinId`, and refuse if the bin now holds fewer (checked
    inside the transaction)
  - `BinMovementLog` per line: `fromBinId`, `toBinId: null`, reason "Transfer TRF-… dispatched"
  - the source bin recount is unchanged
- **Receive:**
  - the receive payload gains an optional `toBinId` per line (Q3a), validated like Phase 1;
    otherwise `item.toBinId`
  - `moveUnits` gains a `binId` and places the arrived units there via `placeUnitsInBin`
    (keeping the non-assemblable stamp and guard), then recounts the destination bin
  - `BinMovementLog` per line: `toBinId`, reason "Transfer TRF-… received"
- **Receive screen** (`transfers/[id]/page.tsx`): each line shows its to-bin and allows changing
  it.

### Phase 3: outward by bin (R4, R5)

**Questions for this phase:** Q4 (who picks the bin), Q5 (bin-less units first or last). Defaults: Q4a the app picks and records it; Q5a bin-less first.


- **`sellDeliveryUnits`:**
  - picks bin-less units first (Q5a), then as today
  - reads each unit's `binId` **before** selling, and returns `{ sold, byBin: [{ binId, productId,
    qty }] }`
  - one `BinMovementLog` per bin × product: `fromBinId`, `toBinId: null`, reason
    "Outward <invoiceNo>", with `movedById`
- **Delivery detail** and the handover result: "Taken from L1 ×2, L3 ×1" per line, read back from
  `BinMovementLog` for that invoice.
- No change to the floor-only rule, holds or the short-floor refusal.

### Phase 4: moved

The audit part is `2209-audit-assigns-product-bin-plan.md`.

**Logging:** each new refusal at warn with `{ transferId | deliveryId, productId, binId }`; the
bin movements at info with counts.

**Board of agents:** warehouse consultant (dispatch, receive and handover by bin); inventory
consultant (unit ↔ bin ↔ stock sync); backend (validation, transactions, no N+1); frontend (the
bin pickers on `/transfers/new` and receive).

---

## 4. Verification

- `npx tsc --noEmit`; a rollback script on localhost `bch_local` for Phases 2–4; `npm run build`
  is run by the owner.
- **Phase 1:**
  - `/transfers/new` creates a transfer with bins
  - a from-bin holding too few is refused, naming the bins that hold the product
  - a to-bin from the wrong warehouse is refused
  - a rule-locked product's to-bin cannot be changed
- **Phase 2:** product P, bin A 5 and bin B 4 at the source; transfer 3 from A to floor bin F1 →
  - dispatch: A 2, B 4, and the 3 units in transit
  - receive: 3 units in F1, and F1's `BinStock` = 3
  - two `BinMovementLog` rows
  - nothing with `binId: null` left
- **Phase 3:** an outward of 2 when F1 holds 3 and one bin-less unit exists → the bin-less unit
  goes first, then 1 from F1; "taken from" shows it; the log rows are written.
- **Phase 4:** moved to `2209-audit-assigns-product-bin-plan.md` §4.
- `npm run db:check:unbinned` lists no new bin-less stock after a transfer.

---

## 5. Out of scope

- Moving stock already received with no bin (Q8a: count it into bins with a bin audit).
- Letting the person choose the bin at outward (Q4b), unless the owner picks it.
- Any change to the floor-only outward rule or to how the floor is chosen (the invoice prefix).
- The `/transfers` list layout (plan `2209-transfers-list-table-and-cards-plan.md`).
- The audited-product bin and the `/stock` bin filter (plan `2209-audit-assigns-product-bin-plan.md`).
