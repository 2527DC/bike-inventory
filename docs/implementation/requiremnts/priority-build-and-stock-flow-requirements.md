# Priority build & stock flow — requirements, questions, action flow

Written 16 Sep 2026 from the owner's request and from the ops brief
`docs/asset/BCH OPS - Priority Build & Stock Flow.pdf` (Ibrahim, 15 Sep 2026). Re-verified
against the code on 17 Sep 2026 at `main` = `861a237`, after the three deliveries phases
(plan 1609) were merged. This is a **requirements document**, not an implementation plan.
Nothing here has been built. **All questions were answered by the owner on 17 Sep 2026** (§2); a plan can now be written.

It has eight parts:

1. **The requirements.** The owner's words verbatim, the brief's words verbatim, then each
   requirement restated as `R1…Rn`.
2. **Questions.** `Q1…Q44`, with the order to clarify them in. The owner answers them **one at
   a time**; each answer is written under its question as **Answer (date):**. The ones marked
   **blocking** must be answered before a plan can be written. Every open question has a
   recommended default.
3. **Decisions already taken.** `D1…D5`.
4. **Action flows.** Who does what, step by step, with a worked example for each area.
5. **Facts verified against the code** (17 Sep 2026), with file:line citations.
6. **Permission map.** Data for the RBAC catalog, never code.
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

**17 Sep 2026:**

> update the doc and where first it must list the requiremnts listing and the quetsion that u have i will clarify it one by one

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
  The current six reasons and the "Other reason…" free text are removed.
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
- **R18.** An outward records a **delivery date and time**. *(Narrowed by Q32, 17 Sep: day only, as today.)*

**E. Priority delivery first**

- **R19.** The person doing the outbound can mark an outward **★ priority**. This is optional.
- **R20.** The ★ travels with the build job that outward causes. On the mechanic's assembly
  list, **★ jobs are listed first**, and every card shows its **delivery time**.
- **R21.** Start simple. The star is set by hand and starred jobs go first. The app keeps
  enough data to show later how often everything gets starred ("the all-10 signal").

**F. Every process has a doer and an approver**

- **R22.** Each of the four stock activities (**Inbound, Outbound, Stock transfer and Stock
  audit**) has a **doer** and an **approver**.
- **R23.** Who the doer and approver are is **set in settings, never in code**. *(Q14, 17 Sep: through roles and permissions only.)* The
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

## 2. Questions

### 2.0 Status and order

**Blocking. A plan cannot be written without:** ~~Q31~~, ~~Q7~~, ~~Q10~~, ~~Q32~~, ~~Q40~~, ~~Q33~~, ~~Q41~~, ~~Q13~~, ~~Q42~~, ~~Q43~~, ~~Q35~~, ~~Q12~~, ~~Q14~~, ~~Q16~~, ~~Q23~~ — **all blocking questions answered.**

**Settled by the code, not asked:** Q9 (the deliveries build already checks per floor
warehouse). **Folded into another question:** Q8 → Q31, Q22 → Q35.

The order to clarify them, one at a time. Blocking ones come first, grouped so that each answer
feeds the next:

| # | Question | Area | Blocking | Answered |
|---|---|---|---|---|
| 1 | Q31 · where a short outward is blocked | Outward | yes | ✔ 17 Sep — (b) |
| 2 | Q7 · what "the warehouse" is | Outward | yes | ✔ 17 Sep — same store's godown |
| 3 | Q10 · does the check look at condition | Outward | yes | ✔ 17 Sep — quantity only, for now |
| 4 | Q32 · delivery date and time | Outward / Priority | yes | ✔ 17 Sep — day only, customer picks as today |
| 4a | Q40 · how the time is entered | Outward / Priority | yes | ✔ 17 Sep — not needed (no time) |
| 5 | Q33 · fix the unit lifecycle first | Condition | yes | ✔ 17 Sep — yes, all in sync |
| 5a | Q41 · which units move or get sold | Condition | yes | ✔ 17 Sep — app picks, person can swap |
| 6 | Q13 · stock with no unit rows | Condition | yes | ✔ 17 Sep — reset + unit-level audit |
| 6a | Q42 · how a unit-level audit records units | Condition | yes | ✔ 17 Sep — two numbers per line |
| 6b | Q43 · what the reset clears | Condition | yes | ✔ 17 Sep — counts + units, one location at a time |
| 7 | Q35 · how the ★ reaches the build line | Priority | yes | ✔ 17 Sep — app picks + reserves units |
| 8 | Q12 · build before or after transfer approval | Priority | yes | ✔ 17 Sep — build shows at once |
| 9 | Q14 · named people vs permissions | Doer / approver | yes | ✔ 17 Sep — roles & permissions only |
| 10 | Q16 · what the outbound approver approves | Doer / approver | yes | ✔ 17 Sep — before out for delivery / shipped; not walk-out |
| 11 | Q23 · where Stock & inventory goes | Sidebar | yes | ✔ 17 Sep — first row in Stock management |
| 12 | Q11 · walk-outs | Outward | | ✔ 17 Sep — same message + push as deliveries |
| 13 | Q37 · unmatched (Dummy) deliveries | Outward | | ✔ 17 Sep — left out until matched |
| 14 | Q34 · which products get units | Condition | | ✔ 17 Sep — all products; types split by bin rules |
| 14a | Q44 · keep never-assembled products off the build line | Condition | | ✔ 17 Sep — no filter; every inbound item needs assembling |
| 15 | Q36 · resubmitting a rejected transfer | Doer / approver | | ✔ 17 Sep — returned, fix and resend, same number |
| 16 | Q38 · more than one document on a transfer | Doer / approver | | ✔ 17 Sep — one document, as today |
| 17 | Q15 · self-approval | Doer / approver | | ✔ 17 Sep — allowed if the role holds approve |
| 18 | Q17 · inbound reject | Doer / approver | | ✔ 17 Sep — add Reject, returned + resend |
| 19 | Q18 · approver error | Doer / approver | | ✔ 17 Sep — record all; count 1, 2, 4 in 7 days; editable in settings |
| 20 | Q19 · which phone app | Doer / approver | | ✔ 17 Sep — buttons on Android / desktop, Open everywhere |
| 21 | Q20 · order among ★ jobs | Priority | | ✔ 17 Sep — delivery day, then starred time |
| 22 | Q21 · who sets / clears the ★ | Priority | | ✔ 17 Sep — own permission `delivery_priority.edit`; removable any time |
| 23 | Q1 · tab keys | Tabs | | ✔ 17 Sep — short keys |
| 24 | Q2 · ★ tab or sort | Tabs | | ✔ 17 Sep — no new tab, ★ sorts first |
| 25 | Q3 · detail on a hold | Hold | | ✔ 17 Sep — none from mechanic; supervisor note |
| 26 | Q4 · undo a mis-tap | Hold | | ✔ 17 Sep — Resume, no undo bar |
| 27 | Q5 · vendor issue from a hold | Hold | | ✔ 17 Sep — supervisor, from the held task |
| 28 | Q6 · notify on hold | Hold | | ✔ 17 Sep — no push; held builds listed with product |
| 29 | Q39 · reassign or cancel a build | Hold | | ✔ 17 Sep — not in this work |
| 30 | Q24 · Store management under Settings | Sidebar | | ✔ 17 Sep — Settings › Store management, tabs Stores · Warehouses · Bins |
| 31 | Q25 · Second-Hand Cycles | Sidebar | | ✔ 17 Sep — Sales |
| 32 | Q26 · Barcode as tab or child | Sidebar | | ✔ 17 Sep — tab `?tab=labels` |
| 33 | Q27 · the /stock-management hub page | Sidebar | | ✔ 17 Sep — off the menu, page kept |
| 34 | Q28 · bottom bar per user | Sidebar | | ✔ 17 Sep — pin per user, no code |
| 35 | Q29 · dashboard per variant | Dashboard | | ✔ 17 Sep — one dashboard, cards by permission |
| 36 | Q30 · what "stuck" means | Dashboard | | ✔ 17 Sep — 24 h / 72 h / 24 h / immediately; editable in settings |

### A. Tabs

- **Q1.** What should the tab values be? Short keys `awaiting` / `tasks` / `mine`, which the
  code already uses, or readable ones like `awaiting-assignment` / `my-build-queue`?
  *Recommended:* the short keys.

  **Answer (17 Sep 2026): (a) short keys** — *"a"*. `/assembly?tab=awaiting`, `?tab=tasks`,
  `?tab=mine` (and `?tab=labels` if Q26 makes Barcode a tab).
- **Q2.** Does the ★ priority list get its **own tab** (for example `?tab=priority`), or do
  ★ jobs simply sort first inside the existing tabs? *Recommended:* sort first; no new tab.

  **Answer (17 Sep 2026): (a) no new tab** — *"a"*. ★ units sort to the top of **Awaiting**, and ★
  builds to the top of **My Build Queue** (and **Assembly Tasks**), in the Q20 order.

### B. Hold

- **Q3.** Do the two options need **any detail at all**, such as an optional note or a photo
  that a supervisor adds later? *Recommended:* none from the mechanic. The supervisor can add
  a note from the Assembly Tasks tab.

  **Answer (17 Sep 2026): (a)** — *"a"*. The mechanic's single tap is the whole action; nothing
  else is asked of them. On the **Assembly Tasks** tab a supervisor (`assembly.approve`) sees the
  hold option and can **add a note** to the held build.
- **Q4.** A mis-tap holds the build instantly. Is **Resume** enough as the undo?
  *Recommended:* yes.

  **Answer (17 Sep 2026): (a) Resume is the fix** — *"option a just he need to resume it"*. No undo
  bar. A mistaken hold is corrected by tapping **Resume**; the timer continues from where it froze,
  and the hold stays in the history.
- **Q5.** On 11 Sep, "damaged on arrival" was meant to **offer a vendor issue** carrying the
  unit code (`docs/assembly-audit-requirements.md:290`). Should **Issue with the cycle** offer
  that, as a supervisor action and not the mechanic's? *Recommended:* yes, from the supervisor's
  task view.

  **Answer (17 Sep 2026): (a) supervisor raises it from the held task** — *"a"*. A build on hold
  for **Issue with the cycle** shows **Raise vendor issue** on the Assembly Tasks tab (supervisor
  only). It opens a vendor issue pre-filled with the unit code, product and vendor; the supervisor
  adds the description. The mechanic's screen is unchanged. The vendor-issue grant needed to raise
  it is whatever Vendor / Ops Issues already requires.
