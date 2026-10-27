# Fast movers: measure how fast each product sells, and tell leadership before it runs out

Status: pending — written 12 Oct 2026; plan only, nothing built. Q1–Q4 block the build; the rest run on their defaults.
Branch: **`feat/1210-fast-mover-alerts`** — create it with exactly this name, off `main`.

Every `file:line` below was read from disk on 12 Oct 2026, on a tree equal to `origin/main`
(`1bb6c5a`) plus one unrelated script change. Local `main` is stale (`736c2f5`); pull it before
branching. **No Zoho involvement:** stock is owned by this app, sales reach it through the
existing invoice pull, and nothing here reads from or writes to Zoho.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (8 Oct 2026)

> 20. Tracking stock levels of high-velocity models (electric cycles, geared bikes) and alerting leadership regarding stock-outs (pumps, displays, accessories).

Sharpened by the owner on 12 Oct 2026 (D20, §1.1): *fast movers are computed from sales speed
(units per week); alert when days of cover falls below N. No manual flag.*

### 0.2 Restated as requirements

Three terms, used throughout:

- **Sales speed** — units of a product sold per week, measured from the app's own sales records.
- **Days of cover** — how many days the stock on hand lasts at that speed:
  `stock ÷ (units sold per day)`. Twelve sold in 28 days is 3 a week; with 5 in stock that is
  5 ÷ (12 ÷ 28) ≈ 11.7 days of cover.
- **Fast mover** — a product that sold enough in the window for its speed to mean something.
  One sale a month gives a cover figure that is noise.

| # | Requirement | Map |
|---|---|---|
| R1 | The app measures each product's **sales speed** (units/week) from its own sales records. | map R20 |
| R2 | From that, it computes **days of cover** for every product that sells fast enough to measure. | map R20 |
| R3 | "High-velocity" is **computed, never a manual flag** (D20). The threshold **N days**, the measuring window and the minimum sales to count as a fast mover are **admin settings**. | map R20 |
| R4 | When a fast mover's cover **drops below N days**, leadership is **alerted at that moment**, triggered by the stock going down. No cron, no timer, no polling (CLAUDE.md). | map R20 |
| R5 | Leadership is also alerted when a fast mover **actually runs out**: "alerting leadership regarding stock-outs" (subject to Q4). | map R20 |
| R6 | **One alert per episode.** A product that stays short does not alert again on every sale. It alerts again only after its cover has recovered (it "re-arms") and fallen again. | map R20 |
| R7 | **"Leadership" is a permission, never a role name** (CLAUDE.md rule 1). | map R20 |
| R8 | Covers **every kind of product**: cycles (electric, geared) and accessories and spares (pumps, displays). There is no category whitelist. | map R20 |
| R9 | A **"Fast movers" view** on the Reorder screen lists product, units/week, stock, days of cover and last alert, and **sorts** by any of them. | map R20 |

---

## 1. Questions and clarifications — answer before build

### 1.1 Decisions on record

Answered in session, 12 Oct 2026:

| # | Decision | Effect here |
|---|---|---|
| D20 | Fast movers are computed from sales speed (units/week); alert when days of cover < N. **No manual flag.** | R1–R4. No "is fast mover" column on `Product`. N is a setting. |
| D1 | Hub and Centre are the existing `Store` rows (`BCH_STORE`, `BCC_STORE`), linked by `storeId`. No new `"HUB"`/`"CENTRE"` strings. | The per-store stock columns in the view are read from `Store` through `Warehouse.storeId`. No new store text anywhere. |

No other 12 Oct decision touches this plan.

### 1.2 Open questions

**Q1–Q4 block the build.** Each of them changes the schema, the RBAC catalog, or the
calculation itself. Q5–Q11 run on their recommended default unless the owner says otherwise.
Q12 does not change the build: it is a check to make before anyone relies on the alert.

| # | Question | Why it changes the build | Options | Recommended default | **Answer** |
|---|---|---|---|---|---|
| **Q1** ⛔ | Is cover measured for the **whole business**, or **per store** (Hub and Centre separately)? | The alert's state is keyed per product or per product × store, so this decides the table's shape. Per store also needs each sale's store, which the sales ledger does not record (§2.4). | (a) whole business: one cover per product, with Hub / Centre stock shown side by side in the view; (b) per store: sales attributed through `Delivery.storeId`, manual outwards assigned to the primary store | **(a)**. A purchase decision is business-wide (BCH buys for both stores, 0409 plan Q1). One store short while the other holds stock is a *transfer*, and `stock.transfer_needed` already handles that (`events.ts:54-59`). | |
| **Q2** ⛔ | Who is "leadership"? | Decides the RBAC catalog change and who `usersWithPermission` returns. | (a) a new permission-only module **`stock_alerts`** with one action, `view`, shown on `/team/permissions` as "Fast-mover stock alerts" (the `cost_price` pattern, `rbac-catalog.ts:528-536`); (b) add `approve` to the `reorder` module and send to `reorder.approve`; (c) reuse `reorder.edit`, which is today's below-reorder audience (purchase staff, not leadership) | **(a)**. It reads correctly on the permissions screen. (b) would put an "Approve" tick on Reorder that approves nothing. (c) sends to the wrong people. | |
| **Q3** ⛔ | Is N **one number for every product**, or derived **per brand** from `Brand.leadDays` (`schema.prisma:538`, default 7) plus a safety margin? | It changes the calculation and the settings form. | (a) one global N, default **14 days** (the default 7-day lead time plus 7 days of safety stock); (b) N = brand lead days + a "safety days" setting | **(a)**. It is one number the owner can reason about. (b) is the inventory consultant's reorder-point formula and stays possible later without a schema change. | |
| **Q4** ⛔ | When a fast mover actually **reaches zero**, does it get a second alert ("now out of stock") after the "running low" one? | One more armed flag on the state table, and a second message. | yes / no | **Yes**. "Alerting leadership regarding stock-outs" names the stock-out itself. The low alert is the early warning. | |
| Q5 | What counts as a **sale**? | It decides which ledger rows feed the speed. | (a) `OUTWARD` ledger rows only: a delivery handed over (WALK_OUT / DELIVERED) and the manual outward API; (b) also count audit shortages and transfer losses | **(a)**. Transfers move stock between our own stores, and audits correct the books. Neither is demand. | |
| Q6 | Window and minimum: **28 days** (four whole weeks, so weekday effects cancel out) and **at least 4 units** sold in it (about one a week). A product younger than the window is measured over its own age, never less than 7 days. | Settings defaults, plus one extra query for "first movement". | change any number | as stated. The age rule matters at launch: a new e-cycle sold 8 times in its first 10 days would otherwise read as 2/week instead of 5.6/week. | |
| Q7 | **Stock** for cover = on hand across both stores **plus units in transit** between them. Units held for scheduled deliveries are **not** subtracted. | It decides which events need a hook (§3, Part C). | (a) as stated; (b) also subtract held units, which adds hooks at the four places a hold is placed, including a public route | **(a)**. With transit counted, a transfer never moves cover, so transfers need no hook. "Held" is shown as its own column. | |
| Q8 | Does an **approved stock-audit shortage** also trigger the check? | It is one more call site. | yes / no | **Yes**. Stock really went down, whatever the cause. It is still not counted as a sale (Q5). | |
| Q9 | **WhatsApp?** The app has no server-side WhatsApp sender, only click-to-send links (§2.2). The owner removed the WhatsApp shares from this very tab on 21 Sep 2026 (`reorder-tab.tsx:71-73`). | It would mean a share button and a phone list. | (a) push and inbox only; (b) also a "Share on WhatsApp" button on the view, to `AlertConfig.redFlagPhones` | **(a)** | |
| Q10 | Who may change the settings (N, window, minimum)? | It is the guard on `PUT`. | `settings.edit` / `reorder.edit` | **`settings.edit`**, the precedent set by the stuck-hours setting (`api/settings/stuck-hours/route.ts:44-46`) | |
| Q11 | **At go-live**, products that are already below N: alert each one at its next sale, or start silently and alert only on new drops? | Whether a one-time "mark all current as alerted" step ships. | (a) alert at next sale; (b) silent baseline | **(a)**. Leadership has not been told about them yet. Sales spread the alerts out over time, so they do not all arrive at once. | |
| Q12 | *(precondition, not a build question)* Is push **switched on in production** (Settings → Notifications)? | When the master switch is off, `notify()` reaches nobody, and that includes the inbox (`notify/index.ts:96-103`). The "Fast movers" view is then the only place the risk shows. | — | Check before go-live. | |

