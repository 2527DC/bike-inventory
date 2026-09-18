# Manual testing — priority build & stock flow

What to test by hand for plan
`docs/implementation/pending/1709-priority-build-and-stock-flow-plan.md`
on branch **`feat/1709-priority-build-stock-flow`**.

| Phase | Commit | What landed |
|---|---|---|
| 1 | `d479e27` | Schema, the migration, the RBAC catalog, shared helpers |
| 2 | `3ac154c` | Units kept in sync, the assembly screen, sidebar / stock / stores, the category tree |
| 3 | `81fa88d` | Outward guard, ★ priority, outbound approval, Find stock, Google Contacts, approvals and returned records, bins rules, unit codes and labels |
| 4 | *(on disk, not yet committed when this was written)* | One dashboard, the stuck-hours setting, the Requests row in the sidebar, notification action buttons, and a second migration of indexes |

Test on the **latest commit on the branch**. It contains everything above it.

**Build status: NOT RUN.** `npm run build` has not been run on this branch. Each phase passed
`npx tsc --noEmit` and `eslint` only. Running the build is the first thing on your list (§0.5),
and nothing below is proven until the browser walk is done.

## The flows you are checking, in the order to walk them

Each flow is one real-life story. The numbered sections break it into steps.

| # | Flow | What should happen, in one line | Section |
|---|---|---|---|
| F1 | **The menu changes shape** | Operations reads Build line, then a Stock Management row that only expands. Sales is new. Bins, Categories, Brands and Barcode leave the menu. | §1 |
| F2 | **Old stock gets codes and labels** | A home-bin rule can be applied to what is already here, every item in a bin gets its own `U-…` code, and each code prints on a label. | §2 |
| F3 | **Units follow the stock** | Receive, build, transfer, sell and audit — after every one of them the unit records, the counts and the build line agree. | §3 |
| F4 | **Some items need no assembly** | A bin marked non-assemblable keeps its items off the build line, and they cannot be moved into a normal bin. | §4 |
| F5 | **The build line** | Each tab has its own address, a hold is one tap with two reasons, the timer freezes, and a supervisor can assign hundreds at once. | §5 |
| F6 | **The outward** | A short floor warns and names the godown, pushes the transfer people, can be starred, can find stock anywhere, and cannot be dispatched unapproved. | §6 |
| F7 | **Doer and approver** | Reject sends a record back with a note, the creator fixes the same record and resubmits, and Requests lists everything you may approve. | §7 |
| F8 | **Categories as Zoho has them** | Wipe, import, and every product sits under its Zoho category. A parent filter includes its children. | §8 |
| F9 | **Customers on the shop phones** | Save the customer in the app, then sync ticked customers into the shop's Google account. | §9 |
| F10 | **One dashboard** | Each card appears only if your role holds its grant. | §10 |
| F11 | **Notifications** | Approve straight from the notification on Android and desktop; iPhone opens the record. | §11 |

**None of that is proved by a green build.** Every step here is behaviour a compiler cannot see.
Tick the last column as you go. If a step fails, write down what you actually saw instead of a tick.

The `R` / `P` / `Q` numbers in brackets point at the plan's §0.2 and §1.1, so a failure can be
traced back to the decision it breaks.

---

## 0. Before you start

| # | What to do | What you should see | Why it matters |
|---|---|---|---|
| 0.1 | `grep -n "^DATABASE_URL" .env` | One uncommented line. Know which database it is: `localhost:5432/bch_local` is the local one, an `…supabase.com…` host is the cloud test database. | Everything below writes to whichever database this names. The migration has only ever been applied to `bch_local`. |
| 0.2 | `npm run db:snapshot` | A new file in `backups/`. | Prisma has no down migrations, and §8 deletes every category. The snapshot is the only way back. |
| 0.3 | `npx prisma migrate status` | If `20260917201013_priority_build_stock_flow` or `20260918115137_priority_build_indexes` is listed as pending, run `npx prisma migrate deploy`. | Without those columns — `InventoryUnit.nonAssemblable`, `Delivery.priorityAt`, `Bin.nonAssemblable`, `Module.dividerBefore`, the `approval_events` table — most screens below fail with a 500. |
| 0.4 | `npm run db:seed:rbac` | It finishes with no error. | This is what actually changes the menu. It creates the new `delivery_priority` module and rewrites route, label, group, sort order and the divider on the existing ones. **Until it runs, §1 will fail and nothing is wrong with the code.** |
| 0.5 | `npm run build` | Exit 0. Expect 21–45 minutes. Do not pipe it — the exit code is then a lie. | The build has not been run on this branch at all. |
| 0.6 | `npm run dev`, sign in as an **ADMIN** | The app loads. | ADMIN holds every permission, so §1–§11 can all be walked by one person first. |
| 0.7 | Have these extra users ready (Team → Roles & Permissions) | See the grant table below. | Half the steps are "this person can, that person cannot". A cosmetic button is not a test. |
| 0.8 | Open a SQL shell on the same database | `psql "postgresql://…"` | §2, §3 and §12 check the database directly. |
| 0.9 | DevTools → Console on a signed-in page, paste:<br>`const call = async (url, method = "GET", body) => { const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); console.log(r.status, await r.text()); };` | Nothing. It defines `call(...)`. | Used to prove the **server** refuses what the screen hides. The CLAUDE.md `apiFetch` rule is for app code; it does not apply to a console check. |

### 0.10 The test users and what each one needs

| Person | Grants to give | Used by |
|---|---|---|
| **Admin** | everything | all |
| **Mechanic** | `assembly.view` + `assembly.edit`, and nothing else | §1.11, §5.2, §5.3, §10.2 |
| **Supervisor** | `assembly.view`, `assembly.approve`, `bins.edit` | §4, §5, §2 |
| **Outward clerk** | `deliveries.view`, `deliveries.edit`, `customers.edit` | §6, §9 |
| **Outward approver** | `deliveries.approve` | §6.10, §7 |
| **Transfer raiser** | `transfers.view`, `transfers.create` | §6.7 (this is who the shortage push goes to) |
| **Transfer approver** | `transfers.approve` | §6.9, §7 |
| **Inbound approver** | `inbound.approve` | §7.4 |
| **Audit approver** | `stock_audit.approve` | §3.6, §7.6 |
| **Star setter** | **`delivery_priority.edit`** (new module, no page of its own) | §6.11 |
| **Read-only** | `deliveries.view` only, nothing else | every "the server refuses it too" step |

### 0.11 Two things that are off until somebody configures them

- **Push notifications.** They ship with the master switch **off**. Settings → Notifications →
  Push has the switch, the provider credentials and the per-event table. Every step below that
  mentions a push is **optional** — skip it and the rest of the walk still stands.
- **Google Contacts.** Nothing is connected out of the box. §9 needs the one-time Google Cloud
  setup written out in the plan §3.9a (project, People API, consent screen **published**, OAuth
  client, redirect URI `<origin>/api/integrations/google-contacts/callback`). Skip §9 entirely
  until that is done; no other section depends on it.

---

## 1. The sidebar, the menu and the new permission (R27–R34, P5)

