# Manual testing — the four 0909 plans on `feat/0909-stock-po-expense`

What to test by hand for commits `c2c6913`, `89d9025` and `ee72cd5` on
`feat/0909-stock-po-expense`. Written 9 Sep 2026, after `npm run build` passed on this tree.
The plans it verifies, and the section each set of cases is the browser half of:

| Plan | Cases below |
|---|---|
| `docs/implementation/pending/0909-stock-store-and-warehouse-scoping-plan.md` §4 | §1 |
| `docs/implementation/pending/0909-stock-screens-size-category-and-sidebar-plan.md` §4 | §2 |
| `docs/implementation/pending/0909-expense-multi-entry-flow-plan.md` §4 | §3 |
| `docs/implementation/pending/0909-po-ai-upload-and-brand-stock-removal-plan.md` §5, §6 | §4 |

`npm run build` passed on 9 Sep 2026 (exit 0, compiled in 5.1 min, 155 pages, no brand-stock route in the output); `tsc --noEmit` and `eslint` are clean. **None of them proves any of the
below** — every case here is behaviour a compiler cannot see. Tick the last column as you go;
a case that fails gets the observed behaviour written in, not a cross.

---

## 0. Before you start

| # | Step | Why |
|---|---|---|
| 0.1 | Print the database host before you trust it: `grep -n "^DATABASE_URL" .env`. Lines 13–14 are localhost `bch`; the two Supabase projects are commented out in the same file. | Every step below is against whichever database this points at. |
| 0.2 | `npx prisma migrate status` → must say **up to date**. If it names `20260909101536_warehouse_kind` or `20260909101928_po_extraction` as pending, run `npx prisma migrate deploy`. | The stock screens read `Warehouse.kind`; the PO import writes `PoExtraction`. Without the columns the pages 500. Local `bch` already has both; the cloud test project has neither. |
| 0.3 | `npm run db:seed:stores` → prints `warehouses : 4 synced (2 new)` the first time, `(0 new)` after. | Creates `BCH Floor` and `BCC Floor`. Already done on local `bch`. |
| 0.4 | `npm run db:seed:rbac` → watch the output for `modules : 1 stale removed` and `permissions : 3 stale removed`. | Removes the `brand_stock` module and its grants, sets `warehouses.route = NULL`, sets `expenses.route = /expenses`. Until this runs the sidebar is wrong in three places. |
| 0.5 | Sign in as an ADMIN. Have one non-admin user ready who holds `stock.view` but not `purchase_orders.create`, and one who holds `expenses.view` but not `expenses.create`. | §3 and §4 have permission cases. |
| 0.6 | Settings → AI: a provider with a key, and its test passes. Settings → Storage: a provider configured, and its test passes. | §4 needs AI for PDF/image uploads (Excel does not). §3 and §4 store a photo / the quotation; both degrade without storage, and the cases say how. |
| 0.7 | Note a product with stock in the godown, its SKU and its reorder level. Note a vendor that has at least one product with `reorderVendorId` set to it. | §1 step 6, §4 throughout. |
| 0.8 | Have a small vendor quotation to hand: one `.xlsx` with columns like Item / SKU / Qty / Price, and one `.pdf` or a phone photo of a printed price list. Include one row whose name matches a product you have and one that matches nothing. | §4 tests both parsers and both match outcomes. |

---