---

## 2. How it works today — verified against the code

### 2.1 What "low" means today, and who hears about it

- **One rule.** `isLowStock` is `reorderLevel > 0 && currentStock <= reorderLevel` (`src/lib/reorder.ts:53-55`). It reads a hand-set level and knows nothing about speed: a slow model and a fast model with the same count look identical.
- **The notification is a crossing, not a state.** `maybeNotifyBelowReorder` fires only when `previousStock > reorderLevel >= newStock` (`src/lib/notify/stock.ts:41-49`), so a product that is already short does not re-notify on every sale. The file header records why that is a deliberate exception (`reorder.ts:21-23`). This plan reuses the same "only on the way down" idea.
- **Who receives it:** holders of `reorder.edit`, resolved when the message is sent (`notify/stock.ts:60`). That means purchase staff, not leadership. One `notify()` per product (`:68-83`). It never throws (`:89-95`).
- **Where it is called:** after commit, inside `after()`, from exactly three routes, each of which collects `crossings` inside its transaction:
  - `api/inventory/outwards/route.ts:66`, `:131`, `:176`
  - `api/deliveries/[id]/route.ts:180`, `:452`
  - `api/deliveries/batch/route.ts:74`, `:217`
- **The event** is registered once, `stock.below_reorder` (`src/lib/notify/events.ts:27-31`). The registry feeds Settings → Notifications and each user's own preferences automatically (`api/notifications/events/route.ts`, `api/notifications/preferences/route.ts`), so a new key there needs no screen change.
- **The screen.** `/reorder` is a server redirect to `/purchase-orders?tab=reorder` (`src/app/(dashboard)/reorder/page.tsx:9-11`). The screen itself is `purchase-orders/_components/reorder-tab.tsx` (421 lines). It opens on "Low stock" (`:82`), loads `GET /api/reorder` through `apiTry` (`:108`), and is shown to `reorder.view` holders (`purchase-orders/page.tsx:95-102`). `GET /api/reorder` is guarded by `reorder.view` (`api/reorder/route.ts:13`) and selects only `ACTIVE` products (`:26-37`).
- **Nothing measures speed.** `src/lib/ai-calculations.ts:3-16` has `calcSalesVelocity` and `calcDaysUntilStockout`, but nothing imports them. Only `formatINR` from that file is used (`api/dashboard/stats/route.ts:6`), and `calcDaysUntilStockout` returns a magic `999`. Do not build on them.

### 2.2 The notification channels that actually exist

| Channel | What it is | Can it carry this alert? |
|---|---|---|
| **Push (FCM)** + **/notifications inbox** | `notify()` is the one entry point (`src/lib/notify/index.ts:58`). It writes an inbox row for every active recipient (`:131-134`), then pushes to registered devices, and records every send in `NotificationOutbox`. | **Yes, this is the channel.** But the master switch `NotificationConfig.pushEnabled` defaults to `false` (`schema.prisma:1636`), and when it is off, or the event is off, **nobody gets anything, not even an inbox row** (`notify/index.ts:79-103`). See Q12. |
| **Email** | Withdrawn as a notification channel on 23 Sep 2026. SMTP stays only for emailing purchase orders to vendors (`notify/index.ts:8-9`, `notify/types.ts:15-20`). | No. |
| **WhatsApp** | Not a sending service. Every WhatsApp touch in the app is a `wa.me` / `api.whatsapp.com` link opened **in the user's browser** (e.g. `deliveries/[id]/_components/flag-section.tsx:38-44`). `AlertConfig.redFlagPhones` (`schema.prisma:2123-2129`) is read by exactly one route, delivery flagging, which returns the numbers to the screen (`api/deliveries/[id]/flag/route.ts:63-73`). The screen then opens WhatsApp to the **first** number only (`flag-section.tsx:38`). The list is edited on `/more/alerts` under `settings.edit` (`api/alerts/config/route.ts:56-62`). | **No.** The alert fires while a salesperson is handing over a bicycle. Nobody is there to press "send" on a WhatsApp link meant for the CEO. See Q9. |

### 2.3 Where stock goes down: one choke point, or many?

