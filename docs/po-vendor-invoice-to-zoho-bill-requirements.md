# PO → vendor invoice → Zoho Bill — requirements, action flow and questions

Written 16 Sep 2026 from the owner's request. This is a **requirements document**, not an
implementation plan. Nothing here has been built. It has seven parts:

1. **The requirements** — the owner's words, verbatim, then each one restated as `R1…Rn`.
2. **The decisions already taken** — `D1…D3`, settled by the owner on 16 Sep 2026.
3. **The action flow** — who does what, step by step, with a worked example.
4. **The questions** — `Q1…Q14`, the doubts this document raised. Six of them block a plan.
5. **Facts verified against the code** — file:line, so a plan starts from the code as it is.
6. **The permission map** — data for the RBAC catalog, never code.
7. **Out of scope** and the **work record**.

Lines marked *Today:* say what the app already does, so the reader can see what is new.

---

## 1. The requirements

### 1.1 The owner's words, verbatim (16 Sep 2026)

> see tell me about this is  my requirement where we have the reorder and the po righr in the po if the po is sent to vendor if the email is sent the nest step is i want to create a invoice in zoho ie for the po the vendor sends a invoice and i need to create a invoice where must be able to create the invoice form my aplication to zoho and the created is fetched from the inbound  and the rest process made the  as same  from the inbound so that fro this fetaure i need to create a invoice in the zoho  what i will  do is  i need u to use the api key of ai where i will attach or upload the invoice file and from that i need u to create me a review and   creation before the creation if invoice in the zoho   tell me can this requirement be implemented analyse the existing code and let me know

### 1.2 Restated

- **R1** — Once a purchase order has been sent to the vendor by email, the next step in the
  flow is recording the document the vendor sends back against that PO.
- **R2** — The vendor's document must be **created in Zoho from this application**. The user
  must not have to key it into Zoho by hand.
- **R3** — The user uploads or attaches the vendor's invoice file (PDF or image).
- **R4** — An AI reads that file, using the API key already configured in the application.
- **R5** — What the AI read is shown to a person as a **review**, *before* anything is
  created in Zoho. Creation happens only after that person accepts it.
- **R6** — Once created in Zoho, the record is **fetched by the existing inbound flow**, and
  everything after that — receiving, put-away, units, bins — stays exactly as it is today.
- **R7** — The feature sits on the PO, connecting reorder → PO → vendor document → inbound.

---

## 2. The decisions already taken (owner, 16 Sep 2026)

- **D1 — the Zoho object is a BILL, not an Invoice.**
  The owner's words say "invoice", which is what the vendor calls the piece of paper. In Zoho
  an *Invoice* is a sales document that lands in `/deliveries` as a `Delivery`; a *Bill* is the
  purchase document that lands in `/inbound` as an `InboundShipment`. R6 requires the inbound
  path, so the object created is a **Bill**. The screen may still say "vendor invoice" to the
  user — that is the word the business uses — but the Zoho call is `POST /bills`.

- **D2 — bill lines are sent matched to Zoho `item_id`.**
  Each line must resolve to a `Product` carrying a `zohoItemId`, so Zoho Inventory records the
  stock movement and item history. An unmatched line blocks acceptance until a person picks the
  product. *Verified viable:* all **5,745** products currently have a `zohoItemId`, and 5,583
  of them have an HSN code.

- **D3 — the PO loop is closed.**
  `VendorBill.purchaseOrderId` is stamped, `PurchaseOrderItem.receivedQty` is incremented as
  lines are received, and the PO advances to `PARTIALLY_RECEIVED` / `RECEIVED`.
  *Today:* none of this happens — a PO stays at `SENT_TO_VENDOR` forever.

---

## 3. The action flow

1. A PO reaches `SENT_TO_VENDOR` (by email via `POST /api/purchase-orders/[id]/send`, or by
   WhatsApp/manual via `mark-sent`). *Today: this already works.*
2. The vendor emails or hands over their invoice. A user with the right grant opens the PO and
   presses **Upload vendor invoice**.
