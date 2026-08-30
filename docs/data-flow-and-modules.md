# Data Flow and Modules — how this application actually works

Traced from source on 28 Aug 2026. Every claim here was verified against the code, and the
file:line references are there so the next reader can re-check rather than trust.

Companion documents: `docs/dead-code.md` (what can be deleted),
`docs/implementation/completed/cron-removal-plan.md` (why there are no scheduled jobs).

---

## 1. The one-paragraph version

Almost nothing in this application is typed in twice. Bills, invoices, items and contacts
are **pulled from Zoho**, previewed, and approved by a human. Approving them creates the
business records — and, as a side effect, creates the **vendors, brands, categories and
products** those records refer to. Vendors and brands are almost never created deliberately;
they appear because a bill mentioned them. Stock is the exception: the app owns its stock
numbers completely and Zoho never moves them.

---

## 2. The three Zoho sources

Three separate connections, three separate credential sets, three separate daily quotas.

| Source | Base URL | Used for | Config |
|---|---|---|---|
| Zoho Books | `zohoapis.in/books/v3` | bills, contacts, invoices | `ZohoConfig` |
| Zoho Inventory | `zohoapis.in/inventory/v1` | items, bills | `ZohoInventoryConfig` |
| Zakya POS | `api.zakya.in/inventory/v1` | bills, invoices, payments | `ZakyaConfig` |

All three authenticate with the same OAuth2 self-client flow against
`accounts.zoho.in/oauth/v2/token`, and all three store a refresh token in their own table.
Managed at **Settings → Integrations**.

> The three config tables are **structurally identical** — same 13 columns — and the three
> client classes differ only in that one base URL. See
> `docs/implementation/pending/zoho-config-consolidation-plan.md`.

---

## 3. The pull pipeline — the mechanism everything else uses

Four steps. Nothing is written to a business table until a human presses Approve.

```
  STEP 1  POST /api/zoho/trigger-pull  { step: "init" }        -> pullId
  STEP 2  POST /api/zoho/trigger-pull  { pullId, step, fromDate }
             fetches from Zoho, writes ZohoPullPreview rows      (staging only)
  STEP 3  GET  /api/zoho/pull-review?pullId
             human sees what would be imported
  STEP 4  POST /api/zoho/pull-review/approve  { previewIds }
             THIS is where real records are created
```

`ZohoPullPreview` is a staging table. A pull that is never approved leaves no trace in the
business data — which is why "fetch" is safe and "approve" is the consequential action.

**Four entity types** exist, and each becomes something different:

| entityType | Approving it creates | Handler |
|---|---|---|
| `contact` | Vendor | `approve/route.ts:93` |
| `item` | Product (+ Brand, Category) | `approve/route.ts:111` |
| `bill` | VendorBill **+ InboundShipment** (+ Vendor, Brand, Category, Products) | `approve/route.ts:154` |
| `invoice` | Delivery | `approve/route.ts:423` |

---

## 4. Where a fetch can be triggered

Every fetch is a person pressing a button. There are **no scheduled jobs** — see
`docs/implementation/completed/cron-removal-plan.md`.

| Screen | What it pulls | Endpoints |
|---|---|---|
| `/bills` | bills | `trigger-pull` → `pull-review` → `approve` |
| `/inbound` | bills → shipments | `trigger-pull` → `pull-review` → `approve` |
| `/deliveries` | invoices | `trigger-pull`, plus `search-zoho` / `import-zoho` |
| `/receivables` | invoices | `trigger-pull` → `pull-review` → `approve` |
| `/stock` | items | `pull-review` → `approve` |
| `/settings/integrations` | any of the four | full 4-step + connection management |

Two screens use a **narrow lookup** rather than a pull — they search Zoho for one invoice
and do not stage anything:

- `/second-hand` → `/api/deliveries/search-zoho` (find the original sale of a traded-in cycle)
- `/prebookings` → `/api/deliveries/search-zoho` (attach a customer's advance to an invoice)

### Screens that never touch Zoho

Verified by listing every `/api/...` string in each screen:

`/vendors` · `/more/brands` · `/purchase-orders` · `/expenses` · `/transfers` ·
`/stock-audit` · `/ledger` · `/reorder` · `/brand-stock` · `/price-correction`

**This is the point worth internalising:** the Vendors screen calls only `/api/vendors`, and
the Brands screen only `/api/brands`. Neither has any Zoho capability at all.

---

## 5. What gets created without anyone asking for it

Approving **one bill** writes up to seven kinds of record. Everything marked *auto* is
created only because it was missing:

```
Bill approved  (approve/route.ts:154)
 │
 ├─ Vendor            auto  :172-184   matched by name, case-insensitive
 │                                     code = 6 alphanumerics + last 4 of Date.now()
 ├─ Brand             auto  :212       ← named after the VENDOR
 ├─ Category          auto  :215       "Uncategorized", once
 ├─ Product × N       auto  :283       matched zohoItemId → SKU → name
 ├─ VendorBill              :320
 ├─ Brand (again)     auto  :339       ← the shipment's brand, also the vendor name
 ├─ InboundShipment         :368       shipmentNo IB-YYYYMM-NNNN
 │   └─ InboundLineItem     :380
 └─ PreBooking update       :404       WAITING → MATCHED
```

### The vendor-as-brand consequence

`approve/route.ts:212` and `:339` both create a `Brand` **from the vendor's name**. An
auto-created brand is therefore a supplier, not a manufacturer. If the brand list contains
entries that are obviously vendors, this is why. Nothing else in the app distinguishes a
real brand from one created this way.

### How a product is matched before a duplicate is created

Three attempts, in order (`approve/route.ts:233-241`):

1. `zohoItemId` — exact, reliable
2. `sku`
3. `name`

Only if all three miss is a new `Product` created — with `currentStock: 0`.

### Which routes create vendors, brands and products anywhere in the app

| Table | Created by |
|---|---|
| `Vendor` | `vendors/route.ts` (manual), `zoho/import/contacts`, `zoho/pull-review/approve`, `vendor-issues/groups`, `vendors/stale` |
| `Brand` | `brands/route.ts` (manual), `brands/[id]/merge`, `zoho/import/items`, `zoho/import/clean`, `zoho/pull-review/approve` |
| `Product` | `products/route.ts`, `products/bulk`, `products/auto-classify`, `zoho/import/items`, `zoho/import/clean`, `zoho/pull-review/approve` |

Note `vendor-issues/groups/route.ts` also creates vendors — raising an issue against an
unknown supplier brings that supplier into existence.

---

## 6. Stock is the app's own, not Zoho's

`approve/route.ts:149` — `currentStock: 0, // App manages its own stock`.

**The Zoho import never moves stock.** Products arrive at zero and are only moved by the
app's own inventory routes. Every route that writes `InventoryTransaction`:

| Route | When stock moves |
|---|---|
| `inbound/[id]`, `inbound/[id]/status`, `inbound/[id]/putaway` | goods physically received |
| `deliveries/[id]`, `deliveries/batch` | goods dispatched |
| `inventory/inwards/verify`, `inventory/outwards` | manual correction |
| `transfers`, `transfer-orders/[id]/approve` | moved between locations |
| `zoho/import/invoices`, `zoho/import/clean` | legacy import paths |

---

## 7. Operations-level modules

| Module | Screen | Sub-screens | Zoho? | Writes |
|---|---|---|---|---|
| Stock & Inventory | `/stock` | `/[id]`, `/[id]/barcode`, `/[id]/serials`, `/by-bin`, `/by-brand`, `/by-location/[location]` | items via approve | `Product`, `SerialItem` |
| Inbound Tracking | `/inbound` | `/[id]` | **yes** — bills → shipments | `InboundShipment`, `InboundLineItem`, `PreBooking`, and stock on receipt |
| Deliveries & Dispatch | `/deliveries` | `/[id]`, `/dispatch`, `/prebook`, `/blr`, `/outstation`, `/walkout` | **yes** — invoices | `Delivery`, `InventoryTransaction`, `Product` |
| Stock Transfers | `/transfers` | `/new` | no | `TransferOrder`, `InventoryTransaction`, `SerialItem` |
| Stock Audit | `/stock-audit` | `/new`, `/[id]`, `/[id]/review`, `/brand-count` | no | `StockCount`, `StockCountItem` |
| Second-Hand | `/second-hand` | `/new`, `/[id]`, `/verify` | lookup only | `SecondHandCycle` |
| Barcode | `/scanner` | — | no | reads only |
| POS & Settlement | `/accounts/settlement` | `/[id]` | no | `PosSession`, `DailySettlement`, `SettlementMatch` |

**The inbound flow is the spine of this application.** A Zoho bill becomes an
`InboundShipment` in a pending state. Someone then receives it — that is when
`InventoryTransaction` rows appear and `Product.currentStock` rises. Putaway assigns bins.
Pre-bookings taken before the goods arrived are matched to line items automatically.

---

## 8. Purchase-level modules

| Module | Screen | Sub-screens | Zoho? | Writes |
|---|---|---|---|---|
| Vendors | `/vendors` | `/new`, `/[id]` | **never** | `Vendor`, `VendorContact` |
| Purchase Orders | `/purchase-orders` | `/new`, `/[id]` | **never** | `PurchaseOrder` |
| Brands | `/more/brands` | — | **never** | `Brand` |
| Vendor / Ops Issues | `/vendor-issues` | `/new`, `/[id]` | no | `VendorIssue`, `VendorIssueNote`, **`Vendor`** |
| Reorder & AI | `/reorder` | — | no | `Product` (reorder levels) |
| Brand Stock | `/brand-stock` | `/upload`, `/[id]` | no — **file upload** | `BrandStockUpload`, `BrandStockItem`, `BrandSkuMapping`, `PurchaseOrder` |

Two things worth noting here:

- **Vendors and Brands have full manual CRUD screens that are rarely the origin of the
  data.** Most rows in both tables were created by a bill approval. The screens exist mainly
  to *correct* what the import produced.
- **Brand Stock is the one non-Zoho bulk import.** A brand sends a stock file, it is
  uploaded, SKUs are mapped to products via `BrandSkuMapping`, and a `PurchaseOrder` can be
  generated from it (`brand-stock/uploads/[id]/generate-po`). This is the only path that
  creates a PO from external data.

---

## 9. Accounts-level modules

| Module | Screen | Sub-screens | Zoho? | Writes |
|---|---|---|---|---|
| Bills & Payments | `/bills` | `/[id]` | **yes** — bills | `VendorBill`, `VendorPayment`, `VendorCredit` |
| Expenses | `/expenses` | `/new` | no | `Expense` |
| Customers & Receivables | `/receivables` | `/new`, `/[id]` | **yes** — invoices | `CustomerInvoice`, `CustomerPayment`, `Customer` |
| Cost Price Visibility | — | none | — | permission only, no page |
| Brand Ledgers | `/ledger` | `/[id]`, `/[id]/gaps/new` | no | `BrandLedgerEntry`, `LedgerGap` |
| Accounts hub | `/accounts` | `/bank-upload`, `/reconcile/[id]`, `/vendor-ledger`, `/settlement` | no | `BankStatement`, `BankTransaction` |

### The accounting / inventory split — important

The same bill import behaves in two different ways depending on where it was started.
`approve/route.ts:207` and `:326`:

```ts
if (source !== "accounting") { ... create products ... }
if (source === "accounting") { ...record the bill and stop... }
```

- Started from **`/bills`** (`source: "accounting"`) → **financial only.** Creates the
  `VendorBill`. Creates **no** products, **no** brands, **no** shipment.
- Started from **`/inbound`** → the full chain: products, brands, shipment, pre-booking
  matching.

This is deliberate and it matters: an accountant importing six months of bills to reconcile
payables must not conjure six months of phantom shipments.

### Bank reconciliation

`/accounts/bank-upload` ingests a statement into `BankStatement` + `BankTransaction`.
`bank-statements/[id]/review` then matches lines against `VendorBill`, `VendorPayment` and
`Expense`. This is entirely local — no Zoho involvement.

---

## 10. Is there any calculation, or just fetching?

There *is* calculation. Derived values computed by this application, not taken from Zoho:

| Value | Where | Rule |
|---|---|---|
| `paidAmount` | `approve:320` | `total − balance` |
| Bill `status` | `approve:321` | `balance == 0` → PAID; `balance < total` → PARTIALLY_PAID; else PENDING |
| `expectedDeliveryDate` | `approve:343-347` | bill date + `BrandLeadTime.leadDays`, **default 7** |
| `totalAmount` on a shipment | `approve:361` | sum of matched line items |
| `shipmentNo` | `approve:349-359` | `IB-YYYYMM-` + (max existing + 1) |
| Pre-booking match | `approve:366-372` | **first 15 characters of the product name, compared both directions** |
| Stock levels | inventory routes | fully owned by the app |
| Aging buckets | `bills/aging-summary`, `customer-invoices/aging-summary` | computed locally |

> The pre-booking match is a **fuzzy heuristic**, not a key lookup. Two similarly-named
> cycles will attach the wrong customer to a shipment line.

---

## 11. Known bugs found while tracing this

### 11.1 Sequence numbers race — five sites

Every one of these allocates a `@unique` number by reading the current maximum and adding
one, which two concurrent requests can do identically:

| File | Column |
|---|---|
| `zoho/pull-review/approve:353` | `shipmentNo` |
| `inbound/route.ts:159` | `shipmentNo` |
| `transfer-orders/route.ts:134` | `orderNo` — *transaction opens at :145, six lines too late* |
| `stock-counts/route.ts:132` | `countNo` |
| `vendor-issues/route.ts:110` | `issueNo` |

The correct pattern already exists in this codebase: `services/jobs/create/route.ts:56`
mints job tokens with `tx.tokenCounter.upsert({ update: { current: { increment: 1 } } })`
inside a transaction. CLAUDE.md documents the hazard for `TokenCounter` and it was never
carried across to the other five.

### 11.2 The Zoho import is not atomic

`approve/route.ts` is 498 lines and contains **zero** `$transaction` calls, while writing up
to seven tables per bill. Its `catch` records the error and moves to the next preview, so a
partially-imported bill is normal behaviour rather than an exceptional one: vendors, brands
and products exist for a bill that has no shipment, and nothing in the data marks them.

11.1 causes 11.2 — the unique violation fires on `InboundShipment.create`, which is last, so
everything before it is already committed.

---

## 12. Navigation

```
Overview     /  ·  /activity
Operations   /stock · /inbound · /deliveries · /transfers · /stock-audit
             /second-hand · /scanner · /accounts/settlement
Purchase     /vendors · /purchase-orders · /more/brands · /vendor-issues · /reorder
Accounts     /bills · /expenses · /receivables · /ledger
Insights     /reports · /analytics
Admin        /team · /team/permissions
             /settings
                ├── /settings/storage
                └── /settings/integrations
Service      /services/counter · /services/assembly · /services/billing
             /services/prices · /services/manager
Staff LMS    /staff-lms  (+ learning, product-learning, practice, rank)
```

The sidebar is built from the `modules` table filtered by each user's `view` grant — not
from any list in the source. Seeding a module makes it appear for whoever holds its grant,
with no code change. See `src/components/app-sidebar.tsx`.

---

## 13. Open questions for the business

1. **Is vendor-as-brand intended?** Auto-created brands are supplier names. If brands are
   meant to be manufacturers, the import is quietly polluting that table.
2. **Is the 15-character pre-booking match acceptable?** It will mismatch similar model
   names. A SKU or invoice-line match would be exact.
3. **Should the default 7-day lead time be per-brand-mandatory?** Every brand without a
   `BrandLeadTime` row silently gets 7 days, and that date drives expected-delivery
   reporting.