**Many call sites, one low-level writer.**
`Product.currentStock` is a cached sum. `recomputeCurrentStock` (`src/lib/stock-location.ts:23-31`) is its only writer apart from the two stock-reset routes, which zero it directly (`api/stock-reset/route.ts:53-60`). Every route below reaches it through `adjustWarehouseQty` (`:51-63`), `deductFromStore` (`:113-167`), `setWarehouseQty` (`:325-333`) or a direct call (`deliveries/floor-stock.ts:369`).

**That writer is the wrong place to hook the alert, for three reasons:**

1. **It runs inside the caller's transaction.** A notification must go out after commit (`notify/index.ts:19-24`). If it were sent inside and the transaction then rolled back, a push would already be on someone's phone for stock that never left.
2. **It does not know why stock moved.** A sale, a transfer leg, an audit and a receipt all look the same to it.
3. **It has no way to hand anything to the after-commit step.** Doing that would need `AsyncLocalStorage`.

**The places stock goes down, and whether this plan hooks them:**

| Where | Why stock falls | Hook? |
|---|---|---|
| `api/deliveries/[id]/route.ts:385-433` | delivery handed over (DELIVERED / WALK_OUT); writes `OUTWARD` | **yes** (sale) |
| `api/deliveries/batch/route.ts:135-203` | batch marked DELIVERED; writes `OUTWARD` | **yes** (sale) |
| `api/inventory/outwards/route.ts:102`, `:138-152` | manual outward; writes `OUTWARD`. **No browser caller**: only a GET is used, at `desktop/page.tsx:54` | **yes** (sale) |
| `api/stock-counts/[id]/route.ts:412-506` | approved audit applied, shortage lines (`ADJUSTMENT`) | **yes**, Q8 (not counted as a sale) |
| `api/transfer-orders/[id]/dispatch` via `transfers/stock.ts:38` | units go onto the van | no. Cover counts in-transit units (Q7), so a dispatch does not change cover |
| `api/transfer-orders/[id]/receive` `[TRANSIT SHORTFALL]` | lost in transit | no. Rare, and visible on the receiving screen |
| `api/inbound/[id]/route.ts:576-579` | a receipt undone | no. It puts stock back to where it was before the mistake |
| `api/stock-reset/*`, `api/inventory/cleanup` | admin wipes | **never**. Zeroing the catalogue would alert every fast mover at once |

**So the choke point is logical, not physical.** One after-commit function,
`checkStockCover(productIds, source)`, called from the four "yes" rows. This is the pattern
`maybeNotifyBelowReorder` already established. It receives only product ids and re-reads
everything after the commit, so callers stay one line each.

### 2.4 What a "sale" is in this app

- **The ledger.** `InventoryTransaction` (`schema.prisma:993-1027`) has `type` ∈ `INWARD | OUTWARD | TRANSFER | ADJUSTMENT` (`:126-131`), `quantity`, `previousStock`, `newStock` and `createdAt`. It has **no store or warehouse column**. Its indexes already include `[type, createdAt]` and `[productId, type]` (`:1025-1026`).
- **`OUTWARD` is written in only three places:** the two delivery handover paths and the manual outward route (§2.3). Transfers write `TRANSFER` (`transfers/stock.ts`). Audits, resets and transit losses write `ADJUSTMENT`. The dashboard already treats `OUTWARD` as "sales" (`api/dashboard/stats/route.ts:36-47`).
- **Zakya POS sales do NOT reduce stock when the till rings.** Invoices are pulled from Zakya (Books as fallback) by Bulk Fetch, and approving the pull creates a `Delivery` with `status: "PENDING"` and no stock change (`api/zoho/pull-review/approve/route.ts:631-660`). Stock leaves only when that delivery is marked WALK_OUT or DELIVERED (`deliveries/[id]/route.ts:385`). Two consequences:
  - The speed is the speed of **handovers**. A walk-out sale counts only once its invoice has been imported and marked. The lag is the time between the sale and someone clearing `/deliveries`. Over a 28-day window that lag barely changes the rate, but it does mean the stock figure **overstates** reality until the walk-out is marked. The alert can never be earlier than the books.
  - Some sales are never counted. A "Dummy" delivery (no floor warehouse matched its invoice prefix) cannot be handed over (`floor-stock.ts:388-390`), and a line whose SKU matches no product is skipped (`floor-stock.ts:189`, `:330-331`). Neither writes `OUTWARD`.
- **The store of a sale.** `Delivery.storeId` exists (`schema.prisma:1992`) and `OUTWARD.referenceNo` = `Delivery.invoiceNo` (unique), so delivery sales *could* be attributed to a store by joining on that. The manual outward picks a store (`outwards/route.ts:87-95`) but never records it. That is why Q1 recommends whole-business cover.
- **In transit is not a stock row.** It is derived from `TransferOrder` status `IN_TRANSIT` (`src/lib/transfers/in-transit.ts:6-18`). A dispatch genuinely lowers `currentStock` until the receipt (`transfers/stock.ts:38-64`). `getInTransitTotals` (`in-transit.ts:57`) gives the per-product total.
- **Held stock.** `Product.reservedStock` (`schema.prisma:587`) caches `StockLevel.reservedQuantity`: units held on a floor for scheduled deliveries (`floor-stock.ts:175-227`).
- **Sales history can be erased.** `DELETE /api/inventory/cleanup` deletes every ledger row whose notes contain `[ZOHO]` (`api/inventory/cleanup/route.ts:81-83`). Every delivery `OUTWARD` row carries `[ZOHO][VERIFIED]` (`deliveries/[id]/route.ts:425`, `batch/route.ts:196`). After a cleanup, every product reads "not enough sales" until new sales accumulate. This is expected behaviour, recorded here so nobody files it as a bug.
- **No customer-returns flow** exists, so there is nothing to net off.

### 2.5 Accessories are products with stock rows

There is one `Product` table for everything: cycles, spares and accessories (`schema.prisma:565`, 5,745 rows per `docs/agents/database-architect.md`). The old `ProductType` (Cycles / Spares / Accessories) was dropped on 4 Sep 2026 (`prisma/migrations/20260904173412_drop_product_type_and_moving_level/migration.sql:4`). Classification is now `Category`. Receiving writes `StockLevel` rows for any product, and a delivery line deducts any product whose SKU matches. **So pumps, displays and accessories are covered by the same calculation, with no special case.** The view gets a category filter so leadership can look at "accessories" alone. Which categories the owner means by "electric cycles" or "displays" is data, not code.

### 2.6 Where settings live

`AppSetting` (`schema.prisma:2767-2771`) is a key/value table holding JSON text. The pattern for a typed setting is `src/lib/settings/stuck-hours.ts`:

- a zod schema;
- defaults that apply per field;
- a 5-second in-memory cache;
- `get…()` that never throws;
- `set…()` that validates and logs.

It is served by its own route, `api/settings/stuck-hours/route.ts`: `GET` on `requireAuth` (`:31-35`) because the values are printed on screens, `PUT` on `settings.edit` (`:44-50`). The generic `api/settings/route.ts` takes any key with no zod and no logging (`:40-58`). Do not copy it.

### 2.7 The RBAC vocabulary

The six actions are a closed set, defined three times: `ActionKey` (`prisma/rbac-catalog.ts:10`), `PermAction` (`src/lib/rbac.ts:20`, `src/stores/permissions.ts:21`). A seventh action (e.g. `alerts`) would change all three plus the permission editor, so it is avoided.

A **permission-only module** (`route: null`, `actions: ["view"]`) already exists: `cost_price` (`rbac-catalog.ts:528-536`). The `reorder` module is `route: null`, `actions: ["view", "edit"]` (`:443-460`). `usersWithPermission(module, action)` (`rbac.ts:278-301`) returns active users whose role holds the grant. ADMIN receives because the seeder grants ADMIN every permission (`prisma/seed-rbac.ts:182-213`).

### 2.8 Live defects found while mapping

| # | Defect | Where | Effect | In this plan? |
|---|---|---|---|---|
| L1 | The inline "Reorder Level" box is editable by anyone holding `reorder.view`, but Save calls a route that needs `reorder.edit` (`api/reorder/update-levels/route.ts:33`). | `reorder-tab.tsx:361-370` | A view-only user types levels, presses Save, and gets a 403. | **Fixed in passing** (Part D, D4): `disabled={!mayEditReorder}`. Only the edit box changes. |
| L2 | `GET /api/reorder` has no logger, and its `catch` returns without logging. | `api/reorder/route.ts:116-119` | A failed load leaves no server trace. | Not touched. This plan adds a sibling route instead. Raise separately. |
| L3 | Stock writes read the quantity, then write an **absolute** value, with no row lock. Postgres runs these transactions at READ COMMITTED (the default; `src/lib/db.ts` sets no isolation level, and nothing in `src` uses `FOR UPDATE`). | `stock-location.ts:52-61`; `floor-stock.ts:332` then `:362-368` | If two handovers of the same product from the same floor commit at the same moment, both can read 5 and both write 4. One sale is lost from the stock figure. It does not affect the rate, because both `OUTWARD` rows are written. It is rare at this shop's volume, but it is real. | Not touched (shared stock code; it needs its own plan). Raise separately. |
| L4 | `userCan` returns `true` for `roleKey === "ADMIN"`, which is an admin short-circuit that CLAUDE.md rule 2 says does not exist. | `rbac.ts:258` | Harmless here: recipients come from `usersWithPermission`, which has no short-circuit. | Note only. |
| L5 | Unused speed helpers with a `999` sentinel. | `ai-calculations.ts:3-16` | They are a trap for whoever builds this. | Not reused and not touched. |

---

## 3. Implementation plan

Four parts. A and B have no dependency on each other. C needs both. D needs A.
**One migration** (B). **One catalog change** (C). No cron, no timer, no polling, no JWT change, no Zoho.

### How the alert works, end to end

```
sale handed over ──► route's $transaction commits ──► after(() => checkStockCover(ids, "delivery"))
                                                                │
   settings (cached) ─┐                                         ▼
   OUTWARD in window ─┼─► loadCoverRows(ids) ──► for each fast mover (units ≥ min):
   first movement ────┤                            stock  = on hand + in transit
   stock / transit ───┤                            cover  = stock ÷ (units ÷ effective window days)
   alert state ───────┘                            re-arm if cover ≥ 1.5 × N  (now, or at any peak since the last alert)
                                                    stock ≤ 0       → claim "out"  → push "X is out of stock"
                                                    cover <  N      → claim "low"  → push "X: ~9 days left"
                                                    otherwise       → nothing
   claim = UPDATE … WHERE armed = true; only the request that flips it sends (two sales at once → one push)
```

**Re-arming, explained once.** After an alert, a product is *disarmed*: further sales send nothing. It *re-arms* when its cover gets back to 1.5 × N (21 days when N is 14). The gap between "alert below 14" and "re-arm at 21" stops a product sitting around 14 days from alerting on every unit received and sold.

There is no scheduler, so a recovery is only noticed at the next evaluation. One case would then be missed: a receipt lifts cover above 21, and the very first sale afterwards (say a corporate order) takes it straight below 14. To catch that, a disarmed product also checks the highest on-hand figure the ledger recorded since its last alert (`MAX(newStock)` on `InventoryTransaction` after `lastLowAlertAt`). If that peak was ≥ 1.5 × N days of cover, it recovered in between and is re-armed before the check. The ledger already records every movement's after-figure, so this needs no extra hook at receipts.

**Performance: query each time, no rollup table.** Recommended, for these reasons:

- **The work is small.** The check runs after the response has gone out (`after()`), so it never slows a sale. It is about six small indexed queries for the handful of products in one handover: a `groupBy` of `OUTWARD` rows by product for the window, served by `[productId, type]`. At the measured scale (5,745 products, about 2,000 ledger rows a month) a product's 28-day history is tens of rows. The view's all-products load is one range scan on `[type, createdAt]`.
- **A rollup table would cost more than it saves.** It would have to be written inside every stock transaction (four routes today, plus every future one). It would need a backfill. It would have to be corrected whenever `inventory/cleanup` deletes ledger rows. It would add a way for the screen and the alert to disagree. None of that buys anything at this volume.
- **Revisit if** the ledger grows past roughly 100k `OUTWARD` rows a month. That trigger is recorded here, not built.

### Part A — the measure (pure maths, a server loader, the settings)

**A1. `src/lib/stock-cover/math.ts`** (new, client-safe, no Prisma: the `reorder.ts` style)

- `effectiveWindowDays(windowDays, firstMovementAt, now)` = `max(7, min(windowDays, days since first movement))` (Q6).
- `unitsPerWeek(units, days)`, `dailyRate(units, days)`.
- `coverDays(stock, units, days)`: `null` when units = 0.
- `isFastMover(units, minUnits)`.
- `rearmCoverDays(n)` = `1.5 × n`.
- `classify({ stock, cover, n })` → `"OUT" | "LOW" | "OK"`. Uses a strict `cover < n`, and `stock <= 0` → `OUT`.
- One file, so the screen and the alert can never compute different answers. That is the lesson of the fourteen disagreeing copies in `reorder.ts:8-28`.

