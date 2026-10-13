# E-way bills for customer dispatches, branch transfers and supplier returns — recorded on every movement, generated through Zoho

Status: pending — written 12 Oct 2026; Phase 1 (record + warnings, no Zoho) builds once Q4 and Q6 are answered; generation (Phases 2–4) is blocked on Q1, Q2, Q3, Q5 and the Phase 0 checks.
Branch: **`feat/1210-eway-bills`** — create it with exactly this name, off `main`.

Every `file:line` below was read from disk on 12 Oct 2026 (working tree on
`fix/1210-push-integrations-same-db-check`). Every claim about Zoho's API cites the Zoho page it
came from; nothing was called against Zoho.

**The headline finding, before anything else.** Zoho **Books'** published API has **no e-way bill
endpoint and no e-way bill OAuth scope**. Zoho **Inventory's** published API has a complete one
(generate, cancel, change vehicle, refresh from the portal), and Zoho Inventory works on the **same
organisation** as Zoho Books — so a bill generated that way is the same bill Zoho Books lists under
*Sales › e-Way Bills*. That is the path this plan recommends for D21, and it is Q1. §2.6 has the
sources. Phase 1 needs no Zoho at all and ships first either way.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (8 Oct 2026)

> 14. Generating E-Way bills for customer dispatches, inter-branch transfers (Warehouse to Hub/Centre), and supplier return pickups.

Sharpened by the answer given in session on 12 Oct 2026 (D21, §1.1): *"E-way bills generated through
Zoho Books (the existing Zoho connection)."*

### 0.2 Restated as requirements

