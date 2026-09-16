# Priority build & stock flow — requirements, action flow and questions

Written 16 Sep 2026 from the owner's request and from the ops brief
`docs/asset/BCH OPS - Priority Build & Stock Flow.pdf` (Ibrahim, 15 Sep 2026). This is a
**requirements document**, not an implementation plan. Nothing here has been built.

It has eight parts:

1. **The requirements.** The owner's words verbatim, the brief's words verbatim, and then
   each requirement restated as `R1…Rn`.
2. **Decisions already taken.** `D1…D4`, settled in the brief or by the owner.
3. **Action flows.** Who does what, step by step, with a worked example for each area.
4. **Questions.** `Q1…Q30`. The ones marked **blocking** must be answered before a plan can
   be written. Every question has a recommended default.
5. **Facts verified against the code.** Each has a file:line citation, so a plan starts from
   the code as it is on disk.
6. **Permission map.** This is data for the RBAC catalog, never code.
7. **Defects found while checking the code.**
8. **Out of scope**, and the **work record**.

A line marked *Today:* describes what the app already does, so the reader can see what is new.

Only these sections of the brief are covered: **§1 Navigation (sidebar)**, **§2 Outward when
the cycle is in the warehouse**, **§3 Assembled vs unassembled**, **§4 Hold a build in one
tap**, **§5 Every process has a doer and an approver**, **§6 Priority delivery first**, and
**§9 Main dashboard**. The other sections are listed in §8, Out of scope.

---

## 1. The requirements

### 1.1 The owner's words, verbatim (16 Sep 2026)

> i need u to create a requiremnt  file where /assembly  when the  let the rout has t tab= with the related scren and the thing is  when the assigne user start the assemble to pause i have lot of option i need just two option wheere ISSUE WITH  ISSUE WITH the cycle and  ISSUE ON THE WORKFLOOR by choosing any one of this option i need to the work has to be hold & 'f:\bharath  Cycle\BCH-Management\docs\asset\BCH OPS - Priority Build & Stock Flow.pdf' this is the pdf  in this get only this OUTWARD WHEN THE CYCLE IS IN THE WAREHOUSE data  and ASSEMBLED VS UNASSEMBLED  and PRIORITY DELIVERY FIRST  and this EVERY PROCESS HAS A DOER AND AN APPROVER  and dashbord designing  and also related to the sidebar  take this acnd create a requiremnt file insied the & 'f:\bharath  Cycle\BCH-Management\docs\implementation\requiremnts'  folder

### 1.2 The brief's words, verbatim (Ibrahim's dictations, 15 Sep 2026, relevant parts only)

**Sidebar (dictation 1 and recording):**

> Inside stock management, it should be: 1. Inbound 2. Outbound 3. Stock transfer 4. Stock audit. That's it.
> Warehouse bin is not a part of stock management. It is a part of store management, which comes inside settings, so that is a part of it.
> Barcode and label is also not part of operations. It is a part of build line process.
> POS and settlement is also not a part of operations. It is a part of accounts.
> Build line assembly is a part of operations. Again, build line assembly should sit on the top.
> Customer complaint is also not part of operations. It is a part of sales. Customers and customer complaints are a part of sales, so they will sit inside that.

> And then while clicking on the stock management the page that is opening up when it doesn't make sense, right? So it should just open up a drop-down view … brands and the categories can be inside stock and inventory like a small chips inside them where you can click on them and it explores right?

**Outward when the cycle is in the warehouse (dictation 1):**

> for any outward that we are doing, we will need to have stock in the place of supply. The place of supply is the store, right? From the BCH store, if that stock is in the warehouse, before doing the outward, that stock needs to be inside the BCH store, right? It should hit a trigger, an error message, and also notify a person who must do the transfer, right?

> let's say the item is not available in the store, so there will be a transfer order created if it is in the warehouse. Once they create a transfer order, the assembly happens in the warehouse, and then it gets transferred, right? In the warehouse, they need to create a build line for that particular assembly. While moving it out, they will create a priority assembly.

**Assembled vs unassembled (dictation 2):**

> we need to track the stock based on its condition, whether it is assembled or unassembled. Let's say tomorrow we have 100 units of a model: 20 are in the warehouse in assembled condition and 80 are in unassembled condition. We need to know that number.
> orelse how will the buildline know which are assembled and which are not assembled? I mean, how will the stock position show which are assembled and not assembled?

> Have a multi-select option, sort option, and filter option so that we know which to filter and pull it out for assembly. All the unassembled bicycles must show here in the build line, and all the assembled ones must show inside the stock management and stock and inventory. There will be another page which shows the unassembled and assembled products.

**Hold a build (dictation 2):**

> Issue with the cycle. Issue on the workfloor
> These guys don't have a formal education bro. We have to keep it very simple. We can't give them five options, only two small boxes they click on and then it should automatically confirm. You can't even have them click and then put "Confirm Hold".

**Doer and approver (dictations 1 and 2):**

