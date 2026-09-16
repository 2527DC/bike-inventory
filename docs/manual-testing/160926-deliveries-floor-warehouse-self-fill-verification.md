# Manual testing — deliveries: floor warehouse, saved customer, self-fill, one detail screen

What to test by hand for plan
`docs/implementation/pending/1609-deliveries-floor-warehouse-contact-and-self-fill-plan.md`,
all three phases, on the stacked branches:

| Phase | Commit | Branch | Cases below |
|---|---|---|---|
| 1 — the floor warehouse sells, holds and reduces stock | `9974e9a` | `feat/1609-deliveries-p1-floor-warehouse` | §1, §2, §8, §9, §10, §12, §13 |
| 2 — the customer is saved, the customer schedules | `d3dd3d0` | `feat/1609-deliveries-p2-contact-self-fill` | §4, §5, §6, §7 |
| 3 — one detail screen, its own routes, zones and payment | `2787869` | `feat/1609-deliveries-p3-detail-zones-payment` | §3, §11 |

Test on the **Phase 3 branch**. It contains all three.

**Build status: PASSED.** `npm run build` ran on 16 Sep 2026 on the Phase 3 tip `2787869` against
local `bch_local`. It exited 0 after 19 min 52 s: compiled in 12.9 min, TypeScript finished in
4.0 min, 157 static pages generated. There were no errors. The only warnings were the two already
there (`package.json#prisma` deprecated, `middleware` → `proxy`). Every new route is in the output:
`/deliveries/[id]/walkout`, `/deliveries/blr/[id]`, `/deliveries/outstation/[id]`,
`/api/deliveries/[id]/customer`, `/api/deliveries/[id]/reserve`, `/api/deliveries/match-warehouses`.
Before this, each phase had passed `npx tsc --noEmit` and `eslint`.

## The flows you are checking, in the order to walk them

Each flow is one real-life story. The numbered sections below break it into cases.

| # | Flow | What should happen, in one line | Sections |
|---|---|---|---|
| F1 | **Set up the shop floors** | On `/stores`, the invoice prefix sits on the FLOOR warehouse (`INV/` → BCH Floor, `BCC/` → BCC Floor), not on the store. A store with two floors must mark one Primary. | §1 |
| F2 | **Link invoices to a floor** | An invoice whose number matches no prefix is a **Dummy** and has no actions. **Match warehouses** links the existing open deliveries to their floor. | §2 |
| F3 | **Save the customer** | **Save Customer** writes to the `Customer` table, keyed by phone, with no duplicates and no download. Schedule, Walk-out and the link all wait for it. | §4 |
| F4 | **Customer fills the form** | Generate the link → Copy / WhatsApp (to the main phone) → the customer fills `/fill/<token>` with a mandatory, different alternate number → the delivery becomes **SCHEDULED** on the day they chose (outstation: no date) → the link locks. | §5, §6 |
| F5 | **Staff schedule** | The schedule form has no "Estimated Delivery". It shows only the side the zone says. Staff can set a date later with the 10-per-day slot calendar, and a banner stays until the confirmation WhatsApp is sent. | §7 |
| F6 | **Stock hold on the floor** | Scheduling never fails on a shortage: it shows a red "Stock not reserved" card, and **Reserve stock now** holds all lines or none, counted on the floor only. | §8 |
| F7 | **Walk-out** | A separate walk-out screen: customer → checklist → stock leaves the **floor only**. A short floor is refused even when the godown has stock. | §9 |
| F8 | **Delivered / courier / batch** | Mark Delivered, Packed → Shipped → In Transit → Delivered, and batch dispatch all take stock from the matched floor. | §10 |
| F9 | **Lists and detail screen** | `/deliveries` tags rows Bangalore / Outstation / Not set. `/deliveries/blr` and `/outstation` open their own detail route. The detail is one screen with no tabs, and a summary card on top shows invoice, **paid, balance**, delivery date, zone and floor. | §3, §11 |
| F10 | **Pre-booked arrival** | A pre-booked cycle's delivery takes the receiving store's primary floor. | §12 |
| F11 | **Server safety** | Every rule the screen hides, the API also refuses, including permission checks. | §13, §14 |
| F12 | **Nothing else broke, data is consistent** | Regressions, SQL consistency checks, then cleanup. | §15–§18 |

**None of that proves anything below.** Every case here is behaviour a compiler cannot see. Tick
the last column as you go. If a case fails, write down what you actually saw instead of a cross.

The `R` / `A` / `B` / `T` numbers in brackets point at the plan's §0.2 and §1.1, so a failure can
be traced to the decision it breaks.

---

## 0. Before you start

| # | Step | Why |
|---|---|---|
| 0.1 | `grep -n "^DATABASE_URL" .env`. It must be **`localhost:5432/bch_local`** (line 13). | Every case below writes to whichever database this names. The SQL helpers in §0.6–§0.9 are for **local only**. |
| 0.2 | `npx prisma migrate status` must say **"Database schema is up to date!"**. If `20260916173617_delivery_floor_warehouse_and_holds`, `20260916181032_delivery_customer_link` or `20260916183558_delivery_zone_and_payment` is listed as pending, run `npx prisma migrate deploy`. | Without those columns (`Warehouse.invoicePrefix`, `Delivery.customerId`, `Delivery.deliveryZone` …) every delivery screen fails with a 500. `bch_local` had all three applied on 16 Sep. |
| 0.3 | `npm run dev` and sign in as an **ADMIN**. | ADMIN holds every permission. |
| 0.4 | Have a **second user** ready who holds `deliveries.view` but **not** `deliveries.edit` or `deliveries.create`. | Used by §14 (permission checks). |
| 0.5 | Keep a phone with WhatsApp to hand, or a desktop with WhatsApp Web signed in. Keep a **private / incognito window** for the customer's form. | §5, §6. The customer's form must work with no session. |
| 0.6 | Open a SQL shell on local: `psql "postgresql://…@localhost:5432/bch_local"` (credentials from `.env` line 14). | §8–§13 and §17 check the database directly. |
| 0.7 | Find each test delivery's id, which the URLs and API calls need: `select id, "invoiceNo", status, "customerPhone" from "Delivery" where "invoiceNo" in ('INV/25/023069','INV/25/023079','INV/25/023087','INV/25/023190','INV/25/023186','INV/25/023233','INV/25/023080','INVOICE-003951','INV/25/023112','INV/25/023114','INV/25/023070','BCC/24-25/02383','INV/25/023071');` | Or open the row and copy the id from the address bar. |
| 0.8 | **API helper.** Open DevTools → Console on any signed-in app page and paste: <br>`const call = async (url, method = "GET", body) => { const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); console.log(r.status, await r.text()); };` | §14 uses `call(...)` to prove the **server** refuses what the screen hides. The CLAUDE.md `apiFetch` rule is for app code. It does not apply to a console check. |

### 0.9 Test deliveries (all exist in `bch_local` on 16 Sep 2026)

Every row is `PENDING`, has no warehouse (a Dummy) and has zone Not set **until §2 runs**.

