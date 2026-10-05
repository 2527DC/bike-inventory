# "Set system stock to the counts" stops timing out — unit codes are made in one batch, not one at a time

Status: in-progress — approved 5 Oct 2026 ("ok implemnt the implementation"); built and verified on a local restore of production (§6); committed on its branch 5 Oct, no PR yet. Test-database pass (§4.1–4.2) and the browser pass are the owner's.
Branch: `fix/0510-audit-apply-timeout`, created from `origin/main` at `99eebe2`.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (5 Oct 2026)

Passwords are redacted here — this file is committed. Nothing else is changed.

> '/Users/chethanr/Projects/BCH/bike-inventory/Screenshot 2026-10-05 at 7.12.27 PM.png'  i have 4000 + unit counted and in the stock audit made in the production but why its taking too mucth time to set it as the sytem and getting as zoho  time out but what is teh role of zoho in '/Users/chethanr/Projects/BCH/bike-inventory/Screenshot 2026-10-05 at 7.13.42 PM.png' in this to set the stock  i think it is respecte to application setting  the istem  respected to application right this is the things i am getting Timed out after 60s — Zoho may be slow, try again.dismiss when i set approve for Set system stock to the counts
> Every counted line becomes what bin ALL ACCESSORIES at Bch store holds. Other bins are not touched; the warehouse total moves by this bin's difference. Items without a code get one in this bin. An adjustment entry is written for each line that changes.

> no i am getting this erro check it once because it has 4000 Differences against current stock
>
> 17 lines differ · net +4050 units · 23 lines counted 0 to set it as the application levle i need u to fix this where we can do it this by making it like  taking teh copy of data of production datsbe to the test datsbd and we can check DATABASE_URL="postgresql://postgres.izighywsutktzarkfbiv:<redacted>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
> DIRECT_URL="postgATABASEresql://postgres.izighywsutktzarkfbiv:<redacted>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" is the production one and is the test databse # DATABASE_URL=postgresql://postgres.unsrnmykucotyoxnhdka:<redacted>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true
> # DIRECT_URL=postgresql://postgres.unsrnmykucotyoxnhdka:<redacted>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
>  into the test inport everything the production has even the zoho details

### 0.2 Restated as requirements

| # | Requirement |
|---|---|
| R1 | **Approving with "Set system stock to the counts" completes** for audit `cmuv9pt7g01wglb4jd68iwsxf` — 40 lines, 17 differ, net +4,050 units, 23 counted 0, bin ALL ACCESSORIES at Bch store — without timing out. The root cause is fixed, not the timeouts raised. |
| R2 | **Setting stock is an application-only action; Zoho plays no part** — and the error the screen shows must not say it does. |
| R3 | **Production's data is copied to the test database** (`unsrnmykucotyoxnhdka`) and the fix is proved there before it reaches production. Production (`izighywsutktzarkfbiv`) is only read. |
| R4 | **"Even the zoho details"** — production's Zoho connection is present on test. See §1 Q1: this reverses the 3 Oct decision and has a real consequence. |

---

## 1. Questions and clarifications

| # | Question | Why it changes the build | Options | Recommended default | Answer |
|---|---|---|---|---|---|
| Q1 | Copy production's **Zoho credentials** onto test (R4)? | The 0310 sync deliberately wipes them (owner, 3 Oct: "wipe them in test"). With them, **any Zoho action taken on test — push a bill, raise a PO, record a payment — writes to the real Zoho books**. There is no sandbox flag in the app. Zoho is not needed to prove this fix (§2.3). | (a) keep wiped · (b) after the sync, copy only `ZOHO_BOOKS` with `push-integrations.mjs --provider=ZOHO_BOOKS --yes` | (a) | default taken |
| Q2 | Should a bin of accessories still get **one `U-` code per item** (≈4,050 codes and labels for this audit)? | That is today's rule (plan 2109, R31: "Items without a code get one in this bin"). Changing it is a design change to unit tracking, not a timeout fix. | (a) keep — this plan only makes it fast · (b) separate plan for quantity-only bins | (a) | default taken |
| Q3 | Close the **double-approve window** while here (§2.4)? | A retry after a timeout is exactly what opens it: two approvals of one audit can both apply. | (a) yes, in this plan · (b) separately | (a) | default taken |
| Q4 | Timeout wording. | The browser says "Zoho may be slow" for **every** timeout in the app, Zoho or not (R2). | (a) one generic message for every screen · (b) generic, plus an optional per-call hint the Zoho screens keep | (a) | default taken |

### 1.1 Decisions on record

| Date | Question | Answer |
|---|---|---|
| 5 Oct 2026 | Q1–Q4 | Owner approved the plan ("ok implemnt the implementation") without answering them, so every recommended default stands: **Q1 (a)** Zoho credentials stay wiped on test; **Q2 (a)** one `U-` code per item kept; **Q3 (a)** double-approve guard built here; **Q4 (a)** one generic timeout message. |

---

## 2. How it works today — verified against the code, 5 Oct 2026

### 2.1 What the approval does

