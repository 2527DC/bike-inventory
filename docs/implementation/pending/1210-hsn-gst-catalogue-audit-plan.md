# HSN codes and GST slabs across the catalogue: a tax audit, corrections that reach Zoho, and a from → to trail

Status: pending — written 12 Oct 2026; plan only, nothing built — waiting for the owner's answer to Q1 (and Q2 before Part C).
Branch: **`feat/1210-hsn-gst-audit`** — create it with exactly this name, off `main`.

This plan covers **map R27** of `docs/implementation/requiremnts/accounts-and-compliance-feature-map.md`.
Seven sibling plans cover the rest of that list (§3, "Dependencies on sibling plans").

Every `file:line` below was read from disk on 12 Oct 2026, on branch
`fix/1210-push-integrations-same-db-check` (HEAD `d878426`). Zoho API behaviour is cited to Zoho's
public documentation, fetched the same day; where the documentation does not settle a point, the
plan says so and Phase 0 checks it with a read-only call.

**Two words used throughout, explained once:**

- **HSN code** (Harmonised System of Nomenclature) — the government's classification number for a
  kind of goods. It is printed on every tax invoice and in the monthly GST return. 4 digits is the
  *heading* (`8712` = bicycles), 6 the *sub-heading*, 8 the *tariff item* (`87120010`). Services
  use a **SAC** code instead, which always starts `99` (`998714` = repair of other goods).
- **GST slab** — the tax rate the law assigns to a kind of goods. In Karnataka a sale inside the
  state is taxed as **CGST + SGST** (half each — "intra-state"); a sale to another state as **IGST**
  (the full rate — "inter-state"). The total is the same slab either way. Zoho Books therefore
  stores **two** tax settings on every item: one for intra-state and one for inter-state sales.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (8 Oct 2026)

> 27. Maintaining correct HSN codes and GST tax slabs across the item catalog (cycles, spares, RC cars, EV scooters)

The map restated it as *"R27 — Keep HSN codes and GST slabs correct across the whole item
catalogue"* and placed it at *"a 'Tax audit' view on `/categories` or `/stock`: blank HSN, rate
differing from the category's expected rate, mismatch with Zoho. Edit on the product page, and
extend the Zoho item update to carry `hsn_or_sac` and `tax_id`"* (map §3.9, lines 389-398).

### 0.2 Restated as requirements

Plan-local numbering. Every one is map R27; the Source column says where the detail comes from
when it is not the owner's sentence itself.

| # | Requirement | Map | Source | Part |
|---|---|---|---|---|
| **R1** | List every product whose **HSN code is missing or is not a well-formed code** (wrong length, letters, a service code on goods). | map R27 | owner: "correct HSN codes"; map §3.9 "blank HSN" | A |
| **R2** | List every product whose **GST rate is not a current slab** — including the 12 % and 28 % slabs abolished on 22 Sep 2025 (§2.6). | map R27 | owner: "GST tax slabs" | A |
| **R3** | Each kind of goods — **cycles, spares, RC cars, EV scooters**, and any other category — can state the HSN and rate its products should carry, and products that **differ from their category** are listed. | map R27 | owner's parenthesis; map §3.9; `gst-consultant.md:51` "mismatched to its category" | A |
| **R4** | List every product whose HSN or rate **here differs from Zoho Books**. | map R27 | map §3.9 "mismatch with Zoho" | A |
| **R5** | HSN and rate can be **corrected on the product page and in bulk** from the audit. | map R27 | map §3.9 "Edit on the product page" | B, C |
| **R6** | A correction **reaches Zoho Books too**, for every product linked to a Zoho item; a product with no Zoho item is **named, never silently skipped**. | map R27 | `gst-consultant.md:64` "Any GST rate change must be updated in BOTH systems simultaneously" | C |
| **R7** | Every change records **who, when, and the value before and after**. | map R27 | "maintaining" — a correction nobody can trace is not maintenance | B |
| **R8** | The Zoho comparison and every bulk change run **in pages and batches inside Zoho's API limits**, and **nothing is written to Zoho without a preview** first. | map R27 | `integration-architect.md:76` rate-limit red flag | A, C |
| **R9** | Seeing and changing tax data is a **permission an admin grants**, never a role check. | map R27 | CLAUDE.md "Access control is DATA" | A |

---

## 1. Questions and clarifications — answer before build

### 1.1 Decisions on record

The answers below were given for the whole 28-point list; these are the ones that bear on this plan.

| # | Decision | How it applies here | Date |
|---|---|---|---|
| D2 | **One Zoho Books organisation** for both stores; the single `IntegrationConfig` row per provider is correct. | One item catalogue, one set of Zoho tax codes, one API budget. HSN and rate are per **item**, not per store — nothing here is split by Hub / Centre. | answered in session, 12 Oct 2026 |
| D11 | Vendor payment → Zoho by an explicit "Push to Zoho" button after save; a Zoho failure never blocks saving; the screen shows pushed / not pushed. | **Contrast, not precedent.** A payment is a record this app originates. An item's tax is what the GST returns are filed from, in Zoho (`gst-consultant.md:65`, "the app must not contradict Zoho's tax data"). Q1 asks whether tax follows D11 or the stricter Zoho-first rule this plan recommends. | answered in session, 12 Oct 2026 |
| D21 | E-way bills are generated through Zoho Books. | Zoho builds an e-way bill from the **Zoho item's** HSN. Clean item HSN in Zoho is therefore an input to `1210-eway-bills-through-zoho-plan.md`; no code dependency either way. | answered in session, 12 Oct 2026 |
| D22 | GST returns (R24–R26) are not built — the CA works in Zoho. TDS (R28) not built. | This plan audits and corrects the **item master** only. It builds no GSTR report, no ITC calculation and no tax summary. | answered in session, 12 Oct 2026 |

### 1.2 Open questions

**Q1 blocks the build. Q2 blocks Part C only** — Parts 0, A and B can be built and shipped while it
is open. Every other question has a recommended default the build runs on unless the owner says
otherwise.

