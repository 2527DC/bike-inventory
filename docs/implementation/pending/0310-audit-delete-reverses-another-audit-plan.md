# Deleting a completed stock audit reverses a DIFFERENT, approved audit — 7002 shows 0 with 6 bicycles on the shelf

Status: pending — approved 3 Oct 2026 (Q1a, Q2a, Q3a, Q4b); building.
Branch: **`fix/0310-audit-delete-reversal`**, cut from `origin/main` at `06dde05`.

Every `file:line` below was read from disk on 3 Oct 2026. Every production figure was read from the
live database (Supabase project `izighywsutktzarkfbiv`) on 3 Oct 2026 with `SELECT` only.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (3 Oct 2026)

> i need u to check the databse where the stock here '/Users/chethanr/Projects/BCH/bike-inventory/Screenshot 2026-10-03 at 7.14.29 PM.png' is showing as the  0 even if i have 6 stock  which as unassmbled '/Users/chethanr/Projects/BCH/bike-inventory/Screenshot 2026-10-03 at 7.15.05 PM.png' and i  there is a stck transfer done respected to this check the databse i need to know what is the bug that  in the stock transfer when updating the stocks or making teh stock transfer i think the stock must update right  check it and tell me where  is the bug and how it must be fixed

> if this is the case then it should remove the related count as unassemble na and i need u to tell me  the stock transfer is done that is approved  to the bch warehosue gowdon to store ie flore then why is it still not reflected in the bch store warehosue bin  should it be dispatched

> and u think we cant delete the approved stock audit right then how can it be deleted and on delete   7002  as it shows 0  on deleted then why does it show the unassemble as 0

> fix the bug and yes they are 2 saparate  stock transfer

### 0.2 Restated as requirements

| # | Requirement |
|---|---|
| R1 | **7002 shows its real stock** on `/stock` and its detail page — 6 at Bch warehouse, the number its stock rows and its 6 unit records already hold — not 0. The same for every other product hit the same way. |
| R2 | **Fix the bug at its root:** deleting a stock audit must never change stock, a product's bin, or the ledger rows of a different audit. |
| R3 | **TRF-202610-0001 and TRF-202610-0002 are two separate transfers.** Both stay; neither is cancelled or merged. |
| R4 | **Stock transferred godown → floor shows in the floor's bin** once it arrives (asked, not yet decided for this plan — Q1). |

---

## 1. Questions and clarifications — answer before build

| # | For | Question | Why it changes the build | Options | Recommended |
|---|---|---|---|---|---|
| Q1 | R4 | Build "receive puts units into the line's to-bin" now, with this fix? | It is **already planned** as Phase 2 of `pending/2209-transfer-and-outward-by-bin-plan.md` (its R2, R3), with its own open questions (its Q2, Q3, Q8). Folding it in doubles this change. | (a) **separately, under the 2209 plan** — this fix ships alone and fast (b) both together | **(a)**. Consequence: if the two 7002 transfers are received before 2209 Phase 2 ships, the 4 bicycles land at Bch store **with no bin** and need one bin move (or a bin audit) into EMOTORAD. |
| Q2 | R1 | When the repair restores a product's total, does it write a ledger row? | The 30 Sep deletes destroyed the original `+6` row; without a new row the jump from 0 to 6 is unexplained on the detail page. | (a) **one `ADJUSTMENT` row per product, dated today**, notes `[REPAIR] …` naming this plan (b) no row (c) re-create the deleted rows back-dated to 30 Sep | **(a)**. (c) would put rows in the ledger that nobody wrote at that time. |
| Q3 | R1 | The reversal also **cleared the product's bin** (`Product.binId`). Restore it? | 7002 got its bin back from SC-202610-0001 on 2 Oct; other products from SC-202609-0003 may still have none ("Needs details" on `/stock`). | (a) **restore only where `binId` is empty and every live unit of the product sits in one bin** — set it to that bin (b) leave it; the next approved audit of the bin gives it back | **(a)** |
| Q4 | R1 | Who runs the repair against production, and when? | `.env` has **no active database URL** (every line commented; lines 2–3 are damaged: `D_URL=`, `postgATABASEresql://`, and an unencoded `@` in the password). The script reads `.env` like every `scripts/db/*` script. | (a) **owner** fixes `.env`, runs `npm run db:snapshot`, then the dry run, reviews it, then `--apply` (b) Claude runs it, with the owner's go-ahead per step | **(a)** |

### 1.1 Decisions on record