**A2. `src/lib/settings/fast-movers.ts`** (new). A copy of the `stuck-hours.ts` shape:

- key `fast_mover_alerts`;
- `fastMoverSettingsSchema = z.object({ windowDays: z.number().int().min(7).max(90), minUnits: z.number().int().min(1).max(100), coverDays: z.number().int().min(1).max(90) })`;
- `DEFAULT_FAST_MOVER_SETTINGS = { windowDays: 28, minUnits: 4, coverDays: 14 }`;
- `getFastMoverSettings()` (never throws, 5-second cache), `setFastMoverSettings()`.
- If Q3 = (b), add `safetyDays` and replace `coverDays` with it.

**A3. `GET` / `PUT /api/settings/fast-movers`** — `src/app/api/settings/fast-movers/route.ts` (new)

| Method | Guard | Body | Returns |
|---|---|---|---|
| GET | `requireAuth()` (the view prints the numbers, as stuck hours does) | — | the settings |
| PUT | `requireFeature("settings", "edit")` (Q10) | `fastMoverSettingsSchema` | the saved settings. A `ZodError` returns 400 with the first issue's message |

**A4. `src/lib/stock-cover/load.ts`** (new, server). `loadCoverRows(scope, settings)`. `scope` is `{ productIds }` (the alert) or `"all"` (the view). It runs:

1. `inventoryTransaction.groupBy({ by: ["productId"], where: { type: "OUTWARD", createdAt: { gte: now − windowDays }, …ids }, _sum: { quantity: true } })`.
2. Drop products with fewer than `minUnits` units. Stop early if none are left.
3. `inventoryTransaction.groupBy({ by: ["productId"], where: { productId: { in } }, _min: { createdAt: true } })` → effective window (Q6).
4. `product.findMany({ where: { id: { in }, status: "ACTIVE" }, select: sku, name, currentStock, reservedStock, brand { id, name, leadDays }, category { id, name } })`. Inactive and discontinued products never alert.
5. `stockLevel.findMany({ where: { productId: { in } }, select: quantity, warehouse { storeId, store { name } } })` → per-store on hand. **All** warehouses, so the store columns add up to `currentStock`, the same sum `recomputeCurrentStock` takes.
6. `getInTransitTotals(ids)` (`in-transit.ts:57`).
7. `stockCoverAlert.findMany({ where: { productId: { in } } })`.

Returns `CoverRow[]`:

```
{ productId, sku, name, brand, category, leadDays,
  unitsInWindow, effectiveWindowDays, unitsPerWeek,
  onHand, inTransit, held, stock /* onHand + inTransit */, byStore: [{ storeId, storeName, qty }],
  coverDays, status: "OUT" | "LOW" | "OK",
  alert: { lowArmed, zeroArmed, lastLowAlertAt, lastZeroAlertAt } | null }
```

Store names come from the `Store` rows (D1). Nothing in code names Hub or Centre.

### Part B — alert state (schema + migration)

**B1. Schema** — `prisma/schema.prisma`, a new model next to `AlertConfig`:

```prisma
/// Fast-mover alert state (plan 1210-fast-mover-stock-out-alerts). One row per product that has
/// ever been evaluated as at risk; NO ROW = armed. Not a history: who was told, and when, is
/// NotificationOutbox (eventKey "stock.fast_mover_low_cover", refId = productId).
model StockCoverAlert {
  productId         String    @id
  product           Product   @relation(fields: [productId], references: [id], onDelete: Cascade)
  lowArmed          Boolean   @default(true)  // false = "running low" already sent this episode
  zeroArmed         Boolean   @default(true)  // false = "out of stock" already sent (Q4)
  lastLowAlertAt    DateTime?                 // null until the first alert; kept across re-arms
  lastZeroAlertAt   DateTime?
  // What the last alert said — the view shows it without recomputing the past. Integers only:
  // cover is derived from them, so no Float column is added (database-architect red flag).
  stockAtAlert      Int?
  unitsAtAlert      Int?
  windowDaysAtAlert Int?
  thresholdDays     Int?                      // N in force when it fired
  rearmedAt         DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
}
```

`Product` gains the back-relation `coverAlert StockCoverAlert?`. That is a Prisma field, not a column; the `Product` table does not change.

Why each choice:

- **`Cascade`.** This is ephemeral state about a product, and `prisma/wipe-products.ts` hard-deletes products.
- **The `*AtAlert` columns are nullable.** A row created by the first claim has values, but the columns stay meaningful only after an alert. That is a genuine "linked later" case.
- **No extra index.** Every read is by primary key (`productId IN (…)`), the same reasoning the 0809 plan's schema review gave for small tables.
- **If Q1 = (b):** the key becomes `@@id([productId, storeId])` with `storeId → Store`.

**B2. Migration.** Run `npx prisma migrate dev --name stock_cover_alert` **on localhost only**, against a database restored from a production snapshot (rules 2, 10). Expected SQL is one `CREATE TABLE "StockCoverAlert"` with its primary key, plus one `ADD CONSTRAINT … FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE`. Nothing else.

- **Rule 3:** no `DROP`, no type change, no `SET NOT NULL` on a populated table. It creates a new, empty table.
- **Rule 7:** purely additive. The current code ignores the table, and the new code works with it empty, because no row means armed. **No backfill.**
- **Rules 4 and 9:** snapshot before merging (`npm run db:snapshot`). Apply by hand on each target with `migrate status`, then `migrate deploy`, **before** the code goes live.

### Part C — the alert

**C1. Event** — `src/lib/notify/events.ts`, added after `stock.below_reorder`:

```ts
"stock.fast_mover_low_cover": {
  label: "Fast mover running out",
  description: "A fast-selling product fell below the days-of-cover threshold, or ran out — goes to holders of stock_alerts.view",
  defaults: { push: true },
},
```

Settings → Notifications and the personal preferences list pick it up with no other change (§2.1).

**C2. RBAC catalog** — `prisma/rbac-catalog.ts`, after `reorder` (`:443-460`), if Q2 = (a):

