# Mobile stock API — what `bch-service-app` needs from `/api/*`

Status: pending
Branch: **`feat/mobile-stock-api`** — create it with exactly this name, off `main`.
Prepared 2 Sep 2026. Every claim below was checked against the tree that day; file:line
references are into this repo unless prefixed `APP:` (= `../bch-service-app`).

**Companion documents:**
- **`APP:doc/implementation/pending/02-stock-backend-integration.md`** — the app side of
  the same work: the demo/real seam, the `stockApi` facade, and the client adapters. Its §5
  maps every app function to a route here. This plan is the server half; the two are meant
  to be read together and land in either order.
- `docs/implementation/pending/service-module-mobile-readiness-plan.md` — the same shape of
  work for `/api/services/*`. The `POST /api/auth/mobile-login` route it introduced is what
  every request in this plan authenticates with. Nothing here changes auth.
- `docs/implementation/pending/prisma-migrations-adoption-plan.md` — **no schema change in
  this plan.** Every item is additive at the route layer, so it needs no migration and can
  ship before or after the migrations baseline.
- `docs/implementation/pending/stock-and-master-data-ux-plan.md` — Phase 3 (the filter
  drawer) wants the same per-chip counts. The `filter`/`facets` parameters in §3 are written
  so that drawer can adopt them; do not build a second counting path for the web.

---

## 0. Decisions

These override anything below that contradicts them.

| # | Decision | Rationale |
|---|---|---|
| **D1** | **Extend the existing list routes. No `/api/mobile/*` tree.** | One predicate per collection, one source of truth. A parallel tree forks every `where` and every guard, and the web filter drawer needs the same counts anyway. |
| **D2** | **Every addition is optional and backward compatible.** New query params are ignored when absent; new response keys appear only when asked for (`facets=1`, `items=0`). The `{ success, data, pagination }` envelope does not change. | The PWA keeps working untouched; the app can be deployed against a server that has only some of this. |
| **D3** | **The app's mock predicates are the spec.** `APP:src/services/mockApi.stock.ts` already defines every chip, sort and counter over the same shapes. Port them; do not redefine them. Line references are given per item. | The app's screens were built and reviewed against those semantics. A "close enough" server predicate produces chip counts that disagree with the rows. |
| **D4** | **Facets are counted before the chip is applied**, after search and the other filter groups. A chip's number answers "how many rows would I get if I tapped this". | `APP:src/services/paged.ts:180-233` — the rule the screens assume. |
| **D5** | **"Today" is IST.** Every window this plan computes uses `Asia/Kolkata`, via one helper. Routes also accept explicit `dateFrom`/`dateTo` instants. | Vercel functions run UTC; today's server "today" starts at 05:30 IST (`src/app/api/stock/summary/route.ts:10-11`). A shop-floor app cannot show yesterday's runs at 2 am. |
| **D6** | **Offset paging stays.** The app derives its cursor from `pagination.hasMore`. | No keyset work; `parseSearchParams` is already the shared parser. |
| **D7** | **Guards do not change.** Every route keeps its `requireFeature` and its row scoping (`stock-counts` assignee-only, `transfer-orders` creator-only without `approve`). | The app is a client of the same RBAC; a mobile-only relaxation would be a security regression on the web too. |
| **D8** | **Ship two seeded store roles.** The catalog has no role that grants stock modules except `ADMIN`, and an admin cannot count (`src/app/api/stock-counts/[id]/items/route.ts:112`). | A fresh test database must yield a counter and an approver in one `db:seed`, not a manual trip through `/team/permissions`. |

---

## 1. The contract the app speaks

The app's list hook needs, per page: `items`, `total`, whether there is a next page, and
optionally `facets` (per-chip totals) and `groupFacets` (per filter-group option totals).
It sends, per page: `page`, `limit`, `q`, `filter` (a named chip), `sort` (a named order),
`facets=1`, and for deliveries a composite `filters` selection (`status`, `timeline`,
`dispatch`).

**Request additions (all optional):**