`PATCH /api/stock-counts/[id]` with `status: APPROVED, applyToStock: true` runs one interactive transaction, `src/app/api/stock-counts/[id]/route.ts:306`, timeout 120 s at `:590`. Per counted line it calls `applyBinCountLine` (`:423` → `src/app/api/stock-counts/_lib/apply-bin-line.ts:43`) → `syncWarehouseUnits` (`src/lib/units/sync.ts:73`), which, for a bin that holds fewer units than counted, calls `createUnits` for the difference (`sync.ts:127-128`).

**No Zoho call anywhere on this path** (R2). The message comes from the browser's generic client, `src/lib/api-client.ts:178`, which names Zoho for every timeout; the review page sets that timeout to 60 s, `src/app/(dashboard)/stock-audit/[id]/review/page.tsx:238`.

### 2.2 Why it is slow — one unit, three round trips, one table scan

`createUnits` (`src/lib/units/create.ts:46-62`) loops once per item:

1. `nextUnitCode` → `nextSequence` runs the **seed query on every call** (`src/lib/sequence.ts:102`): `SELECT MAX(regexp_replace(unit_code…))` over the whole `inventory_units` table (`sequence.ts:130`). The seed is only needed the first time a counter key exists; on every later call it is discarded (`sequence.ts:95-97`).
2. the counter upsert (`sequence.ts:112-117`);
3. `inventoryUnit.create`.

For this audit: ≈4,050 units × 3 sequential statements ≈ **12,150 round trips** inside one transaction, and the table scan grows from 325 to ≈4,375 rows as it goes (≈9.5 million `regexp_replace` evaluations). The cost scales with **units**, not lines — 17 lines is irrelevant.

The same loop serves inbound receiving — `src/app/api/inbound/[id]/route.ts:320` and `src/app/api/inventory/inwards/verify/route.ts:116` — so a large inbound is slow for the same reason. Shortages are already batched: `retireUnits` works in chunks of 1,000 (`src/lib/units/lifecycle.ts:118`).

### 2.3 What happened on production

- The browser gave up at 60 s; the server kept running until its transaction either committed or hit 120 s.
- `npm run db:sync:test` plan run, 5 Oct 2026: production holds **325** `inventory_units`. Had the approval committed it would hold ≈4,375. **It rolled back — production stock is unchanged** and the audit is still awaiting approval.
- Vercel runtime logs for that window are no longer retained, so the server-side error text could not be read.

### 2.4 The double-approve window

The status check is a read **before** the transaction (`route.ts:143`, transitions at `:205-215`); the final write is an unconditional `tx.stockCount.update({ where: { id } })` (`route.ts:578`). Two approvals of one audit — a retry while the first is still running — both pass the check. The counter row lock serialises them, so if the first commits, the second carries on and **applies the counts a second time** (≈4,050 more units). The delete handler already closes the same window with a status-conditioned write: `deleteMany({ where: { id, status } })` + `StaleDeleteError` (`route.ts:631`, `:673-674`).

---

## 3. Implementation plan

### 3.1 `src/lib/sequence.ts` — allocate a block

New `nextSequenceBlock(db, key, pad, seedSql, n): Promise<string[]>`:

- the seed read **once**;
- one statement: `INSERT INTO counter (key, current) VALUES ($key, $seed + n) ON CONFLICT (key) DO UPDATE SET current = counter.current + n RETURNING current` → the block is `current − n + 1 … current`. Same row lock, same no-read-then-write guarantee as `nextSequence` (`sequence.ts:24-31`);
- new `nextUnitCodes(db, n)` on top of it. `nextSequence` and `nextUnitCode` keep their signatures — 8 call sites use `nextSequence` and none of them changes.

### 3.2 `src/lib/units/create.ts` — insert in batches

- bin validation unchanged;
- `nextUnitCodes(tx, qty)` once;
- `tx.inventoryUnit.createManyAndReturn` (Prisma 6.19, PostgreSQL) in chunks of 1,000 rows — about a dozen columns × 1,000 rows stays well under Postgres's 65,535 bind parameters;
- returns ids **in code order**, as today (the label sheet relies on it) — sorted by the allocated code, not trusted to the insert's return order;
- `syncBinStock` and the `units created` info log unchanged; one `log.debug` with count and milliseconds.

Result for this audit: ≈4,050 units in ≈5 statements instead of ≈12,150. Inbound receiving gets the same speed-up with no change to its callers.

### 3.3 `src/app/api/stock-counts/[id]/route.ts` — claim the audit inside the transaction (Q3)

First statement inside the transaction, for a status change: `tx.stockCount.updateMany({ where: { id, status: existing.status }, data: { updatedAt: new Date() } })`. Count ≠ 1 → throw `StaleStatusError` → **409** "This audit changed while you were approving it — refresh the page." The row lock makes a concurrent second approval wait, then fail the status test once the first commits. Pattern copied from the delete handler (`:631`, `:673-674`). Logged at `warn` with `stockCountId`, `expected`, `userId`.