## 1. Stock at two scopes — `/stores`, `/stock`, `/stock/by-bin`, `/stock/by-store`

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 1.1 | Kinds on `/stores` | Open `/stores` | Each store lists **two** warehouses: the floor with a `Floor` tag and the original with a `Godown` tag. | |
| 1.2 | Add warehouse offers the kind | Add warehouse on any store | The draft card has a two-button **Floor / Godown** toggle beside Code and Name, defaulting to Godown. Save, and the row shows the tag you chose. Edit it and flip the kind; the tag follows. | |
| 1.3 | Two header buttons | `/stock` header | **By Location** and **By Store** side by side, same style. Enter select mode (bulk edit) → both hide. | |
| 1.4 | By Location shows four | `/stock/by-bin` | Four cards under two site headings. Floors carry the **blue Store icon** and read **0 units**; godowns carry the amber Warehouse icon with today's numbers. The footer line says a floor at 0 has not been counted yet. **A floor at 0 is correct here, not a bug** (plan D3). | |
| 1.5 | By Store | `/stock/by-store` | Two store cards. Each shows product count, units, value, and a line like `BCH Floor 0 · BCH Warehouse N`. The store's units equal the sum of its two locations on 1.4. | |
| 1.6 | Drill-in and back | Tap BCH Store on 1.5 | Lands on `/stock/by-location/BCH_STORE`, blue Store header, store total, per-warehouse totals. The back arrow returns to **By Store**. From 1.4 tap a warehouse card → back arrow returns to **By Location**. | |
| 1.7 | Store filter is searchable | `/stock` → Filters | A **Store** control that opens a list when tapped; typing narrows it. Options read `<store name>` with the hint `2 locations`. | |
| 1.8 | Store filter scopes the numbers | Pick BCC Store | Only products BCC holds appear; the Stock column shows **BCC's** quantity, not the global one; the caption under the control reads "Showing what BCC Store holds. Quantities are that store's." Low-stock colours follow the scoped number. **Clear all** resets the store. | |
| 1.9 | Chips agree with the column | With a store selected, tap **In Stock**, then **No Stock** | In Stock lists rows whose scoped quantity is above 0. No Stock lists **nothing** (by construction — the list is what the store holds). A row showing 0 under In Stock is a bug. | |
| 1.10 | Phone width | Repeat 1.7 at 375 px wide | The dropdown is not clipped by the panel edge. | |
| 1.11 | Inbound defaults to the godown | `/inbound/<any shipment>` → receive a line | The warehouse buttons pre-select the **godown**. Change it to the floor and receive → 1.4 shows the unit on the floor. | |
| 1.12 | Move units godown → floor keeps the total | Raise a warehouse-scoped stock audit on **BCH Floor**, count the product from 0.7 as N, approve with *set system stock*. Then audit **BCH Warehouse** and set it to (previous − N). | Before and after: the store total on `/stock/by-store` **and** on `/stock/by-location/BCH_STORE` is **unchanged**. **If it moves, stop** — the recompute is double-counting and every scoped number rests on it. | |
| 1.13 | Outbound drains the floor first, warns on the godown | With floor N and godown M for one product, deliver a walk-out sale of N+1 | Sale succeeds. Floor goes to 0, godown to M−1. The server log carries `outbound reached the godown` with productId and storeId. Now a sale larger than N+M−1 is **refused** with the store-total message, as before. | |
| 1.14 | Stock-count approve still works | Approve any whole-store count with a correction | No change in behaviour; the correction lands in the chosen warehouse. | |

