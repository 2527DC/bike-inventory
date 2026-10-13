# Credit notes come from Zoho, the supplier ledger splits by store, and /bills gets a "pay these first" list

Status: in-progress — all nine parts built 13 Oct 2026 on `feat/1210-credit-notes-and-payables` (§7); `tsc`, `eslint`, `npm run build` pass; a 36-check end-to-end run against the local database passed. Not yet on `test`: migrations M1 and M2 must be applied to the test database first. Credit-note pulls wait for Zoho Books to be reconnected with `ZohoBooks.debitnotes.READ` and `ZohoBooks.creditnotes.READ`. The browser pass is the owner's.
Branch: **`feat/1210-credit-notes-and-payables`** — create it with exactly this name, off `test` (feature → `test` → `main`; CLAUDE.md "Branches and deployments").

Every `file:line` below was read from disk on 12 Oct 2026 (branch `fix/1210-push-integrations-same-db-check`, tip `d878426`). Zoho API facts come from Zoho's public API documentation and are cited by URL; nothing in this plan called Zoho or touched a database. Check rather than trust.

This plan owns two things siblings depend on: **`VendorBill.zohoBillId`** (Part 1 — plan C cannot push a payment against, or approve, a bill without it) and **the pull-pipeline extension** for credit notes (Parts 3 and 8 — plan E displays the customer credit notes this plan pulls).

---

## 0. Requirement

### 0.1 The owner's words, verbatim (8 Oct 2026)

> 1. credit note section for the vendors.

> 3. can we pull credit and debit note from Zoho.

> 18. Maintaining ledger sheets for over 70+ suppliers across BCH and BCC.

> 19. Calculating Cash Discounts (CD), credit note adjustments, and preparing priority lists for overdue supplier payments (>30 / >45 days).

Points 1, 3, 18 and 19 of the 28-point list quoted in `docs/implementation/requiremnts/accounts-and-compliance-feature-map.md` §1.1. The answers given in session on 12 Oct 2026 sharpen them (§1.1 below); they do not replace them.

### 0.2 Restated as requirements

| # | Requirement | Map | Part |
|---|---|---|---|
| R1 | Each vendor has a credit-note section that lists its credit notes with the amount still unused and the bills each one was applied to. | map R1 | 4 |
| R2 | Credit notes are not typed into this app. They are typed in Zoho Books and arrive here by a pull (D3). | map R1, R3 | 3, 4 |
| R3 | Pull **vendor credits** (the purchase side — what a supplier owes us back) from Zoho Books into `VendorCredit`. | map R3, D4 | 3 |
| R4 | Pull **customer credit notes** (the sales side — what we owe a customer back) from Zoho Books into a new table. | map R3, D4 | 8 |
| R5 | Pulling again is safe: the same Zoho note never becomes two rows, and a note that was changed, applied or voided in Zoho is updated here. | map R3 | 3, 8 |
| R6 | Every vendor bill imported from Zoho carries Zoho's bill id; bills already in the app get it by a checked backfill (dry run first). | prerequisite of map R2, R3, R10 | 1 |
| R7 | A ledger per supplier — opening balance, every bill, payment and credit note, running balance — correct over the supplier's whole history, not a capped window. | map R18 | 6 |
| R8 | On the ledger a credit note reduces the balance on the day it was received; applying it to a bill later only links the two and is never subtracted a second time (D9). | map R18 | 6 |
| R9 | Bills, payments and credit notes each belong to a store — BCH (Bharath Cycle Hub) or BCC (Bharath Cycle Centre) — through the `Store` table, and the ledger can be shown per store (D1). | map R18 | 2, 6 |
| R10 | For each unpaid bill, the cash-discount deadline and the cash-discount amount. | map R19 | 7 |
| R11 | Credit-note adjustments: beside what is owed to each supplier, the credit that supplier has given us and we have not used yet. | map R19 | 4, 7 |
| R12 | A priority list of unpaid supplier bills showing days since the bill date **and** days past the due date, with the owner's >30 and >45 cuts, sorted so the bills to pay first are at the top (D8). | map R19 | 7 |
| R13 | A vendor payment recorded here is checked against the right vendor, the right store and the bill's real remaining amount, even when two people record payments at once. | supports map R18 | 5 |

### 0.3 Words used in this plan

- **Vendor credit** — Zoho Books' name for a supplier's credit note: "we owe you ₹X" (goods returned, short supply, a discount). Zoho's permission for it is still called `debitnotes`, because from our side it is the *debit note* we raise against the supplier. So the owner's "credit and debit note" is: vendor credits (purchase side) plus customer credit notes (sales side) — D4.
- **Customer credit note** — the mirror on the sales side: a note *we* give a customer (a return, a price correction) that reduces what they owe us.
- **Applying a credit** — using some or all of a credit note against one particular bill, so that bill needs less cash. In Zoho this is "Apply to bills".
- **Open credit** — the part of a credit note not yet applied or refunded. Zoho calls it `balance`.
- **Refund of a credit** — the supplier pays the credit back in cash instead of letting us apply it.
- **Cash discount (CD)** — a percentage the supplier knocks off if we pay within N days of the bill date. Terms live on the vendor (`Vendor.cdTermsDays`, `cdPercentage`).
- **Ledger / running balance** — a dated list of everything that changed what we owe one supplier, with the balance after each line.
- **Days since bill date vs days past due** — a bill dated 1 Sep with 30-day terms is, on 15 Oct, 44 days old and 14 days past due. D8 shows both.
- **Zoho location** — Zoho Books' way of keeping two GST registrations in one organisation; every bill carries a `location_id` when the feature is on.

---

## 1. Questions and clarifications — answer before build

### 1.1 Decisions on record

Answered in session, 12 Oct 2026.