| Label | Invoice | Customer phone as imported | Lines (SKU × qty) | Used for |
|---|---|---|---|---|
| **D1** | `INV/25/023069` | `9964288130` (bare 10) | `5958` × 1 RALSON MLD TU 27.5T | Walk-out succeeds; phone becomes `+91-` |
| **D2** | `INV/25/023079` | `9008225971` | `1323` × **2** TUBE | Walk-out refused: floor short, godown full |
| **D3** | `INV/25/023087` | `+91-9844555661` | `4111` × 1 TYRE ; `6267` × 1 MUDGUARD | All-or-nothing hold, Reserve stock now, Mark Delivered |
| **D4 / D4b** | `INV/25/023190` / `INV/25/023186` | both `9902916085` | — | Two deliveries, one customer row |
| **D5** | `INV/25/023233` | *(none)* — customer "BHARATH CYCLE CENTRE" | — | Staff type the phone (B2) |
| **D6** | `INV/25/023080` | `+91-96322139817` (11 digits) | — | A wrong-length number is kept as written (A3) |
| **D7** | `INVOICE-003951` | *(none)* | — | Stays a Dummy after matching |
| **D8** | `INV/25/023112` | `+91-9845969508` | — | Matches an old bare-10 customer (A13) |
| **D9** | `INV/25/023114` | `+91-9845969508` | — | Customer form, **Inside Bangalore** |
| **D10** | `INV/25/023070` | `+91-9611257163` | `9790` × 1 KEYSTO HUGO | Customer form, **Outside Bangalore**, stock short |
| **D11** | `BCC/24-25/02383` | `+91-9566843255` | `858` × 1 ALLWYN T/C JUMBO | BCC floor; outstation courier flow |
| **D12** | `INV/25/023071` | `+91-9986282818` | `8004` × 1 THROTTLE WITH KEY SET | Customer submit holds stock |

### 0.10 Putting stock on a floor or godown (local only)

On 15 Sep, inventory was wiped on this database, so almost no product has stock. Set exactly
what a case needs with the block below. Change the `VALUES` rows each time; the block is safe
to re-run.

```sql
INSERT INTO "StockLevel"(id,"productId","warehouseId",quantity,"reservedQuantity","updatedAt")
SELECT 'manual-test-'||p.sku||'-'||w.code, p.id, w.id, v.qty, 0, now()
FROM (VALUES ('5958','BCH_FLOOR',1)) v(sku,wh,qty)          -- (SKU, warehouse code, quantity)
JOIN "Product" p ON p.sku = v.sku JOIN "Warehouse" w ON w.code = v.wh
ON CONFLICT ("productId","warehouseId") DO UPDATE SET quantity = EXCLUDED.quantity, "updatedAt" = now();

UPDATE "Product" p SET "currentStock" = (SELECT coalesce(sum(quantity),0) FROM "StockLevel" s WHERE s."productId" = p.id)
WHERE p.sku IN ('5958');                                      -- same SKUs as above
```

It sets the quantity only; **holds are left alone**. Warehouse codes: `BCH_FLOOR`,
`BCH_WAREHOUSE`, `BCC_FLOOR`, `BCC_WAREHOUSE`. Use **one** helper query to watch a product:

```sql
SELECT p.sku, w.code, s.quantity, s."reservedQuantity", p."currentStock", p."reservedStock"
FROM "StockLevel" s JOIN "Product" p ON p.id = s."productId" JOIN "Warehouse" w ON w.id = s."warehouseId"
WHERE p.sku IN ('5958') ORDER BY p.sku, w.code;
```

> Moving stock through the app — a transfer, or a stock count on one warehouse — is equally
> valid, just slower. The SQL shortcut is only for setting up a starting position.

---

## 1. `/stores` — the prefix and the primary flag live on the FLOOR warehouse (R29–R33, T1, T8)

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 1.1 | The store form has no prefix | `/stores` → **Edit** on BCH Store | Code, name, address, phone only. **No invoice prefix field, and no "Leave it blank…" paragraph.** The store row has no prefix badge. | |
| 1.2 | Floors without a prefix are flagged | Look at the warehouse rows | **BCH Floor** and **BCC Floor** each show a `Floor` tag, their code, and an amber **No invoice prefix** badge. Godowns show no prefix badge at all. | |
| 1.3 | A godown has no prefix field | Edit **BCH Warehouse** (Godown) | No "Invoice prefix" field and no "Primary floor for this store" checkbox. | |
| 1.4 | The fields appear only for a floor | In that same form, click **Floor** | **Invoice prefix \*** (placeholder `e.g. INV/`, help text "Invoices whose number starts with this reduce this floor's stock") and **Primary floor for this store** appear. Click **Godown** → both disappear. Click **Floor** again → what you typed is still there. **Cancel.** | |
| 1.5 | A floor cannot be saved without a prefix | Edit **BCH Floor**, leave the prefix empty | **Save is disabled** and an amber line reads "A floor warehouse needs an invoice prefix." | |
| 1.6 | Set the two real prefixes (A42b) | BCH Floor → prefix `INV/` → Save. BCC Floor → prefix `BCC/` → Save. | Both save. Each row now shows its prefix as a grey mono badge instead of "No invoice prefix". | |
| 1.7 | A duplicate prefix is refused **by name** | Edit BCC Floor → change the prefix to `inv/` (lower case) → Save | Red message beside the form: **Invoice prefix "inv/" is already used by BCH Floor at BCH Store. Each floor warehouse needs its own.** Nothing is saved. Put it back to `BCC/`. | |
| 1.8 | Spaces are trimmed | Edit BCC Floor → type `  BCC/  ` → Save → Edit again | The field shows `BCC/`, without the spaces. | |
| 1.9 | A second floor forces a primary (R33) | BCH Store → **Add warehouse** → code `BCH_FLOOR_2`, name `BCH Floor 2`, **Floor**, prefix `BCH2/`, primary **unticked** → Save | Refused: **Mark one floor warehouse of BCH Store as primary.** The warehouse is **not** created (the whole write rolls back). | |
| 1.10 | …and saves once one is primary | Same form, tick **Primary floor for this store** → Save | Saves. BCH Floor 2 shows a green **Primary** badge. | |
| 1.11 | Only one primary per store | Edit **BCH Floor** → tick Primary → Save | BCH Floor now shows **Primary** and BCH Floor 2 **loses** it. Two primaries are never shown at once. | |
| 1.12 | The database refuses a second primary too (T8) | SQL: `UPDATE "Warehouse" SET "isPrimary" = true WHERE code = 'BCH_FLOOR_2';` | `ERROR: duplicate key value violates unique constraint "Warehouse_one_primary_floor_per_store"`. | |
| 1.13 | Unticking the only primary is refused | Edit BCH Floor → untick Primary → Save | Refused with "Mark one floor warehouse of BCH Store as primary." | |
| 1.14 | Turning a floor into a godown clears its prefix | Edit **BCH Floor 2** → **Godown** → Save | The row shows `Godown`, no prefix badge, no Primary badge. The database agrees: `select "invoicePrefix", "isPrimary" from "Warehouse" where code='BCH_FLOOR_2'` → `null`, `false`. BCH Store is back to one floor, so nothing is demanded of it. | |
| 1.15 | Clean up | Deactivate (or delete) **BCH Floor 2** | Done. BCH Floor is still **Primary** and keeps `INV/`. | |
| 1.16 | Store edit still works | Edit BCH Store's phone → Save → put it back | Saves. No mention of an invoice prefix anywhere. | |