| Param | Meaning |
|---|---|
| `q` | Alias of `search`. Same tokenisation as today: split on whitespace, every word must match somewhere. |
| `filter` | One named chip per route (§3). Unknown value → `400 "Unknown filter"`, never silently ignored — a silently ignored chip returns the wrong rows with a confident count. |
| `sort` | One named order per route. Unknown → `400`. Takes precedence over `sortBy`/`sortOrder` when present. |
| `facets` | `1` to include counts. |
| `dateFrom`, `dateTo` | ISO instants (with offset). Applied as given — **no** `T23:59:59.999Z` appending when the value already carries a time. |

**Response additions:**

```json
{
  "success": true,
  "data": [ … ],
  "pagination": { "total": 1108, "page": 2, "limit": 24, "totalPages": 47, "hasMore": true },
  "facets": { "ALL": 4009, "TODAY": 197, "OPEN": 1108, "ON_ROAD": 196, "FLAGGED": 85, "DONE": 2901 },
  "groupFacets": { "status": { "ALL": 1108, "PENDING": 254, … }, "timeline": { … }, "dispatch": { … } }
}
```

`facets` is present only with `facets=1`. `groupFacets` only on deliveries (§3 G8).
`paginatedResponse` grows an optional fifth argument for the extras (§4).

---

## 2. Verified current state, per route

| Route | Guard | Paging | Search | Filter | Sort | Facets |
|---|---|---|---|---|---|---|
| `GET /api/products` `src/app/api/products/route.ts:18` | `stock.view` (+`cost_price.view` for `costPrice`) | `paginatedResponse` | `search` over name/sku/brand/size | `status` (defaults `ACTIVE`), `productTypeId`, `minStock`/`maxStock`, … | `sortBy` allow-list | none |
| `GET /api/products/[id]` `…/[id]/route.ts:13` | `stock.view` | — | — | — | — | includes category, brand, bin, productType, 20 serials, 10 transactions; **no `stockLevels`** |
| `GET /api/stock-counts` `…/stock-counts/route.ts:13` | `stock_audit.view`, assignee-scoped without `approve` | `paginatedResponse` | **none** | single `status` | `createdAt desc` fixed | none |
| `GET /api/stock-counts/[id]` `…/[id]/route.ts:15` | as above | — | — | — | — | **returns every line** with product joins |
| `GET /api/stock-counts/[id]/items` `…/items/route.ts:10` | as above | **none** — `take` 500 default | `search` | `filter=all\|counted\|uncounted\|variance` | product name asc | `totalCount, countedCount, uncountedCount, staleCount` |
| `GET /api/inbound` `…/inbound/route.ts:13` | `inbound.view` | `skip`/`take`, envelope `data:{shipments,total}` | `search` over billNo/shipmentNo/brand | single `status` + `arriving_this_week` | `createdAt desc` fixed | none |
| `GET /api/deliveries` `…/deliveries/route.ts:9` | `deliveries.view` | `paginatedResponse` | `search` over invoiceNo/customerName/phone | single `status`, `area`, `date`, `dateRange`, `outstation` | `sortBy=scheduledDate` only | none |
| `GET /api/transfer-orders` `…/transfer-orders/route.ts:31` | `transfers.view`, creator-scoped without `approve` | `paginatedResponse` | **none** | single `status`, `dateFrom/To` | `createdAt desc` fixed | none |
| stock adjustment | — | — | — | — | — | **no route exists.** `adjustWarehouseQty` (`src/lib/stock-location.ts:32`) is the primitive; only counts, receiving and transfers call it. |
| hub counters | `/api/stock/summary`, `/api/inbound/stats`, `/api/deliveries/stats` | — | — | — | — | three calls, three definitions of "today", none IST |

---

## 3. The work

Each item names the file, the additions, the predicate source in the app, and the test.
`ist()` refers to the helper in §5.