| # | Decision | What it does to this plan |
|---|---|---|
| D1 | Link records to the existing `Store` table (rows `BCH_STORE` / `BCC_STORE`, each with its GSTIN) via a `storeId` foreign key. Do not add more `"HUB"`/`"CENTRE"` strings. `VendorBill.billedTo` is the existing free-text column. | `storeId` on `VendorBill`, `VendorPayment`, `VendorCredit` and the new `CustomerCreditNote` (Part 2). `billedTo` is kept one release and no longer read (rule 7). |
| D2 | One Zoho Books organisation for both stores. | One `IntegrationConfig` row; the store comes from the Zoho location or a person, never from a second org (Part 2). |
| D3 | Credit notes are typed in Zoho first and pulled here. The app does not create credit notes manually. | No create form; `POST /api/credits` is removed (Part 4, Q3). |
| D4 | R3 pulls both vendor credits (purchase side) and customer credit notes (sales side). | Parts 3 and 8. |
| D8 | The overdue supplier list shows both days since bill date and days past due date (the owner's >30 / >45 cuts). | Part 7. |
| D9 | A credit note reduces the supplier balance on the day it is received; applying it to a bill later only links it — never subtracted twice. | Part 6's ledger rules. |
| D10 | Zoho bill approval is switched on (bills sit as draft / pending approval). | Context only: approval is plan C's. This plan stamps `zohoBillId` on every imported bill whatever its Zoho status. |
| D11 | Vendor payment → Zoho by an explicit "Push to Zoho" button after save; a Zoho failure never blocks saving. | Plan C's. Q1 = (b) (13 Oct): applying a credit here is **not** pushed to Zoho. |
| D16 | Bank statements and suspense lines get their own permission module, separate from `bills`. | Plan D owns `api/bank-statements/*`, so finding L3 and the store stamp on bank-confirmed payments are plan D's edits (§3 dependencies). |

Answered 13 Oct 2026, in session.

| # | Decision | What it does to this plan |
|---|---|---|
| **Q1 = (b)** | Credit notes are **applied to bills in this app**, and Zoho is not told. Asked to choose between "apply here, push to Zoho", "apply here only" and "apply in Zoho only", the owner chose **"Apply here only"**. | Re-issues Parts 3.4, 4, 5 and 7.3 (marked "13 Oct"). **Known consequence, accepted:** a credit applied here stays open in Zoho, and the bill stays unpaid there by that amount. Zoho and the app disagree for that credit until someone applies it in Zoho too. The accounting-consultant flags this (§3 Board of agents). This plan makes **no Zoho write** (§6). |
| D17 | A credit **also** applied in Zoho is honoured: the pull records Zoho's application and settles the bill here too. A credit applied for more than its total, across both places together, is flagged in red and never hidden. | Part 3.4: every application carries a `source` (`ZOHO` / `APP`), and a pull prunes only `ZOHO` rows. Part 4: the over-applied flag. |
| D18 | **Apply credit** is on `/bills/[id]` and on each open credit on the vendor's Credits tab. The amount is capped at the smaller of the credit's open amount and the bill's remaining amount. It is **not a payment**: no `VendorPayment` row is written. | Part 4 (new routes). Part 5: `creditId` and `CREDIT_ADJUSTMENT` leave the payment route. Part 6: D9 unchanged. |
| D19 | Applying needs `bills.create`, the permission that already records a payment. A mistaken application can be **removed** by `bills.edit`. Removing reopens the bill and the credit by exactly that amount, and the activity log records who did it. Only applications made here can be removed here; Zoho's are removed in Zoho. | RBAC table; Part 4. |
| Q2 | Check Zoho first: the Phase 0 read-only calls show whether Zoho bills carry a `location_id`. | Build (a) and the import picker (c), as recommended. The backfill rule for existing bills waits for Phase 0's answer. |
| Q4 = (a) | A cash discount arrives as a supplier CD credit note. | No CD field on `/payments/new`. |
| Q9 = (a) | Advances are allowed, with the store picked by hand. One payment pays one store's bills. | Part 5 as written. |
| Q3, Q5–Q8, Q10–Q15 | Not answered one by one. On 13 Oct the owner was told the recommended default is used unless they say otherwise, and did not object. | Built on the "Recommended default" column. |

### 1.2 Open questions

| # | Question | Why it changes the build | Options | Recommended default | Blocks | **Answer** |
|---|---|---|---|---|---|---|
| **Q1** | **Where is a credit note applied to a bill — in Zoho Books, or here?** | Today the only "apply" is a `CREDIT_ADJUSTMENT` payment here (`api/payments/route.ts:71-78, 135-144`) and Zoho never hears of it. Zoho then keeps the vendor credit open and the bill unpaid by that amount, so the two books disagree for ever — against "Zoho is the source of truth for financials" (`docs/agents/accounting-consultant.md`, Integration Notes). The answer decides whether `/payments/new` gets an "Apply credit" choice, whether `POST /api/payments` keeps `creditId`, and whether this plan writes to Zoho at all. | **(a)** In Zoho ("Apply to bills" on the vendor credit). The pull brings back each application (`bills_credited`) and the bill's remaining amount here drops by it. The app never applies. **(b)** Here only, as today. **(c)** Here, then pushed to Zoho with `POST /vendorcredits/{id}/bills` (`bills: [{ bill_id, amount_applied }]`), under plan C's "Push to Zoho" rule. | **(a).** The credit note is already typed in Zoho (D3); applying it is one more click on the same Zoho screen. No Zoho write, no second copy of the truth, nothing to reconcile. (b) is rejected — it is the defect. (c) is a later add-on to plan C if the accountant wants to apply from here. | **Parts 3–6** | **(b)** apply here — 13 Oct (§1.1) |
| **Q2** | **Which store does a supplier bill belong to, and how do we know?** On 4 Sep you said **BCH buys for both stores** (`0409-unified-purchasing-transfers-cleanup-plan.md`, O9). Do some suppliers bill **BCC directly**, under BCC's GSTIN? And does your Zoho Books use **Locations** (Hub and Centre as two locations)? | `billedTo` has never been written by any code (§2.5), so there is nothing to backfill from. The store must come from Zoho's `location_id` on each bill, from a person, or from a default. | **(a)** Zoho uses Locations → link each store to its Zoho location once on `/stores`; every bill and credit takes its store from Zoho. **(b)** No Locations, all bills are BCH's → every bill defaults to BCH Store; a person changes the odd BCC bill. **(c)** No Locations, mixed → the importer picks the store in the `/bills` import panel; old bills stay "Store not set" until someone sets them. | Build (a) **and** the picker in (c); the Phase 0 dry run (§3, Part 1.4) shows whether Zoho bills carry a `location_id`. For the **backfill of existing bills**: use (a) where Zoho has a location; otherwise BCH Store **only if you confirm (b)**. | Store backfill only (Part 2.5) | Phase 0 first — 13 Oct |
| Q3 | `POST /api/credits` has no caller anywhere in `src/` (F3). With D3, keep it or remove it? | A live create route contradicts D3 and invites a second, un-Zoho'd copy of a credit note. | (a) Delete the whole route file (GET has no caller either); (b) keep GET, delete POST; (c) keep both | (a) — the new `GET /api/vendors/[id]/credits` (Part 4) replaces the read | — | default (a) |
| Q4 | **How does a cash discount reach Zoho today?** (a) The supplier sends a CD credit note, which you type in Zoho as a vendor credit; (b) you short-pay and record the discount on the payment; (c) a journal entry. | If (a), the app must **not** also record `cdDiscountAmount` on the payment — the CD would be subtracted twice: once on the payment, once by the pulled credit note. If (b), `/payments/new` needs a "CD taken" field it does not have today (§2.3) and plan C must carry the discount to Zoho. | (a), (b), (c) | **(a)** — the usual pattern with brands; no CD input is added to `/payments/new`; the priority list shows what CD to claim; the ledger flags any bill that ends up over-settled. | Part 5's CD field only | **(a)** — 13 Oct |
| Q5 | **Which due date counts?** The API uses the stored `VendorBill.dueDate` (Zoho's due date, or bill date + vendor terms when Zoho's is blank — `approve/route.ts:434-440`); four screens recompute bill date + the vendor's *current* `paymentTermDays` instead (§2.7). | Decides "days past due" and every OVERDUE badge. Today the aging cards and the badges under them can disagree. | (a) Stored `dueDate` everywhere; (b) bill date + current vendor terms everywhere | (a) — it is what the supplier's invoice says, and changing a vendor's terms should not silently re-age old bills | — | default (a) |
| Q6 | The **>30 / >45 cuts** — on days since bill date, or days past due? | Decides what the two filter chips select. D8 shows both numbers either way. | (a) days since bill date; (b) days past due; (c) a chip for each | (a) for the chips (supplier terms run from the invoice date); days past due drives the sort | — | default (a) |
| Q7 | **What goes to the top of the priority list?** | The sort is the feature. | See Part 7.3 for the tiers | Claimable CD first (soonest deadline), then past due >45, 31–45, 1–30, then due within 7 days, then the rest by due date. Disputed bills listed apart as "on hold". | — | default |
| Q8 | **Opening balance per store.** `Vendor.openingBalance` (as of 1 Apr 2026) is one number per supplier, not split by store. | A per-store ledger needs a per-store opening figure or none. | (a) Opening shown only on the all-stores view; a store view starts at 0 with a note; (b) add a per-store opening balance (new table) | (a) | — | default (a) |
| Q9 | **Advance payments and mixed-store payments.** `/payments/new` says "No bills selected — payment will be recorded as advance" (`payments/new/page.tsx:398`) but the API refuses exactly that (`api/payments/route.ts:53-55`). And one payment can today cover bills of both stores. | Decides the payment rules in Part 5. | (a) Allow an advance (no bill) with the store picked by hand; refuse one payment across two stores; (b) keep refusing advances | (a) | — | **(a)** — 13 Oct |
| Q10 | **Draft notes in Zoho.** Vendor credits and customer credit notes can be `draft`. | Whether a draft appears here. | (a) Skip drafts until opened in Zoho; (b) import them marked draft | (a) — a draft is not yet in Zoho's books either | — | default (a) |
| Q11 | **Customer credit notes: which customer and which store?** Zoho sends a Zoho customer id and name; the app's `Customer` has no Zoho id and is identified by phone. | Decides the link columns on the new table. | (a) Take the customer and store from the invoice the note credits (`Delivery` / `CustomerInvoice` by invoice number); else keep the Zoho name only; (b) add `Customer.zohoCustomerId` and match by it | (a) — no change to `Customer`; plan E can add (b) later | — | default (a) |
| Q12 | **Customer credit notes are typed in Zoho Books, or in Zakya POS?** Sales invoices are fetched from Zakya first, Books second (`trigger-pull/route.ts:415-422`). | Which client the sales-side pull calls. | (a) Books; (b) Zakya; (c) both | (a) — Books is the accounting system and D2 names one Books organisation | — | default (a) |
| Q13 | **Link a shortage or damage issue to the credit note that settles it?** | Adds one nullable column and a picker (Part 9). | (a) Yes — a person picks the credit note on the issue; never automatic; (b) leave out | (a) | — | default (a) |
| Q14 | **Rows typed before this plan.** Any `VendorCredit` created through the API, and any `CREDIT_ADJUSTMENT` payment. | Decides the one-time handling; counts come from Phase 0. | (a) At the first pull, link a manual credit to its Zoho twin by vendor + number; a `CREDIT_ADJUSTMENT` payment that names a credit is shown on the ledger as a link only; one that names no credit stays a payment line; (b) delete them | (a); if Phase 0 counts zero, nothing to do | — | default (a) |
| Q15 | **CD base.** Today CD = bill total × % (`cd-eligibility/route.ts:58`), i.e. GST included. | Changes every CD amount. | (a) Keep; (b) on the taxable value | (a) — keep, and confirm with the CA (see the GST check in §3) | — | default (a) |

---

## 2. How it works today — verified against the code

### 2.1 The three payables tables

| Model | Where | What it holds | Written by |
|---|---|---|---|
| `VendorBill` | `prisma/schema.prisma:1291-1321` | `amount`, `paidAmount`, `status` (`BillStatus` `:152-158`), `billDate`, `dueDate`, `billedTo String? // "HUB" or "CENTRE"` (`:1307`); `@@unique([vendorId, billNo])` (`:1317`). **No Zoho bill id** (F7). | `api/zoho/pull-review/approve/route.ts:442-452` (both `/bills` and `/inbound` imports), `api/bills/route.ts:110` (manual), `api/payments/route.ts:109`, `api/bank-statements/[id]/review/route.ts:167`, `api/bills/[id]/route.ts:51`, `bills/[id]/follow-up/route.ts:16`; deleted by `api/zoho/trigger-pull/route.ts:311`, `api/inbound/[id]/route.ts:602`, `api/inventory/cleanup/route.ts:86` |
| `VendorPayment` | `:1323-1346` | `amount`, `cdDiscountAmount Float @default(0)` (`:1330`), `paymentMode`, `creditId` (`:1335`). No store. | `api/payments/route.ts:84, 117`, `api/bank-statements/[id]/review/route.ts:97, 156` |
| `VendorCredit` | `:1348-1366` | `creditNoteNo`, `amount`, `usedAmount`, `reason`, `creditDate`; `@@unique([vendorId, creditNoteNo])` (`:1364`). No Zoho id, no status, no store. | `api/credits/route.ts:42` only; `usedAmount` by `api/payments/route.ts:139` |

All money columns here are `Float`. `docs/agents/database-architect.md` calls that a known defect and forbids adding another; every new money column in §3 is `Decimal(12, 2)`.

`InboundShipment.zohoBillId String?` (`:2457`) is the only place a Zoho bill id is kept, stamped at `approve/route.ts:516`. A bill imported from `/bills` has no shipment, so it has no Zoho id anywhere.

### 2.2 Credit notes today (F3)

- `POST /api/credits` (`api/credits/route.ts:36-59`) creates a `VendorCredit`; `GET` (`:9-34`) lists them. `grep -rn "api/credits" src` returns **nothing** — neither is called by any screen.
- The vendor page's **Credits** tab (`vendors/[id]/page.tsx:508-527`) lists `vendor.credits` with `Used:` — fed by `GET /api/vendors/[id]`, which includes only the **10 most recent** credits and bills (`api/vendors/[id]/route.ts:23-24`). The tab labels count those 10 (`page.tsx:119-120`), and the page's "outstanding" sums those 10 bills (`:110-112`).
- `/payments/new` offers modes `CASH, CHEQUE, NEFT, RTGS, UPI` (`payments/new/page.tsx:13`) — no `CREDIT_ADJUSTMENT`, and its body (`:244-256`) sends no `creditId` and no `cdDiscountAmount`. A credit note can be neither entered nor used from the browser.
- The brand ledger can already match a statement row to a `VendorCredit` (`api/ledger/entries/[id]/review/route.ts:39, 72`). Pulled credits will give it something to match.

### 2.3 Recording a vendor payment — `api/payments/route.ts` (F4)

| Line | What happens | Defect |
|---|---|---|
| `:9-38` | `GET`: `bills.view`; catch returns 500 for everything | An auth failure answers 500; nothing is logged |
| `:53-55` | refuses a payment with no bill and no credit | `/payments/new:398` tells the user this records an advance |
| `:61-68` | reads each bill and checks `alloc.amount ≤ amount − paidAmount + 0.01` | **the bill's vendor is never compared with the payment's vendor**; the check ignores CD, but the write at `:107` adds `alloc.amount + allocCd` — a bill can be over-settled by its CD |
| `:71-78` | reads the credit and checks `data.amount ≤ amount − usedAmount` | **the credit's vendor is never compared with the payment's vendor** (F4); a credit can pay another supplier's bill |
| `:104-113` | `findUnique` then `update { paidAmount: bill.paidAmount + … }` | **read-then-write**: two payments at once both read the old `paidAmount`; one increment is lost |
| `:135-144` | the same read-then-write on `usedAmount` | the same lost update on the credit |
| validations `:597-612` | `creditId` optional, `paymentMode` any of six | **nothing ties `creditId` to `CREDIT_ADJUSTMENT`**: a cash payment can consume a credit, and a credit adjustment can name no credit |
| `:150-153` | catch returns 400 | **no logger in the file**; the catch logs nothing |

### 2.4 The supplier ledger — `api/vendors/[id]/ledger/route.ts` (F5, L14)

- Reads **bills and payments only** (`:20-40`), `take: 50` each, newest first. `VendorCredit` is never read, so a credit note never reaches the ledger (F5).
- Sorts the ≤100 rows **ascending** (`:82`) and runs the balance forward from `vendor.openingBalance` (`:85-89`). For a supplier with more than 50 bills or 50 payments, the starting point is wrong (L14, `docs/ledger-and-reconciliation-flow.md` §8.1).
- `currentBalance` (`:94`) is opening + the **capped** totals — also wrong past 50 rows.
- Returns `withBalance.slice(0, 20)` (`:102`) — the **oldest** 20 of that window, which `/accounts/vendor-ledger` labels "Showing latest 20 of N transactions" (`accounts/vendor-ledger/page.tsx:232`).
- A `CREDIT_ADJUSTMENT` payment is a payment line (`:69-79`). Once credit notes are on the ledger, the same credit would be subtracted twice — the case D9 forbids.
- No logger; the catch logs nothing (`:105-108`). Both screens that read it — the vendor page's Ledger tab (`vendors/[id]/page.tsx:73`, `:554-600`) and `/accounts/vendor-ledger` (raw `fetch` at `:67`, `:80`) — show a single Debit column.

**Three different "what do we owe this supplier" numbers exist today:**

| Where | Formula |
|---|---|
| `/vendors` list, `api/vendors/route.ts:49-53` | Σ (amount − paidAmount) over bills not PAID — no opening, no credits |
| `/bills/[id]` header, `api/bills/[id]/route.ts:23-31` | opening + Σ all bills − Σ all payments − Σ CD — no credits |
| ledger, `api/vendors/[id]/ledger/route.ts:94` | opening + Σ (≤50 bills) − Σ (≤50 payments + CD) |

### 2.5 Hub and Centre today (D1)

- **`billedTo` has never had a writer.** It arrived in `c2e4891` (22 Apr 2026, "Multi-bill payments with FIFO…") together with its filter, and `git log -S billedTo` shows no commit since that writes it. Today it is read at `api/bills/route.ts:21, 54, 68` and `bills/page.tsx:40, 72, 116, 483-491`; nothing in `src/`, `scripts/` or `prisma/` sets it. **Expect it to be null on every row** — Phase 0 confirms with a count. The `/bills` Location filter (Hub / Centre) therefore always returns nothing.
- **Which store is Hub and which is Centre is provable, not a question:** the owner's own point 24 says "Bharath Cycle Hub (Hub) and Bharath Cycle Centre (Centre)"; `trigger-pull/route.ts:484-487` names "Bharath Cycle Centre" as the `BCC/` store; `prisma/seed-stores.ts:34, 43` seeds `BCH_STORE` and `BCC_STORE`; `src/lib/purchase-orders/company.ts:23-24, 60` falls back to the name "Bharath Cycle Hub" for the primary store, `BCH_STORE`. So **HUB → `BCH_STORE`, CENTRE → `BCC_STORE`**.
- `Store` (`schema.prisma:248-300`) has `code` (`:250`), `gstin` (`:258`), and no Zoho link.
- `VendorPayment` and `VendorCredit` have no store at all.

### 2.6 The pull pipeline and the bill import (`docs/data-flow-and-modules.md` §3)

```
POST /api/zoho/trigger-pull { step: "init" }                 -> pullId          (zoho.fetch)
POST /api/zoho/trigger-pull { pullId, step: "bills", window } -> ZohoPullPreview rows
GET  /api/zoho/pull-review?pullId                            -> what would be imported
POST /api/zoho/pull-review/approve { pullId, previewIds }    -> real rows       (zoho.approve)
POST /api/zoho/trigger-pull { step: "finalize", counts }     -> ZohoPullLog
```

- Steps are `init | bills | invoices | finalize` (`validations.ts:1281-1298`). `ZohoPullPreview.entityType` is a free string commented `"contact", "item", "bill", "invoice"` (`schema.prisma:2136`); `action` defaults to `"new"`; `localMatch Json?` exists. `ZohoPullLog` counts `contactsNew`, `itemsNew`, `billsNew`, `invoicesNew` (`:2151-2168`).
- **Bills step** (`trigger-pull/route.ts:246-397`): Books first, Zakya as fallback (`:258-263`). Existing bills are found **by bill number alone, across all vendors** (`:301-305`). Then — the surprising part — **every existing bill with no shipment and no payment is deleted** (`:306-312`, "Auto-cleanup orphaned VendorBills … so they can be re-fetched"). That is every unpaid bill imported from `/bills`: re-fetching a window deletes and re-creates them with new ids, and the relations that point at a bill lose it — `VendorIssue.billId` (`:1912`), `BankTransaction.suggestedBillId`, `BrandLedgerEntry.billId` (`:3239`) are optional relations, so the delete nulls them silently.
- The bill preview (`:354-368`) keeps `vendorId` (plan 2409) but not Zoho's `location_id`.
- **Approve** (`approve/route.ts`): body is a bare cast, no zod (`:89-91`). For each bill it fetches the detail (`:176-193`); checks for an existing shipment **by bill number only** (`:197-200`); resolves the vendor by Zoho id (`:211-216`, `src/lib/vendors/resolve-zoho-vendor.ts:41`); reuses an existing `VendorBill` **by bill number only** (`:220`) — so a second supplier's bill numbered "1024" links to the first supplier's bill; creates the bill with `paidAmount = total − balance` (`:442-452`), which already includes any credit applied in Zoho before the import; and writes **no Zoho bill id and no store**. The loop has no `$transaction` (`docs/data-flow-and-modules.md` §11.2).
- `POST /api/bills` refuses a duplicate bill number across **all** vendors (`api/bills/route.ts:91-92`) while the database only forbids it per vendor (`:1317`).

### 2.7 Cash discount and aging today (R19, F6)

- `GET /api/bills/[id]/cd-eligibility` (`:45-60`): deadline = bill date + `cdTermsDays`; discount = `round(bill.amount × cdPercentage / 100)`; `Math.ceil` on the days.
- `GET /api/bills/aging-summary`: unpaid = status `PENDING` or `PARTIALLY_PAID` only (`:15`), so a bill set to `OVERDUE` by hand (`api/bills/[id]/route.ts:46`) drops out; buckets by days **past due date** — `current`, `days30`, `days60`, and `days90plus`, which actually holds **everything over 60** (`:36-39`, F6), rendered as "60d+" (`bills/page.tsx:421`). Its CD warnings repeat the CD rule with `Math.floor` (`:58-63`) — the two copies can disagree by a day.
- The `/bills` list, `/bills/[id]` and `/vendors/[id]` **do not use `dueDate`**: they recompute bill date + the vendor's current `paymentTermDays` (`bills/page.tsx:508, 513, 518, 529`; `bills/[id]/page.tsx:94`; `vendors/[id]/page.tsx:479`). The `?aging=` filter on `GET /api/bills` (`:24-41`) uses `dueDate`. A bill can sit in the "Current" card while its own row says OVERDUE.
- **`/reports/cd-summary` is always empty.** It filters `/api/vendors?limit=200` on `cdTermsDays && cdPercentage` (`reports/cd-summary/page.tsx:59-65`), but that route's `select` (`api/vendors/route.ts:30-41`) returns neither field. It also fetches bills once per vendor (`:79-81`) and counts every PAID bill as "CD used" (`:112-118`).
- No "credit available" figure exists anywhere, and no single "pay these first" list.

### 2.8 The sales side

- `Customer` (`schema.prisma:1823-1853`) — `phone @unique` is the identity; no Zoho id. `CustomerInvoice` (`:1855-1874`) — `invoiceNo @unique`; no Zoho id. `Delivery` (`:1971`) — `invoiceNo @unique`, `zohoInvoiceId String?` (`:1974`, not unique, not indexed), `customerId` (`:2015`), `storeId`.
- `/receivables` imports Zoho invoices by looping in the **browser**: `POST /api/customers`, then `POST /api/customer-invoices` per invoice (`receivables/page.tsx:198-237`), then calls approve with `entityType: "invoice"` (`:242-247`) — whose invoice branch (`approve/route.ts:559-662`) also creates a `Delivery` per invoice. Plan E's area; recorded here because customer credit notes will be linked to these invoices.

### 2.9 Vendor issues (shortage and damage)

`VendorIssue` (`:1898-1930`) has `billId` (`:1912`), `issueType` (`SHORTAGE`, `DAMAGE`, … `:199-207`) and `status` `OPEN → IN_PROGRESS → RESOLVED → CLOSED` (`:209-214`). Raised from `/inbound/[id]` by `api/inbound/[id]/issues/route.ts` (guard `inbound.edit`, `:94`) with `billId: shipment.vendorBillId` (`:197`); resolved through `PUT /api/vendor-issues/[id]` (`vendor_issues.edit`, `:53`), which stamps `resolvedAt` (`:75-80`). Nothing links an issue to the credit note that later settles it.

### 2.10 What Zoho Books' API offers (read 12 Oct 2026)

| Need | Endpoint | Confirmed fields | Scope | Source |
|---|---|---|---|---|
| List vendor credits | `GET /vendorcredits` | params `date_start`, `date_end`, `status` (`open`, `closed`, `void`, `draft`), `last_modified_time`, `search_text`, `page`, `per_page`; rows `vendor_credit_id`, `vendor_credit_number`, `status`, `reference_number`, `date`, `total`, `balance`, `vendor_id`, `vendor_name`, `last_modified_time` | `ZohoBooks.debitnotes.READ` | https://www.zoho.com/books/api/v3/vendor-credits/ |
| One vendor credit | `GET /vendorcredits/{vendor_credit_id}` | `total`, `balance`, `total_credits_used`, `total_refunded_amount`, `location_id`, `location_name`, `bills_credited[]` (`bill_id`, `vendor_credit_bill_id`, `bill_number`, `date`, `amount`), `vendor_credit_refunds[]` (`vendor_credit_refund_id`, `date`, `amount_bcy`, `refund_mode`, `reference_number`) | same | same |
| Apply / un-apply (only if Q1 = c) | `POST /vendorcredits/{id}/bills` body `{ "bills": [{ "bill_id", "amount_applied" }] }`; `DELETE /vendorcredits/{id}/bills/{vendor_credit_bill_id}` | — | `ZohoBooks.debitnotes.CREATE` | same |
| List customer credit notes | `GET /creditnotes` | params `date_start`, `date_end`, `status`, `last_modified_time`, `customer_id`, `search_text`, `page`, `per_page`; rows `creditnote_id`, `creditnote_number`, `status`, `reference_number`, `date`, `total`, `balance`, `customer_id`, `customer_name`, `location_id`, `location_name`, `last_modified_time` | `ZohoBooks.creditnotes.READ` | https://www.zoho.com/books/api/v3/credit-notes/ |
| One customer credit note | `GET /creditnotes/{creditnote_id}` | `total`, `balance`, `invoices[]` (`invoice_id`, `invoice_number`, `amount`) | same | same |
| Bills — list | `GET /bills` (already used) | list rows carry `location_id`, `location_name`; params include `vendor_id`, `bill_number`, `last_modified_time`, `location_ids` | `ZohoBooks.bills.READ` | https://www.zoho.com/books/api/v3/bills/ |
| Bills — one | `GET /bills/{bill_id}` (already used) | `vendor_credits[]` (`vendor_credit_id`, `vendor_credit_bill_id`, `vendor_credit_number`, `date`, `amount`), `vendor_credits_applied`, `payment_made`, `location_id` | same | same |
| Locations | `GET /locations` | `location_id`, `location_name`, `is_primary`, `status` | `ZohoBooks.settings.READ` | https://www.zoho.com/books/api/v3/locations/ |

**Not confirmed:** the exact `last_modified_time` format Zoho accepts on these two lists (the docs say `YYYY-MM-DDTHH:MM:SS-UTC`; the app's contacts call sends `2026-10-01T00:00:00+0530`, `books.ts:121`) — the first read-only call in Phase 0 settles it. **Not confirmed:** whether the production token was granted `ZohoBooks.fullaccess.all` (`docs/postman/zoho-setup.md:76`) or the read-only set at `:83`, which has no `debitnotes` or `creditnotes` scope — Phase 0 checks.

### 2.11 Live defects found while mapping

| # | Defect | Where | Effect | Fixed in |
|---|---|---|---|---|
| X1 | The bills fetch deletes every existing bill with no shipment and no payment | `trigger-pull/route.ts:306-312` | Re-fetching on `/bills` re-creates unpaid bills with new ids; issue, bank-suggestion and brand-ledger links to them are nulled silently. With credit applications linked to bills, it would also break those. | Part 1.3 |
| X2 | Bills are matched by number alone, across suppliers | `trigger-pull/route.ts:301-305`; `approve/route.ts:197-200, 220`; `api/bills/route.ts:91-92` | Two suppliers' bill "1024" collide: the second is skipped, linked to the wrong supplier's bill, or refused | Part 1.2, 1.3 |
| X3 | `billedTo` has no writer; the Location filter always returns nothing | `bills/page.tsx:483-491`, `api/bills/route.ts:54` | R18's Hub/Centre split does not exist in practice | Part 2 |
| X4 | `/reports/cd-summary` is always empty | `cd-summary/page.tsx:59-65` vs `api/vendors/route.ts:30-41` | CD report shows nothing | Part 7.5 |
| X5 | Overdue computed two ways | §2.7 | Cards and badges disagree | Part 7 (Q5) |
| X6 | Payment guard ignores CD and never checks the bill's vendor; lost update on `paidAmount` | `api/payments/route.ts:61-68, 104-113` | Over-settled bills; a payment can settle another supplier's bill | Part 5 |
| X7 | The payment form promises an advance the API refuses | `payments/new/page.tsx:398`; `api/payments/route.ts:53-55` | A 400 the user was told would not happen | Part 5 (Q9) |
| X8 | Ledger shows the oldest 20 of a capped window as "latest" | `ledger/route.ts:82, 102`; `vendor-ledger/page.tsx:232` | Wrong rows, wrong balance | Part 6 |
| X9 | The vendor page sums and counts only the 10 newest bills and credits | `api/vendors/[id]/route.ts:23-24`; `vendors/[id]/page.tsx:110-112, 119-120` | Under-stated outstanding | Parts 4, 6 |
| X10 | Aging ignores bills set to OVERDUE by hand | `aging-summary/route.ts:15` | They vanish from the payables total | Part 7.4 |
| X11 | Approve body has no zod | `approve/route.ts:89-91` | A wrong `entityType` silently approves nothing | Part 3.4 |
| X12 | Raw `fetch().then(r => r.json())` on screens this plan edits | `bills/page.tsx:97, 125, 224`; `bills/[id]/page.tsx:55, 66`; `payments/new/page.tsx:78, 97-98, 244`; `vendor-ledger/page.tsx:67, 80`; `cd-summary/page.tsx:59, 79` | CLAUDE.md non-negotiable | wherever touched |
| X13 | Bulk bank-confirm still writes `billId: null` (finding L3) | `api/bank-statements/[id]/review/route.ts:99` | Bulk-confirmed bills stay "unpaid" — the priority list would tell the accountant to pay them again | **plan D** (owns this file under D16) |
| X14 | Receivables import also creates a `Delivery` per invoice | `receivables/page.tsx:198-247` + `approve/route.ts:559-662` | Importing receivables conjures deliveries | **plan E** — recorded, not touched |

---

## 3. Implementation plan

Nine parts, two migrations, two pull requests. **No new permission module or action** — every route uses an existing `requireFeature(module, action)`. **No Zoho write**: Q1 = (b) applies credits here and tells Zoho nothing (§6). **No cron, timer or polling.**

| Part | What | Requirement |
|---|---|---|
| 1 | `VendorBill.zohoBillId` — the column, stamped at import, fetch de-duplicated by it, backfill for existing bills | R6 |
| 2 | Store on bills, payments, credits; Zoho location link | R9 |
| 3 | Vendor credit pull | R2, R3, R5 |
| 4 | Credits section on `/vendors/[id]` and `/bills/[id]`; **Apply credit / Remove** (13 Oct, D18–D19); `POST /api/credits` retired | R1, R2, R11 |
| 5 | Payments route made correct (F4) | R13 |
| 6 | Ledger rebuilt (F5, L14, D9) with store filter | R7, R8, R9 |
| 7 | Payment priority list; CD in one place; aging buckets (F6) | R10, R11, R12 |
| 8 | Customer credit note pull | R4, R5 |
| 9 | Vendor issue ↔ credit note, a light link (Q13) | — (closes the R9→R1 loop the map asked for) |

### Part 1 — `VendorBill.zohoBillId` (R6; unblocks plan C)

**1.1 Schema — migration M1 `vendor_bill_zoho_id_and_credit_links`.** Follows plan 2409's `Vendor.zohoVendorId` exactly (nullable, `@unique`, written only by the import).

```prisma
model VendorBill {
  …
  // Zoho Books' bill_id. Written only by the Zoho import and the link backfill (plan 1210
  // Part 1), never by a form. Null for a bill typed on /bills. The unique index is the lookup.
  zohoBillId          String?  @unique
  // Zoho's location_id for the bill, kept raw so the store can be (re)derived (Part 2).
  zohoLocationId      String?
  // INVARIANT: the part of paidAmount that is credit notes applied to this bill — in Zoho
  // (pulled) or here (Apply credit, 13 Oct). Always equals Σ VendorCreditApplication.amount.
  // paidAmount keeps meaning "settled" (payments + CD + credits), so every reader of
  // amount − paidAmount stays correct; this column lets a credit sync move paidAmount by the
  // difference only, never twice (Part 3.4).
  creditAppliedAmount Decimal  @default(0) @db.Decimal(12, 2)
  creditApplications  VendorCreditApplication[]
}

enum CreditApplicationSource { ZOHO APP }   // 13 Oct: pulled from Zoho, or made here (D17, D18)

// One application of one vendor credit to one bill. Source ZOHO: pulled — either side can
// arrive first (a bill imported before its credit, or a credit pulled before its bill), so both
// foreign keys are nullable and filled in when the other side arrives; the Zoho ids are always
// present. Source APP: made here by Apply credit — both foreign keys set, no Zoho ids (Zoho is
// never told, Q1 = b), appliedById names the person. A pull never touches an APP row.
model VendorCreditApplication {
  id                     String        @id @default(cuid())
  source                 CreditApplicationSource @default(ZOHO)
  zohoVendorCreditBillId String?       @unique   // Zoho's id for this application — the de-dup key (ZOHO only)
  zohoVendorCreditId     String?
  zohoBillId             String?
  vendorCreditId         String?
  vendorCredit           VendorCredit? @relation(fields: [vendorCreditId], references: [id], onDelete: SetNull)
  billId                 String?
  bill                   VendorBill?   @relation(fields: [billId], references: [id], onDelete: SetNull)
  amount                 Decimal       @db.Decimal(12, 2)
  appliedDate            DateTime
  appliedById            String?       // APP only — who pressed Apply credit
  appliedBy              User?         @relation(fields: [appliedById], references: [id], onDelete: SetNull)
  note                   String?
  createdAt              DateTime      @default(now())
  updatedAt              DateTime      @updatedAt

  @@index([vendorCreditId])
  @@index([billId])
  @@index([zohoBillId])          // a bill arriving later links its waiting applications by this
  @@index([zohoVendorCreditId])  // a credit sync replaces its own applications by this
}
```

`npx prisma migrate dev --name vendor_bill_zoho_id_and_credit_links` **on a localhost restore of production only** (rules 2, 10). Expected SQL: three `ALTER TABLE "VendorBill" ADD COLUMN` (two nullable `TEXT`, one `DECIMAL(12,2) NOT NULL DEFAULT 0`), one `CREATE UNIQUE INDEX` on `zohoBillId`, `CREATE TABLE "VendorCreditApplication"` with its indexes and two `FOREIGN KEY … ON DELETE SET NULL`. `VendorBill` is populated: a constant default is metadata-only on Postgres ≥ 11, and a unique index over an all-null column builds at once. No `DROP`, no type change, no `SET NOT NULL` on an existing column (rule 3); the old code never reads the new columns (rule 7). `SetNull` on both keys: deleting a bill (`inbound/[id]/route.ts:602`, `inventory/cleanup/route.ts:86`) leaves the application with its Zoho ids, and a re-import relinks it.

**1.2 Stamp the id at every bill import.** There is exactly one code path that creates a `VendorBill` from Zoho: `approve/route.ts` bill branch (`:173-558`), used by `/bills` (`source: "accounting"`) and `/inbound`. `POST /api/bills` (manual) has no Zoho bill and leaves it null. The manual-shipment push (`src/lib/inbound/complete-shipment.ts:195`) creates no `VendorBill` and is broken for another reason (plan 2409 §2.5) — §5.

- `src/lib/integrations/base.ts:43` `IntegrationBill` gains `location_id?`, `location_name?`. `getBill` (`:407`) return type gains `vendor_credits?: Array<{ vendor_credit_id; vendor_credit_bill_id; vendor_credit_number; date; amount }>`, `vendor_credits_applied?`, `location_id?`.
- `trigger-pull/route.ts:354-368` — preview data gains `locationId`, `locationName`.
- `approve/route.ts`:
  - `:176` — fetch the bill detail **always** for a bill (it already happens in practice — preview `lineItems` is always `[]`, `:367`); the credits and location come from it.
  - `:197-200` — "already has a shipment" becomes: a shipment whose `zohoBillId` equals the preview's, or whose bill has that `zohoBillId`; else bill number **and** resolved vendor.
  - `:220` — the existing bill is found by `zohoBillId`, else by the compound unique `(vendorId, billNo)` **after** the vendor is resolved; a match with a null `zohoBillId` gets it stamped.
  - `:442-452` — create inside a `prisma.$transaction` (the loop's first): `zohoBillId`, `zohoLocationId`, `storeId` (Part 2), `creditAppliedAmount = detail.vendor_credits_applied ?? 0`; then upsert one `VendorCreditApplication` per `detail.vendor_credits[]` row (by `zohoVendorCreditBillId`, `vendorCreditId` from `VendorCredit.zohoVendorCreditId` once Part 3 exists); then `updateMany({ where: { zohoBillId, billId: null }, data: { billId } })` to adopt applications a credit pull left waiting. Because `creditAppliedAmount` and the application rows both come from the same Zoho bill detail, they agree — the sync rule in Part 3.4 then moves `paidAmount` by zero.

**1.3 The bills fetch stops deleting and stops matching by number alone** (`trigger-pull/route.ts:301-319`, X1, X2).

- Delete `:306-312`. The re-fetch problem it solved is solved by matching:
- Existing bills = `vendorBill.findMany({ where: { zohoBillId: { in: billIds } } })`, plus — for rows stamped before this plan — `zohoBillId: null, billNo: { in: numbers }` whose `vendor.zohoVendorId` equals the Zoho bill's `vendor_id`.
- Has a shipment → skipped `alreadyImported`, `where: "inbound"` (as today).
- No shipment → a preview row with `action: "existing"` and `localMatch: { vendorBillId }`. `/inbound` imports it exactly as today (approve already reuses an existing bill and creates the shipment). `/bills` shows it **unticked**, labelled "Already in Bills — importing links it to Zoho"; approving it with `source: "accounting"` counts as `skipped` and only stamps a missing `zohoBillId` / `zohoLocationId`.

**1.4 Backfill for bills already in the app — `POST /api/bills/zoho-link`** (`requireFeature("zoho", "approve")`, zod `{ mode: "dry-run" | "apply", cursor?: string, batch?: 1…40 }`). A route, not a script: it must run where Zoho is connected, and a local restore has its credentials nulled (rule 10).

1. No Zoho call: a bill whose `InboundShipment.zohoBillId` is set takes that id.
2. A bill whose vendor has `zohoVendorId`: `GET /bills?vendor_id=…&bill_number=…` (new registry key `bills.find`). Exactly one result with the same total (±₹0.01) → match; none or several → reported, untouched.
3. For each match, `GET /bills/{id}` for `vendor_credits[]`, `vendor_credits_applied`, `location_id`.
4. **`creditAppliedAmount` for an old bill** = the sum of its Zoho applications dated **on or before the day the bill was imported** (`VendorBill.createdAt`) — those were already inside Zoho's balance when the import set `paidAmount = total − balance` (`approve/route.ts:449`). Only those application rows are written by the backfill. Applications dated after the import are **not** in `paidAmount`; they are left for the first vendor-credit pull, which writes them and moves `paidAmount` by exactly their amount (Part 3.4). That first pull must therefore use the "this financial year" window. An application dated within a day of the import is reported "check by hand".
5. `dry-run` writes nothing and returns counts and lists: matched, not found, ambiguous, vendor not linked to Zoho, check-by-hand, **share of bills that carry a `location_id`** (answers Q2), and **balance drift** — bills where `amount − paidAmount` differs from Zoho's `balance` (reported only: payments recorded here are not in Zoho until plan C ships, so "correcting" them would erase real payments).
6. `apply` writes `zohoBillId`, `zohoLocationId`, `creditAppliedAmount` and the pre-import application rows — **never `paidAmount`** — and returns the next `cursor`.

Two Zoho reads per bill; 40 bills per request ≈ 80 calls, inside Zoho's per-minute limit. The screen sends the next batch when the previous one answers, until the cursor is empty — one click starts it, nothing runs on a timer. Screen: a "Link bills to Zoho" item in the `/bills` header (shown when `canApprove("zoho")`), opening a sheet: **Dry run** → report → **Apply** → progress → final counts.

### Part 2 — The store on bills, payments and credits (R9; D1)

**2.1 Schema — migration M2 `payables_store_and_zoho_credits`** (shared with Parts 3, 8, 9):

```prisma
model Store {
  …
  // Zoho Books location_id for this store, when Zoho Locations is on (Q2). Set on /stores.
  zohoLocationId      String?  @unique
  vendorBills         VendorBill[]
  vendorPayments      VendorPayment[]
  vendorCredits       VendorCredit[]
  customerCreditNotes CustomerCreditNote[]
}
model VendorBill    { storeId String?  store Store? @relation(fields: [storeId], references: [id], onDelete: Restrict)  @@index([storeId, status]) }
model VendorPayment { storeId String?  store Store? @relation(fields: [storeId], references: [id], onDelete: Restrict)  @@index([storeId]) }
```

Nullable: every existing row predates it and a bill can arrive without proof of its store; `Restrict` because a store with financial history is not deletable (the `Delivery.storeId` precedent, `schema.prisma` Delivery block). Hand-added to the migration, after the DDL:

```sql
-- billedTo -> storeId. Expected to update 0 rows (§2.5); kept so a hand-typed value is not lost.
UPDATE "VendorBill" b SET "storeId" = s.id
  FROM "Store" s
 WHERE b."storeId" IS NULL
   AND s.code = CASE upper(trim(b."billedTo")) WHEN 'HUB' THEN 'BCH_STORE' WHEN 'CENTRE' THEN 'BCC_STORE' END;
-- A payment against a bill belongs to the bill's store.
UPDATE "VendorPayment" p SET "storeId" = b."storeId"
  FROM "VendorBill" b
 WHERE p."billId" = b.id AND p."storeId" IS NULL AND b."storeId" IS NOT NULL;
```

`billedTo` stays (rule 7). After this release nothing reads or writes it; dropping it is the next release's migration (§5).

**2.2 Where a store comes from, in order.**

| Record | 1st | 2nd | 3rd |
|---|---|---|---|
| Bill | Zoho `location_id` → `Store.zohoLocationId` | the importer's choice in the `/bills` import panel ("These bills are for: BCH Store / BCC Store"), required when a ticked bill has no linked location; defaults to BCH Store only if Q2 = (b) | set by hand on `/bills/[id]` (`bills.edit`); a "Store not set" chip on `/bills` lists them |
| Payment | the store of the bills it pays — all must share one (Q9) | an advance (no bill) picks it on `/payments/new` | bank-confirmed payment: **plan D** stamps it from its `BankAccount.storeId`, through `storeIdForPayment()` below |
| Vendor credit | Zoho `location_id` | the store of the bills it is applied to, when they all agree | set by hand on the Credits tab (`bills.edit`) |
| Customer credit note | the store of the `Delivery` it credits | Zoho `location_id` | null |

`src/lib/payables/store.ts` (new): `storeIdForLocation(zohoLocationId)`, `storeIdForPayment({ billIds, explicitStoreId })` — the one rule, shared with plan D.

**2.3 Linking a store to its Zoho location.** `BooksClient.listLocations()` → `GET /locations` (registry `locations.list`). `GET /api/stores/zoho-locations` (`requireFeature("stores", "edit")`) returns them; the `/stores` edit form gains a "Zoho location" select; `storeUpdateSchema` (`validations.ts:1246`) gains `zohoLocationId: z.string().nullable().optional()`. Saving one runs, in the same request, `UPDATE "VendorBill" … SET "storeId" = $store WHERE "storeId" IS NULL AND "zohoLocationId" = $loc` (and the same for credits and customer credit notes), logged with the row counts.

**2.4 Screens.** `/bills`: the Location filter (`bills/page.tsx:483-491`) becomes a Store filter fed by `/api/stores` plus "Not set"; `GET /api/bills` takes `storeId=<id>` or `storeId=none` and drops `billedTo` (`:21, 54, 68`); each row carries a store chip. `/bills/[id]`: a store select for `bills.edit`; `PUT /api/bills/[id]` (`:38-63`) gets a zod schema `{ status?, notes?, storeId? }` and a logger.

**2.5 Backfill of existing bills' store** (after Q2): the Part 1.4 `apply` fills `storeId` from `zohoLocationId` where a store is linked; if Q2 = (b), one more `apply` option "Set every remaining bill to BCH Store" — shown with the count before it runs.

### Part 3 — The vendor credit pull (R2, R3, R5)

**3.1 Zoho client and registry.** All on `BooksClient` (`src/lib/integrations/books.ts`), all through `apiCall`, which reads with `readJson` (`base.ts` — the third-party rule holds). `endpoints.ts` gains:

| Key | Method, path | Owner |
|---|---|---|
| `vendorcredits.list` | `GET /vendorcredits?page&per_page&last_modified_time&search_text` | `listVendorCredits` / `listAllVendorCredits` |
| `vendorcredits.get` | `GET /vendorcredits/{vendor_credit_id}` | `getVendorCredit` |
| `bills.find` | `GET /bills?vendor_id&bill_number` | `findBill` (Part 1.4) |
| `locations.list` | `GET /locations` | `listLocations` (Part 2.3) |
| `creditnotes.list` / `creditnotes.get` | `GET /creditnotes…`, `GET /creditnotes/{creditnote_id}` | Part 8 |

All `BOOKS_ONLY`, all reads. Q1 = (b) adds **no** Zoho endpoint: an application made here is not sent to Zoho (§6).

**3.2 Schema (M2).**

```prisma
enum VendorCreditStatus { OPEN CLOSED VOID }   // Zoho's statuses; drafts are not imported (Q10)

model VendorCredit {
  …                                             // amount = Zoho total; usedAmount = (total − Zoho balance) + Σ APP applications (13 Oct — Zoho's balance never sees an application made here). Existing Float columns.
  zohoVendorCreditId String?            @unique
  referenceNo        String?            // the supplier's own credit-note number, as typed into Zoho
  status             VendorCreditStatus @default(OPEN)
  storeId            String?
  store              Store?             @relation(fields: [storeId], references: [id], onDelete: Restrict)
  zohoLocationId     String?
  zohoLastModifiedAt DateTime?          // Zoho's last_modified_time — decides "update" on the next fetch
  lastSyncedAt       DateTime?
  applications       VendorCreditApplication[]
  refunds            VendorCreditRefund[]
  @@index([storeId])
  @@index([status])
}

model VendorCreditRefund {
  id             String       @id @default(cuid())
  zohoRefundId   String       @unique
  vendorCreditId String
  vendorCredit   VendorCredit @relation(fields: [vendorCreditId], references: [id], onDelete: Cascade)
  refundDate     DateTime
  amount         Decimal      @db.Decimal(12, 2)
  refundMode     String?
  referenceNo    String?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  @@index([vendorCreditId])
}
```

`status NOT NULL DEFAULT 'OPEN'` on the populated `VendorCredit` is metadata-only. No new `Float`. `ZohoPullLog` gains `vendorCreditsNew Int @default(0)` and `creditNotesNew Int @default(0)`.

**3.3 Fetch — `POST /api/zoho/trigger-pull { step: "vendorcredits" }`** (`zoho.fetch`, existing guard). `zohoPullSchema` (`validations.ts:1282`) gains `"vendorcredits"` and `"creditnotes"` in `step` and the two finalize counts.

- Books only. Not connected → the existing `noSourceMessage()` 409 (`trigger-pull/route.ts:71-80`).
- The window from `resolveBillWindow` (`:233`) is sent as **`last_modified_time ≥ window.from`**, not as a date range: a credit created *or changed* in the window is caught — including one back-dated, and an old credit applied to a bill this week. A search overrides the window, as for bills.
- Each Zoho row is classified: `draft` → skipped `"draft"` (`SkipReason` gains it, `:83`); no local `zohoVendorCreditId` → `action: "new"`; local row with older `zohoLastModifiedAt` → `"update"`, or `"void"` when Zoho says void; otherwise skipped `alreadyImported`.
- Preview `data`: `creditNumber`, `referenceNumber`, `vendorName`, `vendorId`, `vendorSource: "books"`, `date`, `total`, `balance`, `status`, `lastModifiedTime`. Old APPROVED/REJECTED previews for the same `zohoId` are cleared first (the bills pattern, `:343-345`).
- Same §5.2 response shape as bills; `logActivity(module: "zoho", action: "pulled")`.

**3.4 Approve — `entityType: "vendorcredit"`** in `approve/route.ts`, calling `syncVendorCredit()` in `src/lib/payables/sync-vendor-credit.ts` (new — the route is 725 lines). The route body gets a zod schema (X11): `{ pullId, action: "approve" | "reject", entityType?: "bill" | "invoice" | "vendorcredit" | "creditnote", previewIds?: string[] (max 200), source?: "accounting", storeId?: string }`.

For each credit:

1. `getVendorCredit(zohoId)` — one read.
2. The vendor by `resolveBillVendor` (`resolve-zoho-vendor.ts:41`) — the plan-2409 resolver, which creates a vendor once, with its Zoho details, if Zoho knows one the app has not met.
3. **One `prisma.$transaction`:**
   - a. Upsert `VendorCredit` by `zohoVendorCreditId`. If none has it but a row with the same `(vendorId, creditNoteNo)` and no Zoho id exists (a hand-typed one — Q14), stamp the id on it once. Write `creditNoteNo = vendor_credit_number`, `referenceNo`, `amount = total`, `usedAmount = (total − balance) + Σ this credit's APP applications` (13 Oct, Q1 = b), `status`, `creditDate`, `notes`, `zohoLocationId`, `storeId` (§2.2), `zohoLastModifiedAt`, `lastSyncedAt`. Zoho wins every financial field (integration-architect principle 4).
   - b. Applications: upsert one row per `bills_credited[]` by `zohoVendorCreditBillId`, `billId` from `VendorBill.zohoBillId` (null when that bill is not imported yet); delete this credit's rows (by `zohoVendorCreditId`) that Zoho no longer lists — **`source = ZOHO` rows only**. An APP application is never written or pruned by a pull (13 Oct, D17).
   - c. Refunds: the same upsert-and-prune by `zohoRefundId`.
   - d. **For every bill touched, before or after** — `S` = sum of `VendorCreditApplication.amount` where `billId` = the bill. If `S ≠ creditAppliedAmount`:
     ```sql
     UPDATE "VendorBill"
        SET "paidAmount" = "paidAmount" + (${S} - "creditAppliedAmount"),
            "creditAppliedAmount" = ${S},
            status = (CASE
                        WHEN status = 'DISPUTED' THEN 'DISPUTED'          -- a person's flag; amounts still move
                        WHEN "paidAmount" + (${S} - "creditAppliedAmount") >= amount - 0.01 THEN 'PAID'
                        WHEN "paidAmount" + (${S} - "creditAppliedAmount") >  0.01          THEN 'PARTIALLY_PAID'
                        ELSE 'PENDING' END)::"BillStatus",
            "updatedAt" = now()
      WHERE id = ${billId} AND "creditAppliedAmount" = ${oldS}
     ```
     The right-hand sides all read the row's values from before the update, as SQL requires. Zero rows → re-read once and retry; still zero → this credit fails with a sentence and its transaction rolls back, nothing half-written.
   - e. **Over-applied check (13 Oct, D17).** After the writes, if `usedAmount > amount + 0.01` the credit has been applied for more than its total across Zoho and here together. The transaction still commits, because Zoho's application is a fact and is honoured. The notice and a `warn` name both parts, and the credit card shows it in red (Part 4).
4. `results.notices`: "Credit DN-00012 is applied to bill 4567, which is not in the app yet — fetch it on /bills"; "Credit DN-00009 is void in Zoho — removed from the ledger"; "Store not known for DN-00015 — set it on the vendor's Credits tab"; "DN-00012 is applied ₹A here and ₹B in Zoho — ₹C more than its ₹T total. Remove one of them".

**Why nothing is ever subtracted twice from a bill.** `paidAmount` keeps its meaning ("settled", which every reader of `amount − paidAmount` depends on — 17 files). `creditAppliedAmount` records how much of it is credit notes. A bill imported from Zoho sets both from the same Zoho detail; a credit sync moves `paidAmount` only by the change in `S`. Running the same sync twice changes nothing; a credit un-applied in Zoho lowers `S` and re-opens the bill by exactly that amount. An application made here (Part 4) moves `paidAmount` and `creditAppliedAmount` together in one statement, so the next sync's `S` already includes it and moves nothing.

`pull-review/route.ts:39-42` groups gain `vendorCredits` and `creditNotes`; `pull-review/export/route.ts:30-55` writes a row for each; `approve` results gain `vendorCredits` and `creditNotes`; the finalize notification text (`trigger-pull/route.ts:645`) names them.

**3.5 The fetch button.** `src/components/zoho-credit-fetch.tsx` (new, shared with Part 8) — `kind: "vendorcredit" | "creditnote"`; the same date chips as Fetch Bills; runs `init → vendorcredits → finalize → pull-review`; lists previews with **New / Updated / Void** badges, all ticked; Import → approve with that `entityType`. `apiTry` with `timeoutMs: 60_000`; the API's sentence on any failure. Mounted on `/bills` as **Fetch credit notes** beside Fetch Bills, for `canFetch("zoho")`. `/bills?fetch=credits` opens it (the Credits tab links here).

### Part 4 — The credit-note section (R1, R2, R11)

- **`GET /api/vendors/[id]/credits?status=open|all`** (`vendors.view`; zod for the query): every credit for the vendor — not 10 — with store, status, `amount`, applied (Σ applications), refunded (Σ refunds), open (`amount − usedAmount`), each application (bill number, `billId` when imported, amount, date) and each refund; plus totals. `createLogger("payables:credits")`.
- `GET /api/vendors/[id]` (`:23-24`): `credits` include replaced by `_count.credits`; the page's only use of the list moves to the new route. (Bills stay `take: 10` for the Bills tab; the Overview's outstanding figure comes from `vendorBalance()`, Part 6, X9.)
- **`vendors/[id]/_components/vendor-credits.tsx`** (new; the page is 608 lines, frontend-engineer's >300 rule): a strip "Open credit ₹X across N notes · credit notes are entered in Zoho Books" with a **Fetch credit notes** link for `canFetch("zoho")`; chips Open / All; one card per credit — Zoho number and the supplier's reference, date, store chip (a select for `bills.edit` when not set), status badge, Total / Applied / Refunded / **Open**; "Applied to: bill 4567 · ₹2,000 · 12 Oct" (a link to `/bills/[id]` when the bill is in the app, "not in the app yet" when not); refunds; "Settles ISS-…" (Part 9). Skeleton while loading, an error line with retry, an empty state that says where credit notes come from.
- **`/bills/[id]`** gains a "Credit notes applied" card listing this bill's applications, each marked *applied here* or *applied in Zoho*, with **Remove** on the ones made here for `bills.edit`. When the vendor has open credit and the bill has money left, it shows **Apply credit** for `bills.create` (13 Oct, D18).
- **Apply and remove — 13 Oct 2026, Q1 = (b), D18–D19.**
  - **`POST /api/vendor-credits/[id]/apply`** `{ billId, amount, note? }` (zod; `requireFeature("bills", "create")`). Refused with a 400 before any write if: the credit and the bill belong to different vendors; both have a store and the stores differ ("DN-00012 is BCH's; bill 4567 is BCC's"); or the amount is ≤ 0. Then **one `prisma.$transaction`** runs three statements. In each conditional update the guard and the write are the same statement, so two people applying at once cannot both pass:
    1. `UPDATE "VendorCredit" SET "usedAmount" = "usedAmount" + ${amt} WHERE id = ${creditId} AND "vendorId" = ${vendorId} AND status = 'OPEN' AND amount - "usedAmount" + 0.01 >= ${amt}` — 0 rows → 409 "Credit DN-00012 has only ₹Y open now. Reload."
    2. `UPDATE "VendorBill" SET "paidAmount" = "paidAmount" + ${amt}, "creditAppliedAmount" = "creditAppliedAmount" + ${amt}, status = (CASE WHEN "paidAmount" + ${amt} >= amount - 0.01 THEN 'PAID' ELSE 'PARTIALLY_PAID' END)::"BillStatus", "updatedAt" = now() WHERE id = ${billId} AND "vendorId" = ${vendorId} AND status <> 'DISPUTED' AND amount - "paidAmount" + 0.01 >= ${amt}` — 0 rows → 409 with the bill's remaining amount, or "Bill 4567 is disputed".
    3. Insert `VendorCreditApplication { source: APP, vendorCreditId, billId, amount, appliedDate: today (IST), appliedById, note }`.

    `logActivity(module: "bills", action: "credit_applied")` with the ids and amount.
  - **`DELETE /api/vendor-credits/applications/[id]`** (`requireFeature("bills", "edit")`). Only `source = APP`; a ZOHO row → 409 "Applied in Zoho — remove it there, then fetch credit notes." The same three statements in reverse, inside one transaction and conditional on the application row still existing. `logActivity(action: "credit_application_removed")`.
  - The vendor's Credits tab opens the same **Apply credit** sheet from the credit's side: pick an open bill of the same vendor (and store, when both are known). The sheet pre-fills the largest allowed amount, and Apply is disabled while busy.
  - Each credit card splits its applications into "here" and "in Zoho". An **over-applied** credit (open below zero, D17) is red: "Applied ₹X more than its total — ₹A here, ₹B in Zoho. Remove one."
  - `createLogger("payables:credit-apply")`: `info` "credit applied" / "credit application removed" `{ applicationId, vendorCreditId, billId, amount, userId }`; `warn` on every 400/409 with the ids and the reason; `error` in the catch. Client `vendors:credit-apply`: `warn` with the API sentence on every failed call.
- **`api/credits/route.ts` is deleted** (Q3 = a); `vendorCreditSchema` (`validations.ts:614-621`) goes with it; `src/types/index.ts:300` `VendorCredit` gains the new fields.

### Part 5 — Recording a vendor payment correctly (R13; F4)

Under **Q1 = (b) with D18** (13 Oct): an application is not a payment, so the payment route stops handling credits altogether:

- `vendorPaymentSchema` (`validations.ts:597-612`): `creditId` removed; `paymentMode` loses `CREDIT_ADJUSTMENT` (the expense list `:632` keeps its own); `storeId` optional; `billAllocations` bill ids unique. A request still carrying `creditId` gets 400 "Credit notes are applied from the bill or the vendor's Credits tab, not as a payment."
- `POST /api/payments` (`:40-154`) rewritten as validate → read → guard-and-write:
  1. Load the allocation bills once. Each must belong to `data.vendorId` (400 "Bill 4567 belongs to Hero Cycles, not Aoki") and all must share one store (400 "One payment pays one store's bills"); `payment.storeId` = that store. No bills → an advance (Q9), `storeId` required.
  2. Per allocation, **one conditional update** — the guard and the write are the same statement, so two simultaneous payments cannot both pass (Postgres re-checks the `WHERE` against the newest row version):
     ```sql
     UPDATE "VendorBill"
        SET "paidAmount" = "paidAmount" + ${settle},          -- settle = amount + its CD
            status = (CASE WHEN "paidAmount" + ${settle} >= amount - 0.01 THEN 'PAID' ELSE 'PARTIALLY_PAID' END)::"BillStatus",
            "updatedAt" = now()
      WHERE id = ${billId} AND "vendorId" = ${vendorId}
        AND amount - "paidAmount" + 0.01 >= ${settle}
     ```
     0 rows → 409 "Bill 4567 changed since you opened the form — it now has ₹Y left. Reload." The CD is inside `settle`, closing X6.
  3. Create the `VendorPayment` rows with `storeId`, inside the same transaction.
- `GET /api/payments` (`:9-38`): `AuthError` branch, `storeId` filter, a logged catch.
- `createLogger("payables:payments")`: `info` "vendor payment recorded" `{ paymentIds, vendorId, billIds, storeId, total }`; `warn` on every 400/409 with the ids and the reason; `error` in the catch.
- `src/lib/payables/store.ts` `storeIdForPayment()` (Part 2.2) is what plan D calls for bank-confirmed payments.
- **`/payments/new`**: `apiFetch`/`apiTry` instead of raw `fetch` (`:78, 97-98, 244`); the store shown, derived from the ticked bills, or picked for an advance; a refusal when ticked bills span two stores; the advance hint (`:398`) becomes true; a line "₹X open credit with this vendor — apply it on the bill before paying" from Part 4's route, linking to the bill. **No credit field. No CD field** unless Q4 = (b) — then a "CD taken" input pre-filled from the shared CD function when the deadline has not passed, sent as `cdDiscountAmount`.

*(13 Oct)* The alternative this paragraph used to describe was a `CREDIT_ADJUSTMENT` payment carrying `creditId`. It was offered under Q1 as "As a payment mode" and **not chosen** (D18). Applications live in Part 4's routes; the payment route never sees a credit.

Plan C adds "Push to Zoho" to the same screen and route; **Part 5 lands first** and C builds on it.

### Part 6 — The supplier ledger (R7, R8, R9; F5, L14, D9)

**6.1 One function, `src/lib/payables/ledger.ts`** — `vendorLedger(vendorId, { storeId?: string | "none", page, pageSize, all? })` and `vendorBalance(vendorId, storeId?)`. One parameterised query (`Prisma.sql`), so the running balance is computed over **all** of the supplier's history and only the page is cut (L14):

| Line | Date | Debit (we owe more) | Credit (we owe less) | Included when |
|---|---|---|---|---|
| BILL | `billDate` | `amount` | | always |
| CREDIT NOTE | `creditDate` | | `amount` | status `OPEN` or `CLOSED` — a `VOID` credit drops out |
| CREDIT REFUND | `refundDate` | refund `amount` | | its credit is not `VOID` |
| PAYMENT | `paymentDate` | | `amount + cdDiscountAmount` | `creditId IS NULL` |

```sql
WITH rows AS (
  SELECT id, "billDate" AS d, 1 AS ord, 'BILL' AS kind, "billNo" AS ref, amount::numeric AS dr, 0::numeric AS cr, "storeId", "createdAt"
    FROM "VendorBill" WHERE "vendorId" = ${vendorId}
  UNION ALL
  SELECT id, "creditDate", 2, 'CREDIT', "creditNoteNo", 0, amount::numeric, "storeId", "createdAt"
    FROM "VendorCredit" WHERE "vendorId" = ${vendorId} AND status IN ('OPEN', 'CLOSED')
  UNION ALL
  SELECT r.id, r."refundDate", 3, 'REFUND', c."creditNoteNo", r.amount, 0, c."storeId", r."createdAt"
    FROM "VendorCreditRefund" r JOIN "VendorCredit" c ON c.id = r."vendorCreditId"
   WHERE c."vendorId" = ${vendorId} AND c.status <> 'VOID'
  UNION ALL
  SELECT id, "paymentDate", 4, 'PAYMENT', coalesce("referenceNo", "paymentMode"::text), 0,
         (amount + "cdDiscountAmount")::numeric, "storeId", "createdAt"
    FROM "VendorPayment" WHERE "vendorId" = ${vendorId} AND "creditId" IS NULL
), scoped AS (
  SELECT * FROM rows WHERE ${storeFilter}          -- TRUE, "storeId" = $id, or "storeId" IS NULL
)
SELECT *, ${opening} + SUM(dr - cr) OVER (ORDER BY d, ord, "createdAt", id) AS balance
  FROM scoped ORDER BY d DESC, ord DESC, "createdAt" DESC, id DESC
 LIMIT ${pageSize} OFFSET ${offset}
```

- **D9, stated as a rule:** a credit note is subtracted once, on its own date, by its CREDIT NOTE line. Applying it to a bill, here or in Zoho, is **not a line**; it appears on the credit as "applied to 4567". The only other way a credit could be subtracted is a `CREDIT_ADJUSTMENT` payment that names it, and those are excluded by `creditId IS NULL`. A credit-adjustment payment that names no credit (Q14) stays a payment line — it is the only record of that credit.
- **Opening:** `vendor.openingBalance` on the all-stores view; on a store view 0, with "Opening balance (₹X, 1 Apr 2026) is not split by store" (Q8 = a).
- Response: `{ vendor, store, opening, closing, totals: { bills, payments, cd, credits, refunds }, entries, page, pageSize, totalEntries, overSettledBills }` — `overSettledBills` lists bills with `paidAmount > amount + 0.01` (the trace of a CD taken twice, Q4).
- `vendorBalance()` replaces the private formulas at `api/bills/[id]/route.ts:23-31` and feeds the vendor page's Overview (X9). `/vendors`' "Outstanding" (`api/vendors/route.ts:49-53`) keeps meaning "unpaid bills" (the 0809 plan kept them apart deliberately) and gains `openCredit` (one `groupBy` per page).

**6.2 Route.** `GET /api/vendors/[id]/ledger?storeId&page&pageSize&all=1` (`vendors.view`, unchanged guard), zod for the query; `all=1` returns up to 5,000 rows for export; `createLogger("payables:ledger")` — `debug` with `{ vendorId, storeId, rows, ms }`, `error` in the catch with `vendorId`.

**6.3 Screens.** The vendor page's Ledger tab (`vendors/[id]/page.tsx:554-600`, extracted to `_components/vendor-ledger-tab.tsx`) and `/accounts/vendor-ledger`: store chips All / BCH / BCC / Not set; Debit and Credit as two columns (the tab shows one today); credit-note rows tinted, "applied to …" under them; refunds labelled; a "Load more" pager; `apiFetch`. The accounts page export uses `all=1` instead of the first 20, and "Showing latest 20" goes.

### Part 7 — The payment priority list (R10, R11, R12; F6; D8)

**7.1 Cash discount in one place — `src/lib/payables/cash-discount.ts`.** `cashDiscountFor({ billDate, amount, paidAmount }, { cdTermsDays, cdPercentage }, todayIST)` → `{ deadline, daysLeft, amount, claimable }`: deadline = bill date + `cdTermsDays` in IST (`getTodayIST`, `src/lib/services/timezone`); amount = `round(bill.amount × cdPercentage / 100)` (today's base, Q15); claimable = `daysLeft ≥ 0` and the bill still open. Used by `cd-eligibility` (`:45-60`), the aging CD warnings (`:51-73`), the priority list and the CD report — ending the `ceil`/`floor` disagreement.

**7.2 `GET /api/bills/priority?storeId&vendorId`** (`bills.view`). One `findMany` of open bills — status `PENDING`, `PARTIALLY_PAID` or `OVERDUE`, `amount − paidAmount > 0.01` — with the vendor's name and CD terms, plus one `groupBy` of open credit per vendor (`VendorCredit` `OPEN`, `amount − usedAmount`). Computed in memory: 70-odd suppliers' open bills are hundreds of rows; capped at 1,000 with a sentence if exceeded. Per bill: vendor, store, bill number, bill date, due date (stored `dueDate`, Q5), **open amount**, **days since bill date**, **days past due** (≤ 0 means not yet due), CD (`deadline`, `daysLeft`, `amount`) or null, the vendor's **open credit**, `coveredByCredit` (open credit ≥ open amount), the tier, and `itcAtRisk` (≥ 150 days since the bill date — see the GST check). `DISPUTED` bills come back separately as `onHold`. Totals per tier and for >30 / >45.

**7.3 The order (Q7).**

1. **CD still claimable** — soonest deadline first. Paying these earns money.
2. **Past due more than 45 days** — most days past due first.
3. **Past due 31–45 days.**
4. **Past due 1–30 days.**
5. **Due in the next 7 days.**
6. Everything else, by due date.

A bill whose supplier has open credit covering it carries **"Use credit first"** in whatever tier it falls. Pressing **Apply credit** on the bill (13 Oct, D18) takes it off the list, or lowers its amount by what was applied.

**7.4 Screen and aging (F6).** `/bills` gets a top tab bar **Bills | Pay first** (`?view=priority`); `bills/_components/payment-priority.tsx` (new). Phone (375 px): one card per bill — supplier, store chip, open amount; "44 days old · 14 days past due"; a CD chip "2% · ₹1,240 · 3 days left"; badges "Use credit first", "ITC at risk"; a **Pay** button (44 px) to `/payments/new?billId=…&vendorId=…`. Desktop: `DesktopTable` with the same columns. Tier headings with their totals; chips **>30 days old**, **>45 days old** (Q6), Store; Export through `exportToExcel`. Loading skeleton, error line with retry, empty state "Nothing owed".

`GET /api/bills/aging-summary` buckets become the owner's cuts by days past due — `notDue`, `pastDue1to30`, `pastDue31to45`, `pastDueOver45` — the mislabelled `days90plus` (F6) is gone; unpaid includes `OVERDUE` (X10). `GET /api/bills?aging=` takes the same four keys (`:24-41`). The `/bills` cards (`:93`, `:405-436`) are relabelled to match, in the same commit — they are the only reader. The list, `/bills/[id]` and `/vendors/[id]` show the stored `dueDate` instead of recomputing (Q5, X5).

**7.5 The CD report.** `GET /api/reports/cd-summary` (`bills.view`, new) computes server-side with the shared function; `reports/cd-summary/page.tsx` makes one `apiFetch` instead of N+1 raw fetches (X4). "CD used" is relabelled **"Paid inside the CD window — check the supplier's CD credit note arrived"**: the app cannot know whether a discount was claimed when it arrives as a credit note (Q4 = a).

### Part 8 — Customer credit notes (R4, R5; D4)

**8.1 Schema (M2).**

```prisma
enum CustomerCreditNoteStatus { OPEN CLOSED VOID }

model CustomerCreditNote {
  id                 String   @id @default(cuid())
  zohoCreditNoteId   String   @unique
  creditNoteNo       String   @unique          // Zoho's creditnote_number, unique in the organisation
  referenceNo        String?
  date               DateTime
  zohoCustomerId     String
  customerName       String
  // Linked through the invoice this note credits (Q11); null when it credits none we know.
  customerId         String?
  customer           Customer? @relation(fields: [customerId], references: [id], onDelete: SetNull)
  storeId            String?
  store              Store?    @relation(fields: [storeId], references: [id], onDelete: Restrict)
  total              Decimal  @db.Decimal(12, 2)
  balance            Decimal  @db.Decimal(12, 2)
  status             CustomerCreditNoteStatus @default(OPEN)
  zohoLocationId     String?
  zohoLastModifiedAt DateTime?
  lastSyncedAt       DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  applications       CustomerCreditNoteApplication[]
  @@index([customerId])
  @@index([storeId])
  @@index([date])
}

model CustomerCreditNoteApplication {
  id                String             @id @default(cuid())
  creditNoteId      String
  creditNote        CustomerCreditNote @relation(fields: [creditNoteId], references: [id], onDelete: Cascade)
  zohoInvoiceId     String
  invoiceNo         String
  amount            Decimal            @db.Decimal(12, 2)
  deliveryId        String?
  delivery          Delivery?          @relation(fields: [deliveryId], references: [id], onDelete: SetNull)
  customerInvoiceId String?
  customerInvoice   CustomerInvoice?   @relation(fields: [customerInvoiceId], references: [id], onDelete: SetNull)
  createdAt         DateTime           @default(now())
  @@unique([creditNoteId, zohoInvoiceId])   // Zoho's invoices[] carries no per-application id
  @@index([invoiceNo])
}
```

**8.2 Pull.** `BooksClient.listCreditNotes` / `listAllCreditNotes` / `getCreditNote` (Q12 = a). `trigger-pull` step `"creditnotes"` with the same rules as 3.3 (window → `last_modified_time`, drafts skipped, new / update / void). Approve `entityType: "creditnote"` → `syncCustomerCreditNote()` in `src/lib/receivables/sync-credit-note.ts`: one detail read; one transaction — upsert by `zohoCreditNoteId`; replace its applications from `invoices[]`, linking `Delivery` and `CustomerInvoice` by their unique `invoiceNo`; `customerId` and `storeId` from the credited invoice (Q11 = a), else location, else null. **It does not change `CustomerInvoice.paidAmount` or `Delivery.zohoBalance`** — how receivables show a credit is plan E's decision.

**8.3 Read and fetch.** `GET /api/customer-credit-notes?customerId&invoiceNo&storeId&status&page` (`customers.view`), for plan E's screens. The shared `zoho-credit-fetch.tsx` (`kind="creditnote"`) is mounted on `/receivables` beside the existing invoice fetch, for `canFetch("zoho")`; plan E owns everything else on that screen.

### Part 9 — Vendor issue ↔ credit note (optional; Q13)

A shortage found at the door (`/inbound/[id]` → Report Issue) is usually settled weeks later by a credit note typed in Zoho. Today nothing connects the two.

- `VendorIssue.vendorCreditId String?` → `VendorCredit` (`onDelete: SetNull`), `@@index([vendorCreditId])` (M2). Nullable: an issue is raised long before any credit exists.
- On `/vendor-issues/[id]`, for `vendor_issues.edit`: **"Settled by credit note"** — a select of this vendor's credits, those applied to the issue's `billId` listed first. Saving goes through the existing `PUT /api/vendor-issues/[id]` (`:48-125`), whose zod gains `vendorCreditId`; the note trail records it (the auto-note at `:111-120`); the person is then offered "Mark resolved".
- The Credits tab shows "Settles ISS-202610-0042".
- **Never automatic:** one credit note often covers several issues, or carries GST the issue did not, so an amount match would be wrong as often as right.

### Schema and migration summary

| Migration | Tables touched | Populated? | Rule 3 / rule 7 |
|---|---|---|---|
| **M1** `vendor_bill_zoho_id_and_credit_links` (PR-1) | `VendorBill` +3 columns, +1 unique index; new `VendorCreditApplication` (with `source`, nullable Zoho ids, `appliedById` → `User`) and enum `CreditApplicationSource` (13 Oct) | `VendorBill` yes | only `ADD COLUMN` (nullable, or `NOT NULL` with a constant default) and new objects; old code never reads them |
| **M2** `payables_store_and_zoho_credits` (PR-2) | `Store` +1 unique column; `VendorBill`, `VendorPayment` +`storeId` with FK and index; `VendorCredit` +7 columns, +1 enum; `ZohoPullLog` +2 counts; new `VendorCreditRefund`, `CustomerCreditNote`, `CustomerCreditNoteApplication`, 2 enums; `VendorIssue` +`vendorCreditId` (if Q13 = a); two hand-added backfill `UPDATE`s (Part 2.1) | yes — all additive | the same; `billedTo` kept and dropped a release later |

Each migration: written by `migrate dev` on a localhost restore of production (rules 2, 10); SQL read before commit (rule 3); `npm run db:snapshot` before its PR merges (rule 9); applied by hand — `npx prisma migrate status`, then `npx prisma migrate deploy` — **before** the code that needs it goes live (rule 4). M1 must be live before plan C's code that reads `zohoBillId`.

### RBAC

**No catalog change.** Routes and their guards:

| Route | Guard |
|---|---|
| `trigger-pull` steps `vendorcredits`, `creditnotes` | `zoho.fetch` (existing) |
| `pull-review/approve` for the two new entity types | `zoho.approve` (existing) |
| `POST /api/bills/zoho-link` | `zoho.approve` |
| `GET /api/vendors/[id]/credits`, `GET /api/vendors/[id]/ledger` | `vendors.view` |
| `GET /api/bills/priority`, `GET /api/reports/cd-summary` | `bills.view` |
| store on a bill or credit | `bills.edit` |
| `POST /api/vendor-credits/[id]/apply` — Apply credit (13 Oct, D19) | `bills.create` (the guard of `POST /api/payments`, `api/payments/route.ts:42`) |
| `DELETE /api/vendor-credits/applications/[id]` — Remove an application made here | `bills.edit` |
| `GET /api/stores/zoho-locations`, store ↔ location | `stores.edit` |
| `GET /api/customer-credit-notes` | `customers.view` |
| issue ↔ credit link | `vendor_issues.edit` |

No role name anywhere; screens use `usePermissions()` only and every route re-checks. No `npm run db:seed:rbac` needed for this plan.

### Phases and dependencies

| Phase | Work | Needs | PR |
|---|---|---|---|
| 0 | **Read-only checks, no code.** On a fresh local restore of production (rule 10): `SELECT "billedTo", count(*) FROM "VendorBill" GROUP BY 1`; `SELECT count(*) FROM "VendorCredit"`; `SELECT "paymentMode", ("creditId" IS NOT NULL) AS with_credit, count(*) FROM "VendorPayment" GROUP BY 1, 2`; bills with a shipment `zohoBillId`; vendors without `zohoVendorId`. In Zoho, with the owner's Postman kit (`docs/postman/`), one `GET /vendorcredits?per_page=1`, one `GET /creditnotes?per_page=1` and one `GET /bills?per_page=5` — answers the token-scope question, the `last_modified_time` format, and whether bills carry `location_id` (Q2). Reads only. | — | — |
| 1 | Part 1 — M1, stamping, fetch de-dup, backfill route | Phase 0 | **PR-1**, alone — unblocks plan C |
| 2 | Part 2 — store columns and link | Q2 for 2.5 only | PR-2 |
| 3 | Parts 3 and 4 — vendor credit pull and Credits section | **Q1**, Phase 1 | PR-2 |
| 4 | Parts 5 and 6 — payments and ledger | **Q1**, Q4, Q8, Q9; Phases 2–3 | PR-2 |
| 5 | Part 7 — priority list, CD, aging | Q5–Q7, Q15; Phase 3 | PR-2 |
| 6 | Part 8 — customer credit notes | Q10–Q12; Phase 3's pull code | PR-2 |
| 7 | Part 9 — issue link | Q13 | PR-2 |

**Phase 0 — done 13 Oct 2026.** Every check was read-only.

- **Databases.**
  - Production was **not** read: the session's permission check refused a production query, and Claude did not work around it.
  - The test database is a copy of production as of 3 Oct, and it was read instead. It has **0** `VendorBill`, **0** `VendorCredit` and **0** `VendorPayment` rows. All 83 vendors have no `zohoVendorId`.
  - It has **1** `Store` row: `BCH1` "BCH", with no GSTIN. Bharath Cycle Centre is not in the app (as the expense plan also found).
  - So there is nothing to backfill. The store backfills in M2 were omitted (see the migration's header), and **no code assumes a store code**: stores come from a Zoho location linked on `/stores`, or from a person.
- **Zoho Books** (four `GET`s with the connection stored in the test database; the access token was refreshed first, which mints a new token and revokes none):
  - Granted scopes: `settings.READ`, `bills.READ`, `bills.CREATE`, `invoices.READ`, `contacts.READ`, `customerpayments.READ`.
  - `GET /vendorcredits` and `GET /creditnotes` → **401, code 57, "You are not authorized to perform this operation"**. **The credit-note pulls (Parts 3 and 8) cannot run until Zoho Books is reconnected with `ZohoBooks.debitnotes.READ` and `ZohoBooks.creditnotes.READ` added.** The code turns that refusal into a sentence on the screen.
  - `GET /bills?per_page=10` → 10 of 10 rows carry `location_id`. **Q2 is answered: Zoho uses Locations.**
  - `GET /locations` → `BHARATH CYCLE HUB` (primary), `bharath cycle centre`, a warehouse sub-location under each (`parent_location_id`), and GODOWN 1–3. `storeIdForLocation()` resolves a sub-location through its parent.
- **`last_modified_time` format:** unconfirmed, because the credit lists are refused. The client sends the form the contacts call already uses successfully (`YYYY-MM-DDT00:00:00+0530`).

**Sibling plans.**
- **C** (payment push, bill approval) reads `VendorBill.zohoBillId` (PR-1) and edits `api/payments/route.ts` and `/payments/new` after Part 5. Its `VendorPayment` migration runs after M2, to keep migration order linear.
- **D** (bank accounts) owns `api/bank-statements/*`: it fixes L3 (X13) and stamps `VendorPayment.storeId` on bank-confirmed payments with `storeIdForPayment()` from Part 2. Until D lands, a bill settled by **bulk** bank confirmation still looks unpaid on the priority list; §4 step 19 records it so a tester does not report it as this plan's bug. Recommended order: D's L3 fix before Phase 5 here.
- **E** (receivables) displays `CustomerCreditNote` through `GET /api/customer-credit-notes`, and keeps the fetch button Part 8 mounts on `/receivables`.
- **A** (expenses) also adds a relation to `Store` — the two `schema.prisma` edits to the `Store` block merge by hand.
- **F** (e-way bills) — a supplier return it documents is usually settled by a vendor credit this plan pulls; nothing shared to build.

### Logging

| Scope | Lines |
|---|---|
| `zoho:trigger-pull` (existing) | `info` "vendor credits step finished" / "credit notes step finished" `{ pullId, fetched, new, updated, voided, drafts, alreadyImported, apiCalls }`; `warn` no source; `error` listing failed `{ pullId, message }`; `info` "bills step finished" gains `existingWithoutShipment` |
| `zoho:approve` (existing) | `info` "approve finished" gains `vendorCredits`, `creditNotes`; `warn` zod refusal |
| `payables:sync-credit` (new) | `debug` "-> vendorcredits.get" `{ zohoVendorCreditId }`; `info` "vendor credit synced" `{ vendorCreditId, zohoVendorCreditId, vendorId, status, applications, refunds, billsMoved }`; `warn` "application waits for bill" `{ zohoBillId }`, "conditional update lost, retrying" `{ billId }`; `error` "credit sync failed" `{ zohoVendorCreditId, message }` |
| `receivables:sync-credit-note` (new) | the same shape with `zohoCreditNoteId`, `invoices`, `customerLinked` |
| `bills:zoho-link` (new) | `info` per batch `{ mode, matched, notFound, ambiguous, checkByHand, drift, cursor }`; `warn` per ambiguous bill `{ billId, billNo }`; `error` on a Zoho read failure `{ billId, message }` |
| `payables:payments` (new) | §Part 5 |
| `payables:ledger` (new) | `debug` timing `{ vendorId, storeId, rows, ms }`; `warn` `overSettledBills` non-empty `{ vendorId, count }`; `error` catch |
| `payables:priority` (new) | `debug` `{ storeId, bills, ms }`; `warn` cap reached; `error` catch |
| `payables:credits` (new) | `error` catch `{ vendorId }` |
| `stores:zoho-location` (new) | `info` "store linked to Zoho location" `{ storeId, zohoLocationId, billsUpdated, creditsUpdated }` |
| client: `bills:priority`, `bills:zoho-link`, `vendors:credits`, `zoho:credit-fetch` (new) | `warn` with the API sentence on every failed call |

Identifiers and counts only — never a Zoho payload, a token, or a bank reference. Every `catch` in every touched file logs before it answers.

### Board of agents — checked

- **accounting-consultant** — *"Zoho is the source of truth for financials"*: **Q1 = (b) was chosen on 13 Oct 2026 and is a named violation, accepted by the owner.** A credit applied here is not in Zoho. Zoho's balance for that credit, the bill and the vendor therefore differ from the app's by every credit applied here, until someone applies the same credit in Zoho. Mitigations built in: every application here names who made it and is logged (D19); applications made in Zoho are still honoured, and a credit used twice across the two places is flagged red (D17); the ledger shows each credit once (D9); and this plan writes nothing to Zoho, so it cannot make Zoho wrong (§6). *Accrual*: a credit note reduces the payable on its own date (D9) ✓. *"Always distinguish a timing difference from an error"*: the backfill reports app-vs-Zoho drift without "correcting" it, because until plan C pushes payments the difference is timing, not error ✓. *Red flag "purchase bill paid without 3-way match"* — unchanged by this plan, out of scope. **Flag: CD double-counting** — if CD is both recorded on the payment and received as a credit note, the payable is understated; Q4 asks, and the ledger's `overSettledBills` catches it.
- **gst-consultant** — the app creates no credit note (D3), so the statutory deadline for issuing one ("same financial year or September following") and the requirement to reference the original invoice stay with Zoho and the CA ✓. *Red flag "vendor payment made after 180 days without ITC reversal"*: the priority list marks bills ≥ 150 days old "ITC at risk" so they are paid before the 180-day reversal (CGST Act s.16(2), second proviso) — a badge only; no ITC is computed here (D22). **Flag to the CA (Q15):** a cash discount given by a credit note **with** GST requires the buyer to reverse the matching input tax credit; one given **without** GST does not reduce the taxable value. The app only shows the CD figure; the treatment is Zoho's and the CA's.
- **integration-architect** — *Pull → preview → approve* for both note types ✓. *Idempotent, Zoho ids as de-dup keys*: `zohoVendorCreditId`, `zohoVendorCreditBillId`, `zohoRefundId`, `zohoCreditNoteId`, `zohoBillId` all `@unique` ✓; the bill de-dup by number alone (X2) was this red flag and is fixed. *"Overwriting local operational data"*: the fetch's delete-and-recreate (X1) destroyed local links and is removed ✓. *Zoho wins financial fields, local wins operational*: amounts, balances and status come from Zoho; store and the issue link are local ✓. *`lastSyncedAt`* on both note tables ✓. *Rate limits*: one detail read per approved note and two per backfilled bill, batches ≤ 40 ✓.
- **database-architect** — every new money column `Decimal(12, 2)`, no new `Float` ✓ (mixed `Float`/`Decimal` arithmetic in the ledger query is cast to `numeric`, in JS through `Number()`). Additive migrations, constant defaults, no `SET NOT NULL` ✓. Every nullable FK has its "linked later" reason in a schema comment ✓. Indexes for every new filter (`storeId, status`, `status`, the Zoho id lookups) ✓. Multi-table writes in one transaction, re-read through conditional updates ✓. No JSON for queried data ✓. Every query that touches `VendorBill` was listed (§2.1) and checked against the new columns ✓.
- **backend-engineer** — zod on every new or touched body and query, including the approve route (X11) ✓; transactions for each credit sync and each payment ✓; "what if two users hit this at once" answered by conditional updates, not by re-reading ✓; status codes: 400 input, 409 changed-since-read, 502 Zoho down ✓; sentences a phone can show ✓. **Named deviation:** *"business logic lives in the route handler, not separate service files"* — this plan adds `src/lib/payables/` (ledger, cash discount, store, credit sync). Justified: the vendor balance is computed in three routes with three answers today (§2.4) and CD in two with two answers (§2.7); one function each is the fix, and `src/lib/vendors/resolve-zoho-vendor.ts` and `src/lib/inbound/complete-shipment.ts` are the precedent.
- **frontend-engineer** — mobile first: the priority list is cards at 375 px and `DesktopTable` at ≥ 1024 px ✓; 44 px Pay and chip targets ✓; loading, error and empty states for every new fetch ✓; disabled-while-busy on Import, Apply, Pay ✓; `usePermissions` only, no role names ✓; the 608- and 622-line pages get the new UI as `_components/` files rather than growing ✓; raw `fetch` replaced in every file touched (X12) ✓.
- **warehouse-consultant** (Part 9 only) — the issue raised at receiving stays an inbound action under `inbound.edit`; linking it to a credit note is a `vendor_issues.edit` action on the issue screen, so the goods desk gains no accounts permission ✓.

---

## 4. Verification

**Before any click.** `npx tsc --noEmit` and `npx eslint` on touched files; `npm run build` must pass (Postgres running — three Staff LMS pages prerender against it). Each migration's SQL read and matched to §3's summary; `npx prisma migrate status` clean on local.

**⚠ The test database holds production's live Zoho credentials (since 12 Oct 2026).** This plan makes **no Zoho write** (Q1 = b, §6); every call is a `GET`. The pulls and the backfill dry run are therefore safe to run on test, and Apply credit / Remove touch only the test database. They do spend the production organisation's daily API allowance, so run small windows. **Never press Settings › Integrations › Disconnect on test**: it revokes production's token (§6, row 7).

**Part 1**
1. `/bills` → Link bills to Zoho → Dry run: counts appear; nothing changed (`SELECT count(*) FROM "VendorBill" WHERE "zohoBillId" IS NOT NULL` unchanged). The report says what share of bills carry a Zoho location (Q2).
2. Apply: bills gain `zohoBillId`; `paidAmount` is byte-for-byte unchanged on every bill (compare a `SELECT id, "paidAmount"` taken before).
3. Fetch Bills for a window already imported: no bill is deleted (row count and ids unchanged), unpaid ones appear unticked as "Already in Bills". On `/inbound`, the same bill imports and creates its shipment linked to the existing bill.
4. Two suppliers with the same bill number: both import as separate bills.

**Part 3–4**
5. In Zoho (production, read only for us) find a vendor credit applied to a bill that is in the app. Fetch credit notes → it shows **New** → Import. `/vendors/[id]` → Credits: total, applied, open and "Applied to <bill>" match Zoho's screen. That bill's open amount on `/bills` dropped by the applied amount — once.
6. Fetch the same window again → "already imported", nothing changed. Approve the same preview twice (second tab) → no change, no error.
7. A credit applied to a bill **not** in the app → notice "fetch it on /bills"; fetch that bill → its open amount already reflects the credit, and the waiting application is linked (`billId` set) with `paidAmount` not moved again.
8. A credit voided in Zoho since the last pull → shows **Void** → Import → it leaves the ledger and any bill it was applied to re-opens by that amount.
9. `curl -X POST /api/credits` → 404 (route gone).

**Part 4 — Apply and remove (13 Oct)**
9a. `/bills/[id]` for a vendor with open credit → Apply credit ₹500. The bill's remaining amount drops by 500, the credit's open amount drops by 500, and one application shows "applied here" with your name. The ledger is unchanged apart from "applied to …" under the credit (D9).
9b. Two tabs apply the last ₹500 of one credit to two different bills at the same moment → one succeeds, the other gets the 409 sentence; the credit's open amount is exactly 0.
9c. Remove that application as a user with `bills.edit` → the bill and the credit are back to the paisa, and the activity log names you. A user without `bills.edit` sees no Remove, and the API answers 403. Removing an "applied in Zoho" row → 409.
9d. A credit of BCH applied to a bill of BCC → 400. To another vendor's bill → 400. More than the credit's open amount or the bill's remaining amount → refused.
9e. A credit already applied here, then also applied in Zoho for the rest and more, then fetched → the import commits, and the credit card is red with both amounts and the notice (D17).
9f. Sign in to Zoho Books after 9a: the credit is still open there, and the bill still owes the ₹500. That is the accepted consequence of Q1 = (b), not a bug.

**Part 5**
10. Two browser tabs, same bill with ₹1,000 left, each pays ₹700 at the same moment → one succeeds, the other gets the 409 sentence; `paidAmount` = 700.
11. Pay a bill of supplier A with supplier B selected → 400. Tick bills of two stores → refused. No bill ticked → advance recorded with the chosen store.
12. Send `creditId` in the body → 400 saying credits are applied from the bill or the Credits tab.

**Part 6**
13. A supplier with more than 50 bills: the ledger's closing balance equals `opening + Σ bills − Σ payments − Σ CD − Σ credits + Σ refunds` from SQL over all rows; page 1 shows the newest rows; Load more continues without a jump in the balance column.
14. Store chips: BCH and BCC views each run their own balance; "All" equals the opening plus their sum plus the Not-set rows.
15. A credit note appears once, on its own date; the bill it was applied to shows no extra credit line.

**Part 7**
16. `/bills` → Pay first: a bill with CD 3 days left is on top; a bill 50 days past due is above one 35 days past due; a disputed bill is under "On hold"; >45 chip shows only bills more than 45 days old. Pay opens `/payments/new` with the bill ticked.
17. Aging cards read Not due / 1–30 / 31–45 / Over 45 and their counts match the list filtered the same way; a bill set to OVERDUE by hand is counted.
18. `/reports/cd-summary` shows suppliers (it is empty today).
19. Known until plan D lands: a bill settled by **bulk** bank confirmation still shows as unpaid (X13).

**Part 8–9**
20. Fetch credit notes on `/receivables` → a customer credit note against an imported invoice links to that customer and store; `GET /api/customer-credit-notes?invoiceNo=…` returns it. `CustomerInvoice.paidAmount` unchanged.
21. On a SHORTAGE issue, pick the credit note → the Credits tab shows "Settles ISS-…".

**Phone pass:** `/bills` Pay first, the Credits tab and `/payments/new` at 375 px — no horizontal scroll, every button reachable with a thumb.

---

## 5. Out of scope, deliberately

- **Pushing payments to Zoho and approving bills in Zoho** (map R2, R10) — plan C. This plan only gives it `zohoBillId`.
- **Sending an application made here to Zoho** — Q1 = (b) chose not to. If it is wanted later, it is `POST /vendorcredits/{id}/bills` under plan C's "Push to Zoho" rule.
- **Creating or editing a credit note here** — D3.
- **Zoho's sales-side "debit notes"** (an invoice raised to charge a customer more) — D4 names vendor credits and customer credit notes only; a sales debit note arrives as an invoice through the existing pull.
- **How receivables show a customer credit note**, and the receivables import that also creates deliveries (X14) — plan E.
- **L3, bulk bank confirm without a bill** (X13), and the store on bank-confirmed payments — plan D.
- **Dropping `VendorBill.billedTo`** — the release after this one, once nothing reads it (rule 7).
- **Converting the existing `Float` money columns to `Decimal`** — `docs/schema-review.md` §4.6; this plan only refuses to add another.
- **Refreshing a bill's paid amount from Zoho** when someone pays it inside Zoho rather than here — payments are recorded here and pushed (D11, plan C); a full bill re-sync is a separate decision.
- **Noticing a credit note *deleted* (not voided) in Zoho** — a deleted note no longer appears in any list. Ask the accountant to void, not delete; a per-note "check in Zoho" button can follow if it happens.
- **The manual-shipment bill push** (`complete-shipment.ts:195`) — it creates no `VendorBill` and is broken for the vendor-id reason in plan 2409 §2.5; when fixed it must stamp the returned `bill_id`.
- **Per-store opening balances** — Q8 (b), only if asked.
- **A reminder when a CD deadline approaches** — the app has no scheduler; the priority list is opened by a person.
- **GST and ITC computation** — D22; the "ITC at risk" badge is a date check only.

---

## 6. Writes to Zoho — asked for by the owner, 13 Oct 2026

> at the final i need to know what are the wight aoperation done by application in this application
> … write operation happenig on zoho

### 6.1 This plan

**None.** Every Zoho call this plan adds is a `GET`: `vendorcredits.list/get`, `creditnotes.list/get`, `bills.find`, `locations.list` (Part 3.1). Apply credit and Remove (Part 4) write only to this app's database; Q1 = (b) means Zoho is not told. Reads still refresh the access token when it is near expiry (row 6 below). That changes no business data.

### 6.2 The whole application today (branch `test`, `d3ae966`, read 13 Oct 2026)

Every Zoho call goes through one method, `IntegrationClient.apiCall` (`src/lib/integrations/base.ts:292`, `protected`), which sends a body only for `POST`/`PUT` (`:312`). No `PATCH` or `DELETE` exists. The client methods that write are `BooksClient.createItem`, `updateItem`, `createContact`, `createInvoice`, `createBill` (`books.ts:13, 46, 79, 159, 179`) and `InventoryClient.createItem` (`inventory.ts:97`). `ZakyaClient` has none. Their callers were found by grep and each one read:

| # | Zoho | Call | What it changes | Made by | Who triggers it | Guard | When |
|---|---|---|---|---|---|---|---|
| 1 | Books | `PUT /items/{item_id}` | Overwrites the item's `purchase_rate` with the corrected cost price — the only write that changes an existing Zoho record | `api/stock/price-check/[productId]/route.ts:80` | **Save** on `/price-correction` | `stock.edit` | On Save, only when the product has a `zohoItemId`; a Zoho error is returned, the save still stands |
| 2 | Books | `POST /bills` | Creates a purchase bill (vendor by brand **name**, no `vendor_id`; due = bill date + 30) | `src/lib/inbound/complete-shipment.ts:195`, scheduled from `api/inbound/[id]/route.ts:453` | **Receive** on the last line of a shipment on `/inbound/[id]` | `inbound.edit` | **Automatic**, after the response, when the last line is received — skipped when the shipment already has a `zohoBillId` (it came from the Zoho import). Errors only reach the log |
| 3 | Inventory | `POST /items` | Creates a Zoho Inventory item `SH \| <name> - <condition>`, SKU `SH-0001…` | `api/second-hand/route.ts:124` | **Add Second-Hand Cycle** on `/second-hand/new` | `second_hand.create` | **Automatic** side effect of creating the cycle; errors swallowed |
| 4 | Inventory | `POST /items` | Creates an item `Inbound: <brand> - <billNo>` | `api/inbound/route.ts:348` | No screen calls `POST /api/inbound` — reachable only by calling the API | `inbound.create` | Automatic side effect of a manual shipment |
| 5 | OAuth | `POST /oauth/v2/token` (authorization code) | Exchanges the one-time grant code for a refresh token | `api/integrations/[provider]/connect/route.ts:52` | **Connect** on Settings › Integrations | `zoho.edit` | Button |
| 6 | OAuth | `POST /oauth/v2/token` (refresh) | Mints a new access token. No business data changes | `base.ts:215` | Any Zoho call when the token has under 5 minutes left, or after a 401 | the caller's | Automatic |
| 7 | OAuth | `POST /oauth/v2/token/revoke` | **Revokes the refresh token at Zoho.** On test it kills production's Zoho connection | `api/integrations/[provider]/disconnect/route.ts:28-31` | **Disconnect** on Settings › Integrations (no confirm dialog) | `zoho.edit` | Button |

Defined but never called: `BooksClient.createItem`, `createContact`, `createInvoice`. **No code writes vendor payments, credit notes, inventory adjustments, transfer orders, sales orders or e-way bills to Zoho.** Plans C and F would add the first two kinds of these.

### 6.3 Worth knowing, not changed by this plan

- **Row 2 is the one automatic bill write.** It names the vendor by the brand name, not by `vendor_id`, so Zoho may match the wrong vendor. It is skipped only when the shipment's `zohoBillId` is set, so an imported shipment with a null `zohoBillId` would be pushed back to Books as a duplicate. Part 1 makes `zohoBillId` reliable on bills; the push itself is §5's "manual-shipment bill push".
- **Row 7** checks no response status (only a network error is logged), carries the refresh token in the URL, and is missing from `OAUTH_ENDPOINTS` in `endpoints.ts`.
- **Row 1** sends `product.zohoItemId` to the **Books** API. That is correct only if Books and Inventory share one organisation and item ids. D2 says one Books organisation; Inventory sharing it is not verified.
- **Outside the app:** `scripts/zoho-probe.sh` (one token call, then reads) and the Postman collection in `docs/postman/`, which contains `POST`/`PUT` requests a person can run by hand.

---

## 7. Build record — 13 Oct 2026

Built on `feat/1210-credit-notes-and-payables` (from `test` @ `368e4d6`), against the local database `bch_dev_1210`.

- **Shared layer, written by the lead before the split:** the schema, migrations M1 and M2, the Zoho reads in `books.ts`/`endpoints.ts`/`base.ts`, the zod schemas in `validations.ts`, `src/lib/payables/store.ts` and `src/types`.
- **The four parts, built in parallel on disjoint files:**
  - **A, Zoho pipeline:** Parts 1.2–1.4, 3.3–3.5, 8.2–8.3.
  - **B, credits, Apply/Remove, payments, stores, bill detail:** Parts 2.3, 4, 5.
  - **C, ledger, vendor page, issue link:** Parts 6, 9.
  - **D, Pay first, aging, cash discount, `/bills`:** Part 7 and the `/bills` halves of 2.4 and 3.5.
- **The lead's own additions:** the code-57 refusal (`base.ts`) is no longer retried with a token refresh, and the `/vendors` list shows open credit.

**Migrations** (generated with `prisma migrate diff` against the local database and applied with `migrate deploy`, because `migrate dev` refuses a non-interactive shell). Both are additive only:

- `20261013073219_vendor_bill_zoho_id_and_credit_links`
- `20261013073357_payables_store_and_zoho_credits` — its header records why the plan's two backfill `UPDATE`s were left out.

**Applied to the local database only. Not to test, not to production.**

**Checks run:**

- `npx tsc --noEmit` is clean.
- `eslint` on all 54 changed files: 0 errors (3 warnings that were already there).
- No `console.log`, no role-name comparison, and no new raw `fetch().json()`.
- `npm run build` exit 0, with every new route listed.
- Each engineer ran their own checks against the local database inside transactions that were rolled back:
  - ledger paging and store sums;
  - the order of the priority list and the plan's examples;
  - the credit sync is idempotent, honours APP applications, flags over-application and handles void credits;
  - race tests: two people applying the last ₹500, and two ₹700 payments on a ₹1,000 bill.
- The lead ran **36 end-to-end checks** with the built app on localhost and a session for the local admin. They cover the credits section, apply 1,200, refusing an over-apply, the bill detail, the ledger (2 BILL + 1 CREDIT, no application line, closing 12,000), the priority list (8,800 open; "50 days old · 20 days past due"), payment refusals (`creditId`, an already-settled bill), a payment stamped with the bill's store, remove (everything restored to the paisa; removing twice → 404), aging, the CD report, customer credit notes, the zoho-link dry run, and eight pages answering 200. All passed, and the seeded rows were deleted.

**Not run:**

- The signed-in browser pass at 375 px (§4) — no browser tool in this session.
- Any credit pull against real Zoho — the token lacks the scope (Phase 0).

**Decisions the engineers took beyond the plan, and kept:**

1. **Payments.**
   - The ticked bills must add up to the payment amount (±₹0.01) — the old route silently lost any excess.
   - A cash discount is accepted only on a payment for exactly one bill.
   - Every money write keeps `DISPUTED`, and keeps a hand-set `OVERDUE` while money is still owed (the plan's `CASE` would have cleared both).
   - Bills are locked in id order so two payments cannot deadlock.
   - OVERDUE bills can now be paid from `/payments/new`.
2. **A bill is no longer imported without its Zoho detail.** Without it, the credit share of `paidAmount` is unknown, and the next credit pull would subtract it twice. The preview stays pending and is retried on the next import.
3. **Bill import and waiting applications.**
   - Waiting applications are adopted per application row, not by a blanket `updateMany`.
   - A credit that is void in Zoho and was never imported is skipped.
   - A store already set on a credit is never overwritten by a pull.
   - The missing-scope refusal answers **409** with the reconnect sentence, not 502.
4. **Open credit is clamped at 0 for each credit** (priority list, `/vendors`), so one over-applied credit cannot hide another credit's open amount. It is grouped by store, because Apply credit refuses to use one store's credit on another store's bill.
5. **Cash discount.** `cd-eligibility` answers "Bill already settled" for a settled bill instead of "CD expired". The CD report counts a settled bill with no payment recorded here as "date unknown".
6. **Stores.**
   - Linking a store to a Zoho location also fills sub-locations and the payments of the bills it fills.
   - A bill's or a credit's store is refused if it clashes with what is already linked to it.
   - The `/bills` import panel requires a store pick only when there are two or more stores.
7. `GET /api/bills/[id]` carries the open credits that fit the bill's store, so someone with `bills.view` but not `vendors.view` can still apply one.
8. Zoho pull-review export: an old one-column shift in the bill CSV rows was fixed.

**Open, not done here:**

- `PATCH /api/vendor-issues/[id]/reference` (brand change) does not unlink a credit linked to the old brand. The issue page warns; the PUT route handles it.
- The vendor page's Bills tab still lists the 10 bills with the earliest due date, which are often already paid.
- `vendor-credits.tsx`, `bills/[id]/page.tsx`, `payments/new/page.tsx` and `apply-credit-sheet.tsx` are each 480–710 lines (frontend-engineer red flag). They are split into sub-components inside each file.
- `/receivables` keeps one old raw `fetch().json()` (`:171`) — plan E's screen.