| # | Question | Why it changes the build | Options | Recommended default | **Answer** |
|---|---|---|---|---|---|
| **Q1** **BLOCKS** | **Which way do corrections flow?** | Decides whether Part C (writes to Zoho) is built at all, and what happens on the screen when Zoho refuses a change. | **(a) Zoho first.** For a product linked to a Zoho item, the app sends the change to Zoho; only when Zoho accepts it is the app's own copy changed, in the same step. Zoho never holds a value the app does not, and vice versa. A product with no Zoho item is changed here only, and labelled so. **(b) Fix in Zoho, pull here.** The app audits and offers "use Zoho's value"; all corrections are typed in Zoho (or by Zoho's own item import). No Zoho writes; Part C not built. **(c) D11-style.** Save here always; a separate Push button; the screen shows pushed / not pushed. | **(a)**. It is the only option that satisfies both consultant rules at once — "update BOTH systems simultaneously" and "the app must not contradict Zoho" (`gst-consultant.md:64-65`). (c) leaves the app contradicting Zoho for every row a person forgot to push, which is the exact state this audit exists to find. (b) is the cheapest and is a fine answer if the accountant already prefers editing in Zoho. | |
| **Q2** blocks Part C | **Which Zoho Books plan is BCH on, and can we get a Zoho trial or sandbox organisation to test writes against?** | Zoho caps API calls per organisation per day by plan: 1,000 Free, 2,000 Standard, 5,000 Professional, 10,000 Premium and above, plus 100 a minute ([Zoho Books API — introduction](https://www.zoho.com/books/api/v3/introduction/)). That budget is shared by **every** Zoho feature in this app *and* by the test database, which now holds production's credentials. It sets the daily write cap (C5) and the test path (§4). | Plan name; trial org yes / no | Daily write cap = a quarter of the plan's daily limit (500 on Standard). Test writes on a trial organisation connected to a **local** database; failing that, the single no-op write in §4. | |
| Q3 | **Did either GSTIN's aggregate turnover in the previous financial year exceed ₹5 crore?** | Sets the HSN length the audit demands. Notification 78/2020-Central Tax: up to ₹5 crore, 4 digits on B2B invoices; above ₹5 crore, 6 digits on every invoice ([notification PDF](https://www.gstcouncil.gov.in/sites/default/files/2024-05/notfctn-78-central-tax-english-2020.pdf)). | 4 / 6 / 8 minimum | **6**, whatever the answer — it satisfies both tiers, and 8-digit codes are shown as the best form. Stored as a setting (A2), so changing it is not a deploy. | |
| Q4 | **Confirm the slab list with the CA, and: does any product legitimately sell at 0 %?** | Decides which rates the audit calls valid. Zoho books a 0 % item as non-taxable with a named exemption, not as a 0 % tax ([items API](https://www.zoho.com/books/api/v3/items/) — `tax_exemption_id` is "Mandatory, if `is_taxable` is false"), so a 0 % push needs that exemption chosen first. | valid set; 0 % yes / no | Valid {0, 5, 18, 40}; **abolished** {12, 28}, shown as "old slab — abolished 22 Sep 2025" rather than as a typo. Pushing 0 % to Zoho is refused with a sentence until an exemption is mapped (C2). All of it is a setting. | |
| Q5 | **Who may see and change tax data?** | One new module in the RBAC catalog (A3). | (a) a new module `product_tax`: `view` (audit + history), `edit` (correct products and category expectations — including the Zoho write under Q1 a), `fetch` (run the Zoho comparison), `approve` (change the rules and the Zoho tax-code mapping); (b) reuse `stock.edit` | **(a)**. GST data is financial; `stock.edit` is held by floor roles for bins and reorder levels. (b) would also leave the side door in L3 as the rule rather than the exception. | |
| Q6 | **Where does the audit live?** | One page vs. a tab inside a master screen. | (a) its own page `/stock/tax-audit`, in the sidebar under Accounts and linked from the `/stock` toolbar; (b) a tab on `/categories` | **(a)**. The worklist is products, not categories, and the accountant does not otherwise visit `/categories`. Category expectations get a tab on the same page. | |
| Q7 | **What does a category's expectation look like?** | Two nullable columns on `Category` (A1). | (a) an HSN **prefix** (2–8 digits, e.g. `8712`) plus a rate, inherited by sub-categories, blank = no check; (b) one exact 8-digit HSN per category | **(a)**. One category holds many 8-digit codes (`87120010`, `87120090`); a prefix catches a spare filed as a bicycle without flagging every legitimate variant. Leave a mixed category (e.g. "Accessories" with 5 % and 18 % items) blank, or set the rule on its sub-categories. | |
| Q8 | **The `/stock` "Fetch from Zoho" import should carry Zoho's HSN and rate** (it silently drops them today — L2), and on an existing product overwrite the local value with a from → to trail? | One component and one route change (B3). | yes / no | **Yes** — under Q1 (a) or (b) Zoho is the truth for these two fields. | |
| Q9 | **Make `Product.gstRate` nullable**, so "never set" is visible instead of looking like 18 %? | A column change on a 5,745-row table and every reader (§2.3). | yes / no | **No, not in this release.** Existing rows cannot be told apart anyway (§2.8 L9); the Zoho comparison and the category rate catch a wrong 18 %. Revisit with the `Float` → `Decimal` conversion (§5). | |
| Q10 | **Products with no Zoho item** — create them in Zoho from here? | `BooksClient.createItem` exists but is dead code (L8). | (a) flag only — listed under "Not in Zoho"; (b) create the item in Zoho | **(a)**. Creating catalogue items in the filing system is a separate decision with its own duplicates problem (SKU clashes, the junk items in L7). | |

---

## 2. How it works today — verified against the code

### 2.1 Where the two fields live

- `Product.gstRate Float @default(18)` and `Product.hsnCode String?` — `prisma/schema.prisma:582-583`.
  `Product.zohoItemId String? @unique` — `:570` — is the link to the Zoho item.
- **No category or brand carries an expected HSN or rate.** `Category` (`schema.prisma:503-524`)
  holds name, description, `parentId` (the sub-category tree), `reorderLevel`, `zohoCategoryId`,
  `isActive`. `Brand` (`:526-563`) holds contacts, lead days, `zohoBrandId`, `isActive`. There is no
  sub-category model besides the `parentId` tree, and `ProductType` was removed in the 0409 plan.
- Purchase-side copies, not master data: `InboundLineItem.gstPercent Float @default(0)` and
  `.hsn String?` (`:2492, :2495`) record what a **bill** said; `PurchaseOrderItem.gstRate`
  (`:1283`) is written as 0 since 15 Sep (`src/lib/purchase-orders/create.ts:232`).
- The rate is a `Float`; `docs/schema-review.md:280-289` lists `Product.gstRate` among the seven
  percentage columns that should become `numeric`. Every legal rate (0, 0.25, 1.5, 3, 5, 18, 40) is
  exactly representable, so comparisons are safe today; the conversion is §5.

### 2.2 Who writes them

| Writer | Where | What it does | Note |
|---|---|---|---|
| Catalog import script (offline, run once on 1 Sep) | `scripts/import-products.ts:92-93` maps Zoho's export columns `HSN/SAC` and `Intra State Tax Rate`; `:240-241`, `:292-293` write them | Create only | `Number(…) \|\| 18` — a 0 % item becomes 18 % (**L1**) |
| Zoho bill approve → product auto-create | `src/app/api/zoho/pull-review/approve/route.ts:331-347` reads the item with `items.get`; `:408-421` creates the product | Create only; an **existing** product's tax is never touched | `Number(item.tax_percentage \|\| 18)` at `:339` — same 0 → 18 (**L1**) |
| `/stock` "Fetch from Zoho" import | preview `src/app/api/stock/zoho-preview/route.ts:169-170` computes `gstRate` and `hsnCode`; import `src/app/api/stock/zoho-import/route.ts:193-206` (update, only if sent), `:247-248` (create) | Would write Zoho's values | The sheet never sends them (**L2**) |
| `PUT /api/products/[id]` | `src/app/api/products/[id]/route.ts:64-153`; schema `src/lib/validations.ts:41-42, :58` | Writes any value | Behind `stock.edit` only, no trail, no Zoho. No screen sends the fields today (**L3**) |
| `POST /api/products` | `src/app/api/products/route.ts:247-291` | Writes any value | Behind `stock.create`; no screen calls this route (grep for `"/api/products"` callers finds GETs only) |
| `POST /api/products/bulk` | `src/app/api/products/bulk/route.ts:39-47` | Does **not** accept tax fields | — |

### 2.3 Who reads them

| Reader | Where | Effect |
|---|---|---|
| Product page | `src/app/(dashboard)/stock/[id]/page.tsx:94-95` (type), `:612-614` (the one line `GST: 18% \| HSN: …`) | Read-only, and **inside the Pricing card gated on `cost_price.view`** (`:141-142`, `:603`) — **L4** |
| Product list | `src/app/api/products/route.ts:136` | Returned; the `/stock` table and cards do not render it |
| Product search / PO prepare | `src/app/api/products/search/route.ts:80`; `src/app/api/purchase-orders/prepare/route.ts:57, :82` | PO lines carry no GST since 15 Sep |
| Transfer detail | `src/app/api/transfer-orders/[id]/route.ts:68` selects `hsnCode`; `src/app/(dashboard)/transfers/[id]/page.tsx:61` types it | Not rendered. The e-way plan will need it |
| Price check | `src/app/api/stock/price-check/[productId]/route.ts:35-36` | Selected, unused |
| Deliveries, reports, dashboard | — | No reader (grep over `api/deliveries`, `api/reports`, `lib/export.ts`) |
| Transfer consignment value | `src/app/api/transfer-orders/[id]/dispatch/route.ts:150-159` | `costPrice × qty`; never reads the rate |

### 2.4 The Zoho side, as the code has it

- **The registry** (`src/lib/integrations/endpoints.ts`) lists item writes `items.create` (`:100-107`)
  and `items.update` (`:116-123`, purpose "Push a corrected price back to Zoho"), both Books, and the
  reads `items.get` (`:108-115`, "Category, HSN and tax for one item — absent from the list
  response") and `items.list.inventory` (`:210-218`). There is no tax-list endpoint.
- **`items.update` carries price only.** `BooksClient.updateItem` (`src/lib/integrations/books.ts:46-53`)
  takes any field map; its one caller sends `{ purchase_rate }` (`price-check/[productId]/route.ts:80`).
- **`BooksClient.createItem`** (`books.ts:13-28`) accepts `gstRate` but never sends it, and has **no
  caller**; **`createInvoice`** (`:159-177`) sends no tax and has **no caller** (grep for
  `createInvoice(` / `createItem(` — the only `createItem` callers are the two `InventoryClient` ones
  in `api/inbound/route.ts:348` and `api/second-hand/route.ts:124`). **L8.**
- **`createBill`** (`books.ts:179-201`, called from `src/lib/inbound/complete-shipment.ts:195-209`)
  sends each line's `tax_percentage` and `hsn_or_sac` from the **inbound line** (what the vendor
  bill said), not from the product master.
- **Bulk read.** `InventoryClient.listItems` (`src/lib/integrations/inventory.ts:174-185`,
  `per_page=200`, `Status.All`) and `listAllItems` (`:229-253`, three pages in flight at a time,
  "~5,700 items (~29 pages)", `:224-225`). The `ZohoItem` row type already declares
  `tax_percentage` and `hsn_or_sac` (`:44-45`). `api/categories/zoho-import/route.ts:1-5, :78` already
  pulls all ~29 pages inside one 60-second request — the precedent this plan's comparison reuses.
- **Rate limiting.** `apiCall` retries a 429 up to three times with back-off before throwing
  (`src/lib/integrations/base.ts:346-357`). It does not distinguish the per-minute limit from the
  per-day limit (**L10**).

### 2.5 What Zoho's API offers — from Zoho's documentation, 12 Oct 2026

| Point | Finding | Source |
|---|---|---|
| Update an item's HSN | `hsn_or_sac` on `PUT /items/{item_id}`, India only. | [Books items](https://www.zoho.com/books/api/v3/items/), [Inventory items](https://www.zoho.com/inventory/api/v1/items/) |
| Update an item's tax, India | **`item_tax_preferences`**: a list of `{ tax_id, tax_specification }` where `tax_specification` is `intra` or `inter` ("Set whether the tax type is intra/interstate"). The top-level `tax_id` is marked **not applicable for India**. Inventory's update example sends `[{ "tax_id": …, "tax_specification": "intra" }]`. | same two pages |
| 0 % / exempt | `is_taxable: false` plus `tax_exemption_id`, "Mandatory, if `is_taxable` is false". | Books items |
| Bulk update | **None.** Only bulk mark-active / mark-inactive exist. One `PUT` per item. | Books items |
| Bulk read with HSN | **Inventory** `GET /items` — the list example carries `hsn_or_sac`, `tax_id`, `tax_name`, `tax_percentage`; `per_page` default 200. **Books** `GET /items` example carries tax but **not** `hsn_or_sac`; Books `GET /itemdetails` (bulk by ids) carries no HSN either. Neither list shows `item_tax_preferences`, so the **inter-state** setting is visible only per item. | Books items, Inventory items |
| Tax codes | `GET /settings/taxes` lists taxes with `tax_id`, `tax_name`, `tax_percentage`, `tax_specific_type` (`igst`, `cgst`, `sgst`, `nil`, `cess`). Tax **groups** (how Zoho India models intra-state CGST + SGST) have create/get/update/delete endpoints under `/settings/taxgroups` but **no documented list** — whether `GET /settings/taxes` returns them is **not confirmed**; Phase 0 checks. | [Books taxes](https://www.zoho.com/books/api/v3/taxes/) |
| Limits | 100 requests a minute per organisation (429, code 44); daily by plan (code 45); 5 concurrent on Free, 10 on paid (code 1070). | [Books introduction](https://www.zoho.com/books/api/v3/introduction/) |

**Not confirmed by the documentation, so Phase 0 checks it:** that `tax_percentage` on the list row is
the **intra-state** preference; that a `PUT` carrying only `hsn_or_sac` and `item_tax_preferences`
leaves every other field of the item alone (the price-check's single-field `PUT` is the precedent,
`price-check/route.ts:80`, but nothing records it working live); and that Books and Inventory
answer for the same items, which D2 (one organisation) implies.

### 2.6 The tax law the audit checks against

- **The 12 % and 28 % slabs were abolished from 22 Sep 2025** (56th GST Council). The general slabs
  are now **5 %** and **18 %**, with a special **40 %** on luxury and sin goods
  ([taxguru overview](https://taxguru.in/goods-and-service-tax/56th-gst-council-meeting-overview.html)).
- **Bicycles (8712) and their parts (8714) moved from 12 % to 5 %** on that date
  ([News on Air, 18 Sep 2025](https://www.newsonair.gov.in/gst-reforms-bicycle-industry-gets-major-relief-with-tax-reduction)).
  Electric vehicles stayed at 5 %. Bicycle tyres are reported at 5 %, other new pneumatic tyres at 18 %.
  The search did **not** confirm the current rate for toys (9503, the RC cars) — the CA fills it in as a
  category expectation; the plan does not hard-code it.
- **Compensation cess** was withdrawn on that date for everything except tobacco
  ([India Briefing](https://www.india-briefing.com/news/gst-cess-removal-india-2025-business-benefits-39879.html/)).
  None of this catalogue carries cess; the audit ignores it (§5).
- **HSN length:** Notification 78/2020-Central Tax, from 1 Apr 2021 — 4 digits up to ₹5 crore
  turnover (B2B invoices), 6 digits above it (Q3).
- **Consequence for the board:** `docs/agents/gst-consultant.md:14, :23-26` and
  `docs/agents/accounting-consultant.md:10, :35-36` still give bicycles and parts as **12 %**. Those
  tables predate the reform and must not be coded from. This plan keeps the valid-slab list as a
  **setting** (A2), so the next rate change is an edit on a screen, not a deploy. **Flagged to the
  owner** (Board of agents, below) — this plan does not edit the agent docs.

The figures above come from news and practitioner summaries, not the CBIC notification text. The CA
confirms the slab list (Q4) before the audit's verdicts are acted on.

### 2.7 Scale

- **5,745 products, 32 categories, 115 brands** (measured 8 Sep 2026, `docs/agents/database-architect.md:10`).
- Zoho's catalogue: **~5,700 items, ~29 list pages** (`inventory.ts:224-225`); the original export had
  8,175 rows including inactive ones (`scripts/import-products.ts:63`).
- `zohoItemId` was stored on every product the catalog script imported (`scripts/import-products.ts:44-45`),
  so most products are linked; products auto-created by a bill import may not be (`approve/route.ts:402-405`
  drops a clashing id). The exact unlinked count is the first number the audit shows — no query was run.
- What that means for the build: the full comparison is ~29 Zoho reads; a full push of every product
  would be ~5,700 writes, **more than a Standard plan's whole day** (2,000). Bulk writes are therefore
  capped per day (C5), and the "use Zoho's value" direction costs no Zoho calls at all.

### 2.8 Live defects found while mapping

| # | Defect | Where | Effect |
|---|---|---|---|
| **L1** | `Number(x) \|\| 18` and `Number(item.tax_percentage \|\| 18)` turn a **0 %** rate into **18 %**, and a blank into 18 %. | `scripts/import-products.ts:240, :292`; `api/zoho/pull-review/approve/route.ts:339` | An exempt item arrives over-taxed; "never set" and "18 %" become the same value. |
| **L2** | `/stock` "Fetch from Zoho": the preview computes Zoho's `gstRate` and `hsnCode` (`zoho-preview/route.ts:169-170`), but the sheet's row type has no such fields (`stock/_components/zoho-stock-import-sheet.tsx:27-39`) and the import payload omits them (`:358-366`). | `zoho-import/route.ts:247-248` | **Every product created through this button gets 18 % and a blank HSN**, whatever Zoho says. (Zoho's `category_id` is dropped the same way.) |
| **L3** | `PUT /api/products/[id]` writes `gstRate` / `hsnCode` behind `stock.edit` alone, with no trail and no Zoho update. Its `GET` and `PUT` catches return without logging (`:53-60`, `:145-152`). | `api/products/[id]/route.ts:69-72, :138-142` | A side door around everything this plan builds. No screen uses it today. |
| **L4** | The product's HSN and rate are shown only inside the cost-price card. | `stock/[id]/page.tsx:141-142, :603-615` | A `stock.view` holder without `cost_price.view` cannot see a product's HSN at all, though HSN and rate are printed on every customer invoice. |
| **L5** | `try { requireFeature("zoho","fetch") } catch { requireFeature("stock","create") }` — a bare `catch` with no log. | `api/stock/zoho-import/route.ts:44-48` | CLAUDE.md: "A bare `catch {}` is a bug." |
| **L6** | The only `items.update` caller has no logger; a Zoho failure is returned in the body and never logged; the outer catch does not log. | `api/stock/price-check/[productId]/route.ts:73-87, :96-102` | A failed Zoho price push leaves no server trace. |
| **L7** | `POST /api/inbound` "pushes a draft bill" by creating a Zoho **item** named `Inbound: <brand> - <billNo>` with SKU = shipment number. | `api/inbound/route.ts:333-358` | Pollutes Zoho's item catalogue with non-products that carry no HSN or tax; they will appear in this plan's comparison as "Zoho items with no product". **Reported, not fixed here** (§5). |
| **L8** | `BooksClient.createItem` and `createInvoice` have no callers; `createItem` ignores its `gstRate` argument. | `books.ts:13-28, :159-177` | Dead code that looks like a working tax push. |
| **L9** | `gstRate` defaults to 18 and is never null. | `schema.prisma:582` | With L1 and L2, an unknown rate is indistinguishable from a real 18 % (Q9). |
| **L10** | `apiCall` retries every 429 three times with back-off (5 s, 10 s, 20 s) — including the **daily** limit, which will not clear for hours. | `integrations/base.ts:346-357` | A bulk run that exhausts the day waits ~35 s per call before failing. C5 stops a run at the first rate-limit error rather than changing shared code. |

---

## 3. Implementation plan

Four steps, each its own commit. **Phase 0 and Part A write nothing to Zoho.** Part A is useful on
its own under any answer to Q1.

| | What | Zoho calls |
|---|---|---|
| **Phase 0** | Read-only discovery against Zoho: confirm the five unconfirmed points in §2.5. No code merged. | 4 reads |
| **Part A** | Schema, settings, RBAC module, the audit list, the Zoho comparison, category expectations, the product page's Tax card (read). | ~29 reads per comparison |
| **Part B** | Local corrections with a from → to trail; "use Zoho's value"; the side doors closed; L1, L2, L3, L5 fixed. | none |
| **Part C** | Zoho write-through: tax-code mapping, preview → batched apply, the single-product edit with a live check, the daily cap. **Only if Q1 = (a)** (or (c), reshaped). | 1 read + 1 write per product |

### Phase 0 — confirm what the documentation does not

Run once, by the developer, against the Zoho organisation the owner names under Q2 (reads only, so
the test database's production credentials are acceptable here — but each call spends production's
daily budget; four calls is nothing). Record the answers in a §6 build record added to this plan at build time (the 0809 plan's shape).

1. `GET /items?page=1&per_page=200` on **Inventory** — do rows carry `hsn_or_sac` and `tax_percentage`;
   is `tax_percentage` the intra-state rate (compare one row against Zoho's item screen)?
2. `GET /settings/taxes` on **Books** — are intra-state tax **groups** (`GST5`, `GST18`) in the list, or
   only the individual CGST / SGST / IGST taxes?
3. `GET /items/{id}` on **Books** for one 5 % and one 18 % item — the shape of `item_tax_preferences`.
   If step 2 shows no groups, these two reads give the intra-state group ids instead.
4. Nothing else. The partial-`PUT` question is answered by §4's first write, not here.

If step 1 shows no HSN on the Inventory list, the comparison (A6) falls back to Books
`GET /itemmasters`, whose documented example does carry `hsn_or_sac` (Books items page) — one more
registry entry, same paging.

### Part A — the audit (read-only)

#### A1 — schema and migration

```prisma
model Category {
  …
  /// What every product in this category (and its sub-categories, unless they set their own) should
  /// carry. Null = no expectation, no check. Plan 1210-hsn-gst-catalogue-audit, Q7.
  expectedHsnPrefix String?                        // 2-8 digits, e.g. "8712"
  expectedGstRate   Decimal? @db.Decimal(5, 2)     // e.g. 5.00
  …
}

/// What Zoho said about one product's tax the last time anyone looked. A REFERENCE COPY, the
/// "preview" half of pull-preview-approve: nothing decides a sale or a stock move from it, and
/// it never overwrites Product.hsnCode / gstRate by itself.
model ProductZohoTax {
  productId          String   @id
  product            Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  zohoItemId         String
  zohoStatus         String?                     // "active" | "inactive"
  hsnOrSac           String?
  taxPercentage      Decimal? @db.Decimal(5, 2)  // intra-state, as the list returns it (Phase 0)
  taxId              String?
  taxName            String?
  // Only a per-item read or a push response carries the inter-state preference.
  interTaxId         String?
  interTaxName       String?
  interTaxPercentage Decimal? @db.Decimal(5, 2)
  source             String                      // "list" | "item" | "push"
  fetchedAt          DateTime
}
// Product gains the back-relation:  zohoTax ProductZohoTax?
```

`npx prisma migrate dev --name product_tax_audit` **on localhost only** (`.env` must point at
localhost — CLAUDE.md migration rule 2). Expected SQL, and nothing else:

```sql
ALTER TABLE "Category" ADD COLUMN "expectedHsnPrefix" TEXT,
                       ADD COLUMN "expectedGstRate" DECIMAL(5,2);
CREATE TABLE "ProductZohoTax" ( "productId" TEXT PRIMARY KEY, … , "fetchedAt" TIMESTAMP(3) NOT NULL );
ALTER TABLE "ProductZohoTax" ADD CONSTRAINT … FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
```

- **Populated tables:** `Category` (32 rows) gains two **nullable** columns — metadata-only, no
  rewrite, no backfill. `ProductZohoTax` is new and empty. Nothing is dropped, retyped or made
  `NOT NULL` (rule 3). The old code never names the new columns, so it survives the migration
  running minutes before it is replaced (rule 7).
- **Why `Decimal`** when `Product.gstRate` is a `Float`: `docs/schema-review.md:280-289` says rates
  should be `numeric`; new columns follow the target, and code compares with `Number(decimal)`.
- **Why a separate table** rather than three columns on `Product`: the comparison replaces the whole
  snapshot in one transaction, and `Product`'s many `include: true` readers stay unchanged.
- **No index** beyond the primary key: the audit reads the whole snapshot once per request (A4), and
  32 categories need none (`0809-brand-category…-plan.md` §2.5, same reasoning).
- **Who applies it:** by hand, `npx prisma migrate status` then `npx prisma migrate deploy` against the
  target **before** the code goes live (rule 4); `npm run db:snapshot` before the PR merges (rule 9).

#### A2 — the rules, as a setting (no migration)

`src/lib/product-tax/rules.ts`, a copy of the `AppSetting` pattern in
`src/lib/settings/approval-rules.ts:1-130` (zod-parsed JSON, 5-second cache, defaults per field,
every failure logged):

```ts
key "gst_catalogue_rules"
{ validRates: number[]       // default [0, 5, 18, 40]           (Q4)
  abolishedRates: number[]   // default [12, 28]                 (Q4)
  hsnMinDigits: 4 | 6 | 8    // default 6                        (Q3)
  zohoDailyWriteBudget: int  // default 500, 0 = writes off      (Q2, Part C)
}
```

#### A3 — RBAC (Q5)

`prisma/rbac-catalog.ts`, a new root module in the Accounts band, beside `cost_price` (`:528-535`):

```ts
{ key: "product_tax", label: "GST & HSN", icon: "Percent",
  description: "Audit and correct HSN codes and GST rates across the catalogue, in step with Zoho",
  route: "/stock/tax-audit", group: "Accounts", sortOrder: 360,
  actions: ["view", "edit", "fetch", "approve"] }
// ⚠ RUN npm run db:seed:rbac AFTER DEPLOY
```

| Action | Grants |
|---|---|
| `view` | the audit page, the category expectations, a product's tax history |
| `edit` | correcting products (and, under Q1 a, the Zoho write that goes with it); setting a category's expectation |
| `fetch` | "Compare with Zoho" (the ~29-page read) and a single product's live Zoho check |
| `approve` | the rules (A2) and the Zoho tax-code mapping (C2) |

Data, not a migration (CLAUDE.md rule 11). The seeder grants ADMIN everything; the owner grants the
accountant's role on `/team/permissions`. Nothing in `src/` names a role. `sortOrder: 360` sits in the
Accounts band (290-399), after `brand_ledger_gaps` (350). Reconciled by the coordinator, 12 Oct
2026: the sibling plans take 320 (`bank_recon`, plan D) and 335 (`eway_bills`, plan F), so this
module moved off 335 to avoid a tie.

#### A4 — the checks, as one pure function

`src/lib/product-tax/hsn.ts` — `normaliseHsn(raw)` (digits only: `"8712 00 10"` → `"87120010"`,
`""` → `null`) and `hsnShape(hsn, minDigits)` → `ok | blank | not_digits | bad_length | too_short |
service_code`.

`src/lib/product-tax/category-expect.ts` — effective expectation per category: its own value, else
the nearest ancestor's (`buildCategoryTree`, `src/lib/categories/tree.ts:90`). 32 rows, computed in
memory, and the response says which ancestor it came from.

`src/lib/product-tax/audit.ts` — `auditProduct(row, rules, expect, zoho, lastBillRate) → Issue[]`.
Pure, no database, unit-testable:

| Issue key | Fires when | Severity |
|---|---|---|
| `hsn_blank` | `hsnCode` null or empty | error |
| `hsn_format` | not digits, or length not 4 / 6 / 8, or shorter than `hsnMinDigits` | error |
| `hsn_service_code` | starts `99` (a SAC) on a product | warn |
| `rate_abolished` | rate in `abolishedRates` | error |
| `rate_invalid` | rate in neither list | error |
| `category_rate` | effective expected rate set and ≠ product rate | error |
| `category_hsn` | effective prefix set and the product's HSN does not start with it | error |
| `zoho_hsn` / `zoho_rate` | linked, snapshot present, normalised values differ | error |
| `zoho_missing` | linked, but the last comparison did not find the item | warn |
| `not_linked` | `zohoItemId` null | info |
| `bill_rate` | the latest `InboundLineItem` for the product has `gstPercent > 0` and ≠ product rate | warn |

`bill_rate` is the consultant's "GST rate on vendor bill different from product master rate"
(`gst-consultant.md:52`). It only fires on bills typed or read by AI, because Zoho-pulled bill lines
do not record a rate (`approve/route.ts:524-532`) — said on screen, and §5 names the follow-up.

**Why in memory and not SQL:** the route reads five columns for every product in scope (~5,745 rows,
one query) plus the snapshot (one query), runs `auditProduct`, then filters and pages. That gives
every tab's count from the same pass, and keeps one implementation of each rule. The store-scoped
`/stock` list already pages in code for the same reason (`api/products/route.ts:150-201`). Past ~50,000
products, move the checks into SQL — written here so nobody has to rediscover it.

#### A5 — API (Part A)

All under `src/app/api/product-tax/`, `export const dynamic = "force-dynamic"`, zod at the boundary,
`successResponse` / `errorResponse`, every catch logs.

| Method + path | Guard | Body / query (zod) | Does |
|---|---|---|---|
| `GET /api/product-tax/audit` | `product_tax.view` | `check` (one issue key or `all`), `categoryId?`, `status` `ACTIVE`\|`INACTIVE`\|`ALL` (default `ACTIVE`), `q?`, `page`, `limit ≤ 100` | `{ counts: Record<IssueKey, n>, rows: [{ id, sku, name, category, hsnCode, gstRate, linked, zoho, expected, issues }], snapshotAt, rules }` |
| `GET /api/product-tax/audit/export` | `product_tax.view` | same filter, no paging | the full filtered list for `ExportButtons` (`src/lib/export.ts`) — the CA's worksheet |
| `GET /api/product-tax/categories` | `product_tax.view` | — | every category with own and effective expectation and the count of products that break it |
| `PUT /api/product-tax/categories/[id]` | `product_tax.edit` | `{ expectedHsnPrefix: /^\d{2,8}$/ \| null, expectedGstRate: number \| null }`; the rate must be in `validRates` (checked in the handler, 400 with the list) | writes both columns and a `tax_rule_changed` `ActivityLog` row (from → to) in one transaction |
| `GET` / `PUT /api/product-tax/rules` | `view` / `approve` | the A2 schema | read / write the setting; `tax_settings_changed` activity row |
| `POST /api/product-tax/zoho-snapshot` | `product_tax.fetch` | — | A6. `maxDuration = 60` |
| `GET /api/products/[id]/tax` | `product_tax.view`; `?live=1` additionally `product_tax.fetch` | — | the product's tax, its issues, its snapshot, its last 20 `product_tax` activity rows; `live=1` re-reads the one item from Zoho (`items.get`) and refreshes its snapshot, inter-state preference included |

#### A6 — "Compare with Zoho" (the only Zoho traffic in Part A)

`POST /api/product-tax/zoho-snapshot`, `src/lib/product-tax/snapshot.ts`:

1. `getInventory()`; null → 503 "Zoho Inventory is not connected…" (the wording of
   `zoho-preview/route.ts:52-57`).
2. `listAllItems()` — ~29 pages, three in flight (§2.4). Well inside 100 a minute and the concurrency
   limit; ~29 of the daily budget.
3. Match by `zohoItemId` only (the dedup key — never by name or SKU).
4. One transaction: delete snapshot rows for products whose item was not returned; upsert the rest in
   chunks of 500 with one parameterised `INSERT … SELECT FROM unnest(…) ON CONFLICT ("productId") DO
   UPDATE` per chunk, setting only the list fields — so an inter-state value from a per-item read
   survives a list refresh.
5. Respond `{ items, matched, linkedNotFound, zohoItemsWithoutProduct, ms }` and write one
   `tax_zoho_compared` activity row with those counts. `zohoItemsWithoutProduct` will include the L7
   junk items; the response lists their SKUs so the owner can see them.

It writes **only** the snapshot table. It is a button, run when a person wants it — no timer, no
cron, no polling (CLAUDE.md "There are no scheduled jobs").

#### A7 — screens

**`/stock/tax-audit`** (`src/app/(dashboard)/stock/tax-audit/page.tsx` plus `_components/`). The
static segment wins over `/stock/[id]`, as `by-bin`, `by-store` and `condition` already do.

```
GST & HSN audit                         [Compare with Zoho]  last run 2 h ago · 5,702 matched
Tabs:  Products | Category rules | Rules & Zoho codes (approve only)

Products:  chips with counts —  All issues 1,240 · HSN blank 312 · HSN format 88 · Old slab 640
           · Not a slab 3 · ≠ category 205 · ≠ Zoho 97 · Zoho missing 14 · Not in Zoho 41 · Bill rate 9
           category filter · status filter · search · Export
PC (≥1024 px): table  — SKU · Product · Category · HSN · GST · Zoho HSN · Zoho GST · Expected · Issues
Phone:         three-line cards — name / HSN · GST → Zoho / issue badges — tap opens the product
Select mode → bottom bar: [Use Zoho's value] [Set HSN / GST…] [Apply category rule] [Push to Zoho]
```

- One row contract for table and card, the `/stock` list's shape
  (`2109-stock-list-table-and-compact-cards-plan.md`).
- Loading skeleton, an error line with Retry, and an empty state per chip ("No product is missing an
  HSN code"). Compare shows a spinner, is disabled while running, and states its result.
- The bulk bar's buttons arrive in Parts B and C; Part A ships the list, the chips, the export and the
  category rules.
- **Category rules tab:** the category tree with Expected HSN prefix and GST rate, own or
  "inherited from Cycles", the count that break it, and inline edit for `product_tax.edit`.
- **Rules & Zoho codes tab** (`product_tax.approve`): the A2 setting, and (Part C) the tax-code mapping.

**`/stock` toolbar** — one link in `relatedLinks` (`stock/page.tsx:510-527`) for `canView("product_tax")`.
Cosmetic; the page and every route re-check.

**Product page — a Tax card** (`src/app/(dashboard)/stock/[id]/_components/tax-card.tsx`), shown to
every `stock.view` holder, **outside** the cost-price card (fixes L4): HSN, rate, Zoho's values with
their age, issue badges, and — for `product_tax.view` — the history. The old line at `page.tsx:612-614`
is removed. Buttons: **Check in Zoho** (`fetch`) and, from Part B / C, **Edit HSN / GST** (`edit`).

`src/app/api/activity/route.ts:208-218` — add `product_tax: { category: "MASTER_DATA", label: "Tax" }`
so the new rows render in the activity feed.

### Part B — local corrections and the trail (no Zoho calls)

#### B1 — one writer for the two columns

`src/lib/product-tax/apply.ts`:

```ts
applyProductTaxLocal(tx, { productId, expected: {hsnCode, gstRate}, to: {hsnCode, gstRate},
                           source, user }) → "applied" | "already_set" | "stale"
  // to.hsnCode is normalised; to.gstRate must be in validRates (else throws a sentence)
  updateMany({ where: { id, hsnCode: expected.hsnCode, gstRate: expected.gstRate },
               data:  { hsnCode: to.hsnCode, gstRate: to.gstRate } })
  count 1 → logActivity(tx, { module: "product_tax", action: "tax_changed", entityType: "Product",
             entityId, entityRef: sku, fromValue: "HSN 87120010 · 12%", toValue: "HSN 87120010 · 5%",
             details: source })                // screen | bulk | category_rule | zoho_accept | zoho_import | bill_import
  count 0 → re-read: equal to `to` → "already_set"; otherwise → "stale"
```

The conditional `updateMany` is the concurrency guard: two people, or a person and an import, cannot
silently overwrite each other — the second gets "changed since you looked" and the row's new value.
Running a batch twice is a no-op ("already set"). `logActivity(tx, …)` makes the trail part of the
change (`src/lib/activity-log.ts:9-21`); `fromValue` / `toValue` already exist (`:48-50`).

#### B2 — preview and apply, local half

| Method + path | Guard | Body (zod) |
|---|---|---|
| `POST /api/product-tax/preview` | `product_tax.edit` | `{ mode: "set" \| "category" \| "zoho_accept" \| "zoho_push", productIds: string[] ≤ 500 } \| { mode, filter: { check, categoryId?, status } }`, plus `set: { hsnCode?, gstRate? }` (at least one) when `mode = "set"` |
| `POST /api/product-tax/apply` | `product_tax.edit` | `{ mode, rows: [{ productId, expected: {hsnCode, gstRate}, to: {hsnCode, gstRate} }] }`, **1-20 rows** |

**Preview writes nothing.** It returns every planned row — `from`, `to`, Zoho's current value and
its age, and the action: `local_only`, `zoho_then_local` (Part C), or `skip` with the reason ("no
change", "Zoho item missing", "0 % has no Zoho exemption mapped", "HSN shorter than 6 digits") —
plus a summary and, in Part C, the day's remaining Zoho budget. A `filter` is resolved server-side so
the browser never ships 5,000 ids; more than 6,000 matching rows is refused with a sentence.

**Apply** re-reads every row and calls `applyProductTaxLocal`. In Part B it only performs:

- `zoho_accept` — "use Zoho's value": `to` must equal the stored snapshot, or the row is refused. No
  Zoho call; this is the "approve" step of pull-preview-approve.
- any mode on a product with **no** `zohoItemId` — local only, and the result says "not in Zoho".
- Under **Q1 (b)**, the other modes on linked products are refused with "Correct this in Zoho, then
  Compare and use Zoho's value". Under (a), they wait for Part C.

The browser drives the batches: 20 rows per request, a progress bar, a Stop button, failures listed
row by row — the shape of `vendors/_components/zoho-vendor-sheet.tsx:100-125`. A person starts it and
watches it; it is not a background job.

**Screens.** The audit's bulk bar opens `bulk-tax-sheet.tsx`: choose the mode → **Preview** (the
table of from → to, the counts, the skips with reasons) → **Apply N changes** → progress → result.
The product page's **Edit HSN / GST** opens the same sheet with one row: an HSN input
(`inputMode="numeric"`), a rate `<select>` built from `validRates`, the preview line, Confirm.
Every button disabled while busy, 44 px targets, `apiFetch` / `apiTry` only.

#### B3 — close the side doors (Q8)

- **`PUT /api/products/[id]`** (`route.ts:64-153`): a body carrying `gstRate` or `hsnCode` is refused,
  400 *"GST and HSN are changed on the GST & HSN screen, which also keeps Zoho in step"*, and logged
  at `warn`. Add `log.error` to the GET and PUT catches (L3).
- **`POST /api/products`** (`route.ts:247-291`): the fields are accepted only when the caller holds
  `product_tax.edit` (the present-field rule this file already uses for `reorderVendorId`); the
  product is created, then one `tax_changed` row records the starting value.
- **`/stock` Fetch from Zoho** (L2): `ZohoProductItem` and the payload (`zoho-stock-import-sheet.tsx:27-39,
  :358-366`) carry `gstRate`, `hsnCode` and `categoryId`; `zoho-import/route.ts` writes an existing
  product's tax through `applyProductTaxLocal(…, source: "zoho_import")` so the change is logged
  from → to, and replaces the bare `catch` on the guard with two `userCan` checks and a log line (L5).
  Zoho wins here — it is the filing system.

#### B4 — the 0 → 18 defect (L1)

`api/zoho/pull-review/approve/route.ts:339` and `scripts/import-products.ts:240, :292`: take the
number when it is a finite number (0 included), fall back to 18 only when Zoho sent nothing, and in
the approve route push a notice *"<item>: Zoho gave no GST rate — filed at 18 %, check it on GST &
HSN"*. A one-line overlap with `1210-zoho-credit-notes-and-payables-plan.md`, which edits the same
file for `VendorBill.zohoBillId` — whichever lands second rebases.

### Part C — the Zoho write-through (Q1 = a)

#### C1 — client and registry

`src/lib/integrations/books.ts`:

```ts
/** India: HSN plus the two tax preferences. Partial — only what changed is sent. */
async updateItemTax(itemId: string, p: { hsnOrSac?: string;
                                         taxes?: { intraTaxId: string; interTaxId: string } }) {
  return this.apiCall<{ item?: Record<string, unknown> }>("PUT", `/items/${itemId}`, {
    JSONString: JSON.stringify({
      ...(p.hsnOrSac ? { hsn_or_sac: p.hsnOrSac } : {}),
      ...(p.taxes ? { item_tax_preferences: [
            { tax_id: p.taxes.intraTaxId, tax_specification: "intra" },
            { tax_id: p.taxes.interTaxId, tax_specification: "inter" } ] } : {}),
    }) }, "items.update");
}
async listTaxes() { return this.apiCall<{ taxes: ZohoTax[] }>("GET", "/settings/taxes", undefined, "taxes.list"); }
```

`src/lib/integrations/endpoints.ts`: `items.update` — owner becomes `BooksClient.updateItem /
updateItemTax`, purpose *"Push a corrected price (price-check) or HSN and tax (GST & HSN) back to
Zoho"*; new `taxes.list` — `GET /settings/taxes`, Books only, *"The organisation's tax codes, to map a
GST rate to its intra- and inter-state tax ids"*. If Phase 0 needs it, `itemmasters.list` the same way.
`apiCall` stays `protected`; no Zoho call is made outside `src/lib/integrations/`.

Payload shape is from Zoho's documentation (§2.5); the field names are confirmed, the behaviour of a
partial `PUT` is confirmed by §4's first write.

#### C2 — the tax-code mapping (`product_tax.approve`)

`src/lib/product-tax/zoho-map.ts`, `AppSetting` key `zoho_gst_tax_map`, the A2 pattern:

```ts
{ rates: [{ rate: 5,  intraTaxId: "…", intraTaxName: "GST5",  interTaxId: "…", interTaxName: "IGST5"  },
          { rate: 18, intraTaxId: "…", intraTaxName: "GST18", interTaxId: "…", interTaxName: "IGST18" }],
  zeroRated?: { exemptionId: "…", label: "…" } }       // Q4 — absent = 0 % pushes refused
```

`GET /api/product-tax/zoho-taxes` (`approve`) calls `listTaxes()` once and returns the codes; the
**Rules & Zoho codes** tab shows one row per valid rate with two `<select>`s filled from Zoho's own
list — nobody types an id. If Phase 0 found no groups in that list, the tab instead offers "take the
codes from a product that is already correct in Zoho" (one `items.get`). Saved by
`PUT /api/product-tax/zoho-tax-map` (`approve`), validated against the codes Zoho just returned, and
logged as `tax_settings_changed`. A valid rate with no mapping cannot be pushed; the preview says so.

#### C3 — apply, Zoho half

For `set`, `category` and `zoho_push` rows on a **linked** product, `POST /api/product-tax/apply`
(`maxDuration = 60`) does, row by row, **in order**:

1. **Budget.** Count today's (IST) `tax_zoho_updated` activity rows — `ActivityLog` is indexed on
   `(module, createdAt)` (`schema.prisma:2699`). At `zohoDailyWriteBudget` → stop the batch,
   `stoppedEarly: "budget"`.
2. **Re-read** the product; local ≠ `expected` → "stale", no Zoho call. Local already equals `to` →
   "already set", no Zoho call.
3. **Snapshot age.** Bulk rows need a comparison younger than 24 hours, so a change the CA made in Zoho
   since is not overwritten blind; older → "Run Compare with Zoho first" for the whole batch. The
   single-product path reads Zoho live instead (C4).
4. **Zoho `PUT`** via `updateItemTax`, sending only what changed. Rows are sent one at a time with at
   least 1 s between them — at most 60 a minute, leaving headroom under 100 for the rest of the app.
   20 rows ≈ 25 s, inside 60 s.
5. **On Zoho success:** one transaction — `applyProductTaxLocal`, the snapshot row rewritten from
   Zoho's response (`source: "push"`), and a `tax_zoho_updated` activity row (from = Zoho before, to =
   Zoho after). If the local write then comes back "stale" (someone changed it during the call), log
   `warn`, record it, and tell the person: *"Zoho now holds X; this product changed here meanwhile —
   Compare and review it."* The race is narrow, visible and recoverable; it is never silent.
6. **On Zoho failure:** nothing local changes. The row carries Zoho's own sentence. A rate-limit error
   (L10) stops the batch — `stoppedEarly: "rate_limit"` — because the next call would wait too.

The result per row is one of `zoho_and_local`, `local_only`, `already_set`, `stale`, `zoho_failed`,
`skipped`. **What if it runs twice?** Every row already applied answers "already set" without calling
Zoho. **What if two people run it at once?** The conditional write in B1 lets one win per row; the
other sees "stale".

#### C4 — the single product, live

**Edit HSN / GST** on the product page, for a linked product: the preview calls
`GET /api/products/[id]/tax?live=1` first (one `items.get`), so the confirm line shows Zoho's value
**now**, both preferences included:

```
Zoho now:      HSN 87120010 · intra GST12 · inter IGST12      (read 3 s ago)
Will become:   HSN 87120010 · intra GST5  · inter IGST5
This changes the item in Zoho Books and here, together.        [Cancel]  [Change in both]
```

Then `apply` with one row. A product with no Zoho item says *"Not in Zoho — this changes the app
only"* on the same line.

#### C5 — the budget, in numbers

Two Zoho calls per single edit (one read, one write); one write per bulk row plus ~29 reads per
comparison. On a Standard plan (2,000 a day, shared with the bill pull, deliveries and the test
database), the default cap of 500 writes leaves three quarters of the day for everything else. The
preview always shows *"412 Zoho changes · 500 left today"*, and refuses a batch it knows will cross
the cap rather than starting it.

### Dependencies on sibling plans

| Plan | Relationship |
|---|---|
| `1210-zoho-credit-notes-and-payables-plan.md` (B) | Both edit `api/zoho/pull-review/approve/route.ts` — this plan one line (B4). Land either order; the second rebases. |
| `1210-eway-bills-through-zoho-plan.md` (F) | Zoho builds e-way bills from the Zoho item's HSN (D21). Clean item HSN helps F; neither blocks the other. |
| `1210-bank-accounts-and-suspense-plan.md` (D) | Both add a module to the Accounts sort band; pick distinct `sortOrder`s. |
| All others | None. |

### Phases

| Phase | Work | Depends on | Commit |
|---|---|---|---|
| 0 | Four Zoho reads; record the answers in a §6 build record | Q2 (which org) | none |
| A | A1 migration, A2 rules, A3 catalog, A4 checks, A5 API, A6 comparison, A7 screens | Phase 0 | 1 |
| B | B1 writer, B2 preview/apply (local), B3 side doors, B4 defect | A, Q1 | 1 |
| C | C1 client, C2 mapping, C3 Zoho apply, C4 live edit, C5 budget | B, **Q1 = a**, **Q2** | 1 |

**One migration** (A1). **One catalog change** (A3) — `npm run db:seed:rbac` after deploy. **Two
`AppSetting` keys**, no migration. **No cron, no `setInterval`, no polling, no JWT change, no public
route touched.**

### Logging

Every module scoped with `createLogger`; ids and counts only, never a payload or a token.

| Scope | `debug` | `info` | `warn` | `error` |
|---|---|---|---|---|
| `product-tax:audit` | rows read, rows matched, ms | — | unknown `check` value | audit query failed |
| `product-tax:snapshot` | each page via the client's own debug | `zoho compared { matched, linkedNotFound, zohoItemsWithoutProduct, ms }` | Zoho Inventory not connected | comparison failed `{ step }` |
| `product-tax:category` | — | `category expectation set { categoryId, rate, prefix }` | rate not in the valid list | write failed |
| `product-tax:rules` | — | `rules updated` / `zoho tax map updated` | validation refused | write failed |
| `product-tax:preview` | planned rows by action | — | filter over 6,000 refused | preview failed |
| `product-tax:apply` | `-> zoho PUT { productId, zohoItemId }` and the response time | `batch done { applied, zohoWrites, skipped, stale, failed }` | row stale; batch stopped (`budget` / `rate_limit`); local stale after a Zoho success | Zoho refused `{ productId, zohoItemId, message }`; batch crashed |
| `api:products:id` (existing) | — | — | tax fields refused on PUT | GET / PUT failed (L3) |
| `stock:zoho-import` (existing) | — | `tax changed from zoho { count }` | — | (exists) |
| `stock:product-tax-sheet`, `product-tax:screen` (browser) | `-> POST apply { from, size }` | run finished | Zoho row failures shown | apply / compare failed with the API's sentence |

Every `catch` logs before it returns or rethrows. The `items.update` traffic is also logged by
`apiCall`'s existing `-> ZOHO_BOOKS PUT items.update { endpoint, bytes }` line (`base.ts:316-323`).

### Board of agents — checked

- **gst-consultant.md** — *"Every product must have the correct HSN code"*, *"Rate correctness"*, red
  flags *"HSN code blank or mismatched to its category"* and *"GST rate on vendor bill different from
  product master rate"* → checks `hsn_*`, `category_*`, `bill_rate` ✓. *"Any GST rate change must be
  updated in BOTH systems simultaneously"* and *"the app must not contradict Zoho's tax data"* → Q1 (a),
  Zoho first ✓. *"When unsure about a rate classification, recommend getting a formal ruling rather
  than guessing"* → the plan hard-codes no HSN-to-rate table; the CA fills category expectations ✓.
  **⚠ FLAGGED — the doc itself is out of date:** `:14, :23-26` give bicycles and parts 12 %, abolished
  22 Sep 2025 (§2.6), and `:23` files motor-assist cycles under 8712, where tariff heading 8711 60
  ("with electric motor for propulsion") may apply — same 5 % either way; the CA should confirm the
  code for e-cycles and EV scooters. Owner to decide whether to correct the doc; this plan does not
  edit it.
- **accounting-consultant.md** — red flag *"GST rate mismatch between Zoho Books and actual product
  category"* is exactly `zoho_rate` + `category_rate` ✓. Same stale 12 % table (`:10, :35-36`) —
  **flagged** with the above.
- **integration-architect.md** — *Pull → preview → approve*: the snapshot table is the preview and
  "use Zoho's value" the approve; the comparison writes no operational column ✓. *Idempotent sync /
  Zoho ids as dedup keys*: matched by `zohoItemId` only; re-running apply is "already set" ✓.
  *Timestamp everything*: `fetchedAt` per row, run time on screen ✓. *Rate-limit awareness*: pacing,
  daily cap, stop on 429 ✓. **Tension, stated:** principle 1 says *"Never override Zoho financial data
  locally"* and this plan **writes** Zoho's item master. It is the owner's ask (map §3.9) and the GST
  consultant's rule; it is done Zoho-first so the app never holds a value Zoho refused, and every write
  is previewed, capped and logged.
- **database-architect.md** — nullable only where "no expectation" is a real state ✓; new rate columns
  `Decimal`, not `Float` ✓; multi-row writes in `$transaction` with a conditional re-check ✓; no JSON
  queried — the two settings are read whole ✓; migration additive and read before commit ✓; who
  applies it and when — stated in A1 ✓. Index: none added, reasoning given ✓.
- **backend-engineer.md** — zod on every body ✓; `requireFeature` on every route ✓; *"What if this
  runs twice / two users at once"* answered in B1 and C3 ✓; `updateMany` result checked, never assumed
  ✓; sentences a phone can show ✓; status codes per the doc ✓. The doc's sample `requireAuth(["ADMIN",
  "SUPERVISOR"])` contradicts CLAUDE.md rule 1 and is not followed — `requireFeature(module, action)` only.
- **frontend-engineer.md** — 375 px first: cards on phone, table from 1024 px ✓; loading, error, empty
  and success states on every fetch ✓; disabled while busy, 44 px ✓; `usePermissions`, no role names ✓;
  the page is split into `_components/` (table, card, chips, category rules, codes, bulk sheet, tax card)
  so no file passes 300 lines ✓. The doc's sample `fetch().then(r => r.json())` is superseded by
  CLAUDE.md — `apiFetch` / `apiTry` only.
- **inventory-consultant.md** — *"One SKU = one product variant"*: HSN and rate live on the SKU, not
  on the brand ✓. Nothing here touches stock quantities, bins or reorder levels ✓.

No violation found that is not flagged above.

---

## 4. Verification

**Before anything is clicked:** `npx tsc --noEmit`, `npx eslint` on changed files, and
**`npm run build`** — it must pass (it needs a reachable database; CLAUDE.md "Environment gotchas").
`npx prisma migrate status` clean on local; the A1 SQL read and matching §3 exactly.

### ⚠ Zoho writes and the test database

**Since 12 Oct 2026 the test database holds production's live Zoho credentials.** Any Zoho write
made from test lands in the real Bharath Cycle Hub books, and **Settings › Integrations › Disconnect
on test revokes production's token** — do not press it. Zoho also counts API calls per
organisation, so test and production spend **one** daily budget.

- **Phases 0, A and B make no Zoho writes** and may be exercised on test (A6 spends ~29 reads).
- **Part C's writes**, in order of preference:
  1. **A Zoho Books trial organisation** (India), connected to a **local** database restored from a
     production snapshot (`npm run db:restore:local`, which nulls the stored Zoho credentials — so it
     cannot reach production by accident). Create three items there with known HSN and tax, link three
     local products to them by `zohoItemId`, and run every C step against those.
  2. If no trial organisation is possible (Q2): **one no-op write** on production, with the owner's
     sign-off — pick a product whose HSN and tax are already right in Zoho and push the **same** values.
     Nothing changes in the books; it proves the payload shape and the partial-`PUT` behaviour. Then
     **one** real correction the CA has confirmed, and read it back in Zoho's item screen.
  3. **Never** a bulk push from test. Set `zohoDailyWriteBudget` to 0 on test (Rules tab) so the
     server refuses one even if someone tries.

### Walk

**Part A**
1. `/team/permissions` after `npm run db:seed:rbac`: a "GST & HSN" row with View / Edit / Fetch / Approve.
   A role with none of them: no sidebar entry, `/stock/tax-audit` and `GET /api/product-tax/audit` → 403.
2. `/stock/tax-audit` before any comparison: chips count; "≠ Zoho" says "Run Compare with Zoho".
   Check three products by hand against `/stock/[id]` and Zoho's item screen.
3. **Compare with Zoho**: returns inside 60 s; `matched` + `linkedNotFound` equals the linked count;
   `zohoItemsWithoutProduct` lists the `Inbound: …` items (L7). Server log shows one
   `zoho compared` line.
4. Category rules: set "Bicycles" to `8712` / 5 %; its sub-categories show "inherited"; the "≠ category"
   chip moves; one `tax_rule_changed` row in `/activity`. Setting 12 % is refused with the valid list.
5. A product page as a `stock.view` user **without** `cost_price.view`: the Tax card shows HSN and rate (L4).
6. Export from the audit opens in Excel with the filtered rows.

**Part B**
7. "Use Zoho's value" on five `≠ Zoho` rows: preview shows from → to and makes no Zoho call (server
   log); apply; chips update; five `tax_changed` rows with `details: zoho_accept`.
8. Apply the same five again → "already set" ×5.
9. Two tabs: preview the same product in both, apply in the first, then the second → "stale" with the
   new value.
10. A product with no `zohoItemId`: "Set HSN / GST" → "not in Zoho — app only".
11. `curl -X PUT /api/products/<id>` with `{"gstRate":5}` → 400 with the sentence; the same body via
    `/api/product-tax/apply` works.
12. `/stock` Fetch from Zoho on a window containing a new item: the created product has Zoho's HSN and
    rate, not 18 % / blank (L2).

**Part C** (on the trial organisation, per the warning above)
13. Rules & Zoho codes: Load from Zoho lists the org's taxes; map 5 % and 18 %; save.
14. Product page → Edit → the confirm line shows Zoho's live intra and inter values; Change in both →
    Zoho's item screen shows the new HSN and both tax preferences, **and nothing else on the item
    changed** (price, name, account); the snapshot row is `source: push`; two activity rows.
15. Bulk: 30 rows → batches of 20 + 10; progress; ≥ 1 s between `PUT`s in the debug log.
16. Set the budget to 5 → the preview refuses a 30-row batch; a 5-row batch runs; the sixth row
    reports `budget`.
17. Edit an item's HSN directly in Zoho, then bulk-push it without comparing for 24 h (or set the
    snapshot older by hand on local) → "Run Compare with Zoho first".
18. A 0 % row with no exemption mapped → skipped with the sentence.

## 5. Out of scope, deliberately

- **GST returns, GST summary, ITC, TDS** — D22. Nothing here reads or writes a return.
- **Creating Zoho items** for products with none (Q10), and **`BooksClient.createItem` / `createInvoice`**
  (L8) — dead code, left for a cleanup that decides whether to delete them.
- **The `Inbound: <brand> - <billNo>` items** that `POST /api/inbound` creates in Zoho (L7) — reported
  here, counted by the comparison, fixed separately once the owner decides what that push should be.
- **Second-hand cycles' Zoho items** (`api/second-hand/route.ts:118-145`) — `SecondHandCycle`, not
  `Product`, and used goods may fall under the GST margin scheme; a CA question of its own.
- **Recording a rate on Zoho-pulled bill lines**, so `bill_rate` covers every bill — the line import
  belongs to the bill-import code `1210-zoho-credit-notes-and-payables-plan.md` owns.
- **`createBill`'s India payload** (`books.ts:192-198` sends `tax_percentage`, where Zoho India
  expects tax ids) — the bill push, not the item master.
- **`Product.gstRate` `Float` → `Decimal` and nullable** (Q9) — `docs/schema-review.md` §4.5's work list.
- **An HSN → rate tariff table** that would derive a rate from a code. The CA's category expectations
  stand in for it; a tariff is legal data this app should not maintain.
- **Per-product exceptions** to a category rule ("this one helmet is 18 % on purpose"). Set the rule on
  a sub-category instead; revisit if the exceptions list grows.
- **Cess.** Withdrawn on 22 Sep 2025 for everything this shop sells (§2.6).
- **Re-running the audit on a schedule.** There are no scheduled jobs; the comparison is a button.
- **AI suggestion of HSN codes** (`docs/ai-usage-audit.md:451`). Not asked for; a wrong code suggested
  confidently is worse than a blank the audit lists.
- **Correcting the two agent docs' 12 % tables** — flagged to the owner, not edited by this plan.
