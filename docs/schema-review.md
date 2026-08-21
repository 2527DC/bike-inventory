# Schema review — `bch_management`

**Date:** 21 Aug 2026
**Scope:** `prisma/schema.prisma` (2,300 lines) audited against the live Postgres.
**Method:** every number below was measured by querying the database directly
(`information_schema`, `pg_constraint`, `pg_index`, exact `COUNT(*)`), not read off the
schema file. The float behaviour in §4 was reproduced on this project's own Postgres.

> ### ⚠ Read this before acting on anything here
>
> The audit ran against the database in `.env` — **`localhost:5432/bch`**, a local dev
> instance. Its tables are almost entirely empty, and that fact drives most of the
> recommendations: it makes structural fixes nearly free.
>
> **If Supabase production holds real data, re-run the audit against it first.** Every
> "cheap to fix now" conclusion becomes "locking migration on live financial data" instead.

---

## 1. Size

| | |
|---|---|
| Tables | **75** |
| Enums | 38 |
| Columns | 924 |
| Indexes | 263 |
| Foreign keys | 117 |

**70 of the 75 tables are empty.** The only rows anywhere are the access-control seed:

| Table | Rows |
|---|---:|
| `role_permissions` | 194 |
| `permissions` | 136 |
| `modules` | 36 |
| `roles` | 8 |
| `User` | 1 |

This is the single most important fact in the document. Every problem below is structural,
and structural problems are cheap to fix while the tables are empty and expensive afterwards.
**This is the cheapest this work will ever be.**

---

## 2. What is good

Stating this plainly first, because the rest of the document is a problem list and that would
otherwise give a false impression. This is not a bad schema.

### 2.1 The RBAC model — the best thing in the codebase

```
Module 1─* Permission *─* Role 1─* User      one user = one role
              └ RolePermission ┘             a row's existence IS the grant
```

Permissions are **data, not code**. There is no `Role` enum, no hardcoded permission map, and
no role name compared anywhere in `src/`. A revoked grant takes effect on the next request
with no redeploy, because `src/lib/rbac.ts` reads from the database per request and refuses to
put permissions in the JWT.

The join table carries no boolean — a grant is a row, and revoking is a delete — so the table
never accumulates `false` noise. Most teams get this wrong. This one is right.

### 2.2 Idempotency expressed as constraints

Uniqueness is used to make retries safe rather than leaving it to application logic:

| Constraint | Prevents |
|---|---|
| `@@unique([vendorId, billNo])` on `VendorBill` | the same bill entered twice |
| `@@unique([brandId, vendorId])` on `BrandVendor` | duplicate brand/vendor pairings |
| `@@unique([productId, location])` on `StockLevel` | two stock rows for one product+site |
| `@@unique([storeId, businessDate])` on `FootfallDaily` | a double-run rollup |

### 2.3 Indexing was thought about — 263 indexes across 75 tables

Composite indexes like `@@index([status, brandId, expectedDeliveryDate])` on `InboundShipment`
show real query planning, not a default. The foreign-key gap in §3.1 is a specific blind spot,
not general carelessness.

### 2.4 Consistent enum-driven lifecycles

38 enums, and nearly every entity carries a status enum rather than a free-text string:
`POStatus`, `BillStatus`, `DeliveryStatus`, `SettlementStatus`, `JobStatus`, `GapStatus`. The
set of legal states is in the schema where it can be enforced, not in a validator someone can
forget to call.

### 2.5 The documentation matches reality

`CLAUDE.md` claims `Customer.phone` is required and unique. Verified: `is_nullable = NO`, with
a unique index present. Documentation that is actually true is rarer than it should be.

---

## 3. What is not good

Ordered by cost-to-fix-now versus cost-to-fix-later.

### 3.1 52 of 117 foreign keys have no index — 44% of them

**This is the largest concrete defect.**

**Postgres does not automatically index foreign keys.** MySQL/InnoDB does, which is where the
assumption usually comes from. Postgres indexes the *referenced* primary key, never the
*referencing* column.

Two consequences, and the second is the one that hurts:

1. Every join across those columns is a sequential scan.
2. Every **delete or update of a parent row** must scan the entire child table to enforce the
   constraint.

Your delete rules are **53 `RESTRICT`, 46 `SET NULL`, 18 `CASCADE`** — so **99 of 117
relationships trigger a child-table scan** when a parent row is touched. Deactivating one
`User` scans roughly twenty tables, none of them indexed on that column.

**Hot-path examples, not just audit columns:**

| Unindexed FK | What it slows |
|---|---|
| `StockCountItem.stockCountId`, `.productId` | the join behind *every* stock count |
| `VendorBill.purchaseOrderId` | PO → bill lookup |
| `brand_ledger_entries.brandId`, `.billId`, `.paymentId`, `.creditId` | the whole ledger reconciliation feature |
| `Category.parentId` | the category tree |
| `Product.binId`, `SecondHandCycle.binId`, `InboundLineItem.binId` | bin/location lookups |

**The user-audit columns** (`createdById`, `approvedById`, `recordedById`, `verifiedById`,
`uploadedById`, `putawayById`, `deliveredById`, `reviewedById`, `authorId`, `mechanicId` …)
account for roughly half the list and appear on almost every table.

**Fix:** one `@@index([fieldId])` per foreign key. About 52 lines of schema, `db push`,
instant on empty tables. On a populated `brand_ledger_entries` it is a locking migration.

*Note: the four analytics models added during the merge do index their FK (`deviceId`) — the
pattern to follow already exists in the file.*

### 3.2 Money is stored as `double precision`

70 columns. Covered in full in §4 — it has its own section because the failure mode is subtle
and the consequences are financial.

### 3.3 `StockLocation` is an enum doing a table's job

Stores are an enum value: `BCH_STORE`, `BCC_STORE`, `BCH_WAREHOUSE`, `BCC_WAREHOUSE`, plus
`STORE` and `WAREHOUSE` which the schema comment marks as dead legacy but which remain legal
values nothing prevents writing.

**An enum value cannot carry attributes**, and attributes are already needed:

- **Opening hours** — store-analytics coverage % needs them per store. They currently live in
  a single global environment variable, which is wrong the moment two stores keep different
  hours.
- Address, GSTIN, timezone, contact person
- Whether the site even has a countable entrance

**Worse: the financial tables have no store column at all.** `PosSession`, `CustomerInvoice`,
`Expense` and `DailySettlement` are estate-wide. Footfall can be attributed to a store; the
bills it should be compared against cannot. The analytics dashboard has to *withhold* the bill
count once a second store starts counting, rather than publish a number computed from the
wrong denominator (see `analytics-merge-plan.md` §3.2a).

**Why this matters more than it looks:** the store-analytics project exists because the owner
said *"before expanding past 4 stores I need to see per-store walk-ins and conversion"*
(`requirements-v2.md` §2). **The expansion the project is meant to unlock is the same
expansion the schema is not shaped for.** Two sites is exactly where an enum stops being
adequate.

A `Store` table is its own piece of work — not part of any feature merge — but it should land
before store 5, and ideally while the tables are still empty.

### 3.4 There is no migration history

There is no `prisma/migrations/` directory. The workflow is `prisma db push`, as recorded in
`docs/agents/database-architect.md`.

For an application that will hold financial records this means:

- no reproducible path from an empty database to the current schema
- no rollback
- no record of what changed, when, or why
- **`prisma migrate dev` is actively dangerous here.** With no `_prisma_migrations` table it
  reports drift and offers to **reset the database** — dropping every table in the app. Use
  `db push`, and preview with `prisma migrate diff … --script` first.

Baselining now, at near-zero rows, is as cheap as it will ever be.

### 3.5 Table naming is split down the middle

**52 tables are PascalCase** (`Customer`, `Product`, `BankTransaction`) and **23 are
snake_case via `@@map`** (`modules`, `service_jobs`, `brand_ledger_entries`). Newer models
adopted the convention; older ones never did.

The practical cost is raw SQL. Postgres folds unquoted identifiers to lower case, so:

```sql
SELECT * FROM Customer;      -- ERROR: relation "customer" does not exist
SELECT * FROM "Customer";    -- works
SELECT * FROM service_jobs;  -- works, no quotes needed
```

A query pattern that works in one place fails in another for reasons unrelated to the query.
Free to normalise while empty; a rename migration later.

### 3.6 Three near-identical integration config tables

`ZohoConfig`, `ZakyaConfig`, `ZohoInventoryConfig` — **12 columns each, all empty, all the
same shape.** Almost certainly one `IntegrationConfig` with a `provider` enum. Three tables
means three sync-status code paths that will drift apart.

All three are actively referenced (9–12 call sites each), so this is redundancy rather than
dead code — see §5.5.

---

## 4. `double precision` and money — the effect explained

### 4.1 What the two types actually are

| | `double precision` (Prisma `Float`) | `numeric` (Prisma `Decimal`) |
|---|---|---|
| Representation | **Binary** floating point (IEEE 754) | **Decimal** digits, stored exactly |
| Stores 0.1 exactly? | **No** | Yes |
| Arithmetic | Approximate, error compounds | Exact |
| Speed | Faster (CPU native) | Slower (software) |
| Right for | measurements, scores, ratios | **money, anything counted in decimal units** |

`double precision` stores a number as a sum of powers of two. In binary, `0.1` is a repeating
fraction — exactly as `1/3` is `0.333…` forever in decimal. It cannot be stored exactly, so it
is stored *approximately*, and every operation compounds the error.

Money is a decimal quantity. Rupees and paise are decimal units. It needs a decimal type.

### 4.2 Reproduced on this project's Postgres

```
float8 : 0.1 + 0.2 = 0.30000000000000004   equals 0.3?  false
numeric: 0.1 + 0.2 = 0.3                   equals 0.3?  true
```

### 4.3 What it does to a settlement

A thousand cash sales of ₹0.10 — a drawer that balances exactly:

```
float8 total  : 99.9999999999986     <-- not 100
numeric total : 100.00
cashVariance against a counted Rs 100.00 : -0.0000000000014
```

`DailySettlement.cashVariance` is non-zero on a drawer that balanced. The record lands on
`DISCREPANCY` instead of `FULLY_MATCHED`, and a staff member is asked to account for a hole
that does not exist. `SettlementMatch.isMatched` has exactly the same shape — it is a boolean
derived from a float comparison.

**Reconciliation is the worst possible workload for floats**, because it compares two
independently computed totals for equality. That is precisely the operation binary floating
point cannot be trusted with, and it is the core of the accounts module.

### 4.4 Why it is dangerous rather than merely wrong

```
Rs 14,999.99 x 3
  float8  : 44999.97
  numeric : 44999.97      <-- identical
```

**Float does not fail every time. It fails unpredictably.**

Tests pass. The first several hundred invoices look correct. Then one settlement in March is
off by a paisa, nobody can reproduce it, and the number that is wrong is a number about money.
A bug that failed consistently would have been caught in week one.

### 4.5 The 80 columns, classified

| Class | Count | Verdict |
|---|---:|---|
| **Money** | **70** | **Must become `numeric`** |
| Percentage / tax rate | 7 | Should become `numeric` — GST rates are exact |
| Confidence score | 3 | **`Float` is correct — leave alone** |

**Keep as `Float`:** `BankTransaction.confidence`, `BrandStockItem.matchConfidence`,
`count_events.confidence`. These are model scores where approximation is inherent and
`0.7000001` means nothing different from `0.7`.

**Percentages:** `Brand.cdPercentage`, `Vendor.cdPercentage`, `Product.gstRate`,
`PurchaseOrderItem.gstRate`, `InboundLineItem.gstPercent`, `vendor_discount_terms.percentage`,
`InboundLineItem.rate`. A GST rate of 18% multiplied against a float price reintroduces the
error even if the price itself is exact — so these follow the money.

**Money columns, by table:**

