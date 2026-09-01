# The business this schema serves

Read this before any schema opinion. Most bad schema advice is generically correct advice
applied to the wrong business.

## What BCH actually is

A **bicycle dealership in India** — retail counter, warehouse, and a service workshop —
buying from bicycle brands (vendors) and selling to walk-in and B2B customers. Accounts are
mirrored into **Zoho Books / Zakya**, so some tables are shaped by what Zoho returns rather
than by what would be ideal.

## Real scale — design for this, not for a hypothetical

| | |
|---|---|
| Products | ~500 |
| Transactions | ~2,000 / month |
| Deliveries | ~50 / week |
| Concurrent users | ~10 |
| Models | 92 |
| Indexes | ~263 |

**This is a small database.** Postgres on Supabase will not struggle. That has consequences
for advice:

- **Never recommend sharding, partitioning, read replicas, caching layers, or
  materialised views.** At 2,000 rows a month a sequential scan is instant.
- **Never recommend denormalising for performance.** There is no performance problem to
  solve. Denormalise only when it makes a business rule expressible.
- **Do recommend indexes on foreign keys anyway** — they matter for join plans and for
  cascade-delete checks even at this size, and they never get cheaper to add.
- **Correctness beats throughput every time.** The expensive failure mode here is a bill
  showing the wrong balance, not a slow page.

## Domain groups and their rules

### Purchasing and payables
`Vendor` → `PurchaseOrder` → `VendorBill` → `VendorPayment`, plus `VendorCredit`.

- A **bill** is a document with a lifecycle (`PENDING → PARTIALLY_PAID → PAID → OVERDUE`),
  an accumulating `paidAmount`, and follow-up scheduling. It owns state.
- A **payment** is an immutable event. One payment may be allocated across several bills
  (FIFO, see `src/app/api/payments/route.ts`), so payment→bill is many-to-one today and the
  multi-bill case is modelled by writing one payment row per allocation.
- A **credit note** is a document with a balance (`amount` vs `usedAmount`) drawn down by
  payments.
- **Cash discount (CD)** is a real business term here: pay within `cdTermsDays` and earn
  `cdPercentage` off. It is money, and `cdDiscountAmount` counts toward settling the bill.
- **`billedTo`** distinguishes "HUB" from "CENTRE" — two billing entities.

These three tables are **correctly separate**. See `audit.md` → "When three tables should
stay three".

### Brand ledger reconciliation
`BrandLedgerEntry`, `BrandStatement`, `LedgerGap`.

This is the sharp end of the business: brands send statements, BCH reconciles them against
its own books and pursues unpaid discounts and credit notes. Design rules specific to it:

- `BrandLedgerEntry` is **an append-only mirror of what the brand sent**. It is never edited
  to match BCH's books. That is why it correctly uses the single-table-with-a-`type`-column
  shape (`LedgerEntryType`, `direction`, `amount`) — no lifecycle, no per-type required
  fields.
- `direction` is stored, not derived from `type`, because brands sometimes post a credit on
  a sales voucher.
- `LedgerMatchStatus.NEEDS_REVIEW` deliberately does **not** mean "discrepancy". The system
  surfaces ambiguity and never concludes. Do not add a schema element that forces a verdict.
- `LedgerGap` is the claim register. `GapTier` grades how hard a claim can be pressed.

### Inventory
`Product`, `StockLevel`, `SerialItem`, `InventoryTransaction`, `StockCount`, `Bin`,
`TransferOrder`, `InboundShipment`.

- `InboundShipment` has a **1:1 to `VendorBill`** — goods are received against a bill.
- `Bin` exists with 7 nullable FK columns for a feature that may be disabled; check before
  building on it (`docs/schema-review.md` §5.4).
- `StockLocation` is an enum doing a table's job (§3.3) — a known limitation that blocks
  per-store revenue attribution.

### Retail and settlement
`Customer`, `CustomerInvoice`, `CustomerPayment`, `PosSession`, `DailySettlement`,
`SettlementMatch`, `Delivery`, `PreBooking`, `SecondHandCycle`.

Settlement is where float error becomes visible as a phantom discrepancy — this is the
concrete harm behind the `Decimal` rule.

### Service workshop
`ServiceJob`, `Review`, `PriceItem`, `AssemblyLog`, `TokenCounter`, `ServiceAuditLog`.

Merged in from a standalone app. Consequences you must respect:

- **One `Customer` table** shared with retail. `phone` is required and unique — it *is* the
  customer's identity. Never add a second customer table.
- **One `User` table**. Workshop staff are ordinary users with a `SERVICE_*` role.
- `TokenCounter` mints `BCH-0001` — transaction-only writes.
- Ported routes still return `{ jobs }` rather than `successResponse` and have no zod
  schemas. Known debt, deliberately not fixed.

### Access control
`Module`, `Permission`, `Role`, `RolePermission`, `User`.

Permissions are **rows, not code**. Low Prisma reference counts on these tables are a sign
of good architecture (`src/lib/rbac.ts` centralises access), not of dead tables.

### Integration
`IntegrationConfig`, `StorageConfig`, `SyncLog`, `ZohoPullLog`, `ZohoPullPreview`.

The three separate Zoho config tables flagged in `docs/schema-review.md` §3.6 / §5.5 **have
already been consolidated** into `IntegrationConfig`. The doc is stale on this point — a
worked example of why you verify before citing.

## India-specific things that constrain the schema

- **GST**: `gstin`, `pan` on `Vendor`; `gstRate` per purchase-order line. Input tax credit
  needs the **tax component separable from the total**. `VendorBill` currently has only a
  single `amount` with no subtotal/tax split — worth raising when bills are touched.
- **HSN codes** belong on products, not on transactions.
- **Rupee amounts** run to 2 decimals. `Decimal(12, 2)` holds up to ₹99,99,99,999.99, which
  is ample.
- **Phone numbers** are the customer identity, not email. Never make email the natural key.

## Vocabulary — use the business's words

Brand = the manufacturer (Hero, Firefox). Vendor = who BCH buys from; often the same party,
which is why `BrandVendor` exists. CD = cash discount. Centre/Hub = the two billing
entities. Token = a workshop job number, not an auth token.