Run `npm run db:seed:rbac` (§0.4) first, then reload the app.

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 1.1 | Look at the **Operations** group in the sidebar | Two rows: **Build-Line Assembly**, then **Stock Management**. Assembly is first. | Operations is meant to read build line, then stock (R27). | |
| 1.2 | Click the words **Stock Management** | It only opens and closes. **It does not navigate anywhere.** The whole row is one button with a chevron. | R28, P5: the parent has no route any more. If it navigates, the seed did not run. | |
| 1.3 | Look at its children, in order | **Stock & inventory**, then a thin horizontal line, then **1 Inbound**, **2 Outbound (delivery & dispatch)**, **3 Stock transfer**, **4 Stock audit**. | The divider comes from data (`inbound.dividerBefore`), not from a module key in code. | |
| 1.4 | Type `/stock-management` in the address bar | The old hub page still loads. | R28: it is reachable by URL, just not from the menu. | |
| 1.5 | Look for **Categories**, **Brands**, **Barcode & Labels**, **Warehouse Bins**, **Stores**, **Warehouses** | None of them is in the menu, on any device. | R29, R32, R33: they became chips, a tab and a settings screen. Their permissions still exist. | |
| 1.6 | Look for a **Sales** group | **Customers**, **Customer Complaints**, **Second-Hand Cycles**. | R31. | |
| 1.7 | Look in **Accounts** | **POS & Settlement** is there, not in Operations. | R30. | |
| 1.8 | Admin → **Settings** → **Store Management** | It opens `/stores` with three tabs: **Stores**, **Warehouses**, **Bins**. The address becomes `/stores?tab=stores`. | R32. | |
| 1.9 | Click each tab, then reload the page | The address changes to `?tab=warehouses` / `?tab=bins` and a reload lands on the same tab. The Bins tab is the whole old `/bins` screen. | | |
| 1.10 | Open `/bins` directly | The same bins screen, unchanged. | The old URL was kept on purpose. | |
| 1.11 | Open the menu on a **phone** (or the hamburger below 1024 px), and `/more` | The same shape: expand-only Stock Management, the divider, the Sales group. | Four different renderers draw this menu; they must agree. | |
| 1.12 | Open `/stock` | Under the header, three pills: **Categories** (→ `/categories`), **Brands** (→ `/more/brands`), **Assembled vs unassembled** (→ `/stock/condition`). | R33: the two that left the menu are reachable from the screen that uses them. | |
| 1.13 | Sign in as a user with **no** `categories.view` | The **Categories** pill is not drawn. | The chips are permission-gated like everything else. | |
| 1.14 | Team → Roles & Permissions | A module **Delivery Priority (★)** with one permission, **Edit Delivery Priority (★)**. | R19: ★ is its own grant, so it can be given to counter staff without giving them anything else. | |

---

## 2. Existing stock gets home bins, unit codes and labels (R39–R41, R46, P8, P10, P13)

Work on `/stores?tab=bins` (or `/bins`). You need `bins.edit`, and `barcode.create` to print.

### 2.1 A home-bin rule with a subcategory

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 2.1.1 | Press **Home Bin Rules** | A modal "Home Bin Rules". Pick the **Warehouse Scope** first. | A rule belongs to one warehouse. | |
| 2.1.2 | In **Add New Home Bin Rule**, pick a **Category** that **has** children | A **Subcategory \*** picker appears, with the help line "A rule always names a category with nothing under it, so it cannot be ambiguous about which products it covers." | P13: the owner asked for an explicit subcategory when one exists. | |
| 2.1.3 | Try to save without picking the subcategory | Refused: `Choose a subcategory of <category name>`. | | |
| 2.1.4 | Pick a **Category with no children** instead | The Subcategory field is **not shown** at all. Saving works. | P13 again: no pointless field. | |
| 2.1.5 | Pick a Brand, the subcategory and a **Home Bin \***, press **Save Rule** | The rule appears under "Active Rules (n)" reading `Brand + category path → BINCODE (name)`. | | |
| 2.1.6 | Console: `call("/api/bins/home-rules", "POST", { warehouseId: "<id>", categoryId: "<a parent with children>", binId: "<id>" })` | **400** with the same `Choose a subcategory of …`. | The screen is not the only gate. | |

### 2.2 Apply the rule to stock that is already here (R40, P10)

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 2.2.1 | After saving, the **Apply to existing stock** panel opens by itself (or press it on the rule row) | "A rule only places what arrives next. This moves what is already here into **BINCODE** — including items currently in another bin." then "Working out what would move…" | R40. | |
| 2.2.2 | Read the dry run | **Moving N item(s)**, listed per product as `×qty from <bin code>` or `from no bin`. Items already in the rule's bin are not listed. | P10 (b): everything that matches moves, including items placed elsewhere — but you see the list before anything happens. | |
| 2.2.3 | If any item is in a no-assembly bin | A second list: "Skipped N — no-assembly items cannot go into a bin that holds items needing assembly". | P6: the one-way rule is never broken silently. | |
| 2.2.4 | Press **Move N item(s) into BINCODE** | "Moving…", then `N item(s) moved into BINCODE.` If more than 1000 matched, it adds `M still to go — press again.` | 1000 units per press is the cap. | |
| 2.2.5 | Open the destination bin | The items are in it. Its "Recent Movements In / Out" lists each one with the reason `Home bin rule applied to existing stock → BINCODE`. | Every move is logged; nothing moves without a trace. | |

### 2.3 Unit codes for stock that has none (R41, R46, P8)

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 2.3.1 | With the warehouse filter set to **one warehouse**, press **Generate unit codes** | A modal. With the filter on **All**, the button is disabled and its tooltip reads "Choose one warehouse first". | Codes are counted per warehouse. | |
| 2.3.2 | Read the dry run | Four numbers: codes to create · products · with no bin yet · into no-assembly bins. A blue note: "Every item gets a code, whatever condition it is in — the codes are created **unassembled**, exactly as an inward creates them. Cycles that are already built are corrected by the unit-level stock count, not here." | P8: generating a code is only code creation. Built cycles are corrected by the audit in §3.6, not here. | |
| 2.3.3 | Note the count | It is `warehouse stock − unit records that already exist`, per product. | Nothing is double-coded. | |
| 2.3.4 | Press **Create N code(s)** | "Creating codes…", then the label sheet opens with `N new code · <warehouse>`. If more than **500** were due, only 500 are made and the heading adds `… still without a code` — press again. | R46: one separate code per physical item. | |
| 2.3.5 | SQL: `select count(*), count(distinct "unitCode") from "InventoryUnit";` | The two numbers are equal. | Codes are never shared between items. | |
| 2.3.6 | Do the same from inside a bin drawer (**Generate codes**) | The scope line reads `Bin <code>` and only that bin is counted. | | |

### 2.4 Print the labels (R46)

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 2.4.1 | On the sheet that opened, look at one label | A Code 128 barcode, the code in large letters (`U-000087`), the product name, the SKU, and the bin code. | This is what gets pasted on the cycle. | |
| 2.4.2 | Press **Print** | A print dialog. Labels are 52 mm cells and never break across a page. If nothing happens: "The print window was blocked. Allow popups for this site and try again." | | |
| 2.4.3 | Reprint from a bin: open the bin drawer → **Print labels** | Every item in that bin. The button is disabled when the bin is empty. | | |
| 2.4.4 | Reprint one item: the **Label** button on a unit row | One label. | | |
| 2.4.5 | Reprint a whole shipment: open a **DELIVERED** inbound shipment → **Print unit labels for this shipment** | `/units/labels?inboundShipmentId=…` with every unit from it. | | |
| 2.4.6 | Try to print more than 500 | Refused: "That is N labels. Print at most 500 at a time — narrow it down to one bin or one shipment." | | |
| 2.4.7 | Sign in as a user without `barcode.create` and open `/units/labels?binId=…` | The sheet refuses (403 from the API). | | |

