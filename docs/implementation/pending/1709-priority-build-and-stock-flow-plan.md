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

17 Sep 2026, later — **additional requirements** (while answering P2):

> and i have this question that while outword the stock must be reduced in store level that is floore level and i have a queation will it track  the bin level too where  the requiremnet is we will create the bin and  i need a script or a function to perform this thing where as i set the rule and regulation in  home bine where choosing the brand and category 's and bin  at that time let me have button at that time only when i set it not only for the inbounding items it should also set the bin for the existing system  and for the existing items that are present the uniqie code that is getting generated must generate for all the bined  items   tell me this how can i make it  like for not only the items whcih are  getting inbounded shoudl get the unique code like u-0001 for the existing items also the unique code must be generated for thes that are in the bin so we can  mke it like have a button  to all those bin product we  teh unique code has to generate  and i have an another thing that every inbound itewm wont  be assemblable item  there are items which are non assemblable and those items  should not bee seen in the  unassembleing listing where this is the need tell me ur aproch and what i think is at the bin level only we can have set like status like non assembleable where we store the items and those items not not be listed in the unassembled because those are   not assamblabe items where we do need the asembling of it and we can filter listing in /stock  and also /assembley  a saparate tab on click thie tab   and another change in this  application  resepecetd to category is that i need parent and child category the child category need to have parent as zoho and same in the ui of /catgorys and also need to so in the /stock fillter thing need to see teh  child catehgory if the parent has any of them  and also tell me about this like  in the outword details on saving the conact  not only on saving  the phone number in application  i need it to save dirctly on the phone for that what  can be done how can we achive it   and in the /bin where we set the rule i think wee need the category and subcategory if it has as optional and brand and bin in the  rules setting  i need to be able to set it like this  this are my requiremnt and what are ur doubts aoung this requiremnt regarding this update the & 'f:\bharath  Cycle\BCH-Management\docs\implementation\pending\1709-priority-build-and-stock-flow-plan.md' implmentation plan

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
| R8 | The build line lists **all** unassembled units; no page limit may hide a unit from selection. ~~Every inbound item needs assembling — no category filter.~~ **Superseded by R42** (17 Sep, later): units in a non-assemblable bin are left out. | Q34, Q44, R42 | E |
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

**Added 17 Sep 2026 (later)** — the owner's additional requirements above:

| # | Requirement | Part |
|---|---|---|
| R38 | An outward reduces stock at **floor** level **and at bin level**: the bins the sold cycles sat in go down too. | H |
| R39 | A **home-bin rule** is set as **brand · category · subcategory (optional) · bin**, per warehouse. | H |
| R40 | When a rule is saved, a button **applies it to existing stock** — not only to future inbound items. | H |
| R41 | A button **generates unit codes (`U-000001`…) for existing items that are in bins**, not only for inbound items. | H |
| R42 | **Not every item needs assembly.** A **bin** can be marked **non-assemblable**; items stored there never appear in the unassembled listing. `/stock` can filter them, and `/assembly` has a **separate tab** listing them. *(Supersedes Q44 "every inbound item needs assembling".)* | H |
| R43 | Categories have **parent and child**, the child's parent **as in Zoho**. `/categories` shows the tree; the `/stock` category filter shows a parent's children. | I |
| R44 | **Save contact** on an outward also **saves the contact to the phone**. | C |

---

## 1. Questions and clarifications — raised by the code while planning

All 41 requirement questions are answered in the requirements doc. P1–P5 came up while
mapping the code for §3; P6–P14 came with the additional requirements R38–R44. Each changes the
build; each has a recommended default. Asked one at a time, in order.