> for every activity (let's say stock transfer, outbound, inbound, and stock audits), I'm going to have one person assigned. I'm going to have one person to oversee all these activities … There is a person who is overseeing and approving those operations, right? For every process, we have approval.
> Once we have it on the mobile app, they will simply get a notification from where they will review it. … If Giridhar has to create a transfer order, he'll create a transfer order, upload the necessary invoices, and after that, he will request approval. Shravan is the person who'll give him the approval. … he'll get a push notification from where he will either approve it, reject it, or, if he wants to deeply understand it, he will understand it, right?

> Nithin does inbound and outbound, stays in care by Ranjita, and Shravan approves. Shravan and Srinu will divide what they approve based on their error rate. We can see who is more qualified to get that position.

**Priority delivery first (dictations 1 and 2):**

> Let's say we have a batch that we need to deliver, but it's not assembled. The mech should know that these are the priority batches that they need to get assembled so that they can get it delivered, right? The mech should get a priority star mark in his assembly list, by which he can plan which one he gets to assemble first and which one he gets to assemble later, right?
> How does this priority list get fed? It depends on the delivery schedule … maybe we can give an option to the person who is doing the outbound, right? He will just mark it as priority, and then it will become priority.

> When the 10 jobs are stalled, the system is failing, right? Or maybe we just need to rush all the orders. Let's start with that. Let's start with priority delivery and then understand how we need to move forward.

**Dashboard (recording):**

> We need to make the dashboard more reasonable and more technical and more as what should be a place where decision-making becomes more easier, right? It should help us understand what is stuck. What is in progress and what is done so that it gives us better clarity and also the payable the receivable the stock value overdubils. These are also very important key Metrix's. … So we need to be able to decide which numbers to show on the main dashboard which are the most relevant numbers of the business that should be on the main dashboard

### 1.3 Restated

**A. `/assembly`: tabs in the URL**

- **R1.** Each `/assembly` tab has its own address, `/assembly?tab=<key>`. Opening that address
  opens that tab's screen, and switching tabs updates the address. A link, a bookmark, a
  refresh or a notification can then land on the right tab.
- **R2.** A `?tab=` the user is not allowed to see (for example a mechanic opening the
  supervisor's Awaiting tab) falls back to a tab they can see. It never shows an empty or
  broken screen.

**B. Hold a build: two options, one tap**

- **R3.** When the assigned user has started a build and wants to pause it, the hold sheet
  offers **exactly two options**: **ISSUE WITH THE CYCLE** and **ISSUE ON THE WORKFLOOR**.
  The current seven reasons and the "Other reason…" free text are removed.
- **R4.** **Tapping either option puts the build on hold immediately.** There is no Confirm
  Hold button and no second step. The options are two large boxes, easy to hit on a phone.
- **R5.** On hold, the build timer freezes and stays frozen until the build is resumed. The
  timer itself stays.
- **R6.** The chosen option is recorded against the build, so holds can be counted later as
  "cycle vs workfloor" (brief §8, build line data points).

**C. Assembled vs unassembled**

- **R7.** Every unit of stock carries a **condition**, either **assembled** or
  **unassembled**, and that condition is known per model and per location.
- **R8.** The build line lists **all** unassembled units. No row limit may hide units from
  view or from selection.
- **R9.** On the build line's Awaiting Assignment list, a supervisor can **multi-select**
  units and assign them in one action. They can **filter** by model, brand, location and bin,
  and **sort** by delivery time, received date and model.
- **R10.** Assembled units show inside **Stock management** and **Stock & inventory**.
- **R11.** A separate page shows **assembled and unassembled side by side, per model and
  location**, for example "Model A · warehouse · 20 assembled + 80 unassembled = 100".

**D. Outward when the cycle is in the warehouse**

- **R12.** The **place of supply** for an outward is the BCH store. An outward goes out only
  if the stock is in that store.
- **R13.** If the stock is only in the warehouse, the outward is **blocked**. The error on
  screen says where the stock actually is.
- **R14.** The same event **notifies the transfer owner**, the person who must move the stock
  to the store.
- **R15.** The transfer owner raises a **transfer order** (warehouse → store), **uploads the
  invoices**, and **requests approval**.
- **R16.** Moving that stock also **starts a build-line job** in the warehouse. The cycle is
  assembled there, then transferred. This is the second way a build gets started, after
  inbound.
- **R17.** Once the transfer is received, the stock is in the store as **assembled** stock.
  The outward's check then passes and the outward goes out by the time recorded on it.
- **R18.** An outward records a **delivery date and time**.

**E. Priority delivery first**

- **R19.** The person doing the outbound can mark an outward **★ priority**. This is optional.
- **R20.** The ★ travels with the build job that outward causes. On the mechanic's assembly
  list, **★ jobs are listed first**, and every card shows its **delivery time**.
- **R21.** Start simple. The star is set by hand and starred jobs go first. The app keeps
  enough data to show later how often everything gets starred ("the all-10 signal").

**F. Every process has a doer and an approver**

- **R22.** Each of the four stock activities (**Inbound, Outbound, Stock transfer and Stock
  audit**) has a **doer** and an **approver**.
- **R23.** Who the doer and approver are is **set in settings, never in code**. The
  assignment will change over time.
- **R24.** A doer **requests approval**. The approver receives a **push notification on
  their phone** with **Approve**, **Reject** and **Open** (open the record for details).
- **R25.** **Reject sends it back** to the person who raised it.
- **R26.** The app records enough about each approval to measure an **approver's error
  rate** later, so approvals can be split between approvers by how few errors each makes.

**G. Sidebar**

- **R27.** **Operations** holds exactly two things: **Build line assembly** at the top, then
  **Stock management**.
- **R28.** **Stock management** holds exactly **1 Inbound · 2 Outbound (delivery & dispatch) ·
  3 Stock transfer · 4 Stock audit**, in that order. Clicking **Stock management** opens a
  **dropdown**, not a page.
- **R29.** **Barcode & labels** moves **inside Build line assembly**.
- **R30.** **POS & settlement** moves to **Accounts**. **Accounts** and **Expenses** stay
  where they are.
- **R31.** A new **Sales** group holds **Customers** (moved out of Accounts) and **Customer
  complaints** (moved out of Operations).
- **R32.** **Warehouse bins** moves to **Settings › Store management**.
- **R33.** **Categories** and **Brands** leave the menu. They appear as clickable **chips
  inside Stock & inventory**.
- **R34.** On mobile, **Stock & inventory** sits in the bottom bar and holds assembled stock.

**H. Main dashboard**

- **R35.** The main dashboard is where decisions get made. It shows what is **Stuck**, what is
  **In progress** and what is **Done**.
- **R36.** It shows the money and stock numbers: **Payables**, **Receivables**, **Stock
  value** and **Overdue bills**.
- **R37.** Chethan proposes a **shortlist** of the numbers that belong on the main dashboard,
  and Ibrahim chooses. Every other page keeps its own mini-dashboard.

---

## 2. Decisions already taken

- **D1. Hold is two options, one tap, and the timer stays** (Ibrahim, 15 Sep; owner,
  16 Sep). This **supersedes** the hold reasons agreed on 11 Sep in
  `docs/assembly-audit-requirements.md` Q17 ("parts missing, damaged on arrival, other").
- **D2. Priority starts manual** (Ibrahim, 15 Sep). The outbound person marks the star and
  starred jobs go first. The team learns from how it gets used before adding rules.
  Ibrahim's idea of coaching the habit, and Claude's suggestion of ordering by delivery time,
  are both "later, if needed". Q20 asks whether to adopt the second one now.
- **D3. People are set in settings, not code** (brief §5). This also follows CLAUDE.md's
  rule that access is data: no user name or role name may appear in a condition in source
  code.
- **D4. The build line timer stays** (dictation 1: "let there be a timer").

---

## 3. Action flows

### 3.1 `/assembly` tabs in the URL (R1–R2)

| Address | Screen | Who sees it today |
|---|---|---|
| `/assembly?tab=awaiting` | Awaiting Assignment: unassembled units, multi-select, filter, sort (R9) | `assembly.approve` |
| `/assembly?tab=tasks` | Assembly Tasks: every task, filtered by status and mechanic | `assembly.approve` |
| `/assembly?tab=mine` | My Build Queue: my assigned builds, ★ first (R20), with Start / Hold / Complete | `assembly.edit` |
| `/assembly?tab=labels` | Barcode & labels, *only if Q26 says it becomes a tab* | `barcode.view` |

1. The user opens `/assembly` with no `tab`. The landing rule that exists today still applies:
   a supervisor with no active build lands on `awaiting`, everyone else on `mine`. The address
   is rewritten to show the chosen tab.
2. The user taps a tab. The screen switches and the address becomes `?tab=<key>`, replacing
   the history entry rather than adding one.
3. A mechanic opens `/assembly?tab=awaiting` from a shared link. They lack `assembly.approve`,
   so they land on `mine` and the address is corrected.

### 3.2 Hold a build (R3–R6)

1. Ravi has started `U-000481`. The timer reads 00:14:32.
2. The left pedal is missing, so Ravi taps **Hold**.
3. A sheet opens with two large boxes: **⚠ ISSUE WITH THE CYCLE** and **⚒ ISSUE ON THE
   WORKFLOOR**.
4. Ravi taps **ISSUE WITH THE CYCLE**. The sheet closes at once and the task is **On Hold**,
   with the timer frozen at 00:14:32. Nothing else is pressed.
5. The supervisor's Assembly Tasks tab shows `U-000481 · On hold · Issue with the cycle`.
6. The pedal arrives. Ravi taps **Resume** and the timer continues from 00:14:32.

A mis-tap is corrected by tapping **Resume**. There is no undo step, because an undo would be
the confirm step the owner ruled out (Q4).

### 3.3 Outward from the warehouse, with priority (R12–R21)

1. **Nithin (outbound)** opens outward `INV-BCH-0931` for 2 × Hero Sprint 29. He records
   delivery **today 18:00** and marks it **★ priority**.
2. **App.** It checks the place of supply, the BCH store (Q7, Q8). The store holds 0; the
   warehouse holds 2 unassembled.
3. **App.** The outward is **blocked**: "Hero Sprint 29: 0 in BCH store · 2 in warehouse
   (unassembled). A transfer is needed." At the same moment **Giridhar (transfer owner)** is
   notified (R14).
4. **Giridhar** creates a transfer order, warehouse → BCH store, for the 2 units. He attaches
   the invoices and taps **Request approval** (R15).
5. **Shravan (transfer approver)** gets a push: "Giridhar requested a transfer order:
   warehouse → BCH store · 2 invoices attached", with **Approve / Reject / Open**. He taps
   **Approve** (R24). Had he tapped Reject, the order would go back to Giridhar (R25).
6. **Warehouse build line.** Two build jobs for the 2 units appear **★ first** on the build
   list, showing "deliver today 18:00" (R16, R20). Q12 asks whether they appear before or
   after step 5.
7. The mechanic builds both. The units become **assembled** (R7).
8. **Giridhar** dispatches the transfer and the store receives it. The store now holds
   2 assembled (R17).
9. **Nithin** retries the outward. The check passes and the outward goes out by 18:00.

### 3.4 Doer and approver per activity (R22–R26)

| Activity | Doer (brief §5) | Approver (brief §5) | What the approver approves (Q16) |
|---|---|---|---|
| Inbound | Nithin | Shravan / Srinu | the shipment before receiving, as today (`inbound.approve`) |
| Outbound | Nithin | Shravan / Srinu | *nothing is approved on a delivery today* (Q16) |
| Stock transfer | Giridhar | Shravan | the transfer order, as today (`transfers.approve`) |
| Stock audit | Ranjitha? (brief Q1) | Shravan / Srinu | the count, as today (`stock_audit.approve`) |

1. An admin opens **Settings › Activity owners** (name to be decided) and, per activity, picks
   the doer(s) and the approver(s) from the users who already hold the matching grant (Q14).
2. A doer finishes their part and taps **Request approval**. The record goes to *Awaiting
   approval* and every named approver gets a push.
3. One approver acts. The record moves on, and the other approvers' notifications are
   resolved.
4. Every approval and rejection records who, when, and what was decided, so an error rate can
   be computed later (R26, Q18).

### 3.5 Assembled vs unassembled page (R7–R11)

| Model · location | Assembled | Unassembled | Total |
|---|---|---|---|
| Hero Sprint 29 · BCH store (floor) | 4 | 0 | 4 |
| Hero Sprint 29 · warehouse | 20 | 80 | 100 |

- A number in **Unassembled** links to the build line's Awaiting tab, filtered to that model
  and location.
- A number in **Assembled** links to Stock & inventory, filtered the same way.

### 3.6 Sidebar after the change (R27–R34)

```
Overview        Dashboard · Activity Log
Operations      ▲ Build line assembly            (Barcode & labels inside it — Q26)
                ▾ Stock management               (click = expand only)
                    1 Inbound
                    2 Outbound (delivery & dispatch)
                    3 Stock transfer
                    4 Stock audit
Sales  (new)    Customers · Customer complaints
Purchase        Vendors · Purchase Orders · Vendor / Ops Issues          (unchanged)
Accounts        Accounts · Expenses · POS & settlement
Insights        Reports · Store Analytics                                (unchanged)
Admin           Team · Roles & Permissions · Settings (› Store management › Warehouse bins — Q24)
Service, Staff LMS                                                       (unchanged)

Not placed yet: Stock & inventory (Q23) · Second-Hand Cycles (Q25) · Stores (Q24)
Chips inside Stock & inventory: Categories · Brands
```

### 3.7 Main dashboard (R35–R37)

This is Chethan's proposed shortlist, for Ibrahim to accept or cut (Q29, Q30). Each card
links to the screen that holds the detail.

| Row | Card | Meaning |
|---|---|---|
| Money | Payables · Receivables · Overdue bills · Stock value | as `/api/accounts/summary` and the stock-value query compute them today |
| Stuck | Outwards blocked (stock in warehouse) · Approvals waiting > 24 h · Builds on hold (cycle / workfloor) · Inbound pending > 72 h | something needs a person |
| In progress | ★ builds open · Builds in progress · Transfers in transit · Audits in progress | moving, nobody needs to act |
| Done (today) | Outwards delivered · Builds completed · Transfers received · Inbound received | today's output |
| Stock by condition | Unassembled units · Assembled units · Oldest unassembled (days) | the R11 page in three numbers |

---

## 4. Questions

**Blocking. A plan cannot be written without: Q7, Q8, Q9, Q10, Q13, Q14, Q16, Q23.**

### A. Tabs

- **Q1.** What should the tab values be? Short keys `awaiting` / `tasks` / `mine`, which the
  code already uses, or readable ones like `awaiting-assignment` / `my-build-queue`?
  *Recommended:* the short keys.
- **Q2.** Does the ★ priority list get its **own tab** (for example `?tab=priority`), or do
  ★ jobs simply sort first inside the existing tabs? *Recommended:* sort first; no new tab.

### B. Hold

- **Q3.** Do the two options need **any detail at all**, such as an optional note or a photo
  that a supervisor adds later? *Recommended:* none from the mechanic. The supervisor can add
  a note from the Assembly Tasks tab.
- **Q4.** A mis-tap holds the build instantly. Is **Resume** enough as the undo?
  *Recommended:* yes.
- **Q5.** On 11 Sep, "damaged on arrival" was meant to **offer a vendor issue** carrying the
  unit code (`docs/assembly-audit-requirements.md:290`). Should **Issue with the cycle** offer
  that, as a supervisor action and not the mechanic's? *Recommended:* yes, from the supervisor's
  task view.
- **Q6.** Does a hold **notify the supervisor**? *Recommended:* not in this build. Holds show on
  the Assembly Tasks tab and in the dashboard's Stuck row.

### C. Outward guard

- **Q7 (blocking).** What does **"the warehouse"** mean in the data? Today a store owns FLOOR
  and GODOWN warehouses (§5.2). Is Ibrahim's "warehouse" the **GODOWN of the BCH store**, or a
  **separate store** (the screenshot shows "BCH TEST WAREHOUSE")? And is "in the store"
  therefore **the FLOOR warehouse** only? *Recommended:* "in store" = the FLOOR warehouse of the
  outward's store; "warehouse" = any other location holding the stock.
- **Q8 (blocking).** **When does the check run?** Outwards are not typed in. They arrive from
  Zoho invoice import as `PENDING` (§5.3), so an import cannot be blocked: the invoice already
  exists in Zoho. *Recommended:* the import still lands. The check runs at the first move
  towards leaving the store (`SCHEDULED`, `PACKED`, `WALK_OUT`, `OUT_FOR_DELIVERY`,
  `DELIVERED`) and blocks that move with the error and the notification.
- **Q9 (blocking).** Should the check be **per store and per location**? Today the reservation
  check is product-wide (`Product.reservedStock`), not per store (§5.3), so stock in another
  store can let an outward through. *Recommended:* yes, check the FLOOR warehouse of the
  outward's store.
- **Q10 (blocking).** Should the check look at **condition** too? That is, must the store hold
  *assembled* units, or is any quantity on the floor enough? A lot of existing stock has no
  unit rows (Q13). *Recommended:* quantity on the floor for now; condition only once every
  unit carries one.
- **Q11.** A **walk-out** at the counter is also an outward. Does the block apply to walk-outs?
  *Recommended:* yes, the same rule.
- **Q12.** Does the **build job start before or after the transfer approval** (brief Q4)?
  *Recommended:* after approval, so a rejected transfer does not leave a build queued.
- **Q13 (blocking).** **Stock without unit rows.** Condition lives on `InventoryUnit`, but stock
  received before units existed is only a quantity (`StockLevel`), with no unit and no
  condition. How is it counted: as unassembled, as "unknown", or through a one-time count that
  creates units? *Recommended:* show it as a third column, **"Not tracked"**, until a stock
  audit creates the units.

### D. Doer and approver

- **Q14 (blocking).** How do **named people** and **permissions** combine? Today anyone holding
  the grant can approve (§5.5). *Recommended:* the settings pick people **from among those
  holding the grant**. Only the named approver(s) receive the push and may approve. The grant
  stays the gate, and the name narrows it.
- **Q15.** **Can a doer approve their own work?** Today a transfer creator who holds
  `transfers.approve` is approved automatically, and inbound has no self-check (§5.5).
  *Recommended:* no, for all four activities, the way stock audit already works.
- **Q16 (blocking).** **What exactly does the Outbound approver approve?** A delivery has no
  approval step today. Options: approve before dispatch; approve at `VERIFIED`; approve only a
  blocked outward's transfer. *Recommended:* approve at `VERIFIED`, before stock is reserved.
- **Q17.** **Inbound has no Reject today.** Is adding Reject (back to the doer) part of this
  work? *Recommended:* yes, since R25 applies to all four.
- **Q18.** **What counts as an approver's error** (brief Q2)? *Recommended:* an approved record
  that is later reversed, corrected by a stock correction within 7 days, or rejected at the next
  step. Record the raw events now and decide the formula later.
- **Q19.** **Which phone app** receives Approve / Reject / Open? Push exists (FCM, web and
  Android devices) but ships switched off, and notifications cannot carry action buttons today
  (§5.6). iPhone web push shows no action buttons. *Recommended:* action buttons on Android and
  desktop; **Open** is the fallback everywhere.

### E. Priority

- **Q20.** When several jobs are starred, what is the order among them? *Recommended:* earliest
  delivery time first. This is harmless and needs no new behaviour from anyone (brief, "Claude's
  suggestion").
- **Q21.** Can **only the outbound doer** set or clear the star, and can the star be cleared
  after a build has started? *Recommended:* anyone with `deliveries.edit`; clearing is allowed;
  every change is logged.
- **Q22.** Which **units** does a starred outward reserve for the build? Picked by the
  supervisor, or oldest received first automatically? *Recommended:* the oldest received,
  unassembled units of that product in the source warehouse, reserved so a second outward
  cannot take them.

### F. Sidebar

- **Q23 (blocking).** **Where does Stock & inventory go?** Stock management is now "exactly"
  the four steps, and Operations "only" two things, so the item list has no desktop place.
  *Recommended:* the first row inside the Stock management dropdown, above the four numbered
  steps, visually separate from them.
- **Q24.** **Settings › Store management › Warehouse bins** is three levels. The menu allows
  only two (the RBAC seeder rejects a grandchild, `prisma/seed-rbac.ts:37-51`), and Store
  Management is its own root under Admin today. *Recommended:* make **Store management** a child
  of Settings, and put Stores and Warehouse bins as tabs on one Store management screen.
- **Q25.** **Where does Second-Hand Cycles go** (brief Q3)? *Recommended:* Sales.
- **Q26.** **Barcode & labels "inside Build line assembly"**: as a child menu item under Build
  line assembly, or as a tab `/assembly?tab=labels`? *Recommended:* the tab, which also uses R1.
- **Q27.** When **Stock management** only expands, does `/stock-management` (the card hub page)
  go away? *Recommended:* keep the route for old links, and remove it from the menu.
- **Q28.** The mobile bottom bar is **per user** (each user's pinned tabs, set by an admin). Is
  R34 met by pinning Stock & inventory for the floor staff, or must it be forced for everyone?
  *Recommended:* pin it per user; no code.

### G. Dashboard

- **Q29.** Does the shortlist in §3.7 go on **every** dashboard variant, or only the Admin one?
  Today six variants are chosen by permission (§5.7). *Recommended:* Admin gets all of it;
  others get only the rows their grants allow.
- **Q30.** **What is "stuck"?** §3.7 proposes thresholds (approvals > 24 h, inbound > 72 h).
  Accept those, or set others? *Recommended:* accept; they match `/api/health/summary` today.

---

## 5. Facts verified against the code (16 Sep 2026)

Paths are relative to the repo root. `P` = `src/app/(dashboard)/assembly/page.tsx`,
`S` = `prisma/schema.prisma`.

### 5.1 `/assembly` screen

- **Tabs are React state only.**
  - `type Tab = "awaiting" | "tasks" | "mine"` (P:102). `useState<Tab>("mine")` (P:132).
    `onClick={() => setActiveTab(t.key)}` (P:539). The file has no `useSearchParams`.
  - Only `assembly.approve` holders see the tab bar (P:130, P:500, P:527).
  - The landing tab is chosen once, after the first load (P:136, P:238-248).
- **The `?tab=` pattern to copy** is in `src/app/(dashboard)/purchase-orders/page.tsx`: a
  `Suspense` wrapper (:80-86), `searchParams.get("tab")` (:98) checked against permissions
  (:99-102), and `router.replace(..., { scroll: false })` (:104-105). The comment at :76-78
  records that the production build fails without the Suspense boundary. Next is `16.2.3`.
- **Hold reasons are a local constant.**
  - `HOLD_REASONS` (P:104-111) has six strings. "Other Reason…" opens a text input (P:1033-1050).
  - Title "Place Build On Hold" (P:1007). Cancel at P:1054, Confirm Hold at P:1057.
  - The modal is a centred dialog on every screen size, not a bottom sheet (P:1002-1003).
- **Hold route:** `src/app/api/assembly/tasks/[id]/hold/route.ts`.
  - Requires `assembly.edit` (:14) and the assignee or a supervisor (:26-29).
  - HOLD requires a non-blank reason (:36) and writes `status: "ON_HOLD", holdStartedAt, holdReason` (:40-47).
  - RESUME adds the held seconds into `totalHoldSeconds` (:51-65).
  - No activity log is written.
- **Schema:** `holdReason String?` is free text, not an enum (S:826). Also `holdStartedAt`
  (S:824) and `totalHoldSeconds` (S:825). `AssemblyLog` has no hold fields (S:2718-2731).
- **Timer:** computed on the client as `(now − startedAt) − totalHoldSeconds`, only while
  `IN_PROGRESS` (P:282-305).
- **Awaiting list:**
  - `PENDING_PAGE_SIZE = 50` with `skip`/`take`, ordered by `unitCode` (`src/app/api/assembly/tasks/route.ts:17, 113-115`).
  - A **Load more** button fetches the rest (P:664-677). The other 57 of 107 are not lost, but
    they cannot be selected until loaded.
  - Filter: `assembledAt: null`, status `RECEIVED`/`PUT_AWAY`, and no open task (route :57-61).
  - Server search `?q=` (:62-75). Each row has its own Assign button (P:651-658).
  - No multi-select, filter or sort.
- **"50% · Box build"** is the assembly level `A50` (`src/lib/assembly-level.ts:23-32`), taken
  from `Product.assemblyLevel` (S:571). It is not a progress figure; this answers brief Q8.
- **No priority anywhere on assembly.** `AssemblyTask` has no priority field (S:808-837). The
  only mention is placeholder text in the Assign notes box (P:1245).

### 5.2 Units, condition and locations

- **`InventoryUnit`** (S:748-786) has `unitCode` (`U-000481`), a required `warehouseId`, an
  optional `binId`, `status UnitStatus`, and `assembledById` / `assembledAt` / `assemblyLevel`
  (S:763-766). It has no store column.
- **`UnitStatus`** values: RECEIVED, PUT_AWAY, ASSIGNED, IN_ASSEMBLY, ASSEMBLED, RESERVED, SOLD,
  RETURNED, DAMAGED, TRANSFERRED, LOST (S:788-800).
  - Assign sets ASSIGNED (tasks route :314-320).
  - Start sets IN_ASSEMBLY (`start/route.ts:42-45`).
  - Complete sets ASSEMBLED, `assembledAt` and `assemblyLevel` (`complete/route.ts:66-75`).
- **A transfer keeps `assembledAt` but resets the status.** On receive, each transferred unit
  gets `warehouseId: destId, binId: null, status: "PUT_AWAY"`
  (`src/app/api/transfer-orders/[id]/receive/route.ts:205-212`). So **condition must be read
  from `assembledAt`, not from `status`.**
- **Store vs warehouse:**
  - A `Store` is a site and holds no stock itself (S:241-243).
  - A `Warehouse` belongs to a store (`storeId`, S:307-314). Its `kind` is FLOOR (the shop) or
    GODOWN (storage) (S:293-302, S:317).
  - `StockLevel` holds one quantity per product per warehouse (S:616-631). `Product.currentStock`
    is a cached total (S:613-615).
  - A store's stock is the sum of its warehouses (`getStoreQtyMap`, `src/lib/stock-location.ts:322`).
- **A quantity has no condition.** `StockLevel` and `BinStock` (S:715-727) store a number only.
  Condition exists only where a unit row exists (Q13).

### 5.3 Outward (deliveries)

- **Created from Zoho**, as `PENDING`, with `storeId` taken from the invoice prefix:
  - `src/app/api/deliveries/import-zoho/route.ts:91-99`
  - `src/app/api/zoho/pull-review/approve/route.ts:620-640`
  - `src/lib/deliveries/zoho-invoice.ts:39-90`
- **Other ways a delivery is created:**
  - Manual pre-book, `PREBOOKED` with no `storeId` (`src/app/api/deliveries/route.ts:116-129`).
  - Automatically from a received pre-booked inbound line (`src/app/api/inbound/[id]/route.ts:348-365`).
- **No stock check when a delivery is created.**
  - On `SCHEDULED`/`PACKED`, stock is reserved against `currentStock − reservedStock`, for the
    **product as a whole, not per store** (`src/app/api/deliveries/[id]/route.ts:166-190`).
  - The same check runs on `DELIVERED`/`WALK_OUT` if nothing was reserved (:237-244).
- **Stock is deducted on `DELIVERED`/`WALK_OUT`** by `deductFromStore`, which drains the store's
  FLOOR warehouses first and **then the GODOWN** (`src/lib/stock-location.ts:101-141`). Today an
  outward therefore *already* takes godown stock silently, with only a log line.
- **Status flow:** PENDING, VERIFIED, WALK_OUT, SCHEDULED, OUT_FOR_DELIVERY, DELIVERED, FLAGGED,
  PREBOOKED, PACKED, SHIPPED, IN_TRANSIT (S:1810-1822). Allowed moves are at
  `deliveries/[id]/route.ts:76-88`.
- **Delivery columns:**
  - `scheduledDate DateTime?` (S:1852) and `expectedReadyDate` (S:1857).
  - **No priority field and no place-of-supply column.**
  - The date editor edits **the date only** (`deliveries/[id]/_components/delivery-date-editor.tsx:100`
    slices to `YYYY-MM-DD`), so R18's time is new.
- **No link from Delivery to a unit or a build.** Delivery has no unit or assembly relation
  (S:1824-1906). `InventoryUnit` carries sale details as free text only (S:768-772).

### 5.4 Transfer orders

- **Status:** PENDING → APPROVED / REJECTED / CANCELLED; APPROVED → IN_TRANSIT / CANCELLED;
  IN_TRANSIT → RECEIVED (S:2016-2023, `src/lib/transfers/transitions.ts:27-43`).
- **Modes:** STORE_TO_STORE, STORE_TO_WAREHOUSE, GODOWN_TO_FLOOR (S:2042-2046). A
  STORE_TO_STORE transfer is a TAX_INVOICE; the others are a DELIVERY_CHALLAN
  (`src/lib/transfers/mode.ts:21-23`).
- **Create** (`transfers.create`, `src/app/api/transfer-orders/route.ts:225`):
  - **one** document (`docUrl`) is required (:60-63, :310-325), and source stock is checked (:348-359).
  - **A creator holding `transfers.approve` is approved automatically** (:372-388).
- **Approve / reject** (`transfers.approve`, `approve/route.ts:46`) writes `reviewedById` /
  `reviewedAt`, and records `rejectionNote` on a reject (:85-93, :154-162).
- **One document per order** (S:2095-2102). "Upload the necessary invoices", plural, is new.

### 5.5 Approvals today

| Activity | Approve route · grant | Reject? | Self-approval blocked? | Named approver? |
|---|---|---|---|---|
| Inbound | `inbound/[id]/approve` · `inbound.approve` (:18) | **no** | **no** | no, anyone with the grant |
| Outbound | **none.** `VERIFIED` is a status change under `deliveries.edit` that stamps `verifiedById` (`deliveries/[id]/route.ts:136-139`) | no | n/a | no |
| Transfer | `transfer-orders/[id]/approve` · `transfers.approve` | yes | **no, it is automatic** | no |
| Stock audit | `stock-counts/[id]` · `stock_audit.approve` | yes | **yes** (`stock-counts/[id]/route.ts:148-175`) | no; the assignee is named (`assignedToId`) |

No "activity → person" setting exists. `AppSetting` is a generic key/value table (S:2454-2458).

### 5.6 Push notifications

- **FCM only.** `NotificationConfig` (S:1522-1537) and `PushDevice` for WEB or ANDROID
  (S:1556-1581).
- **Off by default.** The master switch ships off
  (`docs/implementation/pending/notifications-and-settings-rbac-plan.md:64`) and is checked in
  `src/lib/notify/index.ts:81-93`.
- **Helper:** `notify(eventKey, { recipients, title, body, link, data })`
  (`src/lib/notify/index.ts:55`). It takes user ids, so a single named person can be targeted.
- **Only five events** are registered (`src/lib/notify/events.ts:27-53`), none for transfers,
  deliveries or audits.
- **No action buttons.** The payload is title, body, link and data (`src/lib/notify/types.ts:107-112`).
  The service worker passes no `actions` (`public/sw.js:73-78`), and a click opens `data.link`
  (:87-115).
- `docs/notifications-guide.md:61` says the person who triggered an event never receives it.

### 5.7 Sidebar and dashboard

- **The menu is data.** `Module` has `route`, `group`, `sortOrder` and `parentId` (S:23-68).
  - The rows are seeded from `prisma/rbac-catalog.ts` by `prisma/seed-rbac.ts`, which allows
    **two levels at most** (:37-51).
  - Groups are ordered by `sortOrder` bands (`rbac-catalog.ts:55-63`).
  - Modules with `route: null` are hidden. **Moving an item is a catalog change plus
    `npm run db:seed:rbac`, not a migration** (CLAUDE.md, migrations rule 11).
- **Sidebar component:** `src/components/app-sidebar.tsx`. A parent's label is a `<Link>` to the
  parent route (:303-310) and its chevron toggles open/closed (:324-340). R28's "expand only"
  changes this component.
- **The menu today:**
  - **Operations** holds Stock Management (Stock & Inventory, Categories, Stock Audit, Inbound,
    Deliveries & Dispatch, Stock Transfers, Brands, Warehouse Bins), then Second-Hand Cycles,
    Barcode & Labels, POS & Settlement, Build-Line Assembly and Customer Complaints.
  - **Accounts** holds Accounts, Expenses and Customers.
  - **Admin** holds Team, Roles & Permissions, Settings, and **Store Management** (its own root,
    with Stores).
  - **There is no Sales group.**
- **Settings index** is a hardcoded list (`src/app/(dashboard)/settings/page.tsx:27-84`) and
  already contains "Bins & Locations" (`/more/bins`).
- **Mobile bottom bar:** Home + up to 4 **per-user pinned** routes (`User.navTabs`, S:391) +
  More (`src/components/bottom-nav.tsx:20-36`, `src/lib/nav-tabs.ts`).
- **`/stock`** has quick-filter chips (All, In Stock, No Stock, Low Stock, Needs details,
  Inactive) (`src/app/(dashboard)/stock/page.tsx:68-79`) and already loads brands and categories
  for its filters (:259-261). It has no Categories or Brands chips.
- **Main dashboard** `/`: `src/app/(dashboard)/page.tsx`.
  - The variant is picked by permission in `pickDashboard` (:955-962): Admin, Supervisor,
    Purchase Manager, Accounts Manager, Outwards Clerk or Clerk.
  - The **Admin variant already shows Payable, Receivable, Stock Value and Overdue Bills**
    (:235-474), from `/api/accounts/summary` and `/api/dashboard/stats`.
  - Purchase Manager's "Pending POs" is hardcoded to "—".
- **Money numbers:**
  - Payables, receivables and overdue: `src/app/api/accounts/summary/route.ts:38-71`.
  - Stock value is computed three times: `api/dashboard/stats/route.ts:31`,
    `api/stock/summary/route.ts:33-49` (unused) and `api/reports/stock-value/route.ts`.
- **"Stuck" style counts:** `src/app/api/health/summary/route.ts:124-158` reports inbound and
  delivery pending over 24 h / 72 h and POs without tracking over 48 h.
  `src/app/api/ops-stats/route.ts:11` is a stub returning zeros.

---

## 6. Permission map (data, never code)

| Action | Grant | New? |
|---|---|---|
| Open `/assembly?tab=awaiting` / `tasks`, multi-assign | `assembly.approve` | existing |
| Open `/assembly?tab=mine`, start, hold (two options), resume, complete | `assembly.edit` | existing |
| Open `/assembly?tab=labels` (if Q26) | `barcode.view` | existing |
| See the assembled vs unassembled page | `stock.view` | existing module, new page |
| Mark / clear ★ priority, set delivery time | `deliveries.edit` | existing |
| Approve / reject an outward (Q16) | `deliveries.approve` | **new action** on an existing module |
| Reject an inbound (Q17) | `inbound.approve` | existing |
| Set doers and approvers per activity | `settings.edit` | existing |
| See dashboard money cards | `accounts.view` | existing |
| See dashboard stock value | `stock.view` or `reports.view` | existing |

New menu placement (Sales group, Store management under Settings, Barcode under Build line)
means `route` / `group` / `sortOrder` / `parentKey` edits in `prisma/rbac-catalog.ts`, followed
by `npm run db:seed:rbac`. No role name and no person's name may appear in code (D3).

---

## 7. Defects found while checking the code

1. **A held build shows 00:00 after a reload.** On a fresh load of an `ON_HOLD` task nothing
   sets `elapsedSec`, so it stays 0 (P:160, P:283). R5's frozen time is not shown.
2. **An outward can take stock from another store.** The reservation check is product-wide,
   not per store (`deliveries/[id]/route.ts:166-190`, `Product.reservedStock` S:555).
3. **An outward silently drains the godown** once the floor is empty
   (`src/lib/stock-location.ts:101-141`). This is exactly what R13 wants blocked.
4. **A transfer creator with the approve grant approves their own order automatically**
   (`transfer-orders/route.ts:372-388`), which contradicts R22.
5. **Hold writes no activity log** (`hold/route.ts`), so "holds per week" cannot be counted from
   history.
6. **Transferred units lose `ASSEMBLED` status** (set to `PUT_AWAY` on receive,
   `receive/route.ts:205-212`). Condition survives only through `assembledAt`.

---

## 8. Out of scope

These are from the same brief but were not requested this time:

- Customer complaints as a record and the TeleCRM pull (brief §7). Only the **menu move** of
  Customers and Customer complaints is in scope.
- The price realisation report and the expense graphs (brief §8).
- The **data points list** in brief §8, except where §3.7 uses it.
- The category parent → subcategory structure and whether a category pushes to Zoho (brief §9).
- The roles write-up per person (brief §9).
- Ops tasks: deactivating unused brands and re-running the stock audit.
- Franchise stores' place of supply (brief Q7). This document assumes the BCH store.

### Work record

| Date | What |
|---|---|
| 16 Sep 2026 | Written from the owner's request and brief sections §1–§6 and §9. Code checked by three parallel read-only agents (assembly screen; outward, transfer, approvals and push; sidebar and dashboard), with key citations re-checked by hand. 37 requirements, 4 decisions, 30 questions (8 blocking), 6 defects. Nothing built. |
