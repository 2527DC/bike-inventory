# Priority build & stock flow — units in sync, outward guard, ★ priority, approvals, hold, sidebar, dashboard

Status: pending — written 17 Sep 2026, **waiting for the owner's approval before any build**.
Branch: **`feat/1709-priority-build-stock-flow`**, off `main` `861a237`. Requirements committed there
as `dcdb594`.

Source of truth for *what* to build: `docs/implementation/requiremnts/priority-build-and-stock-flow-requirements.md`
(R1–R37, and 41 answers Q1–Q44, all given by the owner on 17 Sep 2026). This plan does not
re-ask any of them. It adds only the questions the code raised while planning (§1).

Every `file:line` below was read from disk on 17 Sep 2026 at `861a237` by five read-only agents,
with the key places re-checked by hand. Check rather than trust.

---

## 0. Requirement

### 0.1 The owner's words, verbatim

16 Sep 2026:

> i need u to create a requiremnt  file where /assembly  when the  let the rout has t tab= with the related scren and the thing is  when the assigne user start the assemble to pause i have lot of option i need just two option wheere ISSUE WITH  ISSUE WITH the cycle and  ISSUE ON THE WORKFLOOR by choosing any one of this option i need to the work has to be hold & 'f:\bharath  Cycle\BCH-Management\docs\asset\BCH OPS - Priority Build & Stock Flow.pdf' this is the pdf  in this get only this OUTWARD WHEN THE CYCLE IS IN THE WAREHOUSE data  and ASSEMBLED VS UNASSEMBLED  and PRIORITY DELIVERY FIRST  and this EVERY PROCESS HAS A DOER AND AN APPROVER  and dashbord designing  and also related to the sidebar  take this acnd create a requiremnt file insied the & 'f:\bharath  Cycle\BCH-Management\docs\implementation\requiremnts'  folder

17 Sep 2026:

> what u do is  i need u to switch to the other branch and commit it in the other branch and   create a implmentation plan  and stat implmenting use multiple agent to implemnt the implemenattion

The brief's words (Ibrahim, 15 Sep 2026) are quoted in full in the requirements doc §1.2.

### 0.2 Restated — the requirements, as narrowed by the owner's answers

The numbering is the requirements doc's. Where an answer changed a requirement, the change is
stated in the row.

| # | Requirement (after answers) | Answers | Part |
|---|---|---|---|
| R1 | Each `/assembly` tab has its own address `?tab=awaiting` / `tasks` / `mine` / `labels`; switching updates it (replace, not push). | Q1, Q26 | E |
| R2 | A `?tab=` the user may not see falls back to one they can. | — | E |
| R3 | Hold offers exactly **ISSUE WITH THE CYCLE** and **ISSUE ON THE WORKFLOOR**; the six reasons and free text go. | — | E |
| R4 | One tap holds. No confirm, no undo bar; a mis-tap is fixed by **Resume**. | Q4 | E |
| R5 | The timer freezes on hold and shows the frozen value after a reload. | defect 1 | E |
| R6 | The chosen issue is stored against the build. Mechanic adds nothing; a supervisor may add a note. | Q3 | E |
| R7 | Every unit carries a condition (assembled / unassembled) per model and location, and **unit records stay in sync with stock** on every transfer, sale, correction and audit. The app picks units (assembled first, then oldest); a person can swap. | Q33, Q41 | B |
| R8 | The build line lists **all** unassembled units; no page limit may hide a unit from selection. **Every inbound item needs assembling** — no category filter. | Q34, Q44 | E |
| R9 | Awaiting: multi-select + bulk assign; filter model / brand / location / bin; sort delivery day / received date / model; ★ first. | Q20 | E |
| R10 | Assembled units show in Stock & inventory. | — | F |
| R11 | A page shows assembled vs unassembled per model per location. No "not tracked" column: stock is **reset and re-audited at unit level**, one warehouse at a time — the audit records assembled qty + unassembled qty; the reset clears counts **and** units. | Q13, Q42, Q43 | B, F |
| R12 | Place of supply = the outward's matched **FLOOR** warehouse. "The warehouse" = a **GODOWN of the same store**. | Q7 | C |
| R13 | Scheduling is never blocked (A26/A37 stand). A short floor shows a warning naming the godown quantity. The **hard block** is at `OUT_FOR_DELIVERY` (new, single and batch), `WALK_OUT` and `DELIVERED`, and names where the stock is. Quantity only, not condition. | Q31, Q10, Q11 | C |
| R14 | The shortage **notifies every user holding `transfers.create`** (except the actor). | Q31, Q14 | C |
| R15 | The transfer is `GODOWN_TO_FLOOR` with **one** document, raised and approved as today. | Q7, Q38 | D |
| R16 | Starring a short outward **picks and reserves** units in that store's godown; unassembled ones appear ★ on Awaiting **at once**, before the transfer is approved. | Q35, Q12 | C |
| R17 | Once received, the floor holds the units; the outward's check passes. | — | B, C |
| R18 | **Day only** — no delivery time. The customer picks the day as today; slot rules unchanged. | Q32, Q40 | — |
| R19 | ★ is set and cleared by users holding the **new `delivery_priority.edit`** grant. | Q21 | C |
| R20 | ★ jobs first on Awaiting, Tasks and My Build Queue, ordered by delivery day then star time; cards show the delivery day. No ★ tab. | Q2, Q20 | E |
| R21 | ★ can be removed any time; a build in progress carries on; reserved units are released; every set/clear is logged. | Q21 | C |
| R22 | Inbound, Outbound, Transfer and Stock audit each have a doer and an approver — **by role permission only** (`create`/`edit` = doer, `approve` = approver). No named people. | Q14 | D |
| R23 | Anyone whose role holds `approve` may approve, **including their own record**. The stock-audit self-block is removed; transfer auto-approve stays. | Q15 | D |
| R24 | A request pushes to every holder of the `approve` grant (except the requester). Android/desktop notifications carry **Approve · Reject · Open**; iPhone opens. | Q14, Q19 | D |
| R25 | Reject sends the record back as **returned**, with a note; the creator fixes it and resubmits the **same record**. Transfers and inbound (inbound Reject is new). | Q17, Q36 | D |
| R26 | Every approval event is recorded. An approver error = a correction within N days (default 7) of an approved inbound/transfer, a short receive, or a reversal; customer flags recorded but not counted. Rule and N are settings. | Q18 | D |
| R26a | **Outbound approval** before `OUT_FOR_DELIVERY` / `SHIPPED` via `deliveries.approve`; walk-outs need none. Dummy deliveries are excluded from the guard, ★, push and approval. | Q16, Q37 | C |
| R27 | Operations = **Build line assembly** (top) then **Stock management**. | — | F |
| R28 | Stock management expands only (no link); holds **Stock & inventory**, a divider, then 1 Inbound · 2 Outbound · 3 Stock transfer · 4 Stock audit. `/stock-management` stays reachable by URL. | Q23, Q27 | F |
| R29 | Barcode & labels = the **Labels** tab on `/assembly`. | Q26 | E, F |
| R30 | POS & settlement moves to Accounts. | — | F |
| R31 | New **Sales** group: Customers · Customer complaints · Second-Hand Cycles. | Q25 | F |
| R32 | **Admin › Settings › Store management**, one screen with tabs Stores · Warehouses · Bins. Module keys kept. | Q24 | F |
| R33 | Categories and Brands leave the menu and appear as chips inside Stock & inventory. | — | F |
| R34 | Mobile bottom bar stays per-user pins; no code. | Q28 | — |
| R35–R37 | **One** dashboard replaces the six variants; each card shows only if the viewer's role holds its grant; rows Money · Stuck · In progress · Done today · Stock by condition. Stuck = approvals > 24 h, inbound > 72 h, holds > 24 h, short outwards immediately; hours are settings. | Q29, Q30 | G |