### G1 — Products: `health` filter and `healthCounts`
**File:** `src/app/api/products/route.ts`.
**Add:** `filter=IN_STOCK|LOW_STOCK|NO_STOCK|INACTIVE` (the app also sends it as `health=`;
accept both), `sort=NAME|STOCK_LOW_FIRST|STOCK_HIGH_FIRST|RECENT`, `facets=1` →
`healthCounts: { ALL, IN_STOCK, LOW_STOCK, NO_STOCK, INACTIVE }` (this name, not `facets` —
the app already reads it, `APP:src/services/mockApi.stock.ts:154-161`).
**Predicates** (`APP:src/lib/stock-constants.ts:67-72`):

```ts
NO_STOCK : { status: "ACTIVE", currentStock: { lte: 0 } }
LOW_STOCK: { status: "ACTIVE", reorderLevel: { gt: 0 }, AND: [{ currentStock: { gt: 0 } }], /* currentStock <= reorderLevel */ }
IN_STOCK : { status: "ACTIVE", NOT: [NO_STOCK, LOW_STOCK] }
INACTIVE : { status: { not: "ACTIVE" } }
ALL      : {}   // note: ALL includes inactive — today `status` defaults to ACTIVE; with `filter=ALL` drop the default
```

`currentStock <= reorderLevel` compares two columns, which Prisma's `where` cannot express.
Two options, pick one and note it in the route: (a) `$queryRaw` for the LOW/IN_STOCK counts
and ids; (b) a generated column `isLow` maintained by `recomputeCurrentStock` — **not**
option (b), it is a schema change. Use (a) with a tagged template and the same `search`
clause, or filter `reorderLevel > 0` in Prisma and finish the comparison in SQL via
`Prisma.sql`. The `Product` indexes `status+currentStock` (`prisma/schema.prisma`) cover it.
**Sort map:** `NAME → name asc`, `STOCK_LOW_FIRST → currentStock asc, name asc`,
`STOCK_HIGH_FIRST → currentStock desc, name asc`, `RECENT → updatedAt desc`.
**Test:** for one search term, the five `healthCounts` sum to `ALL`; `filter=LOW_STOCK`
returns exactly `healthCounts.LOW_STOCK` rows across all pages.

### G2 — `GET /api/stock/mobile-summary` (new)
**File:** `src/app/api/stock/mobile-summary/route.ts`. Guard: `requireAuth()` then per-field
`userCan` — a field the caller may not view is `null`, not omitted, so the shape is stable.
**Returns** the eighteen integers of `StockSummary` (`APP:src/services/mockApi.stock.ts:234-266`)
in one call:

| Field | Query | Guard |
|---|---|---|
| `activeCount` | `product.count({ status: ACTIVE })` | `stock.view` |
| `lowCount` | G1's `LOW_STOCK` count | `stock.view` |
| `outCount` | `product.count({ status: ACTIVE, currentStock: { lte: 0 } })` | `stock.view` |
| `totalCount` | `product.count()` | `stock.view` |
| `pendingTransfers` | `transferOrder.count({ status: PENDING })` with the creator scoping of `transfer-orders/route.ts:41-44` | `transfers.view` |
| `inboundInTransit`, `inboundInTransitUnits` | shipments `status ≠ DELIVERED`; units = `sum(quantity - coalesce(deliveredQty,0))` over their lines | `inbound.view` |
| `inboundOverdue` | `status ≠ DELIVERED AND expectedDeliveryDate < ist().startOfToday` | `inbound.view` |
| `inboundThisWeekBills`, `inboundThisWeekUnits` | `expectedDeliveryDate` in `[ist().startOfToday, +7d)` | `inbound.view` |
| `inboundPrebookedUnits` | `sum(quantity)` of lines with `preBookedCustomerName` not null on open shipments (Q2) | `inbound.view` |
| `inboundDeliveredThisMonthUnits` | `sum(deliveredQty)` where `deliveredAt ≥ ist().startOfMonth` | `inbound.view` |
| `deliveriesToday` | `delivery.count({ scheduledDate in ist() today, status not in [DELIVERED, WALK_OUT] })` — `isTodayRun`, `APP:mockApi.stock.ts:668-670` | `deliveries.view` |
| `deliveriesFlagged`, `deliveriesPending`, `deliveriesScheduled` | by status | `deliveries.view` |
| `openCounts` | `stockCount.count({ status in [PENDING, IN_PROGRESS] })` with the assignee scoping | `stock_audit.view` |
| `countsToApprove` | `status = COMPLETED` | `stock_audit.view` |