- **Q6.** Does a hold **notify the supervisor**? *Recommended:* not in this build. Holds show on
  the Assembly Tasks tab and in the dashboard's Stuck row. *Today:* the Assembly Tasks tab does
  **not** show the hold reason at all (§5.1), so that tab must start showing it.

  **Answer (17 Sep 2026): (a) no push — held builds are listed for the supervisor** — *"what it is
  that the mecanic make a hold with the issue and it must be listed and then the supruvisor see
  that respect to the product and teh supricviosr can talk to teh mecaninc and raise teh vendor
  issue"*.
  - The mechanic's one tap puts the build on hold with its issue (R3, R4).
  - Held builds are **listed** on the Assembly Tasks tab with **unit code · product · issue (cycle
    / workfloor) · mechanic · on hold since**, so the supervisor sees each hold against its product.
  - The supervisor **talks to the mechanic** (off the app) and, for a cycle issue, taps **Raise
    vendor issue** (Q5).
  - No push notification for a hold. The dashboard's Stuck row still counts holds (§4.7).
- **Q39 (new, 17 Sep).** A build held for **Issue on the workfloor** may need another mechanic.
  *Today:* a build cannot be reassigned or cancelled (no task update route; `CANCELLED` exists
  in the enum but nothing writes it, §5.1). Is **reassign / cancel** part of this work?
  *Recommended:* no. Leave it out and raise it separately if the hold data shows it is needed.

  **Answer (17 Sep 2026): (a) not in this work** — *"a"*. No reassign or cancel. A held build is
  resumed by its mechanic after the supervisor has talked to them (Q6). Raise it as separate work
  if the hold data shows builds getting stuck. Listed in §8, Out of scope.

### C. Outward guard