---

## 1. Questions and clarifications — raised by the code while planning

All 41 requirement questions are answered in the requirements doc. These five came up while
mapping the code for §3. Each changes the build; each has a recommended default.

| # | Question | Why it changes the build | Options | Recommended default | **Answer** |
|---|---|---|---|---|---|
| **P1** | **Inbound receive in bin mode writes no `StockLevel`.** It updates `Product.currentStock` and `BinStock` only (`api/inbound/[id]/route.ts:265-284`), while no-bin mode calls `adjustWarehouseQty` (:286-301). Units are created either way (:312-324). Fix it here? | R7 needs per-warehouse quantity and units to agree. In bin mode the warehouse count stays 0 while units exist there, so the outward guard (per floor `StockLevel`) and the condition page disagree from the first receive. | (a) bin mode also writes `StockLevel` into the bin's warehouse; (b) leave it | (a) — it is the same root cause R7 exists to fix | |
| **P2** | **Deleting an inbound shipment leaves its units** (`api/inbound/[id]/route.ts:511-528` reverses stock with `deductAnywhere`, units untouched). | Orphan units stay "unassembled" on Awaiting for stock that no longer exists. | (a) the shipment's unsold units are retired with it; (b) leave | (a) | |
| **P3** | **What "clear the unit records" means on reset (Q43).** A unit may already have assembly tasks, bin movements and transfer rows pointing at it. | Hard-deleting rows breaks that history (or cascades it away). | (a) mark them with a new status **`RESET`** (cleared by a stock reset) and close their open assembly tasks as `CANCELLED`; (b) delete the rows | (a) — history stays readable, and "reset" is distinguishable from "lost" in the error metrics | |
| **P4** | **Two older stock paths.** `api/inventory/inwards/verify` adds quantity with no units (:50-52); `api/inventory/cleanup` reverses inwards/outwards **outside a transaction** (:37-39). | Either one breaks R7's sync if it is still used. | (a) inwards/verify creates unassembled units; cleanup is left alone and listed as a known gap; (b) both kept in sync; (c) leave both | (a) — cleanup is a maintenance route with no transaction; fixing it properly is its own piece of work | |
| **P5** | **The divider inside Stock management (Q23).** The sidebar has no divider support (`app-sidebar.tsx:345-365`), and the menu is data. | A divider needs a signal that is data, not a hardcoded module key. | (a) new column `Module.dividerBefore Boolean @default(false)`, set by the catalog on `inbound`; (b) no divider, only ordering | (a) — one additive column, no module key in code | |

### 1.1 Decisions on record

| # | Decision | Date |
|---|---|---|
| — | Build on `feat/1709-priority-build-stock-flow`; requirements committed as `dcdb594`. | 17 Sep 2026 |
| — | Plan first, then **pause for approval**; the build then runs with parallel agents, one commit per wave. | 17 Sep 2026 |

---

## 2. How it works today — verified against the code

The full current-state record is the requirements doc **§5** (re-verified 17 Sep at `861a237`).
What follows is only what decides *this* build's design, including what the planning agents found
beyond §5.

### 2.1 Every place stock quantity changes (the R7 surface)

Shared helpers `src/lib/stock-location.ts`: `adjustWarehouseQty` :51 (clamps at 0),
`deductFromStore` :106 (floor then godown), `deductAnywhere` :178, `addAnywhere` :212,
`setWarehouseQty` :306. `src/lib/transfers/stock.ts`: `moveOutOfWarehouse` :38,
`moveIntoWarehouse` :79. **None touch `InventoryUnit`.** Unit codes: `nextUnitCode(db)`
`src/lib/sequence.ts:129-133` (row-locked `counter` upsert).