| Date | # | Answer |
|---|---|---|
| 3 Oct 2026 | R3 | Owner: "yes they are 2 saparate stock transfer" — both stay. |
| 3 Oct 2026 | Q1 | **(a)** — the audit fix ships alone; receive-into-to-bin stays with the 2209 plan, Phase 2. |
| 3 Oct 2026 | Q2, Q3 | **(a)**, the recommended defaults — one `[REPAIR]` row per product, dated today; bin restored only where empty and the live units sit in one bin. |
| 3 Oct 2026 | Q4 | **(b)** — Claude runs the snapshot, the dry run and `--apply`, with the owner's go-ahead before each step. `.env` needs a working database URL first. |
| 3 Oct 2026 | Q4 | Owner, after the production dry run (13 products, +49): **"dont aply it to product"** — rehearse on test instead. Production was copied to test (`0310-prod-to-test-sync-plan.md`) and the repair applied there: 13 repaired, 7002 → 6. **Production is not repaired**; snapshot `backups/postgres-20261003-143830.dump` was taken first. |

---

## 2. How it works today — verified against the code

### 2.1 What production holds for 7002 (`pr30cc18afffb3b6789b64c`), 3 Oct 2026

| Record | Value |
|---|---|
| `StockLevel`, Bch warehouse | **6** (updated 30 Sep 09:04 UTC) |
| `BinStock`, EMOTORAD @ Bch warehouse | 6 |
| `InventoryUnit` U-000110 … U-000115 | 6, `PUT_AWAY` in EMOTORAD, unassembled, created 30 Sep 09:04 UTC |
| `Product.currentStock` — what `/stock` shows | **0** ← wrong |
| `InventoryTransaction` rows | **0** ← the audit's `+6` row was deleted |

### 2.2 The sequence that produced it (Activity Log, UTC)

1. **30 Sep 08:36–09:04** — SC-202609-0003, bin EMOTORAD, is approved **with "apply to stock"**: 7002 counted 6 against 0 → 6 units created, `StockLevel` +6, `BinStock` 6, ledger `ADJUSTMENT` 0 → 6 with `referenceNo` = the audit's **title**, `Product.currentStock` 6, `Product.binId` = EMOTORAD.
2. **30 Sep 11:58, 12:58, 13:18** — SC-202609-0005, -0007 and -0009, three more audits of **the same bin**, reach **COMPLETED** and are later **deleted** (the log rows remain; the audits do not). The deletions themselves left no log row (§2.3).
3. Deleting a COMPLETED audit "reverses" it **by title**. All four audits carried the default title `Stock Count - Bch warehouse · Bin EMOTORAD`, so the first delete found **SC-202609-0003's** ledger row and: set `currentStock` to its `previousStock` (0), cleared `binId`, deleted the row. `StockLevel`, `BinStock` and the units were never touched — hence stock 0 beside A/U 0 / 6.
4. **2 Oct 11:04** — SC-202610-0001 counts 6 against a bin holding 6: no stock change; it gives 7002 its bin back (`assignBinToCountedProducts`).
5. **3 Oct 13:14 and 13:16** — TRF-202610-0001 and -0002, 7002 × 2 each, Bch warehouse → Bch store, EMOTORAD → EMOTORAD, challan 02 attached on both. **APPROVED, not dispatched.** They moved nothing (§2.4).

### 2.3 The defect

- The default title is the same for every audit of a bin: `stock-audit/new/page.tsx:103`
  (`` `Stock Count - ${warehouseName} · Bin ${binCode}` ``). It is editable, not unique.
- Stock is applied **only** on APPROVED with `applyToStock`: `api/stock-counts/[id]/route.ts:236-239`.
  Completing a count validates and timestamps only (`:332-345`); the branch that applied stock at
  Complete "ended 31 Jul 2026 and is gone" (`:338`). `zero-uncounted` writes no stock.
- The applied line's ledger row uses the title as its reference: `route.ts:483-493` (`referenceNo: existing.title`).
- An APPROVED audit cannot be deleted: `route.ts:638-640`.
- **Deleting a COMPLETED audit (`route.ts:642-689`):**
  - finds rows by `referenceNo: stockCount.title` + `[STOCK_COUNT]` (`:650-655`) — **any audit with the same title**;
  - writes `Product.currentStock = txn.previousStock` directly (`:665-672`) — the cache only, never `StockLevel`, so the cache and its source of truth part ways;
  - clears `Product.binId` when it equals this audit's bin (`:670`);
  - deletes the matched rows (`:676-681`);
  - writes **no Activity Log row and no log line** — the 30 Sep deletes are invisible.
  - A COMPLETED audit never applied stock, so **there is nothing of its own to reverse**. The block is a leftover from when Complete applied stock.