3. The file is stored (PDF or image). A proposals row is created with status `RUNNING`.
4. The AI is called with the file attached, and returns structured lines: vendor, invoice
   number, invoice date, and per line — description, quantity, rate, tax %, HSN.
5. The proposals are validated and saved. Status becomes `DONE`.
6. **The review screen** shows the extracted lines **beside the PO's own lines**, with:
   - a product match per line (auto-matched where possible, a picker where not — D2),
   - a quantity comparison against the PO,
   - an arithmetic tie-out: do the lines add up to the invoice total the document claims?
   - every field editable, because a mis-read is normal and must be fixable here.
7. The person accepts. **One route** then: re-validates, claims the row, calls `POST /bills`
   on Zoho, stores the returned `bill_id`, and stamps `VendorBill.purchaseOrderId` (D3).
8. The bill is pulled back in through the **existing** `/inbound` bill-fetch flow, which
   creates the `InboundShipment` and its line items. *No new inbound code.*
9. Receiving, put-away, units and bins proceed unchanged (R6). As lines are received,
   `receivedQty` rises and the PO advances (D3).

### Worked example

PO-0007 is sent to Hero Cycles for 20 units of three SKUs. Hero emails invoice `HC/4471` for
18 units — two were short. The user uploads the PDF. The AI reads 3 lines; two match by SKU
automatically, one ("HERO SPRINT PRO 26T BLK") needs a pick. The review shows line 3 as
**18 invoiced vs 20 ordered**. The user accepts. A Zoho Bill is created with 3 item-matched
lines. On `/inbound` the user clicks Fetch bills; `IB-202609-0004` appears against Hero.
Receiving 18 units moves PO-0007 to `PARTIALLY_RECEIVED`; the 2-unit shortfall is a vendor
issue, not a smaller receipt (the existing rule at `api/inbound/[id]/route.ts:178-183`).

---

## 4. The questions

**Blocking — a plan cannot be written without these: Q1, Q2, Q5, Q6, Q10, Q12.**

- **Q1 (blocking)** — **How do vendors get a Zoho contact id?** `Vendor` has no Zoho column and
  all 83 vendors are reconciled by name today. Options: a one-time bulk match against
  `listAllContacts` with a manual picker for misses; or map on demand the first time a vendor's
  bill is pushed. *Recommended:* bulk match once, picker for the remainder.
- **Q2 (blocking)** — **What does your Zoho org require on a bill?** Specifically `place_of_supply`,
  and whether GST must be sent as `tax_id` (a Zoho tax record) rather than the `tax_percentage`
  the code sends today. Also: **which store's GSTIN is the bill raised against?** Every store has
  its own GSTIN and a PO's header is the primary store. This needs one live test call to answer
  properly.
- **Q3** — An invoice line that is **not on the PO** at all (vendor shipped an extra item):
  block, or allow it through with a flag on the review?
- **Q4** — Invoice quantity **greater** than the PO quantity: block, warn, or accept?
- **Q5 (blocking)** — **How are the vendor's item descriptions matched to our products?** The
  vendor writes their own names, not BCH SKUs. By SKU when present, then fuzzy name, then a
  manual picker? Is there a per-vendor alias worth remembering for next time?
  (`BrandSkuMapping` already exists — is it the right home?)
- **Q6 (blocking)** — **After the Zoho bill is created, does the app auto-pull that one bill**
  to create the inbound shipment, or does the user click Fetch bills on `/inbound` themselves?
  *Recommended:* auto-pull the single bill through the existing importer, so the shipment is
  waiting when they get there. Note there are no scheduled jobs in this app, so this would run
  inside the accept request, not on a timer.
- **Q7** — Where should the uploaded invoice file live? A new `vendor-invoices/` prefix in
  `upload-policy.ts`, or stored server-side like the ledger and PO-quotation paths do (both of
  which bypass the allowlist)? Should the file stay attached to the `VendorBill` for later?