| # | Question | Why it changes the build | Options | Recommended default | **Answer** |
|---|---|---|---|---|---|
| **P1** | **Inbound receive in bin mode writes no `StockLevel`.** It updates `Product.currentStock` and `BinStock` only (`api/inbound/[id]/route.ts:265-284`), while no-bin mode calls `adjustWarehouseQty` (:286-301). Units are created either way (:312-324). Fix it here? | R7 needs per-warehouse quantity and units to agree. In bin mode the warehouse count stays 0 while units exist there, so the outward guard (per floor `StockLevel`) and the condition page disagree from the first receive. | (a) bin mode also writes `StockLevel` into the bin's warehouse; (b) leave it | (a) — it is the same root cause R7 exists to fix | **(a)** 17 Sep |
| **P2** | **Deleting an inbound shipment leaves its units** (`api/inbound/[id]/route.ts:511-528` reverses stock with `deductAnywhere`, units untouched). | Orphan units stay "unassembled" on Awaiting for stock that no longer exists. | (a) the shipment's unsold units are retired with it; (b) leave | (a) | |
| **P3** | **What "clear the unit records" means on reset (Q43).** A unit may already have assembly tasks, bin movements and transfer rows pointing at it. | Hard-deleting rows breaks that history (or cascades it away). | (a) mark them with a new status **`RESET`** (cleared by a stock reset) and close their open assembly tasks as `CANCELLED`; (b) delete the rows | (a) — history stays readable, and "reset" is distinguishable from "lost" in the error metrics | |
| **P4** | **Two older stock paths.** `api/inventory/inwards/verify` adds quantity with no units (:50-52); `api/inventory/cleanup` reverses inwards/outwards **outside a transaction** (:37-39). | Either one breaks R7's sync if it is still used. | (a) inwards/verify creates unassembled units; cleanup is left alone and listed as a known gap; (b) both kept in sync; (c) leave both | (a) — cleanup is a maintenance route with no transaction; fixing it properly is its own piece of work | |
| **P5** | **The divider inside Stock management (Q23).** The sidebar has no divider support (`app-sidebar.tsx:345-365`), and the menu is data. | A divider needs a signal that is data, not a hardcoded module key. | (a) new column `Module.dividerBefore Boolean @default(false)`, set by the catalog on `inbound`; (b) no divider, only ordering | (a) — one additive column, no module key in code | |

#### Questions on the additional requirements (R38–R44)

Facts behind them are in §2.5.