## 2. Import, Dummy and "Match warehouses" (R31, A41b, A41c, A43, T2, T3)

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 2.1 | Before matching, everything is a Dummy | `/deliveries` (All) | Every open row carries a red **Dummy** badge and **no** Schedule / Walk-out / Pre-book / Dispatch / Mark Ready buttons. The delete icon is still there for ADMIN (T2). No zone tag is shown next to a Dummy. | |
| 2.2 | The Match button | `/deliveries`, beside the filters | A grey **Match warehouses** button (visible only with `deliveries.edit`). | |
| 2.3 | Run it | Click **Match warehouses** | The button reads "Matching…", then a line: **Checked 232 · matched 229 · still Dummy 3** (the numbers are what your data gives: 207 `INV/` + 22 `BCC/` matched; `INVOICE-003951/2/3` stay Dummy). The list refreshes. | |
| 2.4 | Matched rows | Look at an `INV/25/…` row, then a `BCC/24-25/…` row | The Dummy badge is gone. A small warehouse line shows **BCH Floor** or **BCC Floor** respectively. Schedule / Walk-out / Pre-book are back on PENDING rows. | |
| 2.5 | `INVOICE-…` stays Dummy (A41b) | Find `INVOICE-003951` (D7) | Still **Dummy**, still no action buttons. | |
| 2.6 | Re-runnable, never overwrites (A43b) | Click **Match warehouses** again | **Checked 3 · matched 0 · still Dummy 3**. Nothing already matched is touched. | |
| 2.7 | Store follows the warehouse (T3) | SQL: `select d."invoiceNo", w.code, s.code from "Delivery" d join "Warehouse" w on w.id=d."warehouseId" join "Store" s on s.id=d."storeId" where d."invoiceNo" in ('INV/25/023069','BCC/24-25/02383');` | `INV/…` → `BCH_FLOOR` / `BCH_STORE`; `BCC/…` → `BCC_FLOOR` / `BCC_STORE`. | |
| 2.8 | Longest prefix wins | *(optional)* Temporarily give an active floor the prefix `INV/25/0231` and create or import an invoice `INV/25/02319…` | It matches the longer prefix, not `INV/`. Put the prefix back. The rolled-back check on 16 Sep already covered this; do it only if you want to see it on screen. | |
| 2.9 | Dummy detail | Open D7 | Red banner: **Dummy delivery — no floor warehouse matched this invoice number. No actions are available.** The header has a red **Dummy** badge. The summary card's Floor row says **Dummy**. The customer card and items are shown, but there is **no** Save Customer, link card, action buttons, date editor, courier or accessories editor, and no WhatsApp card. | |
| 2.10 | Delete a Dummy (T2) | On `/deliveries`, delete `INVOICE-003951` (ADMIN) — **only if you want it gone; it is the duplicate named in A42** | Deleted. (Skip this if you still need D7 for §14.) | |
| 2.11 | Fetch + Import preview (Zoho connected only) | `/deliveries` → **Bulk Fetch** tab → fetch a window → look at the summary | The skipped/new counts read like `… · 12 BCH Floor (INV/) · 3 BCC Floor (BCC/) · 1 Dummy — no floor prefix matched`. **Not** "with no store prefix". Skip if Zoho is not connected locally. | |
| 2.12 | Imported rows carry the floor, the `+91-` phone and payment (Zoho connected only) | Approve an import of one new `INV/` invoice | New row is **not** a Dummy (BCH Floor), its phone is written `+91-XXXXXXXXXX`, and SQL `select "zohoPaymentStatus", "zohoBalance" from "Delivery" where "invoiceNo"='<new>'` is filled. | |

## 3. Lists and tags — `/deliveries`, `/deliveries/blr`, `/deliveries/outstation` (R18, R19, A22, A23, A34)

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 3.1 | Backfill (A34) | SQL: `select "deliveryZone", count(*) from "Delivery" group by 1;` before any §6/§7 work | All 232 rows are `null`: all were unfilled PENDING rows, so all are **Not set**. | |
| 3.2 | Tags on mobile cards | `/deliveries` at phone width (DevTools device toolbar, 375 px) | Every matched row shows a grey **Not set** tag. (Hovering on desktop gives the title "The customer has not chosen Bangalore or outside Bangalore yet".) | |
| 3.3 | Tags on the desktop table | `/deliveries` at ≥ 1024 px | The Invoice column shows the same tag next to the number, and the floor name under it. | |
| 3.4 | Tags change with the zone | After §6.6 (D9 → Bangalore) and §6.9 (D10 → Outstation) | D9 shows a blue **Bangalore** tag, D10 an amber **Outstation** tag, on both cards and table. | |
| 3.5 | BLR list shows Bangalore only | `/deliveries/blr` | Only rows whose zone is Bangalore (D9 after §6). **No Not-set rows and no Outstation rows.** No walk-out or pre-booked rows. | |
| 3.6 | Outstation list shows Outstation only | `/deliveries/outstation` | Only rows whose zone is Outstation (D10, D11 after §6/§10). | |
| 3.7 | The lists open their own route (R20, A29) | Click a row on `/deliveries/blr` | Address becomes **`/deliveries/blr/<id>`** (not `/deliveries/<id>`). Same on outstation → **`/deliveries/outstation/<id>`**. | |
| 3.8 | The back arrow returns to the list you came from | On `/deliveries/blr/<id>` press the ← arrow; repeat on outstation and on `/deliveries/<id>` | Back to `/deliveries/blr`, `/deliveries/outstation`, `/deliveries` respectively. | |
| 3.9 | The status filters still work | On `/deliveries/blr` click each status chip | The list narrows by status within Bangalore. On an error the list shows an error state, not a blank screen. | |
| 3.10 | The API zone filter | Console: `call("/api/deliveries?zone=NONE")`, `…?zone=BANGALORE`, `…?zone=OUTSTATION`, and the legacy `…?outstation=true` | 200 each; the first returns only `deliveryZone: null` rows; the legacy one returns the same set as `zone=OUTSTATION`. | |

## 4. Save Customer — the database, not a download (R5–R8, R35, A1–A4, A13, B2, B3)

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 4.1 | Nothing is downloaded | Open **D1** | Below the customer card, a blue card: "Save the customer before scheduling, walk-out or sending the link", a **Customer phone** field prefilled with `9964288130`, and **Save Customer**. There is **no** vCard, "Save Contact", share sheet or download anywhere. | |
| 4.2 | The actions wait for the customer (A6) | Same screen, before saving | In the actions area: "Save the customer above to schedule or walk out". No Schedule Delivery / Walk-out buttons. The link card's **Generate Link for Customer** button is disabled, with "Save the customer first" under it. | |
| 4.3 | Save | Click **Save Customer** | "Saving…", then a green line **Customer saved** in the customer card, and the blue save card disappears. The phone in the card now reads **`+91-9964288130`** (B3). Schedule Delivery and Walk-out appear. **No file lands in Downloads.** | |
| 4.4 | Saved in the Customer table (R6) | SQL: `select id, name, phone, type from "Customer" where phone in ('+91-9964288130','9964288130');` and `select "customerId", "customerPhone" from "Delivery" where "invoiceNo"='INV/25/023069';` | One Customer row: the invoice's customer name, phone `+91-9964288130`, type `WALK_IN`. The delivery's `customerId` equals that id. | |
| 4.5 | Survives a reload / another device | Reload D1, or open it in another browser | Still **Customer saved**. It is a database link, not a browser flag (A2). | |
| 4.6 | No duplicate for the same phone (R8) | Save **D4** (`INV/25/023190`), then **D4b** (`INV/25/023186`) | Both succeed. The second says **Already saved as <name>**. SQL `select count(*) from "Customer" where phone in ('+91-9902916085','9902916085');` → **1**. Both deliveries have the same `customerId`. | |
| 4.7 | An old bare-10 customer is matched, not copied (A13) | Create a customer the way the receivables import and the workshop always wrote them, as bare 10 digits (`/customers` has no Add button any more). SQL: `insert into "Customer"(id, name, phone, "updatedAt") values ('manual-test-legacy', 'Legacy Test', '9845969508', now());`. Then open **D8** (`INV/25/023112`, phone `+91-9845969508`) → Save Customer | **Already saved as Legacy Test**. SQL: still exactly one row for `9845969508` / `+91-9845969508`, and its phone is **still `9845969508`**. An existing row is never rewritten (A4). | |
| 4.8 | A different name does not overwrite | SQL on that row after 4.7 | `name` is still "Legacy Test", not the invoice's customer name. | |
| 4.9 | Staff type a missing phone (B2) | Open **D5** (`INV/25/023233`, no phone) | The phone field is empty and shows "Enter the customer's phone number." Save is disabled. Type `98450 12345` → Save | Saved; the card shows `+91-9845012345`. | |
| 4.10 | A wrong-length number is kept (A3) | Open **D6** (`+91-96322139817`) | Amber hint under the field: "This is not a 10-digit mobile number. It will be saved as written." Save → the customer's phone is **`+91-96322139817`** (all 11 digits, not cut to 10). | |
| 4.11 | Formats that mean the same number | *(optional)* On a spare delivery type `+91 99642 88130`, `919964288130` or `09964288130` | Each links to the §4.3 customer ("Already saved as …"), because all normalise to `+91-9964288130`. | |
| 4.12 | Not offered once scheduled | Open a SCHEDULED delivery that has no customer (e.g. one scheduled before this build, if any) | No Save card (Save is offered only for PENDING / VERIFIED). | |