All in one `Promise.all`; **no row is fetched**. Until this lands the app fans out nine
requests, so ship it, but ship it last — everything else is a prerequisite for a screen.
**Test:** call at 02:00 IST with a run scheduled "today IST"; `deliveriesToday` counts it.

### G3 — Product detail: include `stockLevels`
**File:** `src/app/api/products/[id]/route.ts:24-35`.
**Add** to the include: `stockLevels: { select: { warehouseId, quantity, reservedQuantity,
warehouse: { select: { code, name } } } }`. Flatten to
`{ warehouseId, warehouseCode, warehouseName, quantity, reservedQuantity }` — the app's
`StockLevel` (`APP:src/mock/types.ts:134`). Also return `reservedStock` (sum of
`reservedQuantity`).
**Test:** a product with rows in two warehouses returns two levels whose quantities sum to
`currentStock`.

### G4 — Inbound: `OVERDUE`, named sorts, facets, line search
**File:** `src/app/api/inbound/route.ts:13`.
**Add:** `filter=IN_TRANSIT|PARTIAL|RECEIVED|OVERDUE` (map `PARTIAL → PARTIALLY_DELIVERED`,
`RECEIVED → DELIVERED`; keep the existing `status=` for the web), `sort=RECENT|EXPECTED|VALUE`,
`facets=1`, and extend `search` to `lineItems.some.productName`.
**Predicates** (`APP:mockApi.stock.ts:583-611`): `OVERDUE = status ≠ DELIVERED AND
expectedDeliveryDate < ist().startOfToday`. `RECENT` = overdue first, then `billDate desc`
(two `orderBy` terms: a computed `isOverdue` needs raw SQL, or sort by
`expectedDeliveryDate asc` for the overdue subset — simplest faithful port: `orderBy:
[{ status: "asc" }, { billDate: "desc" }]` is **not** equivalent; use raw SQL `ORDER BY
(status <> 'DELIVERED' AND expected < now_ist) DESC, bill_date DESC`). `EXPECTED =
expectedDeliveryDate asc`; `VALUE = totalAmount desc`.
**Envelope:** keep `data: { shipments, total }` (the web reads it) and add `facets` beside
`data`. The app reads `data.shipments`.
**Test:** `facets.OVERDUE` equals the row count of `filter=OVERDUE` for the same `q`.