- The other two ledger deletes cannot have done this: `api/inventory/cleanup/route.ts:44-81` matches only Zoho rows, `api/inbound/[id]/route.ts:582` only the shipment's `INWARD` rows, and both also move `StockLevel`, which here is intact.

### 2.4 The transfers (R3, R4)

- Approval moves nothing: `api/transfer-orders/route.ts` POST header, item 2.
- Dispatch moves stock out of the source and recomputes `Product.currentStock` from `StockLevel`
  (`[id]/dispatch/route.ts:154-213` → `lib/transfers/stock.ts:38` → `adjustWarehouseQty`). Bch warehouse
  holds 6, both orders carry their challan (`:109-129`), so both will dispatch. **The first dispatch also
  re-derives 7002's total (6 − 2 = 4)** — a side effect, not a repair of other products.
- Receive puts arrived units in the destination with **no bin** and never reads the line's `toBinId`
  (`[id]/receive/route.ts:247-253`, `lib/units/lifecycle.ts:26-46`); dispatch ignores `fromBinId`
  (`lib/units/pick.ts` has no bin filter). Both are recorded in `pending/2209-transfer-and-outward-by-bin-plan.md` §2, Phase 2.

### 2.5 Every product the reversal hit (production, 3 Oct 2026)

SC-202609-0003 changed stock on **25** products; **all 25** lost their 30 Sep ledger row (no
`InventoryTransaction` for any of them between 30 Sep 09:00 and 2 Oct 11:04 UTC). On 2 Oct 11:04
SC-202610-0001's approval moved stock on 12 of them, and each move re-derives the cache
(`adjustWarehouseQty` → `recomputeCurrentStock`), so those 12 healed by accident. **13 are still wrong —
49 bicycles shown as 0:**

| SKU | Shown | Stock rows | | SKU | Shown | Stock rows |
|---|---|---|---|---|---|---|
| 4002 | 0 | 12 | | 7873 | 0 | 3 |
| 6955 | 0 | 10 | | 9446 | 0 | 2 |
| **7002** | 0 | **6** | | 6954 | 0 | 2 |
| 9116 | 0 | 4 | | 7001 | 0 | 1 |
| 7875 | 0 | 3 | | 9479 | 0 | 1 |
| 7951 | 0 | 3 | | 9835 | 0 | 1 |
| | | | | 7874 | 0 | 1 |

All 25 show `updatedAt` = 2 Oct 11:04:55 UTC: SC-202610-0001 gave every one of them its bin back
(`assignBinToCountedProducts`), which confirms the reversal had cleared all 25 bins. It also overwrote
the reversal's own timestamp.

**When:** after 30 Sep 11:58:17 UTC (17:28 IST — SC-202609-0005 completed, the first COMPLETED
same-title audit) and before 2 Oct 11:04:50 UTC (16:34 IST). The first deletion of a completed
EMOTORAD audit did it; the later ones found nothing left to match. The database holds no finer time.

**Who could:** deleting a COMPLETED audit needs `stock_audit.delete` + `stock_audit.approve`
(`route.ts:633`, `:644`). Two active users hold both, both role Administrator: `Administrator`
(admin@bch.local) and `Nithin`. Which of them is not recorded.

**Still live:** SC-202610-0001's 12 ledger rows carry the same title. Until Part A ships, deleting any
COMPLETED audit titled `Stock Count - Bch warehouse · Bin EMOTORAD` reverses them the same way.

---

## 3. Implementation plan

### Part A — the delete stops reversing (R2)

`src/app/api/stock-counts/[id]/route.ts`, `DELETE`:

- **COMPLETED branch:** remove the reversal (the `inventoryTransaction.findMany`, the `product.update`
  loop and the `inventoryTransaction.deleteMany`). It deletes the audit's items and the audit, in one
  transaction — the same as the plain branch. The permission rule stays: a completed audit still needs
  `stock_audit.approve` to delete (`:643-646`). A tombstone comment says why the reversal is gone.
- **Both branches** write `logActivity(tx, …)` inside the transaction: module `stock_audit`, action
  `deleted`, `entityRef` = `countNo`, `fromValue` = the status it had, `details` = its title. A failed
  log fails the delete (the `tx` contract in `lib/activity-log.ts`).
- `log.info("stock count deleted", { stockCountId, countNo, status })` after commit.
- Response becomes `{ deleted: true }`; `reversed` is dropped. Its only caller,
  `stock-audit/[id]/page.tsx:468-479`, reads only `error`.