## 2. Four stock screens — filters, product edit, brand-count, inbound, sidebar

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 2.1 | Sidebar | Look under **Store Management** | **Stores** only. No Warehouses entry. The heading itself is still there. A user who had Warehouses pinned to the bottom bar loses that pin silently; the rest of the bar is unchanged. | |
| 2.2 | Warehouse CRUD survived the unlink | On `/stores`, add, edit and deactivate a warehouse | All three work — the module's grants were kept (plan D14). | |
| 2.3 | Searchable Category and Brand | `/stock` → Filters | Category and Brand open lists and narrow as you type, each option with a product count hint. **No Size control anywhere.** Clear all resets them; the active-filter count is right. | |
| 2.4 | No size on rows or in the export | `/stock` list, then export CSV | No size badge on any row. The CSV has **no Size column**. The search box placeholder mentions category, not size. | |
| 2.5 | Search still finds products | Type a SKU, then part of a name, then a brand | All three still match. | |
| 2.6 | Category picker on product edit | `/stock/<id>` → Edit | Where Size was, a **Category** searchable picker, pre-filled with the product's own category, parents and children listed once each (no duplicates), child options hinting their parent. Change it, save → the violet category chip updates. **No size badge on the page.** | |
| 2.7 | Product in an inactive category still saves | Open a product whose category is inactive (local `bch`: category `12` holds 15) → Edit → change only the name → Save | Saves. The picker showed the category as `<name> (inactive)`. | |
| 2.8 | Moving TO an inactive category is refused | Same product → Edit → pick an active category → Save, then deactivate that category on `/categories` → Edit again → pick the now-inactive one → Save | The second save is refused with `"<name>" is inactive. Activate it on /categories first.` | |
| 2.9 | API refuses unknown ids | `curl -X PUT /api/products/<id> -d '{"brandId":"nope"}'` with a session cookie | 400 `Selected brand no longer exists`. | |
| 2.10 | Inbound picker has no duplicates | `/inbound/<id>` → the category picker on a line | Each child category appears **once**. | |
| 2.11 | Inbound shows times | `/inbound/<id>` summary | "Created by X on 9 Sep 2026, 14:32" and "Approved by X on …" carry the time. Delivered by and Putaway by read "<name> on <date, time>" once set. The Delivered row shows the time. **Bill Date and Expected Delivery are still date-only.** | |
| 2.12 | Brand-count: store, then warehouse | `/stock-audit/brand-count` → pick a brand | **Store buttons** appear first. Choosing a store reveals only that store's warehouses, each with a `Floor` / `Godown` tag. There is **no Whole store button**. Header and sticky bar read `<warehouse> · <store>`. | |
| 2.13 | Brand-count guard | Pick a brand, pick no store, try to continue | Refused: it asks for a store and a location. Pick BCH Store, pick a warehouse, then switch to BCC Store → the warehouse selection **clears**. | |
| 2.14 | Brand-count draft survives | Pick brand, store, warehouse → reload the page | Store and warehouse are restored from the draft. **Start fresh** clears both. | |
| 2.15 | Old count opens | `/stock-audit/<an existing count>` | Opens; the item list renders with no size column. | |

## 3. Expenses — `/expenses`, `/expenses/new`

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 3.1 | In the sidebar | Look under **Accounts** | **Expenses** is listed. It opens `/expenses`. (Requires 0.4.) | |
| 3.2 | Date is today, payer is you | `/expenses` → **+ New** | The date shows **today** untouched. The payer shows **your name**, read-only, with a lock; there is no way to type another. | |
| 3.3 | First expense, no photo | ₹250 → **Food & Tea** → "tea for the counter" → **Cash** → skip the photo → **Add another** | Each step blocks Next until valid (amount > 0, a category chosen, description non-empty). The header shows "Step n of 5" and "1 in batch" after the first is added. | |
| 3.4 | Second expense with a photo, on a phone | ₹1,200 → **Transport** → "tempo to Ludhiana" → **UPI** → **Take photo** | The camera opens. **Choose from gallery** opens the library instead. Attach one → a thumbnail renders with a Remove button. Pick a second → it **replaces** the first. | |
| 3.5 | Non-image refused | On the photo step choose a PDF from the gallery/files | "Only a photo can be attached." Nothing uploads. | |
| 3.6 | Review | **Review** | Two rows with every field and the thumbnail on the second; total ₹1,450; one **Submit**. Cash and UPI in one batch is fine. | |
| 3.7 | Edit from review | Edit row 1 → change the amount to ₹300 → save | Returns to review; total is ₹1,500; the batch count did not change. | |
| 3.8 | Remove and re-add | Remove row 1, add it again, **Submit** once | Lands on `/expenses`. Both rows listed; a paperclip on the second only, and it opens the photo. | |
| 3.9 | Database | Query the two rows | `paidBy` = your name and `recordedById` = your id on both; row 2's `receiptUrl` holds the photo URL, row 1's is `null`. | |
| 3.10 | Delete removes the photo | Delete row 2 from `/expenses` | Row gone **and** the object gone from the bucket or the local upload directory. Delete row 1 → succeeds with no storage call. | |
| 3.11 | Storage unconfigured | Turn storage off in Settings → attach a photo | "Storage is not configured…" is shown; an expense **without** a photo still submits. | |
| 3.12 | Atomic batch | Build a batch, then in devtools alter one row's amount to −1 before Submit (or POST `/api/expenses/batch` with one bad row) | 400, and **nothing** was written. | |
| 3.13 | Permission | As the `expenses.view`-only user | `/expenses/new` refuses; `POST /api/expenses/batch` returns 403. | |
| 3.14 | Expired session | Let the session expire, then Submit | You land on login — **not** `Unexpected token '<'`. | |
| 3.15 | Leaving with rows | Add one row, press the browser back button | A confirmation asks before the batch is lost. | |