- **Q31 (blocking, new, 17 Sep). Where is a short outward blocked?** R13 says the outward is
  blocked. The deliveries build decided the opposite for scheduling: *"Stock when staff schedule
  and stock is short — accept, no hold, red warning"* (deliveries requirements A26, A37), and the
  customer's own self-fill form moves a delivery to `SCHEDULED` and must never fail on stock.
  *Today:* the only refusal is at `WALK_OUT` / `DELIVERED` ("Not enough stock of X on <floor>
  … Transfer from godown first."), and `OUT_FOR_DELIVERY` has no stock check (§5.3). Options:
  (a) block at scheduling, reversing A26/A37; (b) keep scheduling open and block at the move
  out; (c) block nowhere new, warn and notify only.
  *Recommended:* (b). Scheduling stays open but the red warning now says where the stock is
  ("0 on BCH floor · 2 in godown") **and notifies the transfer owner** (R14). The hard block stays
  at `WALK_OUT` / `DELIVERED`, is **added to `OUT_FOR_DELIVERY`**, and its message names where
  the stock is. *This replaces Q8.*

  **Answer (17 Sep 2026): (b)** — *"we can go with b as ist close to teh requiremnt"*.
  - Scheduling (by staff or by the customer's form) is **not** blocked; A26/A37 stand.
  - When the floor is short, the red warning names **where the stock is** (each other location
    holding it, with quantities) and the **transfer owner is notified** (R14).
  - The **hard block** stays at `WALK_OUT` / `DELIVERED` and is **added at `OUT_FOR_DELIVERY`**
    (single and batch). Its message also names where the stock is.
- **Q7 (blocking, partly settled by the code).** *Settled:* "in the store" is now the **FLOOR
  warehouse matched from the invoice prefix** (`Warehouse.invoicePrefix`, deliveries A40–A46).
  *Still open:* what is Ibrahim's **"warehouse"** — the **GODOWN of the same store**, or a
  **separate store** (the screenshot shows "BCH TEST WAREHOUSE")? It decides the transfer:
  same store is mode `GODOWN_TO_FLOOR` (a delivery challan); another store is `STORE_TO_STORE`
  (a tax invoice) or `STORE_TO_WAREHOUSE` (§5.4). *Recommended:* "warehouse" = any location
  other than the matched floor that holds the stock; the error lists each one.

  **Answer (17 Sep 2026): the godown of the same store** — *"in this application warehouse holds
  the floore and the gowdon and where the stovck is present in this both respected to store"*.
  - A store's stock sits in its own warehouses: the **FLOOR** (the shop, "in store") and the
    **GODOWN** ("the warehouse").
  - "In store" = the FLOOR warehouse matched from the invoice prefix (already built).
  - "In the warehouse" = a **GODOWN of the same store**. The warning and the block name that
    store's godown(s) and their quantity.
  - The transfer the owner raises is **`GODOWN_TO_FLOOR`** (a delivery challan) inside that store.
  - Taken from this answer, not stated by the owner: stock held by **another store** is not
    listed and is not a source for this flow.
- **Q8. Superseded by Q31.** The premise still holds: outwards arrive from Zoho import as
  `PENDING` and an import cannot be blocked.
- **Q9. Settled by the code.** The check is already per floor warehouse
  (`StockLevel.quantity − reservedQuantity`), not product-wide (§5.3). Nothing to ask.
- **Q10 (blocking).** Should the check look at **condition** too? That is, must the floor hold
  *assembled* units, or is any quantity on the floor enough? *Today:* quantity only, and unit
  rows are unreliable (Q33). *Recommended:* quantity on the floor for now; condition only once
  the unit lifecycle (Q33) is fixed and every unit carries one.

  **Answer (17 Sep 2026): quantity only** — *"as of now we will check for only the quantity"*.
  - The outward check (warning at scheduling, block at `OUT_FOR_DELIVERY` / `WALK_OUT` /
    `DELIVERED`) counts **how many** of the model are on the floor, as today. Whether they are
    assembled is **not** checked.
  - "As of now": an assembled-only check is not part of this work. It can be raised again once
    units carry a reliable condition (Q33).
- **Q11.** A **walk-out** is also an outward. *Today:* a short walk-out is already refused
  (§5.3). Should the walk-out refusal also name where the stock is and notify the transfer
  owner? *Recommended:* yes, the same message and notification as Q31.

  **Answer (17 Sep 2026): (a) same as deliveries** — *"a"*. A short walk-out is refused (as today)
  with the message naming where the stock is ("0 on BCH floor · 2 in BCH godown. A transfer is
  needed."), and every user holding `transfers.create` gets a push.
- **Q12 (blocking).** Does the **build job start before or after the transfer approval**
  (brief Q4)? *Recommended:* after approval, so a rejected transfer does not leave a build
  queued.

  *Recommendation changed 17 Sep after Q7 and Q35:* the transfer is godown → floor **inside one
  store**, and the ★ units are already picked and reserved when the outward is starred. A
  rejection sends the transfer back to be fixed (R25); the cycle still has to be built for the same
  customer. *Recommended now:* the ★ units show on the Awaiting list **as soon as the outward is
  starred**, without waiting for the approval; the transfer itself still needs approval before it
  is dispatched.

  **Answer (17 Sep 2026): (a) the build shows at once** — *"a"*.
  - The reserved ★ units appear on the Awaiting list **the moment the outward is starred** and can
    be assigned and built straight away.
  - The godown → floor transfer is raised and approved in parallel, and **cannot be dispatched
    until approved**. A rejected transfer does not remove or pause the build.
- **Q13 (blocking).** **Stock without unit rows.** Condition lives on `InventoryUnit`, but stock
  received before units existed is only a quantity (`StockLevel`), with no unit and no
  condition. How is it counted: as unassembled, as "unknown", or through a one-time count that
  creates units? *Recommended:* show it as a third column, **"Not tracked"**, until a stock
  audit creates the units.

  **Answer (17 Sep 2026): reset, then a unit-level stock audit** — *"we can make this which has
  no unit record we will have a rest and have a stock audit at that time we can audit in the
  level of audit with unit level too"*.
  - No "Not tracked" column and no bulk guess. Stock is **reset**, then a **stock audit** is run.
  - The stock audit works **at unit level**: counting a model in a location also sets its unit
    records, including whether each cycle is assembled or unassembled.
  - After that audit every cycle in stock has a unit record, so the counts and the units start in
    sync and stay in sync (Q33, Q41).
  - How a counter records units in the audit is **Q42**. What the reset clears is **Q43**.
  - *Today:* `POST /api/stock-reset` (`stock_audit.approve`) zeroes `currentStock` on active
    products; a stock audit counts **one quantity per product** (`StockCountItem.countedQty`,
    S:997-1015), with no units.
- **Q42 (blocking, new, 17 Sep, follows Q13). How does a unit-level audit record units?**
  Options:
  (a) per model per location, the counter enters **two numbers — assembled and unassembled**;
  on approval the app creates or retires unit records to match;
  (b) the counter **scans each cycle's label**; a cycle with no label gets a new unit code and a
  printed label on the spot, and is marked assembled or unassembled;
  (c) (a) now, labels later.
  *Recommended:* (a). Two numbers per line is as simple as today's one, needs no printer on the
  floor, and Q41's automatic picking does not need a label on the cycle.

  **Answer (17 Sep 2026): (a)** — *"a"*.
  - Each audit line (model · location) records **assembled qty** and **unassembled qty**; the
    counted total is their sum.
  - On **approval**, the app creates or retires unit records so that location holds exactly that
    many assembled and unassembled units. No scanning, no labels.
- **Q43 (blocking, new, 17 Sep, follows Q13). What does the reset clear?** Options:
  (a) stock counts **and** existing unit records, so the audit is the single starting point;
  (b) stock counts only; existing unit records from inbound are kept and the audit adds or
  retires units around them.
  Also: which locations — every store at once, or one store / warehouse at a time?
  *Recommended:* (a), one store at a time. Keeping old unit records beside a fresh count is how
  duplicates appear; per store lets a store keep selling while another is counted.

  **Answer (17 Sep 2026): (a) clear counts and unit records** — *"a"*.
  - The reset clears the stock counts **and** the existing unit records for what it resets. Every
    unit record afterwards comes from the approved unit-level audit (Q42); old unit codes are not
    kept.
  - **One store or warehouse at a time** — *"a"* (17 Sep 2026). A location is reset and counted
    while the others keep selling; then the next location.
- **Q37 (new, 17 Sep). Unmatched deliveries.** A delivery whose invoice prefix matched no floor
  warehouse, or a manual pre-book, has no floor warehouse. It is a "Dummy" that allows no action
  except delete (§5.3). Should it be left out of the check, the notification and the ★ until it
  is matched? *Recommended:* yes.

  **Answer (17 Sep 2026): (a) left out until matched** — *"a"*. A Dummy (no floor warehouse) cannot
  be starred, has no stock check, sends no transfer push and needs no approval. After its prefix is
  set on a floor warehouse and it is matched, every rule in this document applies to it.

### D. Assembled vs unassembled

- **Q33 (blocking, new, 17 Sep). The unit lifecycle is not kept today.** R7, R8 and R11 count
  units, but (§5.2):
  - **nothing ever marks a unit `SOLD`**. A delivered or walked-out cycle's unit stays
    `RECEIVED` / `PUT_AWAY` and **still shows on the Awaiting list**;
  - **a transfer never moves units.** The dispatch route accepts `unitIds`, but the dispatch
    screen never sends them, so a transferred unit keeps its source warehouse;
  - stock corrections and audits never touch units.

  So unit counts drift away from stock quantities. Is fixing this (a sale marks units sold, a
  transfer moves units, a correction retires them) **part of this work**?
  *Recommended:* yes, as the first phase. Without it the assembled/unassembled page shows wrong
  numbers from the first day.

  **Answer (17 Sep 2026): (a) yes, fix it — everything must stay in sync** — *"mainly ur are
  telling that when the transfer happens it should also update the unti record ok fix this where
  allmust be synced properly"*.
  - Every action that changes a stock count also changes the unit records, in the same
    transaction:

    | Action | Stock count | Unit record |
    |---|---|---|
    | Inbound receive | + in the receiving warehouse | created, unassembled, in that warehouse (as today) |
    | Transfer dispatch / receive | − source, + destination | the moved units change warehouse; `assembledAt` is kept, so an assembled cycle stays assembled |
    | Delivery `DELIVERED` / `WALK_OUT` | − floor | that many units marked **SOLD**, off the Awaiting list |
    | Stock correction / stock audit that removes stock | − | that many units retired (e.g. LOST / DAMAGED) |
    | Stock correction / audit that adds stock | + | how units are created is Q13 |
  - The result the owner asked to see is worked through in §4.8.
  - **Which units** move or are sold, when the person does not scan them, is **Q41**.
- **Q41 (blocking, new, 17 Sep, follows Q33). Which units move or get sold?** A transfer of 6
  or a delivery of 5 must pick **which** unit records change. Options:
  (a) the person **scans or ticks** the units (unit code / barcode) at transfer dispatch and at
  handover;
  (b) the app **picks automatically** — assembled first, then oldest received — and the person can
  swap;
  (c) scan when a scanner is at hand, otherwise automatic.
  *Recommended:* (b). It needs no new habit from Giridhar or Nithin, keeps counts and units equal
  on every action, and a wrong pick is fixed by a swap, not by a stock correction.

  **Answer (17 Sep 2026): (b) the app picks automatically** — *"go with the recomendation"*.
  - At transfer dispatch, delivery handover (`DELIVERED` / `WALK_OUT`) and a stock correction or
    audit that removes stock, the app picks the units: **assembled first, then oldest received**,
    from the location the stock leaves.
  - The person **can swap** a picked unit for another in the same location.
  - Nobody is required to scan.
- **Q34 (new, 17 Sep). Which products get units?** Plan 1509 decided *"everything this
  business inbounds is a bicycle"* (D1), so inbound mints a unit for **every** received product
  (`api/inbound/[id]/route.ts:304-306`). But a shipment already carries a category —
  **Cycles / Spares / Accessories** (`InboundShipment.categoryId`) — so spares and accessories
  also get units and land on the Awaiting list. Does D1 still hold?
  *Recommended:* only a **Cycles** shipment mints units, if spares and accessories do come in
  through inbound; otherwise keep D1.

  **Partial answer (17 Sep 2026): keep D1 — every product gets units; types are separated by the
  bin rules** — *"it will be handled where in the bin rules we will have the btand and teh category
  which can hold the different type of unit products"*.
  - Inbound keeps minting a unit for every received product, cycles, spares and accessories alike.
  - Different kinds of product are kept apart by the **home-bin rules**, which route by **brand
    and category** (`HomeBinRule` S:746-763: warehouse · brand? · category? · product? → bin;
    `api/bins/home-rules`; assembly requirements R13).
  - *Still open:* a home-bin rule decides **where** a unit is put away, not **whether it needs
    assembly**. Today the Awaiting list shows every unassembled unit whatever its category, so 50
    brake cables would still show there. How the build line leaves them out is **Q44**.
- **Q44 (new, 17 Sep, follows Q34). How does the build line leave out products that are never
  assembled?** Options:
  (a) a **"needs assembly"** switch on the **category** (e.g. Cycles on; Spares, Accessories
  off), set by the admin; only units of a "needs assembly" category show on the Awaiting list and
  on the assembled vs unassembled page;
  (b) the same switch on each **product**;
  (c) no filter — every unit shows on the build line.
  *Recommended:* (a). It matches how the owner already separates products (brand and category),
  is set once per category rather than per product, and needs no code change when a category is
  added.

  **Answer (17 Sep 2026): (c) no filter** — *"all the inbound items need assembling and which
  stays as unassembled"*.
  - **Every inbound item needs assembling.** Each unit is **unassembled** from receipt until a
    build completes it, and shows on the Awaiting list and the assembled vs unassembled page like
    any other.
  - No "needs assembly" switch on category or product. D1 of plan 1509 stands as written.

### E. Doer and approver

- **Q14 (blocking).** How do **named people** and **permissions** combine? Today anyone holding
  the grant can approve (§5.5). *Recommended:* the settings pick people **from among those
  holding the grant**. Only the named approver(s) receive the push and may approve. The grant
  stays the gate, and the name narrows it.

  **Partial answer (17 Sep 2026): RBAC is the gate** — *"related to permission it must work with
  respect tp the role base accrss controle"*.
  - Approving is decided by the **role's permission** (`transfers.approve`, `inbound.approve`, …).
    A name in settings can **never** let someone approve without it — option (c) is out.
  - ~~*Still open:* whether the named approver is the **only** one who may approve (a), or only
    the one who is **notified** while every holder of the permission may still approve (b).~~

  **Answer (17 Sep 2026): roles and permissions only, no named people** — *"see those are example
  any action and oepraton must be having the aplication level rbac role ad permisison"*.
  - The people in the brief (Giridhar, Nithin, Shravan, Srinu, Ranjitha) are **examples**.
  - **No per-person "activity owners" setting.** Who does and who approves each activity is
    decided **only** by roles and permissions in **Roles & Permissions**:
    - **doer** = a user whose role holds the activity's `create` / `edit` grant;
    - **approver** = a user whose role holds the activity's `approve` grant.
  - **Notifications go by permission too:** "request approval" pushes to every user holding the
    `approve` grant (minus the person who raised it); R14's "transfer owner" = every user holding
    `transfers.create`.
  - R23 ("set in settings, never in code") is met by the admin assigning roles and grants.
  - Splitting approvals between approvers (R26) is done by giving them different roles / grants;
    the error-rate data is still recorded per approving user.
- **Q15.** **Can a doer approve their own work?** Today a transfer creator who holds
  `transfers.approve` is approved automatically, and inbound has no self-check (§5.5).
  *Recommended:* no, for all four activities, the way stock audit already works.

  **Answer (17 Sep 2026): (b) allowed — the permission decides** — *"yes if they have the
  permission of approve they can aprove"*.
  - A user whose role holds the activity's `approve` grant may approve their own record, for all
    four activities. RBAC is the only gate (consistent with Q14).
  - **Transfers:** today's automatic approval for a creator holding `transfers.approve` stays.
  - **Stock audit:** today's block on approving your own count (`stock-counts/[id]/route.ts:148-175`)
    is **removed** to match this rule.
  - Inbound and outbound follow the same rule.
  - §7 defect 4 is therefore not a defect.
- **Q16 (blocking).** **What exactly does the Outbound approver approve?** A delivery has no
  approval step. *Today (changed since 16 Sep):* `VERIFIED` can be **skipped** — staff may go
  `PENDING → SCHEDULED`, and the customer's form moves it to `SCHEDULED` with no staff step.
  Also, `deliveries.approve` **already exists** and means "match pre-bookings"
  (`api/prebookings/match/route.ts:10`). Options: approve before dispatch (`OUT_FOR_DELIVERY` /
  `SHIPPED`); approve the blocked outward's transfer only; no outbound approval.
  *Recommended:* approve **before the move out** (`OUT_FOR_DELIVERY`, `SHIPPED`, `WALK_OUT`),
  because that is the one step every outward passes through.

  **Answer (17 Sep 2026): (a) approve before it leaves by delivery or courier; walk-outs need no
  approval** — *"a"*.
  - Before `OUT_FOR_DELIVERY` (local) or `SHIPPED` (outstation), the outbound doer taps **Request
    approval**. Every user holding `deliveries.approve` (except the requester) gets a push.
  - One approver approves → the outward may go out. Reject → back to the requester (R25).
  - **`WALK_OUT` needs no approval** — the customer is at the counter.
  - The grant is the existing **`deliveries.approve`**, which today also guards pre-booking
    matching; holders of it can do both.
- **Q17.** **Inbound has no Reject today** — not even a rejected status (§5.5). Is adding Reject
  (back to the doer) part of this work? *Recommended:* yes, since R25 applies to all four.

  **Answer (17 Sep 2026): (a) add Reject, like transfers** — *"a"*. The inbound approver can
  **Reject** with a note; the shipment goes back to its creator as **returned**, is corrected, and
  is sent with **Request approval** again under the same shipment. Each reject and resubmit stays
  in its history (R26).
- **Q36 (new, 17 Sep). A rejected transfer cannot come back.** `REJECTED` is a final status for
  a transfer order (`transitions.ts:41`), so R25's "send it back" has nowhere to go. Should a
  rejected order return to its creator to **edit and resubmit** (a new "returned" status), or
  does the creator raise a **new order**? *Recommended:* return it to edit and resubmit, keeping
  the rejection note, so the approver's error record (R26) stays on one order.

  **Answer (17 Sep 2026): (a) back to the creator to fix and resend** — *"a"*.
  - Reject moves the order to a **returned** state with the rejection note, visible to its creator.
  - The creator can edit it (items, document) and tap **Request approval** again; the **same order
    number** goes back to the approvers.
  - Every reject and resubmit stays in the order's history (who, when, note) for R26.
  - Holds for all four activities where Reject exists or is added (R25).
- **Q38 (new, 17 Sep). "Upload the necessary invoices", plural.** A transfer order holds **one**
  document (`TransferOrder.docUrl`, with a replace route). Is one document enough, or must an
  order hold several? *Recommended:* several, if the transfer owner really attaches more than
  one; otherwise keep one.

  **Answer (17 Sep 2026): (a) one document, as today** — *"a"*. A transfer order keeps exactly one
  required document (tax invoice for store to store, delivery challan otherwise), replaceable but
  not added to. R15's "invoices" is read as that one document.
- **Q18.** **What counts as an approver's error** (brief Q2)? *Recommended:* an approved record
  that is later reversed, corrected by a stock correction within 7 days, or rejected at the next
  step. Record the raw events now and decide the formula later.

  **Answer (17 Sep 2026): record everything; count 1, 2 and 4 within 7 days; rule editable in
  settings** — owner asked for the best, flexible option, then *"a"*.
  - **Recorded from day one, for every approval:** approve, reject, resubmit, stock correction,
    short receive, flag / customer return, reversal — each with who, when and which record.
  - **Counted as the approver's error by default:**
    1. a **stock correction within 7 days** that fixes an approved inbound or transfer;
    2. a transfer **received short** against the approved quantity;
    4. an approval **reversed or cancelled** afterwards.
  - **Not counted by default:** 3. an outward flagged or returned by the customer (usually not
    something the approver could see). Still recorded.
  - **Flexible:** which of 1–4 count and the window in days (default 7) are **settings**
    (`settings.edit`), not code. Changing them recalculates the error rate from the stored
    history, past months included.
- **Q19.** **Which phone app** receives Approve / Reject / Open? Push exists (FCM, web and
  Android devices) but ships switched off, and notifications cannot carry action buttons today
  (§5.6). iPhone web push shows no action buttons. *Recommended:* action buttons on Android and
  desktop; **Open** is the fallback everywhere.

  **Answer (17 Sep 2026): (a) buttons where possible, Open everywhere** — *"a"*.
  - **Android and desktop browsers:** the notification carries **Approve · Reject · Open**.
    Approve acts in one tap (still re-checked by the API against the user's `approve` grant).
    Reject opens the record, because a rejection needs a note.
  - **iPhone:** no buttons (Apple web push does not allow them); tapping opens the record.
  - Push must be **switched on** in Settings › Notifications (it ships off).

### F. Priority

- **Q32 (blocking, new, 17 Sep). Delivery date and time.** R18 wants a date **and time**, and
  §3.3's example delivers "today 18:00". *Today:* a delivery stores a **day only**, picked from a
  slot calendar of **10 deliveries a day** with a **13:00 IST same-day cutoff**; the customer
  picks the day on the self-fill form, and staff may schedule **without a date** (deliveries
  A28). Options: (a) add a time; (b) keep the day only, and R9/R20 sort and show by day.
  *Recommended:* (b) for now, because a time would change the customer form and the slot rule
  the deliveries build just settled.

  ~~**First answer (17 Sep 2026): (a) day and time** — *"need time and day both"*.~~
  Reversed the same day while answering Q40.

  **Answer (17 Sep 2026, final): (b) day only, as today** — *"ok lest not use the time let the
  customer choose only what is it now"*.
  - **No delivery time.** An outward keeps the **day** only, chosen by the customer on the
    self-fill form from the existing slot calendar (10 a day, no same day after 13:00). Staff may
    still schedule with no date (deliveries A28). Nothing about the slots changes.
  - **R18 is narrowed** to "an outward records a delivery **day**".
  - The mechanic's card shows the **delivery day** (R20), and ★ jobs are ordered by day (Q20).
  - "Sort by delivery time" in R9 means sort by delivery **day**.
- **Q40 (blocking, new, 17 Sep, follows Q32). How is the delivery time entered?** *Today:* the
  customer picks a **day** on the self-fill form from the slot calendar (10 a day, no same day
  after 13:00); staff may schedule with no date. Options:
  (a) **staff** set an exact time (e.g. 17:30) when scheduling or on the detail screen; the
  customer's form stays day-only;
  (b) the **customer** picks a **time window** (e.g. 10–12, 12–2, 2–4, 4–6) on the form, and staff
  can change it;
  (c) the customer picks an exact time.
  Also: do the 10-a-day limit and the 13:00 same-day cutoff stay as they are?
  *Recommended:* (a), and the slot rules stay unchanged. It keeps the customer form as built, and
  the person marking ★ is the one who knows the rush.

  **Answer (17 Sep 2026): not needed** — the owner dropped the time (see Q32's final answer). The
  customer keeps choosing the day as today, and the slot rules stay unchanged.
- **Q35 (blocking, new, 17 Sep). How does the ★ reach the build line?** Today nothing links a
  delivery to a unit or a build job, and a stock hold is a **quantity** on the floor warehouse,
  not a unit (§5.3). For the ★ to show on a mechanic's card, the starred outward must be tied to
  specific units. Should starring pick the **oldest received, unassembled units** of that product
  in the source location, link them to the delivery and reserve them so a second outward cannot
  take them — or does the supervisor pick the units? *Recommended:* oldest received first,
  automatically, shown to the supervisor who can swap a unit. *This replaces Q22.*

  *Sharpened 17 Sep after Q7, Q33 and Q41:* the source is the **same store's godown**, and units
  are already picked automatically (assembled first, then oldest) with a swap. Options:
  (a) **starring a short outward** makes the app pick the missing units in that store's godown
  and **reserve them for that delivery**: assembled ones need only the transfer; unassembled ones
  go to the Awaiting list as **★ units showing the delivery day**, and a build assigned from them
  stays ★ on the mechanic's queue;
  (b) the star stays on the delivery only; the Awaiting list shows ★ on **any** unassembled unit of
  that model in that godown, nothing reserved, and the supervisor chooses;
  (c) the supervisor picks the units by hand from the starred outward.
  *Recommended:* (a).

  **Answer (17 Sep 2026): (a) the app picks and reserves** — *"A"*.
  - Starring an outward that is short on its floor makes the app pick the missing units in the
    **same store's godown** — assembled first, then oldest unassembled (Q41) — and **reserve them
    for that delivery**, so no other outward can take them.
  - Picked **assembled** units need only the transfer. Picked **unassembled** units show at the
    top of the Awaiting list as **★ with the delivery day**; a build assigned from them stays ★ on
    the mechanic's queue.
  - The supervisor can **swap** a picked unit for another in the same godown.
  - When the build starts relative to the transfer approval is Q12.
- **Q20.** When several jobs are starred, what is the order among them? *Recommended:* earliest
  delivery day first (Q32: there is no time).

  **Answer (17 Sep 2026): (a) earliest delivery day, then earliest starred** — *"a"*.
  - ★ jobs sort by **delivery day** (earliest first); on the same day, by **when the star was set**
    (earliest first). Unstarred jobs follow in today's order.
  - Not stated by the owner, taken from this rule: a ★ job whose delivery has **no day yet**
    (staff may schedule without one, deliveries A28) sorts **after** the dated ★ jobs.
- **Q21.** Can **only the outbound doer** set or clear the star, and can the star be cleared
  after a build has started? *Recommended:* anyone with `deliveries.edit`; clearing is allowed;
  every change is logged.

  **Partial answer (17 Sep 2026): a separate permission for the star** — *"i thibk we can have
  another permission like delevery..some relaven permisison name to action for this operation
  ,lets have saparete permission"*.
  - Setting and clearing ★ is **not** `deliveries.edit`. It is its own grant, so an admin can give
    it to some outbound staff and not others.
  - Proposed: a new catalog module **`delivery_priority`** — label *"Delivery Priority (★)"*,
    `route: null`, group Operations, action **`edit`**. This follows the `cost_price` precedent
    (`rbac-catalog.ts:479-487`): a module with no screen that exists only to be granted. It is a
    catalog change plus `npm run db:seed:rbac`, not a migration, and no role name appears in code.
    A new action key on `deliveries` was not chosen because `ActionKey` is a fixed list in code
    (`rbac-catalog.ts:10`).
  - **Removing the ★ (answered 17 Sep 2026: (a) any time)** — *"a"*:
    - allowed at any time, including after a build has started;
    - the ★ leaves the Awaiting list and the mechanic's queue; a build in progress **carries on**
      as a normal job;
    - the units reserved for that delivery are **released** and free for any outward;
    - every set and removal is logged (who, when) for R21's "how often is everything starred".
- **Q22. Superseded by Q35.**

### G. Sidebar

- **Q23 (blocking).** **Where does Stock & inventory go?** Stock management is now "exactly"
  the four steps, and Operations "only" two things, so the item list has no desktop place.
  *Recommended:* the first row inside the Stock management dropdown, above the four numbered
  steps, visually separate from them.

  **Answer (17 Sep 2026): (a)** — *"a"*. **Stock & inventory** (`/stock`) is the **first row inside
  the Stock management dropdown**, set apart by a divider from the four numbered steps. Operations
  still holds exactly two items, and the four steps keep their numbers.
- **Q24.** **Settings › Store management › Warehouse bins** is three levels. The menu allows
  only two (the RBAC seeder rejects a grandchild, `prisma/seed-rbac.ts:48-53`), and the catalog
  itself says `store_management` must stay a root (`prisma/rbac-catalog.ts:784-787`).
  *Recommended:* make **Store management** a child of Settings, and put Stores and Warehouse
  bins as tabs on one Store management screen.

  **Answer (17 Sep 2026): (a) Store management inside Settings, one screen with tabs** — *"a"*.
  - Sidebar: **Admin › Settings › Store management** (a child of `settings`). Store Management is
    no longer its own Admin root, and **Warehouse Bins** leaves Stock management.
  - One screen with tabs **Stores · Warehouses · Bins**, each tab shown only to users holding that
    tab's `view` grant (R2's fall-back rule applies to its `?tab=`).
  - Build note, not a question: a child of `settings` cannot have children
    (`seed-rbac.ts:48-53`), so `stores`, `warehouses` and `bins` stop being menu children. Their
    **module keys must be kept** (as route-less modules, like `cost_price`) — deleting or renaming
    a key deletes its permissions and every role's grant on it (§5.7).
- **Q25.** **Where does Second-Hand Cycles go** (brief Q3)? *Recommended:* Sales.

  **Answer (17 Sep 2026): (a) Sales** — *"a"*. **Sales** holds Customers · Customer complaints ·
  **Second-Hand Cycles**. The `second_hand` module moves group; its key and grants stay.
- **Q26.** **Barcode & labels "inside Build line assembly"**: as a child menu item under Build
  line assembly, or as a tab `/assembly?tab=labels`? *Recommended:* the tab, which also uses R1.

  **Answer (17 Sep 2026): (a) a tab** — *"a"*. `/assembly?tab=labels` sits beside Awaiting · Tasks ·
  My Build Queue, shown only to users holding `barcode.view`. Barcode & Labels leaves the sidebar
  (its `barcode` module key and grants stay; `/scanner` keeps working for old links).
- **Q27.** When **Stock management** only expands, does `/stock-management` (the card hub page)
  go away? Note that anyone who pinned it to the bottom bar loses that pin, and `/categories`
  links back to it. *Recommended:* keep the route for old links, and remove it from the menu.

  **Answer (17 Sep 2026): (a) off the menu, page kept** — *"a"*.
  - Clicking **Stock management** only expands the dropdown; the label is no longer a link.
  - `/stock-management` stays reachable by URL for old bookmarks.
  - The Categories page back link (`categories/page.tsx:293`) points to Stock & inventory (`/stock`).
  - A bottom-bar pin on `/stock-management` drops; the admin re-pins Stock & inventory for that user.
- **Q28.** The mobile bottom bar is **per user** (each user's pinned tabs, set by an admin), and
  a user with no pins has **no bar at all** — there are no default tabs (§5.7). Is R34 met by
  pinning Stock & inventory for the floor staff, or must it be forced for everyone?
  *Recommended:* pin it per user; no code.

  **Answer (17 Sep 2026): (a) pin per user** — *"a"*. R34 is met by the admin pinning **Stock &
  inventory** in each floor-staff user's bottom tabs (Team › user). No forced tab, no default for
  new users, no code.

### H. Dashboard

- **Q29.** Does the shortlist in §4.7 go on **every** dashboard variant, or only the Admin one?
  Today six variants are chosen by permission (§5.7). *Recommended:* Admin gets all of it;
  others get only the rows their grants allow.

  **Answer (17 Sep 2026): (a) one dashboard, cards gated by permission** — *"a"*.
  - The six fixed variants (`pickDashboard`, `page.tsx:955-962`) are replaced by **one** dashboard.
  - Every card is shown only if the viewer's role holds that card's grant (e.g. money cards need
    `accounts.view`; build cards need `assembly.view` or `assembly.approve`), and the API behind it
    re-checks the same grant. A new role sees the right cards with no code change.
  - Which grant guards each card is settled in the plan, card by card, from the existing API
    guards (§5.7). Stock value today needs `reorder.view`, which does not fit (§6).
- **Q30.** **What is "stuck"?** §4.7 proposes thresholds (approvals > 24 h, inbound > 72 h).
  *Today:* `/api/health/summary` has inbound and delivery pending at 24 / 48 / 72 h and POs
  without tracking at 48 h, but **no approvals-waiting threshold**. Accept those, or set others?
  *Recommended:* accept.

  **Answer (17 Sep 2026): (a) these numbers, editable in settings** — *"a"*.
  - **Approvals waiting** (inbound, outward, transfer, audit): stuck after **24 h**.
  - **Inbound pending** (not fully received): stuck **72 h** after creation.
  - **Builds on hold**: stuck after **24 h** on hold.
  - **Short outwards**: stuck **from the moment** an outward is scheduled while its floor is short.
  - The hour values are **settings** (`settings.edit`), not code.

---

## 3. Decisions already taken

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
- **D5. Decisions from the deliveries build stand unless a question here reverses them**
  (deliveries requirements A1–A46, merged 16 Sep). In particular: an outward reduces the matched
  **FLOOR** warehouse only, never a godown (A40); a stock hold is counted on that floor (A46);
  scheduling never fails on a shortage (A26, A37) — Q31 asks whether R13 changes that.

---

## 4. Action flows

### 4.1 `/assembly` tabs in the URL (R1–R2)

| Address | Screen | Who sees it today |
|---|---|---|
| `/assembly?tab=awaiting` | Awaiting Assignment: unassembled units, multi-select, filter, sort (R9) | `assembly.approve` |
| `/assembly?tab=tasks` | Assembly Tasks: every task, filtered by status and mechanic | `assembly.approve` |
| `/assembly?tab=mine` | My Build Queue: my assigned builds, ★ first (R20), with Start / Hold / Complete | `assembly.edit` |
| `/assembly?tab=labels` | Barcode & labels (Q26) | `barcode.view` |

1. The user opens `/assembly` with no `tab`. The landing rule that exists today still applies:
   a supervisor with no active build lands on `awaiting`, everyone else on `mine`. The address
   is rewritten to show the chosen tab.
2. The user taps a tab. The screen switches and the address becomes `?tab=<key>`, replacing
   the history entry rather than adding one.
3. A mechanic opens `/assembly?tab=awaiting` from a shared link. They lack `assembly.approve`,
   so they land on `mine` and the address is corrected.

### 4.2 Hold a build (R3–R6)

1. Ravi has started `U-000481`. The timer reads 00:14:32.
2. The left pedal is missing, so Ravi taps **Hold**.
3. A sheet opens with two large boxes: **⚠ ISSUE WITH THE CYCLE** and **⚒ ISSUE ON THE
   WORKFLOOR**.
4. Ravi taps **ISSUE WITH THE CYCLE**. The sheet closes at once and the task is **On Hold**,
   with the timer frozen at 00:14:32. Nothing else is pressed.
5. The supervisor's Assembly Tasks tab shows `U-000481 · On hold · Issue with the cycle`.
   (*Today* that tab shows no reason — Q6.)
6. The pedal arrives. Ravi taps **Resume** and the timer continues from 00:14:32.

A mis-tap is corrected by tapping **Resume**. There is no undo step, because an undo would be
the confirm step the owner ruled out (Q4).

### 4.3 Outward from the warehouse, with priority (R12–R21)

The flow below is the **target**. Steps marked ⟨Qn⟩ wait on that question; §5.3 has what the
deliveries build does today.

1. **Nithin (outbound)** opens outward `INV-BCH-0931` for 2 × Hero Sprint 29, matched to the
   BCH floor warehouse. The customer has picked **today** on the self-fill form (Q32: day only, no time). He marks it
   **★ priority**.
2. **App.** It checks the BCH **floor** warehouse (D5). The floor holds 0; the godown holds
   2 (Q7: the same store's godown; Q10: quantity only, so condition is not checked).
3. **App.** Scheduling is accepted without a hold ⟨Q31⟩ and the warning reads: "Hero Sprint 29:
   0 on BCH floor · 2 in godown (unassembled). A transfer is needed." At the same moment
   **Giridhar (transfer owner)** is notified (R14).
4. **Giridhar** creates a transfer order, godown → BCH floor, for the 2 units. He attaches
   the delivery challan (Q38: one document) and taps **Request approval** (R15).
5. **Shravan (transfer approver)** gets a push: "Giridhar requested a transfer order:
   godown → BCH floor · challan attached", with **Approve / Reject / Open** (R24). He taps
   **Approve**. Had he tapped Reject, the order would go back to Giridhar (R25, ⟨Q36⟩).
6. **Warehouse build line.** Two build jobs appear **★ first** on the build list, for the two
   units picked and reserved when the outward was starred (Q35), showing "deliver today" (R16,
   R20; day only, Q32). They appear at step 1, not after step 5 (Q12).
7. The mechanic builds both. The units become **assembled** (R7).
8. **Giridhar** dispatches the transfer and the floor receives it; the units move with it
   ⟨Q33⟩. The floor now holds 2 assembled (R17).
9. **Nithin** reserves the stock and sends the outward out. Had he tried before step 8, the move
   to Out for delivery / Delivered would have been **blocked** with the same "where it is"
   message ⟨Q31⟩.

### 4.4 Doer and approver per activity (R22–R26)

| Activity | Doer (brief §5) | Approver (brief §5) | What the approver approves |
|---|---|---|---|
| Inbound | Nithin | Shravan / Srinu | the shipment before receiving, as today (`inbound.approve`); Reject is new (Q17) |
| Outbound | Nithin | Shravan / Srinu | before Out for delivery / Shipped; walk-outs not approved (Q16) — new |
| Stock transfer | Giridhar | Shravan | the transfer order, as today (`transfers.approve`); resubmit is new (Q36) |
| Stock audit | Ranjitha? (brief Q1) | Shravan / Srinu | the count, as today (`stock_audit.approve`) |

The names above are the brief's **examples**. In the app, doer and approver are **roles and
permissions only** (Q14): no screen names a person against an activity.

1. An admin opens **Roles & Permissions** and gives a role the activity's `create` / `edit` grant
   (doers) or its `approve` grant (approvers), then gives users those roles.
2. A doer finishes their part and taps **Request approval**. The record goes to *Awaiting
   approval* and every user holding the `approve` grant (except the doer) gets a push.
3. One approver acts. The record moves on, and the other approvers' notifications are
   resolved.
4. Every approval and rejection records who, when, and what was decided, so an error rate can
   be computed later (R26, Q18).

### 4.5 Assembled vs unassembled page (R7–R11)

| Model · location | Assembled | Unassembled | Total |
|---|---|---|---|
| Hero Sprint 29 · BCH floor | 4 | 0 | 4 |
| Hero Sprint 29 · BCH godown | 20 | 80 | 100 |

No "Not tracked" column (Q13): after the reset and the unit-level audit, every cycle has a unit.

- A number in **Unassembled** links to the build line's Awaiting tab, filtered to that model
  and location.
- A number in **Assembled** links to Stock & inventory, filtered the same way.
- The numbers are only right once units follow sales and transfers (Q33).

### 4.6 Sidebar after the change (R27–R34)

```
Overview        Dashboard · Activity Log
Operations      ▲ Build line assembly            (Barcode & labels = its Labels tab — Q26)
                ▾ Stock management               (click = expand only)
                    Stock & inventory            (Q23; Categories · Brands as chips inside)
                    ─────────────────
                    1 Inbound
                    2 Outbound (delivery & dispatch)
                    3 Stock transfer
                    4 Stock audit
Sales  (new)    Customers · Customer complaints · Second-Hand Cycles (Q25)
Purchase        Vendors · Purchase Orders · Vendor / Ops Issues          (unchanged)
Accounts        Accounts · Expenses · POS & settlement
Insights        Reports · Store Analytics                                (unchanged)
Admin           Team Management · Roles & Permissions · Settings › Store management (tabs: Stores · Warehouses · Bins — Q24)
Service, Staff LMS                                                       (unchanged)

Chips inside Stock & inventory: Categories · Brands
```

Categories and Brands are linked from **no page** today (§5.7). The chips must ship in the same
change that takes them out of the menu, or both pages become reachable only by typing the URL.

### 4.7 Main dashboard (R35–R37)

This is Chethan's proposed shortlist, for Ibrahim to accept or cut (Q29, Q30). Each card
links to the screen that holds the detail.

| Row | Card | Meaning |
|---|---|---|
| Money | Payables · Receivables · Overdue bills · Stock value | as `/api/accounts/summary` and the stock-value query compute them today |
| Stuck | Outwards short on the floor (stock elsewhere) · Approvals waiting > 24 h · Builds on hold (cycle / workfloor) · Inbound pending > 72 h | something needs a person |
| In progress | ★ builds open · Builds in progress · Transfers in transit · Audits in progress | moving, nobody needs to act |
| Done (today) | Outwards delivered · Builds completed · Transfers received · Inbound received | today's output |
| Stock by condition | Unassembled units · Assembled units · Oldest unassembled (days) | the R11 page in three numbers |

*Today* none of these exist team-wide: builds on hold (only the viewer's own), transfers in
transit (the "In Transit" card counts **inbound** shipments), audits in progress (§5.7).

### 4.8 Stock count and unit records in sync (Q33)

The same five days, before and after the fix. Unit picks follow Q41 (answered: automatic,
assembled first then oldest, person can swap).

| Day · who · action | Count after | Units **today** | Units **after the fix** |
|---|---|---|---|
| 1 · Nithin receives 10 × Hero Sprint 29 into BCH godown | godown 10 | 10 unassembled in godown ✅ | 10 unassembled in godown ✅ |
| 2 · Ravi builds 3 in the godown | godown 10 | 3 assembled, 7 unassembled, in godown ✅ | same ✅ |
| 3 · Giridhar transfers 6 godown → floor | godown 4, floor 6 | **all 10 still in godown** ❌ | the 3 assembled + 3 oldest unassembled move to floor; 4 unassembled stay in godown ✅ |
| 4 · Nithin delivers 5 from the floor | floor 1 | **5 still "in godown", still on Awaiting** ❌ | 3 assembled + 2 unassembled on the floor marked **SOLD**, off every list ✅ |
| 5 · Shravan's audit finds 1 missing in the godown | godown 3 | **unit still there** ❌ | 1 godown unit marked **LOST** ✅ |

**Day 5 result on each screen:**

| Screen | Today | After the fix |
|---|---|---|
| Stock & inventory (count) | godown 3 · floor 1 | godown 3 · floor 1 |
| Assembled vs unassembled page (R11) | godown **7 unassembled + 3 assembled = 10**, floor 0 — wrong | godown **3 unassembled** · floor **1 unassembled** — matches the count |
| Build line Awaiting list | **7** rows (incl. sold and lost cycles) | **4** rows: the 3 in the godown and the 1 on the floor |
| Supervisor assigns a unit | may point at a cycle a customer already has | always a cycle that is physically there |

---

## 5. Facts verified against the code (17 Sep 2026, `main` = `861a237`)

Paths are relative to the repo root. `P` = `src/app/(dashboard)/assembly/page.tsx`,
`S` = `prisma/schema.prisma`, `DR` = `src/app/api/deliveries/[id]/route.ts`,
`FS` = `src/lib/deliveries/floor-stock.ts`.

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
  - No activity log is written — nor by start (:33-48) or complete (:50-107).
- **Schema:** `AssemblyTask` S:825-854. `holdStartedAt` S:841, `totalHoldSeconds` S:842,
  `holdReason String?` S:843 (free text, not an enum). `AssemblyLog` S:2778-2791 has no hold
  fields. Do not confuse with `ServiceJob.holdReason` (S:2712), a different model.
- **Existing hold data:** no seed writes `holdReason`; its only reader is P:862. No report,
  dashboard or export uses it, so replacing the free text with two fixed options orphans nothing.
- **Timer:** computed on the client as `(now − startedAt) − totalHoldSeconds`, only while
  `IN_PROGRESS` (P:282-305).
- **Who sees a hold reason:** only the viewer's own active card (P:856-866). The Assembly Tasks
  tab shows the status badge and "Nm hold" from `totalHoldSeconds`, **not the reason**
  (P:744-793).
- **Assignment:**
  - The assignee is `assignedToId`, required (S:834-835). A supervisor can start, hold or
    complete anyone's task (hold :26-29); complete still credits the assignee (complete :70, :97).
  - **No reassign or cancel.** There is no `tasks/[id]/route.ts`; POST refuses a unit that already
    has an open task (tasks route :218-227). `CANCELLED` is in the enum but nothing writes it.
  - The mechanic picker lists all active users, not `assembly.edit` holders (tasks route :120-126).
- **Awaiting list:**
  - `PENDING_PAGE_SIZE = 50` with `skip`/`take`, ordered by `unitCode` (`src/app/api/assembly/tasks/route.ts:17, 113-115`).
  - A **Load more** button fetches the rest (P:664-677). Units beyond the page cannot be selected
    until loaded.
  - Filter: `assembledAt: null`, status `RECEIVED`/`PUT_AWAY`, and no open task (route :57-61).
    **Any warehouse, floor and godown alike**; an optional `?warehouseId` exists but the page never
    sends it (P:216, P:255).
  - Server search `?q=` (:62-75). Each row has its own Assign button (P:651-658).
  - No multi-select, filter or sort.
- **"50% · Box build"** is the assembly level `A50` (`src/lib/assembly-level.ts:23-32`), taken
  from `Product.assemblyLevel` (S:588). It is not a progress figure; this answers brief Q8.
- **No priority anywhere on assembly.** `AssemblyTask` has no priority field. The only mention is
  placeholder text in the Assign notes box (P:1245).

### 5.2 Units, condition and locations

- **`InventoryUnit`** (S:765-803) has `unitCode` (`U-000481`), a required `warehouseId`, an
  optional `binId`, `status UnitStatus`, and `assembledById` / `assembledAt` / `assemblyLevel`
  (S:780-783). It has no store column.
- **`UnitStatus`** (S:805-817): RECEIVED, PUT_AWAY, ASSIGNED, IN_ASSEMBLY, ASSEMBLED, RESERVED,
  SOLD, RETURNED, DAMAGED, TRANSFERRED, LOST.
  - Assign sets ASSIGNED (tasks route :314-320).
  - Start sets IN_ASSEMBLY (`start/route.ts:42-45`).
  - Complete sets ASSEMBLED, `assembledAt` and `assemblyLevel` (`complete/route.ts:66-75`).
- **Units are created in one place only:** inbound receive, `src/app/api/inbound/[id]/route.ts`
  PUT, :304-324 — one unit per received quantity, **for every product** ("Everything this
  business inbounds is a bicycle", :306). `InboundShipment.categoryId` (Cycles / Spares /
  Accessories, S:2246-2255) is not consulted. There is no `isSerialized` / `requiresAssembly`
  flag; `Product.assemblyLevel` null means "not decided yet", not "no assembly" (S:584-588).
- **Nothing ever sets a unit to `SOLD`, `LOST` or `DAMAGED`.** Delivery, stock-count and
  stock-correction code never writes `inventoryUnit`. `RESERVED` is unused by deliveries. A sold
  cycle's unit stays `RECEIVED` / `PUT_AWAY` and still matches the Awaiting filter (Q33).
  `InventoryUnit.saleInvoiceNo` is free text written only by `api/inventory/outwards/route.ts:134`.
- **A transfer does not move units in practice.** Units reach a transfer only if the dispatch
  body carries `unitIds` (`transfer-orders/[id]/dispatch/route.ts:21, :177-196`), and no screen
  sends them. `TransferOrderUnit` rows (S:887) are therefore never created, and the receive code
  that would move them (`receive/route.ts:194-213`) never runs. Were it to run, it resets status
  to `PUT_AWAY` and keeps `assembledAt` — so **condition must be read from `assembledAt`, not
  from `status`.**
- **Store vs warehouse:**
  - A `Store` (S:243) is a site and holds no stock itself.
  - A `Warehouse` (S:309) belongs to a store. Its `kind` is FLOOR (the shop) or GODOWN (storage)
    (`WarehouseKind` S:301-304). New since 16 Sep: `invoicePrefix @unique` and `isPrimary` on the
    warehouse (S:322-333); `Store.invoicePrefix` (S:262) is no longer read.
  - `StockLevel` (S:633) holds one quantity **and a `reservedQuantity`** (S:642) per product per
    warehouse. `Product.currentStock` / `reservedStock` (S:571-572) are cached totals.
  - A store's stock is the sum of its warehouses (`getStoreQtyMap`, `src/lib/stock-location.ts:338`).
- **A quantity has no condition.** `StockLevel` and `BinStock` (S:732) store a number only.
  Condition exists only where a unit row exists (Q13).

### 5.3 Outward (deliveries) — changed by plan 1609, merged 16 Sep

- **Created from Zoho** as `PENDING`. The invoice prefix is matched to a **FLOOR warehouse**
  (`Warehouse.invoicePrefix`), and `storeId` is derived from it:
  - `src/app/api/deliveries/import-zoho/route.ts:98-112`
  - `src/app/api/zoho/pull-review/approve/route.ts:621-655`
  - `src/lib/deliveries/zoho-invoice.ts:30-48`
- **Unmatched = "Dummy".** No prefix match → `warehouseId` and `storeId` null. A Dummy takes no
  action except delete (DR:174-179, `FS:227-229` `isDummy`, reserve route :47-52,
  `batch/route.ts:69-78`).
- **Other ways a delivery is created:**
  - Manual pre-book, `PREBOOKED`, with no store and no warehouse (`src/app/api/deliveries/route.ts:132-145`)
    — so it is a Dummy and even `PREBOOKED → VERIFIED` is refused.
  - Automatically from a received pre-booked inbound line, on the receiving store's primary floor
    warehouse, or a Dummy if there is none (`src/app/api/inbound/[id]/route.ts:350-379`,
    `src/lib/warehouses.ts:116-128`).
- **Stock hold, per floor warehouse.** On `SCHEDULED` / `PACKED`, `holdDeliveryStock` holds the
  whole delivery against `StockLevel.quantity − reservedQuantity` of the matched floor, all or
  nothing, and writes `Delivery.stockReservedAt` (DR:313-328, FS:86-116). **It never refuses:**
  a short hold is accepted and the short lines go back to the screen as a red warning
  (deliveries A26, A37). The customer's self-fill form moves the delivery to `SCHEDULED` the same
  way (`api/public/delivery/[token]/route.ts:221, 240`). A "Reserve stock now" route exists
  (`api/deliveries/[id]/reserve/route.ts`); a received transfer does not hold stock by itself.
- **Handover refuses a short floor.** On `DELIVERED` / `WALK_OUT`, `deductDeliveryFromFloor`
  reduces the matched floor **only**, respecting other deliveries' holds, and refuses with "Not
  enough stock of X on <floor> (has N, needs M). Transfer from godown first." (DR:330-355,
  FS:176-193). The message does not say where the stock is, and nobody is notified.
  **`OUT_FOR_DELIVERY` has no stock check**, single or batch.
- `deductFromStore` (floor, then godown, `src/lib/stock-location.ts:106-161`) is no longer used by
  deliveries; only `api/inventory/outwards/route.ts:98` and `api/stock-counts/[id]/route.ts:439`
  still call it.
- **Status flow** (`DeliveryStatus` S:1836-1848; no IN_PROGRESS). Allowed moves (DR:201-213):
  - PENDING → VERIFIED / WALK_OUT / SCHEDULED / FLAGGED / PREBOOKED
  - VERIFIED → WALK_OUT / SCHEDULED / PACKED
  - SCHEDULED → OUT_FOR_DELIVERY / VERIFIED / PACKED / DELIVERED
  - PACKED → SHIPPED / VERIFIED; SHIPPED → IN_TRANSIT; IN_TRANSIT and OUT_FOR_DELIVERY → DELIVERED
  - FLAGGED → PENDING; PREBOOKED → VERIFIED
  - Schedule and Walk-out need a saved customer (DR:219-223).
- **Walk-out** is allowed only from PENDING / VERIFIED and refuses a short floor
  (`deliveries/[id]/walkout/page.tsx`, DR:330-355).
- **Delivery columns** (`Delivery` S:1850):
  - `warehouseId` (the place of supply, S:1879), `customerId` (S:1894), `scheduledDate DateTime?`
    (S:1902), `stockReservedAt` (S:1905), `expectedReadyDate` (S:1907), `deliveryZone` (S:1937),
    `zohoPaymentStatus` / `zohoBalance` (S:1887-1888).
  - **No priority field.** (`priority` fields in the schema belong to other models.)
  - **A day, not a time.** `scheduledDate` is saved as the start of the IST day
    (DR:244-264, `src/lib/deliveries/slots.ts:36-38`). The slot calendar allows 10 deliveries a
    day (`MAX_SLOTS_PER_DAY`, slots.ts:14) and refuses the same day after 13:00 IST
    (`CUTOFF_HOUR_IST`, :15). Staff may schedule with no date (deliveries A28).
- **No link from Delivery to a unit or a build.** Delivery code never touches `InventoryUnit` or
  `AssemblyTask`.

### 5.4 Transfer orders

- **Status** (`TransferOrderStatus` S:2076-2083): PENDING → APPROVED / REJECTED / CANCELLED;
  APPROVED → IN_TRANSIT / CANCELLED; IN_TRANSIT → RECEIVED. **REJECTED is final**
  (`src/lib/transfers/transitions.ts:27-43`, :41).
- **Modes** (`TransferMode` S:2102-2106): STORE_TO_STORE, STORE_TO_WAREHOUSE, GODOWN_TO_FLOOR. A
  STORE_TO_STORE transfer is a TAX_INVOICE; the others are a DELIVERY_CHALLAN
  (`src/lib/transfers/mode.ts:21-23`). A godown → floor move inside one store is GODOWN_TO_FLOOR
  (`transfer-orders/route.ts:239-255`); STORE_TO_* modes always use the source store's FLOOR
  (mode.ts:40-51).
- **Items carry product and quantity only** (`TransferOrderItem` S:2192). Unit ids live in
  `TransferOrderUnit` (S:887) and are never written (§5.2).
- **Create** (`transfers.create`, `src/app/api/transfer-orders/route.ts:225`):
  - **one** document (`docUrl`, S:2158) is required (:60-63, :310-325), and source stock is
    checked (:348-359). A replace route exists at `transfer-orders/[id]/document`.
  - **Creating the order is the request.** There is no draft and no "Request approval" step.
  - **A creator holding `transfers.approve` is approved automatically** (:372-388).
- **Approve / reject** (`transfers.approve`, `approve/route.ts:46`) writes `reviewedById` /
  `reviewedAt`, and records `rejectionNote` on a reject (:85-93, :154-162).

### 5.5 Approvals today

| Activity | Approve route · grant | Reject? | Self-approval blocked? | Named approver? |
|---|---|---|---|---|
| Inbound | `inbound/[id]/approve` · `inbound.approve` (:18) | **no** — no rejected status either; `InboundShipmentStatus` is IN_TRANSIT / DELIVERED / PARTIALLY_DELIVERED (S:2229-2233), approval is `approvedAt` / `approvedById` | **no** — the route checks only `approvedAt` (:21-54) | no, anyone with the grant |
| Outbound | **none.** `VERIFIED` is a status change under `deliveries.edit` that stamps `verifiedById` (DR:293-296), and it can be skipped | no | n/a | no |
| Transfer | `transfer-orders/[id]/approve` · `transfers.approve` | yes, but final (no resubmit) | **no, it is automatic** | no |
| Stock audit | `stock-counts/[id]` · `stock_audit.approve` | yes | **yes** (`stock-counts/[id]/route.ts:148-175`) | no; the assignee is named (`assignedToId`) |

No "activity → person" setting exists. `AppSetting` is a generic key/value table (S:2514-2518).

### 5.6 Push notifications

- **FCM only.** `NotificationConfig` (S:1521) and `PushDevice` for WEB or ANDROID (S:1586-1598).
- **Off by default.** The master switch ships off
  (`docs/implementation/pending/notifications-and-settings-rbac-plan.md:64`) and is checked in
  `src/lib/notify/index.ts:81-93`. Email is hard-coded off (:95).
- **Helper:** `notify(eventKey, { recipients, title, body, link, data })`
  (`src/lib/notify/index.ts:55`). It takes user ids, so a single named person can be targeted.
- **Only five events** are registered (`src/lib/notify/events.ts:27-53`): `stock.below_reorder`,
  `service.job_ready`, `inbound.delivered`, `zoho.pull_started`, `zoho.pull_finished`. None for
  transfers, deliveries or audits.
- **No action buttons.** The payload is title, body, link and data (`src/lib/notify/types.ts:107-112`).
  The service worker passes no `actions` (`public/sw.js:73-78`), and a click opens `data.link`
  (:87-115).
- **The person who triggered an event is removed by the caller, not by `notify()`**
  (types.ts:21-25; e.g. `src/lib/inbound/complete-shipment.ts:145`). `usersWithPermission`
  (`src/lib/rbac.ts:271-293`) has no exclude parameter. `docs/notifications-guide.md:61` states
  the rule.

### 5.7 Sidebar and dashboard

- **The menu is data.** `Module` has `route`, `group`, `sortOrder` and `parentId` (S:23-68).
  - The rows are seeded from `prisma/rbac-catalog.ts` by `prisma/seed-rbac.ts`, which allows
    **two levels at most** (grandchild check :48-53) and requires a child's group to equal its
    parent's (:57-62).
  - Modules are **upserted by key**; both update and create set route, group, sortOrder and
    parentId (:73-134). A moved module is updated in place and **its grants survive** (Permission
    is keyed by `moduleId_action`, :165-168). Renaming a key deletes the module and its grants.
  - `group` is a free string; there is no group constant (`MODULE_GROUPS` was removed,
    catalog :61-63). **A Sales group is catalog data plus a re-seed.** A group appears where its
    first item's `sortOrder` puts it, and later items join it by title (`app-sidebar.tsx:161-164`).
  - Modules with `route: null` are hidden, **except** a parent with routed children, which shows
    as plain text plus a chevron (`app-sidebar.tsx:157, 311-321`). **Moving an item is a catalog
    change plus `npm run db:seed:rbac`, not a migration** (CLAUDE.md, migrations rule 11).
- **Sidebar component:** `src/components/app-sidebar.tsx`. A parent's label is a `<Link>` to the
  parent route (:303-310) and its chevron toggles open/closed (:324-340). R28's "expand only"
  changes this component. A child carries its parent's display fields even when the parent is not
  granted (`src/stores/permissions.ts:37-44`, sidebar :103-117).
- **The menu today** (`rbac-catalog.ts`):
  - **Operations:** Stock Management `/stock-management` (100) with Stock & Inventory 101,
    Categories 103, Stock Audit 104, Inbound 105, Deliveries & Dispatch 106, Stock Transfers 107,
    Warehouse Bins 108 and Brands `/more/brands` 108 (a tie, broken by label); then Second-Hand
    Cycles 150, Barcode & Labels `/scanner` 160, POS & Settlement `/accounts/settlement` 170,
    Build-Line Assembly 180, Customer Complaints 185.
  - **Purchase:** Vendors 200, Purchase Orders 210, Vendor Issues 230, Reorder 240 (no route;
    `/reorder` redirects to `/purchase-orders?tab=reorder`).
  - **Accounts:** Accounts 290, Expenses 310, Customers 320 (plus route-less modules).
  - **Admin:** Team Management 500, Roles & Permissions 510, Settings 520 (route-less children),
    and **Store Management** 540 as its own root with Stores `/stores` 541.
  - **There is no Sales group.** **Outbound is one module**, `deliveries` → `/deliveries`; the
    pages `/deliveries/blr`, `/outstation`, `/walkout`, `/dispatch`, `/prebook` are not modules.
- **Settings index** is a hardcoded list (`src/app/(dashboard)/settings/page.tsx:27-84`) and
  already contains "Bins & Locations" (`/more/bins`), which only redirects to `/bins` and is gated
  on `settings.view`, not `bins.view` (:68).
- **Mobile bottom bar:** Home + up to 4 **per-user pinned** routes (`User.navTabs`, S:408) + More
  (`src/components/bottom-nav.tsx:20-36`, `src/lib/nav-tabs.ts`). Any granted module with a route
  can be pinned, children included. **There are no default tabs; an empty list means no bar**
  (`use-bottom-nav.ts:34-37, 77`). The schema comment "empty = role default" is out of date.
- **`/stock`** has quick-filter chips (All, In Stock, No Stock, Low Stock, Needs details,
  Inactive) (`src/app/(dashboard)/stock/page.tsx:68-79`) and loads brands and categories for its
  dropdown filters (:259-261, :548-577). It has no Categories or Brands chips.
- **Brands and Categories pages** (`/more/brands`, `/categories`) are linked from **no page**;
  only the menu reaches them. `/categories` links back to `/stock-management` (:293).
- **Main dashboard** `/`: `src/app/(dashboard)/page.tsx`. `pickDashboard` (:955-962) checks, in
  order:
  1. **Admin** (`team.view` and `reports.view`) — alerts, Payable / Receivable / Stock Value /
     Overdue, Low Stock / Inbound In Transit / Ops Issues, inwards and outwards today, overdue
     bills (:235-474).
  2. **Supervisor** (`stock_audit.approve` or `transfers.approve`) — Payable, a Receivable from
     PENDING customer invoices capped at 500 (:498), Overdue, Open Issues, inwards / outwards.
  3. **Purchase Manager** (`purchase_orders.view`) — Low Stock, Total Products, Inwards Today,
     Pending POs hardcoded "—" (:894), though `/api/accounts/summary` already computes
     `pendingPOs` (:51, :82).
  4. **Accounts Manager** (`bills.view` or `expenses.view`) — Ops Issues, Pending Audits, Expenses
     30 days.
  5. **Outwards Clerk** (`deliveries.view`) — dispatch and delivery counts.
  6. **Clerk** (fallback).

  MyStockAudits and MyAssemblyTasks sit above every variant (:975-976). **Nothing counts builds on
  hold team-wide, transfers in transit, or audits in progress.**
- **Money numbers:**
  - Payables, receivables and overdue: `src/app/api/accounts/summary/route.ts:38-71`
    (`accounts.view`, :13).
  - Stock value is computed three times: `api/dashboard/stats/route.ts:31` (**gated by
    `reorder.view`**, :10), `api/stock/summary/route.ts:33-49` (unused) and
    `api/reports/stock-value/route.ts`.
- **"Stuck" style counts:** `src/app/api/health/summary/route.ts:22-68, 124-158` reports inbound
  and delivery pending at 24 / 48 / 72 h and POs without tracking over 48 h. It has no approvals
  threshold. `src/app/api/ops-stats/route.ts:11` is a stub returning zeros, called by nothing.

---

## 6. Permission map (data, never code)

| Action | Grant | New? |
|---|---|---|
| Open `/assembly?tab=awaiting` / `tasks`, multi-assign | `assembly.approve` | existing |
| Open `/assembly?tab=mine`, start, hold (two options), resume, complete | `assembly.edit` | existing |
| Open `/assembly?tab=labels` (Q26) | `barcode.view` | existing |
| See the assembled vs unassembled page | `stock.view` | existing module, new page |
| Mark / clear ★ priority (Q21) | `delivery_priority.edit` | **new module** (route null, like `cost_price`) |
| Set delivery date | `deliveries.edit` | existing |
| Approve / reject an outward before Out for delivery / Shipped (Q16) | `deliveries.approve` | existing action, reused (it also guards pre-booking matching, `api/prebookings/match/route.ts:10`) |
| Reject an inbound (Q17) | `inbound.approve` | existing |
| Resubmit a rejected transfer (Q36) | `transfers.create` | existing |
| Make a user a doer or an approver of an activity (Q14) | `roles.edit` — give the role the activity grant | existing |
| Choose which events count as an approver error, and the window in days (Q18) | `settings.edit` | existing |
| Change the dashboard "stuck" hours (Q30) | `settings.edit` | existing |
| See dashboard money cards | `accounts.view` | existing |
| See dashboard stock value | `reorder.view` **today** (`api/dashboard/stats/route.ts:10`); `stock.view` or `reports.view` would fit better | existing |

New menu placement (Sales group, Store management under Settings, Barcode under Build line)
means `route` / `group` / `sortOrder` / `parentKey` edits in `prisma/rbac-catalog.ts`, followed
by `npm run db:seed:rbac`. No role name and no person's name may appear in code (D3).

---

## 7. Defects found while checking the code

| # | Defect | Status 17 Sep |
|---|---|---|
| 1 | **A held build shows 00:00 after a reload.** On a fresh load of an `ON_HOLD` task nothing sets `elapsedSec`, so it stays 0 (P:160, P:283). R5's frozen time is not shown. | open |
| 2 | **An outward could take stock from another store** (product-wide reservation). | **fixed for deliveries** by plan 1609 (per floor warehouse) |
| 3 | **An outward silently drains the godown** once the floor is empty. | **fixed for deliveries** (floor only, with a refusal); still true for manual outwards via `api/inventory/outwards/route.ts:98` |
| 4 | ~~A transfer creator with the approve grant approves their own order automatically (`transfer-orders/route.ts:372-388`).~~ | **not a defect** — self-approval is allowed when the role holds approve (Q15) |
| 5 | **Assembly writes no activity log** — not on hold, start or complete — so "holds per week" cannot be counted from history. | open, wider than first found |
| 6 | **Transferred units lose `ASSEMBLED` status** (set to `PUT_AWAY` on receive, `receive/route.ts:205-212`). | open, but moot until 8 is fixed |
| 7 | **Units are never marked `SOLD` (or `LOST` / `DAMAGED`).** A sold cycle still shows on the Awaiting list. | new — Q33 |
| 8 | **A transfer never moves units.** No screen sends `unitIds` to dispatch, so units keep their source warehouse. | new — Q33 |
| 9 | ~~Spares and accessories get units and land on the Awaiting list.~~ | **not a defect** — every inbound item needs assembling (Q34, Q44) |
| 10 | **The Assembly Tasks tab does not show the hold reason** (P:744-793). | new — Q6 |
| 11 | **The mechanic picker lists every active user**, not `assembly.edit` holders (tasks route :120-126). | new |
| 12 | **`OUT_FOR_DELIVERY` has no stock check**, single or batch, so a short delivery can leave the store and fail only at Delivered. | new — Q31 |
| 13 | **A manual pre-book is a Dummy** (no warehouse), so it cannot even move `PREBOOKED → VERIFIED`. | new — Q37 |
| 14 | **Out-of-date comments:** `User.navTabs` "empty = role default" (S:408); `rbac-catalog.ts:100-103` and `stock-management/page.tsx:15-18` say the bottom nav filters to top-level modules — it no longer does. | new, cosmetic |

---

## 8. Out of scope

These are from the same brief but were not requested this time:

- Customer complaints as a record and the TeleCRM pull (brief §7). Only the **menu move** of
  Customers and Customer complaints is in scope.
- The price realisation report and the expense graphs (brief §8).
- The **data points list** in brief §8, except where §4.7 uses it.
- The category parent → subcategory structure and whether a category pushes to Zoho (brief §9).
- The roles write-up per person (brief §9).
- Ops tasks: deactivating unused brands and re-running the stock audit.
- Franchise stores' place of supply (brief Q7). This document assumes the BCH store.
- Reassigning or cancelling a build (Q39). Separate work if the hold data shows it is needed.

### Work record

| Date | What |
|---|---|
| 16 Sep 2026 | Written from the owner's request and brief sections §1–§6 and §9. Code checked by three parallel read-only agents (assembly screen; outward, transfer, approvals and push; sidebar and dashboard), with key citations re-checked by hand. 37 requirements, 4 decisions, 30 questions (8 blocking), 6 defects. Nothing built. |
| 17 Sep 2026 | Owner: requirements first, then the questions, to be clarified one by one. **Restructured** (questions moved to §2 with a clarify order). **Re-verified** at `861a237`, after plan 1609 (deliveries) merged, by three parallel read-only agents, key citations re-checked by hand. Deliveries facts rewritten (§5.3: per-floor hold, floor-only deduction, scheduling never refuses, day-only slots, Dummy); schema line numbers corrected; §6 corrected (`deliveries.approve` exists, stock value is `reorder.view`). **9 new questions** Q31–Q39; Q9 settled by code; Q8 → Q31 and Q22 → Q35. D5 added. Defects 2 and 3 fixed for deliveries; 8 new defects (units never sold or moved, spares get units, OUT_FOR_DELIVERY unchecked, …). Nothing built. |
| 17 Sep 2026 (later) | **Owner answered every question, one at a time** — 41 answers in §2, each quoted under its question. Follow-ups raised and answered on the way: Q40 (time — dropped, day only), Q41 (units picked automatically), Q42 (audit records assembled + unassembled), Q43 (reset clears counts + units, one location at a time), Q44 (every inbound item needs assembling). Key reversals of earlier defaults: no delivery time (R18 narrowed); roles and permissions only, no named approvers (Q14); self-approval allowed with the grant, stock audit self-block to be removed (Q15); ★ gets its own `delivery_priority` module (Q21). Defects 4 and 9 retired. **Nothing open. Ready for a plan.** Nothing built. |