| # | Question | Why it changes the build | Options | Recommended default | **Answer** |
|---|---|---|---|---|---|
| **P6** | **Non-assemblable at bin level (R42): what decides it for a unit?** A unit's assemblability would follow the bin it sits in *now*. | A cycle moved from a non-assemblable bin into a normal one would start showing on Awaiting, and a unit with **no bin** (bin tracking off, or not yet put away) has no flag at all. | (a) **bin flag only**, as the owner proposed: `Bin.nonAssemblable`; a unit counts as non-assemblable while its bin has the flag; no bin = assemblable; (b) bin flag **plus** a category flag, so spares are also caught before put-away; (c) a flag on the **unit**, set when it is put away into a flagged bin and kept after moves | (a) — exactly the owner's model, one column, and put-away already puts inbound items in their home bin | |
| **P7** | **Non-assemblable units elsewhere.** On the assembled vs unassembled page (R11), in the outward ★ picking (R16) and in the dashboard's condition row. | Otherwise non-assemblable stock is counted as "unassembled" everywhere except the build line. | (a) a third column **"No assembly"** on the condition page and dashboard; ★ picks them like assembled units (they need only the transfer); (b) hide them from those screens | (a) | |
| **P8** | **Generate unit codes for existing binned items (R41): how many, and in what condition?** Existing stock is a **quantity**: `BinStock` per bin (only where put-away/bins set it), `Product.binId` (a single home bin), and `StockLevel` per warehouse. Nothing records per-bin quantity for older stock. | Decides the source of the count and whether the build line floods: most **floor** stock is already built, so marking it all unassembled would put every floor cycle on Awaiting. | Count: (a) per warehouse, `StockLevel` − live units, placed in the product's bin from `BinStock` (then `Product.binId`); (b) `BinStock` rows only. Condition: (i) the person chooses per run; (ii) **FLOOR → assembled, GODOWN → unassembled**, non-assemblable bin → no assembly; (iii) all unassembled | (a) + (ii) — every counted item gets a code, and the default matches how stores hold stock; the person can still pick (i) before running | |
| **P9** | **Does R41 replace the reset + unit-level audit (Q13, Q43)?** Generating codes gives existing stock units without a reset. | Two ways to create units for old stock; the reset clears counts and units. | (a) keep **both**: generate codes first (fast, no stock change), then a unit-level audit per warehouse corrects counts and condition, with reset only when a warehouse's numbers are unusable; (b) generate replaces reset + audit; (c) reset + audit only, no generate | (a) | |
| **P10** | **"Apply rule to existing stock" (R40): what moves?** | Existing items may be in **no** bin or in **another** bin already. | (a) matching items with **no bin** move to the rule's bin; items already in another bin are listed and moved only if the person ticks "also move these N"; (b) move everything that matches; (c) only set `Product.binId` (the home bin) without moving any unit | (a) — nothing that was deliberately placed moves silently; every move writes a `BinMovementLog` | |
| **P11** | **Bin-level stock source of truth (R38).** Today `BinStock` and unit `binId` are updated separately and already disagree (unit moves and transfers change `binId` only). | The outward must reduce "the bin" — by which record? | (a) **units are the truth**: once an item has units, `BinStock` is recomputed from the count of live units per bin after every unit change (sale, move, transfer, audit); items without units keep today's `BinStock`; (b) keep both and decrement `BinStock` alongside | (a) — one record cannot disagree with itself | |
| **P12** | **Category parent from Zoho (R43).** The Zoho import is **deliberately flat** today — an earlier owner decision (D4) — and nothing pushes categories to Zoho. | Reverses D4; decides whether local edits go to Zoho. | (a) the import **sets `parentId` from Zoho's `parent_category_id`** (re-run fills existing rows); `/categories` gets a parent picker for local categories; **no push to Zoho**; (b) also push local changes to Zoho | (a) — Zoho stays the source; pushing is a separate integration | |
| **P13** | **Subcategory in rules and filters (R39, R43).** | A rule on a **parent** could match its children's products or only products filed directly under the parent. | (a) a rule on a parent **matches the whole subtree** unless a more specific subcategory rule exists; precedence product > brand+subcategory > brand+category > subcategory > category > brand; the `/stock` filter on a parent includes its children | (a) | |
| **P14** | **Saving the contact to the phone (R44).** The app is a web app (PWA). A browser **cannot write to the phone's contacts silently** — no web API allows it. | Decides what "save to phone" can mean. | (a) **Save contact** also downloads a **vCard** (`.vcf`); the phone opens "Add contact" pre-filled and the user taps Save once — works on Android and iPhone, reuses `api/vcard`; (b) **Google Contacts sync**: the app writes the contact into one shared business Google account (People API); every phone signed into that account gets it with no tap — needs a Google Cloud project, OAuth consent and a stored token; (c) a **native Android app** wrapper with contacts permission — silent save, a new app to build and ship | (a) now; (b) as a separate piece of work if one tap is too many | |

### 1.1 Decisions on record

| # | Decision | Date |
|---|---|---|
| — | Build on `feat/1709-priority-build-stock-flow`; requirements committed as `dcdb594`. | 17 Sep 2026 |
| — | Plan first, then **pause for approval**; the build then runs with parallel agents, one commit per wave. | 17 Sep 2026 |
| P1 | (a) — bin-mode inbound receive also writes `StockLevel` into the bin's warehouse. Owner: *"a"*. | 17 Sep 2026 |

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

### 2.5 Bins, categories and contacts (for R38–R44)

- **Category tree already exists in the schema**: `Category.parentId` + `children` (S:492-494),
  `zohoCategoryId @unique` (S:500). API `api/categories` GET returns `parent` and `children`
  (:26-34); POST/PATCH accept `parentId` (`validations.ts:123, 131-137`); PATCH rejects cycles
  (:58-73) and deactivation cascades to the subtree (:109-164).
- **Zoho import is deliberately flat**: `api/categories/zoho-import/route.ts:25-27` ignores
  `parent_category_id` (earlier decision D4); rows created `{name, zohoCategoryId}` (:153-154).
  The Zoho client already types `parent_category_id` (`src/lib/integrations/inventory.ts:27`,
  list :121-141). Only the offline `scripts/gen-catalog-sql.js:214-215` sets parents. **No push
  to Zoho exists.**
- **`/categories` UI is flat**: list filtered by status (`categories/page.tsx:282-285`), "N sub"
  badge (:405-409), "in {parent}" (:411-413); create sends `{name}` (:154), edit `{name}` (:134-135);
  **no parent picker**.