Nothing else in `src/` matches ledger rows by audit title (`grep referenceNo` — the only readers are `:490`, `:652`, `:678`).

### Part B — the repair (R1), `scripts/db/repair-stock-total-drift.mjs`

`npm run db:repair:stock-total` — the `.env` connection read exactly as `backfill-vendor-contact.mjs`
reads it; prints host and database only, never the URL.

- **Dry run (default):** every product whose `currentStock` ≠ `SUM(StockLevel.quantity)` — SKU, name,
  shown, real, live units, current bin. Also lists products that Q3 would give a bin. Changes nothing.
- **`--apply --user <email>`:** per product, one transaction: `currentStock` = the sum (the same
  arithmetic as `recomputeCurrentStock`, `lib/stock-location.ts:23-32`); one `ADJUSTMENT` row
  (Q2a) — `previousStock` = shown, `newStock` = real, `referenceNo` `REPAIR-0310`, notes
  `[REPAIR] Cached total restored to its stock rows — a deleted completed audit had reversed an approved
  audit's ledger row by title (plan 0310-audit-delete-reverses-another-audit)`; the bin per Q3a.
  The notes deliberately do **not** carry `[STOCK_COUNT]`.
- **Idempotent:** a second run finds nothing.
- Order (Q4a): fix `.env` → `npm run db:snapshot` → dry run → review → `--apply`.

### Part C — not built here

Receive into the to-bin, dispatch from the from-bin: `2209-transfer-and-outward-by-bin-plan.md` Phase 2 (Q1a).

### Schema, migration, RBAC

None. No model, column or permission changes.

### Logging

`stock-counts:[id]` scope (existing logger in the route): `info` on every delete; the existing `error` on
failure stays. The script prints its own report.

### Board of agents

Read before marking done: `docs/agents/inventory-consultant.md` (audit and ledger rules),
`docs/agents/backend-engineer.md` (route, transaction, status rules),
`docs/agents/database-architect.md` (the repair's transactions and the cache invariant).

---

## 4. Verification

- `npm run build` passes (the build needs a reachable database — run it against a local restore).
- Code: the COMPLETED branch no longer references `inventoryTransaction` or `product`.
- Local, against a restore: approve audit A of bin X with "apply to stock"; complete audit B of bin X
  with the same title; delete B → A's ledger row, the product's total and its bin are unchanged, and the
  Activity Log shows `SC-… deleted`.
- Repair, locally first: dry run lists the drifted products; `--apply`; dry run again lists none; the
  product's detail page shows the `[REPAIR]` row.
- Production, after the snapshot: 7002 shows **6** (or **4** / **2** if a transfer was
  dispatched first — dispatch re-derives it), A/U still 0 / 6, ledger shows the repair row.

### 4.1 Done 3 Oct 2026, against a local restore (`bch_investigate_1003`, schema up to date)

- `npm run build` — passed (compiled, TypeScript clean), `DATABASE_URL` pointed at the restore.
- Part A, through the built app (`next start -p 3100`) and a real login: approved audit A (`[STOCK_COUNT]`
  row on product 7413, total 7, bin set) and completed audit B, **same title, same bin**.
  `DELETE` B → 200 `{deleted:true}`; 7413 still 7, bin unchanged, A's ledger row intact, A still
  APPROVED; Activity Log `stock_audit · deleted · SC-TEST-B · COMPLETED`; server log
  `stock count deleted`. `DELETE` A → 403 "Cannot delete an approved stock count".
- Part B: product 7420 set to shown 0 / no bin (the incident's damage) → dry run lists it
  "0 → 9, no bin → KDNJD"; `--apply` without `--user` refused; `--apply --user` → 9, original bin back,
  one `ADJUSTMENT` `REPAIR-0310` row 0 → 9; second dry run lists none.
- Not done: clicking Delete on `/stock-audit/[id]` in a browser — the screen is unchanged (it reads only
  `error`); the endpoint it calls was exercised above.

---

## 5. Out of scope

- Receive into the to-bin and dispatch from the from-bin — `2209-transfer-and-outward-by-bin-plan.md` Phase 2.
- Making audit titles unique, or moving the ledger reference from title to `countNo`. With the reversal
  gone nothing matches on the title, so neither is needed to fix R2.
- Re-creating the deleted 30 Sep ledger rows back-dated (Q2c).
- Repairing `.env` — the owner's file.
- `Product.reservedStock` drift — not part of this incident; the dry run does not touch it.
