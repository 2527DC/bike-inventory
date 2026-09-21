# Inbound, bins and navigation: fixes and updates to the 1709 build, and the `problems.md` workflow sorted into built / fix / new

Status: pending — **BUILT 21 Sep 2026 on `feat/2109-inbound-bins-audit-fixes`, uncommitted; `npm run build` PASSED and production smoke test passed (see §6). Owner owes browser walk, migrate deploy + backfill + seed-rbac on other databases.** Written 21 Sep 2026.
Branch: to be decided when the build is approved (the 1709 work sits on
`feat/1709-priority-build-stock-flow`, tip `e16d51f`, not pushed — ask before branching).

Verified against the code on disk 21 Sep 2026 on `feat/1709-priority-build-stock-flow`. Every
claim in §2 carries a `file:line`.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (21 Sep 2026)

> i need u to create a requiremnt plan where it must hold the requiremnt ofwhere the requremntare
> fix and updation & 'f:\bharath  Cycle\BCH-Management\docs\Questions.md' getsoem requiremnt form
> here from this Inbound, Bin Management & Navigation Updates& 'f:\bharath  Cycle\BCH-Management\docs\problems.md'
> and form this problem thing

Read as: one plan that holds every requirement from the two sources below, and says of each one
whether it is a **fix** (built wrong), an **update** (built as asked, now asked differently), **new**,
or **already built**.

Second message, same day, after §2 was read:

> remove this statically thing i dont need it remve the bicycle and accessort amdf low stock thing
> and [this plan] so the r6 cant be made no validation like that and in the requiremnt ever items
> where for the existing item or the items from the inbound which go to unmatched in this unmatched
> listing i need all the items which dont have the bin matched to be in the unmatched listing tell
> me this taking of the dession shoudl i maintain in the /stock screen for the unmatcged ie the
> items where the bin are not matched and i think insted of making the requiremnt of when a bin
> rule is applied all the items which match the rule must be digittaly assigned to the ie move to
> that bin so i do in the home rule or should i make it in saparate screen like to match and insted
> of running every time when the bin creates we can have a butto where it can be triggered manually
> to mathc the rule for the existing items because once the existing items are matched we dont
> need that feature because everything will be automatched and move at teh time of inbounding

Read as:
1. Delete the unused `FilterChip` type (`BICYCLES` / `SPARES` / `ACCESSORIES` / `LOW_STOCK`) —
   **done 21 Sep**, `src/types/index.ts`.
2. **R6 is dropped.** No "a cycle can't go in a non-assemblable bin" validation.
3. **The unmatched listing holds every item that has no bin** — existing stock as well as inbound
   lines. → R29.
4. **Matching existing stock to the rules is a button pressed by hand**, not something that runs
   when a rule or bin is saved. It is a one-time catch-up: after it, inbound places items by rule.
   → R3 rewritten.
5. The owner asks where these two belong — `/stock` or `/bins`, the rules tab or a separate
   screen. → Q18, Q19, with a recommendation.

Third message, same day:

> inbound has aproval step but i dont want to see in the/approvals screen and /inbound screen i
> need a filter option where for quick like partial completed and not aproved like this filters
> update this in the requiremnt

Read as:
1. **Inbound keeps its approval step.** Source A §5.2 ("remove inbound approvals") is overruled:
   only the `/approvals` listing goes. → R8 rewritten.
2. **`/inbound` gets quick filters** — Partial, Completed, Not approved and the like — so the
   approver finds waiting shipments there instead. → R30.

Fourth message, same day:

> One new question (Q15) ok do with ur recomendation let i Q8 (should stock without unit codes
> move let it move or lets generate a uniqe code for all the existing items and move to the bin
> which is best i think geerating first and moving to the bin is goo so that we dont need the
> generate button at the bin or warehouse level what is ur suggestion

Read as:
1. Q15 → the recommendation (a).
2. Q8 → **generate a unique code for every existing item first, then move them to bins.** Only
   coded units ever move. → R31.
3. The owner would like the bin-level and warehouse-level Generate buttons gone, and asks for a
   suggestion. → Q24.

Fifth message, same day:

> for the r 31 requiremnt the unique code are fro the items not the profduct that product with
> having stock and tell me what code u r talinkg about i am talinking about the code which is like
> sho like U-related number and i think generating the unique code can be done at the time of
> stock count where the persoon choose the is it assembled item or Nonassembly item and
> Unassembled items with 3 options while making the stock audit we can make this too like tell me
> which is the best option where lets make a matchto the bin rule at the time of stock auting is
> this best or after stock auting compliton we can have a action where in the / stocks screen we
> can have a action button where on clicking it it list the bin rrspected rules or inside the bin
> itself for the listed bin rukes we cna have abutton where it will run where by hadling the items
> in the bins for the audited items this is my idea so tell me which is best
>
> and update the plan regarding the requiremnts

Read as:
1. The code is the **per-item `U-000123` unit code** (`InventoryUnit.unitCode`), one per physical
   item, never one per product. That is the code this plan means everywhere.
2. **Codes are created by the stock count**: the counter records each item as **Assembled**,
   **Unassembled** or **Non-assembly**. → R31 rewritten, R32.
3. Bin-rule matching: during the audit, or after it (from `/stock`, or from the rules on the bins
   screen)? The owner asks which is best. → Q19 revised, recommendation below the Q table.

Sixth message, same day (two parts, sent while the above was being written):

> nd i need a another validation that at the time of inbounding the bin seltion is must eaither it
> must be automatched and locked and if the items are not matched by bin rule it must be assigned
> maully and inbounded add this as also the requiremnt
>
> so that we would not need the unmatched listing

Read as:
1. **No inbound line is received without a bin.** A line a rule matched is pre-filled with the
   rule's bin and **locked**. A line no rule matched must have a bin picked by hand before it can
   be received. → R34. This also answers Q2: matched lines are **locked**.
2. **The unmatched listing is not needed.** → R29 dropped. R7 (the unmatched-assign bug) goes with
   it, and R3's all-rules Match button becomes a question (Q29): if nothing is ever received or
   counted without a bin, nothing is left to match.

Seventh message, same day (after the worked example of R33 / R35):

> ya make the bin are always on and creating a stock audit means it must be respected to bin where
> i think as e do the stock audit respectd to bin we think we can generate the uniqure code at the
> inbounding time where we just need to show the assembled or unassembled button for the items at
> the tie of stock auditing if the bin is assambleable and if the bin is non assambleable then i
> think we dont want to show any button for the products listng where it is non assemb able thing

Read as:
1. **Bins are always on** → Q27 (a).
2. **Every stock audit is created for one bin.** A bin is mandatory, not optional. → R36, and it
   settles Q28: a count with no bin cannot be created at all.
3. **Codes are created at inbound**, and the audit does not need to ask about codes, only about
   condition. For stock that came in **before** the app (seeded, never inbounded) see Q31.
4. **Condition on the audit:**
   - An **assemblable** bin shows **Assembled / Unassembled** for its products.
   - A **non-assemblable** bin shows **no buttons at all**, just the count.

   That settles Q25 and replaces R32's three options with two.

Eighth message, same day, answering Q31:

> the s seed are just the product no the stock where the seed will not have the items so we can
> have unique code for the items of the products ie for the stoc unit tmes so that we can make it
> at the time of stock audit where we do it respecte to the bin we can have it form there

Read as:
1. **The seed brings in products only, never stock.** Verified:
   `scripts/db/import-catalog-and-vendors.mjs:275–276` writes no `StockLevel` rows and leaves
   every `currentStock` at 0, because "quantities come from a stock audit".
2. **Physical items enter the app, and get their `U-` codes, at the bin audit.** → Q31 (a),
   confirmed.
3. So there is **no seeded stock sitting in no bin**, and R35's opening-count machinery is not
   needed. → R35 dropped, replaced by a one-time check (R37).

Ninth message, same day, answering Q1 (scope):

> ya i think R3 we dont need where the stock audit happend at the bin level and whrn the user
> start to stock audit for the bin which aare assembleable he must see the two option like
> assambled and unasseme and it related value and R5 bring the catgory and brand bellow the stock
> audit sidebar and for other go with the recomended

Read as:
1. **R3 is not needed.** Stock enters bins through the bin audit, so rules never have to be run
   over existing stock. → R3 dropped; Q19, Q20, Q29 moot. The per-rule Apply button that exists
   today → Q21, still open.
2. **Auditing an assemblable bin shows Assembled and Unassembled, each with its own number.** →
   Q32 (a), confirming R32.
3. **Categories and Brands go in the sidebar directly below Stock audit.** The message says
   "R5"; this is R4 (sidebar), because R5 is the bin card counts. R5 stays in scope.
4. The rest of Q1: as recommended. The scope stands, minus R3.

### 0.2 Source A — `docs/Questions.md` lines 11–76, verbatim

> # 18-9-20 (  updates  on the implmentation plan if @1709-priority-build-and-stock-flow-plan.md)
> # Inbound, Bin Management & Navigation Updates
> *Reference: Updates and clarifications for implementation plan `1709-priority-build-and-stock-flow-plan.md`*
>
> ## 1. Inbound & Bin Assignment Rules
>
> ### 1.1 Preserve Auto-Matched Bins During Bulk Assignment
> - **Current Issue**: Using the "Apply same bin to all items" option in Inbound overrides all line items indiscriminately.
> - **Required Behavior**:
>   - Line items that are automatically matched to a bin via automated Home-Bin rules must be protected/locked from bulk overrides.
>   - Selecting "Apply same bin to all items" must **only** apply to unmatched line items (items that did not have an automated rule match).
>
> ### 1.2 Hierarchical Category Selection in Home-Bin Rules & Retroactive Assignment
> - **Category Hierarchy Selection**:
>   - When configuring a Home-Bin rule (Warehouse + Brand + Category), the user must be able to navigate and select parent categories or specific child/sub-categories (e.g., as structured in Zoho).
>   - If a selected parent category has child categories, the user must be able to select the specific leaf child category.
> - **Immediate Retroactive Application to Existing Products**:
>   - Upon saving or applying the bin rule (e.g., Brand = `Accessory`, Category = `Accessory`), the system must immediately assign this bin to **all existing matching products** in the database/inventory, rather than applying solely to future inbound shipments.
>
> ## 2. Navigation & Sidebar Updates
>
> ### 2.1 Restore Categories & Brands to Sidebar Navigation
> - **Current Issue**: Categories and Brands were removed from the main sidebar navigation and relocated inside chips on the Stock & Inventory page.
> - **Required Behavior**: Restore **Categories** and **Brands** as accessible, standalone links within the sidebar navigation menu.
>
> ## 3. Bin Inventory & Capacity Breakdown
>
> ### 3.1 Display Assembled vs. Unassembled Stock Counts per Bin
> - In the Bins overview and Bin card/details screens, each bin must display the total product quantity it currently holds, broken down by:
>   - **Total Items**
>   - **Assembled Count**
>   - **Unassembled Count**
>
> ### 3.2 Non-Assemblable Bins Must Exclude Cycles
> - Bins designated as **Non-Assemblable** are strictly intended for spare parts, accessories, and non-build items.
> - Bicycles/cycles must **never** be stored in, assigned to, or categorized under non-assemblable bins.
>
> ## 4. Bug Fixes
>
> ### 4.1 Fix Product Visibility in Bins for Manually Assigned Unmatched Items
> - **Current Issue**: When items are assigned to a bin from the unmatched list, the bin detail drawer only displays an entry in the **Movement Log**, but reports `0` products and does not list the products inside the bin.
> - **Required Fix**: Ensure that when unmatched items are assigned to a bin, their inventory records (both tracked unit items and quantity stock) properly link to the bin so they are visible under "Items in this bin" in addition to logging the movement.
>
> ## 5. Inbound Requests & Approvals Workflow
>
> ### 5.1 Explanation: Source of Inbound Shipment Approval Requests
> - **Data Table**: Inbound approval records originate from the Prisma database table **`InboundShipment`** (`prisma.inboundShipment`).
> - **Trigger Logic**: Any inbound shipment where `approvedAt: null`, `rejectedAt: null`, and `status != "DELIVERED"` is picked up by `listPendingApprovals()` (`src/lib/approvals/pending.ts`).
> - **User Visibility**: Users holding the `inbound.approve` RBAC permission see these records listed under the **Requests** tab (`/approvals`) with options to **Approve** or **Reject** (send back with a note).
>
> ### 5.2 Workflow Decision: Remove Inbound Approvals
> - **Decision**: Remove the requirement for inbound shipments to undergo an approval process.
> - **Proposed Change**:
>   - Bypass the approve/reject stage for inbound shipments so stock can be received and put away directly.
>   - Remove inbound shipment rows from the `/approvals` (Requests) queue.

`docs/Questions.md` lines 1–9 (customer-detail edits, voice notes, pre-booking, check-stock
transfer, map link in batching) are **not** in this plan. The owner pointed at the *Inbound, Bin
Management & Navigation* section only. See §5.

### 0.3 Source B — `docs/problems.md` lines 1–104, verbatim

> # Workflow
>
> ## How the application will be started and put into use
>
> 1. First, seed Zoho's products together with their brands, categories and subcategories.
> 2. Then check which permissions are missing from each module and assign them to the users.
>
> ## Stock Audit
>
> - At present the Stock audit is done by numbers — the user enters the counted quantity by hand. (bec to scan and count the product need the labeling so existing product dont have the labeling need to generate the code for all the existing product)
> - Before a stock audit can begin, the products that already exist in the application from the seed (the ones that were never inbounded, so were never tracked or created through the inbound flow) must first be assigned digitally to their respective bins.
> - Either before or after that check, we should generate the unique code that is printed, pasted onto the product, and tracked digitally.
> - Once that is in place, the stock audit can be done by scanning with the camera and counting the products that way.
> - When a user is assigned a stock audit for a particular bin, the audit listing must show only the products held in that bin.
>
> ## Bins
>
> - A warehouse (Floor, Godown) can have more than one bin.
> - There must be a bin that holds non-assemblable items — items that need no assembly and never enter the build line.
> - We need a bin-rule feature that automatically syncs items to a bin and places them there digitally at the time of inbound.
> - When a bin rule is set — for example, a bin is given a rule of a brand plus its category — the products that already exist from the seed and match that rule must move into that bin at the moment the rule is created, not only from the next inbound onwards.
> - [Q] Suppose there are 400 products of brand A and category AC, and bin ZX has a capacity of 200 units. Where do the remaining 200 units of that product go?
> - Stock is tracked per warehouse (Floor, Godown), per bin within that warehouse, and per unit within that bin.
> - Unit code generation: today the code is generated when items are inbounded, and there is a button that generates codes for a bin, at bin level. The generated codes are unique and are pasted onto the items.
> - [Q] How do we generate codes for the items that already exist?
> - [Q] How do we place an existing item into a bin, along with its related units?
> - [Q] Is a maximum-unit capacity on a bin actually necessary? It probably need not be mandatory — a simple count per bin may be enough.
>
> ## Inbound
>
> - When the user approves an inbound, and a bin and a bin rule are set, the inbounded items are held digitally in the matching bins. If no bin matches, the items go to the unmatched holding area and can then be assigned to any bin.
> - Vendors are created at the time of inbound, as of the 18-09-2026 code.
> - [Q] Do we print the barcode and the unique code and stick them on the item — that is, is the U-number generated at the time of inbound, and the sticker printed and applied then?
> - After inbound, the inbounded items are placed and tracked digitally in the bin, with their units, as per that bin.
> - At present the application does not create new products from an inbound. (The code needs to be checked to confirm whether a new product is created or not.) Ask Syed what is needed here, and think through an implementation in which new products sync to their brand and category.
>
> ## Build Line
>
> - When an inbound is done, the item is assigned to a mechanic user, who has to build and assemble it.
> - [Q] What about the existing stock — how can it be tracked as assembled or unassembled?
>   - Proposed solution: for the first run of the application, existing stock must be marked assembled or not assembled manually by the user. This can hang off the tracking code we generate: at the initial stock-counting stage, offer two options — "Assembled" and "Not assembled". Alternatively, once the stock audit is complete, we can sync the existing products directly into their respective bins.
>
> ## Outbound
>
> - Validation: for an outward to happen, the stock must first be in the Floor warehouse. If there is no stock there, the stock can be reserved.
> - [Q — test this scenario] If the stock is present but every unit of it is reserved, what happens when an outward is made? Can the outward be made at all?
> - There are walk-out sales and normal deliveries. This needs checking: when the customer fills the form, the delivery is marked as Scheduled, but the stock appears to be reserved only when a staff user takes an action on the detail screen.
> - Update needed: after deliveries are scheduled, at batching time the user must be able to generate an optimised route.
>   - The route must use the location the customer provided in the form submission.
>   - We need to decide what to use for the map integration and location picking — a Google Maps API key or a free alternative — but the implementation must be long-lasting and flexible.
> - Outstation deliveries are sent by courier.
> - Every delivery status update can be sent to the customer over WhatsApp.
>
> ## Purchase Order
>
> - The user uploads the vendor's product sheet; the products are extracted, selected, and the PO is created from them.
> - Reorder marking: a product is marked for reorder with a reorder level, a reorder quantity and a vendor attached. The purpose is that when a user creates a PO and selects the vendor, the reorder products for that vendor must be listed, so the user can select them and order them on the PO. The PO is then sent by email.
> - Update: once the PO is made and sent to the vendor, the vendor sends its invoice by email. The next step in the application is that a Bill must be created in Zoho from that invoice — a Bill, not a Zoho Invoice, because a Zoho Invoice becomes a `Delivery` in the application and only a Bill becomes an `InboundShipment`.
> - [Q] We need to see what the vendor's emailed invoice actually looks like. Should the Bill be created in Zoho manually from the application, or created through the API — a review-then-create flow that writes it into Zoho?
> - Challenge: the research says that creating a Bill in Zoho requires the vendor ID (Zoho's primary key for identifying the vendor), but the application never stores the Zoho vendor ID. We need to work out how to bring the Zoho vendor ID into the application.
> - The Vendor Contact table should be removed from the application. It serves no purpose; those details can live on the Vendor table itself.

The consolidated tables at `problems.md:107–157` (Q1–Q10, C1–C2, N1–N18) restate the text above.
Their numbers are cited against each requirement below so both documents can be read together.

### 0.4 Restated as requirements

**Kind:** **Fix** = built, but behaves wrongly. **Update** = built as asked, now asked
differently. **New** = does not exist. **Built** = exists already, verify only. **Elsewhere** =
owned by another requirements doc or plan.

#### Part A — updates to the 1709 build (source A)

| # | Requirement | Kind | Source |
|---|---|---|---|
| R1 | On an inbound, **"Apply same bin to all items" fills only the lines no home-bin rule matched.** A line the rules placed is locked against the bulk action. | Fix | A §1.1 |
| R2 | The home-bin rule's category picker walks the **Zoho tree**: a parent, and under it the child / leaf. **21 Sep:** a subcategory is mandatory when one exists (Q3b), and the tree is two levels deep (Q4). That is exactly today's behaviour, so R2 needs **no code**, only a check that the target database has the categories imported (Q5). | Built, verify | A §1.2 |
| ~~R3~~ | **Dropped 21 Sep (9th message): "R3 we dont need", because stock enters bins through the bin audit.** No Match button is built, and saving a rule or bin moves nothing. Earlier text: ~~Saving a home-bin rule immediately moves every existing matching product into its bin.~~ ~~Changed 21 Sep:~~ a **"Match existing stock" button**, pressed by hand, runs the home-bin rules over existing stock that has no bin and places what matches. Nothing runs on saving a rule or a bin. It is a one-time catch-up; inbound auto-matching covers everything after. | Update (1709 R40 is a per-rule button today) | A §1.2, problems N10, owner 21 Sep |
| R4 | **Categories** and **Brands** are standalone links in the sidebar again, **placed directly below Stock audit** inside Stock management (9th message). | Update (reverses 1709 R33) | A §2.1 |
| R5 | Every bin shows **Total · Assembled · Unassembled** on the bins overview card and in the bin detail. | New | A §3.1 |
| R6 | ~~A cycle can never be placed in a non-assemblable bin, by any path.~~ **Dropped by the owner, 21 Sep** — no such validation. The app has no notion of "cycle" (§2.6) and none is added. | Dropped | A §3.2 |
| R7 | Items assigned to a bin **from the unmatched list appear under "Items in this bin"**, as well as in the movement log. **Superseded 21 Sep:** R34 removes the unmatched list and its assign route, so this path no longer exists. What remains is one check: after R34, an inbound line's units appear under "Items in this bin" of the bin chosen at receive. | Fix → superseded by R34 | A §4.1 |
| ~~R29~~ | **Dropped 21 Sep (6th message): "we would not need the unmatched listing".** With R34 no inbound line is received without a bin, and with Q28 no count creates units without one. The Unmatched tab and `api/bins/unmatched-items` are removed. Original text: ~~The unmatched listing holds every item that is not in a bin~~ — inbound lines no rule matched **and** existing stock (seeded, never inbounded) with no bin — per warehouse, assignable from the same list. Replaces R11's separate "Stock not in any bin" list. | Update (today it lists inbound lines only) | owner 21 Sep; problems N3, N11 |
| R8 | **Changed 21 Sep (third message): inbound KEEPS its approval step — approve, return with a note, resubmit, all as today — but inbound shipments no longer appear on the `/approvals` (Requests) screen.** Approving is done from the shipment itself on `/inbound/[id]`. | Update (only the listing changes) | A §5.2, overruled in part by owner 21 Sep |
| R31 | **Existing items get their `U-` codes from the stock count** — one code per physical item, never per product. Counting a bin and approving the count creates a code for every counted item that has none, **in that bin**, keeping codes already on items. No separate Generate button: both are removed. Only coded units are ever moved into a bin (Q8b). | Update (decides Q8; the audit already does most of this, §2.9) | owner 21 Sep (4th and 5th messages); problems N4, Q2, Q6 |
| R32 | ~~Three conditions: Assembled · Unassembled · Non-assembly.~~ **Revised 21 Sep (7th message):** the bin decides. Counting an **assemblable** bin shows **Assembled / Unassembled** per product. Counting a **non-assemblable** bin shows **no condition buttons**, only the count; its items are non-assembly because the bin is. | Update | owner 21 Sep (5th, 7th messages); problems Q6 |
| R36 | **Every stock audit is for exactly one bin.** Creating an audit requires store → warehouse → **bin**, on both screens that create one (`/stock-audit/new` and `/stock-audit/brand-count`). There are no warehouse-wide or store-wide new audits. Old audits already saved still open and approve. | Update (bin optional since 1509) | owner 21 Sep (7th message) |
| ~~R35~~ | ~~Opening count: take counted items from the not-yet-binned quantity first; write off the rest at "Finish opening count".~~ **Dropped 21 Sep (8th message):** the seed holds no stock, so there is no not-yet-binned quantity to protect. With R33, a first count of an empty bin simply adds what it finds and creates its codes. | Dropped | — |
| R37 | **Before go-live, confirm no stock sits outside a bin.** One read-only check per database: any warehouse quantity not covered by units in bins (from inbounds received while bins were off, or old data). The expected answer is 0. If it is not 0, those items are counted into bins once before go-live. | New (replaces R35) | 21 Sep |
| R34 | **A bin is mandatory on every inbound line before it can be received.** A rule-matched line shows the rule's bin, **locked** (no change by hand, no bulk override). An unmatched line must be given a bin by hand. Receive stays disabled until every line being received has a bin, and the server refuses a line without one. Nothing lands in an "unmatched" state. | Update (server already requires a bin when bin tracking is on, §2.10) | owner 21 Sep (6th message) |
| R33 | **A bin-scoped audit corrects only that bin.** Counting bin A must never change units or stock that sit in bin B of the same warehouse. | Fix (found in code, §2.9) | found 21 Sep |
| R30 | **`/inbound` has one-tap quick filters** for at least **Not approved**, **Partial** and **Completed**, alongside the existing ones (Q22). | New | owner 21 Sep |
| ~~R8-old~~ | ~~Inbound has no approval step; stock is received and put away directly.~~ Superseded by R8 above. | — | A §5.2 |

#### Part B — the `problems.md` workflow, each item classified

| # | Requirement | Kind | Source |
|---|---|---|---|
| R9 | Startup: seed Zoho products with brands, categories and subcategories. | Built (1709 R47 category import; `db:import`), run order only | N1 |
| R10 | Startup: find each module's missing permissions and assign them. | New (a report); `db:seed:rbac` exists | N2 |
| R11 | **Seeded products that were never inbounded are placed digitally into bins before any audit.** Delivered by R3 (the match button) plus R29 (the rest, by hand from the unmatched list). | New | N3, Q3 |
| R12 | Generate a printed unique code for every existing item. | Built for items already in a bin (1709 R41/R46); depends on R11 for the rest | N4, Q2 |
| R13 | Stock audit by **camera scan and count**. | New | N5 |
| R14 | A bin-scoped audit lists only that bin's products. | Built (`stock-counts/route.ts:151–199`), verify | N6 |
| R15 | A warehouse can hold more than one bin. | Built (`Bin @@unique([warehouseId, code])`, `schema.prisma:747`) | N7 |
| R16 | A non-assemblable bin exists and its items never reach the build line. | Built (1709 R42) | N8 |
| R17 | Home-bin rules place items automatically at inbound. | Built (1709 R39) | N9 |
| R18 | A rule with more matching units than bin capacity: all units still move; capacity is advisory. | Question → Q7 | Q1, Q4 |
| R19 | Matched inbound items go to their bin, unmatched to the holding list. With R8, this happens on **receive** instead of on approval. | Built; trigger changes with R8 | N11 |
| R20 | Existing stock is marked assembled / unassembled at the first unit-level count. | Built (1709 R11: the audit records assembled and unassembled qty) | Q6 |
| R21 | Inbound creates new products, synced to brand and category. | Question → Q12 (the Zoho bill import already creates products) | C1 |
| R22 | Outbound: floor stock required; reservation when short; the all-reserved case is tested. | Built (1709 R13/R16); test only | N12, Q7 |
| R23 | Stock reserved at form submit, not only on staff action. | Elsewhere: deliveries 1609 | Q8 |
| R24 | Route optimisation at batching from the customer's form location; map provider choice. | Elsewhere: new plan | N13, Q9 |
| R25 | Outstation by courier; WhatsApp on every delivery status. | Elsewhere: deliveries 1609 | N14, N15 |
| R26 | PO lists the vendor's reorder-marked products. | Built (1509 reorder-inside-PO) | N16 |
| R27 | Zoho **Bill** from the vendor's emailed invoice; store the Zoho vendor id. | Elsewhere: `po-vendor-invoice-to-zoho-bill-requirements.md` | N17, Q10, C2 |
| R28 | Remove the `VendorContact` table and keep its details on `Vendor`. | New, **but** a drop: rule 7, two releases | N18 |

**This plan builds R1, R4, R5, R8, R10, R11, R30–R34, R36, R37 and R28's first half.** R2 is already built (verify only). R3, R6, R29 and R35 are dropped; R7 is superseded by R34.
R13 goes to its own plan (Q13). Everything marked Built or Elsewhere is listed so it is not lost,
and is not rebuilt here.

---

## 1. Questions and clarifications — answer before build

Each question below changes what gets built. The **Default** column is what gets built if you
answer "go with defaults".

| # | Req | Question | Why it changes the build | Options | Default |
|---|---|---|---|---|---|
| ~~Q1~~ | all | ~~Is the scope right?~~ **Answered 21 Sep (9th message): yes, minus R3**, with Categories and Brands placed below Stock audit (R4). | — | — | — |
| ~~Q2~~ | R1 | ~~Can one auto-matched line be changed by hand?~~ **Answered 21 Sep (6th message): (b) fully locked** (R34). To put the item elsewhere, change the rule. | — | — | — |
| ~~Q3~~ | R2 | ~~Allow a rule on a parent category?~~ **Answered 21 Sep: (b) no.** When a category has subcategories, one subcategory **must** be chosen; a parent never covers its children. This is today's behaviour (`home-rules/route.ts:116–127`). | — | — | — |
| ~~Q4~~ | R2 | ~~Is the Zoho tree deeper than two levels?~~ **Answered from data 21 Sep:** `bch_local` has 33 categories, 23 top-level and 10 subcategories, max depth **2** (read-only query). The two-level picker is enough. | — | — | — |
| ~~Q5~~ | R2 | ~~Is the picker empty only because categories were not re-imported?~~ **Likely yes:** `bch_local` has the tree (10 subcategories), so the picker works there. On any database where the picker shows no subcategories, run the Zoho category import (1709 R47) first. Checked at build time on the target database. | — | — | — |
| ~~Q6~~ | R3 | ~~Save + apply in one step?~~ **Answered 21 Sep:** nothing runs on save; a manual button (R3). | — | — | — |
| ~~Q7~~ | R5, R18 | ~~What happens over capacity?~~ **Answered 21 Sep: (a) warn, never block.** Inbound and audits always go through; the bin card shows e.g. "25 / 20 — over capacity" in amber. | — | — | — |
| ~~Q8~~ | R3, R7, R11 | ~~Should quantity-only stock move and show too?~~ **Answered 21 Sep: (b) — generate codes for every existing item first, then move.** Only units move (R31). | — | — | — |
| ~~Q24~~ | R31 | ~~Remove the Generate buttons?~~ **Answered 21 Sep (5th message):** codes come from the stock count, so **both Generate buttons go** — warehouse and bin. The earlier "Prepare existing stock" card is withdrawn. | — | — | — |
| ~~Q25~~ | R32 | ~~How does Non-assembly relate to the bin?~~ **Answered 21 Sep (7th message): (a), simplified** — an assemblable bin shows Assembled / Unassembled; a non-assemblable bin shows **no buttons**, only the count. No third choice, no migration. | — | — | — |
| ~~Q27~~ | R34 | ~~Remove the bin-tracking switch?~~ **Answered 21 Sep (7th message): (a) bins are always on.** | — | — | — |
| ~~Q28~~ | R31, R35 | ~~Can a count with no bin correct stock?~~ **Answered 21 Sep (7th message), stronger than (a): a count with no bin cannot be created at all** (R36). Every audit is one bin. | — | — | — |
| ~~Q30~~ | R35 | ~~Opening count procedure?~~ **Moot 21 Sep (8th message):** the seed holds no stock, so R35 is dropped (see R37). | — | — | — |
| ~~Q31~~ | R31 | ~~Where do codes come from for stock that was here before the app?~~ **Answered 21 Sep (8th message): (a)** — the seed is products only; physical items enter the app at the **bin audit**, which creates their `U-` codes in that bin. After that, codes come from inbound. | — | — | — |
| ~~Q32~~ | R32 | ~~Per product or per item?~~ **Answered 21 Sep (9th message): (a) per product** — an assemblable bin's audit shows Assembled and Unassembled, each with its number. | — | — | — |
| ~~Q29~~ | R3 | ~~Keep the all-rules Match button?~~ **Answered 21 Sep: no** — R3 dropped. | — | — | — |
| ~~Q26~~ | R31 | ~~What does a count of an empty bin list?~~ **Answered 21 Sep: (a)** — it starts empty; the counter searches (later scans) and adds each product found. The fallback to every active product (`stock-counts/route.ts:187–220`) is removed for bin counts. | — | — | — |
| ~~Q9~~ | R5 | ~~Which units count?~~ **Answered 21 Sep: (a)** — live items only (not sold / lost / in transit / reset). Assemblable bin: Total · Assembled · Unassembled. Non-assemblable bin: **Total only**. | — | — | — |
| ~~Q10~~ | R6 | ~~What makes a product a "cycle"?~~ **Answered 21 Sep:** R6 dropped; no cycle flag. | — | — | — |
| ~~Q11~~ | R6 | ~~Cycles already in non-assemblable bins?~~ **Answered 21 Sep:** R6 dropped. | — | — | — |
| Q12 | R21 | The Zoho bill import **does** create products (`zoho/pull-review/approve/route.ts:409`) and vendors (`:203`). What is still missing, and what did Syed ask for? | The requirement may already be met. | — | Ask Syed; out of this plan until answered |
| ~~Q13~~ | R13 | ~~Camera-scan audit now or later?~~ **Answered 21 Sep (Q1): later, its own plan.** | — | — | — |
| ~~Q14~~ | R8 | ~~Who receives and puts away once approval is gone?~~ **Answered 21 Sep:** approval stays, so the receive gate and put-away permission stay exactly as they are. | — | — | — |
| ~~Q15~~ | R8 | ~~Keep the approver push and the dashboard count?~~ **Answered 21 Sep: (a)** — keep the push; the dashboard keeps counting inbound; both open `/inbound` (`/inbound?filter=not_approved`, or the shipment) instead of `/approvals`. | — | — | — |
| ~~Q22~~ | R30 | ~~Which quick filters?~~ **Answered 21 Sep: (a) full set** — All · Not approved · Returned · Approved, not received · Partial · Completed · This week; "Delivered" relabelled Completed; Pre-Merge stays in the sheet. | — | — | — |
| ~~Q23~~ | R30 | ~~Count on the Not approved chip?~~ **Answered 21 Sep: (a) yes**, for everyone with `inbound.view`. | — | — | — |
| ~~Q16~~ | R10 | ~~Screen or script?~~ **Answered 21 Sep: (a) read-only screen** on `/team/roles` — modules × roles, gaps highlighted, granting stays in the existing role editor. | — | — | — |
| ~~Q18~~ | R29 | ~~Where does the unmatched listing live?~~ **Moot 21 Sep:** R29 dropped; there is no unmatched listing. | — | — | — |
| ~~Q19~~ | R3 | ~~When and where does bin-rule matching run?~~ **Moot 21 Sep:** R3 dropped. Rules act only at inbound. | — | — | — |
| ~~Q20~~ | R3 | ~~Move already-binned items?~~ **Moot 21 Sep:** R3 dropped. | — | — | — |
| ~~Q21~~ | R3 | ~~Keep the per-rule Apply button?~~ **Answered 21 Sep: (b) remove it.** Rules act only at inbound; stock is placed through the bin audit. | — | — | — |
| ~~Q17~~ | R28 | ~~Drop VendorContact now or in two steps?~~ **Answered 21 Sep: (a) one contact on Vendor, two steps.** Vendor already has `phone`, `email`, `whatsappNumber`; the table adds a person's name and designation, several per vendor (18 rows on `bch_local`, 83 vendors). This release: add nullable `contactPerson` and `contactDesignation` to `Vendor`; copy each vendor's primary contact (else the oldest) into them, filling phone / email / WhatsApp only where Vendor's own are empty; the vendor page shows one contact block; the contacts API stops being used. A later release drops the table, after you have seen the list of vendors with more than one contact. | — | — | — |

*(Moot 21 Sep, 6th message: R29 dropped; kept for the record.)*
**Recommendation on Q18 — keep the unmatched listing on `/bins`, not `/stock`.**

- Placing an item in a bin is bin work, guarded by `bins.edit`. `/stock` is guarded by
  `stock.view` and is read by people who should see stock but not re-shelve it.
- "No bin" is a **quantity in a warehouse**, not a property of a product: one product can have 3
  units in bin A, 2 in bin B and 4 in no bin. `/stock` shows one row per product, so it cannot show
  that without becoming a second bins screen.
- The Unmatched tab already exists, already assigns through `POST /api/bins/assign`, and sits next
  to the Home-bin rules the Match button belongs to (Q19). One list, one place to act.
- `/stock` still answers "is anything unbinned?" through a **No bin** chip that filters its list
  and links across. Seeing is on `/stock`; fixing is on `/bins`.

**Recommendation on codes (R31, 5th message) — create them at the count. The owner's idea is
the better one.** It supersedes the "Prepare existing stock" card proposed earlier the same day.

- **Codes from a real count, not the system number.** Generate minted codes from `StockLevel`,
  which for seeded stock was never checked, so it would print labels for items that are not there.
  A count creates exactly as many codes as items the counter found.
- **Most of it already exists.** Approving a warehouse- or bin-scoped count with the
  assembled/unassembled split runs `syncWarehouseUnits` (`stock-counts/[id]/route.ts:455–469`).
  That keeps every existing code, creates the missing units in the counted condition, retires the
  surplus as LOST, and puts new units **in the audited bin** (`src/lib/units/sync.ts:42–102`).
  What is missing is the third condition (R32, Q25), adding products to an empty bin's count (Q26),
  and the bin-scope defect (R33).
- **Both Generate buttons go.** After the counts, every item is coded, and new stock arrives
  coded: inbound creates units, and transfers carry them. The build still checks the two paths
  that may add stock **without** units, the outward reversal in
  `src/app/api/inventory/outwards/route.ts` and `src/app/api/inventory/cleanup/route.ts`, and
  makes them create units if they do not.
- Codes are created when the count is **approved**, not while counting. The flow is: count →
  approve → **Print labels** for that bin → stick them on.

**Recommendation on the two code problems (21 Sep)**

*Problem 1: a bin count corrects the whole warehouse (R33, R35, Q28, Q30).*

The rule to build: **a count may only change what it looked at.** A bin count looked at one bin,
so it changes that bin, and the warehouse total moves by exactly that bin's difference. Two
situations need two behaviours:

- **Normal bin count (after go-live), R33.**
  - Difference = counted − **that bin's** units, the same figure the counter was shown.
  - Missing units are retired **from that bin only**. New units are created **in that bin**.
  - The warehouse total moves by the same difference (`adjustWarehouseQty(delta)`) instead of
    being overwritten (`setWarehouseQty(counted)`).
  - Example: bin A 5, bin B 4, count A = 5 → no change anywhere. Count A = 3 → 2 of A's codes
    retired, warehouse 9 → 7, and bin B is untouched.
- ~~**Opening count (day one), R35.**~~ **Dropped 21 Sep (8th message).** It assumed the seed
  loaded stock quantities with no bin. It does not: the seed is products only, at 0 stock. On day
  one every product is at 0, so the first count of a bin adds what it finds (0 → 3 in A, 0 → 7 in
  B, total 10) and creates the codes there. R33 alone gets that right, in any order. The only
  leftover risk is stock that entered **after** the seed without a bin (inbounds received while
  bins were off), and the R37 check finds it before go-live.
- **A count with no bin cannot be created at all** (decided 21 Sep, R36; stronger than the
  verify-only first proposed). Old no-bin audits approve as verify-only. It cannot know which bin a difference belongs
  to, so it shows differences and changes nothing.

Why not "reset the warehouse to 0, then count" (Q30b): anything the counters miss is gone at
once, and the stock history loses the "before" figure. The opening count reaches the same end
without that risk.

*Problem 2: the bin on/off switch (Q27).*

There is only one switch (corrected), so screen and server do not disagree beyond a phone
holding a stale value until it reloads. The real problem is that **"off" exists**: with it off,
inbound lines go in with no bin, which R34 forbids. Recommendation: **bins always on.** Remove the
setting, the toggle on `/bins`, the hook, its API route, and the unused env constant, and make
every "if tracking" branch behave as "on". This also removes the stale-value fault and the banned
raw `fetch` in the hook without separate fixes. Before removing, the build reads the setting's
current value on the target database. If it is **off**, some lines may already be bin-less and
must be placed first (the removal step in §3 Part 2).

*(Moot 21 Sep, 9th message: R3 dropped — no Match button. The "not during the audit" reasoning still holds and is why the audit never applies rules.)*
**Recommendation on Q19 — match after the audit, never during it; on `/bins`, not `/stock`.**

- **Not during the audit.** The count records where an item **physically is**. A rule says where
  it **should** be. Matching inside the count would put the item's record in bin X while the item
  sits in bin Y, and the next count would call it missing. A bin-by-bin count does not need
  matching at all: its items are already in their real bin.
- **After, for what has no bin only.** Matching is only for items counted without a bin (a
  warehouse-wide count) and older inbound lines. *(6th message: with R34 and Q28a nothing is
  ever without a bin, so Q29 proposes dropping the button altogether.)*
- **On the Home-bin rules tab of `/bins`, not `/stock`.** `/stock` is a per-product view for
  people who may not re-shelve. The rules and the Unmatched tab both live on `/bins`. One **Match
  unbinned stock** button runs every rule (the per-rule button stays, Q21), shows a preview, and
  after **Confirm** gives a **printable move list** (unit code · product · to bin). Matching changes
  only the record, so staff must carry the items to match it.

**The recommended order for going live, per warehouse:**

1. Create the bins, mark the non-assemblable ones, and set the home-bin rules.
2. Count **bin by bin**. Every audit is for one bin (R36). In each bin, search and add every
   product on the shelf (Q26). In an assemblable bin enter Assembled / Unassembled; in a
   non-assemblable bin just the count, with no buttons (R32).
3. Approve each count. Codes are created in that bin → **Print labels** → stick them on.
4. From then on every inbound line is received into a bin: the rule's bin, locked, or one picked
   by hand (R34). Nothing is ever unbinned, so there is no unmatched list and nothing to match.

**Caution:** do not run the warehouse **Stock Reset** after labels are printed.
`api/stock-reset/warehouse` retires units as RESET (`src/lib/units/lifecycle.ts:108–113`), and
every label on the shelf would point at a dead code.

### 1.1 Decisions on record

| Date | Q | Answer |
|---|---|---|
| 21 Sep 2026 | — | Delete the unused `FilterChip` type. Done, `src/types/index.ts`. The live **Low Stock** chip on `/stock` (`stock/page.tsx:75–81`) is a different thing and was left alone. |
| 21 Sep 2026 | Q10, Q11 | **R6 dropped.** No cycle validation, no "is cycle" flag, no migration for it. |
| 21 Sep 2026 | Q6 | **Nothing runs when a rule or bin is saved.** Existing stock is matched by a button pressed by hand (R3). |
| 21 Sep 2026 | — | **Every item with no bin goes to the unmatched listing**, existing stock and inbound alike (R29). |
| 21 Sep 2026 | Q14 | **Inbound keeps its approval step.** Only its listing on `/approvals` is removed (R8). The receive gate, put-away permission, Return and Resubmit are unchanged. |
| 21 Sep 2026 | — | **`/inbound` gets quick filters** including Not approved, Partial and Completed (R30). |
| 21 Sep 2026 | Q15 | (a): keep the approver push and the dashboard count; both open `/inbound`. |
| 21 Sep 2026 | Q8 | (b): **generate a code for every existing item first, then move.** Only units move (R31). |
| 21 Sep 2026 | Q2 | **Matched lines are locked** (R34). |
| 21 Sep 2026 | — | **A bin is mandatory on every inbound line; the unmatched listing is not needed** (R34; R29 dropped; R7 superseded). |
| 21 Sep 2026 | Q27 | **Bins are always on.** The switch is removed. |
| 21 Sep 2026 | Q28 | **Every stock audit is for one bin** (R36); no-bin audits cannot be created. |
| 21 Sep 2026 | Q25 | Assemblable bin → Assembled / Unassembled; non-assemblable bin → **no buttons**, count only (R32). |
| 21 Sep 2026 | Q1 | Scope as proposed **minus R3**; Categories and Brands below Stock audit (R4). |
| 21 Sep 2026 | Q32 | Condition per product, two numbers (Assembled / Unassembled) in assemblable bins. |
| 21 Sep 2026 | Q21 | **Remove the per-rule Apply button.** |
| 21 Sep 2026 | Q26 | An empty bin's audit **starts empty**; products are added by search. |
| 21 Sep 2026 | Q3 | **Subcategory mandatory** when a category has children; no parent-covers-children rules. |
| 21 Sep 2026 | Q4, Q5 | Tree is 2 levels (checked on `bch_local`); R2 needs no code, only the category import on each database. |
| 21 Sep 2026 | Q7 | **Capacity warns, never blocks**; over-capacity shows on the bin card. |
| 21 Sep 2026 | Q9 | Bin card counts live items only; non-assemblable bins show Total only. |
| 21 Sep 2026 | Q22 | /inbound chips: the **full set**. |
| 21 Sep 2026 | Q23 | "Not approved" chip **shows a count**. |
| 21 Sep 2026 | Q16 | Permission gaps: a **read-only screen** on /team/roles. |
| 21 Sep 2026 | Q17 | Vendor Contact → **one contact on Vendor** (name + designation added); table dropped in a later release. |
| 21 Sep 2026 | Q31 | **The seed is products only.** Physical items and their `U-` codes enter at the bin audit; later stock gets codes at inbound. **R35 dropped**, replaced by the R37 check. |
| 21 Sep 2026 | Q24 | **Codes are created by the stock count** (per item, `U-000123`), with three conditions: Assembled / Unassembled / Non-assembly. **Both Generate buttons are removed** (R31, R32). |

---

## 2. How it works today — verified against the code (21 Sep 2026)

### 2.1 R1: the bulk bin overwrites everything

`src/app/(dashboard)/inbound/[id]/page.tsx:795–818`: the "Apply same bin to all items" select
loops over every `!li.isDelivered` line (`:802–806`) and overwrites `binSelections[li.id]`. It never
reads `putawayItems[li.id].matchedRule`. The rule's suggestion is only the **initial** selection
(`:186–196`) and is shown as text (`:868`). Once overwritten, the suggestion is lost.

### 2.2 R2 / R3: rules already have a subcategory and an apply step

- `POST /api/bins/home-rules` (`src/app/api/bins/home-rules/route.ts:94–127`) stores the
  subcategory, and **refuses a root that has active children** ("Choose a subcategory of X").
  It supports two levels only.
- `categoryPath()` (`:12–30`) walks parents for display, so any depth displays correctly.
- Apply is a separate route with a dry run: `GET`/`POST /api/bins/home-rules/[id]/apply`
  (`apply/route.ts:16–33`). It moves at most `MAX_PER_RUN = 1000` units per press, moves every
  matched live unit including deliberately placed ones, and **leaves quantity-only stock alone**.
- Matching lives in one place: `src/lib/bins/rule-match.ts` (`ruleProductWhere`, the per-product
  matcher at `:145`).

### 2.3 R4: where Categories and Brands went

`src/app/(dashboard)/stock/page.tsx:519–539` renders them as chips, with the comment "Categories
and Brands left the sidebar and live here" (1709 R33). They are gated by `canView("categories")`
and `canView("brands")`. The sidebar config is the 1709 Part F change. Its file is identified at
build time, and the chips stay.

### 2.4 R7: why an assigned unmatched item shows 0 — root cause

`POST /api/bins/assign` (`src/app/api/bins/assign/route.ts:56–112`) takes one of two branches:

1. If units exist for that shipment + product with `binId: null`, it places them with
   `placeUnitsInBin` and logs one movement per unit (`:60–93`). **These appear in the drawer.**
2. **If no unit rows exist**, it only upserts `BinStock` and writes one movement log (`:94–111`).

The drawer's "Items in this bin" lists `detailedUnits` only, meaning `InventoryUnit` rows
(`src/components/bins/bins-manager.tsx:2190–2204`). Its comment says the separate "Loose Items /
Parts" list was removed because "every received product is a coded bicycle". Branch 2 therefore
writes a movement that the drawer never shows. That matches the reported symptom exactly: a
movement log entry, and 0 items.

*(21 Sep, Q8b: resolved by coding everything first, R31. See §3 R7 for the assign-route half.)*
The same drawer would also show 0 after R3 or R11 moves quantity-only stock. **So R7 is one fix
in the drawer and its API, not in the assign route.** Unit rows also fall into branch 2 when a
line's units have no `inboundShipmentId` set, or already carry a `binId`. That needs checking on
the reported shipment's data before the build.

### 2.5 R5: what the bins list counts today

`GET /api/bins` (`src/app/api/bins/route.ts:27`) returns `_count: { products, binStocks, units }`.
These count **rows**. They cover every status (sold units included), not quantity, and carry no
assembled / unassembled split. The assembled test used elsewhere is `assembledAt !== null`
(`src/lib/units/pick.ts:31`).

### 2.5a R29: the unmatched list holds inbound lines only

`GET /api/bins/unmatched-items` (`src/app/api/bins/unmatched-items/route.ts:12–16`) reads
`InboundLineItem` where `isDelivered: true, binId: null`, and nothing else. Seeded stock that
never came through an inbound can never appear there, whether it has unit rows with `binId: null`
or only a stock count. This route has no logger either, which the build fixes (logging rule).

### 2.6 R6 (dropped): what the code does, for the record

Kept so a later reader knows why nothing was added.

`src/lib/units/bins.ts:21–24` refuses to move a **non-assemblable unit into an assembly bin**.
The reverse is not checked: a cycle placed in a non-assemblable bin is **stamped**
`nonAssemblable` (`:69`) and then disappears from the build line for good, because the stamp
follows the unit through transfers (`lifecycle.ts:23`). The placement paths that call it are
`placeUnitsInBin` (`bins.ts`), unit creation (`src/lib/units/create.ts:35–56`), assign, apply
and put-away. No schema field identifies a cycle (see Q10).

### 2.7 R8: what approval gates today

- The queue comes from `listPendingApprovals()`, `src/lib/approvals/pending.ts:78–82`, with
  `approvedAt: null, rejectedAt: null, status ≠ DELIVERED`. This confirms source A §5.1.
- Receiving a line: `PUT /api/inbound/[id]` returns **403 "not been approved yet"**
  (`src/app/api/inbound/[id]/route.ts:163–165`).
- Screen: every receive and bin control is wrapped in `isApproved`
  (`inbound/[id]/page.tsx:230, 732, 763, 795, 880, 894`). The approve banner is at `:662`.
- Put-away needs `inbound.approve` (`inbound/[id]/putaway/route.ts:126`).
- The `/inbound` list filters by `status` only (`src/app/api/inbound/route.ts:21–41`). The screen's
  status options are inside the filter sheet (`inbound/page.tsx:91–98, 600–609`), and the stat
  cards toggle In Transit / This Week / Delivered (`:548–579`). There is no filter on `approvedAt`
  or `rejectedAt`, so an approver cannot list waiting shipments on `/inbound` today.
- Approve and reject: `api/inbound/[id]/approve/route.ts` → `approveInbound`
  (`src/lib/approvals/actions/inbound.ts`); `reject/route.ts:37`; `resubmit/route.ts:44–53`.
- Push to approvers: `src/lib/inbound/complete-shipment.ts:145`.
- The approver-error metric reads inbound approvals: `src/app/api/approvals/error-rate/route.ts`.

### 2.9 R31–R33: what the stock count does to codes today

- **Codes are created on approval of a count with the condition split.**
  `src/app/api/stock-counts/[id]/route.ts:455–469` calls `syncWarehouseUnits` when the correction
  scope is `"warehouse"` and the line has both `assembledQty` and `unassembledQty`. A bin-scoped
  count is warehouse scope: the scope is set at `:273`, and the bin comes from `existing.binId`
  at `:456`.
- `syncWarehouseUnits` (`src/lib/units/sync.ts:42–102`) keeps existing codes, creates missing units
  in the short condition (`:94–101`), and retires the surplus as LOST (`:87–93`). New units go into
  `binId` (`:97`).
- Only two conditions exist: assembled / unassembled (`assembledAt` set or null). Non-assembly
  comes from the bin, applied at creation (`src/lib/units/create.ts:35–56`).
- **Defect (R33), re-verified 21 Sep.** A bin count **shows** the counter one number and
  **applies** another:
  - When the count is created, each line's "system" figure is **that bin's** quantity
    (`src/app/api/stock-counts/route.ts:164–185, 235–237`).
  - When it is approved, the difference is `counted − the WAREHOUSE total`
    (`stock-counts/[id]/route.ts:385–388, 402–403`). The warehouse is then **set** to the counted
    number (`:510`), and units are synced against every unit in the warehouse (`sync.ts:68–80`,
    no bin filter).
  - Example: bin A holds 5 of a product and bin B holds 4. The counter sees "system 5", counts 5
    and sees "no difference". On approval the app computes 5 − 9 = −4, writes off 4 units as LOST
    (bin B's), and the warehouse drops to 5. **A perfect count destroys stock in other bins.**
  - ~~It bites on day one too, harder.~~ *Corrected 21 Sep (8th message):* the seed loads no
    stock (`scripts/db/import-catalog-and-vendors.mjs:275–276`), so on day one there is no
    bin-less quantity for a first count to overwrite. The damage needs stock that is **outside
    the counted bin**: another bin, or stock received with no bin (R37).
  - Read from the code; the build reproduces both examples in a test before fixing.
- **Empty bin count.** A bin with nothing recorded does **not** list nothing, as Q26 first said.
  It falls back to **every active product** (`stock-counts/route.ts:187–220`), about 5,745
  lines, all at system 0.

### 2.10 R34: when an inbound line can end up with no bin today

- **Server:** receiving a line requires a bin **when bin tracking is on**
  (`src/app/api/inbound/[id]/route.ts:200–205`, "Choose the bin this line goes into"). With it off,
  the bin is ignored and the line "lands in Unmatched Inbound" (`:197–199`).
- **One switch, corrected 21 Sep** (an earlier draft said two). The server and the screen read
  the same database setting:
  - The server calls `isBinTrackingEnabled()` (`src/lib/settings/bin-tracking.ts:16–45`, cached
    5 seconds, falling back to the env var only when no row exists).
  - The screen calls `useBinTracking()` (`src/hooks/use-bin-tracking.ts`), which fetches
    `/api/settings/bin-tracking`.
  - The toggle on `/bins` writes that setting (guarded by `bins.edit`).

  Smaller faults in the same place:
  - The hook keeps the value in a module variable **until the page reloads**. A toggle on one
    phone is not seen on another, whose server refuses or drops the bin until it reloads.
  - The hook's save uses raw `fetch().json()`, which the logging rules ban.
  - `BIN_TRACKING_ENABLED` in `src/lib/inventory-config.ts:7–9` is not imported anywhere.

  **What matters for R34:** with the switch **off**, lines are received with no bin (this
  section's first bullet). That is exactly the state R34 forbids.
- The **rule-placement branch** (`route.ts:327–349`) runs only when tracking is on **and** no bin
  was sent. The required-bin check above means that cannot happen, so the branch is unreachable
  today. The rule is honoured only through the screen pre-filling the rule's bin
  (`page.tsx:186–196`).
- After delivery, lines with no bin get a "N items need bin assignment / Save Bin Assignment"
  panel (`page.tsx:762–777`, `putaway` route).

### 2.8 Part B items verified as built

- R14: `src/app/api/stock-counts/route.ts:151–199` scopes a count to one bin's units and stock.
- R15: `prisma/schema.prisma:747`.
- R16: `schema.prisma:724–728`; `assemblableUnitWhere`, `src/lib/units/constants.ts:46`.
- R21 (partly): `src/app/api/zoho/pull-review/approve/route.ts:203, 409`;
  `src/app/api/inbound/[id]/issues/route.ts:165` creates vendors.
- R28: `model VendorContact` at `schema.prisma:1143`.

---

## 3. Implementation plan — shaped by the §1 defaults; revised when answers land

### Part 1 — inbound (R1, R34, R8, R30)

- **R1 + R34, screen** (`inbound/[id]/page.tsx`):
  - A rule-matched line shows the rule's bin as a **locked** field with a "Rule: <label>" badge.
    There is no select and no bulk override (Q2b).
  - An unmatched line shows an empty, required bin select.
  - "Apply same bin to all items" becomes "Apply to all unmatched lines", fills only lines with
    no rule (`:795–818`), and says "Applied to N · M kept by rule".
  - **Receive** stays disabled while any line being received has no bin, with the message
    "Choose a bin for N lines".
  - The after-delivery "need bin assignment" panel (`:762–777`) is removed, since no line can
    reach DELIVERED without a bin.
- **R34, server** (`api/inbound/[id]/route.ts`):
  - A bin is **always** required on receive (`:200–205`, without the tracking condition).
  - When the product matches a home-bin rule in that warehouse, the sent bin **must equal the
    rule's bin**, else 409 "This item's bin is set by rule X". The lock is enforced on the server,
    not just hidden on the screen.
  - The unreachable rule-placement branch (`:327–349`) is replaced by that check.
  - The putaway route gets the same check.
  - Each check logs at warn with `{ shipmentId, lineItemId, binId }`.
- **Q27a: remove the bin-tracking switch (one switch, not two).**
  - Remove `src/lib/settings/bin-tracking.ts`, `src/hooks/use-bin-tracking.ts`,
    `api/settings/bin-tracking`, the `/bins` toggle, and the unused constant in
    `inventory-config.ts`, with tombstone comments.
  - Every reader behaves as "on": the inbound page and route, `/stock`, `/stock/[id]`,
    `stock-audit/new` and `brand-count`, `api/products` and `products/bulk`, `api/stock/by-bin`,
    and `src/lib/transfers/items.ts` (the full list from the search, 21 Sep).
  - Before removal, the build reads the setting's value on the target database. If it is "off",
    the bin-less lines are placed first.
- **R8** Take inbound off `/approvals`; **keep the approval itself**:
  - `src/lib/approvals/pending.ts:78–82`: stop listing inbound shipments, with a comment pointing
    to R8 so nobody "restores" them.
  - Everything else stays: the receive gate (`api/inbound/[id]/route.ts:163–165`), the approve /
    return banner on `/inbound/[id]`, the approve, reject and resubmit routes, put-away's
    permission, the error-rate metric.
  - The push to approvers stays (Q15a). Its **Open** action and the dashboard's stuck-approvals
    link go to `/inbound/[id]` and `/inbound?filter=not_approved` instead of `/approvals`.
  - Check whether anything else reads `listPendingApprovals()` for inbound (the dashboard count),
    and keep that count by querying inbound directly. No migration, no RBAC change.
- **R30** Quick filters on `/inbound` (Q22a, Q23a):
  - `GET /api/inbound` takes `filter=not_approved | returned | approved_not_received | partial |
    completed | this_week`. Each maps to one `where`:
    - Not approved = `approvedAt: null, rejectedAt: null, status ≠ DELIVERED` (the same test
      `pending.ts` uses today).
    - Returned = `rejectedAt ≠ null, approvedAt: null`.
    - Approved, not received = `approvedAt ≠ null, status: IN_TRANSIT`.
    - Partial = `status: PARTIALLY_DELIVERED`.
    - Completed = `status: DELIVERED`.
    - This week = as today.
    The old `status=` parameter keeps working, so existing links do not break.
  - The response carries a count per filter, from one `groupBy` / `count` batch, never one
    request per chip.
  - `inbound/page.tsx`: a horizontal chip row above the list, the selected chip kept in the URL
    (`?filter=`, replace not push), "Delivered" relabelled **Completed**. The filter sheet keeps
    Pre-Merge and the date range.

### Part 2 — rules, counts and codes (R2, R3, R11, R31–R33)

- **R2** No code (Q3b, Q4). The picker and `POST home-rules` already require a subcategory when
  one exists. The build only confirms the target database has the Zoho category tree imported
  (Q5).
- ~~**R3**~~ **Dropped (9th message).** Nothing is built. Saving a rule or a bin moves nothing, as
  today, and rules act only when an inbound line is received (R34). The existing per-rule Apply
  button is **removed** (Q21b): the button in `bins-manager.tsx` and the route
  `api/bins/home-rules/[id]/apply` go, with a tombstone comment. `ruleProductWhere` in
  `src/lib/bins/rule-match.ts` is removed too if nothing else uses it. Capacity stays advisory (Q7a).
- **R36** A bin is **required** to create an audit:
  - `stockCountSchema.binId` becomes required (`src/lib/validations.ts:204–205`), with the message
    "Choose a bin". The route already checks that the bin is in the warehouse.
  - Both creating screens make the bin picker mandatory: `/stock-audit/new` and
    `/stock-audit/brand-count` (it sends `binId` only when chosen, `brand-count/page.tsx:339`).
    A brand count becomes "this brand, in this bin".
  - Audits saved earlier without a bin still open and approve, as verify-only. "Apply to stock" is
    refused for them, because they cannot say which bin a difference belongs to.
- **R31** Codes come from **inbound** for new stock (as today), and from the **opening count**
  for stock that was here before the app (Q31a, to confirm). **Remove both Generate buttons** (warehouse and bin,
  `bins-manager.tsx:2157–2173` and the warehouse one) and the route
  `api/bins/generate-unit-codes` (with a tombstone comment). Bin counts: the counter can **search
  and add any product** to the count (Q26a); an added line starts at system 0. After approval the
  receipt shows "N codes created in bin X" with a **Print labels** button for exactly those codes.
  The build checks `inventory/outwards` and `inventory/cleanup` for stock added without units, and
  makes them create units if they do.
- **R32** Condition per line (Q25a):
  - Counting an **assemblable** bin: each product line shows **Assembled / Unassembled** (two
    numbers, Q32a), as today.
  - Counting a **non-assemblable** bin: **no condition buttons**, only the count. The count screen
    reads `bin.nonAssemblable` and hides the split. On approval the line is synced as
    unassembled = count, assembled = 0, and `createUnits` stamps the units non-assembly, as today.
  - No migration.
- **R33** Bin-scoped count fix (`api/stock-counts/[id]/route.ts`, `src/lib/units/sync.ts`):
  - When the count has a bin, "live" is **that bin's** live units, not `getWarehouseQtyMap`
    (`:385–388`).
  - `syncWarehouseUnits` takes a `binId` and loads, retires and creates **only in that bin**
    (the `where` at `sync.ts:70`).
  - The warehouse moves by the delta (`adjustWarehouseQty`), replacing `setWarehouseQty(counted)`
    (`:510`).
  - Tests first: (1) A 5 + B 4, count A = 5 → nothing changes; (2) count A = 3 → 2 of A's codes
    LOST, warehouse 7, B untouched.
- ~~**R35** Opening count~~ dropped (8th message).
- **R37** One read-only script, `scripts/db/check-unbinned-stock.mjs`, run per database before
  go-live. It lists, per warehouse and product, `StockLevel.quantity` − live units that have a bin,
  wherever that is above 0, plus live units with `binId: null`. It changes nothing. Expected
  result: nothing listed. If anything is listed, those items are counted into bins once before
  go-live. The script prints which database host it read and never writes.
- **R29 dropped / R7 superseded — remove the unmatched path:**
  - Remove the **Unmatched** tab in `bins-manager.tsx` and the routes `api/bins/unmatched-items`
    and `api/bins/assign`, with tombstone comments.
  - **Before removing, the build counts rows already unmatched** on the target database
    (`InboundLineItem` with `isDelivered` and `binId: null`, and live units with `binId: null`)
    and reports the numbers. If any exist, they are placed once through the per-rule Apply or by
    a bin-scoped count, and are not left orphaned.
- **R11** Seeded stock reaches bins through **bin-by-bin counts** (R31), not a list.

### Part 3 — bins screen (R5)

- **R5** `GET /api/bins` adds `{ total, assembled, unassembled }` per bin, from one `groupBy`
  over `InventoryUnit` (live statuses, `assembledAt` null or not), **never one query per bin**.
  Units only (R31). The same figures appear on the card and in the drawer (Q9a).
- ~~**R6**~~ dropped 21 Sep. No `Category.isCycle`, no placement check.

### Part 4 — navigation and small items (R4, R10, R28)

- **R4** Sidebar. The menu is built from the RBAC catalog (data, not code), so this is a catalog
  change:
  - `categories` and `brands` in `prisma/rbac-catalog.ts` get their routes back (`/categories`,
    `/more/brands`, both `route: null` since 1709 at `:346` and `:407`). They are already children
    of `stock_management`.
  - Their `sortOrder` moves to **115** and **116**, directly after `stock_audit` (113; 114 is the
    routeless `delivery_priority`). This replaces 103 and 108.
  - The labels stay "Categories" and "Brands"; the sidebar shows them only to roles with
    `categories.view` / `brands.view`.
  - **You run `npm run db:seed:rbac`** after the deploy (rule 11). Until then the sidebar is
    unchanged.
  - The `/stock` chips stay.
  - Restoring the routes also brings back any bottom-bar pins people had on these two screens.
- **R10** A read-only "Permission gaps" view on `/team/roles`: module × role matrix from
  `modules`/`permissions`/`role_permissions`, with empty cells highlighted. No writes.
- **R28** Step 1 only (Q17a):
  - An additive migration adds `Vendor.contactPerson String?` and `Vendor.contactDesignation
    String?`, on `bch_local` only. You apply it elsewhere.
  - A backfill script, idempotent, prints its host. It copies each vendor's primary contact, else
    the oldest, filling phone / email / WhatsApp only where the Vendor field is empty. It prints
    the vendors that have **more than one** contact, so you can see what the later drop would
    lose.
  - `vendors/[id]/page.tsx` shows and edits one contact block on Vendor. The contacts routes
    (`api/vendors/[id]/contacts*`) stop being called and get a tombstone comment.
  - Dropping the table is a later plan (rule 7).

### Cross-cutting

- **RBAC:** no role names. Guards stay `requireFeature(module, action)`, and put-away keeps its
  permission (inbound approval stays, Q14). **One catalog change:** R4 restores the Categories
  and Brands routes and moves their sort order, so **`npm run db:seed:rbac`** is needed after
  the deploy. No permission is added or removed.
- **Logging:** every changed route uses its existing `createLogger` scope; `unmatched-items`
  gets one (`bins:unmatched`). Match logs `{ rules, moved, qtyMoved, leftUnmatched }` at info.
- **Migrations:** only the `Vendor` contact columns (R28). Additive, applied to `bch_local` only.
  Snapshot before merge (rule 9).
- **Phases:** Part 1 (inbound, R34) and Part 4 are independent. In Part 2, **R33 goes
  first**, before R31/R32 and before anyone counts a bin on real data. Until they ship, **do not
  approve a bin count with "apply to stock"** on any database whose stock matters.
- **Board of agents** to read before marking done:
  - inventory and warehouse consultants (R31–R34, R3, R11)
  - database architect (R33, the R28 migration)
  - backend (R34 server lock, R8 approvals listing, R30 filters)
  - frontend (the locked bin field, count screen, chips)

---

## 4. Verification

- `npx tsc --noEmit`, then `npm run build` (you run it; it takes 20–45 minutes).
- **R1 + R34:** an inbound with one rule-matched line and one unmatched line:
  - The matched line shows its rule bin, locked.
  - Receive is disabled until the unmatched line has a bin.
  - "Apply to all unmatched lines" changes only the unmatched line.
  - A crafted request sending a different bin for the matched line → 409.
  - A request with no bin → 400.
  - After receiving, both lines' units are under "Items in this bin" of their bins, and the
    bins screen has no Unmatched tab.
- **Q27:** no "Bin tracking" toggle anywhere; receiving works the same with the env var unset.
- **R8:** create an inbound → it does **not** appear on `/approvals` → it still cannot be received
  until approved → the approver approves it from `/inbound/[id]` (or from the push) → receiving
  works. Return and resubmit still work.
- **R30:** on `/inbound`, each chip shows only its shipments and its count matches the list:
  a new shipment is under **Not approved**; after Return, under **Returned**; after approval,
  under **Approved, not received**; after one line is received, **Partial**; after all lines,
  **Completed**. Reloading keeps the chip. An old `?status=` link still works.
- **R31 + R32:** count an empty normal bin → add a seeded product → enter Assembled 2,
  Unassembled 3 → approve → 5 new `U-` codes in that bin (2 assembled), and Print labels lists
  exactly those 5. Count a non-assemblable bin → no condition buttons, just the number → approve
  → its units are stamped no-assembly. There is no Generate button anywhere.
- **R33:** a product with 5 units in bin A and 4 in bin B → count bin A = 5 → approve → nothing
  changes, total 9. Count A = 3 → 2 of A's codes LOST, total 7, bin B still 4.
- **Day one:** a seeded product at stock 0 → count bin A = 3 → approve → total 3, 3 codes in
  A → count bin B = 7 → approve → total 10, 10 codes, A still 3. Same totals in the other order.
- **R37:** run the check on `bch_local` → it prints the host and lists nothing, or lists exactly
  the bin-less quantities; the database is unchanged afterwards.
- **R36:** try to create an audit with no bin, on `/stock-audit/new` and on `brand-count` → both
  refuse with "Choose a bin"; a crafted request gets 400. An old no-bin audit still opens, and
  approves as verify-only.
- **R32:** count an assemblable bin → each line shows Assembled / Unassembled. Count a
  non-assemblable bin → no condition buttons, just the number → approve → the units are marked
  non-assembly.
- **Rules:** save a rule → nothing moves. A received inbound line whose product matches the rule
  lands in the rule's bin.
- **R2:** on the rule form, choosing a category that has subcategories requires one to be
  picked; saving with only the parent is refused.
- **R5:** a bin with 2 assembled, 3 unassembled and 1 sold → card shows Total 5 · Assembled 2 ·
  Unassembled 3.
- **R4:** after `db:seed:rbac`, the Stock management menu reads … 4 Stock audit · Categories ·
  Brands. They show for a role with view and are hidden without it.

---

## 5. Out of scope, deliberately

- `docs/Questions.md` lines 1–9: editing customer details with an activity log, voice notes,
  pre-booking when no stock exists anywhere, "Check stock" → transfer request, and the unused map
  link in batching. They belong to the deliveries work and need their own requirements pass.
- R13 camera-scan audit (Q13), R23–R25 deliveries, R27 Zoho Bill, and dropping the `VendorContact`
  table (the later half of R28).
- R12 codes for existing stock: delivered by the bin-by-bin count (R31); the R41 Generate button
  is removed, not extended.
- R21 new products from inbound: waits on Syed (Q12).

---

## 6. Build record — 21 Sep 2026

Built on **`feat/2109-inbound-bins-audit-fixes`** (off `main` `382dc7c`) by four parallel agents
with disjoint file ownership, then integrated. **Uncommitted** at the time of writing.

| Part | Built | Notes |
|---|---|---|
| A — stock audit | R33, R36, Q26, R32, R31 | `applyBinCountLine` (`api/stock-counts/_lib/`) + `getBinQtyMap` (`src/lib/units/bin-qty.ts`); `syncWarehouseUnits` takes `binId`; whole-warehouse and whole-store corrections removed; `POST /api/stock-counts/[id]/items` adds a product to a count; receipt lists codes created with a Print link to `/units/labels`. Brand count could never be completed before (it sent every brand product as lines) — now sends only counted products. |
| B — inbound | R1 + R34, R8, Q15, R30 | `src/lib/inbound/rule-bin.ts` (`assertRuleBin`, 409 inside the receive transaction; same check in putaway), `src/lib/inbound/filters.ts`; inbound removed from `listPendingApprovals`; new dashboard card "Inbound approvals waiting" → `/inbound?filter=not_approved`; chip row with counts. **Deviation:** the lock uses `pickHomeBin` with the shipment's brand/category fallback (as the screen's suggestion does), not `matchHomeBin`, so the server never refuses the bin the screen locked. |
| C — bins | Q27, R5, Q7, Q21, R29/R31 removals | Switch, hook, setting route and constant deleted; Unmatched tab, assign, per-rule Apply, generate-unit-codes routes deleted; `src/lib/bins/unit-counts.ts`; bin card/drawer Total · Assembled · Unassembled (Total only when non-assemblable), amber over-capacity. `/api/stock/by-bin` always returns the per-warehouse summary (its bin branch returned a shape the page never rendered). |
| D — other | R4, R10, R28 step 1, R37 | Catalog routes restored, sortOrder 115/116; `/team/permissions/gaps` (no `/team/roles` screen exists) via `api/roles/permission-gaps`; migration `20260921141632_vendor_contact_fields` (ADD COLUMN ×2, hand-written, applied to `bch_local` only); `db:backfill:vendor-contact`, `db:check:unbinned`. |
| Integration | — | PO PDF / PO send / PO detail / vendor-issue routes and page switched from `vendor.contacts` to `Vendor.contactPerson` + own phone/WhatsApp/email; dead `binTrackingEnabled` branches removed in both transfer-order routes; bin drawer lists live units only; stale comments. |

**Verification run 21 Sep:**
- `npx tsc --noEmit`: **0 errors in source**. 5 errors remain in the generated
  `.next/types/validator.ts`, which still names the deleted routes; the next build regenerates it.
- ESLint on the 61 changed files: 1 error and 8 warnings, **all present on `main` already**
  (`bins-manager.tsx` set-state-in-effect is at `main:487`).
- `node scripts/db/verify-bin-count-r33.mjs` on localhost `bch_local` (rolled back): **all checks
  pass**, covering the §2.9 examples, day one, a non-assemblable bin, and a recount without the
  split.
- bch_local facts:
  - Bin tracking was ON; 0 bin-less delivered lines; 0 bin-less live units.
  - Backfill: 18 vendors filled, none with more than one contact; a second run changed nothing.
  - `db:check:unbinned` lists 11 items / 5 products of quantity with no binned units (local test
    data).
- **Not done:** `npm run build`, browser walk.

**Open, found during the build (not decided):**
1. `src/app/api/inventory/cleanup/route.ts:65` reverses an imported OUTWARD with `addAnywhere`: it
   adds quantity with **no units and no bin**, and does not un-sell the sold units. That is the
   one path left that creates un-binned, uncoded stock. It needs a design decision (which bin?).
2. `(dashboard)/approvals/page.tsx` still has dead INBOUND handling (harmless).
3. `bch_local` has a `PaymentMode` enum that drifts from the schema. It predates this work.

**Owner owes:**
- `npm run build` and a browser walk.
- On each non-local database, before the code goes live:
  - `npx prisma migrate deploy`, for `20260921141632_vendor_contact_fields`
  - `npm run db:backfill:vendor-contact`
  - `npm run db:check:unbinned`
- `npm run db:seed:rbac` after the deploy (R4 sidebar).

**Build and smoke test, 21 Sep 2026 (later):**
- `npm run db:seed:rbac` on `bch_local`: 55 modules, 193 permissions, no errors.
- **`npm run build` PASSED**, 14:57 → 15:44. It wrote `prerender-manifest.json`, removed
  `.next/lock` and `export-detail.json` on a clean exit, and regenerated the stale validator. The
  run outlived its session, so the exit code itself was not captured; success was confirmed by
  starting the output below.
- `next start` on the production build: "Ready in 6.8s", with no server errors. Logged in as the
  local seed admin and checked:
  - Unauthenticated page and API requests redirect to login.
  - R30: `/api/inbound?filter=not_approved` returns `counts` all 19, not_approved 9, returned 0,
    approved_not_received 3, partial 1, completed 6, this_week 12.
  - R5: `/api/bins` returns `unitCounts` per bin, e.g. `BCH_BIN_1` capacity 10 → 1/0/1; the
    non-assemblable `NOAS` bin → total 1.
  - R10: `/api/roles/permission-gaps` returns 55 modules × 2 roles.
  - R8: `/api/approvals/pending` has sections `INBOUND: false`, and no inbound requests appear.
  - R36: `POST /api/stock-counts` with no bin → 400 "Choose a bin".
  - R4: modules read `stock_audit /stock-audit 113 · categories /categories 115 · brands
    /more/brands 116`.
  - Deleted routes: `/api/settings/bin-tracking` → 404. `/api/bins/unmatched-items`,
    `generate-unit-codes` and `assign` → 405, because those paths now fall into
    `/api/bins/[id]`, which has no GET/POST.
- **Still not done:** a browser walk of the screens.