## 5. The self-fill link and WhatsApp (R9–R11, A5, A7, A8, A9)

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 5.1 | Blocked until saved | Any unsaved matched PENDING delivery | **Generate Link for Customer** is disabled; "Save the customer first". (§14.3 proves the server refuses too.) | |
| 5.2 | Generate | **D9** (`INV/25/023114`) → Save Customer → **Generate Link for Customer** | A read-only field with `http://localhost:3000/fill/<token>`, a copy icon, "This link expires in 24 hours.", **Copy Link** and **Send via WhatsApp**. | |
| 5.3 | Copy | **Copy Link**, paste into Notepad | The full link is pasted. The button reads "Copied!" for ~2 s. | |
| 5.4 | WhatsApp uses the delivery's main phone (R10, A9) | **Send via WhatsApp** | A new tab opens **`https://wa.me/919845969508?text=…`** — `91` plus 10 digits, no `+`, no `-`. The message has the link and "This link expires in 24 hours." The chat opens to that number (before this build, `+91-` numbers produced a broken link). | |
| 5.5 | A still-valid link is reused | Reload D9 → Generate again | The **same** token as 5.2. | |
| 5.6 | Expiry is 24 h | SQL: `select "selfFillTokenExpiry" from "Delivery" where "invoiceNo"='INV/25/023114';` | About 24 h after 5.2 (stored in UTC). | |
| 5.7 | An expired link | SQL: `update "Delivery" set "selfFillTokenExpiry" = (now() at time zone 'UTC') - interval '1 hour' where "invoiceNo"='INV/25/023114';` → open the old link in the private window | "This link has expired. Please contact the store for a new link." Then on D9 → Generate → a **new** token. Use the new one for §6. | |

## 6. The customer's form — `/fill/<token>` (R12–R15, R25–R27, A10–A12, A17, A26, A27)

**Open every link in the private window.** The form must work with no session (a public route).

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 6.1 | Opens without signing in | Open D9's link in the private window | "Bharath Cycle Hub — Delivery Details Form", the invoice, the items, and "Where should we deliver?" with **Inside Bangalore** / **Outside Bangalore**. No redirect to /login. | |
| 6.2 | Main phone is read-only (A10) | Choose **Inside Bangalore** → Contact Details | "Phone Number" shows **`+91-9845969508`** as plain text with "To change this number, please contact the store." There is no input box for it. | |
| 6.3 | Alternate is mandatory (R12, A11) | Fill address (≥ 5 chars), pincode `560011`, pick a date, leave **Alternate Phone \*** empty | **Submit Delivery Details** stays disabled. | |
| 6.4 | Alternate must be 10 digits | Type `98765` | Red: "Enter a valid 10-digit alternate number." Submit disabled. Letters cannot be typed; more than 10 digits cannot be typed. | |
| 6.5 | Alternate ≠ main (R13, A12) | Type `9845969508` | Red: "The alternate number must be different from your main number." Submit disabled. | |
| 6.6 | Bangalore submit → SCHEDULED with the date (R14, R25) | Alternate `9123456780`, pick a date from **Choose Delivery Date \*** (header says "Delivery at 6:00 PM. Max 10 deliveries per day.", "✓ Earliest available: …") → **Submit Delivery Details** | "Thank You! Your delivery details have been saved." with a **Delivery Date** box showing the day you chose, and "To change these details, please contact the store." | |
| 6.7 | Staff see it (R15, R26) | Signed-in window → `/deliveries` → **Scheduled** filter | D9 is listed under Scheduled with a **Bangalore** tag. Open it: status **Scheduled**; summary card **Delivery: <day>** with blue **chosen by customer**; Zone **Bangalore**; the self-fill link card is **gone** (it shows only for PENDING / VERIFIED); the customer card shows **Alt: +91-9123456780** and the address. | |
| 6.8 | Locked after submit (A7) | Reload the customer's link in the private window | Straight to the submitted screen (Thank You / the date). The form cannot be filled again. §14.6 proves the server refuses a second PUT. | |
| 6.9 | Outstation submit → SCHEDULED, no date (A27, A27b) | D10 (`INV/25/023070`): Save Customer → Generate → open the link privately → **Outside Bangalore** | **No date picker.** The line "The store will confirm the dispatch date with you after you submit." Fill a full address with city/state, 6-digit pincode, alternate → Submit | "Thank You!" with an amber box **Dispatch — The store will confirm the dispatch with you.** No date. | |
| 6.10 | Outstation on the staff side | Open D10 | Status **Scheduled**; Delivery **Date to be confirmed**; Zone **Outstation**; header badge **Outstation**. Listed on `/deliveries/outstation`, not on `/deliveries/blr`. | |
| 6.11 | Stock short never blocks the customer (A26) | D10's SKU `9790` has 0 on BCH Floor (don't add any) | The submit in 6.9 **succeeded** anyway. On the staff detail: the red **Stock not reserved — BCH Floor is short** card. SQL: `stockReservedAt` is `null` for D10. | |
| 6.12 | Stock held when available | **D12** (`INV/25/023071`, `8004` × 1 THROTTLE WITH KEY SET, phone `+91-9986282818`). §0.10 `('8004','BCH_FLOOR',1)`. Save Customer → Generate → customer submits **Inside Bangalore** | Staff detail: **no** red card. SQL: D12 `stockReservedAt` set; `8004` BCH_FLOOR `reservedQuantity` = 1; `Product.reservedStock` = 1. | |
| 6.13 | A VERIFIED delivery also goes to SCHEDULED (A17) | *(optional)* Put a saved delivery in VERIFIED (SQL `update "Delivery" set status='VERIFIED' where "invoiceNo"='…'`), send its link, submit | Status **Scheduled**. | |
| 6.14 | A full day cannot be picked | Fill a day (see §6.15), reload a fresh customer link | That day's button is grey with **Full** and cannot be clicked. | |
| 6.15 | *Helper: fill a day with 10 bookings* | Pick a day `YYYY-MM-DD` within the next 14 days. SQL: `update "Delivery" set "scheduledDate" = (DATE 'YYYY-MM-DD' - interval '330 minutes') where id in (select id from "Delivery" where "scheduledDate" is null and "invoiceNo" like 'INV/25/0232%' order by "invoiceNo" limit 10);` | **Undo afterwards** with `update "Delivery" set "scheduledDate" = null where "scheduledDate" = (DATE 'YYYY-MM-DD' - interval '330 minutes') and status = 'PENDING';` | |
| 6.16 | The 1 PM cutoff | Open a customer link **after 1:00 PM IST** | Today's button shows **Cutoff passed** and is disabled. Before 1 PM today is selectable. | |
| 6.17 | Phone width | Private window at 375 px | No horizontal scroll; buttons are thumb-sized; the date grid is two columns. | |