| Path | Quantity change | Units today |
|---|---|---|
| `inbound/[id]/route.ts` receive | bin mode: `currentStock` + `BinStock` only (:265-284, **P1**); no-bin: `adjustWarehouseQty` (:286-301) | created (:312-324) |
| `inbound/[id]/route.ts` DELETE | `deductAnywhere` (:525) | **untouched (P2)** |
| `inventory/inwards/verify` | `adjustWarehouseQty` / `addAnywhere` (:50-52) | none (**P4**) |
| `inventory/cleanup` DELETE | reversals, **no transaction** (:37-39) | none (**P4**) |
| `inventory/outwards` POST | `deductFromStore` (:98) | none |
| `transfer-orders/[id]/dispatch` | `moveOutOfWarehouse` (:148) | only if `unitIds` sent (:177-196) — **the UI never sends them** (`transfers/[id]/_components/dispatch-sheet.tsx:103-112`) |
| `transfer-orders/[id]/receive` | `moveIntoWarehouse` (:155); shortfall ADJUSTMENT row (:179) | moves every dispatched unit, sets `PUT_AWAY`, **ignores `receivedQty`** (:195-212) |
| `deliveries/[id]/route.ts` DELIVERED / WALK_OUT | `deductDeliveryFromFloor` (:351) | none |
| `deliveries/batch` DELIVERED | `deductDeliveryFromFloor` (:111) | none |
| `stock-counts/[id]` approve + apply | per line `delta = counted − live` (:423); `setWarehouseQty` (:430), surplus `adjustWarehouseQty` (:433), shortage `deductFromStore` (:439), bin (:444) | none |
| `stock-counts/[id]` DELETE completed | sets `currentStock` directly, no `StockLevel` (:605-612) | none — out of scope (§5) |
| `stock-reset` | `location` bin-prefix only; zeroes all `StockLevel` rows of matched products (:24-61); **no UI calls it** | none |
| `bins/move`, `bins/assign`, `inbound/[id]/putaway` | `BinStock` only | bin / status only |

Delivery lines are JSON, not rows: `Delivery.lineItems {name, sku, quantity}`; `stockLines()`
`src/lib/deliveries/floor-stock.ts:41` keeps SKU lines only; `deductDeliveryFromFloor` :165 checks
then writes `stockLevel.update` directly (:201). Pre-booked deliveries carry no SKU.

### 2.2 Approvals, notifications, settings

- **Inbound approve** `api/inbound/[id]/approve/route.ts`: no body, `inbound.approve` :18, 400 if
  already approved :27, stamps `approvedAt/ById` + `logActivity` :32-54. UI
  `inbound/[id]/page.tsx:580-596`; receive controls need `isApproved` (:598…). No reject, no
  request step.
- **Transfer approve** `transfer-orders/[id]/approve/route.ts` body `{action, rejectionNote?}`
  :16-19; reject claims `PENDING` with `updateMany` :84-115; approve re-checks source stock
  :131-140. Detail UI `transfers/[id]/page.tsx` posts `{action}` only, **no note** (:145-156);
  buttons from `computeActions` `src/lib/transfers/actions.ts:64-70`. List page approves too
  (`transfers/page.tsx:126-130`). **No edit route** for an order after create. Auto-approve on
  create `transfer-orders/route.ts:370-373`.
- **Stock count** PUT `stock-counts/[id]/route.ts:127`; self-block **:172-175**; UI hides approve
  for the assignee `stock-audit/[id]/page.tsx:450`; approval screen `stock-audit/[id]/review/page.tsx:222-234`.
- **Deliveries** `OUT_FOR_DELIVERY`: `dispatch-form.tsx:35` via `detail-actions.tsx:127-139`, and
  batch `deliveries/dispatch/page.tsx:219` → `api/deliveries/batch` (≤ 50 ids, `deliveries.edit`).
  `SHIPPED`: `detail-actions.tsx:205-222`.
- **Notify** `notify(eventKey, {recipients, title, body, refId?, link?, data?})`
  `src/lib/notify/index.ts:55`, called **after commit** (`types.ts:46-51`); events registry
  `src/lib/notify/events.ts:27-53` `{label, description, defaults}`; recipients from
  `usersWithPermission(module, action)` `src/lib/rbac.ts:271`. FCM message
  `src/lib/notify/push.ts:370-393` (notification + data, **no actions**); `public/sw.js` push
  :49-85, click :87-115 (no `event.action`). Master switch ships off. **No native app** in the
  repo — Android devices are web push in Chrome, which supports actions.
- **Settings** `AppSetting {key, value, updatedAt}` (S:2514). Pattern to copy:
  `src/lib/settings/bin-tracking.ts` (cached reader :16-42, upsert :47-75) + its route.
- **Activity log** `logActivity(db, entry)` `src/lib/activity-log.ts:76`.
- **Vendor issue** `VendorIssue` (S:1777), POST `api/vendor-issues` (`vendor_issues.create`),
  required `issueType` + `description` (+ `vendorId` for VENDOR). **No product or unit column.**
  `InventoryUnit.inboundShipmentId` → `InboundShipment.brandId` / `vendorBillId` (S:2238, :2272).

### 2.3 Screens

- `/assembly` `page.tsx` is **1278 lines, all inline**: tabs :505-507, Awaiting :573-683, Tasks
  :684-805, My Build Queue :806-998, hold modal :1000-1064, assign modal :1164-end. GET
  `api/assembly/tasks` params :35-41, 50-row pending page, `unitCode asc`, response :137-146.
- `/scanner` `scanner/page.tsx` (290 lines, inline, "Search & Scanner").
- Sidebar `src/components/app-sidebar.tsx`: tree :94-140, child sort :159, parent row :299-341,
  children :345-365, **no divider**. Other renderers: `components/desktop/sidebar.tsx`,
  `components/header-menu.tsx`, `(dashboard)/more/page.tsx`, hub `stock-management/page.tsx`.
- Catalog today (`prisma/rbac-catalog.ts`): see requirements doc §5.7 and the table in the
  planning notes — `stock_management` 100 (route, `view`); children stock 101, categories 103,
  stock_audit 104, inbound 105, deliveries 106, transfers 107, bins 108, brands 108;
  roots second_hand 150, barcode 160, pos 170, assembly 180, complaints 185; customers 320
  (Accounts); settings 520 with route-less children 521-525; store_management 540 (no route) →
  stores 541, warehouses 542 (no route).