- **`/stock` category filter is flat** (`stock/page.tsx:547-561`); `api/products/route.ts:100`
  filters `categoryId` exactly — a parent does **not** include its children.
- **Home-bin rules** `api/bins/home-rules/route.ts`: GET `bins.view`, POST `bins.edit`
  `{warehouseId, brandId?, categoryId?, productId?, binId}` upsert by criteria (:40-109), DELETE
  (:111-125). Applied **only** as the put-away suggestion (`api/inbound/[id]/putaway/route.ts:49-113`,
  precedence product → brand+category → category → brand → `Product.binId`), exact category match.
  UI: modal in `bins/page.tsx:2070-2225` (brand, flat category, bin; no product). **No "apply to
  existing stock" anywhere.**
- **Where "in a bin" is recorded**: `BinStock` (written by receive-with-bin, put-away, `bins/assign`,
  `bins/move`, bin-scoped audit — never seeded for older stock); `Product.binId` (receive,
  `products/bulk` :116-129); unit `binId`. **They are not kept equal**: `bins/move` changes unit
  `binId` only (:65-71); transfer dispatch/receive null unit `binId` without `BinStock`.
- **Bin flags**: only `isAssemblyArea` (S:708) and `isActive`; no "non-assemblable".
- **Outward never touches bins**: `deductDeliveryFromFloor` updates `StockLevel` only
  (`floor-stock.ts:165-219`); `inventory/outwards` puts `binId` into notes text only (:102-103).
- **Save contact** `api/deliveries/[id]/customer/route.ts:42-120` writes the database only
  (`customer-info-card.tsx:6` says so). A vCard route exists with **no callers**
  (`api/vcard/route.ts:3-26`), and the service counter already downloads a vCard in the browser
  (`services/counter/page.tsx:51-80`). The app is a PWA (`public/manifest.json`); no Google user
  OAuth, no Contact Picker, no native wrapper.

---

## 3. Implementation plan

### 3.0 Shape of the build

Eight parts, built in **four waves**. A wave's agents run in parallel on **disjoint files**; each
wave is checked (`npx tsc --noEmit`, `npx eslint` on touched files) and committed before the next
starts.

```
Wave 0  S  schema + migration + catalog + shared libs (one agent, serial)
        └─ schema-reviewer agent reads the migration before Wave 1
Wave 1  B  unit lifecycle      E  assembly screen      F  sidebar, stock, stores      I  category tree
Wave 2  C  outward guard, ★, outbound approval, vCard      D  approvals      H  bins: rules, codes, non-assemblable
Wave 3  G  dashboard      Q  notification action buttons + quick approve
```

Why this order: B's unit helpers are needed by C (★ reservation), D (short receive, reversal) and
H (generate codes, apply rules, bin-level stock); I's subtree helper is used by H's rule matching;
C and D both need S's `ApprovalEvent` writer and notify events; G reads what B–D and H write.
**Parts H and I, and the R42 parts of B, E, F, assume the recommended defaults of P6–P14.**

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
| `Bin` | `nonAssemblable Boolean @default(false)` | R42, P6 |

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
- `syncBinStock(tx, binIds[])` — **R38, P11**: for each bin, `BinStock.quantity` per product =
  count of live units (not SOLD / LOST / RESET / TRANSFERRED) in that bin. Every function above
  that changes a unit's `binId` or status calls it for the bins it touched, so an outward that sells
  a unit from `FLOOR-R3` lowers `FLOOR-R3`'s bin stock in the same transaction. Products with no
  units keep today's `BinStock` untouched.
- `isAssemblable` rule (R42, P6): a unit is **non-assemblable** while its bin has
  `nonAssemblable = true`; exported as a Prisma `where` fragment (`assemblableUnitWhere`) so the
  Awaiting query, the condition page and the dashboard all use the same filter.

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
| Awaiting query + **new** `_components/no-assembly-tab.tsx` (`?tab=no-assembly`, `assembly.view`) | R42: Awaiting excludes units in non-assemblable bins (`assemblableUnitWhere`); the new tab lists them (unit · product · warehouse · bin), same filters, no assign action |

### 3.4 Wave 1 — Part F: sidebar, stock & inventory, store management (R10, R11, R27–R33)