## 7. Staff schedule, the zone side and the date (R21, R27, A28, A30, A36, A39)

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 7.1 | No "Estimated Delivery" anywhere (R27) | Saved PENDING delivery with zone Not set (e.g. **D4**) → **Schedule Delivery** | The form has **no** "Estimated Delivery \*" block and no date presets. It has Inside/Outside toggle, Invoice / Product / Sales Person (read-only), Alternate Phone, Pincode \*, Free Accessories, Reverse Pickup, Google Maps Link, Delivery Notes. | |
| 7.2 | Not set → both sides (A30) | Same form | Both **Inside Bangalore** and **Outside Bangalore** buttons. | |
| 7.3 | Pincode still required for Bangalore | Inside, pincode `5600` → **Schedule Delivery** | "Pincode is required for Bangalore deliveries (6 digits)" and nothing is sent. | |
| 7.4 | Schedule with no date (A28) | Pincode `560064` → **Schedule Delivery** | The confirmation "Delivery Scheduled" shows **Delivery Date: To be confirmed** and **Type: Bangalore**. WhatsApp opens (`api.whatsapp.com/send?phone=919902916085…`) with "Delivery Date: to be confirmed". Status **Scheduled**; Zone **Bangalore**. | |
| 7.5 | The zone was saved with the legacy flag (T6) | SQL: `select "deliveryZone", "isOutstation" from "Delivery" where "invoiceNo"='INV/25/023190';` | `BANGALORE`, `false`. | |
| 7.6 | A set zone shows only its side (R21) | Open a **Bangalore** row that is still PENDING/VERIFIED — *set one up with* `update "Delivery" set "deliveryZone"='BANGALORE' where "invoiceNo"='INV/25/023186';` → Schedule Delivery | A blue label **Bangalore delivery**, **no** "Outside Bangalore" button, and the Bangalore fields only. Repeat with `'OUTSTATION'` on another saved row → amber **Outstation delivery**, **no** "Inside Bangalore", and the Delivery Address \* field instead of Pincode. | |
| 7.7 | The same from the BLR route | Open that row from `/deliveries/blr/<id>` → Schedule Delivery | Same as 7.6. There is no Actions/Details tab bar above it (§11). | |
| 7.8 | Set a date later (A36) | D4 (scheduled, no date) → the date card "Delivery: **date not set**" → **Set delivery date** | A slot grid: each day "N slots left", full days **Full**, after 1 PM today **Closed after 1 PM**; past days hidden. Pick one → **Save** → the card shows the date; the summary card shows it without "chosen by customer". | |
| 7.9 | Change the date | Tap the date card again | "Change delivery date", "Current: <day>", the current day marked **Current date** and disabled. Pick another → Save. | |
| 7.10 | A full day is refused | Fill a day with §6.15, then try to pick it in the editor | Disabled as **Full**. If the day fills while the grid is open (fill it via SQL after opening), Save shows **This delivery slot is now full. Please choose another date.** and the grid reloads. | |
| 7.11 | Banner until confirmation is sent (A39) | Open **D9** (scheduled by the customer in §6.6) → WhatsApp Messages card | Amber **Scheduled by customer – confirmation not sent** and a green **Send Confirmation** button. Click it → WhatsApp opens with the chosen date → the card shows ✓ **Scheduled msg sent** and the banner is gone (reload to confirm). | |
| 7.12 | Staff-scheduled deliveries have no banner | D4 (scheduled by staff in 7.4) | No amber banner. (7.4 already marked the message as sent; otherwise the button reads **Send Scheduled**.) | |
| 7.13 | Schedule refuses an unsaved customer on the server | See §14.4 | — | |

## 8. Stock hold on the floor — "Reserve stock now" (A26, A37, A38, A46, T4, T5, B4)

Use **D3** (`INV/25/023087`: TYRE `4111` × 1 + MUDGUARD `6267` × 1).

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 8.1 | Old holds were released by the migration (B4) | SQL: `select coalesce(sum("reservedStock"),0) from "Product";` and `select count(*) from "Delivery" where "stockReservedAt" is not null;` **before** any hold in this document | `0` and `0`. | |
| 8.2 | Setup: one line short | §0.10 with `('4111','BCH_FLOOR',1)`, `('6267','BCH_FLOOR',0)`, `('6267','BCH_WAREHOUSE',5)` | — | |
| 8.3 | Schedule is accepted while short (A26, A37) | D3 → Save Customer → Schedule Delivery (Inside, pincode) | **Not refused.** "Delivery Scheduled" confirmation, status **Scheduled**. | |
| 8.4 | The red card lists what is short | Same screen, straight after 8.3 | **Stock not reserved — BCH Floor is short**, "Nothing is held for this delivery. Transfer from the godown if needed, then reserve.", one row for the mudguard line (SKU `6267`) reading **0 / 1**, "available / needed on BCH Floor", and **Reserve stock now**. The 5 in the **godown** are not counted. After a reload the card stays but the per-line list is empty until you press Reserve. | |
| 8.5 | All or nothing (T5) | SQL helper on `4111`, `6267` | `4111` BCH_FLOOR `reservedQuantity` is **0**: the TYRE was **not** held although it was available. `stockReservedAt` is null. | |
| 8.6 | Reserve refuses while still short | **Reserve stock now** | "Reserving…", then the card stays, the list still shows `0 / 1`. Nothing changes in SQL. | |
| 8.7 | Reserve after the floor gets stock | §0.10 `('6267','BCH_FLOOR',1)` (as if transferred) → **Reserve stock now** | The red card disappears. SQL: BCH_FLOOR `reservedQuantity` = 1 for **both** SKUs; `Product.reservedStock` = 1 for both; D3 `stockReservedAt` set. | |
| 8.8 | The cache always equals the ledger (T4) | SQL: `select p.sku, p."reservedStock", coalesce(sum(s."reservedQuantity"),0) from "Product" p left join "StockLevel" s on s."productId"=p.id group by p.id having p."reservedStock" <> coalesce(sum(s."reservedQuantity"),0);` | **0 rows.** Re-run after every stock case below. | |
| 8.9 | A held unit cannot be taken by another delivery | *(optional)* With D3 holding TYRE (floor 1, reserved 1), walk out another saved delivery that needs `4111` × 1 | Refused: "Not enough stock of TYRE (SKU: 4111) on BCH Floor (has 0, needs 1). Transfer from godown first." | |
| 8.10 | Release on "Cancel Pack" / back to VERIFIED | *(Outstation flow, §10.6)* | The hold returns: `reservedQuantity` goes back down, and the cache matches. | |
| 8.11 | Release on delete | *(optional)* Schedule + hold a spare delivery, then delete it on `/deliveries` | Its `reservedQuantity` is given back; §8.8 still 0 rows. | |