### G5 — `POST /api/products/[id]/adjust` (new)
**File:** `src/app/api/products/[id]/adjust/route.ts`. Guard `stock.edit`.
**Body:** `{ warehouseId: string, delta: number (int ≠ 0), reason: string (1..200) }` — zod.
`warehouseId` may also be a code; resolve with `resolveWarehouse` (`src/lib/warehouses.ts:61`),
`400 "Unknown warehouse"` on miss.
**Transaction:** read the level; `400 "Only N in <warehouse>"` if `qty + delta < 0` (do not
rely on `adjustWarehouseQty`'s clamp — a clamp hides the error the counter needs to see);
`adjustWarehouseQty(tx, productId, warehouseId, delta)`; write an `InventoryTransaction`
`{ type: ADJUSTMENT, quantity: Math.abs(delta), previousStock, newStock, referenceNo: null,
notes: "[ADJUST:<warehouseCode>] <reason>", userId }`. The `[ADJUST:<code>]` prefix is the
same convention counts use to record the warehouse in `notes`, since the ledger has no
warehouse column (`prisma/schema.prisma:628`).
**Returns** the product as `GET /api/products/[id]` does (G3 shape), so the app can replace
its open detail in one step.
**Test:** −5 on a level of 3 → 400 and no ledger row; +5 → level +5, `currentStock` +5, one
ADJUSTMENT row with `previousStock`/`newStock` correct.

### G6 — Stock counts list: chips, search, sort, facets, three fields
**File:** `src/app/api/stock-counts/route.ts:13-64`.
**Add:** `filter=OPEN|TO_APPROVE|DONE|OVERDUE`, `q` over `title`, `countNo`,
`assignedTo.name`, `sort=RECENT|DUE|PROGRESS`, `facets=1`; and in each item `assignedTo.id`,
`productType`, `location`, `approvedAt`, `approvedBy.name`, `rejectionReason` — the app's
`StockCountSummaryRow` (`APP:mockApi.stock.ts:458`).
**Predicates** (`APP:mockApi.stock.ts:425-465`): `OPEN = status in [PENDING, IN_PROGRESS]`;
`TO_APPROVE = COMPLETED`; `DONE = status in [APPROVED, REJECTED]`; `OVERDUE = OPEN AND
dueDate < ist().startOfToday`. Sorts: `RECENT = createdAt desc`; `DUE = dueDate asc`;
`PROGRESS` = counted fraction desc — compute `countedItems` in SQL (`count(*) FILTER (WHERE
counted_qty IS NOT NULL)`) rather than the current `items: { select: { countedQty } }`
include, which loads every line of every count on the list page (`:33`, `:43`). That include
is a latent problem for the web too; replacing it is the point of this item.
**Test:** as the counter user, `facets.OPEN` counts only their counts; as the supervisor, all.

### G7 — Count sheet: header without lines; lines paged; variance count
**Files:** `src/app/api/stock-counts/[id]/route.ts:15` and `…/[id]/items/route.ts:10`.
**Header route:** `?items=0` → omit `items`, keep `countedItems, totalItems, totalVariance,
itemsWithVariance`. (The web sends nothing and is unchanged.)
**Items route:** `page` and `limit` through `parseSearchParams` (`limit` ≤ 100 for this
route), `paginatedResponse` envelope **in addition to** the existing keys — i.e.
`{ success, data: items, pagination, totalCount, countedCount, uncountedCount,
varianceCount, staleCount }` — so the web's reads of `data.items` need one rename, or keep
`items` as an alias for one release. Replace the `groupBy` at `:83` with `count`. Add
`varianceCount = count({ variance: { not: null }, NOT: { variance: 0 } })`. `staleCount`
must be a query, not a filter over the page.
**Test:** a 2,007-line count pages at 30 per page with a stable `product.name` order; the
four counts do not change between pages.

### G8 — Deliveries: chips, run order, area sort, facets, group facets, IST windows
**File:** `src/app/api/deliveries/route.ts:9-103`.
**Add:** `filter=TODAY|OPEN|ON_ROAD|FLAGGED|DONE`, `sort=RUN|RECENT|AREA`, `facets=1`,
`dateFrom`/`dateTo`, and the composite groups as query params
`status=<DeliveryStatus|ALL>`, `timeline=ALL|TODAY|DAYS_3|THIS_WEEK|THIS_MONTH`,
`dispatch=ALL|LOCAL|OUTSTATION` (the existing `dateRange` and `outstation` stay as aliases).
**Predicates** (`APP:mockApi.stock.ts:661-745`):
`OPEN = status in [PENDING, VERIFIED, SCHEDULED, OUT_FOR_DELIVERY, FLAGGED, PREBOOKED]`;
`ON_ROAD = OUT_FOR_DELIVERY`; `FLAGGED = FLAGGED`; `DONE = status in [DELIVERED, WALK_OUT]`
(keep the current-month clamp of `:34-38` **only** when no date window is given);
`TODAY = scheduledDate within ist() today AND not DONE` (`isTodayRun`, `:668-670`).
Timeline windows from `ist()`; `LOCAL = isOutstation false`.
**Sorts:** `RUN` = status rank `OUT_FOR_DELIVERY, SCHEDULED, FLAGGED, PREBOOKED, VERIFIED,
PENDING, DELIVERED, WALK_OUT` then `scheduledDate asc, invoiceDate desc` — a `CASE` in raw
SQL or `orderBy` on a rank column; there is no rank column, so raw SQL. `RECENT = invoiceDate
desc`. `AREA = customerArea asc nulls last, invoiceDate desc`.
**Why sort, not group:** the app inserts a header whenever the sort key changes as pages
stream by (`APP:app/(app)/deliveries/index.tsx`). Grouping is a property of the order. Do
not return a pre-bucketed payload; it does not page.
**`groupFacets`** — for each group *g* and each of its options *o*: count with search, the
chip, and every **other** group's current selection applied, plus *o* for *g*. Semantics and
the one-pass trick are in `APP:src/services/paged.ts:196-228`; a first cut of 17 parallel
`count` calls is acceptable, raw SQL with `FILTER` clauses if p95 exceeds ~300 ms on the
4k-row table.
**Test:** `facets.TODAY` at 02:00 IST; `sort=RUN` never interleaves two statuses;
`groupFacets.status.PENDING` with `timeline=THIS_WEEK` equals the row count of
`status=PENDING&timeline=THIS_WEEK`.

### G9 — Transfer orders: search, size sort, rejected-incl-cancelled, facets
**File:** `src/app/api/transfer-orders/route.ts:31-90`.
**Add:** `q` over `orderNo`, `items.some.product.name`, `items.some.product.sku`,
`createdBy.name`; `filter=PENDING|APPROVED|REJECTED` where `REJECTED = status in [REJECTED,
CANCELLED]` (`APP:mockApi.stock.ts:791-813`); `sort=RECENT|SIZE` (`RECENT` = pending first
then `createdAt desc`; `SIZE` = `sum(items.quantity) desc` — raw SQL or a subquery);
`facets=1`. Row scoping unchanged.
**Test:** a `CANCELLED` order appears under `filter=REJECTED` and in `facets.REJECTED`.

### R1 — Seed two store roles
**File:** `prisma/rbac-catalog.ts` `ROLE_CATALOG` (`:839`). The seeder is create-only for
roles that already exist, so these are created once and later UI edits survive re-seeding.

```ts
{
  key: "STORE_MANAGER",
  name: "Store Manager",
  description: "Runs stock: approves counts and transfers, receives inbound, dispatches.",
  grants: {
    stock_management: ["view"],
    stock: CRUD,
    product_types: ["view", "create", "edit"],
    stock_audit: ["view", "create", "delete", "approve"],   // approver: cannot count (by design)
    inbound: ["view", "create", "edit", "delete", "approve", "fetch"],
    deliveries: ["view", "create", "edit", "delete", "approve", "fetch"],
    transfers: ["view", "create", "edit", "delete", "approve"],
    warehouses: ["view"],
    cost_price: ["view"],
  },
},
{
  key: "STORE_STAFF",
  name: "Store Staff",
  description: "Counts stock, receives inbound, updates deliveries, raises transfers.",
  grants: {
    stock_management: ["view"],
    stock: ["view", "edit"],
    product_types: ["view"],
    stock_audit: ["view", "edit"],                          // counter: cannot approve
    inbound: ["view", "edit"],
    deliveries: ["view", "edit"],
    transfers: ["view", "create"],
    warehouses: ["view"],
  },
},
```

The app maps `roleKey` to its home tab (`STORE_MANAGER → MANAGER`, `STORE_STAFF →
MECHANIC`); nothing else on the app side keys on these strings — module access is the
permission map. **Q1** asks whether `STORE_MANAGER` should also count.

### R2 — JSON 401 for API clients (optional, recommended)
**File:** `src/middleware.ts`. When the path starts with `/api/` and the request is
unauthenticated, answer `401 { success: false, error: "Unauthorized" }` instead of `307 →
/login`. The app already detects the HTML redirect (`APP:` W2.2), and the web's
`api-client.ts:128-157` already handles both, so this is hygiene, not a blocker — but it
turns a class of "Unexpected token '<'" bugs into a readable status.

---

## 4. Shared pieces

- **`paginatedResponse(data, total, page, limit, extra?)`** (`src/lib/api-utils.ts:48`):
  spread `extra` at the top level. Nothing else changes.
- **`parseSearchParams`** (`:67`): add `q` as an alias for `search`, and expose `filter`,
  `sort`, `facets` (boolean) as parsed values. Do **not** widen the `sortBy` allow-list —
  the named `sort` is a separate axis.
- **`src/lib/list-facets.ts`** (new): `countFacets(prisma.model, base: Where, chips:
  Record<string, Where>)` → `Promise.all` of counts, `ALL` = base. One helper, used by G1,
  G4, G6, G8, G9, so the "before the chip" rule (D4) is written once.
- **Raw SQL** is needed in four places (G1 two-column compare, G4 and G8 rank orders, G9
  size sort). Keep them as tagged `Prisma.sql` fragments beside the Prisma `where` that
  produced the same row set, and test that the two agree on `total`.

## 5. IST — `src/lib/ist.ts` (new)

```ts
const IST_MS = 5.5 * 60 * 60 * 1000;                     // no DST in Asia/Kolkata
export function ist(now = new Date()) {
  const shifted = new Date(now.getTime() + IST_MS);       // "wall clock" as if UTC
  const startOfToday = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - IST_MS);
  const startOfMonth = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - IST_MS);
  const day = 86_400_000;
  return { startOfToday, endOfToday: new Date(startOfToday.getTime() + day), startOfMonth,
           plusDays: (n: number) => new Date(startOfToday.getTime() + n * day) };
}
```

Use it in G2, G4, G6, G8. The three existing `/stats` routes and `/api/stock/summary` should
adopt it in the same PR (a one-line change each) so the web and the app agree on "today".
Mirror of `APP:src/lib/timezone.ts`.

## 6. Order and commits

One branch, one commit per item, in this order — each unblocks a screen the moment it deploys:

1. **G7** count sheet paging + header-only (the sheet is unusable past 500 lines).
2. **G5** adjust endpoint (a button with no route).
3. **G3** product levels.
4. **R1** roles + **§5** `ist.ts` (no UI, unblocks testing with two users).
5. **G6**, **G4**, **G9**, **G1** chips and facets (one commit each; §4 helper lands with G6).
6. **G8** deliveries (largest; depends on §4 and §5).
7. **G2** summary.
8. **R2** if wanted.

No migration at any step. `npm run db:seed` after R1.

## 7. Verification

- `npx tsc --noEmit` and the existing test suite clean after each commit.
- Postman: extend `docs/postman/` with a `bch-mobile-stock` collection — one request per
  §3 item, bearer from `mobile-login`, run as **both** seeded roles. Assertions: facets sum
  to `ALL` where the chips partition the set (`healthCounts`, stock-count chips); a scoped
  user's `facets` never exceed their `total`.
- The two-column and raw-SQL items (G1, G4, G8, G9): `pagination.total` from the raw path
  equals `count` from the Prisma path for ten random queries.
- The web: every list page under `src/app/(dashboard)/{stock,stock-audit,inbound,deliveries,
  transfers}` renders unchanged with no new params sent.
- G7 with the web: `stock-audit/[id]/page.tsx:132,140` reads the items envelope — confirm the
  alias or rename lands in the same commit.

## 8. Questions

| # | Question | Default |
|---|---|---|
| **Q1** | Should `STORE_MANAGER` be able to count as well as approve? The items route refuses approvers (`…/items/route.ts:112`) by design. | No. Two roles, two people; that is the control the refusal exists for. |
| **Q2** | `inboundPrebookedUnits`: units on open shipments' pre-booked lines, or the count of waiting `PreBooking` rows (`/api/inbound/stats.preBookingsWaiting`)? | Units, as the app's tile says "units". |
| **Q3** | `GET /api/products` with `filter=ALL`: include inactive (the app's `ALL` does) or keep the `ACTIVE` default? | Include inactive under `filter=ALL`; the default without `filter` stays `ACTIVE` for the web. |
| **Q4** | Keep the `DONE` current-month clamp on deliveries when the app sends no window? | Yes — the app's `DONE` chip is also month-clamped (`APP:mockApi.stock.ts`), so they agree. |