- `/stores` 499 lines, no tabs; `/bins` 2230 lines, tabs directory | unmatched; no `/warehouses`.
- `/stock` 1145 lines; quick chips :68 rendered :521-532; filters are state → `/api/products`
  (:287-310).
- Dashboard `(dashboard)/page.tsx`: six variants, `pickDashboard` :956; endpoints per variant
  :245-251, :495-499, :637-638, :752, :867-869, :910-912.

### 2.4 Database target — read before any schema command

`.env` **line 9 is active and points at the Supabase pooler** (the cloud test database); localhost
`bch_local` is commented at line 13. Migrations rule 2 and 5 (CLAUDE.md) and the owner's 9 Sep rule
apply: `migrate` runs **only** against localhost. Export `DATABASE_URL` / `DIRECT_URL` to
`bch_local` in the shell for the migration step; never edit `.env`; never `db push`.

---

## 3. Implementation plan

### 3.0 Shape of the build

Six parts, built in **four waves**. A wave's agents run in parallel on **disjoint files**; each
wave is checked (`npx tsc --noEmit`, `npx eslint` on touched files) and committed before the next
starts.

```
Wave 0  S  schema + migration + catalog + shared libs (one agent, serial)
        └─ schema-reviewer agent reads the migration before Wave 1
Wave 1  B  unit lifecycle            E  assembly screen          F  sidebar, stock, stores
Wave 2  C  outward guard, ★, outbound approval      D  approvals: transfer, inbound, audit, events
Wave 3  G  dashboard      Q  notification action buttons + quick approve
```

Why this order: B's unit helpers are needed by C (★ reservation) and D (short receive, reversal);
C and D both need S's `ApprovalEvent` writer and notify events; G reads what B–D write.

### 3.1 Wave 0 — Part S: schema, migration, catalog, shared libs

**One migration** `prisma/migrations/<ts>_priority_build_stock_flow/`, all additive (rule 7):

| Model | Change | For |
|---|---|---|
| `enum HoldIssue` | new: `CYCLE`, `WORKFLOOR` | R3, R6 |
| `AssemblyTask` | `holdIssue HoldIssue?`, `holdNote String?`. `holdReason` stays (no longer written) | R6, Q3 |
| `enum UnitStatus` | add `RESET` | P3 |
| `InventoryUnit` | `reservedForDeliveryId String?` → `Delivery` `onDelete: SetNull`, `@@index`; `reservedAt DateTime?` (`soldAt`, `saleInvoiceNo` already exist, S:786-787) | R16, R21 |
| `Delivery` | `priorityAt DateTime?`, `priorityById String?` (→ User, SetNull); `approvalRequestedAt`, `approvalRequestedById`, `approvedAt`, `approvedById`, `approvalReturnedAt DateTime?`, `approvalNote String?` | R19–R21, R26a |
| `enum TransferOrderStatus` | add `RETURNED` (`REJECTED` stays for old rows) | R25 |
| `TransferOrder` | `resubmittedAt DateTime?` | R25 |
| `InboundShipment` | `rejectedAt`, `rejectedById` (→ User), `rejectionNote String?`, `resubmittedAt DateTime?` | R25, Q17 |
| `StockCountItem` | `assembledQty Int?`, `unassembledQty Int?` | Q42 |
| `enum ApprovalActivity` | new: `INBOUND`, `OUTBOUND`, `TRANSFER`, `STOCK_AUDIT` | R26 |
| `enum ApprovalEventType` | new: `REQUESTED`, `APPROVED`, `REJECTED`, `RESUBMITTED`, `REVERSED`, `CORRECTED`, `SHORT_RECEIVED`, `FLAGGED` | R26 |
| `ApprovalEvent` (new) | `id`, `activity`, `event`, `recordId`, `recordRef?`, `actorId` (→ User), `approverId?` (the approval this outcome judges), `productId?`, `warehouseId?`, `quantity Int?`, `note?`, `createdAt`; indexes `(activity, recordId)`, `(approverId, event, createdAt)`, `(productId, warehouseId, createdAt)` | R26 |
| `Module` | `dividerBefore Boolean @default(false)` | P5 |

Enum `ADD VALUE` statements go in the migration without using the new value in the same
migration. Generated with `migrate diff --script` into a hand-made folder (non-interactive here,
memory), applied to **`bch_local` only** (§2.4), SQL read before commit (rule 3).

**Catalog** `prisma/rbac-catalog.ts` (data; `npm run db:seed:rbac` locally, owner re-seeds elsewhere):

| Key | Change |
|---|---|
| `delivery_priority` | **new**: label "Delivery Priority (★)", `route: null`, group Operations, `actions: ["edit"]` (R19) |
| `assembly` | sortOrder **90** (above Stock management, R27) |
| `stock_management` | `route: null` (expand only, R28) |
| `stock` | label "Stock & inventory", sortOrder 101 |
| `inbound` / `deliveries` / `transfers` / `stock_audit` | labels "1 Inbound", "2 Outbound (delivery & dispatch)", "3 Stock transfer", "4 Stock audit"; sortOrder 110/111/112/113; `inbound.dividerBefore = true` |
| `categories`, `brands` | `route: null` (leave menu, R33) — keys and grants kept |
| `bins` | parent removed → root, `route: null`, group Admin (grant-only, R32) |
| `barcode` | `route: null` (tab, R29) |
| `pos` | group **Accounts**, sortOrder 315 (R30) |
| `customers`, `complaints`, `second_hand` | group **Sales**, sortOrder 250 / 255 / 260 (R31) |
| `store_management` | parentKey **`settings`**, route **`/stores`**, sortOrder 526 (R32) |
| `stores`, `warehouses` | parent removed → roots, `route: null`, group Admin (grant-only) |