| # | Requirement | Map | Source |
|---|---|---|---|
| **R1** | **Customer dispatches** — a delivery whose goods need an e-way bill gets one, and its number is kept on the delivery. | map R14 | owner |
| **R2** | **Inter-branch transfers** — a transfer from a warehouse (godown) to the Hub store (Bharath Cycle Hub) or the Centre store (Bharath Cycle Centre) gets one, kept on the transfer. | map R14 | owner |
| **R3** | **Supplier return pickups** — goods collected to go back to a supplier get one, kept with the return. | map R14 | owner |
| **R4** | Generation goes **through Zoho Books over the app's existing Zoho connection** — no new provider. | map R14 | D21 |
| R5 | Before the goods leave, the app says whether this movement needs an e-way bill (consignment value over ₹50,000), so nobody has to work it out. | map R14 | derived — transfers already do this (map §3.7); the owner's "generating … for" needs to know *which* |
| R6 | A number generated outside the app (on the government portal, or in Zoho's own screen) can be typed in and is kept exactly like a generated one, so the record is complete whenever generation is not possible. | map R14 | derived — the brief's "deliveries first, works even if the API path fails" |
| R7 | A bill generated from the app can be cancelled from the app (inside the 24-hour legal window) and its vehicle changed in transit. | map R14 | derived — a filing that cannot be corrected where it was made sends people back to the portal |

R1–R4 are the owner's. R5–R7 are what R1–R4 cannot work without; strike any of them and the
matching phase goes.

### 0.3 Words used in this plan

- **E-way bill (EWB)** — a 12-digit number issued by the government's e-way bill system
  (run by NIC, the National Informatics Centre, at ewaybillgst.gov.in) **before** goods worth more
  than ₹50,000 are moved. The driver carries it. **Part A** says *what* moves (from, to, document
  number, items, HSN, value); **Part B** says *how* (vehicle number, or the transporter's document
  number). A bill with only Part A is not valid for movement.
- **Consignment value** — the value of the goods on the document **plus the GST charged on it**
  (CGST Rules, Rule 138, Explanation 2). Not the cost price alone.
- **Tax invoice / delivery challan** — a tax invoice is the GST document for a sale (a "supply"). A
  delivery challan is the document for moving goods when no sale happens (Rule 55) — e.g. stock moved
  between two places under the same GST registration.
- **GSTIN** — the 15-character GST registration number. Each GSTIN is a separate "distinct person"
  (CGST Act, Section 25(4)); goods moved between two GSTINs — even with one owner — are a supply and
  need a tax invoice (Schedule I, para 2).
- **GSP (GST Suvidha Provider)** — a company licensed to file on the government systems for a
  taxpayer. Zoho is one. The taxpayer registers "Zoho Corporation" as GSP on the e-way bill portal,
  once per GSTIN, and Zoho can then file for them.
- **Transporter ID** — the GSTIN, or the 15-character TRANSIN, of a transport or courier company.
- **Hub / Centre** — in this plan, always the stores **Bharath Cycle Hub** (`BCH_STORE`) and
  **Bharath Cycle Centre** (`BCC_STORE`). Not the transfer screens' "Hub", which is their word for a
  FLOOR warehouse (`src/lib/transfers/mode.ts:38-47`).

---

## 1. Questions and clarifications — answer before build

### 1.1 Decisions on record

Answered in session, 12 Oct 2026. These are the coordinator's record of the owner's answers to the
map's §4 questions; only the ones that touch this plan are repeated.

| # | Decision | Effect here | Date |
|---|---|---|---|
| D21 | *"E-way bills generated through Zoho Books (the existing Zoho connection)."* | R4. Q1 asks the owner to accept the documented route to it (§2.6). | 12 Oct 2026 |
| D2 | ONE Zoho Books organisation for both stores (today's single `IntegrationConfig` row per provider is correct). | One Zoho client serves both stores — but both GSTINs must be set up for e-way bills inside that one organisation (Q2). | 12 Oct 2026 |
| D1 | Link records to the existing `Store` table (rows `BCH_STORE` / `BCC_STORE`, each with its GSTIN) — no new "HUB"/"CENTRE" strings. | This plan adds no store strings; a transfer already names its stores and warehouses. | 12 Oct 2026 |
| D3 | Credit notes are typed in Zoho first and pulled here; the app does not create them. | A supplier return ends in the brand's credit note in Zoho, pulled by sibling plan B — this plan does not create one. | 12 Oct 2026 |

**None of the open questions below has been answered yet.**

### 1.2 Open questions

| # | Question | Why it changes the build | Options | Recommended default | Blocks | **Answer** |
|---|---|---|---|---|---|---|
| **Q1** | **Which Zoho API generates the bill?** | Zoho Books' published API has no e-way bill endpoint and no e-way bill scope; Zoho Inventory's published API has the whole set, on the same organisation as Books (§2.6). The registry entries, the client class and the token that must carry the scope all follow from this. | (a) Zoho **Inventory's** documented `/ewaybills` on the shared organisation, through the app's existing `ZOHO_INVENTORY` connection; (b) the **undocumented** `/books/v3/ewaybills` a Zoho community thread mentions; (c) **no generation** — typed numbers only (Phase 1) everywhere, for good; (d) a separate GSP provider (new contract, credentials, a fee per bill) | **(a)**, if Phase 0 passes. If Phase 0 fails, (c) until it is fixed. **Never (b)** for a legal filing: Zoho can change an undocumented path without notice and there is no documented cancel. | P2–P4 | |
| **Q2** | Is e-way bill generation **switched on in Zoho Books**, and has "Zoho Corporation" been registered as GSP on the e-way bill portal for **both** GSTINs (Hub and Centre)? Who holds the two portal logins? | Without it every generation call fails inside Zoho. It is setup the owner or accountant does, not code — Zoho's steps: [Add Zoho Books as GSP](https://www.zoho.com/in/books/kb/e-way-bills/add-zoho-books-as-your-gsp.html). | done / to do | Owner confirms in Zoho Books › Settings › e-Way Bills before P2 starts. | P2 | |
| **Q3** | **Transfers:** is the tax invoice (Hub ↔ Centre) raised in Zoho Books today, and will the **delivery challan** (godown ↔ floor of one store) also be raised in Zoho (*Sales › Delivery Challans*) and its number typed on the transfer? | Zoho can only file against a Zoho document. Today a transfer's document is an uploaded file whose number is optional (`document/route.ts:17-18`), and a challan may be paper. | (a) staff raise the document in Zoho and type its number on the transfer; the app finds it in Zoho by number and generates; (b) the app **creates** the delivery challan in Zoho from the transfer lines (a new Zoho write that issues a GST document — own-branch contact, Zoho item ids); (c) transfers keep typed numbers only | **(a)**. (b) is the "later, safer step" the transfer document route itself defers (`document/route.ts:27-33`). | P3 | |
| **Q4** | **Supplier return pickups:** nothing in the app records goods going back to a supplier (§2.4). What should this plan build? Also: how many return pickups a month, and who raises the e-way bill today — us, or the brand's transporter? | (b) is a new stock-moving document with rules of its own (which warehouse, which units, how the brand's credit note later matches it) — larger than everything else here, and the inventory consultant's territory. | (a) record the e-way bill number **typed by hand** against the **vendor issue** the return settles — no stock movement, no generation; a real return document gets its own requirements doc; (b) build a minimal **Return to supplier** outward document now (vendor, lines, source warehouse, stock leaves, Zoho delivery challan number, e-way bill); (c) leave supplier returns out entirely | **(a)** | supplier-return part of P1 | |
| **Q5** | **Who may generate, cancel and change the vehicle?** | A filing under the business's GSTIN is a different act from approving a dispatch. The accountant who files may not be the dispatch approver, and a dispatch approver should not be able to cancel filings. | (a) a new permission-only module **`eway_bills`**: `create` = generate, `edit` = change vehicle, `delete` = cancel, `view` = see Zoho status and press *Check Zoho*; (b) reuse `deliveries.approve` and `transfers.approve` | **(a)**. **Typing a number by hand stays on the document's own `edit` grant** (`deliveries.edit`, `transfers.edit`, `vendor_issues.edit`) — where the transfer number lives today (`dispatch/route.ts:51`). | P2 | |
| **Q6** | **Storage:** one `EwayBill` table referenced by a delivery, a transfer or a vendor issue — or number/date/validity/vehicle/status/Zoho-id columns added to each of the three? | It is the schema. Hard to undo once filings are recorded in it. | (a) one table; (b) columns on each document | **(a)** — reasons in §3, Phase 1a | P1 | |
| Q7 | Which **deliveries** does the warning apply to? | Decides when the badge and the dispatch warning appear. | every delivery over ₹50,000 / outstation only / a list | Every delivery **except walk-outs and service invoices** whose invoice total is over ₹50,000 — Bangalore and outstation alike (the gst-consultant doc gives Karnataka's intra-state limit as ₹50,000). The CA confirms walk-outs (§1.3, C2). | runs on default | |
| Q8 | **Warn or block** a dispatch over the threshold with no number? | A block stops the van over a record-keeping gap. | warn / block / block only once generation works | **Warn**, as transfers do today (`policy.ts:25-27`). | runs on default | |
| Q9 | Does a transfer's value for the warning **include GST**? | Today it is cost only (`dispatch/route.ts:159-160`), so a bicycle transfer of ₹46,000 at cost — ₹51,520 with 12% GST — is reported as not needing a bill. | include GST / cost only | **Include GST**, for both documents. The figure only drives a warning; when Zoho generates, Zoho files its own document's value. | runs on default | |
| Q10 | **When** is a bill generated? | Decides whether Part B is filled at generation or later. | (a) at dispatch, with the vehicle, in one call; (b) Part A when approved, vehicle added at dispatch (needs P4) | **(a)** | runs on default | |
| Q11 | A **switch that keeps filing off everywhere except production**? | Since 12 Oct the test database holds production's **live** Zoho credentials, and the database is copied production → test, so a setting stored in the database would be copied too. Only an environment variable differs between deployments. | yes / no | **Yes** — `EWAY_FILING_ENABLED=true` on the production deployment only; without it every route that would call Zoho's e-way endpoints refuses with a sentence. | runs on default | |
| Q12 | Does the Zoho subscription include a **sandbox organisation**? | It is the only way to rehearse a real generation without filing. | yes / no | Assume **no**; §4 tests without one. | runs on default | |

### 1.3 For the CA — compliance checks that do not change the build

The gst-consultant's points (`docs/agents/gst-consultant.md`). None changes the code; each changes
what the staff do, so the owner should put them to the CA before P2 goes live.

| # | Check |
|---|---|
| C1 | Karnataka's intra-state threshold is ₹50,000 (the consultant doc says so) and there is no intra-city exemption the shop relies on. |
| C2 | **Walk-outs:** the customer collects at the counter and carries the goods away. Does the shop generate a bill? The app will not warn on walk-outs (Q7 default). |
| C3 | **Each godown is registered on its own store's GSTIN** as an additional place of business. The app decides the transfer document by which store a warehouse belongs to (`mode.ts:59-61`) and never reads a GSTIN (owner, 9 Sep 2026). If a godown is registered on the other store's GSTIN, a "same store" move is really a supply and needs a tax invoice. |
| C4 | A Hub ↔ Centre transfer valued at **cost price** is acceptable when the receiving GSTIN can claim full input tax credit (Rule 28, second proviso). |
| C5 | A **supplier return** travels on a delivery challan (Rule 55) with sub-supply type "Others", or another document. Zoho can generate e-way bills only against invoices, credit notes and delivery challans (§2.6). |
| C6 | **Validity is 1 day per 200 km** for ordinary cargo (Rule 138(10) as amended from 1 Jan 2021). `docs/agents/gst-consultant.md` still says 100 km — the doc is out of date (§2.9, L7). |
| C7 | A movement without a required bill risks detention of goods and vehicle under Section 129; the CA confirms the current penalty. |

---

## 2. How it works today — verified against the code

### 2.1 Transfers: a typed number, and a warning that arrives after the van has left

**Schema.** `TransferOrder` carries the document block `docType … consignmentValue`
(`prisma/schema.prisma:2322-2329`), including `eWayBillNo String?` (`:2328`) and
`consignmentValue Decimal(12,2)` (`:2329`), and the dispatch fields `vehicleNo`,
`transporterName` (`:2334-2335`). Nothing else in the schema mentions an e-way bill.

**Which document a transfer needs.** `docTypeForLane` (`src/lib/transfers/mode.ts:59-61`): both
warehouses under one store → `DELIVERY_CHALLAN`, different stores → `TAX_INVOICE`. The GSTIN is never
read (owner, 9 Sep 2026; `mode.ts:16-20`, `policy.ts:6-9`).

**The threshold.** `EWAY_BILL_THRESHOLD = 50_000` (`src/lib/transfers/policy.ts:29`). The comment
(`:18-28`) records two rules worth keeping: the threshold is about *movement*, so it catches a
delivery challan too; and dispatch **warns rather than refuses**.

**Where the number is typed.**

| Route | Guard | E-way handling |
|---|---|---|
| `POST /api/transfer-orders/[id]/document` (`document/route.ts`) | `transfers.view` + creator or `transfers.edit` (`:51, :69-72`) | accepts `eWayBillNo` (`:21`), saves it (`:115`); **refuses once dispatched** (`:74-81`). `docNumber` is optional (`:17-18`). |
| `POST /api/transfer-orders/[id]/dispatch` (`dispatch/route.ts`) | `transfers.edit` (`:51`) | accepts `eWayBillNo` (`:21`) and writes it in the claim (`:131, :137-147`); computes `consignmentValue = Σ costPrice × qty` (`:150-160`) and stores it (`:235-238`); **after** the transaction commits, warns when value > ₹50,000 and no number (`:266-275`). Logs `hasEWayBill` (`:277-284`). |

**What the screens show.** `GET /api/transfer-orders/[id]` derives `eWayBillRequired` from the
**stored** `consignmentValue` (`[id]/route.ts:122, :133-136`) and hides the value without
`cost_price.view` (`:126-128`). The dispatch sheet has the number field (`dispatch-sheet.tsx:201-214`)
and a blue "e-way bill required" box (`:166-175`) driven by `eWayBillLikely = order.eWayBillRequired
=== true` (`transfers/[id]/page.tsx:562`). The header chip (`page.tsx:349-353`) and the detail row
(`:441`) read the same fields.

### 2.2 Deliveries: no e-way field at all

**Schema.** `Delivery` (`schema.prisma:1971-2122`): `zohoInvoiceId String?` (`:1974`),
`invoiceAmount Float` (`:1976`) — the invoice **total including GST**, copied from Zoho at import
(`api/zoho/pull-review/approve/route.ts:637`) — `invoiceType` (`:2036`), `deliveryZone` (`:2061`),
courier fields (`:2062-2065`) and a `vehicleNo` (`:2066`) that the dispatch form never sends
(`dispatch-form.tsx:35-39`). No e-way column.

**How goods leave.** The status map is `VALID` in `PUT /api/deliveries/[id]`
(`api/deliveries/[id]/route.ts:225-238`), guarded by `deliveries.edit` (`:167`).

| Path | Screen | Route |
|---|---|---|
| Outstation, courier | **Dispatch** opens `DispatchForm` → `OUT_FOR_DELIVERY` with courier name / tracking / cost (`detail-actions.tsx:161-173, :217-227`; `dispatch-form.tsx:35-39`) | needs approval (`route.ts:261-268`) |
| Outstation, packed | **Mark Packed** → **Mark Shipped**, tracking number by `prompt()` (`detail-actions.tsx:229-258`) | tracking required (`route.ts:250-254`), needs approval |
| **Bangalore** | **Mark Delivered** straight from `SCHEDULED` through the handover checklist (`detail-actions.tsx:206-215`; `SCHEDULED → DELIVERED` at `route.ts:229`) | **no "leaves the building" step at all** |
| Walk-out | `/deliveries/[id]/walkout` | no approval |

`OUT_FOR_DELIVERY` and `SHIPPED` are the approval-gated statuses
(`src/lib/approvals/actions/delivery.ts:103`). A warning hooked only on those two would never fire
for a Bangalore delivery. The PUT already returns extra facts to the screen beside the row
(`stockShort`, `route.ts:480-486`), which the detail screen reads (`delivery-detail.tsx:69`).

**Delete.** `DELETE /api/deliveries/[id]` (`deliveries.delete`, `:515`) refuses dispatched and
delivered statuses (`:522-525`) and otherwise deletes inside a transaction (`:528-549`).

### 2.3 Where a delivery's invoice comes from — and why generation cannot trust `zohoInvoiceId`

- The bulk fetch reads invoices from **Zakya POS first**, Books as the fallback
  (`api/zoho/trigger-pull/route.ts:415-422`). The approve step asks the same provider for the detail
  (`pull-review/approve/route.ts:584-599`) and stores `zohoInvoiceId: preview.zohoId` (`:635`).
- The single-invoice import reads **Books first**, Zakya as the fallback
  (`api/deliveries/import-zoho/route.ts:38-46`).
- `Delivery` does not record which provider the id came from. Zakya is a separate API host
  (`src/lib/integrations/zakya.ts:10`, `api.zakya.in/inventory/v1`) with its own
  `IntegrationConfig` row and `organizationId` (`schema.prisma:1471-1489`).

So `Delivery.zohoInvoiceId` may be a Zakya id. An e-way bill must be raised against the invoice **in
Zoho Books' organisation**, found there **by invoice number** — and only if POS invoices reach Zoho
Books at all (Phase 0, check 0.4).

### 2.4 Supplier returns: nothing

- `VendorIssue` (`schema.prisma:1898-1932`) records a complaint — type (`IssueType`, `:199-207`),
  description, photos, status, notes. It has **no lines, no quantity, no warehouse and no stock
  effect**. Its routes write no stock (`api/vendor-issues/[id]/route.ts` guards at `:15, :53, :141`;
  no `inventoryTransaction` or warehouse write anywhere under `api/vendor-issues`).
- `TransactionType` is `INWARD | OUTWARD | TRANSFER | ADJUSTMENT` (`schema.prisma:126-131`). A generic
  manual outward exists — `POST /api/inventory/outwards` (`deliveries.create`, schema
  `validations.ts:108-118`: product, quantity, reference, notes) — but **no screen calls it** and it
  names no vendor.
- Searched for `VendorReturn`, `PURCHASE_RETURN`, "return to vendor" and variants: nothing.

A return pickup today leaves no record in the app. The stock that left keeps counting until an audit
finds it — that is a gap Q4(b) would close and Q4(a) does not.

### 2.5 Zoho today: clients, registry, scopes, and one organisation

- **Registry** `src/lib/integrations/endpoints.ts`: methods are `GET | POST | PUT` (`:36`). The only
  writes are `items.create`, `items.update`, `contacts.create`, `invoices.create`, `bills.create`
  (`:100-171`). **No e-way bill entry, no delivery-challan entry.** Its header says
  `docs/integrations-endpoints.md` is generated from it (`:17-18`); that file does not exist — the
  generator that reads the registry is `scripts/gen-zoho-postman.js`.
- **Clients:** `BooksClient` on `zohoapis.in/books/v3` (`books.ts:7`); `InventoryClient` on
  `zohoapis.in/inventory/v1` (`inventory.ts:58`). Books wraps a write body in `JSONString`, Inventory
  posts the object as it is (`endpoints.ts:183-191`). Both are request-scoped
  (`integrations/index.ts:59-68`).
- **`apiCall`** (`base.ts:293`) is `protected`, so a new Zoho call means a client method plus a
  registry entry. It refreshes and retries once on 401 (`:327`), backs off up to three times on 429
  (`:346`), reads through `readJson` and throws a plain `Error` when Zoho's `code` is not 0
  (`:364-371`). **A Zoho refusal and a network failure both arrive as `Error`** — generation must tell
  them apart (Phase 2).
- **Books and Inventory already share one organisation in practice.** Products are imported from
  **Zoho Inventory** (`api/stock/zoho-preview/route.ts:51`, `getInventory`), and **Books** bill lines
  are matched to those same products by `item_id` (`pull-review/approve/route.ts:307-311`). That only
  works if the ids are the same, i.e. one organisation. Zoho states that integrating the two
  *requires* the same organisation id ([Zoho KB](https://www.zoho.com/us/books/kb/integrations/diff-org-id.html))
  and that invoices are synchronised between them ([data sync](https://www.zoho.com/us/books/kb/integrations/data-sync.html)).
  Phase 0 confirms it from the database.
- **Scopes** are whatever the owner chose when generating the self-client grant; the setup guide
  recommends `ZohoInventory.fullaccess.all` (`docs/postman/zoho-setup.md:70-84`). The code cannot tell
  what production's token carries.
- **Since 12 Oct 2026 the test database holds production's live Zoho credentials** (shared brief).

### 2.6 What Zoho's API supports for e-way bills — read 12 Oct 2026

| Source | What it says |
|---|---|
| [Zoho Books API v3 — index](https://www.zoho.com/books/api/v3/introduction/) | Modules include Invoices, **Delivery Challans**, Credit Notes, **Vendor Credits**, **Purchase Returns**, Bills. **No e-way bill module.** E-invoice endpoints appear under Invoices and Credit Notes. No Transfer Orders module. |
| [Zoho Books API v3 — OAuth scopes](https://www.zoho.com/books/api/v3/oauth/) | 15 scopes (contacts, settings, estimates, invoices, …). **None for e-way bills.** |
| [Zoho Books API v3 — Invoices](https://www.zoho.com/books/api/v3/invoices/) | E-invoice endpoints (`/invoices/{id}/einvoice/push`, `…/cancel`, …). **No e-way bill endpoint.** |
| [Zoho Books API v3 — Delivery Challans](https://www.zoho.com/books/api/v3/delivery-challans/) | `GET/POST /deliverychallans` and friends; create needs a `customer_id`; `shipping_gst_no` is "Used for e-Way Bill and e-Invoice compliance". |
| [**Zoho Inventory API v1 — E-Way Bills**](https://www.zoho.com/inventory/api/v1/ewaybills/) (India edition) | **The complete set.** `POST /ewaybills` — "Create an e-Way Bill for a transaction such as an invoice, credit note, or delivery challan"; `entity_type` ∈ `invoice`, `creditnote`, `deliverychallan`; `action` ∈ `save` (draft in Zoho only), **`save_generate`** (files on the portal in the same call), `manually_generated` (attach a number made elsewhere). Part B fields on create: `transportation_mode`, `vehicle_number`, `vehicle_type`, `transporter_id`, `transporter_document_number/_date`, `distance`, `sub_supply_type`. `GET /ewaybills` (list, filter by `entity_type` + `entity_ids`), `GET /ewaybills/{id}`, `DELETE /ewaybills/{id}` (drafts only — "Generated e-Way Bills cannot be deleted; cancel them first"), **`POST /ewaybills/{id}/cancel`** (`reason` ∈ `duplicate`, `order_cancelled`, `data_entry_mistake`, `others`; `remarks` ≤ 50; within 24 hours, not if verified in transit), **`POST /ewaybills/{id}/vehicles`** (Part B change; `reason` ∈ `first_time`, `due_to_break_down`, `due_to_transhipment`, `others`; needs `from_place`, `from_state`), `PUT /ewaybills/{id}/extendvalidity`, `POST /ewaybills/{id}/sync` (pull the latest status from the portal), `GET/POST /ewaybills/transporters`, and per-GSTIN credential settings `…/settings/{tax_settings_id}/ewaybills`. Scopes named on the page: `ZohoInventory.settings.CREATE` (create, cancel, add vehicle), `ZohoInventory.settings.UPDATE`, `ZohoInventory.reports.READ` (list), `ZohoInventory.reports.CREATE` (sync), `ZohoInventory.invoices.READ` (get). Base URL in the examples is `.com`; this app uses the `.in` data centre. |
| [Zoho Books help — e-Way Bills (India)](https://www.zoho.com/in/books/help/e-way-bill/) | E-way bills "for invoices, bills of supply, credit notes, and delivery challans". Cancel, regenerate a cancelled one, extend validity, generate manually on the portal and attach the number. **Not** for bills, vendor credits, purchase returns or transfer orders. |
| [Zoho Books help — Generate](https://www.zoho.com/in/books/help/e-way-bill/generate-eway-bills/generate-ewb.html) | Needs document type, sub type, location, customer, transaction number, place of delivery, transporter, distance and Part B. **Distance 0 lets the portal calculate it** from the two PIN codes. A "Part A Generated" status exists while Part B is pending. The threshold is configured **per GSTIN**. |
| [Zoho KB — Zoho as GSP](https://www.zoho.com/in/books/kb/e-way-bills/add-zoho-books-as-your-gsp.html) | Log in to the e-way bill portal with the GST credentials, Registration › For GSP, choose "Zoho Corporation", set a username and password. Each GSTIN has its own portal login, so this is done once per GSTIN. |
| Zoho community thread ([link](https://help.zoho.com/portal/en/community/topic/printing-eway-bill-directly-from-zoho-portal)), surfaced by search | A search summary attributes a `POST /books/v3/ewaybills` example to this thread. **I could not read the thread's content myself**, and the path is in no Zoho Books reference page. Treated as unconfirmed. |

**Conclusions.**

1. **The API can generate e-way bills** — through Zoho Inventory's documented endpoints, against an
   **invoice, a credit note or a delivery challan** that exists in Zoho.
2. **Zoho cannot generate against a bill, a vendor credit, a purchase return or a transfer order.** A
   transfer needs a Zoho invoice (Hub ↔ Centre) or a Zoho delivery challan (godown ↔ own floor). A
   supplier return needs a Zoho delivery challan.
3. **Prerequisites, all outside the code:** e-way bills enabled in Zoho; Zoho registered as GSP for
   each GSTIN; the Inventory token holding the scopes above; the Zoho document carrying a shipping PIN,
   place of supply and HSN on every goods line.
4. **Cancel (24 h) and Part B change are available by API**; extend validity too (left to Zoho's
   screen, §5).

### 2.7 RBAC today

- `deliveries` — view, create, edit, delete, **approve** = outbound approval before
  `OUT_FOR_DELIVERY`/`SHIPPED` (`prisma/rbac-catalog.ts:180-190`). `transfers` — the same five
  (`:192-201`). `vendor_issues` — the same five (`:433-441`). `zoho` — view, edit, approve, fetch
  (`:888-900`). `cost_price` — a permission-only module with `route: null` (`:528-538`).
- The action vocabulary is fixed at six — `view create edit delete approve fetch`
  (`rbac-catalog.ts:10`, mirrored in `src/stores/permissions.ts:21`). A new verb such as "generate"
  would mean changing both plus the guard's type; a new module needs none of that.
- `requireFeature(module, action)` (`src/lib/auth-helpers.ts:137-148`). Where the module depends on
  the row, routes use `requireAuth()` + `userCan()` — e.g. `transfer-orders/[id]/route.ts:48, :79-85`.
- The seeder grants every permission to ADMIN on each run (`prisma/seed-rbac.ts:194-213`).

### 2.8 The GST position, plainly (gst-consultant)

**Stores, warehouses, GSTINs.** Each store has a FLOOR (the shop) and a GODOWN (storage)
(`prisma/seed-stores.ts:32-51`); a warehouse belongs to one store (`Warehouse.storeId`,
`schema.prisma:314-321`), so it sits under that store's GSTIN (`Store.gstin`, `:258`). Whether the
column is filled is a data question: the 0909 plan found both stores' GSTIN `null` on 9 Sep, the
`/stores` screen has had no GSTIN input since, and only the API still accepts one
(`api/stores/[id]/route.ts:43`). D1 says each row carries its GSTIN. **This build never reads it** —
Zoho holds the GSTIN of record on its own documents.

| Movement (owner's words) | GSTINs | Document | E-way bill when | Zoho entity to generate against |
|---|---|---|---|---|
| Warehouse → **Hub**, both BCH | same | delivery challan (Rule 55) | consignment value > ₹50,000 — movement, not sale | `deliverychallan` |
| Warehouse → **Centre**, BCH godown to BCC floor | different | **tax invoice** (Sec. 25(4), Sch. I para 2) | > ₹50,000 | `invoice` |
| Customer dispatch | — | tax invoice (raised in Zoho/POS) | > ₹50,000, not a walk-out (C2) | `invoice` |
| Supplier return pickup | — | delivery challan, or per CA (C5) | > ₹50,000 | `deliverychallan` |

The app's rule — different stores → tax invoice, same store → challan (`mode.ts:59-61`) — gives the
legally right document **as long as each godown is registered on its own store's GSTIN** (C3).

### 2.9 Live defects found while mapping

| # | Defect | Where | Effect |
|---|---|---|---|
| **L1** | **The pre-dispatch warning can never show.** `eWayBillRequired` is derived from the stored `consignmentValue`, which is written only *during* dispatch. Before dispatch it is `null`, so `eWayBillLikely` is false and the blue box never renders. The only warning comes back in the dispatch response — after the stock has left. | `transfer-orders/[id]/route.ts:133-136`; `dispatch/route.ts:235-238`; `transfers/[id]/page.tsx:562`; `dispatch-sheet.tsx:166` | The one moment the warning matters, it is absent. |
| **L2** | **After dispatch there is no way to add the number.** Dispatch says *"Add the number once it is raised"* (`dispatch/route.ts:272-274`), but the document route refuses an `IN_TRANSIT` transfer (`document/route.ts:74-81`) and dispatch cannot run twice (`dispatch/route.ts:148, :262-264`). | as cited | The instruction cannot be followed; the number is lost. |
| **L3** | Value excludes GST. | `dispatch/route.ts:159-160` | Under-warns by the GST rate (Rule 138, Expl. 2). |
| **L4** | A product with no cost price counts as ₹0: `Product.costPrice Float @default(0)` (`schema.prisma:579`). | `dispatch/route.ts:159` | Silent under-warning; nobody is told the value is incomplete. |
| **L5** | The number is not validated — any 30 characters. | `dispatch/route.ts:21`; `document/route.ts:21` | An e-way bill number is 12 digits; a typo is stored as a filing. |
| L6 | Stale comments: `Store.gstin` says "P14 refuses an inter-store transfer while either is missing" (`schema.prisma:254-257`) — removed 9 Sep (`policy.ts:6-9`). `endpoints.ts:17-18` names a generated file that does not exist. | as cited | Misleads the next reader. Fixed where this plan touches the file (endpoints.ts); the schema comment is corrected in the Phase 1 migration commit. |
| L7 | Agent docs out of date: `gst-consultant.md` says validity is "100km per day" (now 200 km, C6); `backend-engineer.md`'s route sample calls `requireAuth(["ADMIN", "SUPERVISOR"])`, which CLAUDE.md forbids; `frontend-engineer.md`'s fetch sample is the raw `fetch().then(r => r.json())` CLAUDE.md bans. | `docs/agents/*` | Not followed by this plan; flagged for the owner, not edited here. |

---

## 3. Implementation plan

| Phase | What | Calls Zoho? | Blocked by | Reqs |
|---|---|---|---|---|
| **P0** | Zoho readiness checks — no code | read-only, plus one draft with sign-off | nothing — start now, in parallel with P1 | R4 |
| **P1** | The `EwayBill` record; typed numbers on deliveries, transfers and (Q4) vendor issues; the warnings fixed (L1–L5) | no | Q4, Q6 | R1–R3, R5, R6 |
| **P2** | Generate, check and cancel through Zoho — **deliveries** | yes | Q1, Q2, Q5, P0, P1 | R1, R4, R7 |
| **P3** | Generate for **transfers** | yes | Q3, P2 | R2, R4 |
| **P4** | Change vehicle (Part B) in transit | yes | P2 | R7 |

One branch, one commit per phase. **P1 is mergeable on its own** and is useful even if Q1 ends as (c).

**Depends on sibling plans:** **H** (`1210-hsn-gst-catalogue-audit-plan.md`) — Zoho refuses an
e-way bill whose goods lines lack HSN codes; H's audit is where blanks are found. No dependency on
A–G. Sibling **B** pulls the brand's credit note that a supplier return ends in (D3); nothing here
waits for it.

### Phase 0 — Zoho readiness (no code; owner + developer)

Every check is a read except 0.5. Record each result in a "Build record" section appended to this
plan. **Do it against production's Zoho with the Postman collection** (`docs/postman/`), never from
the test deployment's Settings screen — Disconnect on test revokes production's token.

| # | Check | How | Pass means |
|---|---|---|---|
| 0.1 | Books, Inventory and Zakya organisation ids | read-only SQL: `SELECT provider, "organizationId" FROM integration_config;` | `ZOHO_BOOKS` = `ZOHO_INVENTORY` (required for Q1(a)). Note whether `ZAKYA_POS` matches too. |
| 0.2 | E-way bills enabled, Zoho registered as GSP for both GSTINs (Q2) | Zoho Books › Settings › e-Way Bills | both GSTINs show as connected |
| 0.3 | The Inventory token's scope | api-console.zoho.in › the self-client used | `ZohoInventory.fullaccess.all`, or at least the five scopes in §2.6. If not, the owner regenerates the grant **from production only**. |
| 0.4 | POS invoices exist in Zoho Books | Postman: `GET /books/v3/invoices?invoice_number=<a recent delivery's invoiceNo>` for three deliveries (one per floor prefix) | one invoice each, with a shipping address and PIN; note whether its `invoice_id` equals the delivery's `zohoInvoiceId` |
| 0.5 | The payload and the response shape | Postman: `POST /inventory/v1/ewaybills` with **`action: "save"`** (draft — **no** portal filing) against one 0.4 invoice; `GET` it; **`DELETE`** it. Owner's sign-off first — it writes a draft into the live books. | 200s; record the response field names for number, date, valid-until, status, dispatch-from state |
| 0.6 | Transporters list | `GET /inventory/v1/ewaybills/transporters` | answers; note whether the courier companies used exist in it |

If 0.1, 0.2 or 0.4 fails, stop: Q1 falls back to (c) and only P1 is built.

### Phase 1 — the record and the warnings (no Zoho)

#### 1a. Schema and migration

**Why one table (Q6 default).** An e-way bill has a life of its own: it is generated, its vehicle
changes, it is cancelled and another is generated for the same document — and the cancelled one must
stay on record. That is the same object whatever it hangs off. Ten columns on each of three tables
would triple the code and lose the history (a column holds one number). One table also gives the
accountant one place to look later.

`prisma/schema.prisma` — new enums and model; relation fields only (no SQL columns) on `Delivery`,
`TransferOrder`, `VendorIssue` and `User`:

```prisma
/// Why the goods move. Decides which document the bill hangs off (exactly one, CHECK in SQL).
enum EwayBillPurpose {
  CUSTOMER_DISPATCH // a Delivery
  BRANCH_TRANSFER   // a TransferOrder
  SUPPLIER_RETURN   // a VendorIssue (Q4 = a)
}

/// Where the number came from.
enum EwayBillSource {
  MANUAL // typed in; generated on the portal or in Zoho's own screen
  ZOHO   // generated by this app through Zoho (P2+)
}

enum EwayBillStatus {
  GENERATING // ZOHO only — the request left, the outcome is not yet known
  ACTIVE
  CANCELLED  // cancelled on the portal (ZOHO), or removed as typed in error (MANUAL)
  FAILED     // ZOHO only — Zoho or the portal refused; kept for the reason
}

model EwayBill {
  id      String          @id @default(cuid())
  purpose EwayBillPurpose
  source  EwayBillSource
  status  EwayBillStatus  @default(ACTIVE)

  // Exactly one is set. Restrict: a document is never deleted from under a filing; the parent's
  // delete route clears MANUAL rows itself and refuses when a ZOHO row exists.
  deliveryId      String?
  delivery        Delivery?      @relation(fields: [deliveryId], references: [id], onDelete: Restrict)
  transferOrderId String?
  transferOrder   TransferOrder? @relation(fields: [transferOrderId], references: [id], onDelete: Restrict)
  vendorIssueId   String?
  vendorIssue     VendorIssue?   @relation(fields: [vendorIssueId], references: [id], onDelete: Restrict)

  ewbNo      String?   // 12 digits. Null only while GENERATING or FAILED (CHECK in SQL)
  ewbDate    DateTime?
  validUntil DateTime?

  docNumber        String?                  // the invoice / challan number it was raised against
  consignmentValue Decimal? @db.Decimal(12, 2)

  // Part B
  transportMode    String? // road | rail | air | ship
  vehicleNo        String?
  transporterId    String? // GSTIN or TRANSIN
  transporterName  String?
  transporterDocNo String?
  distanceKm       Int?

  // Zoho (source = ZOHO)
  zohoEwayBillId String?   @unique
  zohoEntityType String?   // invoice | deliverychallan | creditnote
  zohoEntityId   String?
  lastError      String?
  lastSyncedAt   DateTime?

  recordedById  String
  recordedBy    User      @relation("EwayBillRecordedBy", fields: [recordedById], references: [id])
  cancelledById String?
  cancelledBy   User?     @relation("EwayBillCancelledBy", fields: [cancelledById], references: [id], onDelete: SetNull)
  cancelledAt   DateTime?
  cancelReason  String?
  cancelRemarks String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([deliveryId])
  @@index([transferOrderId])
  @@index([vendorIssueId])
  @@index([ewbNo])
  @@index([status, createdAt])
}
```

Money is `Decimal(12,2)`, never `Float` (database-architect). `vendorIssue` and `SUPPLIER_RETURN` are
dropped from the model if Q4 = (c).

**Migration** — `npx prisma migrate dev --name eway_bills` **on localhost only**, on a database
restored from a production snapshot (rule 10). Expected generated SQL: three `CREATE TYPE`, one
`CREATE TABLE "EwayBill"`, the indexes, the foreign keys. **Then hand-add**, in the same file:

```sql
-- Exactly one document per bill.
ALTER TABLE "EwayBill" ADD CONSTRAINT "EwayBill_exactly_one_document"
  CHECK (num_nonnulls("deliveryId", "transferOrderId", "vendorIssueId") = 1);
-- A live or cancelled bill always has its number.
ALTER TABLE "EwayBill" ADD CONSTRAINT "EwayBill_number_when_issued"
  CHECK ("status" IN ('GENERATING', 'FAILED') OR "ewbNo" IS NOT NULL);
-- One live bill per document — two people pressing Generate get one filing and one 409.
CREATE UNIQUE INDEX "EwayBill_one_live_per_delivery" ON "EwayBill" ("deliveryId")
  WHERE "status" IN ('GENERATING', 'ACTIVE');
CREATE UNIQUE INDEX "EwayBill_one_live_per_transfer" ON "EwayBill" ("transferOrderId")
  WHERE "status" IN ('GENERATING', 'ACTIVE');
CREATE UNIQUE INDEX "EwayBill_one_live_per_vendor_issue" ON "EwayBill" ("vendorIssueId")
  WHERE "status" IN ('GENERATING', 'ACTIVE');
-- A live number belongs to one document. Cancelled rows may repeat a number re-typed correctly.
CREATE UNIQUE INDEX "EwayBill_live_number" ON "EwayBill" ("ewbNo") WHERE "status" = 'ACTIVE';
```

Prisma cannot express a CHECK or a partial index. The precedent is
`Warehouse_one_primary_floor_per_store` (`prisma/migrations/20260916173617_delivery_floor_warehouse_and_holds/migration.sql:43-44`),
which no later `migrate dev` has tried to drop. The builder confirms the same by running
`npx prisma migrate dev --create-only --name drift_check` afterwards on localhost and checking it
proposes nothing (then deletes that empty folder).

**Backfill** — the existing typed transfer numbers, in the same migration. First a read-only count
on the snapshot, kept in the build record:

```sql
SELECT count(*) FILTER (WHERE "eWayBillNo" ~ '^\s*[0-9]{12}\s*$') AS backfillable,
       count(*) FILTER (WHERE "eWayBillNo" IS NOT NULL AND trim("eWayBillNo") <> ''
                        AND "eWayBillNo" !~ '^\s*[0-9]{12}\s*$') AS left_in_legacy_column
FROM "TransferOrder";
```

```sql
INSERT INTO "EwayBill" ("id", "purpose", "source", "status", "transferOrderId", "ewbNo",
  "vehicleNo", "transporterName", "docNumber", "consignmentValue", "recordedById", "createdAt", "updatedAt")
SELECT DISTINCT ON (trim(t."eWayBillNo"))
  'ewb_bf_' || t."id", 'BRANCH_TRANSFER', 'MANUAL', 'ACTIVE', t."id", trim(t."eWayBillNo"),
  t."vehicleNo", t."transporterName", t."docNumber", t."consignmentValue",
  COALESCE(u."id", t."createdById"), COALESCE(t."dispatchedAt", t."updatedAt"), now()
FROM "TransferOrder" t
LEFT JOIN "User" u ON u."id" = t."dispatchedById"   -- dispatchedById has no FK (route.ts header)
WHERE t."eWayBillNo" ~ '^\s*[0-9]{12}\s*$'
ORDER BY trim(t."eWayBillNo"), t."createdAt";
```

Numbers that are not 12 digits, and later duplicates, stay in `TransferOrder.eWayBillNo` only; the
card shows them as "recorded before e-way records existed" (1d).

**Rules honoured.** Rule 3: nothing is dropped, retyped or set NOT NULL on a populated table —
`EwayBill` is new and `TransferOrder` is only read. Rule 7: the old code never reads the new table and
survives it; the new code **keeps writing `TransferOrder.eWayBillNo`** alongside the new row for one
release, and the column is dropped in a later release once nothing reads it. Rule 9: `npm run
db:snapshot` before merging. Rule 4: **apply by hand** on the target before the code goes live
(`npx prisma migrate status`, then `npx prisma migrate deploy`).

#### 1b. Shared policy — `src/lib/eway/policy.ts` (new)

Pure functions, no Prisma import:

- `EWAY_BILL_THRESHOLD` — **moved** here from `src/lib/transfers/policy.ts:29`. Its two importers are
  updated in the same commit (`transfer-orders/[id]/route.ts:10`, `transfer-orders/[id]/dispatch/route.ts:10`);
  `docTypeLabel` stays where it is.
- `isEwbNumber(s)` — `/^\d{12}$/` after trimming spaces (L5).
- `transferConsignmentValue(lines: { quantity; costPrice; gstRate }[])` →
  `{ value, unknownCostLines }` — Σ qty × cost × (1 + GST/100) (Q9); a line with cost 0 is counted in
  `unknownCostLines` (L4).
- `deliveryNeedsEwayBill(d)` → `{ needed, value }` — `invoiceAmount > threshold`, not a walk-out, not
  `invoiceType === "SERVICE"`, not a Dummy (Q7). `invoiceAmount` already includes GST (§2.2).
- `moduleForPurpose(purpose)` → `"deliveries" | "transfers" | "vendor_issues"`.

#### 1c. API

New zod schema in `src/lib/validations.ts`:

```ts
export const ewayBillRecordSchema = z.object({
  ewbNo: z.string().transform((s) => s.replace(/\s/g, "")).refine(isEwbNumber,
    "An e-way bill number is 12 digits."),
  ewbDate: z.string().optional(),     // YYYY-MM-DD
  validUntil: z.string().optional(),  // YYYY-MM-DD
  vehicleNo: z.string().trim().max(20).optional(),
});
```

| Method · path | Guard | What it does |
|---|---|---|
| `POST /api/deliveries/[id]/eway-bill` (new) | `requireFeature("deliveries", "edit")` | Refuses a Dummy (409, existing `DUMMY_MESSAGE`), a service invoice (400 *"A service invoice moves no goods."*), and a delivery with a live bill (409 *"This delivery already has e-way bill 1234 5678 9012."*). Creates a MANUAL / ACTIVE row with `docNumber = invoiceNo`, `consignmentValue = invoiceAmount`; `logActivity(tx, { module: "deliveries", action: "eway_recorded", … })` in the same transaction. A partial-unique violation (P2002) becomes the same 409. |
| `POST /api/transfer-orders/[id]/eway-bill` (new) | `requireFeature("transfers", "edit")` | Allowed in `APPROVED`, `IN_TRANSIT`, `RECEIVED` — **closes L2**. Same refusals; writes the row **and** `TransferOrder.eWayBillNo` (rule 7). |
| `POST /api/vendor-issues/[id]/eway-bill` (new, Q4 = a) | `requireFeature("vendor_issues", "edit")` | Only for `issueSource: VENDOR` with a vendor (400 otherwise). |
| `DELETE /api/eway-bills/[id]` (new) — "remove a number typed in error" | `requireAuth()` then `userCan(user.id, moduleForPurpose(row.purpose), "edit")` → 403 | **Soft**: MANUAL + ACTIVE → `CANCELLED`, `cancelReason: "removed — typed in error"`. A ZOHO row → 409 *"This bill was filed through Zoho — cancel it instead."* |

Changes to existing routes:

- **`POST /api/transfer-orders/[id]/dispatch`** — validate with `isEwbNumber` (L5); inside the existing
  transaction, when a number is given and no live row exists, create the MANUAL row; keep writing the
  legacy column; select `product.gstRate` and compute the value with `transferConsignmentValue` (L3);
  the warning also names `unknownCostLines` (*"3 lines have no cost price, so the value is
  incomplete."*) (L4).
- **`POST /api/transfer-orders/[id]/document`** — same validation; a given number also creates the
  MANUAL row.
- **`GET /api/transfer-orders/[id]`** — include `ewayBills` (newest first). **Close L1:** when
  `consignmentValue` is null, compute an estimate from the items (add `costPrice`, `gstRate` to the
  product select at `:68`, and strip `costPrice` from the payload without `cost_price.view` exactly as
  `unitCost` is stripped at `:129-132`). `eWayBillRequired` then answers before dispatch. Return
  `ewayUnknownCostLines`.
- **`src/lib/transfers/actions.ts`** — a new `"record_eway_bill"` action when `canEdit` and the status
  is `APPROVED | IN_TRANSIT | RECEIVED` and no live bill exists (the screen keeps rendering only
  `actions[]`).
- **`GET /api/deliveries/[id]`** — `DELIVERY_INCLUDE` (`route.ts:60`) gains `ewayBills`; the payload
  gains `eway: { needed, value }` from `deliveryNeedsEwayBill`.
- **`PUT /api/deliveries/[id]`** — after the transaction, when the move is to `OUT_FOR_DELIVERY`,
  `SHIPPED`, or `SCHEDULED → DELIVERED`, the delivery needs a bill and has no live one: add
  `ewayWarning: "This delivery is over ₹50,000 and needs an e-way bill. Add the number on the delivery."`
  to the response beside `stockShort` (`:480-486`). **A warning, never a refusal** (Q8).
- **`DELETE /api/deliveries/[id]`** — inside its transaction (`:528-549`): refuse when any ZOHO row
  exists (*"This delivery has an e-way bill filed through Zoho and cannot be deleted."*); otherwise
  `deleteMany` its MANUAL rows before `delivery.delete` (they are notes about the document being
  removed) and log the count.
- **`GET /api/vendor-issues/[id]`** — include `ewayBills`. Its `DELETE` (`:141`) gets the same
  treatment as the delivery delete.

#### 1d. Screens

- **`src/components/eway/eway-bill-card.tsx`** (new, shared). Props: `purpose`, `parentId`,
  `needed: boolean | null`, `valueText: string | null` (null without `cost_price.view` on a transfer),
  `bills`, `legacyNumber`, `actions: string[]`, `onChanged`. States:
  - needed and none live → amber line *"E-way bill needed — this consignment is over ₹50,000"* and
    **Add number** (44 px);
  - live → the number in 4-4-4 groups, date, valid-until, a chip *Typed* or *Zoho*, vehicle;
  - history → cancelled/failed rows under a collapsed "Earlier" toggle;
  - `legacyNumber` with no row → *"Recorded before e-way records existed: …"*.
  
  **Add number** opens the bottom-sheet pattern already used by `dispatch-sheet.tsx` (`max-h-[90dvh]`,
  footer `pb-safe`): a numeric field (`inputMode="numeric"`, 12 digits), optional date, optional
  valid-until; Save disabled while sending; the server's sentence shown inline on refusal. Calls go
  through `apiTry`. `createLogger("eway:card")`. **Remove** on a typed row asks a `confirm` first.
- **Delivery detail** — render the card in `src/app/(dashboard)/deliveries/_components/delivery-detail.tsx`
  beside `CourierInfoCard` (`:211`), from `VERIFIED` onward, hidden for walk-outs and service
  invoices; show `ewayWarning` from the PUT response the way `stockShort` is shown (`:69`).
- **Transfer detail** — render the card in `transfers/[id]/page.tsx` under the document card; the
  dispatch sheet's warning (`dispatch-sheet.tsx:166-175`) now appears **before** dispatch (L1); its
  number field validates 12 digits before sending.
- **Vendor issue detail** (Q4 = a) — the card in `vendor-issues/[id]/page.tsx`, titled *"Return pickup
  — e-way bill"*, for vendor-sourced issues only.

No role names anywhere: every button is driven by the server's `actions` list (transfers) or by
`usePermissions().canEdit(...)` (deliveries, vendor issues), and every route re-checks.

### Phase 2 — generate, check and cancel through Zoho (deliveries)

#### 2a. Registry and client

`src/lib/integrations/endpoints.ts` — new entries (Q1 = a), all `INVENTORY_ONLY`, each with its
owner method and purpose; fix the stale header line (L6):

| Key | Method · path | Owner |
|---|---|---|
| `ewaybills.create.inventory` | `POST /ewaybills` | `InventoryClient.createEwayBill` |
| `ewaybills.list.inventory` | `GET /ewaybills?entity_type&entity_ids` | `InventoryClient.findEwayBillsForEntity` |
| `ewaybills.get.inventory` | `GET /ewaybills/{ewaybill_id}` | `InventoryClient.getEwayBill` |
| `ewaybills.cancel.inventory` | `POST /ewaybills/{ewaybill_id}/cancel` | `InventoryClient.cancelEwayBill` |
| `ewaybills.sync.inventory` | `POST /ewaybills/{ewaybill_id}/sync` | `InventoryClient.syncEwayBill` |
| `ewaybills.transporters.list.inventory` | `GET /ewaybills/transporters` | `InventoryClient.listEwayTransporters` |

The invoice lookup reuses the existing `invoices.search` (`BooksClient.searchInvoices`,
`books.ts:66-74`) with `invoice_number`. Methods live in `src/lib/integrations/inventory.ts`, typed to
the fields Phase 0.5 recorded. Regenerate the Postman collection with `node scripts/gen-zoho-postman.js`.

**`src/lib/integrations/base.ts:369-371`** — throw a `ZohoRefusal extends Error` carrying `code`
instead of a plain `Error` when Zoho answers with `code ≠ 0`. Every existing `catch` keeps working
(it is still an `Error`); generation can now tell **"Zoho said no"** (definite — nothing filed) from
**a network failure or an HTML gateway page** (unknown — something may have been filed). A 401 that
survives the refresh and a 429 that survives three retries are also definite.

#### 2b. The switch — `src/lib/eway/filing.ts` (new, Q11)

`filingEnabled()` returns `process.env.EWAY_FILING_ENABLED === "true"`. Every route in 2d–2e and P3–P4
that calls an e-way endpoint checks it first and otherwise answers 409 *"E-way bill filing is
switched off on this environment."* Set the variable on the **production** deployment only; never
in `.env` files, never on test.

#### 2c. RBAC catalog (Q5 = a)

`prisma/rbac-catalog.ts`, in the Accounts band beside `cost_price` (`:528-538`):

```ts
{
  // Filing e-way bills with the government through Zoho (plan 1210-eway-bills, Q5). A legal act
  // separate from approving a dispatch. Typing a number by hand stays on the document's own
  // `edit` grant. create = generate · edit = change vehicle (Part B) · delete = cancel on the
  // portal · view = see Zoho status and press "Check Zoho".
  // ⚠ RUN npm run db:seed:rbac AFTER DEPLOY
  key: "eway_bills",
  label: "E-way bills",
  description: "Generate, update and cancel e-way bills through Zoho",
  icon: "FileCheck",
  route: null,
  group: "Accounts",
  sortOrder: 335,
  actions: ["view", "create", "edit", "delete"],
},
```

Data, not a migration: `npm run db:seed:rbac` after the deploy. ADMIN receives the four permissions
automatically (`seed-rbac.ts:194-213`); every other role gets nothing until an admin ticks them on
`/team/permissions`. Sibling D adds a bank module in the same band — whichever merges second checks
the `sortOrder` does not collide.

#### 2d. Generation — `src/lib/eway/zoho.ts` (new) and `POST /api/eway-bills/generate` (new)

zod:

```ts
export const ewayBillGenerateSchema = z.object({
  deliveryId: z.string().optional(),
  transferOrderId: z.string().optional(),          // P3
  transportMode: z.enum(["road", "rail", "air", "ship"]).default("road"),
  vehicleNo: z.string().trim().regex(/^[A-Z0-9]{4,20}$/i).optional(),
  transporterId: z.string().optional(),             // Zoho transporter record id
  transporterDocNo: z.string().trim().max(30).optional(),
  transporterDocDate: z.string().optional(),
  distanceKm: z.number().int().min(0).max(4000).default(0), // 0 = the portal works it out
}).refine((b) => [b.deliveryId, b.transferOrderId].filter(Boolean).length === 1,
  "Name exactly one delivery or transfer.");
```

Guard: `requireFeature("eway_bills", "create")`, then `userCan(user.id, moduleForPurpose(…), "view")`
→ 403, so nobody files for a document they cannot see. `export const maxDuration = 60`.

The sequence — the answer to *"what if this runs twice?"*:

1. `filingEnabled()`, else 409.
2. Load the delivery; refuse a Dummy, a service invoice, a walk-out, a live bill (409 with the number).
3. `getInventory()` and `getBooks()`; null → 409 *"Zoho is not connected — connect it on Settings ›
   Integrations."* (the wording `trigger-pull` already uses).
4. **Find the Zoho invoice by number**, not by `zohoInvoiceId` (§2.3): `searchInvoices({
   invoice_number })`, exactly one non-void match, else 409 *"Invoice INV/… is not in Zoho Books."*
5. **Claim:** insert `EwayBill { source: ZOHO, status: GENERATING, zohoEntityType: "invoice",
   zohoEntityId, docNumber, consignmentValue, Part B fields, recordedById }`. A second press hits the
   partial unique index → 409 *"A bill is already being generated for this delivery."*
6. **Call** `createEwayBill({ entity_type: "invoice", entity_id, action: "save_generate",
   transportation_mode, vehicle_number | transporter_id + transporter_document_number/_date,
   distance })`.
7. **Settle:** success → `ACTIVE` with number, date, valid-until, `zohoEwayBillId`, `lastSyncedAt`;
   `logActivity` on `deliveries` (`eway_generated`); also write `Delivery.vehicleNo`.
   `ZohoRefusal` → `FAILED` with `lastError` = Zoho's sentence; respond 422 with that sentence (e.g.
   a missing PIN or HSN — the fix is in Zoho, and the sentence says so). Anything else → leave
   `GENERATING`; respond 202 *"Sent to Zoho, but the answer did not arrive. Press Check Zoho before
   trying again."*

**Before step 5**, if an earlier row for this document is `GENERATING`, the route refuses and points
at *Check Zoho* — it never generates over an unknown outcome.

#### 2e. Check and cancel

| Method · path | Guard | zod | What |
|---|---|---|---|
| `POST /api/eway-bills/[id]/sync` | `eway_bills.view` | — | `GENERATING` → `findEwayBillsForEntity`; a generated bill found → `ACTIVE` with its number; none → `FAILED` *"Zoho has no e-way bill for this document."* `ACTIVE` → `syncEwayBill` then `getEwayBill`; refresh status (cancelled on the portal → `CANCELLED`), valid-until, vehicle; `lastSyncedAt`. A button, never a timer. |
| `POST /api/eway-bills/[id]/cancel` | `eway_bills.delete` | `{ reason: enum("duplicate","order_cancelled","data_entry_mistake","others"), remarks: string ≤ 50 }` | ZOHO + ACTIVE only. Refuses after 24 h from `ewbDate` with *"The 24-hour cancel window closed at 14:05 on 13 Oct. Ask the CA."* `cancelEwayBill` → `CANCELLED` with who, when, reason; `logActivity` (`eway_cancelled`). |
| `GET /api/eway-bills/transporters` | `eway_bills.create` | — | The transporter picker for the generate sheet, fetched when the sheet opens. |

All three check `filingEnabled()` first.

`GET /api/deliveries/[id]` adds `ewayActions: string[]` — `"generate"`, `"check"`, `"cancel"` — from
`userCan` on `eway_bills`, computed on the server as transfers do (`src/lib/transfers/actions.ts`).

#### 2f. Screens

The card gains, per `ewayActions`:

- **Generate through Zoho** → a sheet: *Own vehicle* (vehicle number) or *Courier / transporter*
  (transporter picker, docket number and date), distance (blank = 0, "the portal works it out"), and
  above the button, in amber: *"This files a legal document with the government under the store's
  GSTIN. It cannot be deleted — only cancelled within 24 hours."* Button disabled while sending.
- **Check Zoho** on a `GENERATING` or `ACTIVE` row.
- **Cancel** on a ZOHO `ACTIVE` row inside 24 h: reason select, remarks (50 characters), hours left
  shown, confirm.

### Phase 3 — generation for transfers

- `src/lib/integrations/endpoints.ts` + `books.ts`: `deliverychallans.list` (`BOOKS_ONLY`,
  `GET /deliverychallans?search_text`) → `BooksClient.findDeliveryChallans(text)`, matched exactly on
  `deliverychallan_number` in code (the filter parameter's exact name is confirmed in Phase 0's
  Postman run).
- `src/lib/eway/zoho.ts` — the transfer resolver: refuses a blank `docNumber` (*"Type the Zoho tax
  invoice number on the transfer's document first."*); `TAX_INVOICE` → `searchInvoices({
  invoice_number: docNumber })` → `invoice`; `DELIVERY_CHALLAN` → `findDeliveryChallans(docNumber)` →
  `deliverychallan`. Everything else is 2d unchanged; `logActivity` on `transfers`; also write
  `TransferOrder.vehicleNo` and the legacy `eWayBillNo` (rule 7).
- `computeActions` gains `"generate_eway_bill"` (context: `canGenerateEway` from `userCan`).
- The dispatch sheet offers **Generate through Zoho** when the transfer needs a bill, has none, and
  the action is present; the vehicle typed for dispatch fills the generate request.

### Phase 4 — change vehicle (Part B) in transit

- Registry: `ewaybills.vehicles.add.inventory` (`POST /ewaybills/{ewaybill_id}/vehicles`) →
  `InventoryClient.addEwayBillVehicle`.
- `POST /api/eway-bills/[id]/vehicle` — `requireFeature("eway_bills", "edit")`; zod `{ vehicleNo,
  reason: enum("first_time","due_to_break_down","due_to_transhipment","others"), remarks ≤ 50,
  fromPlace ≤ 50, transportMode, transporterDocNo?, transporterDocDate? }`. `from_state` is taken from
  the bill's own dispatch-from state as Zoho returns it (field confirmed in 0.5) — **not** from
  `Store.stateCode`, which keeps the owner's 9 Sep rule that the app never consults GST data on
  stores. `filingEnabled()` first. `logActivity` with `fromValue`/`toValue` = old/new vehicle.
- The card: **Change vehicle** on a ZOHO `ACTIVE` row.

### Logging

| Scope | Level · line |
|---|---|
| `eway:record` (new, server) | `info` "e-way number recorded" `{ ewayBillId, purpose, parentId }`; `info` "typed number removed"; `warn` on each refusal (duplicate, Dummy, service invoice) with the parent id |
| `eway:generate` (new) | `info` "e-way bill generated" `{ ewayBillId, purpose, parentId, zohoEwayBillId }`; `warn` "Zoho refused" `{ ewayBillId, code, message }`; **`error` "outcome unknown"** `{ ewayBillId, parentId }`; `warn` "filing switched off" |
| `eway:sync`, `eway:cancel`, `eway:vehicle` (new) | `info` on each completed action with the ids; `warn` on refusals (window closed, not ZOHO); `error` on failure |
| `integrations` (existing, `base.ts`) | `debug` per request with the registry key and body size — never the body (it carries customer names and addresses) |
| `transfer-orders:dispatch` (existing) | the existing `info` line gains `needsEway` and `unknownCostLines` |
| `deliveries:api` (existing) | `warn` "left without e-way bill" `{ deliveryId, invoiceNo, status }` when `ewayWarning` is returned |
| `eway:card` (new, browser) | `warn` on any failed `apiTry` with `{ purpose, parentId, status }` |

Every `catch` logs before it answers. E-way bill numbers and invoice numbers are identifiers and may
be logged; Zoho tokens, the portal logins and request bodies never are.

### Board of agents — checked

- **gst-consultant** — threshold ₹50,000 applied to movement, not only sale (§2.8) ✓; the document
  rule matches distinct-person law provided each godown is on its own store's GSTIN (**C3, raised**) ✓;
  red flag *"E-way bill not generated for outstation shipment > ₹50,000"* — answered by the delivery
  badge and dispatch warning (P1) ✓; consignment value now includes GST (L3) ✓; HSN on every goods line
  is a Zoho precondition → sibling H ✓. **Flagged:** the doc's "100 km per day" validity is out of
  date (C6, L7); walk-outs and supplier-return documents need the CA (C2, C5).
- **warehouse-consultant** — *dispatch = check before pack*: the number is captured at dispatch with
  the vehicle, and the warning now appears **before** the van leaves (L1) ✓; the van is never held by
  the app (warn, Q8) ✓; outstation tracking-number rule untouched ✓. What goes wrong if skipped:
  detention under Section 129 (C7) — stated on the generate sheet.
- **integration-architect** — App → Zoho push, then confirm, then record locally ✓; *"what if it
  runs twice?"* — partial unique index + `GENERATING` claim + *Check Zoho* reconcile by entity, never
  a blind retry ✓; Zoho is the source of truth for the filed bill, refreshed only by an explicit Sync,
  `lastSyncedAt` kept ✓; deduplication key `zohoEwayBillId @unique` ✓; single calls on a button, no
  loops (rate limits) ✓. The Pull-Preview-Approve rule is for Zoho → app imports and does not apply.
- **backend-engineer** — zod at every boundary ✓; multi-row writes in `$transaction` ✓; a status map
  for `EwayBill` (`GENERATING → ACTIVE | FAILED`, `ACTIVE → CANCELLED`) enforced in `src/lib/eway/` ✓;
  human sentences on every refusal ✓; idempotency ✓. **Not followed:** the doc's sample
  `requireAuth(["ADMIN", "SUPERVISOR"])` (L7) — guards here are `requireFeature(module, action)` only.
- **database-architect** — one table with FKs and indexes on every FK ✓; `Decimal(12,2)` for money ✓;
  CHECK + partial unique indexes written and read by hand ✓; additive migration with a reviewed
  backfill ✓; soft delete (CANCELLED) for every bill ✓ — the one hard delete is MANUAL rows removed
  together with their parent document, inside its transaction ✓.
- **frontend-engineer** — mobile-first sheets at 375 px, 44 px targets, disabled-while-busy, inline
  error sentence, loading and empty states on the card ✓; `apiTry`, not raw `fetch` ✓; no role checks
  in the UI ✓. **Not followed:** the doc's raw-`fetch` state sample (L7).
- **inventory-consultant** (not on this plan's list, consulted for Q4) — Q4(a) records a filing
  without moving stock; **flagged**: goods returned to a supplier keep counting in the app until a
  return document exists (Q4(b) or its own requirements doc).

---

## 4. Verification

> **⚠ An e-way bill is a legal document filed with the government under Bharath Cycle Hub's GSTIN.
> Since 12 Oct 2026 the test database holds production's live Zoho credentials, so generating one on
> test files a real bill — exactly as on production.**
>
> - **Never** press *Generate through Zoho* on test or production to try the feature out.
> - **Never** call `save_generate`, cancel or add-vehicle from Postman or a script, except on a real
>   consignment that legally needs the bill, with the owner's explicit sign-off naming that delivery
>   or transfer.
> - **Never** generate a bill in order to test cancelling it.
> - **Never** Disconnect or reconnect Zoho from the test deployment — it revokes production's token.
> - Generation is allowed only once a Zoho **sandbox** organisation exists (Q12) — confirming first
>   that its e-way bill setting points at the government's sandbox, not the live portal — **or** with
>   the owner's sign-off on a real consignment.

**Every phase.** `npm run build` (needs a reachable database — CLAUDE.md), `npx tsc --noEmit`,
`npx eslint` on every touched file.

**Phase 1** (no Zoho — safe anywhere)

1. Read the migration SQL: three types, one table, indexes, FKs, the hand-written CHECKs and partial
   indexes, the backfill — nothing that alters `TransferOrder`. On localhost (restored snapshot) the
   number of backfilled rows equals the pre-count's `backfillable`; `migrate status` clean; the
   `--create-only` drift check proposes nothing.
2. `/deliveries/[id]` for a `VERIFIED` delivery over ₹50,000 → amber *"E-way bill needed"*. Add an
   11-digit number → refused with the sentence; 12 digits → shown with *Typed*. Add the same number to
   another delivery → 409. Remove it → it moves under *Earlier*; add it again on the right delivery →
   accepted.
3. A service invoice and a walk-out over ₹50,000 → no card. A delivery under ₹50,000 → no badge.
4. Bangalore **Mark Delivered** and outstation **Dispatch** / **Mark Shipped** on a delivery needing a
   bill with none → the move succeeds and the banner shows the e-way warning; `deliveries:api` logs
   the `warn`.
5. Delete a `PENDING` delivery carrying a typed number → deleted; its row went with it.
6. `/transfers/[id]`, an `APPROVED` transfer whose value with GST passes ₹50,000 → the dispatch sheet
   shows the warning **before** dispatch (L1). Dispatch without a number → the warning; then add the
   number from the card on the `IN_TRANSIT` transfer (L2). A transfer whose cost alone is below
   ₹50,000 but above it with GST → warned (L3). A line with cost 0 → the "value is incomplete" sentence
   (L4). A user without `cost_price.view` sees the warning but no rupee figure.
7. A transfer with a pre-migration number → shown on the card; one with a non-12-digit legacy value
   → shown as "recorded before e-way records existed".
8. `/vendor-issues/[id]` for a vendor issue (Q4 = a) → card present; a client issue → no card.

**Phase 2–4** (Zoho)

9. With `EWAY_FILING_ENABLED` unset — local and test — *Generate*, *Check Zoho*, *Cancel*, *Change
   vehicle* and the transporters list all answer the "switched off" sentence. **This is the test of
   the feature on test.**
10. Route tests with `InventoryClient` and `BooksClient` stubbed at the method boundary (no network):
    success → `ACTIVE`; `ZohoRefusal` → `FAILED` with Zoho's sentence; a thrown network error →
    `GENERATING` and the 202 sentence; a second press → 409; *Check Zoho* finding one bill → `ACTIVE`,
    finding none → `FAILED`; cancel after 24 h → refused locally, Zoho never called.
11. Phase 0.5's draft check (`action: "save"`, read back, `DELETE`) is the only Zoho write before
    go-live, and only with the owner's sign-off.
12. **First live generation:** on production, a genuine delivery over ₹50,000 that is leaving that
    day, chosen by the owner, with the owner present. Confirm the bill in Zoho Books › Sales › e-Way
    Bills and on ewaybillgst.gov.in, print it for the driver. Press *Check Zoho*. Cancel only if this
    real bill turns out wrong — inside 24 hours.
13. RBAC: after `npm run db:seed:rbac`, `/team/permissions` shows *E-way bills* with four boxes; a
    role without `eway_bills.create` sees no *Generate* button and the route returns 403; a role
    without `deliveries.view` cannot generate for a delivery even with `eway_bills.create`.

---

## 5. Out of scope, deliberately

- **A "Return to supplier" document that moves stock** (Q4(b)). If wanted, it gets its own
  requirements doc; this plan only records the number against the vendor issue.
- **The app creating Zoho documents** — delivery challans or invoices for transfers (Q3(b)), challans
  for supplier returns. Staff raise them in Zoho; the app finds them by number.
- **Extend validity, multi-vehicle movement, consolidated e-way bills, transporter master upkeep** —
  rare; done in Zoho's screen. The API supports them (§2.6) if that changes.
- **Pushing typed numbers into Zoho** (`action: "manually_generated"`) so Zoho's books show bills made
  on the portal. Possible later; not asked.
- **Inward e-way bills** (a supplier's bill for goods coming to us — the supplier generates it) and
  **customer reverse pickups** (`Delivery.reversePickup`).
- **E-invoicing (IRN)** for B2B invoices — a turnover question for the CA (§1.3 note) and a separate
  Zoho feature.
- **An e-way bill register page and expiry reminders.** There is no scheduler (CLAUDE.md); a register
  would be a screen with a button, if asked.
- **Reading `Store.gstin` or reinstating GSTIN inputs on `/stores`** — the owner's 9 Sep rule stands;
  Zoho holds the GSTIN of record.
- **Updating a Zoho invoice's shipping address from the app** when generation fails for a missing PIN
  — the fix is made in Zoho.
- **Dropping `TransferOrder.eWayBillNo`** — the release after this one, once nothing reads it.
- **Editing `docs/agents/*`** (L7) — flagged for the owner; not changed by this plan.