| File | Change |
|---|---|
| `src/stores/permissions.ts` + module API | carry `dividerBefore` |
| `src/components/app-sidebar.tsx` | parent with `route: null` renders as a button that only toggles (R28); `dividerBefore` renders a divider above that child |
| `components/desktop/sidebar.tsx`, `components/header-menu.tsx`, `(dashboard)/more/page.tsx` | same two behaviours so every renderer agrees |
| `(dashboard)/stock/page.tsx` | chips row **Categories · Brands** linking to `/categories`, `/more/brands` (shown by `categories.view` / `brands.view`); **Assembled / Unassembled / No assembly** columns (R10, P7); quick chip **No assembly** (R42); link "Assembled vs unassembled"; category filter uses Part I's tree picker (parent with children indented, R43) |
| `api/products` GET | `categoryId` includes the whole subtree via Part I's `categorySubtreeIds` (R43, P13); `condition=no-assembly` filter |
| `api/products` GET | per product `assembledUnits`, `unassembledUnits` (one grouped query over non-SOLD/LOST/RESET/TRANSFERRED units) |
| **new** `(dashboard)/stock/condition/page.tsx` + `api/stock/condition/route.ts` (`stock.view`) | model · location · assembled · unassembled · **no assembly** (P7) · total; filters store, warehouse, brand; unassembled number links to `/assembly?tab=awaiting&productId=&warehouseId=`, assembled to `/stock?…` (R11) |
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
| `deliveries/[id]/_components/customer-info-card.tsx` + `api/vcard/route.ts` | **R44, P14 (a)**: after Save Customer succeeds, the browser downloads `<name>.vcf` (name, `+91-` phone, alternate phone, invoice no. in the note) from `api/vcard` (made `deliveries.view`-guarded and fed by the delivery id); the phone opens "Add contact" pre-filled. The header comment "no vCard" is updated. |

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

### 3.6a Wave 1 — Part I: category tree (R43, P12, P13)

| File | Change |
|---|---|
| **new** `src/lib/categories/tree.ts` | `categorySubtreeIds(db, id)` (recursive CTE, cycle-safe) and `buildCategoryTree(rows)`; used by `api/products` (F), rule matching (H) and pickers |
| **new** `src/components/category-tree-select.tsx` | searchable picker showing parents with children indented; optional "parent only" mode for the rule form's first select and "children of X" mode for the second |
| `api/categories/zoho-import/route.ts` | **P12**: second pass sets `parentId` from Zoho `parent_category_id` → our row with that `zohoCategoryId`; existing rows get their parent on re-import; a parent that would create a cycle is skipped with `log.warn`; the "deliberately flat" comment (:25-27) is replaced with this decision |
| `api/categories/zoho-preview/route.ts` | preview shows the Zoho parent name per row |
| `(dashboard)/categories/page.tsx` | tree view (expand/collapse, children indented); **parent picker** on create and edit (sends `parentId`); back link → `/stock` (Q27) |

### 3.6b Wave 2 — Part H: bins — rules, existing stock, unit codes, non-assemblable (R38–R42, P6–P11, P13)