## 9. Walk-out — a straight action that reduces the floor only (R34, R35, A40, A40b, A44, A45)

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 9.1 | The Walk-out button goes to its own screen | `/deliveries` → **Walk-out** on a matched PENDING card (mobile) or row (desktop) | Opens **`/deliveries/<id>/walkout`** (no `?action=walkout`). | |
| 9.2 | The focused screen (A44, A45) | Same screen | Green **WALK-OUT** eyebrow, invoice number, name and amount, the floor badge, then: items, the payment summary (Invoice / Paid / Balance or "Payment: not available"), the customer card. **No** self-fill link, Schedule, Flag, zone, date or courier. | |
| 9.3 | Customer first (R35) | Open the walk-out screen for an unsaved delivery | "Save the customer above to walk out" and the Save Customer card; **no checklist**. Save → the **Walk-out Handover Checklist** appears. | |
| 9.4 | Refused when the floor is short, even if the godown has plenty (A40, A40b) | **D2** (`TUBE 1323 × 2`). §0.10 `('1323','BCH_FLOOR',1)`, `('1323','BCH_WAREHOUSE',3)`. Save Customer → tick every item, "Free accessories handed over", "Confirmed with sales person" → **Confirm Walk-out** | A red message **inside the checklist**: **Not enough stock of <the invoice's item name> (SKU: 1323) on BCH Floor (has 1, needs 2). Transfer from godown first.** Status stays PENDING. SQL: BCH_FLOOR `1`, BCH_WAREHOUSE **still `3`**, no `OUTWARD` row for `INV/25/023079`. | |
| 9.5 | Succeeds after moving stock to the floor | §0.10 `('1323','BCH_FLOOR',2)`, `('1323','BCH_WAREHOUSE',2)` (as if 1 was transferred) → Confirm Walk-out again | "Walk-out complete — Customer took the cycle. Stock deducted." SQL: BCH_FLOOR **0**, BCH_WAREHOUSE **2** (godown untouched), `Product.currentStock` = 2. | |
| 9.6 | The ledger row | SQL: `select type, quantity, "previousStock", "newStock", "referenceNo" from "InventoryTransaction" where "referenceNo"='INV/25/023079';` | One `OUTWARD` row, quantity 2, previousStock 4, newStock 2. | |
| 9.7 | Confirm is gated by the checklist | Untick one item | The button reads "Check all items (n/m)" and is disabled. | |
| 9.8 | Walk-out from the detail screen | **D1** (saved in §4). §0.10 `('5958','BCH_FLOOR',1)`. Detail → **Walk-out** | Navigates to `/deliveries/<id>/walkout`. Complete it → floor 0, status **Walk-out**, listed on `/deliveries/walkout`. | |
| 9.9 | After completion | Reload the walk-out URL | "Walk-out is not available for this delivery" with **Back to delivery**. The detail shows "Walk-out Complete — Customer took the cycle. Stock deducted." | |
| 9.10 | A Dummy cannot walk out | Open `/deliveries/<D7 id>/walkout` | "Walk-out is not available for this delivery" and "No floor warehouse matched this invoice number." | |
| 9.11 | Cancel | On a walk-out screen, **Cancel** in the checklist | Returns to `/deliveries/<id>`. Nothing changed. | |
| 9.12 | Payment pending warning | *(if a receivables row or Zoho balance exists)* | The checklist shows "Payment pending: ₹… balance". | |

## 10. Delivered, outstation courier flow, batch dispatch, flag (A40, T2, T5)

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 10.1 | Bangalore Mark Delivered consumes the hold | **D3** (held in §8.7) → **Mark Delivered** → tick all → **Confirm Delivered** | "Delivered!". WhatsApp opens with the review message. SQL: BCH_FLOOR `4111` and `6267` quantity **0** and `reservedQuantity` **0**; `Product.reservedStock` 0; `stockReservedAt` null; two `OUTWARD` rows for `INV/25/023087`. §8.8 → 0 rows. | |
| 10.2 | Delivered is refused when the floor is short | *(optional)* Schedule a delivery while short (not held), then Mark Delivered | The checklist shows the "Not enough stock … Transfer from godown first." message; status unchanged. | |
| 10.3 | Outstation schedule by staff | **D11** (`BCC/24-25/02383`). §0.10 `('858','BCC_FLOOR',1)`. Save Customer → Schedule Delivery → **Outside Bangalore** → address → Schedule | Status Scheduled, Zone Outstation, **held on BCC Floor** (SQL `reservedQuantity` 1 on `BCC_FLOOR`, nothing on BCH). Buttons **Dispatch** and **Mark Packed**. | |
| 10.4 | Pack | **Mark Packed** | Status **Packed**. The hold is unchanged (already held). | |
| 10.5 | Ship needs a tracking number | **Mark Shipped** | ⚠ This opens a **browser prompt** ("Enter courier tracking number:"). Enter `TEST123` → status **Shipped**. Cancelling the prompt changes nothing. | |
| 10.6 | *(alternative)* Cancel Pack releases the hold | Instead of 10.5, **Cancel Pack (Return to Verified)** | Status **Verified**; SQL `reservedQuantity` back to 0, `stockReservedAt` null. Schedule again to continue. | |
| 10.7 | Transit and delivered | **Mark In Transit** → **Mark Delivered** → checklist → Confirm | Delivered. BCC_FLOOR `858` quantity **0**, reserved 0. BCC_WAREHOUSE untouched. | |
| 10.8 | Batch dispatch | Schedule two saved Bangalore deliveries with stock on the floor → `/deliveries/dispatch` (**Batch Dispatch**) → select both → dispatch → then mark delivered in batch | Both go Out for delivery, then Delivered; floor quantities drop; `stockReservedAt` cleared. | |
| 10.9 | A short floor fails the whole batch, named | Same, but one delivery's floor is short | The batch is refused with "Invoice <no>: Not enough stock of … Transfer from godown first." and **neither** delivery changes. | |
| 10.10 | Flag on a matched PENDING delivery | Detail → Flag → reason | Flagged; **Resolve Flag** returns it to PENDING. | |
| 10.11 | Pre-book from the list | `/deliveries` → **Pre-book** on a matched PENDING row | Status Prebooked; **Mark Ready (Cycle Available)** → Verified. On errors the title is "Pre-booking Failed" with the server's reason. | |

## 11. One detail screen and its routes (R20, R23, R24, R28, A24, A25, A29, A31–A33)

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 11.1 | No tabs (A24, A25) | Open any delivery on `/deliveries/<id>`, `/deliveries/blr/<id>` and `/deliveries/outstation/<id>` | **No Actions / Details tab bar.** One scrolling screen in this order: header (back arrow, invoice, name \| amount, floor badge, zone badge, status) → progress bar → Dummy banner if any → **summary card** → customer → **items** → stock-not-reserved card → link card → actions → delivery details → date → courier → accessories → WhatsApp. | |
| 11.2 | Items are shown (R24, A33) | Any delivery with line items | The items card lists each item on the detail screen itself: name, `SKU \| Qty: n`, and the line amount when the rate is above 0. | |
| 11.3 | Payment: not available (A32) | Any delivery imported before this build | Summary card: "Invoice amount ₹…" and **Payment: not available**. | |
| 11.4 | Zoho snapshot: partly paid (R23, R28) | SQL: `update "Delivery" set "zohoPaymentStatus"='partially_paid', "zohoBalance"=500 where "invoiceNo"='INV/25/023190';` → reload D4 | Three columns **Invoice ₹X · Paid ₹(X−500) · Balance ₹500** (balance in red, card border red), "**Partially paid** from Zoho at import". | |
| 11.5 | Zoho snapshot: paid | `update "Delivery" set "zohoPaymentStatus"='paid', "zohoBalance"=0 where "invoiceNo"='INV/25/023190';` → reload | Paid = invoice amount, Balance ₹0 (not red), "**Paid** from Zoho at import". | |
| 11.6 | Receivables override Zoho (A31) | *(only if a `CustomerInvoice` exists for the invoice number — local has 0; import receivables first or skip)* | "from receivables" and a **View** link to `/receivables`; the numbers come from the receivables row, not the Zoho snapshot. | |
| 11.7 | Delivery row of the summary | D9 (customer date) / D4 (staff date) / D10 (outstation, none) / an unscheduled PENDING | `<Day DD Mon>` + **chosen by customer** / the date alone / **Date to be confirmed** / **Not scheduled**. | |
| 11.8 | Zone and floor rows | Any matched row | Zone **Bangalore / Outstation / Not set**; Floor **BCH Floor** / **BCC Floor** (or **Dummy** in red). | |
| 11.9 | The old `?action=walkout` link is gone | Open `/deliveries/<id>?action=walkout` | Just the detail screen; it does not jump into a walk-out. (Use the Walk-out button, §9.1.) | |
| 11.10 | Not found | `/deliveries/blr/does-not-exist` | The server's message ("Delivery not found"), **Retry**, and a **Back** link to `/deliveries/blr`. | |
| 11.11 | Load error and retry | Stop the dev server's DB (or go offline in DevTools) → reload a detail | An error message with **Retry**, not a blank page or `Unexpected token '<'`. | |
| 11.12 | Session expired | Sign out in another tab → press an action on the detail | A clear error (not `Unexpected token '<'`). | |
| 11.13 | Phone width | Detail and walk-out screens at 375 px | No horizontal scroll. The header badges wrap. Summary columns stay on one row, with long amounts truncated. | |