```ts
{
  // Plan 1210-fast-mover-stock-out-alerts (R7, Q2 a). "Leadership" as a grant, never a role
  // name. Permission-only, like cost_price: no page of its own. The alert links to the Reorder
  // tab, which also needs reorder.view — grant both to whoever should receive it.
  // ⚠ RUN npm run db:seed:rbac AFTER DEPLOY.
  key: "stock_alerts",
  label: "Fast-mover stock alerts",
  description: "Receive a push when a fast-selling product is about to run out, or has run out",
  icon: "Bell",            // present in src/lib/module-icons.ts
  route: null,
  group: "Purchase",
  sortOrder: 245,
  actions: ["view"],
},
```

This is data, not a migration. After the deploy the owner runs `npm run db:seed:rbac` (ADMIN gets the grant automatically), then ticks **Fast-mover stock alerts › View** and **Reorder › View** on the leadership role(s) at `/team/permissions`. Until then the alert has no recipients, and C3 does **not** use up the episode (see step 4 below).

If Q2 = (b), the change is `actions: ["view", "edit", "approve"]` on `reorder` and recipients become `usersWithPermission("reorder", "approve")`. If Q2 = (c), there is no catalog change.

**C3. `src/lib/notify/stock-cover.ts`** (new). `checkStockCover(productIds: string[], source: StockDropSource)`. `StockDropSource` is `"manual_outward" | "delivery" | "delivery_batch" | "stock_audit"`.

It follows the `notify/stock.ts` rules: it is called after commit, it **never throws**, and every failure is logged.

1. Dedupe the ids. Return early if the list is empty. Read the settings.
2. `rows = loadCoverRows({ productIds }, settings)`, which keeps fast movers only.
3. **Re-arm.** For each row whose state has `lowArmed === false` or `zeroArmed === false`:
   - if `coverDays ≥ rearmCoverDays(N)` now, **or**
   - if `aggregate({ _max: { newStock } }, where: { productId, createdAt: { gt: lastLowAlertAt ?? lastZeroAlertAt } })`, divided by the current daily rate, is ≥ `rearmCoverDays(N)`,

   then `updateMany({ where: { productId }, data: { lowArmed: true, zeroArmed: true, rearmedAt: now } })` and `log.info("re-armed", …)`.
4. **Decide.** `classify` each row. If nothing is `OUT` or `LOW`, write `log.debug` and return. Otherwise resolve `recipients = usersWithPermission("stock_alerts", "view")`. **If there are none, log a warning and return without claiming**, so the alert still fires once someone holds the grant.
5. **Claim, atomically.**
   - `createMany({ data: [{ productId }], skipDuplicates: true })` makes sure the row exists.
   - For `OUT`: `updateMany({ where: { productId, zeroArmed: true }, data: { zeroArmed: false, lowArmed: false, lastZeroAlertAt: now, …AtAlert } })`. One "out of stock" message replaces the low one.
   - For `LOW`: `updateMany({ where: { productId, lowArmed: true }, data: { lowArmed: false, lastLowAlertAt: now, …AtAlert } })`.
   - **`count === 1` means this request owns the alert.** Postgres row-locks the `UPDATE` and re-checks the `WHERE` after the lock, so two sales evaluated at the same moment produce exactly one push. This is the idempotency guard the backend doc asks for, and `count` is the confirmation its red flag on `updateMany` wants.
6. **Send** one `notify("stock.fast_mover_low_cover", …)` per claimed product, with `refId` = `productId`. Same shape as `stock.below_reorder`, so every outbox row names its product.

   | | LOW | OUT |
   |---|---|---|
   | title | `"<SKU>: about 9 days of stock left"` | `"<SKU> is out of stock"` |
   | body | `"<name> — 5 in stock (2 in transit), selling 3.0/week. Alert below 14 days."` | `"<name> — selling 3.0/week; none on hand or in transit."` |
   | link | `/purchase-orders?tab=reorder&view=fast-movers` | same |
   | data | `{ productId, sku, coverDays, unitsPerWeek }` (strings) | same |

**Why this does not storm.** Once per episode per product (claim + re-arm hysteresis). Only fast movers. Never from the stock-reset or cleanup tools. One indexed batch of reads per request, however many deliveries the request held.

**C4. The four call sites.** Each adds one line next to what it already does.

| File | Change |
|---|---|
| `api/deliveries/[id]/route.ts:452` | `after(() => checkStockCover(crossings.map((c) => c.productId), "delivery"));` |
| `api/deliveries/batch/route.ts:217` | same, `"delivery_batch"` |
| `api/inventory/outwards/route.ts:176` | same, `"manual_outward"` |
| `api/stock-counts/[id]/route.ts` | declare `const coverDrops: string[] = []` beside `applied`. Inside the apply loop, after `if (delta === 0) continue;` (`:463`): `if (delta < 0) coverDrops.push(product.id);`. After the transaction (`:613`), next to the `notifyStockAudit` block: `if (coverDrops.length) after(() => checkStockCover(coverDrops, "stock_audit"));`. Import `after` from `next/server` and add `export const runtime = "nodejs"` with the comment the three outward routes carry (`outwards/route.ts:3-7`): `notify()` signs FCM requests with node crypto. |

`maybeNotifyBelowReorder` is **not** changed and is not merged with this check. Its audience, meaning and event stay exactly as they are. An audit shortage still does not raise `stock.below_reorder`, as today.