| File | Change |
|---|---|
| `api/bins/home-rules/route.ts` | POST accepts `categoryId` + optional `subcategoryId` (stored as the most specific `categoryId`, P13); response includes the category path |
| **new** `src/lib/bins/rule-match.ts` | one matcher for put-away **and** apply: precedence product > brand+subcategory > brand+category (subtree) > subcategory > category (subtree) > brand, using `categorySubtreeIds` |
| `api/inbound/[id]/putaway/route.ts` GET | uses `rule-match.ts` (replaces the inline chain :49-113) |
| **new** `api/bins/home-rules/[id]/apply/route.ts` | **R40, P10** — `bins.edit`. `GET` = dry run: per product, units with **no bin** that would move, and units **in another bin** (listed separately). `POST {includeOtherBins: boolean}` moves them in one transaction, one `BinMovementLog` per unit, sets `Product.binId` to the rule's bin, `syncBinStock` for every bin touched |
| **new** `api/bins/generate-unit-codes/route.ts` | **R41, P8** — `bins.edit`. Scope: warehouse (required), optional bin. `GET` = dry run: per product per warehouse `StockLevel.quantity − live units`, the bin each would go to (`BinStock` row, else `Product.binId` in that warehouse, else no bin) and the default condition. `POST {condition: "default" \| "assembled" \| "unassembled"}` — default = FLOOR → assembled, GODOWN → unassembled; units placed in a non-assemblable bin need no condition. Creates via `createUnits`, then `syncBinStock` |
| `bins/page.tsx` rules modal (after F moved `/bins` into a component) | Category (parent) + **Subcategory (optional, children of the chosen category)** + Brand + Bin (R39); on save, a panel **"Apply to existing stock"** shows the dry run and a Confirm; checkbox "also move the N items already in other bins" (P10) |
| bins directory (same component) | per bin **Non-assemblable** switch (`bins.edit`, R42); a **Generate unit codes** button per warehouse and per bin with the dry-run summary and the condition choice (R41) |
| `api/bins/route.ts`, `api/bins/[id]/route.ts` | accept `nonAssemblable` |
| `api/bins/move/route.ts`, `api/bins/assign/route.ts`, `api/inbound/[id]/putaway/route.ts` POST | after changing unit `binId`, call `syncBinStock` for the bins touched (P11) instead of the separate `BinStock` increments |

The R38 bin-level reduction itself needs no code in the delivery routes: B's `sellUnits` calls
`syncBinStock` for the bins the sold units were in.

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
| 1 | F | sidebar renderers, `src/stores/permissions.ts`, module API, `stock/**` pages, `api/products`, `api/stock/condition`, `stores/page.tsx`, `bins/page.tsx` (extraction only), `settings/page.tsx` | S; uses I's tree helper — F imports `src/lib/categories/tree.ts` and `category-tree-select.tsx` once I has written them (I writes those two files **first**) |
| 1 | I | `src/lib/categories/tree.ts`, `src/components/category-tree-select.tsx`, `api/categories/**`, `(dashboard)/categories/page.tsx` | S |
| 2 | C | `src/lib/deliveries/*`, `api/deliveries/**`, `api/public/delivery/**`, `deliveries/**` screens, `src/lib/approvals/actions/delivery.ts` | B |
| 2 | D | `src/lib/transfers/*`, `api/transfer-orders/**`, `transfers/**`, `api/inbound/[id]/{approve,reject,resubmit}`, inbound create + DELETE event, `inbound/[id]/page.tsx`, `api/stock-counts/[id]/route.ts` (after B), `stock-audit/[id]/page.tsx:450`, `api/approvals/error-rate`, `settings/approvals/**`, `src/lib/approvals/actions/{inbound,transfer}.ts` | B |
| 2 | H | `api/bins/**` (home-rules, apply, generate-unit-codes, move, assign, bins CRUD), `src/lib/bins/*`, `api/inbound/[id]/putaway/route.ts`, the bins component F extracted | B, F, I |
| 3 | G | `(dashboard)/page.tsx`, `api/dashboard/overview`, stuck-hours editor | C, D, H |
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
12. **Bin-level stock (R38):** sell a unit from `FLOOR-R3` → `FLOOR-R3`'s bin stock drops by one;
    move a unit between bins → both bins' counts follow.
13. **Rules on existing stock (R39, R40):** rule Hero · Bicycles › 29-inch · `GODOWN-A2` → dry run lists
    unbinned Hero 29-inch items and those in other bins → confirm → units moved, movement log written.
14. **Unit codes for existing stock (R41):** a godown with `StockLevel` 12 and 0 units → dry run says
    12 → generate → 12 unassembled `U-` codes in the bin; the floor run creates assembled ones.
15. **Non-assemblable (R42):** mark `GODOWN-S07` non-assemblable → its units leave Awaiting and appear
    on `/assembly?tab=no-assembly`; `/stock` "No assembly" chip; condition page third column.
16. **Categories (R43):** import from Zoho → children sit under their Zoho parent on `/categories`;
    `/stock` filter on the parent shows the children's products too.
17. **Save to phone (R44):** Save Customer on Android and iPhone → "Add contact" opens pre-filled.

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
- Pushing categories (or parents) to Zoho (P12).
- Saving contacts silently through Google Contacts or a native app (P14 (b), (c)).