## 12. Pre-booked arrival takes the store's primary floor (B1)

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 12.1 | Primary floor | BCH Store has one active floor (BCH Floor, after §1.15). *Needs an inbound shipment with a pre-booked line; skip if you have none.* Receive an inbound line that carries a **pre-booked customer** into a **BCH godown bin** on `/inbound/<id>` | A new PENDING delivery (named after the pre-booked invoice, or `PB-<lineItemId>`) shows **BCH Floor**, not Dummy. SQL `warehouseId` = BCH_FLOOR's id, `storeId` = BCH_STORE. | |
| 12.2 | With two floors, the primary one | *(optional)* Reactivate BCH Floor 2 with a prefix, mark it Primary, receive another pre-booked line | The delivery takes **BCH Floor 2**. Afterwards make BCH Floor primary again and deactivate Floor 2. | |
| 12.3 | No floor at all → Dummy | *(optional)* Receive a pre-booked line into a store with no active floor | The delivery is a **Dummy**; the server log shows `pre-booked delivery has no primary floor — created as Dummy`. | |

## 13. Stock reset clears holds too (T4) — local only, destructive

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 13.1 | *(optional, local only)* | Hold something (§8.7), then Console: `call("/api/stock-reset", "POST", { confirm: "RESET_STOCK" })` | **This zeroes stock on every active product.** Afterwards `select count(*) from "StockLevel" where "reservedQuantity" <> 0` → **0**, `select sum("reservedStock") from "Product"` → 0, and §8.8 → 0 rows. A later Reserve stock now does **not** bring the old hold back. | |

## 14. The server refuses what the screen hides (A5, A6, A7, A10–A12, A41c)

Run in the DevTools Console using `call` from §0.8. Replace `<id>` / `<token>`.

| # | Case | Call | Expected | ✓ |
|---|---|---|---|---|
| 14.1 | Dummy: no status change | `call("/api/deliveries/<D7 id>", "PUT", { status: "SCHEDULED" })` | **409** "Dummy delivery: no warehouse matched this invoice number. No actions are allowed." | |
| 14.2 | Dummy: no customer, link, reserve, flag | `call("/api/deliveries/<D7 id>/customer", "POST", { phone: "9876543210" })`, `…/generate-token` POST, `…/reserve` POST, `call("/api/deliveries/<D7 id>/flag", "POST", { reason: "x" })` | **409** with the same Dummy message on each. | |
| 14.3 | Link before the customer is saved (A5) | `call("/api/deliveries/<unsaved matched id>/generate-token", "POST")` | **409** "Save the customer first." | |
| 14.4 | Schedule / walk-out before saving (A6) | `call("/api/deliveries/<unsaved matched id>", "PUT", { status: "SCHEDULED" })` and `{ status: "WALK_OUT" }` | **409** "Save the customer first." for both. | |
| 14.5 | Link after the customer submitted (A8) | `call("/api/deliveries/<D9 id>/generate-token", "POST")` | **409** "The customer has already submitted; edit the delivery instead." | |
| 14.6 | Second submit is locked (A7) | In the **private window's** console (define `call` there too): `call("/api/public/delivery/<D9 token>", "PUT", { isOutstation: false, customerAddress: "12 Test Road", customerPincode: "560011", alternatePhone: "9123456780", requestedDate: "YYYY-MM-DD" })` | **409** "These delivery details were already submitted. Please contact the store to change them." | |
| 14.7 | Public PUT: alternate rules | A **fresh** token (Save + Generate on a spare matched delivery, e.g. D4b before §7.6). Same call with `alternatePhone` missing / `"12345"` / equal to that delivery's main number | **400** "Enter a valid 10-digit alternate number." ×2, then **400** "The alternate number must be different from your main number." Nothing is locked (all refused). | |
| 14.8 | Public PUT: Bangalore needs a date | Same token, valid body, `isOutstation: false`, no `requestedDate` | **400** "Please choose a delivery date." | |
| 14.9 | Public PUT: past date | Same token, `requestedDate` = yesterday | **409** "That date has already passed. Please choose another date." | |
| 14.10 | Public PUT: main phone cannot be changed (A10) — **run last, it submits** | Same token, valid body with a real future `requestedDate`, plus `customerPhone: "9000000000"` | **200**, the delivery is SCHEDULED, and SQL shows `customerPhone` **unchanged**. | |
| 14.11 | Public GET after expiry | §5.7 then `call("/api/public/delivery/<token>")` | **410** "This link has expired. Please contact the store for a new link." | |
| 14.12 | Bad token | `call("/api/public/delivery/nope")` | **404** "Invalid link. Please contact the store." | |
| 14.13 | Staff date: full day / past | `call("/api/deliveries/<scheduled id>", "PUT", { scheduledDate: "<full day>" })`, then a past day | **409** "This delivery slot is now full. Please choose another date." / "That date has already passed. Please choose another date." | |
| 14.14 | Staff date: clear it | `call("/api/deliveries/<scheduled id>", "PUT", { scheduledDate: null })` | 200; the date card reads "date not set". | |
| 14.15 | Changing the main phone unlinks the customer | `call("/api/deliveries/<saved PENDING id>", "PUT", { customerPhone: "9000000001" })` | 200; phone stored `+91-9000000001`; `customerId` now **null**; the detail asks to Save the customer again. Server log: `customer phone changed — saved customer unlinked`. | |
| 14.16 | Reserve on a non-holding status | `call("/api/deliveries/<PENDING matched id>/reserve", "POST")` | **409** "Stock cannot be reserved for a delivery in PENDING status". | |
| 14.17 | Warehouse API: floor without prefix | BCC store id: `select id from "Store" where code='BCC_STORE';` → `call("/api/warehouses", "POST", { storeId: "<id>", code: "BCC_F2", name: "BCC F2", kind: "FLOOR" })` | **400** "A floor warehouse needs an invoice prefix." Nothing created. | |
| 14.18 | Permission: no `deliveries.edit` | Sign in as the §0.4 user | **No Match warehouses button.** Pressing Save Customer shows a permission error and saves nothing. `call("/api/deliveries/match-warehouses", "POST")`, `…/<id>/customer` POST and `…/<id>/reserve` POST each → **403**. | |
| 14.19 | Permission: no `deliveries.create` | Same user → Generate Link, or `call("/api/deliveries/<id>/generate-token", "POST")` | **403**. | |
| 14.20 | Permission: no `warehouses.edit` | A user without it → `/stores` edit a floor → Save | Refused by the server (403). | |