`after()` runs once the response has been sent and is kept alive on Vercel through `waitUntil` (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`, "after-serverless"). It is already used by all three outward routes.

### Part D — the "Fast movers" view

**D1. `GET /api/reorder/fast-movers`** — `src/app/api/reorder/fast-movers/route.ts` (new)

- Guard: `requireFeature("reorder", "view")`. This is the Reorder tab's own grant. Cost price is not returned, so `cost_price` is not involved.
- Query: `show` = `z.enum(["risk", "all"]).default("risk")`. `risk` keeps `status ∈ { LOW, OUT }`. `all` returns every fast mover.
- Response:

  ```
  { settings, stores: [{ id, name }],
    summary: { fastMovers, atRisk, outOfStock },
    rows: CoverRow[] }
  ```

  The list is already bounded to fast movers (tens to a few hundred rows), so sorting and filtering are done in the browser and the route takes no sort parameter.
- `export const dynamic = "force-dynamic"`. Every `catch` logs, unlike its sibling (L2).

**D2. `reorder-tab.tsx`.** A two-option segmented control at the top:

- **Below reorder level**: the existing list, unchanged.
- **Fast movers**: the new view.

The choice lives in the URL as `?tab=reorder&view=fast-movers`, via `router.replace`, following `purchase-orders/page.tsx:104-105`, so the push link lands on the right view. The page already wraps the tab in `<Suspense>` (`page.tsx:80-86`), which `useSearchParams` requires.

**D3. `purchase-orders/_components/fast-movers-view.tsx`** (new; its own file because `reorder-tab.tsx` is already 421 lines)

- **Header line:** "Alert below **14** days · a fast mover sold **4+** in **28** days". For `settings.edit` holders, a ⚙ button opens `fast-mover-settings-sheet.tsx` (new): three number inputs, Save through `apiTry(PUT /api/settings/fast-movers)`, the field errors from the 400 shown inline, and the button disabled while saving.
- **Filters:**
  - At risk / All fast movers chips, default **At risk**;
  - a search box (name / SKU);
  - a category select built from the rows, so "accessories" is one tap.
- **Columns / card fields:**

  | Field | Shows |
  |---|---|
  | Product | name, SKU, brand |
  | Units/week | one decimal |
  | Stock | on hand + in transit, with a per-store line (`BCH Store 3 · BCC Store 2 · 1 in transit · 2 held`) |
  | Days of cover | `~9 days`; red "Out of stock" when `OUT`; amber below N |
  | Lead days | brand lead time, so cover can be read against it |
  | Last alert | relative time plus LOW / OUT, or "—" |

- **Sorting.** Phone (cards, `lg:hidden`): a sort select (cover ↑ by default, units/week ↓, stock ↑, last alert ↓, name). Desktop (`hidden lg:block`): a table whose headers sort, copying the `SortHeader` pattern from `stock/_components/stock-table.tsx:54-80`.
- **States:** a skeleton while loading (`SkeletonList`). `ErrorBanner` with Retry on failure, the `reorder-tab.tsx:273-275` pattern. Empty state: "No fast mover is below 14 days of cover". A first-run hint when there are no sales in the window at all.
- **Phone layout:** 44 px touch targets, single column at 375 px.
- **Loading:** `apiTry` only, never raw `fetch().json()`. `canEdit("settings")` comes from `usePermissions()`; no role names anywhere.

**D4 (in passing, L1).** `reorder-tab.tsx:364-370`: the inline Reorder Level `<input>` gains `disabled={!mayEditReorder}`, so a view-only user is no longer offered a Save that 403s. One attribute; the 1509 plan's "keep both" (Q11 there) is untouched.

### Phases and dependencies

| Phase | Work | Depends on |
|---|---|---|
| P1 | A1 maths, A2 settings lib, A3 settings route | Q3, Q6 |
| P2 | B1 schema + B2 migration | Q1, Q4 |
| P3 | A4 loader | P1, P2, Q1, Q7 |
| P4 | C1 event, C2 catalog, C3 `checkStockCover` | P3, Q2 |
| P5 | C4 the four call sites | P4, Q5, Q8 |
| P6 | D1 route, D2–D3 screen, D4 | P3, Q9, Q10 |

**Sibling plans:** no dependency in either direction. It reads the `Store` table (D1) and adds nothing to it. Files shared with siblings are `prisma/schema.prisma` (each sibling adds models), `prisma/rbac-catalog.ts` (plan D adds a bank module) and `src/lib/notify/events.ts`. These are textual merge conflicts only. If another sibling's migration merges first, rebase and re-run `migrate dev` locally, so this migration's timestamp sorts after it and `migrate status` stays clean.

### Logging

| Scope (`createLogger`) | Level | What is logged (ids and counts only, never payloads) |
|---|---|---|
| `stock:cover` (loader) | debug | `{ scope: "ids" \| "all", asked, fastMovers, ms }` per load |
| `notify:stock-cover` | debug | `"evaluated" { source, checked, fastMovers, low, out }` |
| | info | `"re-armed" { productId, coverDays, via: "now" \| "peak" }` |
| | info | `"fast-mover alert claimed" { productId, kind: "LOW" \| "OUT", coverDays, unitsPerWeek, stock, recipients }` |
| | debug | `"already alerted" { productId, kind }` (claim count 0) |
| | warn | `"at risk but nobody holds stock_alerts.view" { productIds }` (not claimed) |
| | error | `"cover check failed" { source, count, error }` (never rethrown) |
| `reorder:fast-movers` (route) | debug | `"-> GET" { show }`, `"<- rows" { rows, ms }` |
| | error | `"fast movers load failed" { show, error }` |
| `settings:fast-movers` (lib + route) | info | `"updated" { userId, windowDays, minUnits, coverDays }` |
| | warn | stored value invalid → defaults used |
| | error | write failed |
| `purchase-orders:fast-movers` (client) | error | load failure with the API message |
| | info | settings saved |
| | debug | sort / filter changed |

Every `catch` logs before it returns. `notify()` already writes the per-recipient outbox rows.

### Board of agents — checked

**inventory-consultant** (`docs/agents/inventory-consultant.md`)

- *ABC classification by sales velocity* (principle 4): this is that measure, computed rather than typed ✓.
- *Reorder point = avg daily sales × lead time + safety stock* (principle 6): the default N = 14 is the default 7-day lead time plus 7 days of safety. Q3 (b) offers the full per-brand formula. The view shows lead days beside cover ✓.
- *Red flag "stock below reorder point for A-items"*: exactly what fires ✓.
- *"Always ask: current stock, lead time, daily sales rate"*: all three are on every row ✓.
- *Red flag "outward deducted before delivery confirmed"*: the rate counts only handed-over goods ✓.
- **Flagged to the owner:** walk-out sales reduce stock only once the invoice has been imported and marked (§2.4). Stock therefore reads high until then, and an alert can be **later than reality, never earlier**. The cure is clearing `/deliveries` promptly, not this plan.

**database-architect** (`docs/agents/database-architect.md`)

- New model with `createdAt` / `updatedAt` and an explicit `onDelete` ✓.
- No `Float`: the alert snapshot is integers and cover is derived ✓.
- Additive migration, empty table, no backfill, SQL to be read before commit ✓.
- Indexes justified by the queries that run: primary-key lookups only, and the rate query is served by the existing `[productId, type]` / `[type, createdAt]` ✓.
- No N+1: the loader is six batched queries, whatever the product count ✓.
- The claim is a single-row conditional `UPDATE`, so it is idempotent ✓.
- Asked and answered: *who applies the migration and when* → by hand, before the deploy (B2) ✓.

**backend-engineer** (`docs/agents/backend-engineer.md`)

- zod on the only body-taking route (`PUT` settings) and on the `show` query ✓.
- Auth on every route ✓.
- *"What if this runs twice / two users at once?"* → the claim (C3 step 5) ✓.
- Human error messages; 400 for validation ✓.
- **Two deliberate deviations from this doc:**
  - Its template guards with `requireAuth(["ADMIN","SUPERVISOR"])`, which is a role list that CLAUDE.md rules 1–2 forbid. This plan uses `requireFeature`, and the doc's example is stale.
  - It says business logic lives in `route.ts`. Here the check lives in `src/lib/notify/stock-cover.ts` because four routes and the view share it, as `notify/stock.ts` already does.

**frontend-engineer** (`docs/agents/frontend-engineer.md`)

- Loading, error and empty states ✓.
- Buttons disabled while busy ✓.
- 44 px targets, single column at 375 px ✓.
- No component over 300 lines (the view gets its own file) ✓.
- `usePermissions`, no role names ✓.
- **Deviation:** the doc's sample fetch is raw `fetch().then(r => r.json()).catch(() => {})`, which CLAUDE.md bans. This plan uses `apiTry`. The doc's example is stale.

No violation of any doc's principles remains open.

---

## 4. Verification

**No Zoho writes, and no Zoho reads are needed to test this.** The test database holds
production's live Zoho credentials (since 12 Oct 2026). Do **not** run a Bulk Fetch or press
Settings › Integrations › Disconnect on test while verifying this. Use deliveries already
imported in the restored snapshot, or the manual outward API, to create sales.

**Build and schema**

1. `npx tsc --noEmit`, `npx eslint` on the touched files, then `npm run build` with Postgres running.
2. Read `prisma/migrations/<ts>_stock_cover_alert/migration.sql`: one `CREATE TABLE` and one FK with `ON DELETE CASCADE`, nothing else. `npx prisma migrate status` is clean on local.
3. `npm run db:seed:rbac` locally. `/team/permissions` shows **Fast-mover stock alerts › View**. Grant it, and Reorder › View, to a test role holding a user who has a registered push device. Turn push on in Settings → Notifications on the local or test site.

**Calibrate against real data** (on a restored production snapshot, rule 10):

```sql
SELECT p.sku, p.name, c.name AS category, SUM(t.quantity) AS units_28d, p."currentStock"
FROM "InventoryTransaction" t
JOIN "Product" p ON p.id = t."productId" JOIN "Category" c ON c.id = p."categoryId"
WHERE t.type = 'OUTWARD' AND t."createdAt" >= now() - interval '28 days'
GROUP BY p.id, c.name ORDER BY units_28d DESC LIMIT 50;
```

4. Open `/purchase-orders?tab=reorder&view=fast-movers` → **All fast movers**. The top rows' units/week equal `units_28d ÷ 4` for products older than 28 days. Stock equals `currentStock` plus in-transit. Per-store figures add up. Share the top-50 list with the owner to confirm the defaults (Q6) before go-live.

**The alert**

5. Pick a fast mover whose cover is just above N. Hand over one of its deliveries (WALK_OUT on `/deliveries/[id]`), or post a manual outward from the browser console with `apiFetch("/api/inventory/outwards", { method: "POST", json: { productId, quantity } })`, until cover drops below N. Check:
   - one push arrives, and one inbox row appears on `/notifications`;
   - `notification_outbox` has a row with `eventKey = 'stock.fast_mover_low_cover'` and `refId` = the product;
   - `StockCoverAlert.lowArmed = false`;
   - the view shows "Last alert: just now · LOW".
6. Sell one more → **no** second push. The log shows `already alerted`.
7. Receive stock (approve an inbound) until cover is ≥ 1.5 × N, then sell one → log `re-armed (via now)`. Sell down below N → a second alert.
8. Repeat 7, but take the first sale after the receipt straight below N (one large manual outward) → log `re-armed (via peak)`, then an alert.
9. Sell to zero → exactly one "out of stock" push (Q4).
10. `PUT /api/deliveries/batch` DELIVERED on two deliveries carrying the same product, which crosses → exactly **one** push for it.
11. Dispatch a transfer of a fast mover → no alert, and the view's in-transit column rises by the quantity.
12. Approve an audit with "Set system stock to the counts" that records a shortage on a fast mover → the check runs (log `source: "stock_audit"`). A `stock.below_reorder` push is **not** newly raised by the audit.
13. A product with 2 sales in 28 days → absent from the view, never alerts.
14. Remove the grant from every role → a drop below N logs `nobody holds stock_alerts.view`, and `lowArmed` stays `true`. Restore the grant, sell one → the alert fires.
15. Push master switch off → outbox `SKIPPED`, no inbox row. The view still lists the product (Q12).

**Screen and settings**

16. A `settings.edit` user changes N from 14 to 7 → the header and the list recompute. A user without `settings.edit` sees no ⚙ button, and a hand-made `PUT` returns 403. `windowDays: 3` returns 400 with the field message.
17. Sort by each column on desktop and by each option on a 375 px phone. Filter by category. Search.
18. A `reorder.view`-only user: the inline Reorder Level box is disabled (L1). The Fast movers view loads.
19. Run once with `LOG_LEVEL=0` and read the `notify:stock-cover` lines against the Logging table.

---

## 5. Out of scope, deliberately

- **Per-store alerts** (unless Q1 = b). A store that is short while the other holds stock is a transfer, and `stock.transfer_needed` covers it.
- **Changing what "low" means.** `isLowStock`, `Product.reorderLevel`, the `stock.below_reorder` event and its `reorder.edit` audience are untouched. So is the dashboard's on-hand vs available disagreement (`reorder.ts:15-20`).
- **Suggesting reorder levels or PO quantities from the rate.** It is the natural next step (rate × lead time + safety), but it was not asked for and it changes numbers people already use.
- **A daily or weekly digest.** It would need a scheduler, which this app does not have. The view is the summary.
- **WhatsApp or email delivery** (Q9; §2.2).
- **Dead stock** (no movement for 90 days, inventory-consultant principle 5), ABC classes, trend and seasonality.
- **The walk-out lag** (§2.4). It is fixed by how `/deliveries` is worked, not by this plan.
- **Sales returns.** No such flow exists to net off.
- **A rollup table.** Rejected in §3. The threshold to revisit it is recorded there.
- **L2–L5** (§2.8): raised, not fixed here.
- **Zoho.** Nothing read, nothing written.