No key is renamed or removed — a renamed key deletes its grants (requirements doc §5.7).

**Shared libs** (created here so the waves never edit the same file):

- `src/lib/notify/events.ts` — register `stock.transfer_needed`, `approval.requested`,
  `approval.returned`.
- `src/lib/approvals/events.ts` — `recordApprovalEvent(tx, {...})`, typed on the enums above.
- `src/lib/settings/approval-rules.ts` — reader/writer for AppSetting `approver_error_rule`
  `{countCorrection:true, countShortReceive:true, countReversal:true, countFlag:false, windowDays:7}`.
- `src/lib/settings/stuck-hours.ts` — AppSetting `dashboard_stuck_hours`
  `{approvals:24, inbound:72, holds:24}`.
  Both copy `src/lib/settings/bin-tracking.ts`.

### 3.2 Wave 1 — Part B: unit lifecycle (R7, R11, P1–P4)

**New** `src/lib/units/` — every function takes `tx`, logs with `createLogger("units:*")`:

- `pickUnits(tx, {productId, warehouseId, qty, reservedForDeliveryId?})` — available statuses
  `RECEIVED`, `PUT_AWAY`, `ASSEMBLED`; order: reserved for this delivery first → `assembledAt`
  not null first → `createdAt` asc; excludes units reserved for **another** delivery and units in
  an open task (`ASSIGNED`/`IN_ASSEMBLY`) unless nothing else is left. Throws if fewer than `qty`.
- `moveUnits(tx, unitIds, destWarehouseId)` — sets `warehouseId`, `binId: null`, status
  `ASSEMBLED` if `assembledAt` else `RECEIVED` (fixes defect 6).
- `sellUnits(tx, unitIds, {invoiceNo})` — `SOLD`, `soldAt`, `saleInvoiceNo`, clears reservation.
- `retireUnits(tx, unitIds, status: "LOST" | "RESET")` — clears bin + reservation; `RESET` also
  sets open assembly tasks to `CANCELLED`.
- `createUnits(tx, {productId, warehouseId, qty, assembled, inboundShipmentId?})` — `nextUnitCode`.
- `syncWarehouseUnits(tx, {productId, warehouseId, assembled, unassembled})` — creates or retires
  (`LOST`) so the location holds exactly those counts; retires unassembled first for the
  unassembled side and vice versa.