---

## 3. Units stay in sync with the stock (R7, R11, P1–P4, Q42, Q43)

This is the plan's §4.8 worked example, end to end. Use one model — call it **Hero Sprint 29** —
one store, its **godown** and its **floor**. After every step, check three screens:
`/stock` (the count), `/stock/condition` (assembled vs unassembled) and
`/assembly?tab=awaiting` (what the build line offers).

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 3.1 | **Receive 10** into a godown **bin** on `/inbound/<id>` | `/stock` godown 10. `/stock/condition` godown **10 unassembled**. Awaiting lists 10 rows, each with its own `U-…` code. | P1: receiving into a bin now writes the warehouse count as well. Before this the warehouse stayed at 0 while units existed there. | |
| 3.2 | SQL: `select w.code, s.quantity from "StockLevel" s join "Warehouse" w on w.id=s."warehouseId" where s."productId"='<id>';` | The godown row exists and reads 10. | The same check, at the level the outward guard reads. | |
| 3.3 | **Build 3** of them (assign on Awaiting, start and finish in My Build Queue) | `/stock` godown still 10. `/stock/condition` godown **3 assembled · 7 unassembled**. Awaiting is down to 7. | Condition changes; the count does not. | |
| 3.4 | **Transfer 6** godown → floor: raise it on `/transfers/new`, approve, dispatch, receive | `/stock` godown 4 · floor 6. `/stock/condition`: the **3 assembled plus the 3 oldest unassembled** are now on the **floor**; 4 unassembled stay in the godown. Awaiting shows 4 godown rows and 3 floor rows. | This is the defect the plan exists to fix — before it, all 10 units stayed in the godown for ever. | |
| 3.5 | **Deliver 5** from the floor (§6 covers the guard; here just complete one) | `/stock` floor 1. The 5 units are `SOLD` and gone from every list. SQL: `select status, count(*) from "InventoryUnit" where "productId"='<id>' group by 1;` shows 5 SOLD. | A sold cycle must never be offered to a mechanic again. | |
| 3.6 | **Audit the godown** with 1 missing: `/stock-audit` → count that product with the two steppers **Assembled** and **Unassembled** (enter `0` and `3`) → complete → approve and apply | `/stock` godown 3. One godown unit becomes `LOST`. `/stock/condition` godown 3 unassembled, floor 1 unassembled. | Q42: the audit records the split, so the condition page is corrected by counting, not by guessing. | |
| 3.7 | On the same audit, enter a split for a product whose cycles are **already built** (e.g. 4 assembled, 0 unassembled) | After approval those units read **assembled** — and they **keep the codes already printed on them**. | R46 + P9: a correction must never invalidate a label that is already stuck on a cycle. | |
| 3.8 | The approver **is** the person who counted | The Approve button is there, and it works. | R23, Q15: self-approval is allowed when the role holds `approve`. The old block is gone. | |
| 3.9 | **Reset** a warehouse: `/stock-audit` → "Reset a warehouse for a unit-level audit" → store → warehouse → type `RESET_STOCK` → **Reset <warehouse>** | A line like "<warehouse> reset: N stock cleared across M products, K held released, N unit records cleared." Its units read `RESET` in SQL, and their open build tasks are `CANCELLED`. | P3: history is kept. "Reset" is distinguishable from "lost". | |
| 3.10 | Try the reset as a user without `stock_audit.approve` | The card is not drawn, and `call("/api/stock-reset/warehouse","POST",{warehouseId:"…",confirm:"RESET_STOCK"})` → **403**. | | |
| 3.11 | **Delete** an inbound shipment that was received | Its unsold units are retired (`LOST`), not left behind on Awaiting. | P2. | |
| 3.12 | Run the Zoho **cleanup** in Settings → Integrations (only if you use it) | The dry run reports units and bins affected, and the run happens inside transactions, in chunks. | P4 (3): a cleanup must clear everything in its own scope. | |

---

## 4. Bins that need no assembly (R42, P6, P6a, P6b, P7)

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 4.1 | Bins → **New Bin**. Read the last checkbox | "Items here **need no assembly** (spares, accessories). They never show on the build line, and once an item is in such a bin it cannot be moved into a bin that holds items needing assembly." and, in amber, "This cannot be changed later — to change it, create another bin and move the items." | The owner asked for the flag at creation only. The screen says so before you commit. | |
| 4.2 | Create the bin with that box ticked, e.g. `GODOWN-S07` | The bin card carries a **No assembly** badge. | | |
| 4.3 | Open **Edit** on it | The flag is a read-only grey panel: "Items here **need no assembly**. Set when the bin was created and cannot be changed." | P6a. | |
| 4.4 | Console: `call("/api/bins/<id>", "PATCH", { nonAssemblable: false })` | **400** "Whether bin `<CODE>` holds items that need assembly is set when the bin is created and cannot be changed. Create a new bin with the right setting and move the items into it." | The server holds the same line. | |
| 4.5 | Move some spares into it (bin drawer → **Relocate**, or a put-away) | They go in. | P6b: putting an item into a no-assembly bin is allowed, and it stamps the item. | |
| 4.6 | Open `/assembly?tab=awaiting` | Those items are **not** listed. | R42. | |
| 4.7 | Open `/assembly?tab=no-assembly` ("**No Assembly**") | They are listed there: code, product, warehouse, bin. No checkboxes, no Assign, no sort dropdown — it is a read-only list. | R42: they are visible, just not buildable. | |
| 4.8 | Open `/stock`, press the **No assembly** chip | Only products holding such items, with the help line "Products holding items that need no assembly — stored in a non-assemblable bin. They never appear on the build line." | | |
| 4.9 | Open `/stock/condition` | A third column, **No assembly**, beside Assembled and Unassembled. | P7: they are not silently counted as unassembled. | |
| 4.10 | Try to move one of those items into a **normal** bin | Refused: "`U-0000xx` needs no assembly and cannot go into bin `<CODE>`, which holds items that need assembly. Pick a no-assembly bin." | P6 (2). | |
| 4.11 | On that unit's row, press **Needs assembly** (needs `bins.edit`) | A modal "`U-0000xx` needs assembly" explaining the rule, a required **Why? \*** box, and **Mark as needing assembly**. | P6b correction: a spare bin used by mistake must be fixable without a database edit. | |
| 4.12 | After that | The unit reappears on Awaiting and can be moved to a normal bin. It stays in its current bin until you move it — and putting it back into a no-assembly bin stamps it again. | | |
| 4.13 | Save a home-bin rule whose bin is non-assemblable, then apply it | The bin list shows the bin suffixed "— no assembly", and any **assemblable** item is listed as skipped, not moved. | | |

---