| Table | # | Columns |
|---|---:|---|
| `PosSession` | 14 | cardSales, cashDeposited, cashDiscrepancy, cashIn, cashInHand, cashOut, cashRefunds, cashSales, countedCash, creditSales, expectedCash, financeSales, totalSales, upiSales |
| `DailySettlement` | 12 | cashCounted, cashIn, cashOut, cashVariance, grandTotal, matchedAmount, totalCard, totalCash, totalCredit, totalFinance, totalUpi, unmatchedAmount |
| `Product` | 3 | costPrice, mrp, sellingPrice |
| `PurchaseOrder` | 3 | grandTotal, gstTotal, subtotal |
| `SettlementMatch` | 3 | expectedAmount, matchedAmount, variance |
| `BankStatement` | 2 | totalCredits, totalDebits |
| `BankTransaction` | 2 | amount, balance |
| `BrandStockItem` | 2 | brandMrp, brandPrice |
| `CustomerInvoice` | 2 | amount, paidAmount |
| `Delivery` | 2 | courierCost, invoiceAmount |
| `InboundLineItem` | 2 | amount, gstAmount |
| `PurchaseOrderItem` | 2 | amount, unitPrice |
| `SecondHandCycle` | 2 | costPrice, sellingPrice |
| `Vendor` | 2 | creditLimit, openingBalance |
| `VendorBill` | 2 | amount, paidAmount |
| `VendorCredit` | 2 | amount, usedAmount |
| `VendorPayment` | 2 | amount, cdDiscountAmount |
| `brand_statements` | 2 | claimedClosing, computedClosing |
| `service_jobs` | 2 | amount, estimatedHrs¹ |
| `CustomerPayment`, `Expense`, `InboundShipment`, `brand_ledger_entries`, `ledger_gaps`, `price_items`, `vendor_discount_terms` | 1 each | amount / totalAmount / price / perUnitAmount |

¹ `estimatedHrs` is a duration, not money — the classifier grouped it by elimination. `Float`
is defensible there; `Decimal(4,2)` is tidier.

### 4.6 The fix

```prisma
// money
amount     Decimal @db.Decimal(12, 2)   // up to 99,99,99,999.99

// tax and discount rates
gstRate    Decimal @db.Decimal(5, 2)

// model scores — unchanged
confidence Float?
```

**Always give `@db.Decimal(p, s)` explicitly.** A bare `Decimal` in Prisma defaults to
`numeric(65,30)`, far wider and slower than anything here needs.

### 4.7 The honest cost

**In the database: free right now.** The tables are empty, so it is a type change and a
`db push`.

**In application code: roughly a day.** Prisma returns `Decimal` as a **Decimal.js object, not
a number**:

```ts
a + b                    →  a.plus(b)
a * qty                  →  a.times(qty)
if (x === y)             →  if (x.equals(y))
if (x > y)               →  if (x.greaterThan(y))
JSON.stringify(amount)   →  serialises as a string; the frontend needs Number(...)
```

TypeScript finds every one of these — `Decimal` has no `+` operator, so `tsc --noEmit` lists
the complete set of call sites. It is mechanical work, not detective work.

**If a full sweep is too much**, the highest-value subset is the reconciliation cluster alone:
`PosSession`, `DailySettlement`, `SettlementMatch`, `BankTransaction`. That is **31 of the 70
columns** and covers every place a variance is computed — which is where the damage actually
occurs.

`docs/agents/database-architect.md` currently advises *"this codebase already uses Float
consistently, so maintain the pattern."* That was correct guidance under the assumption of
live data. At 70-of-75 tables empty the assumption does not hold, and the note should be
updated once this is done.

*(Alternative worth knowing: store paise as `BigInt` and divide only for display. Also exact.
`numeric` is preferred here because it is Postgres-native, sums and sorts correctly in raw
SQL, and needs no convention that every reader has to remember.)*

---

## 5. Table inventory — what earns its place

### 5.1 Method

Every `prisma.<model>` and `tx.<model>` reference across `src/` was counted, then every
low-scoring model was hand-checked for nested-relation access, which that count cannot see.

**A low reference count is not evidence that a table is unwanted.** Prisma writes child rows
through nested `create` on the parent, so a healthy join table legitimately scores zero. The
question that matters is narrower: **does anything ever write to it?**

