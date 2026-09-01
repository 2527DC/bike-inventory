# Audit mode — does this schema earn its place?

For "is this table needed", "should these tables be merged", "check my schema", or a full
sweep.

## Rule zero: a table is dead when no code path reaches it — not when it is empty

This distinction is the whole audit. An empty table may be a shipped feature nobody has used
yet. A table with thousands of legacy rows may be dead because nothing reads or writes it
any more.

**Establish reachability from source, never from row counts.**

## Step 1 — count references, then distrust the count

```bash
for m in $(grep '^model ' prisma/schema.prisma | awk '{print $2}'); do
  lc=$(echo "$m" | sed 's/^./\L&/')
  printf "%-28s %s\n" "$m" "$(grep -ro "prisma\.$lc\.\|tx\.$lc\." src/ scripts/ 2>/dev/null | wc -l)"
done | sort -k2 -n
```

**A zero is a hypothesis, not a verdict.** Prisma writes child rows through nested `create`
on the parent, so a perfectly healthy join table scores zero. Before calling anything dead,
hand-check for:

- nested writes — `grep -rn "<relationFieldName>:" src/` (the field name on the *parent*)
- reads through an `include`/`select` on a parent
- raw SQL — `grep -rn "queryRaw\|executeRaw" src/`
- seed and migration scripts under `prisma/` and `scripts/`
- **delegate indirection** — a helper that returns the model rather than naming it inline.
  `src/lib/staff-lms/question-routes.ts` does `delegate: () => prisma.lmsLessonQuestion`, so
  `LmsLessonQuestion` and `LmsWeeklyTestQuestion` score **0** on the grep above while having
  full create/update/delete routes. Search `grep -rn "prisma\." src/lib/` for factories
  before trusting any zero.

Known false positives in this schema — do not re-flag them:
`TransferOrderItem`, `PurchaseOrderItem`, `LedgerGapNote`, `LedgerGapEvidence`, `BrandVendor`
(all nested), `Permission`/`RolePermission`/`Module`/`Role` (low **because**
`src/lib/rbac.ts` centralises access — good architecture reading as a low number), and
`LmsLessonQuestion`/`LmsWeeklyTestQuestion` (reached through a delegate factory).

The question that survives all of this is narrow: **does anything ever write to it?**

## Step 2 — classify into tiers

| Tier | Meaning | Action |
|---|---|---|
| 1 | No code path at all | Delete |
| 2 | **Worse than dead** — schema promises a capability the app does not have | Wire it or drop it; say which |
| 3 | Dormant by explicit decision, documented somewhere | Leave; note the decision |
| 4 | Alive but redundant — N tables doing one table's job | Consolidate |
| 5 | Looks unwanted, is not (nested/centralised access) | Say so explicitly |

Tier 2 is the most dangerous and the easiest to miss. A schema that promises serial-number
history the app never records will be believed by the next developer.

## Step 3 — check the columns against the business

This is the part a generic tool cannot do. For each suspect table, ask:

1. **Who writes this row, and from which screen?** If you cannot name a screen or a route,
   that is the finding.
2. **What decision does anyone make by reading it?** A column nobody reads to decide
   anything is dead weight even in a live table.
3. **Does a column duplicate a value derivable from a relation?** `paidAmount` on
   `VendorBill` duplicates `sum(payments.amount)`. That is a deliberate cache — but it means
   the two can disagree, so it needs a reconciliation path. Flag derived-and-stored columns
   and check the write path keeps them in step.
4. **Is a nullable FK nullable for a real "linked later" reason?** `VendorPayment.billId` is
   legitimately null for an advance payment. Seven nullable FKs for a disabled feature
   (`Bin`) is not the same thing.

## When three tables should stay three

The recurring question on this schema is whether `VendorBill` + `VendorPayment` +
`VendorCredit` should collapse into one table with a `type` column. **They should not.**
Use this as the worked template for any "merge these tables" question:

**Test 1 — column overlap.** Count business columns (exclude `id`, `createdAt`,
`updatedAt`).

> Bill 13, Payment 10, Credit 7. Shared: `vendorId`, `amount`, `notes`, one date. A merged
> table needs 22 columns of which **18 are nullable**. Every NOT NULL you lose —
> `paymentMode`, `dueDate`, `recordedById` — becomes an `if` in a route handler that someone
> will forget.

**Test 2 — inbound foreign keys.** What points *at* the tables?

> `InboundShipment` (1:1), `VendorIssue`, `BankTransaction`, and `BrandLedgerEntry`'s three
> separate `billId`/`paymentId`/`creditId` columns. Merge, and every one becomes "FK to
> vendor_document" — nothing stops an `InboundShipment` pointing at a payment, and
> `VendorPayment.billId` becomes a self-reference where a payment can point at a payment.

**Test 3 — unique constraints.** Do they survive?

> `@@unique([vendorId, billNo])` and `@@unique([vendorId, creditNoteNo])` collapse into one
> nullable `docNo` that must allow nulls (payments have no document number), so it stops
> catching duplicate bills.

**Test 4 — lifecycle.** Does each type have its own state machine?

> A bill does (`BillStatus`, accumulating `paidAmount`, follow-up dates). A payment is an
> immutable event. **Documents with lifecycle get their own table; ledger events share one.**

**The merge is right when all four come out the other way** — high column overlap, no
type-specific inbound FKs, no per-type unique constraints, no lifecycle. That is exactly
`BrandLedgerEntry`, which correctly uses `type` + `direction` for INVOICE / PAYMENT /
CREDIT_NOTE, because it is an append-only mirror of a brand's statement.

It was also true of the three Zoho config tables (12 identical columns, no lifecycle), which
is why *that* consolidation was right and has since been done.

## Step 4 — the mechanical sweeps

These need a reachable `DATABASE_URL`. Print them for the user rather than running them.

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

Source-only equivalents that need no database:

```bash
grep -c 'Float' prisma/schema.prisma                 # money-as-float count
grep -c 'Decimal' prisma/schema.prisma
grep -c 'onDelete' prisma/schema.prisma              # vs relation count
```

## Anti-patterns worth naming when you see them

- **Money as `Float`** — the live defect in this schema (83 columns). See
  `docs/schema-review.md` §4 for the reproduction on this project's own Postgres.
- **Accumulator compared with `>=`** — `newPaidAmount >= bill.amount` on floats never
  settles. A hand-rolled epsilon (`remaining + 0.01`) is the fingerprint of someone having
  already hit this.
- **Unindexed foreign key** — 52 of 117 at last count.
- **JSON column that gets queried by string matching** — should be a relation.
- **An enum doing a table's job** — `StockLocation`; fine until the business adds a value at
  runtime, then it needs a deploy.
- **EAV** (entity/attribute/value triples) — never right here.
- **A status column with no state machine written down** — enumerate the legal transitions
  or the column is decoration.
- **Two tables that must agree, with no constraint making them agree.**

## Keep it in proportion

The last full audit found 2 genuinely dead tables out of 75 — low for a schema this size.
Say so when it is true. The findings that matter here are correctness (money types) and
integrity (unindexed FKs, missing `onDelete`), not tidiness. **Rank findings by what breaks,
not by how many you found.**

## Report format

```
## Schema audit — <scope> · <n> models · <date>

### Verdict
<one line>

### Tier 1 — dead
| Table | Writes | Reads | Evidence |

### Tier 2 — schema promises what the app lacks
### Tier 4 — redundant
### Correctness findings
### What is good
<name it; a schema this size having only N problems is information>

### Recommended order
| # | Action | Effort now | Cost if deferred | Risk if skipped |
```

Always include "what is good". An audit that only lists faults gets discounted, and the good
parts are what the next change has to avoid breaking.