## 5. The build line (R1–R6, R8, R9, R20, R29, P6)

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 5.1 | Open `/assembly` as ADMIN and click each tab | The address becomes `?tab=awaiting`, `?tab=tasks`, `?tab=mine`, `?tab=no-assembly`, `?tab=labels`. A reload keeps you on the same tab. The tab names are **Awaiting Assignment**, **Assembly Tasks**, **My Build Queue**, **No Assembly**, **Labels**. | R1: a tab you can send to somebody. | |
| 5.2 | Sign in as the **mechanic** (only `assembly.edit`) and open `/assembly?tab=awaiting` | You land on **My Build Queue** instead, and the address is rewritten to `?tab=mine`. No error. | R2: a tab you may not see falls back to one you can. | |
| 5.3 | As the mechanic, open `/assembly?tab=banana` | Same fallback, no error page. | | |
| 5.4 | Start a build, then press **Put On Hold** | A sheet "Hold `U-…` — what is the issue?" with exactly **two** buttons: **Issue with the cycle** and **Issue on the workfloor**, and the line "The timer freezes until you tap Resume." | R3: the six old reasons and the free-text box are gone. | |
| 5.5 | Tap one of them | The sheet closes at once. No confirm, no undo bar. The card turns amber and reads **Paused (On Hold)**. | R4: one tap. A mis-tap is fixed with **Resume Build**. | |
| 5.6 | Note the elapsed time, then **reload the page** | The same frozen number is still shown — not `00:00`. | R5, defect 1. This was broken before. | |
| 5.7 | Press **Resume Build**, work a minute, hold again | The total hold time accumulates ("Total hold time: n mins"). | | |
| 5.8 | As the **supervisor**, open `?tab=tasks` | A section **Builds on hold** at the top: unit code, ★ chip if starred, the issue chip, the product, `Mechanic: …`, `On hold since: … · 2h 10m`. | R6, defect 10 — the Tasks tab never showed the reason before. | |
| 5.9 | Press **Add note**, type something, **Save note** | The note shows under the hold, and the mechanic sees `Supervisor: …` on the held card. | R6: the mechanic adds nothing, a supervisor may. | |
| 5.10 | On a hold whose issue is **Issue with the cycle**, press **Raise vendor issue** | The new-issue page opens with the Description already filled: `U-000481 · Hero Sprint 29 · Issue with the cycle`, and the brand filled when the unit's shipment names a vendor. | A cycle fault is the vendor's problem; it should take one tap to say so. | |
| 5.11 | The button on a **workfloor** hold | It is not there. | A workfloor problem is not the vendor's. | |
| 5.12 | On **Awaiting**, use the filter bar | Search (model, unit, frame no., SKU, bin), **Brand**, **Location**, **Bin**, and a sort of **Sort: delivery day** / **Sort: received date** / **Sort: model**. | R9. | |
| 5.13 | Tick a few rows, then press **Select all N matching** | The count line shows what is selected; the bar at the bottom reads `Assign 37`. Above 500 it selects the first 500 and says "Selected the first 500 — one Assign takes at most 500. Narrow the filter for the rest." | R8: no page limit may hide a unit from selection. | |
| 5.14 | Press **Assign N**, pick a mechanic | All of them are assigned in one go, and they leave the list. | | |
| 5.15 | Scroll to the bottom | **Load more (N left)** — the list pages 100 at a time. | | |
| 5.16 | After §6.11 has starred an outward, look at the top of Awaiting, Tasks and My Build Queue | The ★ rows are first, each with the delivery day (`Sat 20 Sep`) and `For INV/… · delivery …`. There is **no ★ tab**. | R20, Q20. | |
| 5.17 | On a ★ row, press **Swap** | A sheet "Swap `U-…`" listing other unheld units of the same product in the same warehouse. Picking one moves the hold: "`U-000090` now held for INV/… instead of `U-000087`." | Q41: the app picks, a person can correct it. | |
| 5.18 | Open the **Labels** tab | The Search & Scanner panel, exactly as `/scanner`. | R29: Barcode & Labels became this tab. | |
| 5.19 | Leave the Labels tab while the camera is on | The camera stops. | | |

---

## 6. The outward (R12–R17, R19–R21, R26a, R44, R45, P15–P19)

Set up one outward whose floor is short and whose **godown has the stock**.

### 6.1 The warning names where the stock is

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 6.1.1 | Schedule that outward | It is **accepted**. Scheduling is never blocked. | R13, A26/A37. | |
| 6.1.2 | Look at the red card on the detail | "Stock not reserved — BCH Floor is short", the line `0 / 2` with "available / needed on BCH Floor", and **a grey line under it naming the godown**, e.g. `2 in BCH Godown`. | R13: the person is told where the stock actually is. | |
| 6.1.3 | Try **Out for delivery** | Refused (409) with `Hero Sprint 29: 0 on BCH Floor · 2 in BCH Godown. Needs 2. A transfer is needed.` | R13: the hard block is at dispatch, not at scheduling. | |
| 6.1.4 | Try it with nothing anywhere in that store | The same, ending `None in this store's godowns either — use Find stock.` | | |
| 6.1.5 | Try a **walk-out** while the floor is short | Refused with the same sentence. | | |
| 6.1.6 | *(optional, needs push on)* Sign in as the **transfer raiser** on another device | A push arrives: **Transfer needed — INV/…** with the product, what is on the floor and what is in the godown. | R14: it goes to every holder of `transfers.create` except the person who hit the wall. | |
| 6.1.7 | Batch dispatch two outwards, one of them short | The whole batch is refused, naming the invoice: `Invoice INV/…: Hero Sprint 29: …`. Neither delivery changes. | R13 covers the batch too. | |

### 6.2 Find stock and raise a transfer (R45, P15, P16)

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 6.2.1 | On the red card, press **Find stock** | A panel opens with **Look in** — a store list, the outward's own store preselected and suffixed "(this outward's store)". | P16 (1): the store is chosen first. | |
| 6.2.2 | Read the result | Per short line: `SKU · needs 2, 0 on BCH Floor · short 2`. Per source: the warehouse name with `· floor` or `· godown`, then `2 usable · 1 built, 1 unbuilt`. The outward's own floor is never listed. | P15: floors and godowns, of any store you pick. | |
| 6.2.3 | Pick another store with no stock | "Nothing in this store. Try another store." | | |
| 6.2.4 | Type a quantity against a source and press **Create transfer request (2)** | A transfer is created. The footnote says "One request per source warehouse, sent for approval. The delivery challan or tax invoice is attached before dispatch, not now." | P16: the outward person does not have the document yet. | |
| 6.2.5 | Look at the panel afterwards | A section **Transfers raised for this outward** with the order number (a link), `BCH Godown → BCH Floor`, and the status `PENDING`. | | |
| 6.2.6 | Open that transfer | An orange line: "Raised for an outward — this stock is needed for a customer order". | | |
| 6.2.7 | Ask for more than is there (reload the page in another tab and sell some first) | Refused: "Hero Sprint 29: BCH Godown has 1 usable, 2 asked for. Reload and choose again." | | |
| 6.2.8 | As the **transfer approver**, open `/approvals` | The request is in **Stock transfers**, summary `BCH Godown → BCH Floor, 1 line(s) · for an outward`. Approve it. | P17. | |
| 6.2.9 | Try to **Dispatch** it without a document | Refused: "Attach the delivery challan first." (or "…the tax invoice first." for a store-to-store move). | P16: the document is required before the van leaves, not before the request. | |
| 6.2.10 | Attach the document, dispatch, then **receive** it | Stock leaves the godown at dispatch and arrives on the floor at receive — warehouse count, bin count and the units themselves. | P18. | |
| 6.2.11 | Look at the outward straight after the receive | The red card is **gone**: the stock is already held for it. Nobody pressed "Reserve stock now". | P19: between receive and reserve, a walk-in could otherwise take the customer's cycle. | |
| 6.2.12 | Now press **Out for delivery** | Accepted (once §6.3 has approved it). | R17. | |