**Wiring** (each inside the route's existing transaction):

| File | Change |
|---|---|
| `api/inbound/[id]/route.ts` receive | P1: bin mode also `adjustWarehouseQty` into the bin's warehouse |
| `api/inbound/[id]/route.ts` DELETE | P2: `retireUnits(shipment's unsold units, "LOST")` |
| `api/inventory/inwards/verify/route.ts` | P4: `createUnits` unassembled for the added qty |
| `api/inventory/outwards/route.ts` | `sellUnits(pickUnits(...))` per warehouse `deductFromStore` drew from (extend it to return its per-warehouse breakdown) |
| `api/transfer-orders/[id]/dispatch/route.ts` | when `unitIds` absent, `pickUnits` per item from the source; write `TransferOrderUnit` rows as today |
| `api/transfer-orders/[id]/receive/route.ts` | per item move only `receivedQty` units; the rest `retireUnits("LOST")` |
| `api/deliveries/[id]/route.ts` DELIVERED / WALK_OUT, `api/deliveries/batch/route.ts` DELIVERED | after `deductDeliveryFromFloor`, per `DeductedLine` `sellUnits(pickUnits(floor, reservedForDeliveryId: delivery.id))` |
| `api/stock-counts/[id]/route.ts` apply | line with `assembledQty`/`unassembledQty` → `syncWarehouseUnits`; line without the split → delta: surplus `createUnits` unassembled, shortage `retireUnits("LOST")` via `pickUnits` reversed (unassembled first) |
| `api/stock-counts/[id]/items/route.ts` + `stock-audit/[id]/page.tsx` counting inputs | two inputs per line, **Assembled** and **Unassembled**; `countedQty` = their sum (Q42) |
| `api/stock-counts/[id]/zero-uncounted/route.ts` | also sets both split fields to 0 |
| **new** `api/stock-reset/warehouse/route.ts` (`stock_audit.approve`, confirm string) | Q43: one warehouse — zero its `StockLevel` (qty + reserved) and `BinStock`, `retireUnits(all non-SOLD units there, "RESET")`, recompute product totals, one ADJUSTMENT ledger row per product, `logActivity` |
| **new** reset button on `stock-audit` (list page, approvers only) | pick store → warehouse → type the confirm string; then offer "Start unit-level audit for this warehouse" |

The old `api/stock-reset` (bin-prefix, no UI) is left untouched and not linked.

### 3.3 Wave 1 — Part E: assembly screen (R1–R6, R8, R9, R20, R29, Q5, Q6)

Split `src/app/(dashboard)/assembly/page.tsx` into `_components/` first (no behaviour change),
then build on the pieces:

| File | Change |
|---|---|
| `assembly/page.tsx` | `Suspense` wrapper + `useSearchParams` + `router.replace(?tab=, {scroll:false})`, copied from `purchase-orders/page.tsx:76-105`; tabs `awaiting`/`tasks` (`assembly.approve`), `mine` (`assembly.edit`), `labels` (`barcode.view`); unknown or forbidden tab → today's landing rule (R2) |
| `_components/hold-sheet.tsx` (new) | two large boxes, one tap → POST, sheet closes; no confirm, no text |
| `api/assembly/tasks/[id]/hold/route.ts` | zod body `{action:"HOLD", issue: "CYCLE"\|"WORKFLOOR"}` / `{action:"RESUME"}`; writes `holdIssue`; `logActivity` on hold and resume |
| `api/assembly/tasks/[id]/start`, `complete` | `logActivity` (defect 5) |
| **new** `api/assembly/tasks/[id]/hold-note/route.ts` | PUT `{note}`, `assembly.approve` |
| `_components/my-queue-tab.tsx` | timer shows `(holdStartedAt − startedAt) − totalHoldSeconds` when `ON_HOLD` (defect 1); ★ badge + delivery day; ★ first (Q20 order) |
| `_components/tasks-tab.tsx` | held builds list: unit · product · issue · mechanic · on hold since · note (edit); **Raise vendor issue** on `CYCLE` holds → `/vendor-issues/new?description=…&vendorId=…` (description "U-000481 · Hero Sprint 29 · Issue with the cycle"; vendor from the unit's inbound shipment where resolvable, else blank) |
| vendor issue create page | accept those query params as initial values (no schema change) |
| `api/assembly/tasks/route.ts` GET | filters `productId`, `brandId`, `warehouseId`, `binId`, `q`; sort `delivery`/`received`/`model`; ★ units (`reservedForDeliveryId` set) first by delivery day then `priorityAt`; page size 100 **plus** `pendingIds` mode that returns every matching id (R8) |
| `api/assembly/tasks/route.ts` POST | accept `unitIds[]` (≤ 500) in one transaction, same checks per unit as today |
| `_components/awaiting-tab.tsx` | filter bar, sort select, row checkboxes, "Select all N matching", bulk Assign; ★ rows show delivery day and a **Swap** action (calls Part C's swap route; hidden until Wave 2 lands) |
| **new** `src/components/scanner/scanner-panel.tsx` | body of `scanner/page.tsx` extracted; `/scanner` renders it; `_components/labels-tab.tsx` renders it |

### 3.4 Wave 1 — Part F: sidebar, stock & inventory, store management (R10, R11, R27–R33)

| File | Change |
|---|---|
| `src/stores/permissions.ts` + module API | carry `dividerBefore` |
| `src/components/app-sidebar.tsx` | parent with `route: null` renders as a button that only toggles (R28); `dividerBefore` renders a divider above that child |
| `components/desktop/sidebar.tsx`, `components/header-menu.tsx`, `(dashboard)/more/page.tsx` | same two behaviours so every renderer agrees |
| `(dashboard)/stock/page.tsx` | chips row **Categories · Brands** linking to `/categories`, `/more/brands` (shown by `categories.view` / `brands.view`); **Assembled / Unassembled** columns (R10); link "Assembled vs unassembled" |
| `api/products` GET | per product `assembledUnits`, `unassembledUnits` (one grouped query over non-SOLD/LOST/RESET/TRANSFERRED units) |
| **new** `(dashboard)/stock/condition/page.tsx` + `api/stock/condition/route.ts` (`stock.view`) | model · location · assembled · unassembled · total; filters store, warehouse, brand; unassembled number links to `/assembly?tab=awaiting&productId=&warehouseId=`, assembled to `/stock?…` (R11) |
| `categories/page.tsx:293` | back link → `/stock` (Q27) |
| `(dashboard)/stores/page.tsx` | tabs **Stores · Warehouses · Bins** with `?tab=` (Suspense pattern); Stores = today's screen; Warehouses = today's nested warehouse list lifted to its own tab; Bins = today's `/bins` directory extracted into a component; each tab gated by `stores.view` / `warehouses.view` / `bins.view` |
| `(dashboard)/bins/page.tsx` | renders the extracted component (URL kept) |
| `settings/page.tsx` | "Bins & Locations" card → `/stores?tab=bins` |

### 3.5 Wave 2 — Part C: outward guard, ★ priority, outbound approval (R12–R17, R19–R21, R26a, Q11, Q37)

| File | Change |
|---|---|
| `src/lib/deliveries/floor-stock.ts` | `stockElsewhere(tx, productId, storeId, floorWarehouseId)` → GODOWN quantities; `ShortLine` gains `elsewhere[]`; the handover refusal names it: "Hero Sprint 29: 0 on BCH Floor · 2 in BCH Godown. A transfer is needed." |
| **new** `src/lib/deliveries/transfer-needed.ts` | `notifyTransferNeeded(delivery, shortLines, actorId?)` → `notify("stock.transfer_needed", usersWithPermission("transfers","create") − actor)`; called **after commit** or after a refused transaction rolled back |
| `api/deliveries/[id]/route.ts` | short hold at SCHEDULED/PACKED → notify; **new check at `OUT_FOR_DELIVERY`**: held, or floor usable ≥ lines, else refuse + notify; WALK_OUT/DELIVERED refusal → notify; `OUT_FOR_DELIVERY`/`SHIPPED` require `approvedAt` and no later `approvalReturnedAt`; Dummy skipped (R26a) |
| `api/deliveries/batch/route.ts` | same `OUT_FOR_DELIVERY` stock check and approval check per id; refusal lists each failing invoice |
| `api/public/delivery/[token]/route.ts` | short hold → notify (no actor) |
| **new** `api/deliveries/[id]/priority/route.ts` | POST `{starred}` — `delivery_priority.edit`; not Dummy; star: per short line `pickUnits` in the store's GODOWN warehouses (`kind = GODOWN`, same `storeId`), set `reservedForDeliveryId`, `reservedAt`; `priorityAt/ById`; unstar: clear both, release units; `logActivity` both ways (R21) |
| **new** `api/deliveries/[id]/priority/swap/route.ts` | POST `{fromUnitId, toUnitId}` — `assembly.approve`; same product, same warehouse, target unreserved and available |
| **new** `src/lib/approvals/actions/delivery.ts` + `api/deliveries/[id]/approval/route.ts` | `request` (`deliveries.edit`), `approve` / `reject {note}` (`deliveries.approve`); writes the fields + `recordApprovalEvent`; notify `approval.requested` / `approval.returned` after commit |
| `api/deliveries/[id]/flag/route.ts` | `recordApprovalEvent(FLAGGED, approverId: delivery.approvedById)` |
| delivery release on DELETE (`[id]/route.ts:456-464`) | also clear units reserved for it |
| `deliveries/[id]/_components/detail-actions.tsx`, `delivery-card.tsx`, `delivery-table.tsx` | ★ toggle (grant-gated); "Request approval" / "Approve" / "Reject" / returned banner; dispatch buttons disabled until approved; short warning shows godown quantities |
| walk-out page `deliveries/[id]/walkout/page.tsx` | shows the new refusal text |

### 3.6 Wave 2 — Part D: approvals, returned records, error rule (R22–R26)

| File | Change |
|---|---|
| `src/lib/transfers/transitions.ts` | `PENDING → RETURNED`; `RETURNED → PENDING` (resubmit) / `CANCELLED` |
| `api/transfer-orders/[id]/approve/route.ts` | reject writes `RETURNED` (not `REJECTED`) with the note; approve/reject `recordApprovalEvent`; notify `approval.returned` to the creator |
| `api/transfer-orders/route.ts` POST | `recordApprovalEvent(REQUESTED)`; if auto-approved also `APPROVED`; else notify `approval.requested` to `transfers.approve` holders − creator |
| **new** `api/transfer-orders/[id]/route.ts` PATCH | `RETURNED` only, creator or `transfers.create`: replace items (same validation and stock check as create) |
| **new** `api/transfer-orders/[id]/resubmit/route.ts` | `RETURNED → PENDING`, `resubmittedAt`, event + notify |
| `api/transfer-orders/[id]/cancel/route.ts` | cancelling an `APPROVED` order → `REVERSED` event |
| `api/transfer-orders/[id]/receive/route.ts` | received < dispatched → `SHORT_RECEIVED` event (approverId = `reviewedById`) — **edits after Part B's change in the same file** |
| `transfers/[id]/page.tsx`, `transfers/page.tsx`, `src/lib/transfers/actions.ts` | reject opens a note box and sends `rejectionNote`; returned banner; edit items + resubmit for the creator |
| **new** `api/inbound/[id]/reject/route.ts` | `inbound.approve`; not approved, not delivered; `rejectedAt/ById/Note`; event; notify creator |
| **new** `api/inbound/[id]/resubmit/route.ts` | `inbound.edit`; clears `rejectedAt`, sets `resubmittedAt`; event; notify `inbound.approve` holders |
| `api/inbound/[id]/approve/route.ts` | refuse while returned; event `APPROVED` |
| inbound create route | event `REQUESTED` + notify approvers |
| `api/inbound/[id]/route.ts` DELETE of an approved shipment | event `REVERSED` |
| `inbound/[id]/page.tsx` | Reject button + note; returned banner; Resubmit |
| `api/stock-counts/[id]/route.ts` | remove the self-block :172-175 (R23); approve/reject events; apply → one `CORRECTED` event per changed line with `productId`, `warehouseId`, `quantity` = delta |
| `stock-audit/[id]/page.tsx:450` | drop `!isAssignee` |
| **new** `api/approvals/error-rate/route.ts` (`reports.view`) | per approver: approvals, errors by type, rate — applying `approval-rules` over stored events (corrections matched to the latest `APPROVED` inbound/transfer event for the same product + warehouse within `windowDays`) |
| **new** `settings/approvals/page.tsx` (+ Settings index card) | edit the rule (`settings.edit`) and show the error-rate table |

### 3.7 Wave 3 — Part G: dashboard (R35–R37, Q29, Q30)

| File | Change |
|---|---|
| **new** `api/dashboard/overview/route.ts` (`requireAuth`) | builds only the sections the caller's grants allow, each checked with `userCan` server-side: **Money** (`accounts.view`: payables, receivables, overdue — reuse `accounts/summary` logic; stock value — `stock.view`); **Stuck** (approvals waiting > `approvals` h per activity the user can approve; inbound pending > `inbound` h (`inbound.view`); holds > `holds` h (`assembly.approve`); short outwards (`deliveries.view`)); **In progress** (★ builds, builds in progress, transfers `IN_TRANSIT`, audits `IN_PROGRESS`); **Done today** (delivered, builds completed, transfers received, inbound received); **Stock by condition** (`stock.view`: unassembled, assembled, oldest unassembled days) |
| `(dashboard)/page.tsx` | one layout rendering the returned sections; the six variants and `pickDashboard` removed; `MyStockAudits` / `MyAssemblyTasks` stay above |
| `settings/approvals/page.tsx` | add the stuck-hours editor (`settings.edit`) |

### 3.8 Wave 3 — Part Q: notification action buttons (R24, Q19)

| File | Change |
|---|---|
| `src/lib/notify/types.ts`, `push.ts` `buildMessage` | optional `actions[{action,title}]` → `webpush.notification.actions` and `data.actions` |
| `public/sw.js` | pass `actions` to `showNotification`; on click `event.action === "approve"` → `fetch POST /api/approvals/quick` (same-origin cookie) then show a result notification; `"reject"`/`"open"`/body → open `data.link` |
| **new** `api/approvals/quick/route.ts` | `{activity, recordId, action:"approve"}` → dispatches to the inbound / transfer / delivery approve functions (each re-checks its `approve` grant); stock audit is **Open only** (its approval needs the apply choice) |
| approval notifications from C and D | pass `actions: approve, reject, open` |

### 3.9 Phases, agents and file ownership

| Wave | Agent | Owns | Depends on |
|---|---|---|---|
| 0 | S | `prisma/schema.prisma`, the migration, `prisma/rbac-catalog.ts`, `src/lib/notify/events.ts`, `src/lib/approvals/events.ts`, `src/lib/settings/{approval-rules,stuck-hours}.ts` | — |
| 0 | schema-reviewer | read-only review of the migration | S |
| 1 | B | `src/lib/units/*`, `src/lib/stock-location.ts`, inbound route, inventory inwards/outwards, transfer dispatch/receive, deliveries `[id]` + batch (sale only), stock-counts apply/items/zero-uncounted, stock-audit counting page, stock-reset/warehouse + its UI | S |
| 1 | E | `src/app/(dashboard)/assembly/**`, `src/app/api/assembly/**`, `scanner/page.tsx`, `src/components/scanner/*`, vendor-issue create page | S |
| 1 | F | sidebar renderers, `src/stores/permissions.ts`, module API, `stock/**` pages, `api/products`, `api/stock/condition`, `stores/page.tsx`, `bins/page.tsx`, `categories/page.tsx`, `settings/page.tsx` | S |
| 2 | C | `src/lib/deliveries/*`, `api/deliveries/**`, `api/public/delivery/**`, `deliveries/**` screens, `src/lib/approvals/actions/delivery.ts` | B |
| 2 | D | `src/lib/transfers/*`, `api/transfer-orders/**`, `transfers/**`, `api/inbound/[id]/{approve,reject,resubmit}`, inbound create + DELETE event, `inbound/[id]/page.tsx`, `api/stock-counts/[id]/route.ts` (after B), `stock-audit/[id]/page.tsx:450`, `api/approvals/error-rate`, `settings/approvals/**`, `src/lib/approvals/actions/{inbound,transfer}.ts` | B |
| 3 | G | `(dashboard)/page.tsx`, `api/dashboard/overview`, stuck-hours editor | C, D |
| 3 | Q | `src/lib/notify/{types,push}.ts`, `public/sw.js`, `api/approvals/quick` | C, D |

Every agent reads its board-of-agents docs before writing (below), follows CLAUDE.md logging
rules, and reports files changed + checks run. After each wave: `npx tsc --noEmit`, eslint on the
wave's files, then one commit on the branch.

### 3.10 RBAC

- New grant: `delivery_priority.edit` (catalog, R19). Everything else reuses existing grants —
  see requirements doc §6. No role or person name in code; every new route calls `requireFeature`
  (or `userCan` per section for the dashboard); buttons are cosmetic only.
- The public routes (`/fill/[token]`, `api/public/*`) get the notification call but **no**
  permission check.

### 3.11 Logging

Every new route and lib: `createLogger` scope per module (`units:pick`, `deliveries:priority`,
`approvals:transfer`, `dashboard:overview`, …). `log.info` on each business event (units sold /
moved / retired with counts and ids; star set/cleared with deliveryId; approval
requested/approved/returned with activity + recordId); `log.warn` on refusals (short floor,
unapproved dispatch) and swallowed notification failures; `log.error` before every rethrow. No
payload dumps, no tokens.

### 3.12 Board of agents — to check during the build

| Agent doc | Why it applies |
|---|---|
| `docs/agents/inventory-consultant.md` | unit ↔ stock sync, reset, audit split |
| `docs/agents/warehouse-consultant.md` | godown → floor transfer, dispatch, bins tab |
| `docs/agents/database-architect.md` | the migration, indexes, `ApprovalEvent` |
| `docs/agents/backend-engineer.md` | new routes, zod, status transitions |
| `docs/agents/frontend-engineer.md` | assembly split, one-tap hold, sidebar, dashboard |
| `docs/agents/integration-architect.md` | FCM actions, service worker |

---

## 4. Verification

Owner runs `npm run build` (21–45 min, memory) after Wave 3; Claude runs `npx tsc --noEmit` and
eslint per wave. Local database `bch_local` only.

1. **Units in sync (§4.8 of the requirements doc):** receive 10 → transfer 6 godown→floor (units
   move, 3 assembled + 3 oldest) → deliver 5 (5 SOLD) → audit godown with 1 missing (1 LOST).
   `/stock/condition` and Awaiting show 3 + 1; `/stock` counts match.
2. **Reset + unit audit:** reset BCH Godown → its units `RESET`, counts 0; audit with assembled 4 /
   unassembled 8 → approve → 12 units, 4 assembled.
3. **Outward guard:** schedule an outward with floor 0 / godown 2 → accepted, warning names the
   godown, a `transfers.create` holder gets a push; Out for delivery → refused with the same text;
   walk-out → refused + push.
4. **★:** star it → 2 godown units reserved, unassembled ones top of Awaiting with the day; swap
   one; unstar → released; a build in progress continues.
5. **Outbound approval:** Out for delivery disabled until approved; reject → returned banner →
   request again → approve → dispatch works; walk-out needs none; batch refuses unapproved ids.
6. **Transfers / inbound:** reject with note → RETURNED → edit → resubmit → approve; inbound reject →
   resubmit → approve → receive; creator holding approve approves own; audit assignee approves own.
7. **Error rate:** approve an inbound, correct that product in an audit within 7 days → one error
   for that approver; change `windowDays` to 1 → recalculated.
8. **Assembly:** each `?tab=` loads and survives refresh; mechanic on `?tab=awaiting` lands on
   `mine`; hold = one tap; reload keeps the frozen time; supervisor note; Raise vendor issue
   pre-filled; select all N matching → bulk assign; filters and sorts; Labels tab = scanner.
9. **Sidebar:** Operations = Build line assembly, Stock management (expand only: Stock & inventory,
   divider, 1–4); Sales; POS in Accounts; Admin › Settings › Store management with three tabs;
   no Categories/Brands/Barcode/Bins items; chips on `/stock`. After `npm run db:seed:rbac`.
10. **Dashboard:** admin sees every row; a mechanic role sees only build cards; change stuck hours
    → Stuck counts change.
11. **Push actions:** Android Chrome / desktop — Approve on the notification approves; iPhone opens.

---

## 5. Out of scope, deliberately

- Reassigning or cancelling a build (Q39).
- A delivery time (Q32/Q40) and any change to the slot calendar.
- An assembled-only outward check (Q10).
- `api/inventory/cleanup` sync (P4) and `stock-counts/[id]` DELETE writing `currentStock` without
  `StockLevel` (§2.1) — known gaps, raise separately.
- The old bin-prefix `api/stock-reset`.
- Mechanic picker listing every active user (requirements doc defect 11).
- Everything in the requirements doc §8.
