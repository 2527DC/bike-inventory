# Schema Map — by sidebar group

Generated from `prisma/schema.prisma` (110 models / 2,425 lines) and `prisma/rbac-catalog.ts`
(the module + group definitions that build the sidebar).

| Doc | Group | Modules | Tables owned |
|---|---|---|---|
| [operations-group.md](./operations-group.md) | **Operations** | `stock`, `inbound`, `deliveries`, `transfers`, `stock_audit`, `second_hand`, `barcode`, `pos` | 19 |
| [accounts-group.md](./accounts-group.md) | **Accounts** | `accounts`, `bills`, `expenses`, `cost_price`, `customers`, `brand_ledger`, `brand_ledger_gaps` | 16 |

Not yet documented: Overview, Purchase, Insights, Service, Admin, Staff LMS.

---

## How to read the relationship tables

Every relationship row uses the same five columns.

| Column | Meaning |
|---|---|
| **From → To** | The direction the **foreign key points**. The `From` table physically holds the column. |
| **Card.** | `N:1` (many rows here point at one there), `1:N` (the reverse view), `1:1` (FK is `@unique`), `N:M` (through an explicit join table). |
| **Nav** | How the relation can be traversed in the Prisma client — see below. |
| **FK** | `required` (`String`, non-null) or `optional` (`String?`, nullable). This decides the implicit delete rule. |
| **onDelete** | What Postgres does when the *parent* row is deleted. |

### Nav: bidirectional vs unidirectional

This is the distinction that matters most in this codebase, and it is **not** the Prisma-syntax
one. Prisma forces both sides of every `@relation` to be declared, so *every real FK is
navigable both ways*. The useful split is whether a link is **enforced by the database** at all:

| Nav value | What it means | Example |
|---|---|---|
| **bidirectional** | A real FK. Navigable from both sides in Prisma (`include`), enforced by Postgres, and covered by a delete rule. | `VendorBill.vendorId → Vendor` / `Vendor.bills` |
| **unidirectional (soft)** | A plain `String` column holding another table's id or natural key, with **no** `@relation` and **no** constraint. Navigable only by writing the lookup by hand. Nothing stops it dangling. | `BankTransaction.confirmedPaymentId` → `VendorPayment.id` |
| **unidirectional (value)** | A match on a business value rather than an id — a phone number, an invoice number, a SKU string. Crosses group boundaries without any schema link. | `Delivery.customerPhone` → `Customer.phone` |

Each group doc has a **Soft links** section listing every unidirectional edge it contains. Those
are the joins the database will not protect and `prisma migrate` will not tell you about.

### onDelete — Prisma implicit defaults

Most relations in this schema declare no `onDelete`. Prisma then applies:

| FK is | Implicit action | Effect |
|---|---|---|
| `required` | **Restrict** | Deleting the parent **fails** while any child row exists. |
| `optional` | **SetNull** | Deleting the parent **nulls** the child's FK column; the child survives. |

Explicit actions in the schema — `Cascade`, `Restrict`, `SetNull` — are always called out in the
tables. Where an implicit default is doing important work it is written as
`(implicit Restrict)` / `(implicit SetNull)`.

### Direct vs indirect

- **Direct** — one FK hop. `InboundShipment → VendorBill` is one edge from Operations to Accounts.
- **Indirect** — reachable only by walking two or more FKs, usually through a third group.
  `Product → PurchaseOrderItem → PurchaseOrder → VendorBill` reaches Accounts from Operations
  *via Purchase*. Each group doc has an **Indirect reach** table spelling out these paths.

---

## The four spine tables

Four tables are referenced from nearly every group. They are documented in whichever group
owns them, but they turn up everywhere:

| Table | Owning group | Why it is everywhere |
|---|---|---|
| `User` | Admin (`team`) | Every `createdBy` / `approvedBy` / `recordedBy` / `verifiedBy` column. 30+ named relations hang off it. |
| `Product` | Operations (`stock`) | The stock-keeping unit. Reached by Purchase, Accounts, Inbound, Transfers, Audit and Staff LMS. |
| `Vendor` | Purchase (`vendors`) | The billing entity. The whole Accounts group is anchored on it. |
| `Customer` | Accounts (`customers`) | One shared row for the counter and the workshop. `phone` is the identity. |

`Brand` (Purchase) is a near-fifth: Operations, Accounts and Purchase all point at it.

---

## Postgres table names

Most models have no `@@map`, so the physical table is the **PascalCase model name** and must be
quoted in psql: `select * from "VendorBill";`. The models that *do* map to snake_case are noted
per-table in each doc. Getting this wrong is silent — an unquoted `select * from vendorbill`
is a "relation does not exist" error, but `products` (Staff LMS) vs `"Product"` (stock) are two
**different existing tables**.