### 6.3 Approval before dispatch (R26a, Q16)

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 6.3.1 | On an outward, look at the approval card | "Not approved. Dispatch and Ship need an approval first; a walk-out does not." | R26a. | |
| 6.3.2 | Look at the action buttons | **Dispatch** and **Mark Shipped** are disabled, with the tooltip "Approval is needed before dispatch". | | |
| 6.3.3 | Press **Request approval** (needs `deliveries.edit`) | The card reads "Waiting for approval · asked <time>". | | |
| 6.3.4 | As the **outward approver**, press **Return** | A note box "What needs correcting?" — **Return for correction** is disabled until you type something. | R25: sent back with no reason is what this replaced. | |
| 6.3.5 | Back as the clerk | An orange card: **Returned for correction**, the note, and "Fix it and request approval again. Dispatch stays blocked until it is approved." The button now reads **Request approval again**. | | |
| 6.3.6 | Request again, then **Approve** | "Approved for dispatch · <time>". Dispatch and Mark Shipped come alive. | | |
| 6.3.7 | Console as the clerk: `call("/api/deliveries/<id>", "PUT", { status: "OUT_FOR_DELIVERY" })` on an unapproved outward | **409** "This outward has not been approved. Request approval before dispatching." | The screen is not the gate. | |
| 6.3.8 | Walk out an outward that was never approved | It works. | R26a: the customer is standing there. | |
| 6.3.9 | Open a **Dummy** delivery (no floor matched its invoice) | No approval card, no ★, no Find stock. Every action is refused with the Dummy message. | R26a: dummies are excluded from all of this. | |
| 6.3.10 | The approver approves an outward **they** requested | Allowed. | R23. | |

### 6.4 ★ priority (R16, R19–R21)

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 6.4.1 | As the **star setter**, open a short outward | A button **Mark as priority**. | R19: the new `delivery_priority.edit` grant. | |
| 6.4.2 | Press it | It becomes **Priority — tap to clear**, with "Its cycles are built and moved first. Any short line is held in this store's godown." | | |
| 6.4.3 | Open `/assembly?tab=awaiting` **straight away** | The godown units for that outward are at the top with a ★ and the delivery day — **before any transfer is approved**. | R16, Q12: the mechanic starts building now, not after the paperwork. | |
| 6.4.4 | Check what was reserved | Only units in that store's **godown** warehouses, only as many as the floor is short. | Q35. | |
| 6.4.5 | Star an outward whose floor already holds the stock | Nothing is reserved; it is simply starred. | | |
| 6.4.6 | Press **Priority — tap to clear** | The ★ goes, the reserved units are released, and a build already in progress **carries on**. | R21. | |
| 6.4.7 | A user without `delivery_priority.edit` | No button. `call("/api/deliveries/<id>/priority","POST",{starred:true})` → **403**. | | |
| 6.4.8 | Check the activity log | `priority_set` with "N unit(s) reserved in the godown for M short line(s)", and `priority_cleared` with "N reserved unit(s) released". | R21: every set and clear is logged. | |
| 6.4.9 | Star a Dummy, or a delivered outward | Refused: the Dummy message / "This outward is already closed." | | |

### 6.5 Bin level and the customer's contact

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 6.5.1 | Deliver an outward whose cycle sat in bin `FLOOR-R3` | That bin's quantity drops by one, in the same action. | R38: the outward reduces the floor **and** the bin. | |
| 6.5.2 | Move a unit between two bins | Both bins' counts follow. | P11: the bin count is recounted from the units, so it cannot disagree with itself. | |
| 6.5.3 | Save a customer on an outward | It saves in the app only, as before. Under the green line: "To put this number on the shop phones, tick it on **Customers** and press Sync to Google." | P14c: Google can never block an outward. | |

---

## 7. Doer and approver (R22–R26)

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 7.1 | As an approver, open `/approvals` | **Requests** — "Everything waiting for an approval you can give". Sections in order: **Outwards**, **Stock transfers**, **Inbound shipments**, **Stock audits**. | P17: built from the records, so it can never disagree with them. | |
| 7.2 | Look at a row | The reference, `Asked by <name>`, the age (red once it passes 24 h), a one-line summary, and **Reject** / **Approve**. An amber **Resubmitted** badge on records that came back. | | |
| 7.3 | Look at the **Stock audits** section | Rows have **Open to review** instead of Approve. | Approving an audit means choosing verify-only or "apply the counts", and sometimes a warehouse. A one-tap Approve would pick one silently. | |
| 7.4 | Press **Approve** on a transfer here | The same thing happens as on the transfer's own screen, and the banner confirms it. | One implementation of each decision, not two. | |
| 7.5 | Press **Reject** here | "Send `TRF-…` back?" with "What needs correcting?", **Keep it** / **Send back**. Send back is dead until you type. | | |
| 7.6 | Look at the top bar on a **phone** | A clipboard icon with a red count, linking to `/approvals`. It shows nothing at zero, and nothing for a person who approves nothing. | | |
| 7.7 | Approve something, then navigate | The count goes down on the next navigation. **It does not poll** — this app has no timers. | | |
| 7.8 | A user with no `approve` grant opens `/approvals` | "You do not approve anything yet." — not a 403. | The badge links there for everybody. | |
| 7.9 | **Transfer, returned:** approve-screen → Reject with a note | The transfer's status is **RETURNED** (not Rejected). The chip on `/transfers` reads **Returned**. | R25. | |
| 7.10 | As the creator, open it | An orange banner "Sent back for correction by <name>", the note, and "Fix the lines or the document below, then Resubmit." Buttons **Edit items** and **Resubmit**. | | |
| 7.11 | Press **Edit items** | A sheet "Correct `TRF-…`" — change quantities, remove lines, add a product, **Save lines**. | The **same record** is fixed; nothing is cancelled and no stock has moved. | |
| 7.12 | Press **Resubmit** | Back to `PENDING`, and the approver sees it again with a **Resubmitted** badge. | | |
| 7.13 | A different user (not the creator, without `transfers.create`) tries | `call("/api/transfer-orders/<id>/resubmit","POST",{})` → **403** "You can only resubmit a transfer you raised." | | |
| 7.14 | **Inbound, returned:** open an unapproved shipment as the **inbound approver** | **Reject** beside **Approve Inward**. Reject asks "Send `SHP-…` back?" with a note. | R25, Q17 — inbound Reject is new. | |
| 7.15 | As the creator | An orange banner "Sent back for correction", the note, and **Fixed — resubmit for approval**. | | |
| 7.16 | Try to approve it while it is returned | Refused: "This shipment was sent back for correction. It can be approved once the creator resubmits it." | | |
| 7.17 | Resubmit, then approve, then receive | Normal flow resumes. | | |
| 7.18 | A person who is **not** an approver looks at an unapproved shipment | An amber card: "Awaiting Approval — Anyone whose role can approve inbound must sign this off before delivery." | R22: no names in code, only grants. | |
| 7.19 | **The error rule:** Settings → **Approvals** | "What counts as an error" with four switches: *A correction soon after an approval* (on), *A short receipt* (on), *A reversal* (on), *A customer flag* (off). Then "How soon after an approval a correction counts" with `1 day` / `3 days` / `7 days` / `14 days` / `30 days` chips — **7 days** is the default. | R26, Q18. | |
| 7.20 | Change a switch, press **Save rule** | "Rule saved — the table below is recalculated from it". | | |
| 7.21 | Scroll to **Approver error rate** (needs `reports.view`) | Columns **Approver · Approvals · Errors · Rate**, with a sub-line `n corrected · n short · n reversed · n flagged`, and the caption "This is here to find a pattern, not to rank people." | | |
| 7.22 | Make one: approve an inbound, then correct that product in an audit within the window | One error appears against that approver. Set the window to **1 day** and it disappears. | R26: the rule is a setting, and the table is recomputed from stored events. | |
| 7.23 | Receive a transfer short | A `SHORT_RECEIVED` error against whoever approved it, and the missing units are marked `LOST`. | | |
| 7.24 | Cancel an **approved** transfer, or delete an **approved** shipment | A `REVERSED` error against the approver. | | |
| 7.25 | Flag a delivery | Recorded, but not counted while the flag switch is off. | R26. | |
| 7.26 | A user without `settings.edit` opens the page | The switches are read-only: "You can read this rule but not change it — that needs the settings edit permission." | | |