### 5.2 Tier 1 — genuinely dead

| Table | References anywhere | What it is |
|---|---:|---|
| `DailySnapshot` | **0** | Three columns; a singleton `"latest"` row holding a markdown blob |
| `TaskAssignment` (`task_assignments`) | **0** | Mechanic day-assignments, ported from `bch-service` |

Neither appears in `src/`, `scripts/` or anywhere in `prisma/` except its own model
definition.

`TaskAssignment` is the instructive one. It was carried across in the service merge and
*improved* on the way in — its schema comment reads *"The standalone app left this as a bare
string with no FK, so a deleted mechanic left orphan rows behind. Made a real relation during
the merge."* Careful work, on a table no screen and no route has ever touched. It is also
listed among the service models in `CLAUDE.md`, which makes it look live to a reader.

**Action: delete both.**

### 5.3 Tier 2 — worse than dead: the schema promises a capability the app lacks

| Table | Problem |
|---|---|
| `SerialTransactionItem` | The only code that touches it is `tx.serialTransactionItem.deleteMany({})` in `api/zoho/import/clean/route.ts` |

Nothing ever creates a row. This table is the join between `InventoryTransaction` and
`SerialItem` — the per-serial audit trail. `SerialItem` itself is live (11 references, with a
UI at `/stock/[id]/serials`), so the schema reads as though the system can answer *"which
transaction moved this exact frame number."*

It cannot. The table is only ever emptied.

That is more dangerous than a dead table. A dead table misleads nobody; this one misleads
anyone reading the schema — including whoever next builds a warranty claim or theft
investigation on the assumption that serial history exists.

**Action: wire the writes or drop the table. Leaving it as-is is the only bad option.**

### 5.4 Tier 3 — dormant by explicit decision

**`Bin`** — 14 references, every one of them behind `BIN_TRACKING_ENABLED = false`.
`src/lib/inventory-config.ts` is candid about it:

> *"Bin-level tracking is intentionally DORMANT (not deleted). The Bin model, its API routes,
> and the per-unit allocation flow all remain in the codebase… Flip this to true to bring bins
> back."*

That is a legitimate choice, but it should be costed honestly. It is not one table — it is
**seven nullable foreign-key columns spread across six other tables**:

```
Product.binId              SerialItem.binId        StockCount.binId
SecondHandCycle.binId      InboundLineItem.binId
TransferOrderItem.fromBinId    TransferOrderItem.toBinId
```

**Six of those seven are in the 52 unindexed foreign keys from §3.1.** A disabled feature is
contributing roughly 12% of the FK index debt, and every one of those columns is a nullable
field a developer must reason about on tables they *are* working on.

**Action: keep only if bin tracking is genuinely on the roadmap.** If it is aspirational,
this is the cheapest moment to remove it — the tables are empty.

### 5.5 Tier 4 — not dead, but three tables doing one table's job

`ZohoConfig` · `ZakyaConfig` · `ZohoInventoryConfig` — **12 columns each, identical shape, all
three actively referenced** (9–12 references apiece), all three empty. This is the same finding
as §3.6, restated here because it is a table-inventory question rather than a design one.

The cost is not storage. It is three OAuth token-refresh paths, three sync-status checks, and
three places to fix the same bug.

Weaker relatives worth a look at the same time: `SyncLog` (26 refs), `ZohoPullLog` (12) and
`ZohoPullPreview` (24) are three log/staging tables around one integration. They do have
distinct jobs — approval gate vs pull record vs generic sync log — so they are not unwanted,
but they deserve a deliberate review when the configs are consolidated.

**Action: one `IntegrationConfig` with a `provider` enum.**

### 5.6 What looks unwanted but is not

Stated explicitly, because a naive reference count flags all of these:

| Table | Refs | Why it is fine |
|---|---:|---|
| `TransferOrderItem` | 0 | Written via nested `items:` on `TransferOrder` — standard Prisma |
| `LedgerGapNote`, `LedgerGapEvidence` | 0 | Same, nested under `LedgerGap` |
| `BrandVendor` | 0 | Reached through the `Brand` / `Vendor` relations |
| `PurchaseOrderItem` | 1 | Nested under `PurchaseOrder` |
| `Permission`, `RolePermission`, `Module`, `Role` | 1–2 | Low **because** `src/lib/rbac.ts` centralises every access. Good architecture showing up as a low number |
| `FootfallDaily` | 0 | Added in the analytics merge; phase 7 populates it. Ahead of its code, not dead |

### 5.7 Summary

Of 75 tables: **2 are dead, 1 is broken, 1 is dormant, and 3 should be 1.**

| Action | Tables | Effort |
|---|---|---|
| Delete | `DailySnapshot`, `TaskAssignment` | 10 min |
| Wire or drop | `SerialTransactionItem` | 10 min to drop |
| Keep or cut | `Bin` + 7 FK columns | ~1 hour to cut |
| Consolidate 3 → 1 | `ZohoConfig`, `ZakyaConfig`, `ZohoInventoryConfig` | ~2 hours |

Full cleanup takes the schema from **75 tables to 71**, and removes 6 of the 52 unindexed
foreign keys as a side effect.

**Keep this in proportion.** Two genuinely dead tables out of 75 is a low amount of dead
weight for a schema this size — better than most codebases of comparable scope. The cleanup
in this section is tidying. The problems that actually matter are §3.1 (unindexed foreign
keys) and §4 (money stored as floating point); those are performance and correctness.

---

## 6. Recommended order of work

| # | Action | Ref | Effort now | Effort after go-live | Risk if skipped |
|---|---|---|---|---|---|
| 1 | Index the 52 unindexed foreign keys | §3.1 | ~1 hour | locking migrations | Slow joins; slow deletes on 99 of 117 relations |
| 2 | Delete `DailySnapshot` and `TaskAssignment` | §5.2 | 10 min | 10 min | Dead schema read as live |
| 3 | Wire or drop `SerialTransactionItem` | §5.3 | 10 min | grows | **Schema promises serial history the app never records** |
| 4 | Baseline `prisma/migrations/` | §3.4 | ~1 hour | painful | No rollback, no reproducible deploy |
| 5 | `Decimal` for the money columns | §4 | ~1 day (app code) | very expensive | **Wrong money. Phantom settlement discrepancies.** |
| 6 | Normalise table naming | §3.5 | ~2 hours | rename migration | Raw SQL footguns |
| 7 | Decide on `Bin` — keep or cut | §5.4 | ~1 hour | rising | 7 nullable FKs for a disabled feature |
| 8 | Merge the 3 integration config tables | §3.6, §5.5 | ~2 hours | low either way | Three drifting sync paths |
| 9 | `Store` table replacing the enum | §3.3 | ~2 days | blocks expansion | Cannot attribute revenue per store |

**Items 1, 2 and 4 are close to pure profit** — mechanical, additive, and they never get
cheaper than they are today.

**Item 3 is the one that protects money**, and it is also the one whose cost rises fastest:
converting a float column that already holds thousands of transactions means migrating values
that were never exact to begin with, with no way to recover the intended figures.

---

## Appendix — how to re-run this audit

Against production rather than localhost, point `DATABASE_URL` at Supabase and re-run. The
queries used were:

```sql
-- foreign keys with no supporting index
SELECT c.conrelid::regclass::text AS tbl, a.attname
  FROM pg_constraint c
  JOIN unnest(c.conkey) AS k(attnum) ON true
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
 WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
   AND NOT EXISTS (
     SELECT 1 FROM pg_index i
      WHERE i.indrelid = c.conrelid
        AND (i.indkey::int2[])[0:array_length(c.conkey,1)-1] @> c.conkey);

-- money stored as floating point
SELECT table_name, column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND data_type = 'double precision';

-- delete-rule spread
SELECT rc.delete_rule, COUNT(*) FROM information_schema.referential_constraints rc
  JOIN information_schema.table_constraints tc USING (constraint_name)
 WHERE tc.table_schema = 'public' GROUP BY 1;
```