## 4. Purchase order from a quotation — `/purchase-orders/new`, and `/brand-stock` is gone

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 4.1 | Brand stock is gone | Sidebar under Stock Management; then type `/brand-stock` and `/brand-stock/upload` in the address bar | No entry. Both URLs 404. `/team/permissions` shows **no Brand Stock** row. (Requires 0.4.) | |
| 4.2 | Upload needs a vendor first | `/purchase-orders/new` before choosing a vendor | The **Upload a quotation** tab is disabled with a hint to choose a vendor. Choose the vendor from 0.7 → the tab enables. | |
| 4.3 | Excel path, no AI | Upload the `.xlsx` from 0.8 | Rows appear within a second or two, no AI call. The review lists every row with raw name / SKU / qty / price. | |
| 4.4 | Matching | Look at the two rows from 0.8 | The row naming your product shows the product name and SKU with an `Auto` or `Fuzzy` badge (fuzzy shows a % confidence) and is **ticked** if Auto or Fuzzy ≥ 85%. The nonsense row is `Unmatched` and unticked. | |
| 4.5 | Map by hand | On the unmatched row, use the product search | The search is scoped to the vendor; the **Search all vendors** switch widens it. Pick a product → the row becomes `Manual` and can be ticked. Clear the match → it returns to Unmatched and unticks. | |
| 4.6 | Selecting an unmapped row is refused | Try to tick an Unmatched row (or PATCH `selected: true` on it) | Refused: "Map this row to a product before selecting it". | |
| 4.7 | Use selected fills the lines | Tick the rows you want → **Use N selected rows** | They appear in the vendor section as lines with **Qty** (file qty; else reorder shortfall; else 1), **Unit Price** (file price; else the product's cost price) and **GST %** (the product's rate). Edit any of them. The sentence about the PDF being emailed from the order's page after approval is on screen. | |
| 4.8 | ₹0 line blocks submit | Set a line's Unit Price to 0 → **Submit for approval** | Refused with the line's SKU named. Put a price back → submits. | |
| 4.9 | Extraction is consumed | Save as draft (or submit) | Lands on the PO. Then check: `SELECT count(*) FROM "PoExtraction"` is **0**, and the stored quotation file is gone from the bucket / upload directory. Reload `/purchase-orders/new` → no review is restored. | |
| 4.10 | Refresh keeps the review | Upload again, then reload the page mid-review | The review comes back from the server (sessionStorage key + GET). | |
| 4.11 | Discard | Press **Discard** | Review clears; `PoExtraction` count is 0; the file is gone. | |
| 4.12 | A new upload replaces the old | Upload, do not finish, upload another file | Only the second extraction exists (count = 1). | |
| 4.13 | AI path | Upload the `.pdf` or the photo from 0.8 | A waiting state says an AI read can take 30–60 s. Rows arrive; `aiModel` on the extraction names the provider and model (`SELECT "aiModel", source FROM "PoExtraction"`). | |
| 4.14 | AI unconfigured | Remove the AI key in Settings → upload a PDF | A clear message pointing at Settings → AI (not a generic 400). An `.xlsx` still works. | |
| 4.15 | Vendor mismatch | Map a row to a product whose reorder vendor is a **different** vendor → Use selected → Submit | The review shows a vendor-mismatch notice, and the server refuses the order naming the product — the same rule manual entry has. | |
| 4.16 | Manual path untouched | Search products, add lines, Save as draft, Submit, Approve, **Send to vendor** | All exactly as before this branch. The email carries the PDF. | |
| 4.17 | Permission | As the user without `purchase_orders.create` | The upload tab is not usable; `POST /api/purchase-orders/extract` returns 403. | |
| 4.18 | Cost price gate | As a user without `cost_price.view`, review a quotation | Matched products show no cost price; the Unit Price default is the file price or blank, never the cost price. | |
| 4.19 | Brand merge still works | `/more/brands` → merge two brands | Succeeds. (The merge route still moves the empty brand-stock rows; they are dropped in P5, a later release.) | |