---

## 8. Categories as Zoho has them (R43, R47, P12, P12a, P13)

**This wipes every category. Take the snapshot in §0.2 first.** The script refuses to run without
one from the last 60 minutes.

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 8.1 | `npm run db:wipe:categories` | It prints the target database and host, then a list of what it will delete: categories, products moved to Uncategorized, inbound shipment categories nulled, category home-bin rules deleted. Then `Type the database name (<db>) to continue:`. | P12a (b): the owner asked for a database-level clear. | |
| 8.2 | Type something else | "Not confirmed — nothing was deleted." | | |
| 8.3 | Type the database name | It finishes with counts, then "verified: only Uncategorized is left, and every product is filed under it." and two next steps. | | |
| 8.4 | Run it with no recent snapshot | Refused: "no snapshot of "<db>" in backups/ from the last 60 minutes." | Rule 9: the snapshot is the rollback. | |
| 8.5 | Open `/categories` → **Fetch from Zoho** | A sheet listing what Zoho has: new rows, rows that will be linked, rows already linked. | Needs `categories.fetch`. | |
| 8.6 | Tick everything and **Import** | A result dialog "Imported from Zoho" with **Created**, **Linked to existing**, **Skipped**, plus notices: "N categories were placed under their Zoho parent.", "N products moved to their Zoho category.", "N products have no category in Zoho … and are filed under Uncategorized." | R47, P12: Zoho is the source of both the tree and each product's category. | |
| 8.7 | Look at `/categories` | A **tree**: children indented under their parent with a chevron, plus **Collapse all** / **Expand all**. Each row shows its product count and `n sub`. | R43. | |
| 8.8 | Compare one parent and child with Zoho | The same parent, the same child. | | |
| 8.9 | Create a category | The form has a **Parent (optional)** picker with "Top level (no parent)". | P12: local edits are possible; nothing is pushed back to Zoho. | |
| 8.10 | Edit a category's parent | The picker excludes the category itself and its own subtree. | A loop is impossible. | |
| 8.11 | Open `/stock` → Filters → **Category** → pick a **parent** | You get the parent's products **and its children's**. | R43, P13 (2). | |
| 8.12 | Pick a **child** | Only that child's products. | | |
| 8.13 | Check the back arrow on `/categories` | It goes to `/stock`, not to a menu item. | Categories left the menu. | |
| 8.14 | Re-create the home-bin rules that used a category | They were deleted by the wipe — the script says so in its next steps. | | |

---

## 9. Customers on the shop phones (R44, P14, P14a–P14d)

**Optional.** Do the Google Cloud setup (plan §3.9a) first, or skip this section.

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 9.1 | Settings → Integrations → **Google Contacts** | A card: "Customers synced from /customers land in the shop's Google account, so every signed-in phone has them." with **Not connected**. | P14a: one shop account, connected once by an admin. | |
| 9.2 | Press **Set up**, paste the OAuth client ID and secret, press **Connect Google** | Google's consent screen. Sign in as the **shop** account and allow. You come back to "Google Contacts connected." and the card shows **Connected** with the account. | | |
| 9.3 | Save a customer on an outward | Saved in the app. **Google is not contacted.** | P14c: Google can never make an outward fail. | |
| 9.4 | Open `/customers` | A **Google** column reading **Not in Google**, row checkboxes, and the chips **All / Not in Google / In Google / Sync failed**. | | |
| 9.5 | Press **Select all not synced (n)**, then **Sync to Google (n)** | "Syncing…", then a line like `Google: 3 added, 1 already there, 1 failed.` Failures are listed with their reason. | | |
| 9.6 | Check the shop's Google Contacts | The new contacts are there, in a group **BCH Customers**, with the `+91-` phone, the alternate number and a note like `BCH · INV/25/023069 · 16/09/2026`. | P14b. | |
| 9.7 | Sync the same customers again | They report **already there** — nothing is duplicated and nothing is overwritten. | P14b: a repeat customer must not pile up. | |
| 9.8 | Check a phone signed into that account | The contact appears after the phone's next contacts sync. | This is what "save to the phone" means here — a browser cannot write contacts silently. | |
| 9.9 | Press **Disconnect**, then try to sync | **409** "Google Contacts is not connected. An admin can connect it in Settings → Integrations." | | |
| 9.10 | Try to sync more than 200 at once | **400** "At most 200 customers in one sync. Do it in pages." | | |
| 9.11 | A user without `customers.edit` | No Google column, no buttons, and the API returns 403. | | |

---

## 10. The dashboard (R35–R37, Q29, Q30)

One dashboard for everybody. Every card is decided by `GET /api/dashboard/overview`, which
checks each grant on the server — the page draws exactly what comes back and decides nothing.

### 10.1 Every card and the grant behind it

Read from the route, not from the plan. The **Stuck** labels print the current hour settings,
so "> 24 h" changes when you change the setting in §10.4.

| Row | Card | Shown when the viewer holds | Opens |
|---|---|---|---|
| **Money** | Payable · Receivable · Overdue bills | `accounts.view` | `/accounts` · `/receivables` · `/bills` |
| | Stock value | `stock.view` **or** `reports.view` | `/stock` |
| **Stuck** | Approvals waiting > 24 h | any one of `inbound.approve`, `deliveries.approve`, `transfers.approve`, `stock_audit.approve` | `/approvals` |
| | Outwards short on their floor | `deliveries.view` | `/deliveries` |
| | On hold > 24 h · cycle, and · workfloor | `assembly.approve` | `/assembly?tab=tasks` |
| | On hold > 24 h · **no issue recorded** | `assembly.approve`, and only when the count is above zero | `/assembly?tab=tasks` |
| | Inbound not received > 72 h | `inbound.view` | `/inbound` |
| **In progress** | ★ builds open · Builds in progress | `assembly.view` | `/assembly?tab=awaiting` · `?tab=tasks` |
| | Transfers in transit | `transfers.view` | `/transfers` |
| | Audits in progress | `stock_audit.view` | `/stock-audit` |
| **Done today** | Outwards handed over | `deliveries.view` | `/deliveries` |
| | Builds completed | `assembly.view` | `/assembly?tab=tasks` |
| | Transfers received | `transfers.view` | `/transfers` |
| | Inbound received | `inbound.view` | `/inbound` |
| **Stock by condition** | Unassembled units · Assembled units · No assembly · Oldest unassembled | `stock.view` | `/stock/condition` |