- **Q8** — **Can a bill be created with no PO behind it?** A vendor invoice sometimes arrives
  with no purchase order. Strictly PO-first, or is there a standalone entry point?
- **Q9** — If **Zoho rejects** the create (duplicate bill number, bad tax id, unknown vendor):
  keep the proposals and let them retry after fixing, or fail the whole run?
- **Q10 (blocking)** — **One PO, several invoices.** A vendor part-ships and invoices twice.
  Is that supported from day one? It decides whether the proposals row is one-per-PO or many.
- **Q11** — Freight, insurance, rounding and discount lines on the vendor's invoice — these
  are not products and have no `zohoItemId`. How should they be represented (D2 says every line
  must match an item)?
- **Q12 (blocking)** — **Should the invoice's prices backfill the PO?** `PurchaseOrderItem`
  still has `unitPrice`/`gstRate`/`amount` columns, all written 0 since the 15 Sep change. The
  invoice is the first time a price exists. Leave them 0, or fill them in from the invoice?
- **Q13** — Should the review warn when the invoice **rate** differs sharply from the product's
  stored `costPrice`? There is a `/api/stock/price-check` route that already reasons about this.
- **Q14** — Who may do what — see §6. Is the split below right?

---

## 5. Facts verified against the code (16 Sep 2026)

**The Zoho write layer exists and is reachable.**
- `BooksClient.createBill` — `src/lib/integrations/books.ts:179-201`. Sends `vendor_name`
  (a string), `bill_number`, `date`, `due_date`, `gst_treatment: "business_gst"`, and lines of
  `name / quantity / rate / tax_percentage / hsn_or_sac`.
- **It sends no `item_id`** — D2 requires adding one. It also sends **no `place_of_supply`**
  and **no `tax_id`**; a grep across `src/` finds zero occurrences of either (Q2).
- **It identifies the vendor by name, not id** (`books.ts:186`), and Zoho's bill-create wants
  a `vendor_id`. `Vendor` (`schema.prisma:1000`) carries no Zoho column (Q1).
- Auth, refresh, org id and 401/429 retry all work — `src/lib/integrations/base.ts:153-330`.
  Credentials live in `IntegrationConfig` (`schema.prisma:1369`), not env. India DC.
- ⚠ **`createBill` has probably never succeeded.** Its own caller's comment
  (`src/lib/inbound/complete-shipment.ts:181-183`) records that it used to run without `init()`,
  threw every time, and was swallowed by a best-effort catch. It is wired correctly now but is
  untested against live Zoho. **Step one of any build is proving it with one real bill.**
- ⚠ **A latent bug not to copy:** `complete-shipment.ts:196` passes `vendorName: snapshot.brandName`
  — a *brand* name where Zoho wants a *vendor*. Brand and Vendor are separate tables.

**The duplicate-bill risk is already guarded.** `complete-shipment.ts:172-178` skips the Zoho
push entirely when `zohoBillId` is set, and the bill importer stamps that field
(`api/zoho/pull-review/approve/route.ts:514`). A bill created by this feature therefore flows
back in and the shipment-completion push correctly stands down.

**The inbound side needs no new code.** The only live `inboundShipment.create` is
`api/zoho/pull-review/approve/route.ts:503-536`, fed by Fetch bills on `(dashboard)/inbound/page.tsx:198`.
It creates the `VendorBill` (:440) and the shipment with `vendorBillId` and `zohoBillId`.
*Today:* it never sets `VendorBill.purchaseOrderId` (D3).

**Receiving.** `api/inbound/[id]/route.ts:149-185` receives one line, requires `approvedAt`,
and refuses a partial quantity — "receive the full billed quantity; for a short delivery use
Report Issue" (:178-183). The shipment claims its own `DELIVERED` transition in
`finaliseDelivered` (`complete-shipment.ts:54-120`). *Today:* nothing increments
`PurchaseOrderItem.receivedQty` (D3).