### 3.4 `src/lib/api-client.ts:178` — say what happened (Q4)

"Timed out after 60s — the server did not answer in time. Refresh to see whether it went through before trying again." No Zoho. `src/app/(dashboard)/bills/page.tsx:134` keeps its own Zoho wording — that screen does call Zoho.

### 3.5 Unchanged

The review page's 60 s and the transaction's 120 s — after §3.2 the approval should take seconds. Schema: none. Migration: none. RBAC: none.

### 3.6 Board of agents — checked

- `database-architect.md` — "N+1 query patterns" is exactly §2.2; "transaction-less multi-table writes": everything stays inside the existing transaction.
- `backend-engineer.md` — "stock mutation without idempotency guard (double-execution risk)" is §2.4, closed by §3.3; "updateMany without re-reading the result": the count is checked.
- `inventory-consultant.md` / `warehouse-consultant.md` — unit codes, bins, `BinStock` and the ledger rows are written exactly as today; only the number of statements changes.

---

## 4. Verification

All on **test** — `.env` must point at `unsrnmykucotyoxnhdka` while it runs, never at production.

1. **Copy (R3)** — owner runs `npm run db:sync:test -- --yes unsrnmykucotyoxnhdka`; then, only if Q1 = (b), the Zoho push.
2. **Reproduce, before the fix** — approve `cmuv9pt7g01wglb4jd68iwsxf` on test with "Set system stock to the counts": expect the 60 s timeout, then (after 120 s) the audit still awaiting approval and `inventory_units` still 325.
3. **After the fix** — same approval completes; then:
   - `inventory_units` = 325 + created, every new code unique and consecutive;
   - `bin_stocks` for ALL ACCESSORIES = the counted figures; `StockLevel` moved by each line's difference;
   - one `[STOCK_COUNT]` ADJUSTMENT row per changed line (17);
   - the receipt's "Codes created" and the label link match.
4. **Double approve** — two simultaneous approvals of a fresh copy of the audit: one 200, one 409; units created once.
5. **Inbound** — receive a line of 50 on test: 50 consecutive codes, bin recounted.
6. `npm run build` passes.
7. Production: PR → merge → deploy; then approve the audit on production once.

---

## 6. Build record — 5 Oct 2026

**Changed:** `src/lib/sequence.ts` (`nextSequenceBlock`, `nextUnitCodes`, shared `readSeed`; `nextSequence` behaves as before), `src/lib/units/create.ts` (one allocation + `createManyAndReturn` in 1,000-row chunks), `src/app/api/stock-counts/[id]/route.ts` (`StaleStatusError` claim at the top of the PUT transaction → 409), `src/lib/api-client.ts` (timeout wording).

**Verified on a local restore of production** — `pg_dump -n public` of `izighywsutktzarkfbiv` at 14:04 UTC (read only) → `backups/prod-izighywsutktzarkfbiv-20261005-140401-0510-verify.dump` → local `bch_verify_0510`, credentials wiped with the 0310 sync's wipe SQL, plus one local-only ADMIN login (`VERIFY0510`) that does not exist on production — logging in with it is what proved the dev server was on the local copy.

- The audit as it stands on production: `SC-202610-0012`, COMPLETED, 40 lines, counted 4,050, system 0, 17 differ; 325 units; counter 325. So the 7:13 PM approval did not commit (§2.3).
- **Timing, 4,050 units in bin ALL ACCESSORIES, rolled back:** old per-unit loop 8.5 s, new `createUnits` 0.2 s — on localhost, where a round trip is nearly free. On production every one of the old loop's ~12,150 statements also crosses Vercel → Supabase; the new path issues about five.
- **End to end, the real `PUT /api/stock-counts/[id]`** on `next dev`, two `{status: APPROVED, applyToStock: true}` requests sent at once: one **200 in 0.67 s**, one **409** ("This audit changed while you were saving it…") with the `warn` line logged. Afterwards: 4,375 units; the 4,050 new ones unique and consecutive `U-000326`…`U-004375`; counter 4,375; `bin_stocks` for the bin 4,050; `StockLevel` for the 17 products 0 → 4,050; 17 `[STOCK_COUNT]` ADJUSTMENT rows summing 4,050; audit APPROVED. Receipt: lines 40, changed 17, net +4,050, zero lines 23, codes created 4,050, 17 products given the bin.
- `scripts/db/verify-bin-count-r33.mjs` (run against the same local copy): **all checks passed** — split, no split, non-assemblable bin, shortage retiring, other bins untouched.
- `npx tsc --noEmit` clean; `npm run build` passes.

**Not done here:** §4.1–4.2 on the test database (the sync to test was refused by the session's safety check — the owner runs it), §4.5 inbound on test, the browser pass (no browser tool in the session).

---

## 5. Out of scope

- Raising either timeout — it would hide the cause and keep a minute-long transaction holding the counter lock.
- Quantity-only (code-less) bins — Q2 (b), a separate plan if wanted.
- Any Zoho change — Zoho is not on this path.
- Any write to production's database outside the normal app.