### 10.2 Walk it

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 10.2.1 | Open `/` as **ADMIN** | `Hello, <name>`, the date, the role, then **My Stock Audits** and **My Assembly Tasks**, then all five rows in this order: **Money · Stuck · In progress · Done today · Stock by condition**. | R35: one dashboard. The six variants and `pickDashboard` are gone — nobody lands on "whichever rung their role tripped first". | |
| 10.2.2 | Compare it with §10.1 | Every card in the table is there, and no card outside it. Money is in rupees, the rest are counts, "Oldest unassembled" is in days. | R36. | |
| 10.2.3 | Open `/` as the **mechanic** (`assembly.view` + `assembly.edit` only) | **My Assembly Tasks** at the top, then exactly two rows: **In progress** (★ builds open, Builds in progress) and **Done today** (Builds completed). **No Money row, no Stuck row, no Stock by condition.** | R36: a card appears only if the role holds its grant. A mechanic has no business seeing payables. | |
| 10.2.4 | Console as the mechanic: `call("/api/dashboard/overview")` | **200**, and the JSON contains only those two sections. The money figures are not in the response at all. | The API is the gate. A hidden card that is still in the payload is not hidden. | |
| 10.2.5 | Open `/` as a user with **no** dashboard grants at all | Not a 403 and not a blank page: "Nothing to show here yet." with "Your role does not carry any of the dashboard's figures. Your own work is listed above, and the menu has everything you can open." | The dashboard is everybody's landing page. | |
| 10.2.6 | Open `/` as the **outward approver** | An **Approvals waiting > 24 h** card. It is shown **even at zero** ("nothing is stuck" is what an approver opens the page for), with the hint `N waiting in total` when some are waiting but none has passed the threshold yet. | P17: the same rows as `/approvals` and the same count as the badge — all three read `listPendingApprovals`. | |
| 10.2.7 | Click it | `/approvals`, with the same requests listed. | | |
| 10.2.8 | Leave an outward scheduled but short (from §6.1) | **Outwards short on their floor** counts it, with the hint "Scheduled, stock not reserved — a transfer is needed". It counts from the moment it is scheduled — there is no hour threshold for this one. | R37. | |
| 10.2.9 | Hold two builds over the threshold, one for each reason | Two cards: **On hold > 24 h · cycle** and **· workfloor**. | R3: the two reasons are reported separately, never added together. | |
| 10.2.10 | If your database has holds from **before** this build | A third card, **On hold > 24 h · no issue recorded**, with the hint "Held before the two-option hold". It is absent when the count is zero. | Those holds carry one of the six old free-text reasons and no `holdIssue`. Folding them into cycle or workfloor would be a guess. | |
| 10.2.11 | Read **Stock by condition** | The four numbers equal the totals at the top of `/stock/condition`. | R11: one definition of "assembled", used by both screens. | |
| 10.2.12 | Check **Done today** just after midnight, or before 05:30 | It still shows *today's* work by the shop's clock, not yesterday's. | The day is the IST day, not a UTC date. | |

### 10.3 Change what "stuck" means (Q30)

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 10.3.1 | Settings → **Approvals** | Between the error-rule card and the error-rate table, a card **When the dashboard calls it stuck**: "The Stuck row on the home screen counts what has been waiting longer than these. An outward whose floor is short is stuck from the moment it is scheduled — that one is not a matter of hours, so it has no setting here." | Q30. | |
| 10.3.2 | Read the three rows | **Approvals waiting** (24), **Inbound not received** (72), **Builds on hold** (24), each a number box with `h` beside it. | These are the defaults. | |
| 10.3.3 | Change Approvals waiting to `1`, press **Save thresholds** | The card saves. Reload `/` — the card now reads **Approvals waiting > 1 h** and counts more. | The label is printed from the setting, so the dashboard can never show a threshold it is not using. | |
| 10.3.4 | Try to type `0` or `9999` | The box clamps to 1–720. `call("/api/settings/stuck-hours","PUT",{approvals:0,inbound:72,holds:24})` → **400**. | | |
| 10.3.5 | Open the page as a user **without** `settings.edit` | The boxes are read-only and the note says "You can read these but not change them — that needs the settings edit permission." The PUT returns **403**; the GET still works for everybody, because the dashboard labels print these numbers. | | |
| 10.3.6 | Put the numbers back to 24 / 72 / 24 | | | |

### 10.4 The Requests row in the sidebar

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 10.4.1 | As an approver with something waiting, look at the **desktop sidebar**, above the module groups | A row **Requests** with a red count on the right, linking to `/approvals`. It highlights when you are on that page. | `/approvals` is deliberately not a module (R22), so this row is hardcoded above the module tree. | |
| 10.4.2 | Approve everything, then navigate | The row **disappears** at zero. So does the phone's badge. | No empty row for a person with nothing waiting — and none at all for a person who approves nothing. | |
| 10.4.3 | Look at the phone top bar | The same count as a clipboard icon with a red pill. | One count, two shapes. | |

---

## 11. Notification buttons (R24, Q19)

**Optional.** Turn push on in Settings → Notifications → Push (master switch plus the provider
credentials) and allow notifications on the test device. Everything else in this document works
with push off.

**First, get the new service worker.** It is `bike-inventory-v3`. Open DevTools → Application →
Service Workers, tick *Update on reload*, reload, and check the active worker is v3 — an old
worker draws no buttons and the test will look like a failure.

| # | What to do | What you should see | Why it matters | ✓ |
|---|---|---|---|---|
| 11.1 | On **Android Chrome** or **desktop Chrome**, signed in as an approver, have somebody request an approval (a transfer, an inbound or an outward) | A notification with **two** buttons: **Approve** and **Open**. | R24, Q19. Two is all any browser draws. | |
| 11.2 | Note that the second button says **Open**, not Reject | Sending a record back needs a note (R25), and a notification cannot collect one — so it opens the record, where the note box is. | A noteless return is the exact defect the returned-record rule exists to fix. | |
| 11.3 | Tap **Approve** | The record is approved with no page open, and a second notification appears titled **Approved** with, for example, `TRF-000123 approved` or `Outward INV/25/023069 approved`. | The tap is a shortcut; the decision is still the same code the screen uses, and it re-checks the grant. | |
| 11.4 | Tap that result notification | The record opens. | A refusal is then one tap from being fixed. | |
| 11.5 | Check the record on screen | It really is approved, by you, and the approval is in the record's history. | Self-approval is allowed (Q15) and is recorded against you for the error-rate report. | |
| 11.6 | Tap **Approve** again on the same (still visible) notification | **Not approved** — "This transfer has already been reviewed." / "Already approved" / "This outward is already approved." Nothing is approved twice. | A notification can sit on a lock screen for a day, and another approver may have dealt with it. | |
| 11.7 | Tap **Open**, or the body of the notification | The record's own screen — a tab you already have open is focused and steered there, otherwise a new one opens. | | |
| 11.8 | Sign out in the browser, then tap **Approve** on an old notification | **Not approved** — "Your session has expired. Open BCH OPS, sign in, and approve it there." Not `Unexpected token '<'`, and not a false "Approved". | An expired session does not answer 401 here: it redirects to /login and returns HTML with status 200. Anything that is not JSON is treated as signed out. | |
| 11.9 | Turn off the network (DevTools → Offline) and tap **Approve** | **Not approved** — "Could not reach BCH OPS. Nothing was approved — open the record and try again." | A button that silently does nothing is worse than one that fails out loud. | |
| 11.10 | As a user **without** the module's approve grant, tap **Approve** | **Not approved** — "You do not have permission to approve outwards" (or the module's equivalent). | The notification is never the authority. | |
| 11.11 | A **stock audit** request | The notification opens the record. If a button is tapped anyway: "A stock audit is approved on its own screen, where you choose how to apply the counts. Open it to continue." | Approving a count also chooses how the counts are applied, and sometimes which warehouse takes a surplus. A button cannot make that choice. | |
| 11.12 | Tap Approve twice quickly | Only one result notification is on screen — each result replaces the last, it does not stack. | | |
| 11.13 | On an **iPhone** | The notification has **no buttons at all**, and tapping the body opens the record. | Q19: iOS Safari ignores notification actions. The buttons are a shortcut, never the only way. | |
| 11.14 | Turn the push master switch off | Nothing pushes, and no screen breaks. | | |