**The PO state machine already allows the closing moves.** `PO_TRANSITIONS` at
`src/lib/purchase-orders/status.ts:49` — `SENT_TO_VENDOR → PARTIALLY_RECEIVED | RECEIVED`, and
`:50` → `RECEIVED`. **No state-machine change is needed for D3.** Note `PUT /api/purchase-orders/[id]`
explicitly refuses `APPROVED` and `SENT_TO_VENDOR` before consulting the table, but not the
received states.

**The AI layer does exactly what R4 asks.** `runAi()` — `src/lib/ai/index.ts:212`. Key read
from the `AiProvider` table (`schema.prisma:1440`), not env, after a one-time env bootstrap
(`index.ts:72-95`). PDF and image attachments supported on all three providers
(`src/lib/ai/models.ts:33-79`); pre-flight refusal for unsupported kinds at `index.ts:144-160`.
Spend is logged to `AiCallLog` (`schema.prisma:1462`). Prompt-injection hardening is a house
rule worth following: constant system prompt, user text inserted as delimited data, sanitised
and capped (`src/lib/po-extraction/prompts.ts:18-46`).

**The review-before-commit pattern is well established.** The closest template is the vendor
ledger statement reader — `LedgerAiRun` (`schema.prisma:3215-3246`: `reply` raw, `proposals`
validated, status `RUNNING|DONE|FAILED|ACCEPTED|DISCARDED`), its review card
(`(dashboard)/ledger/[id]/_components/review-card.tsx`), and the single writer
`api/ledger/runs/[id]/accept/route.ts` — which claims the run inside the transaction with a
conditional `updateMany` (`:29-35`) and refuses with 409 when the tie-out fails (`:127-136`).
**This feature should copy that shape closely.**

**Storage.** S3 or local (`src/lib/storage/index.ts:94`), not Supabase. `ALLOWED_PREFIXES` at
`src/lib/storage/upload-policy.ts:10-27` has no vendor-invoice entry (Q7); `transfers/` and
`ledger/` already accept `application/pdf` (`:61-76`). 100 MB cap (`:30`). Note the content-type
refusal message is hardcoded to "transfer documents" (`:90`) — adding a prefix should fix that.

**Scale, as of today, on the local database:** 5,745 products (all with `zohoItemId`),
83 vendors, 19 vendor bills, 19 inbound shipments, 2 purchase orders.

---

## 6. The permission map (data for the RBAC catalog, never code)

*Today:* `purchase_orders` has `view, create, edit, delete, approve`
(`prisma/rbac-catalog.ts:288-296`); `inbound` has the same set (`:151-160`); `zoho` also has a
`fetch` action (`:847-859`). Proposed, for Q14:

| Step | Grant |
|---|---|
| Upload the vendor invoice, run the AI, edit the review | `purchase_orders.edit` |
| Accept the review and push the Bill to Zoho | `purchase_orders.approve` — it writes to someone else's accounting system and cannot be undone from here |
| Fetch the bill back / import it | `zoho.fetch` + `inbound.create`, unchanged |

Adding an action is a catalog change applied by `npm run db:seed:rbac` after deploy, not a
migration. No role name appears anywhere in this design.

---

## 7. Out of scope, and the work record

**Out of scope**
- **Zoho Purchase Orders.** Not integrated anywhere today — no `/purchaseorders` call exists.
  The Zoho Bill will carry the internal PO number as `reference_number`, not a Zoho PO link.
- Vendor payments and settlement against the created bill.
- Any scheduled or background pulling. This application has no cron jobs and none will be added.
- Changing how `/inbound` receives, puts away, or makes units (R6 requires it stay identical).

**Work record**
- *16 Sep 2026* — Requirement given by the owner. Existing code analysed across the Zoho
  integration, the PO and inbound flows, and the AI and upload layers. Feasibility confirmed.
  D1, D2 and D3 settled by the owner. Q1–Q14 raised; six of them block.
- **Waiting on:** the owner's answers to the six blocking questions, and one live Zoho test
  call to settle Q2.
- **Next:** once the doubts are closed, a `*-plan.md` that opens with the requirement.
- **Nothing has been built.**