## 15. Things that must not have broken (regressions)

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 15.1 | Public routes stay public | Private window: `/fill/<valid token>`, `/review/<token>` (any existing), `GET /api/public/delivery-slots` | All load without a login redirect. | |
| 15.2 | Dashboard outwards | `/` dashboard after §9 and §10 | Loads; today's outward figures include the walk-outs and deliveries you handed over. | |
| 15.3 | Transfers | Create a godown → floor transfer | Works as before; the floor quantity rises (use it as the real way to fix §9.4). | |
| 15.4 | Customers screen | `/customers` | Lists the customers created in §4 with their `+91-` phones; "Legacy Test" keeps `9845969508`. Editing one still works. | |
| 15.5 | Stock page reserved figure | `/stock/<product with a hold>` (e.g. `8004` after §6.12) | Reserved figures show the held quantity (read from `Product.reservedStock`, the cache). No 500. | |
| 15.6 | Walk-out list | `/deliveries/walkout` | Lists completed walk-outs; clicking opens `/deliveries/<id>`. | |
| 15.7 | Old deliveries in later statuses | Open any DELIVERED / WALK_OUT row imported before the build | No Dummy badge or banner (terminal rows are never Dummy), even with no warehouse. | |
| 15.8 | Server logs | Watch the `npm run dev` terminal through the walk | Lines scoped `deliveries:api`, `stock:hold`, `deliveries:customer`, `deliveries:floor-warehouse`, `public:self-fill`, `warehouses:api`. **No phone numbers, addresses or tokens** in any line (the public route logs `deliveryId` only). | |
| 15.9 | Browser console | DevTools Console on the detail, walk-out and `/fill` pages | No red errors; no `Unexpected token '<'`. | |

## 16. Database checks — run at the end

```sql
-- 16.1 One customer per phone (both forms counted as one)
SELECT right(regexp_replace(phone,'\D','','g'),10) AS n, count(*) FROM "Customer" GROUP BY 1 HAVING count(*) > 1;   -- 0 rows

-- 16.2 The hold cache equals the ledger (T4)
SELECT p.sku, p."reservedStock", coalesce(sum(s."reservedQuantity"),0) AS ledger
FROM "Product" p LEFT JOIN "StockLevel" s ON s."productId" = p.id
GROUP BY p.id HAVING p."reservedStock" <> coalesce(sum(s."reservedQuantity"),0);                                   -- 0 rows

-- 16.3 currentStock equals the sum of warehouse quantities
SELECT p.sku, p."currentStock", coalesce(sum(s.quantity),0) AS ledger
FROM "Product" p LEFT JOIN "StockLevel" s ON s."productId" = p.id
GROUP BY p.id HAVING p."currentStock" <> coalesce(sum(s.quantity),0);                                              -- 0 rows

-- 16.4 No negative stock or holds
SELECT * FROM "StockLevel" WHERE quantity < 0 OR "reservedQuantity" < 0;                                           -- 0 rows

-- 16.5 A held delivery is always in a holding status, and never a Dummy
SELECT "invoiceNo", status, "warehouseId" FROM "Delivery"
WHERE "stockReservedAt" IS NOT NULL AND (status NOT IN ('SCHEDULED','PACKED','OUT_FOR_DELIVERY','SHIPPED','IN_TRANSIT') OR "warehouseId" IS NULL);   -- 0 rows

-- 16.6 deliveryZone and isOutstation agree
SELECT "invoiceNo", "deliveryZone", "isOutstation" FROM "Delivery"
WHERE ("deliveryZone" = 'OUTSTATION') <> "isOutstation" AND "deliveryZone" IS NOT NULL;                             -- 0 rows

-- 16.7 Every scheduled-by-customer row is SCHEDULED or later
SELECT "invoiceNo", status FROM "Delivery" WHERE "selfFillCompletedAt" IS NOT NULL AND status IN ('PENDING','VERIFIED');   -- 0 rows

-- 16.8 Every delivery phone written after the build is +91-
SELECT "invoiceNo", "customerPhone" FROM "Delivery" WHERE "customerId" IS NOT NULL AND "customerPhone" NOT LIKE '+91-%';  -- 0 rows

-- 16.9 The partial index exists
SELECT indexname FROM pg_indexes WHERE indexname = 'Warehouse_one_primary_floor_per_store';                          -- 1 row

-- 16.10 One OUTWARD set per handed-over invoice (idempotency)
SELECT "referenceNo", "productId", count(*) FROM "InventoryTransaction" WHERE type = 'OUTWARD'
GROUP BY 1,2 HAVING count(*) > 1;                                                                                   -- 0 rows
```

## 17. Known and accepted — do not file these as bugs

From the plan's §6 "Found, not fixed", "Deviations" and "Noted":

- The walk-out screen's back arrow always returns to `/deliveries/<id>`, even when you came from a
  BLR / Outstation detail.
- A reverse-pickup Bangalore row shows two blue badges (Reverse and Bangalore).
- The desktop table on `/deliveries` opens `/deliveries/<id>` (only the BLR / Outstation lists use their own routes).
- Two different deliveries booking the **last** slot of a day at the same instant can both succeed.
- The public GET still returns the address, area and pincode (the form pre-fills from them).
- `/deliveries/dispatch`, `receivables`, `bins`, `delivery-details-card`, `free-accessories-editor`,
  `service-invoice-section` and the courier save still use raw `fetch`. The courier save does not check its response.
- With `NEXT_PUBLIC_LOG_LEVEL=0` the browser logs request bodies, so on `/fill` the alternate phone and address appear in the customer's own console. The default level does not.
- Manual outwards and store audits still take from the godown when the floor is short (plan §5).
- Transfers still pick "the store's floor" as the first floor by sort order, not the primary one.
- A Dummy cannot be given a warehouse by hand: fix the prefix, then press Match warehouses.
- Deleting a primary floor is not guarded.
- `Store.invoicePrefix` and `Delivery.isOutstation` are still in the database. They are dropped in a later release.
- Inbound receiving in **bin mode** writes `Product.currentStock` without a `StockLevel` row (a pre-existing defect, raised separately). §16.3 may list such products.

## 18. Clean up the local test data

```sql
-- Undo a day filled by §6.15 (replace the date)
UPDATE "Delivery" SET "scheduledDate" = NULL WHERE "scheduledDate" = (DATE 'YYYY-MM-DD' - interval '330 minutes') AND status = 'PENDING';
-- Remove the stock rows this walk added
DELETE FROM "StockLevel" WHERE id LIKE 'manual-test-%';
UPDATE "Product" p SET "currentStock" = (SELECT coalesce(sum(quantity),0) FROM "StockLevel" s WHERE s."productId" = p.id),
                       "reservedStock" = (SELECT coalesce(sum("reservedQuantity"),0) FROM "StockLevel" s WHERE s."productId" = p.id)
WHERE p.sku IN ('5958','1323','4111','6267','858','9790','8004');
-- Remove the §4.7 legacy customer (unlink first: Delivery.customerId is ON DELETE RESTRICT)
UPDATE "Delivery" SET "customerId" = NULL WHERE "customerId" = 'manual-test-legacy';
DELETE FROM "Customer" WHERE id = 'manual-test-legacy';
```

Deliveries you walked out or delivered stay that way; restore a snapshot
(`npm run db:restore:local -- backups/<file>`) if you want the clean 232 PENDING rows back.

## 19. After the walk passes — before the cloud test database

Not testing, but it is what makes these cases true anywhere other than `bch_local`:

1. `npm run db:snapshot` (rule 9) — the Phase 1 migration **releases every stock hold** and cannot be undone except by the snapshot. Run the two count queries in its header first.
2. `npx prisma migrate status`, then `npx prisma migrate deploy` for the three migrations.
3. Check the partial index exists there (§16.9); `migrate diff` does not model it.
4. On `/stores`, set `INV/` and `BCC/` on the two floors, and mark a primary where a store has two floors.
5. On `/deliveries`, press **Match warehouses**. Until then, every open delivery is a Dummy with no actions.
6. When the plan is signed off, move it to `completed/` (`/ship-plan`).