---

## 12. Database checks — run at the end

```sql
-- 12.1 Every unit code is unique
SELECT "unitCode", count(*) FROM "InventoryUnit" GROUP BY 1 HAVING count(*) > 1;              -- 0 rows

-- 12.2 Bin quantities equal the live units in them (for products that have units)
SELECT b.code, p.sku, bs.quantity, count(u.id) AS units
FROM "BinStock" bs JOIN "Bin" b ON b.id = bs."binId" JOIN "Product" p ON p.id = bs."productId"
LEFT JOIN "InventoryUnit" u ON u."binId" = bs."binId" AND u."productId" = bs."productId"
  AND u.status IN ('RECEIVED','PUT_AWAY','ASSIGNED','IN_ASSEMBLY','ASSEMBLED','RESERVED','RETURNED','DAMAGED')
GROUP BY b.code, p.sku, bs.quantity
HAVING bs.quantity <> count(u.id) AND count(u.id) > 0;                                        -- 0 rows

-- 12.3 currentStock still equals the sum of the warehouse quantities
SELECT p.sku, p."currentStock", coalesce(sum(s.quantity),0) AS ledger
FROM "Product" p LEFT JOIN "StockLevel" s ON s."productId" = p.id
GROUP BY p.id HAVING p."currentStock" <> coalesce(sum(s.quantity),0);                         -- 0 rows

-- 12.4 The hold cache equals the ledger
SELECT p.sku, p."reservedStock", coalesce(sum(s."reservedQuantity"),0) AS ledger
FROM "Product" p LEFT JOIN "StockLevel" s ON s."productId" = p.id
GROUP BY p.id HAVING p."reservedStock" <> coalesce(sum(s."reservedQuantity"),0);              -- 0 rows

-- 12.5 No unit is held for an outward that is finished
SELECT u."unitCode", d."invoiceNo", d.status FROM "InventoryUnit" u
JOIN "Delivery" d ON d.id = u."reservedForDeliveryId"
WHERE d.status IN ('DELIVERED','WALK_OUT');                                                   -- 0 rows

-- 12.6 No item that needs no assembly is sitting in a normal bin
SELECT u."unitCode", b.code FROM "InventoryUnit" u JOIN "Bin" b ON b.id = u."binId"
WHERE u."nonAssemblable" = true AND b."nonAssemblable" = false;                               -- 0 rows

-- 12.7 Every product has a category after the Zoho import
SELECT count(*) FROM "Product" p JOIN "Category" c ON c.id = p."categoryId"
WHERE c.name = 'Uncategorized';        -- should match the import's "no category in Zoho" notice

-- 12.8 Every approval decision left a trace
SELECT activity, event, count(*) FROM "ApprovalEvent" GROUP BY 1,2 ORDER BY 1,2;
```

Also watch the `npm run dev` terminal through the whole walk. Lines should be scoped
`units:*`, `deliveries:priority`, `approvals:*`, `bins:*`, `categories:*`. **No phone numbers, no
addresses, no tokens** should appear in any of them.

---

## 13. Known gaps and deliberate choices — do not file these as bugs

From the plan's §5 "Out of scope" and what the building agents reported.

| What | Why it is like that |
|---|---|
| **A build cannot be reassigned or cancelled.** | Q39, out of scope. A wrongly assigned build is finished or left. |
| **No delivery time, only a delivery day.** | Q32/Q40, R18. The slot calendar is unchanged. |
| **The mechanic picker lists every active user**, not only mechanics. | Requirements doc defect 11, deliberately not fixed here. |
| **`/transfers/new` still demands a document at create**, although the API no longer does. | P16 made the document optional on `POST /api/transfer-orders` so Find stock can raise a request without one. The new-transfer **screen** was deliberately left as it was: it uploads the document first and creates nothing if that fails. |
| **The Requests row and badge render nothing at zero.** | By design. They appear in the desktop sidebar (a **Requests** row above the module groups) and on the phone top bar (a clipboard icon with a count) only when something is waiting for you — and never for a person who approves nothing. |
| **The Google Contacts account email is best effort.** | The `contacts` scope alone cannot read the signed-in account's address, so the card usually shows whatever the admin typed in the optional label field rather than the real Gmail address. |
| **Products with no Zoho category land in `Uncategorized`.** | `Product.categoryId` cannot be null, so "no category" needs a real row. The import reports the number. |
| **Batch caps:** 1000 units per *Apply to existing stock*, 500 per *Generate unit codes*, 500 labels per print, 500 per bulk Assign, 200 customers per Google sync, 50 deliveries per batch. | Each one is a transaction that must finish. Press again for the rest; every screen says how many are left. |
| **A stock audit cannot be approved from a notification or from Requests.** | Approving one means choosing verify-only or "apply the counts", and naming a warehouse for a surplus on a whole-store audit. A one-tap Approve would pick silently. |
| **iPhone notifications have no buttons.** | iOS web push does not support them (Q19). |
| **The non-assemblable flag cannot be edited on a bin.** | P6a, by the owner's choice. Create another bin and move the items, or clear one item with **Needs assembly**. |
| **A non-assemblable item cannot be moved back to a normal bin** without **Needs assembly** and a reason. | P6 (2). |
| **Manual outwards (`/inventory/outwards`) and store-wide audits still take from the godown when the floor is short.** | Pre-existing, plan 1609 §5. |
| **`api/stock-counts/[id]` DELETE still writes `currentStock` without a `StockLevel` row.** | Known gap, listed in the plan §5, raised separately. |
| **The old bin-prefix `api/stock-reset` is untouched and unlinked.** | The new per-warehouse reset is the one with a screen. |
| **Nothing is pushed to Zoho** — not categories, not parents. | P12. Zoho is the source. |
| **There is no native Android app** for contacts. | P14 (c). Google Contacts sync is how a contact reaches a phone. |

---

## 14. What the owner still owes

1. **`npm run build`** — it has never been run on this branch (21–45 min; never pipe it).
2. **The browser walk above**, on `bch_local`, with the users of §0.10.
3. On the **cloud test database**, in this order: `npm run db:snapshot` → `npx prisma migrate status`
   → `npx prisma migrate deploy` → **`npm run db:seed:rbac`**. Nothing applies migrations
   automatically any more, and without the re-seed the menu does not change and
   `delivery_priority` does not exist.
4. **Grant the new permission.** `delivery_priority.edit` belongs to whoever is allowed to say a
   delivery is urgent. No role has it until somebody gives it.
5. **The Google Cloud setup** for §9 (plan §3.9a) — project, People API, consent screen
   **published** (in *Testing* Google expires the refresh token after 7 days), OAuth client,
   both redirect URIs, then Connect in Settings → Integrations. Then add the shop account to
   each staff phone and turn on contacts sync for it.
6. **Turn push on** in Settings → Notifications → Push if §11 is to be tested.
7. **Re-create the category home-bin rules** after the §8 wipe and import.
8. When the walk passes, move the plan to `completed/` (`/ship-plan`).