---

## 5. Sign-off

| Section | Cases | Passed | Failed (case numbers) | Tested on (db host) | Date |
|---|---|---|---|---|---|
| 1 Stock at two scopes | 14 | | | | |
| 2 Four stock screens | 15 | | | | |
| 3 Expenses | 15 | | | | |
| 4 PO from a quotation | 19 | | | | |

When every section passes, say so and the four plans move to `completed` with `/ship-plan`
and the branch is pushed. A failed case goes back as: the case number, what you saw, and the
server log line if there is one — not a screenshot alone.

---

## 6. Transfers — mode, required document, GST off the store form (added 9 Sep 2026 evening)

Plan `docs/implementation/pending/0909-transfer-mode-and-document-attachment-plan.md`, commit
after `e3589d3`. **Before 6.1:** Settings → Storage must have an **active** provider (Local is
enough on this machine) — with none, every upload says "Storage is not configured" and no
transfer is created. **And** the source store resolves to its **floor**, which holds 0 until the
opening split (case 1.12) is done — do 1.12 first or every transfer is refused for stock.

| # | Case | Steps | Expected | ✓ |
|---|---|---|---|---|
| 6.1 | No GST on the store form | `/stores` → New store, and Edit an existing one | **No GSTIN field, no state code, no amber "No GSTIN" badge** anywhere. Save still works. | |
| 6.2 | Two modes | `/transfers/new` | Two buttons: **Store → Store** and **Store → Warehouse**. Nothing is pre-selected. No GSTIN wording anywhere on the page. | |
| 6.3 | Store → Store panels | Pick Store → Store | Left lists the stores; pick BCH Store → a hint reads "Stock leaves from BCH Store's floor (BCH Floor)". Right lists the **other** store only. The line under the panels says a **tax invoice** is required. | |
| 6.4 | Store → Warehouse panels | Switch to Store → Warehouse | The destination clears and the attached file (if any) clears. Right lists **every** active warehouse grouped by store, minus BCH Floor. The line says a **delivery challan** is required. | |
| 6.5 | File is required | Add an item, leave the file empty | Submit is disabled; the hint names the missing document. Number and date are optional. | |
| 6.6 | Non-document refused | Attach a `.docx` | Refused with a sentence; only PDF or an image is accepted. | |
| 6.7 | Create with a PDF | Store → Store, one item with stock on the floor, attach a PDF, submit | Lands on `/transfers/TRF-…`. The chip reads **Store → Store**; the Document card shows the tax invoice with the file; the database row has `mode = STORE_TO_STORE`, `fromStoreId`, `toStoreId`, `docUrl`, and `transferType` is **null**. | |
| 6.8 | Create with a photo | Store → Warehouse to BCC Warehouse, attach a photo from the gallery | Same, chip reads **Store → Warehouse**, document type delivery challan, `toStoreId` null. | |
| 6.9 | Upload failure creates nothing | Deactivate storage, try to submit | The helper's "Storage is not configured…" line; **no transfer row** was created (`SELECT count(*) FROM "TransferOrder"` unchanged). | |
| 6.10 | Same place refused | Store → Warehouse from BCH Store to **BCH Floor** (via direct POST — the UI hides it) | 400 naming the warehouse. | |
| 6.11 | Stock short on the floor | Any transfer for a product with 0 on the source floor | Refused for stock, naming the floor — expected until 1.12 is done. | |
| 6.12 | Dispatch gate still works | Approve 6.7 → Dispatch | Allowed (document present). An old order with no document is still refused. | |
| 6.13 | Draft survives a reload | Pick mode, stores, items → reload | Mode, stores and items restore; the file does not (re-attach). An old `-v2` draft from before this change is ignored. | |
| 6.14 | Phone width | 375 px | The two panels stack, source above destination. | |
| 6.15 | Old transfers | Open any transfer created before this change (none exist on local `bch`; skip if none) | Chip falls back to the old "Inter-store / Within one store" wording; nothing errors. | |

| Section | Cases | Passed | Failed (case numbers) | Tested on (db host) | Date |
|---|---|---|---|---|---|
| 6 Transfers | 15 | | | | |
