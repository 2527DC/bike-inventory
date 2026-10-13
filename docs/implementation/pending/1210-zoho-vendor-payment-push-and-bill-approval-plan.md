# Vendor payments reach Zoho Books by a "Push to Zoho" button; purchase bills are approved in Zoho from the bill's page

Status: pending — written 12 Oct 2026; plan only, nothing built. Blocked on Q1, Q2, Q9, Q14 and on plan B's `VendorBill.zohoBillId` (both parts) and plan D's `BankAccount` (Part A).
Branch: **`feat/1210-zoho-payment-push-bill-approval`** — create it with exactly this name, off `main`.

Every `file:line` below was read from disk on 12 Oct 2026 (working tree of
`fix/1210-push-integrations-same-db-check`, which differs from `origin/main` only in
`scripts/db/push-integrations.mjs`). Every Zoho API claim names the Zoho documentation page it
came from; a claim that page does not settle is marked **unconfirmed** and becomes a sandbox
check in §4. Check rather than trust.

Sibling plans written the same day (all `docs/implementation/pending/1210-*`): **B** credit
notes and payables (owns `VendorBill.zohoBillId`), **D** bank accounts and suspense (owns
`BankAccount`). This plan consumes both and duplicates neither.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (8 Oct 2026)

> 2. can we push vendor payments to Zoho.

> 10. approving purchase bills in Zoho Books and posting them to vendor ledgers.

The owner answered the open questions on 12 Oct 2026 (D10, D11 in §1.1). Those answers sharpen
the requirements below; they do not replace the words above.

### 0.2 Restated as requirements

A few words used throughout, once:

- **Vendor bill** — the supplier's invoice: what we owe. **Vendor payment** — money we sent the
  supplier against one or more bills.
- **Zoho Books** — the accounting system the CA files from. It is the **source of truth for
  money** (`docs/agents/integration-architect.md`, principle 1). This app is the operations layer.
- **Bill approval (Zoho)** — with approvals switched on, a bill typed into Zoho sits as *Draft*
  or *Pending Approval* and does **not** count in the supplier's balance (the **vendor ledger**,
  the running statement of what we owe that supplier) until someone approves it.
- **Push** — this app creating a record in Zoho on a person's instruction.

| # | Requirement | Map | Part |
|---|---|---|---|
| R1 | A vendor payment recorded in this app can be created in Zoho Books by pressing **Push to Zoho** after it is saved, so nobody types it twice. | map R2 (D11) | A |
| R2 | Saving a payment never waits for Zoho and is never undone by a Zoho failure. A failed push leaves the payment saved and pushable again. | map R2 (D11) | A |
| R3 | Every payment shows whether it is **pushed**, **not pushed**, **failed**, or **not applicable** (a credit adjustment) — on a payment list, and wherever the app shows payments. | map R2 (D11) | A |
| R4 | One payment here becomes **at most one** payment in Zoho. A double tap, two people at once, or a retry after a timeout never creates a second. | map R2 — derived from integration-architect principle 3 | A |
| R5 | The Zoho payment is applied to the same bills, for the same amounts, from the same bank or cash account as recorded here. A credit-note adjustment is never sent as money paid. | map R2 | A |
| R6 | A purchase bill waiting for approval in Zoho can be **approved from the bill's page in this app**, so it posts to the supplier's ledger in Zoho. | map R10 (D10) | B |
| R7 | The app shows each bill's approval status **as Zoho reports it**, and reads it back from Zoho after approving. | map R10 | B |
| R8 | Who pushed or approved what, and when, is recorded in this app — and the person is named in Zoho too. | map R2, R10 | A, B |

---

## 1. Questions and clarifications — answer before build

### 1.1 Decisions on record

Answered in session, 12 Oct 2026 (the owner's answers to the accounts feature map, recorded in
`docs/implementation/requiremnts/accounts-and-compliance-feature-map.md` §4.1):

| # | Decision | Effect on this plan | Date |
|---|---|---|---|
| D2 | **One** Zoho Books organisation for both stores; the single `IntegrationConfig` row per provider is correct. | Every push and approval goes to one org; no per-store routing of the connection. | 12 Oct 2026 |
| D3 | Credit notes are typed in Zoho first and pulled here. The app does not create credit notes. | This plan never creates a vendor credit in Zoho — it shapes Q3 (cash discount) and Q7 (credit application). | 12 Oct 2026 |
| D9 | A credit note reduces the supplier balance on the day it is received; applying it to a bill later only links it. | Plan B's ledger rule. Relevant to Q3: a cash discount booked as a Zoho vendor credit must not be counted twice here. | 12 Oct 2026 |
| D10 | Bill approval **is switched on** in this Zoho Books (bills sit as draft / pending approval). R10 is wanted. | Part B is built. | 12 Oct 2026 |
| D11 | Vendor payment → Zoho by an explicit **Push to Zoho** button after save; a Zoho failure never blocks saving; the screen shows pushed / not pushed. | Part A. No push inside the save request, no automatic push. | 12 Oct 2026 |
| D16 | Bank statements and suspense lines get their own permission module, separate from `bills`. | Plan D's. This plan maps D's bank accounts to Zoho accounts from Settings › Integrations (`zoho.edit`), so it does not need D's module. | 12 Oct 2026 |

### 1.2 Open questions

Each one changes what gets built. **Blocks** = no build of that part until answered. A
recommended default is given so the owner can answer "defaults".

| # | Question | Why it changes the build | Options | Recommended default | Blocks | **Answer** |
|---|---|---|---|---|---|---|
| **Q1** | The payments **already recorded here** before this ships — were they also typed into Zoho by hand? | If yes, pushing them would put each one in Zoho twice. Decides the migration's backfill. | (a) mark every existing payment **Skipped — recorded before Push existed**; it can still be pushed after a duplicate check, with a stronger confirm; (b) leave them all as "not pushed" | (a) | **Part A** | |
| **Q2** | Where does the push learn **which Zoho account the money left from** ("paid through" — Zoho's name for the bank or cash account a payment is drawn on)? | Zoho needs `paid_through_account_id`. "NEFT" alone cannot say whether the money left ICICI or HDFC Hub, so the payment mode is not enough. | (a) a **Paid from** choice on each payment, picking one of plan D's named bank accounts, each mapped once to its Zoho account; Cash maps to one Zoho cash account; (b) an interim setting "payment mode → one Zoho account", replaced when D lands | (a) — needs plan D's `BankAccount` first | **Part A** | |
| **Q3** | **Cash discount (CD)** — the % a supplier knocks off for paying early. Zoho's vendor-payment API has **no discount field** (§2.8). How is the CD booked in Zoho? | Today the app counts `amount + cdDiscountAmount` as paid (`api/payments/route.ts:107`); Zoho would see only the cash, so the Zoho bill keeps an open balance equal to the CD. | (a) push the cash only; the accountant books the CD as a **vendor credit** in Zoho (D3: credits are typed in Zoho), and plan B's pull must recognise it and **not** subtract it a second time; (b) the app also creates and applies a vendor credit in Zoho for the CD — contradicts D3; (c) refuse to push a payment that carries CD | (a). Note: no screen sends a CD today (§2.3), so this bites only once plan B adds one | CD payments only | |
| **Q4** | A payment against a bill that has **no Zoho bill id** (entered by hand here, or not yet linked by plan B). | Zoho applies money to a bill by its Zoho id. Without it there is nothing to apply to. | (a) refuse the push with the reason; (b) push it unapplied, as an advance, and leave the accountant to apply it in Zoho | (a) — (b) makes Zoho's bill and ours disagree silently | — | |
| **Q5** | Who may press **Push to Zoho**? | A push writes to the legal books and cannot be undone from this app. | (a) `bills.approve`; (b) `bills.create` (whoever records it); (c) a new permission | (a) — the same grant as Approve in Zoho (R6): "may change the books in Zoho". `bills.approve` guards nothing today (§2.6) | — | |
| **Q6** | A payment typed **larger than the bills ticked** — e.g. ₹10,000 against ₹8,000 of bills. Today the extra ₹2,000 is silently not recorded at all (§2.9 L1). | The Zoho payment's amount must be what left the bank. | (a) record the remainder as an **advance** row in the same payment (Zoho keeps it as an excess payment against the supplier); (b) refuse the save until amount = bills ticked | (a) | — | |
| **Q7** | When plan B lets a **credit note be applied** to a bill here (`CREDIT_ADJUSTMENT`), must that application also reach Zoho? | It is not money, so it is never a vendor payment. Zoho records it with `POST /bills/{bill_id}/credits` (§2.8). | (a) no — credits are applied in Zoho and mirrored here (consistent with D3); (b) add a Part C: "Push credit application" | (a); revisit with plan B's decision | — | |
| **Q8** | How is "this exact payment is already in Zoho" recognised after a lost response? | Decides whether Zoho needs any setup. | (a) a reference token in the Zoho payment's **description**, searched with `description_contains` before any retry (no Zoho setup); (b) a Zoho custom field with "Prevent duplicate values" and Zoho's upsert headers | (a); (b) is a later hardening if the accountant edits descriptions | — | |
| **Q9** | **The Zoho connection itself:** which Zoho user connected it on Settings › Integrations; is that user an admin or bill **approver** in Zoho; which approval type is set for bills (Simple / Multi-level / Custom); and was the token generated with `ZohoBooks.fullaccess.all`? | Every API call acts **as that Zoho user**. If they cannot approve, Approve in Zoho cannot work; on Multi-level, one approval may not be final. Writes need `vendorpayments.CREATE` and `bills.CREATE` scopes (§2.8); a narrower token means reconnecting. | answer the four facts | — | **Part B** (scope: both) | |
| **Q10** | Approve only bills someone has **submitted** in Zoho (Pending Approval), or also **Drafts** (submit + approve in one go)? | A draft may still be half-typed by whoever is entering it. | (a) Pending Approval only; a Draft shows "Draft in Zoho — submit it in Zoho first"; (b) both | (a) | — | |
| **Q11** | Add a **comment on the Zoho bill** naming the app user ("Approved from BCH OPS by Ravi")? | Zoho's own history will show the *connection's* user (Q9), not the person who pressed the button. | yes / no | yes — one extra call, best effort | — | |
| **Q12** | After approval, if Zoho's **bill total differs** from ours (edited in Zoho before approving), overwrite our amount? | Integration principle 1 says Zoho wins on money; but overwriting a bill that already has payments here can flip its status. | (a) show the difference and log it, do not overwrite; (b) overwrite when the bill has no payments here | (a) — plan B's re-import owns financial resync | — | |
| **Q13** | Does this Zoho Books org use **Locations** (Hub and Centre as branches, each with its GSTIN)? | A payment may need `location_id` (§2.8). | yes / no | copy `location_id` from the Zoho bill being paid; an advance sends none — confirm in the sandbox | — | |
| **Q14** | **Safe testing.** Since 12 Oct the test database holds **production's live Zoho credentials**. Approve: (1) a separate Zoho Books **trial organisation** connected on test and locally, and (2) an environment guard `ZOHO_BOOKS_WRITE_ORG_ID` — this plan's Zoho writes refuse unless the connected org is the one named for that deployment? | Without both, the first test push lands in the real Bharath Cycle Hub books (§4). | (a) both; (b) trial org only | (a) | **all Zoho-write testing** | |

---

## 2. How it works today — verified against the code

### 2.1 The Zoho client layer

- **One client per provider, one base.** `IntegrationClient` (`src/lib/integrations/base.ts:164`)
  holds OAuth, refresh and the HTTP call; `BooksClient` (`books.ts:5-7`) adds Books-only
  methods against `https://www.zohoapis.in/books/v3`. Callers get a ready client from
  `getBooks()` (`index.ts:59-62`), request-scoped and `null` when not connected.
- **`apiCall` is `protected`** (`base.ts:292`), so every Zoho call must be a client method — the
  compiler enforces it (`base.ts:275-285`). It appends `organization_id` (`:304`), logs the
  endpoint key and byte count, never the body (`:316-323`), retries once after a 401 by
  refreshing the token (`:327-344`), backs off on 429 up to three times (`:346-359`), and reads
  the body with `readJson` (`:364-368`).
- **A Zoho refusal is a plain `Error`.** `if (data.code !== 0 && data.code !== undefined)` throws
  `new Error(data.message …)` (`base.ts:369-372`). The final 401 (`:342-343`) and final 429
  (`:355-358`) are plain `Error`s too. A gateway timeout or HTML page is an `UpstreamError` with a
  status (`src/lib/http-json.ts:19-31, 44-67`); a dropped connection is whatever `fetch` throws.
  **Nothing lets a caller tell "Zoho refused, nothing was created" from "we don't know what
  happened"** — the distinction R4 depends on.
- **Token refusal is recorded** in `IntegrationConfig.lastAuthErrorAt` (`base.ts:225-246`) and
  cleared on the next success (`:253-263`).
- **The registry** (`src/lib/integrations/endpoints.ts:47-219`) lists every endpoint with its
  owning method; adding a Zoho call means a method *and* an entry (`:20-22`). Writes today:
  `items.create`, `items.update`, `contacts.create`, `invoices.create`, `bills.create`
  (`:100-171`). **No vendor-payment endpoint, no bill approval, no account list.** (Its header
  says `docs/integrations-endpoints.md` is generated from it (`:17-18`); neither that file nor a
  generator exists.)
- **Books write convention:** the payload is wrapped as `{ JSONString: JSON.stringify(…) }`
  (`books.ts:17-27, 46-53, 184-200`).

### 2.2 How the existing Zoho writes are built

| Write | Call site | Idempotency | What happens on failure |
|---|---|---|---|
| `createBill` | `src/lib/inbound/complete-shipment.ts:195-208` | A database claim: `updateMany … status: { not: "DELIVERED" }`, exactly one caller gets `count === 1` (`:15-25`). Skipped when the shipment came from a Zoho bill (`:172-178`). | `log.warn("Zoho bill push failed (non-critical)")` (`:213-218`); the response — including Zoho's new bill id — is **discarded**. |
| `updateItem` | `src/app/api/stock/price-check/[productId]/route.ts:76-87` | None needed: it overwrites one field. | `zohoError` returned to the screen; the `catch` (`:83-86`) does not log. |

So the house pattern for "fire once" is the **claim** (a conditional update the database
decides), and the house pattern for "Zoho is down" is "the local change stands, report the
failure". Neither existing write stores what Zoho returned. This plan copies the claim and the
"local change stands" rule, and adds the part neither has: recording Zoho's id and recovering
from an unknown outcome.

### 2.3 Vendor payments

**Model** — `VendorPayment`, `prisma/schema.prisma:1323-1346`: `vendorId`, optional `billId`,
`amount Float`, `cdDiscountAmount Float @default(0)`, `paymentMode PaymentMode`, `paymentDate`,
`referenceNo?`, `notes?`, optional `creditId → VendorCredit`, `recordedById`. **No Zoho column of
any kind**, no bank account, no grouping. `PaymentMode` is `CASH | CHEQUE | NEFT | RTGS | UPI |
CREDIT_ADJUSTMENT` (`:160-167`).

**Saving** — `POST /api/payments` (`src/app/api/payments/route.ts:40-154`), guard
`requireFeature("bills", "create")` (`:42`), zod `vendorPaymentSchema`
(`src/lib/validations.ts:598-612`).

- **A multi-bill payment is N rows, one per bill** (`:82-114`). The only thing tying them
  together is a note suffix, `"[Multi-bill payment: ₹${data.amount}]"` (`:94-96`). There is no
  group id. One bank transfer covering three bills is three unrelated rows.
- Cash discount goes on the row only when there is a single allocation (`:89`), and the bill is
  marked paid by `amount + cd` (`:106-108`).
- **An advance** (no bill) is one row with `billId: null` (`:115-133`).
- **A credit adjustment** is any row carrying `creditId`; nothing ties it to
  `paymentMode: CREDIT_ADJUSTMENT` (F4, plan B fixes).
- **The save never talks to Zoho** — so D11's "a Zoho failure never blocks saving" is already
  true and must stay true.
- No logger in the file; neither `catch` logs (`:35-37, :150-153`).

**The form** — `/payments/new` (`src/app/(dashboard)/payments/new/page.tsx`). Modes offered:
`CASH, CHEQUE, NEFT, RTGS, UPI` (`:13`) — no `CREDIT_ADJUSTMENT`, **no CD field, no "paid from"
field**. Bills are auto-allocated oldest-first (`:121-131`). Submits with raw `fetch` (`:244-256`)
and then `router.push("/accounts")` (`:259`) — the person never sees the saved payment.

**The other creator** — bank reconciliation. `POST /api/bank-statements/[id]/review` creates a
`VendorPayment` from a bank line, guessing the mode from the reference prefix
(`src/app/api/bank-statements/[id]/review/route.ts:97-104` bulk, `:149-159` single). It knows
which statement the line came from, but `BankStatement.bank` is a free string, "HDFC" or "ICICI"
(`schema.prisma:1406`).

**Where payments are shown** — there is **no payment list screen**. `GET /api/payments`
(`route.ts:9-38`) has no caller in `src/`. Payments appear only as the five "Recent Payments" on
`/accounts` (`src/app/(dashboard)/accounts/page.tsx:273-290`, fed by
`api/accounts/summary/route.ts:52-56`) and as cards under one bill on `/bills/[id]`
(`src/app/(dashboard)/bills/[id]/page.tsx:200-226`).

**Edit and delete** — none. No route updates or deletes a `VendorPayment` (grep for
`vendorPayment.update|delete` finds nothing). A payment, once saved, is permanent here.

### 2.4 The Zoho ids a push needs, and whether the app has them

| Zoho field | App source | Today |
|---|---|---|
| `vendor_id` | `Vendor.zohoVendorId` (`schema.prisma:1124`) | Present for vendors created by the bill import (plan 2409, `src/lib/vendors/resolve-zoho-vendor.ts:41-77`); **null** for vendors created by hand. If a bill was pulled while only Zakya was connected, the id is Zakya's, which Books does not know (`resolve-zoho-vendor.ts:16-17`). |
| `bills[].bill_id` | — | **`VendorBill` has no Zoho bill id** (F7). Only `InboundShipment.zohoBillId` (`schema.prisma:2457`), set by the `/inbound` import (`api/zoho/pull-review/approve/route.ts:516`). A bill imported from `/bills` has no shipment, so no id at all. **Plan B adds `VendorBill.zohoBillId`, stamps it at import and backfills it.** |
| `paid_through_account_id` | — | Nothing. No bank-account table (plan D adds `BankAccount`), no Zoho account list in the registry. |
| `location_id` | — | Nothing (Q13). |

### 2.5 Purchase bills and Zoho approval today

- **The pull asks Zoho for every bill in the date window, with no status filter.** `listBills`
  builds `/bills?page&per_page=200&date_start&date_end&search_text` (`base.ts:383-393`); the
  bills step calls it via `listAllBills` (`api/zoho/trigger-pull/route.ts:286`).
- **Zoho's status is captured, then dropped.** The preview row keeps `status: bill.status`
  (`trigger-pull/route.ts:366`), but the `VendorBill` the import creates has no field for it
  (`api/zoho/pull-review/approve/route.ts:442-452`); the app's own `BillStatus` is derived only
  from `balance` (`:450`). So **whether drafts and pending-approval bills are being imported
  today is not recorded anywhere** — and if they are, they are counted as owed with no marker.
- **Whether a no-filter `GET /bills` returns drafts is not documented** (§2.8). It is answerable
  from data without touching Zoho: on a local restore of production (CLAUDE.md migration rule 10),
  `SELECT data->>'status', count(*) FROM "ZohoPullPreview" WHERE "entityType" = 'bill' GROUP BY 1;`
  — step B0 runs it.
- **No approval call exists** anywhere in `src/`.
- `/bills/[id]` shows the bill, CD status, payments and a WhatsApp reminder
  (`bills/[id]/page.tsx:104-227`); no Zoho information. The list `/bills` filters by the app's
  status (`bills/page.tsx:59`) and shows the app's status badge (`:520, :560`).

### 2.6 Permissions today

- `bills` — `view, create, edit, delete, approve`, route `null`
  (`prisma/rbac-catalog.ts:500-508`). **`bills.approve` is checked nowhere** — no route, no
  screen (grep for `"bills", "approve"` and `canApprove("bills")` finds nothing). It is a grant
  with no meaning yet.
- `zoho` — `view, edit, approve, fetch`, route `null` (`rbac-catalog.ts:888-900`). `fetch` gates
  pulling from Zoho (`trigger-pull/route.ts:114`); `edit` gates connecting
  (`api/integrations/[provider]/connect/route.ts`); `approve` gates importing a pull
  (`pull-review/approve/route.ts:87`).
- `ActionKey` is `view | create | edit | delete | approve | fetch` (`rbac-catalog.ts:10`).

### 2.7 The audit trail helper

`logActivity(db, entry)` (`src/lib/activity-log.ts`): inside a transaction the log row is part of
the change and a failure fails it; on the root client it is best-effort and never throws. The
activity feed maps the `zoho` module to the "Zoho" category already
(`src/app/api/activity/route.ts:208-218`) and renders unknown actions by replacing `_` with
spaces.

### 2.8 What Zoho's API offers — read from Zoho's documentation, 12 Oct 2026

| Need | Endpoint | Source | Confirmed |
|---|---|---|---|
| Create a vendor payment | `POST /vendorpayments` — only `amount` is required; also `vendor_id`, `bills[] { bill_id, amount_applied, tax_amount_withheld }`, `date`, `payment_mode` (free text), `paid_through_account_id` ("ID of the cash/bank account from which the payment is made"), `reference_number`, `description`, `location_id`, `custom_fields`. Scope `ZohoBooks.vendorpayments.CREATE`. Response message "The payment made to the vendor has been recorded." with `payment_id`, `payment_number`. **No discount field.** | <https://www.zoho.com/books/api/v3/vendor-payments/> and its `vendor-payments.yml` | yes. Whether the response nests the payment under `vendorpayment` is **unconfirmed** (the spec shows it flat) |
| Find a payment we may already have created | `GET /vendorpayments` with `vendor_id`, `bill_id`, `reference_number`, `description_contains`, `date`, `amount_greater_equals` / `amount_less_equals` | same | yes |
| Read / delete one | `GET /vendorpayments/{payment_id}`, `DELETE /vendorpayments/{payment_id}` | same | yes. The error code for "does not exist" is **unconfirmed** |
| Upsert by a unique custom field | `PUT /vendorpayments` with `X-Unique-Identifier-Key`, `X-Unique-Identifier-Value`, `X-Upsert: true` — creates when no match (field must have "Prevent duplicate values") | same page (endpoint listed); behaviour from <https://help.zoho.com/portal/en/community/topic/update-or-upsert-records-using-unique-custom-fields> | endpoint yes; create-on-miss for vendor payments **unconfirmed** (Q8 option b only) |
| Approve a bill | `POST /bills/{bill_id}/approve`, no body, scope `ZohoBooks.bills.CREATE`, response `code 0`, message "success" | <https://www.zoho.com/books/api/v3/bills/> and its `bills.yml` (operationId `approve_bill`) | yes |
| Submit a bill for approval | `POST /bills/{bill_id}/submit`, no body, scope `ZohoBooks.bills.CREATE`, message "The bill has been submitted for approval successfully." | same (`submit_bill`) | yes |
| Comment on a bill | `POST /bills/{bill_id}/comments`, body `{ description }` (required) | same (`add_bill_comment`) | yes |
| Apply vendor credits / excess payments to a bill | `POST /bills/{bill_id}/credits`, body `{ bill_payments[] { payment_id, amount_applied }, apply_vendor_credits[] { vendor_credit_id, amount_applied } }` | same (`apply_credits_to_bill`) | yes (used only if Q7 = b) |
| Bill statuses | List filter `status` accepts `paid, open, overdue, void, partially_paid, unpaid, draft, pending_approval, approval_overdue, my_approvals, rejected, approved`; `filter_by` includes `Status.All`, `Status.Draft`, `Status.Pending` | `bills.yml` | values yes; **whether the no-filter list includes drafts, and which status a bill shows right after approval (`open` or `approved`), are unconfirmed** |
| Approval workflow | Statuses Draft → Pending Approval → Approved / Rejected; submission is from Draft; types Simple / Multi-level / Custom; admins can "Final Approve" past the hierarchy | <https://www.zoho.com/books/help/transaction-approval/transaction-approval-workflow.html> | yes (UI behaviour; the API's Multi-level behaviour is **unconfirmed**) |
| List accounts to map "paid through" | `GET /chartofaccounts` (`account_type` includes `cash`, `bank`; scope `ZohoBooks.accountants.READ`); or `GET /bankaccounts` (scope `ZohoBooks.banking.READ`, bank accounts only) | <https://www.zoho.com/books/api/v3/chart-of-accounts/>, <https://www.zoho.com/books/api/v3/bank-accounts/> | yes |

### 2.9 Live defects found while mapping

In code this plan touches or depends on. Ownership is stated; nothing outside this plan's files
is changed by it.

| # | Defect | Where | Effect | Owner |
|---|---|---|---|---|
| **L1** | The rows created use `alloc.amount`; `data.amount` appears only in a note. | `api/payments/route.ts:83-101, :94-96`; the form rounds the amount to whole rupees (`payments/new/page.tsx:159`) | Type ₹10,000 against ₹8,000 of bills: **₹2,000 is never recorded**. A push would then send ₹8,000 for a ₹10,000 bank debit. | this plan, A4 (Q6) |
| **L2** | Re-fetching a window **deletes** every existing `VendorBill` with no shipment and no payments, then re-offers it as new. | `api/zoho/trigger-pull/route.ts:306-312` | Every unpaid bill imported from `/bills` (which never has a shipment, by design) is deleted on the next overlapping fetch. Optional relations default to SetNull, so `VendorIssue.billId`, `BankTransaction.suggestedBillId` and `BrandLedgerEntry.billId` (`schema.prisma:1913, 1441, 3240`) are silently cleared. Part B's approval stamps would vanish with the row. | **plan B** (owns the pull and the Zoho-id match) |
| **L3** | An imported bill is matched to an existing `VendorBill` by `billNo` alone. | `pull-review/approve/route.ts:220`; `trigger-pull/route.ts:302-305` | Two suppliers who both number a bill "1" share one row; a push could apply money to the wrong Zoho bill. A3's pre-check catches it (Zoho bill's `vendor_id` ≠ our vendor's). | **plan B** |
| **L4** | Void Zoho bills are imported as owed. The invoice step skips `void` (`trigger-pull/route.ts:454-459`); the bill step does not (`:246-376`). | same | A voided supplier bill shows as payable. Part B's status chip at least shows "Void in Zoho". | **plan B** |
| **L5** | Zoho refusals and network failures throw the same `Error`. | `base.ts:342-343, 355-358, 369-372` | A push cannot tell "nothing was created, safe to retry" from "maybe created". | this plan, A2 |
| **L6** | `createBill` sends `vendor_name: snapshot.brandName` and discards the returned bill id. | `complete-shipment.ts:195-196` | Bills raised by the app in Zoho are under the brand's name, and can never be approved or paid from here. | out of scope (§5) — raise |
| **L7** | Raw `fetch().then(r => r.json())` in screens this plan edits. | `bills/[id]/page.tsx:55-71`; `payments/new/page.tsx:78-112, 177-178, 244-256`; `bills/page.tsx:97-101, 118-122` | CLAUDE.md non-negotiable; an expired session reads as `Unexpected token '<'`. | this plan, where touched |
| **L8** | `connect` keeps the **stored** organisation id when none is given. | `api/integrations/[provider]/connect/route.ts:61` | On the test database, reconnecting with a new token but a blank org id leaves the **production org id** in place. Part of why Q14 asks for a guard. | Q14 |

---

## 3. Implementation plan

Two parts, one commit each, on one branch. **Build Part B first**: a push refuses a bill that is
not yet approved in Zoho (A5 step 4), so approval should exist before push does. Each part has
its own migration so either can ship alone.

### How a push works, in one picture

```
 Save (unchanged rule: never talks to Zoho)        Push to Zoho (separate tap, bills.approve)
 ───────────────────────────────────────           ─────────────────────────────────────────────
 POST /api/payments                                 POST /api/payments/[id]/zoho-push
   rows = one per bill (+ advance remainder)          1 local checks   ── refuse: 400, nothing claimed
   all rows share paymentGroupId                      2 CLAIM  (database decides, one winner)
   ↓                                                  3 Zoho:  [retry?] search by token → adopt
 the payment exists here, "Not pushed"                        read each bill → payable?
                                                              look for a look-alike payment
                                                              POST /vendorpayments
                                                      4 record: PUSHED + Zoho id   | FAILED (Zoho said no)
                                                                                   | UNKNOWN (no answer)
```

**Idempotent** means: doing it twice has the same result as doing it once. Two mechanisms give
R4: the **claim** stops two pushes running at the same time; the **token** in the Zoho payment's
description lets a later attempt find what an earlier, unanswered attempt created.

---

### Part A — Push vendor payments to Zoho (R1–R5, R8)

#### A1 — schema and migration

The brief proposed the Zoho columns on `VendorPayment`. They go on a **separate row per money
movement** instead, because a multi-bill payment is several `VendorPayment` rows (§2.3) that must
become **one** Zoho payment: with the columns on each row, `zohoPaymentId` could not be unique
and two rows of one payment could disagree about whether it was pushed.

```prisma
/// Where one money movement stands with Zoho Books. One row per group of VendorPayment rows
/// (a multi-bill payment is several rows sharing paymentGroupId). Created at the first push,
/// never before: a payment with no row here has simply not been pushed.
/// A PUSHED row freezes its payments — any future edit or delete route for VendorPayment must
/// refuse while status = PUSHED, or carry the change to Zoho (PUT/DELETE /vendorpayments/{id}).
enum ZohoPushStatus {
  PUSHING   // claimed; a request is (or was) talking to Zoho
  PUSHED    // Zoho has it — zohoPaymentId is set
  FAILED    // Zoho answered NO; nothing was created; safe to push again
  UNKNOWN   // no answer (timeout, 5xx, dropped connection); the next push searches Zoho first
  SKIPPED   // recorded before Push existed (Q1 = a); can still be pushed after the duplicate check
}

model ZohoPaymentPush {
  id                String         @id @default(cuid())
  groupKey          String         @unique // VendorPayment.paymentGroupId, or the payment's own id when it has none
  vendorId          String
  vendor            Vendor         @relation(fields: [vendorId], references: [id], onDelete: Restrict)
  status            ZohoPushStatus
  zohoPaymentId     String?        @unique // one Zoho payment is never linked to two groups
  zohoPaymentNumber String?
  adopted           Boolean        @default(false) // found in Zoho or linked by hand, not created by us
  attempts          Int            @default(0)
  claimedAt         DateTime?      // when PUSHING was set — a claim older than 2 minutes is stale
  lastAttemptAt     DateTime?
  lastAttemptById   String?        // plain id, like ActivityLog.userId — who pressed last
  lastError         String?        @db.Text // the sentence shown on the screen
  pushedAt          DateTime?
  pushedById        String?
  pushedBy          User?          @relation("ZohoPaymentPushedBy", fields: [pushedById], references: [id], onDelete: Restrict)
  note              String?        // why SKIPPED
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt

  payments VendorPayment[]

  @@index([status])
  @@index([vendorId])
}

model VendorPayment {
  …
  paymentGroupId String?          // shared by every row one save created; null on rows saved before this
  zohoPushId     String?
  zohoPush       ZohoPaymentPush? @relation(fields: [zohoPushId], references: [id], onDelete: Restrict)
  bankAccountId  String?          // "paid from" — plan D's account; null for CASH
  bankAccount    BankAccount?     @relation(fields: [bankAccountId], references: [id], onDelete: Restrict)
  …
  @@index([paymentGroupId])
  @@index([zohoPushId])
}

model BankAccount {   // plan D's model — D's migration CREATES this column (D's §3, BankAccount); shown here only because this plan reads it
  …
  zohoAccountId String? @unique // the Zoho Books account this bank account is, for paid_through
}
```

Plus the back-relations on `User` (`zohoPaymentsPushed`), `Vendor` (`zohoPaymentPushes`) and
`BankAccount` (`vendorPayments`). **No money column is added** (the database-architect red flag on
`Float` money; the existing `Float` columns are untouched). `pushedById` is **Restrict**, for the
reason `ApprovalEvent` gives (`schema.prisma:2715-2718`): who put money into the books must
survive; users are deactivated, never deleted. The Cash account mapping is one `AppSetting` row,
key `zoho.paid_through.cash` (`AppSetting`, `schema.prisma:2767`) — no column.

**Who owns which column.** `VendorPayment.bankAccountId` is **this plan's** (plan D's sibling
table agrees: "C owns any `VendorPayment.bankAccountId` column"). `BankAccount.zohoAccountId` is
**plan D's**: D creates the `BankAccount` table with that column already in it, so this plan's
migration does **not** add it — an `ADD COLUMN` here would fail against D's table. Reconciled by
the coordinator, 12 Oct 2026.

**Migration** — `npx prisma migrate dev --name zoho_vendor_payment_push`, **on localhost only**
(rule 2), after plan B's and plan D's migrations exist. Expected SQL, then read it (rule 3):

```sql
CREATE TYPE "ZohoPushStatus" AS ENUM ('PUSHING','PUSHED','FAILED','UNKNOWN','SKIPPED');
CREATE TABLE "ZohoPaymentPush" ( … );                         -- new table, empty
CREATE UNIQUE INDEX … ("groupKey");  CREATE UNIQUE INDEX … ("zohoPaymentId");
CREATE INDEX … ("status");  CREATE INDEX … ("vendorId");
ALTER TABLE "VendorPayment" ADD COLUMN "paymentGroupId" TEXT,
                            ADD COLUMN "zohoPushId" TEXT,
                            ADD COLUMN "bankAccountId" TEXT;   -- nullable: metadata only
CREATE INDEX … ("paymentGroupId");  CREATE INDEX … ("zohoPushId");
-- BankAccount.zohoAccountId is NOT added here: plan D's migration creates it with the table.
ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY …;                -- four FKs
```

Only if **Q1 = (a)**, hand-append the backfill (count the rows first:
`SELECT count(*) FROM "VendorPayment";`). It marks every payment that exists when the migration
runs — which is exactly "recorded before Push existed", with no date literal to get wrong:

```sql
INSERT INTO "ZohoPaymentPush" ("id","groupKey","vendorId","status","note","createdAt","updatedAt")
SELECT 'legacy_' || p."id", p."id", p."vendorId", 'SKIPPED',
       'Recorded before Push to Zoho existed — check Zoho before pushing', now(), now()
FROM "VendorPayment" p
WHERE p."paymentMode" <> 'CREDIT_ADJUSTMENT' AND p."creditId" IS NULL;

UPDATE "VendorPayment" p SET "zohoPushId" = 'legacy_' || p."id"
WHERE p."paymentMode" <> 'CREDIT_ADJUSTMENT' AND p."creditId" IS NULL;
```

Rule 3: no `DROP`, no type change, no `SET NOT NULL`; the `UPDATE` writes a new nullable column on
a populated table, one statement. Rule 7: additive — the old code never reads the new columns and
keeps inserting rows with them null, which read as "Not pushed". Rule 9: `npm run db:snapshot`
before merging. Rule 4: applied **by hand** (`migrate status`, then `migrate deploy`) on each
target before the code goes live. Legacy multi-bill rows have no group id, so each would push as
its own Zoho payment; they are `SKIPPED` under Q1 = (a), which is why no attempt is made to
re-group them.

#### A2 — the Zoho client (`src/lib/integrations/`)

1. **`base.ts` — a typed refusal (L5).** Export
   `class ZohoApiError extends Error { code: number; definite: true }` and throw it at
   `:369-372` (with Zoho's `code`), at the final 401 (`:342-343`, code `-401`) and the final 429
   (`:355-358`, code `-429`) — in all three Zoho did **not** process the request. Additive:
   existing callers catch `Error` and read `.message`, which is unchanged.
2. **`base.ts` — the write guard (Q14).** `protected assertWritesAllowed()`: throws
   `ZohoApiError(code -403, "Zoho writes are switched off in this environment …")` unless
   `process.env.ZOHO_BOOKS_WRITE_ORG_ID === this.organizationId`. **Every new write method below
   calls it first.** An environment variable, not a setting, deliberately: the test database is
   a copy of production's (CLAUDE.md rule 10) and a database setting would travel with the copy;
   an environment variable belongs to the deployment. Existing writes (`createBill`, `createItem`,
   `createInvoice`, `createContact`, `updateItem`) are not changed (§5).
3. **`books.ts` — new methods**, each with a registry entry:

| Method | HTTP | Registry key | Notes |
|---|---|---|---|
| `createVendorPayment(p)` | `POST /vendorpayments` | `vendorpayments.create` | `JSONString` wrapping (`books.ts` convention). Returns `{ paymentId, paymentNumber }`, reading `res.vendorpayment ?? res` (nesting unconfirmed, §2.8). |
| `listVendorPayments(q)` | `GET /vendorpayments?vendor_id&bill_id&description_contains&date&amount_greater_equals&amount_less_equals&per_page=25` | `vendorpayments.list` | Read only — no guard. |
| `getVendorPayment(id)` | `GET /vendorpayments/{payment_id}` | `vendorpayments.get` | Read only. |
| `listCashAndBankAccounts()` | `GET /chartofaccounts?filter_by=AccountType.Active` | `chartofaccounts.list` | Filtered to `account_type` `cash` or `bank` in the method. |

4. **`endpoints.ts`** — the four entries under "Zoho Books only", `providers: BOOKS_ONLY`, with
   the purpose written as a sentence, as the existing ones are.

#### A3 — pure helpers: `src/lib/zoho/vendor-payment-push.ts` (new)

Pure functions only (backend-engineer: business logic stays in the route):

- `groupKeyOf(p) = p.paymentGroupId ?? p.id`.
- `pushToken(groupKey) = "BCHOPS-" + groupKey` — goes into `description` as
  `"Recorded in BCH OPS by <name> · ref BCHOPS-<groupKey>"`. `reference_number` stays the bank's
  UTR / cheque number, because that is what Zoho's own bank matching needs.
- `ZOHO_PAYMENT_MODE` — `CASH → "Cash"`, `CHEQUE → "Check"`, `NEFT|RTGS → "Bank Transfer"`,
  `UPI → "UPI"`. `payment_mode` is free text in the spec; which labels this org shows is
  **unconfirmed** — the sandbox walk fixes the map.
- `zohoDate(d)` — `YYYY-MM-DD` in **Asia/Kolkata**, never `toISOString().slice(0, 10)`: a
  payment dated from a bank line at IST midnight is the previous day in UTC (the same trap
  `trigger-pull/route.ts:222-227` documents).
- `buildVendorPaymentPayload(group, ctx)` → `{ vendor_id, amount, date, payment_mode,
  paid_through_account_id, reference_number, description, bills: [{ bill_id, amount_applied }],
  location_id? }`. `amount` = sum of the group's rows (cash only, rounded to paise);
  `bills` = the rows that have a bill; an advance row contributes to `amount` but not to `bills`,
  which Zoho keeps as an excess payment. **`cdDiscountAmount` is never sent** (Q3).
- `classifyZohoFailure(err)` → `"refused"` for `ZohoApiError` and for `UpstreamError` with
  status < 500; `"unknown"` for everything else (5xx, timeouts, dropped connections).
- `PAYABLE_ZOHO_STATUSES = ["open", "overdue", "partially_paid", "unpaid"]` (shared with Part B's
  `src/lib/zoho/bill-status.ts`).

#### A4 — saving a payment (`POST /api/payments`)

`src/app/api/payments/route.ts`. **Plan B edits this handler too** (F4: credit vendor check,
atomic increments, `creditId` ↔ `CREDIT_ADJUSTMENT`). Build after B's change is merged and rebase
onto it; the two edits touch different lines but the same function.

- `vendorPaymentSchema` (`validations.ts:598-612`) gains `bankAccountId: z.string().optional()`.
- One `paymentGroupId = cuid()` per save, written on **every** row the save creates.
- `bankAccountId` written on every row (must be an active `BankAccount`; `400` otherwise; ignored
  for `CASH`).
- **L1 / Q6 = (a):** when `data.amount − Σ allocations > 0.01`, add one advance row
  (`billId: null`) for the remainder in the same group, and drop the note-suffix hack (`:94-96`)
  — the group id replaces it. If Q6 = (b): `400 "The amount is ₹X more than the bills ticked —
  tick another bill, or lower the amount"`.
- Response gains `paymentGroupId`.
- `createLogger("payments")`: `log.info("payment recorded", { paymentGroupId, vendorId, rows,
  amount, bankAccountId })`; both `catch` blocks log with `vendorId` before responding (finding F4: no logging in `/api/payments`).
- **No Zoho call.** D11.

#### A5 — the push, link and re-check routes

All three: `export const maxDuration = 60`, `requireFeature("bills", "approve")` (Q5), zod at the
boundary, sentences a person can act on. **No database transaction is held open across a Zoho
call.**

**`POST /api/payments/[id]/zoho-push`** — body `zohoPaymentPushSchema =
z.object({ bankAccountId: z.string().optional(), ignoreLookAlikes: z.boolean().optional() })`.
`[id]` is any row of the group; the server finds the rest.

1. **Load** the group: rows where `paymentGroupId = key` or `id = key`, with vendor, bill
   (`zohoBillId`, `zohoStatus`, `billNo`), `zohoPush`, `bankAccount`.
2. **Local checks — refuse with `400`, nothing claimed:**
   - any row with `creditId` or `paymentMode = CREDIT_ADJUSTMENT` → *"This is a credit note
     applied to a bill, not money paid. It is not sent to Zoho as a payment."* (Q7)
   - `vendor.zohoVendorId` null → *"<Vendor> is not linked to Zoho. Import it from Zoho on the
     Vendors screen first."*
   - any billed row whose bill has no `zohoBillId` → *"Bill <no> has no Zoho bill id, so Zoho
     cannot be told which bill this pays."* (Q4 = a)
   - paid-through unresolved: `CASH` with no `zoho.paid_through.cash` setting, or a bank mode with
     no `bankAccountId` on the rows and none in the body, or an account with no `zohoAccountId`
     → the sentence names which of the three, and where to fix it.
3. **Claim** (one `$transaction`, the database decides):
   - no push row yet → `create { groupKey, vendorId, status: PUSHING, claimedAt: now, attempts: 1,
     lastAttemptById }` and `updateMany` the group's rows `where zohoPushId: null` →
     `zohoPushId`. `P2002` on `groupKey`, or a row count that is not the group size, means
     someone else claimed it first → roll back, `409`.
   - a push row exists → `updateMany where { id, OR: [{ status: { in: [FAILED, UNKNOWN, SKIPPED] } },
     { status: PUSHING, claimedAt: { lt: now − 2 min } }] }` → `{ status: PUSHING, claimedAt: now,
     attempts: { increment: 1 } }`. `count === 0` → re-read and `409`:
     PUSHED → *"Already in Zoho as <number>."*; PUSHING → *"Someone is pushing this right now —
     try again in a minute."* A stale `PUSHING` (the function died — `maxDuration` is 60 s, the
     stale mark is 2 min) is taken over with `log.warn("stale claim recovered")`.
   - write `bankAccountId` from the body onto rows that have none.
4. **Zoho**, with `getBooks()` (`null` → `FAILED`, *"Zoho Books is not connected"*):
   1. **Retry?** If `attempts > 1`: `listVendorPayments({ vendor_id, description_contains:
      token })`. One match → **adopt**: `PUSHED`, `adopted: true`, done. Two or more → `UNKNOWN`,
      *"Zoho holds two payments with this reference — keep one in Zoho, then press Push again."*
   2. **Read each bill** (`getBill`): Zoho's `vendor_id` must equal our vendor's (catches L3);
      status must be payable; `balance ≥ amount_applied − 0.01`. Stamp the bill's `zohoStatus`
      while here (Part B column). Draft / pending approval → `FAILED`, *"Approve bill <no> in Zoho
      first."* Balance too low → `FAILED` plus the bill's Zoho payments as **look-alikes**
      (`listVendorPayments({ bill_id })`) — it may already have been typed in by hand. Copy
      `location_id` from the bill (Q13); refuse if the group's bills disagree.
   3. **Look-alikes** — unless `ignoreLookAlikes`: `listVendorPayments({ vendor_id, date,
      amount_greater_equals: total, amount_less_equals: total })` minus any carrying our token.
      Any found → status `FAILED` with `lastError` *"Zoho already has a payment to <vendor> for
      ₹X on <date>"*, and the response is `409 { lookAlikes: [{ paymentId, number, date, amount,
      reference }] }` so the screen can offer **Link** or **Push anyway**. This is what protects
      the legacy rows (Q1) and anything the accountant typed by hand meanwhile.
   4. **Create** — `createVendorPayment(buildVendorPaymentPayload(…))`.
5. **Record** (one transaction): `PUSHED`, `zohoPaymentId`, `zohoPaymentNumber`, `pushedAt`,
   `pushedById`, `lastError: null`, plus `logActivity(tx, { module: "zoho", action:
   "payment_pushed", entityType: "VendorPayment", entityId: groupKey, entityRef:
   zohoPaymentNumber, details: "₹X to <vendor>, bills <nos>[, CD ₹Y not in Zoho]" })`. If this
   write fails after Zoho succeeded, the row stays `PUSHING`, goes stale, and the next press
   **adopts** by token — no second Zoho payment.
6. **Failure** → `classifyZohoFailure`: `refused` → `FAILED` with Zoho's message; `unknown` →
   `UNKNOWN`, *"Zoho did not answer. Press Push again — it checks Zoho before sending anything."*
   Both write `logActivity(prisma, … "payment_push_failed")` (best effort) and `log.error`.

Response: `{ status, zohoPaymentNumber?, adopted?, lookAlikes?, cdNotInZoho? }`. Cost per push:
1 + (number of bills) + 1 Zoho calls, plus 1 on a retry.

**`POST /api/payments/[id]/zoho-link`** — body `{ zohoPaymentId: z.string().min(1) }`. For "this
is the same payment". Reads it (`getVendorPayment`); refuses unless its `vendor_id` is ours and its
amount equals the group total ± 0.01; the `@unique` on `zohoPaymentId` refuses linking one Zoho
payment to two groups. Same claim as step 3, then `PUSHED, adopted: true`, activity
`payment_linked`.

**`POST /api/payments/[id]/zoho-recheck`** — for a `PUSHED` group. Reads the Zoho payment; if Zoho
says it no longer exists (the error code is confirmed in the sandbox, §4), sets `FAILED` with
*"Deleted in Zoho — push again if it should be there"* and activity `payment_missing_in_zoho`.
This is the answer to "deleted after push": the app has no delete (§2.3), so a deletion happens in
Zoho, and this is how the app learns of it. Anything else → unchanged, `200`.

**`GET /api/payments`** (no caller today, §2.3) becomes the list: one item per **group**, newest
first. Query `push = todo | failed | pushed | skipped | credit | all` (default `todo` = no push row,
or `FAILED`/`UNKNOWN`), `vendorId`, `page`, `limit`. Page the group keys with one parameterised
`$queryRaw` (`SELECT COALESCE("paymentGroupId", id) AS key … GROUP BY 1 ORDER BY max("paymentDate")
DESC, max("createdAt") DESC LIMIT … OFFSET …` joined to `ZohoPaymentPush` for the filter), then
load those groups' rows with `findMany`. Guard stays `bills.view`.

#### A6 — mapping the "paid through" accounts (Q2)

`GET/PUT /api/zoho/paid-through` (new), `requireFeature("zoho", "edit")`:
- `GET` → plan D's active `BankAccount` rows with their `zohoAccountId`, the cash setting, and
  Zoho's cash and bank accounts from `listCashAndBankAccounts()` for the pickers.
- `PUT` — `zohoPaidThroughSchema = z.object({ bankAccounts: z.array(z.object({ id: z.string(),
  zohoAccountId: z.string().nullable() })), cashZohoAccountId: z.string().nullable() })` — writes
  the columns and the `AppSetting` in one transaction; `logActivity(tx, { module: "zoho",
  action: "paid_through_mapped" })`.

Screen: a **Paid-through accounts** card on `/settings/integrations`, in its own file
`src/app/(dashboard)/settings/integrations/_components/zoho-paid-through-card.tsx` (the page is
already 889 lines — frontend-engineer red flag), one line in `page.tsx` to render it. One row per
bank account plus "Cash": `<SearchableSelect>` of Zoho accounts, Save. If plan D is not built, the
card says so and offers only Cash.

#### A7 — screens

| Where | Change |
|---|---|
| `src/components/zoho-push-button.tsx` (new, shared) | Status pill — grey *Not pushed*, amber *Unclear — press Push to check Zoho* (`UNKNOWN`), red *Failed* (with `lastError`), green *In Zoho · VP-00042*, slate *Skipped* / *Credit — not a payment*. A **Push to Zoho** button (shown on `canApprove("bills")`, cosmetic — the API re-checks), `min-h-[44px]`, disabled while busy. Opens a confirm sheet: vendor, amount, each bill with its amount, **Paid from** (a picker when the rows have none), the Zoho account it maps to, date, mode, reference, a CD line when present (*"CD ₹Y stays open in Zoho until it is booked there as a vendor credit"*, Q3), and *"This creates a payment in Zoho Books. It can only be undone in Zoho."* A `409 lookAlikes` opens a second sheet: each look-alike with **This is the same payment — link it**, and one **It is a different payment — push anyway**. Results through `ActionConfirmation`. All calls via `apiTry`, `timeoutMs: 65_000`. A PUSHED pill offers **Check in Zoho** (re-check). |
| `src/app/(dashboard)/payments/page.tsx` (new) | **Payments made.** Filter chips: To push (default) · Failed · In Zoho · Skipped · Credits · All. Cards (375 px first): vendor, total, date, mode, reference, the bills it paid ("B-123 ₹5,000 · advance ₹2,000"), the push component. `?highlight=<groupKey>` scrolls to and rings one card. Loading skeleton, error banner, empty state per chip, `Pagination`. Reached from `/accounts` (A "See all" link on Recent Payments) and `/bills` (a "Payments" link in the header); no sidebar entry (`bills` is `route: null`). |
| `src/app/(dashboard)/payments/new/page.tsx` | A **Paid from** select (plan D's accounts, hidden for Cash), remembered per mode in `localStorage` (wrapped in try/catch). After save, `router.push("/payments?highlight=<paymentGroupId>")` instead of `/accounts` (`:259`) — the person lands on the payment with its Push button: D11's "button after save". The touched fetches move to `apiFetch`/`apiTry` (L7). |
| `src/app/(dashboard)/bills/[id]/page.tsx` + `api/bills/[id]/route.ts` | Each payment card gets the pill and button; the route's `payments` include adds `paymentGroupId` and `zohoPush { status, zohoPaymentNumber, lastError }`. Fetches to `apiFetch` (L7). |
| `src/app/(dashboard)/accounts/page.tsx` + `api/accounts/summary/route.ts` | The pill only, on the five recent payments, and the "See all" link. |

#### A8 — RBAC

**No catalog change, no re-seed** under Q5 = (a). `bills.approve` exists and guards nothing today
(§2.6), so whoever already holds it gains "push and approve in Zoho" the day this ships. Record the
holders first, so the change is a known fact:

```sql
SELECT r.key AS role, p.key AS permission
FROM role_permissions rp
JOIN roles r ON r.id = rp."roleId"
JOIN permissions p ON p.id = rp."permissionId"
WHERE p.key IN ('bills.approve', 'zoho.edit', 'zoho.fetch');
```

If Q5 = (c), a new module goes into `prisma/rbac-catalog.ts` with the
`⚠ RUN npm run db:seed:rbac AFTER DEPLOY` comment, and the owner re-seeds.

---

### Part B — Approve purchase bills in Zoho (R6–R8)

#### B0 — settle what the pull brings in (no code)

1. On a local restore of production, run the §2.5 query. It shows which Zoho statuses the
   app's bill imports have actually seen.
2. In the trial org (§4), create one Draft, one Pending Approval and one Open bill in the window
   and press **Fetch Bills** on `/bills`. Record which arrive and the exact status strings,
   including the status of a bill right after approval (`open` or `approved`).
3. If drafts or pending-approval bills do **not** arrive, `listBills` (`base.ts:383-393`) gains
   an optional `filterBy` argument, and the bills step passes the value the sandbox showed returns
   them (`Status.All` is the candidate). Additive: existing callers omit it and build the same URL.
   This touches the bills step in `trigger-pull/route.ts:286` — plan B's file; coordinate.

#### B1 — schema and migration

```prisma
model VendorBill {
  …
  /// Zoho's own word for the bill: draft | pending_approval | open | overdue | partially_paid |
  /// paid | void | rejected | … Kept raw and never mapped onto BillStatus: Zoho's vocabulary
  /// is Zoho's (its list filter has 40 values), and an enum here would fail the import the day
  /// Zoho returns a new one.
  zohoStatus       String?
  zohoStatusAt     DateTime?  // when zohoStatus was last read from Zoho
  zohoApprovedAt   DateTime?  // approved FROM THIS APP; null if approved inside Zoho
  zohoApprovedById String?
  zohoApprovedBy   User?      @relation("VendorBillZohoApprovedBy", fields: [zohoApprovedById], references: [id], onDelete: Restrict)
  …
  @@index([zohoStatus])     // the "Awaiting Zoho approval" filter
}
```

`npx prisma migrate dev --name vendor_bill_zoho_status` on localhost. Expected SQL: four
`ALTER TABLE "VendorBill" ADD COLUMN …` (all nullable), one index, one FK — metadata only on a
populated table, no rewrite; additive (rule 7). **No backfill in SQL**: a status cannot be read
from SQL, and the one in `ZohoPullPreview.data` is as old as the import. Rows fill from (1) the
next import, (2) the Refresh buttons (B4), (3) plan B's backfill if it reads each bill from Zoho
anyway — **plan B is asked to stamp `zohoStatus` / `zohoStatusAt` in the same backfill that stamps
`zohoBillId`**. `zohoStatusAt` null reads on screen as "not checked yet".

#### B2 — stamp the status at import

`src/app/api/zoho/pull-review/approve/route.ts` — the `VendorBill` create (`:442-452`) adds
`zohoStatus: typeof d.status === "string" ? d.status : null, zohoStatusAt: new Date()`; the reuse
path (`existingVB`, `:220`) updates the same two fields. Plan B edits the same `create` to add
`zohoBillId`; whichever merges second rebases. Covers both `/bills` and `/inbound` imports (one
create serves both, `:442`).

#### B3 — the Zoho client

`books.ts`, each write calling `assertWritesAllowed()` first; registry entries in `endpoints.ts`:

| Method | HTTP | Registry key |
|---|---|---|
| `approveBill(billId)` | `POST /bills/{bill_id}/approve` | `bills.approve` |
| `submitBill(billId)` (used only if Q10 = b) | `POST /bills/{bill_id}/submit` | `bills.submit` |
| `addBillComment(billId, text)` (Q11) | `POST /bills/{bill_id}/comments` | `bills.comments.create` |

`getBill` (`base.ts:407-414`) already exists; its return type gains `status`, `total`, `balance`,
`vendor_id`, `location_id` as named optional fields.

`src/lib/zoho/bill-status.ts` (new, pure): `APPROVABLE = ["pending_approval"]` (plus `"draft"` if
Q10 = b), `PAYABLE` (shared with A3), and `zohoStatusLabel(s)` → *Draft in Zoho*, *Awaiting
approval*, *Approved*, *Partly paid*, *Paid*, *Overdue*, *Rejected in Zoho*, *Void in Zoho*, or the
raw word for anything unknown.

#### B4 — routes

**`POST /api/bills/[id]/zoho-approve`** — `requireFeature("bills", "approve")`,
`maxDuration = 60`, empty body (`z.object({}).strict()`).

1. Bill with `zohoBillId`; none → `400` (*"This bill has no Zoho bill id …"*).
2. `getBooks()`; `null` → `409`.
3. **Read first** (`getBill`) and stamp `zohoStatus`. Not in `APPROVABLE` → `409` naming the
   status (*"Zoho already shows this bill as Approved"* / *"… as Draft — submit it in Zoho
   first"* / *"… as Void"*). This makes a second press harmless; approval creates nothing, so
   no claim row is needed — the button is disabled while busy, and a race between two people ends
   with Zoho refusing the second, which step 5 reports as "already approved".
4. `approveBill` (after `submitBill` when Q10 = b and the bill is a draft).
5. **Read back** (`getBill`) — R7. Update `zohoStatus`, `zohoStatusAt`; when the status left
   `APPROVABLE`, also `zohoApprovedAt`, `zohoApprovedById` and `logActivity(tx, { module: "zoho",
   action: "bill_approved", entityType: "VendorBill", entityId, entityRef: billNo, fromValue:
   before, toValue: after })` in one transaction. Still pending after the call (Multi-level, Q9)
   → `200` with *"Approved at your level — Zoho is waiting for the next approver"* and activity
   `bill_approved_partly`.
6. Q11: `addBillComment(zohoBillId, "Approved from BCH OPS by <name>")` — best effort,
   `log.warn` on failure, never fails the approval.
7. Q12 = (a): if Zoho `total` ≠ our `amount` by more than ₹0.01, `log.warn` and return
   `amountDiffers: { here, zoho }` for the screen. Nothing is overwritten.
8. A `ZohoApiError` → `502` with Zoho's message (e.g. the connection's user is not an approver —
   Q9), `logActivity(prisma, … "bill_approve_failed")`, `log.error`.

**`POST /api/bills/[id]/zoho-refresh`** — `requireFeature("zoho", "fetch")` (a read from Zoho,
the same grant as Fetch Bills). `getBill` → stamp status → return `{ zohoStatus, zohoStatusAt,
zoho: { total, balance } }`. No write guard: it writes nothing to Zoho.

**`POST /api/bills/zoho-refresh`** — `requireFeature("zoho", "fetch")`, `maxDuration = 60`. The
"Refresh Zoho statuses" button: bills with a `zohoBillId` whose `zohoStatus` is null or in
`["draft", "pending_approval"]`, oldest-checked first (`zohoStatusAt` asc, nulls first), **at most
40 per press** (one `getBill` each); returns `{ checked, changed, remaining }` so the screen can say
*"40 checked, 12 more — press again"*. One `logActivity(prisma, … "bill_statuses_refreshed")`.
No scheduler: a person presses it (CLAUDE.md, no cron, no polling).

**`GET /api/bills`** (`src/app/api/bills/route.ts:10-84`) — `select` adds `zohoBillId`,
`zohoStatus`, `zohoStatusAt`; new query `zoho=awaiting` → `zohoStatus in [draft,
pending_approval]`. **`GET /api/bills/[id]`** — `vendor: true` already; the bill row carries the
new columns automatically, plus `zohoApprovedBy { name }`.

#### B5 — screens

| Where | Change |
|---|---|
| `src/app/(dashboard)/bills/[id]/_components/zoho-bill-card.tsx` (new), rendered under the amount card in `bills/[id]/page.tsx` | **Zoho** card: the status chip and "checked 5 min ago" / "not checked yet"; *Approved in Zoho by Ravi, 12 Oct* when stamped; **Refresh from Zoho** (`canFetch("zoho")`); **Approve in Zoho** (`canApprove("bills")`, only when the status is approvable) opening a confirm sheet: bill, supplier, amount, *"This approves the bill in Zoho Books as <connection user>, and it then counts in the supplier's ledger there."* Result via `ActionConfirmation`, including the amount-differs line (Q12) and the partial-approval line. 44 px targets, disabled while busy, `apiTry`. |
| `src/app/(dashboard)/bills/page.tsx` | A small Zoho chip on each row whose status is not open/paid (desktop table `:500` and cards `:525`); an **Awaiting Zoho approval** chip beside the status filters (`:59`) sending `zoho=awaiting`; a **Refresh Zoho statuses** button (`canFetch("zoho")`) shown on that filter. The two fetches this touches move to `apiFetch` (L7). |

#### B6 — RBAC

None beyond A8. Approve uses `bills.approve`; refresh uses `zoho.fetch`.

---

### Phases and dependencies

| Phase | Work | Depends on |
|---|---|---|
| **B0** | Settle what the pull returns (SQL + sandbox) | Q14 (trial org) |
| **B1** | `vendor_bill_zoho_status` migration | **plan B's `zohoBillId` migration** (ordering of folders) |
| B2 | Stamp status at import (+ B0's filter, if needed) | B1; plan B's edit of the same `create` |
| B3 | Client: approve, submit, comment; `ZohoApiError`; write guard (A2 steps 1–2 land here) | — |
| B4 | Approve and refresh routes; bills GET | B1–B3, **plan B's backfill of `zohoBillId`**, Q9 |
| B5 | Bill card, list chip/filter/refresh | B4 |
| A1 | `zoho_vendor_payment_push` migration | **plan D's `BankAccount`**, Q1 |
| A2–A3 | Client methods, registry, helpers | B3 |
| A4 | Save: group id, paid-from, remainder | A1, **plan B's F4 fix in the same route**, Q6 |
| A5 | Push, link, re-check, list routes | A2–A4, Q3, Q4, Q8 |
| A6 | Paid-through mapping + card | A1, Q2 |
| A7 | Screens | A5, A6 |
| A8 | Holder query recorded | Q5 |

One branch, two commits (Part B, then Part A). `/code-review` across the branch before the owner
builds.

**No cron, no `setInterval`, no polling, no JWT change, no public-route change.** Two migrations.
No RBAC catalog change under the recommended defaults. One new environment variable,
`ZOHO_BOOKS_WRITE_ORG_ID` — set on **production** to the live org id at go-live (until then
production's pushes and approvals refuse, by design); set on test and locally to the trial org id.

### Logging

| Scope (`createLogger`) | Level | Line |
|---|---|---|
| `payments` (existing route, new logger) | info | `payment recorded` `{ paymentGroupId, vendorId, rows, amount, bankAccountId }` |
| | error | every `catch`, `{ vendorId, message }` |
| `payments:zoho-push` | debug | each step: `claimed`, `bills read`, `look-alike search`, `creating` — with `{ groupKey, attempts, ms }` |
| | info | `pushed` `{ groupKey, zohoPaymentId, attempts, ms }`; `adopted existing Zoho payment` `{ groupKey, zohoPaymentId }` |
| | warn | `stale claim recovered` `{ groupKey, claimedAt }`; `look-alikes found` `{ groupKey, count }`; `bill not payable in Zoho` `{ groupKey, billId, zohoStatus }`; `write blocked by environment guard` `{ organizationId }` |
| | error | `push refused by Zoho` `{ groupKey, code, message }`; `push outcome unknown` `{ groupKey, kind, status }` |
| `payments:zoho-link`, `payments:zoho-recheck` | info / warn | `linked` `{ groupKey, zohoPaymentId }`; `missing in Zoho` `{ groupKey, zohoPaymentId }` |
| `zoho:paid-through` | info / error | `mapping saved` `{ bankAccounts, cashSet }`; `account list failed` `{ message }` |
| `bills:zoho-approve` | info | `bill approved in Zoho` `{ billId, zohoBillId, from, to }` |
| | warn | `nothing to approve` `{ billId, zohoStatus }`; `approved at one level only`; `Zoho total differs` `{ billId, here, zoho }`; `comment failed` `{ billId }` |
| | error | `approve failed` `{ billId, code, message }` |
| `bills:zoho-refresh` | info / error | `statuses refreshed` `{ checked, changed, remaining }`; per-bill failure `{ billId, message }` |
| `integrations` (existing) | warn | the existing line at `base.ts:370` now has the typed `code` behind it |
| browser: `payments`, `bills` (existing scope), `zoho-push-button` | error | a failed push / approve with the API sentence |

Every `catch` logs before it responds. Identifiers and counts only: never a request body, never a
token. The push token in a Zoho description is a reference, not a secret.

### Board of agents — checked

- **integration-architect** (`docs/agents/integration-architect.md`) — *Idempotent sync, Zoho
  ids as dedupe keys* (principle 3): the claim plus the description token plus `@unique
  zohoPaymentId` ✓. *"What happens if this syncs twice?"* — A5 steps 3 and 4.1 answer it, and §4
  tests it ✓. *Timestamp everything* (principle 5): `claimedAt`, `lastAttemptAt`, `pushedAt`,
  `zohoStatusAt` ✓. *Rate limits*: calls per push are counted (A5) and the bulk refresh is capped
  at 40 ✓. *App → Zoho pattern* "local mutation → push → confirm → update local sync status": this
  is that pattern with a person pressing the button (D11) ✓. **Tension flagged, not violated:**
  principle 1 "Zoho wins for financial fields" vs Q12's default of showing, not overwriting, a
  differing bill total — resolved toward plan B's re-import, and asked. **Stale doc flagged:** its
  table lists "Zoho Payment ↔ VendorPayment, key `referenceNo`"; `referenceNo` is a bank UTR that
  may be blank or shared, so this plan keys on its own token and on Zoho's `payment_id`. The doc
  should be corrected when this ships (not edited by this plan).
- **accounting-consultant** — *Zoho is the source of truth for financials* ✓ (status is always
  read from Zoho; nothing financial is overwritten from here). *Accrual — recognise payables when
  the bill is received*: a bill awaiting approval in Zoho stays counted as owed here; Part B only
  labels it (§5). *Cash discount*: Zoho has no discount on a vendor payment; Q3 asks how it is
  booked rather than inventing an entry. *3-way match before payment* is not enforced by this app
  today and this plan does not change that (§5) — flagged.
- **backend-engineer** — zod on every new body ✓; `requireFeature(module, action)` with two
  arguments only ✓ (the doc's own example, `requireAuth(["ADMIN", "SUPERVISOR"])`, is a role list
  that CLAUDE.md rule 2 forbids — **flagged; this plan follows CLAUDE.md**); multi-row writes in
  `$transaction` ✓; every `updateMany` checks its count ✓; idempotency guard on the financial
  write ✓; status codes 400 / 403 / 409 / 502 with sentences ✓; business logic in the route
  handlers, pure helpers in `src/lib/zoho/` ✓.
- **frontend-engineer** — 375 px first, 44 px targets, disabled-while-busy, loading / error /
  empty states on the new list ✓; `usePermissions` only, no role names ✓; the push sheet and the
  bill card are extracted components (the integrations page is 889 lines, bills list 622) ✓. The
  doc's "standard fetch pattern" is the raw `fetch().then(r => r.json())` CLAUDE.md bans —
  **flagged; this plan uses `apiFetch` / `apiTry`**.
- **database-architect** — additive migrations, SQL read, backfill hand-appended and explained ✓;
  nullable FKs are "linked later" by nature (a payment is pushed after it is saved) ✓; indexes on
  the filtered columns (`ZohoPaymentPush.status`, `VendorBill.zohoStatus`) ✓; **no new `Float`
  money column** ✓; enum for the app's own push states, `String` for Zoho's vocabulary, with the
  reason written on the column ✓; who applies each migration and when is stated (by hand,
  before the code) ✓.

---

## 4. Verification

**⚠ Read first.** Since 12 Oct 2026 the **test database holds production's live Zoho
credentials**. Any Zoho write from test lands in the real Bharath Cycle Hub books. And
**Settings › Integrations › Disconnect on test revokes production's token**: it calls
`accounts.zoho.in/oauth/v2/token/revoke` with the stored refresh token
(`api/integrations/[provider]/disconnect/route.ts:29`), which on test *is* production's.

**The safe path (Q14):**

1. Create a **Zoho Books trial organisation** on the India data centre (`zoho.in`), preferably
   under a **separate Zoho login**, so neither token can reach the other org. Create a self-client
   for it (`docs/postman/zoho-setup.md`, scope `ZohoBooks.fullaccess.all`).
2. **Locally first**: a local restore (`npm run db:restore:local`) nulls stored Zoho credentials
   (CLAUDE.md rule 10). Connect the trial org on `/settings/integrations` **with its org id typed
   in** — `connect` keeps the stored org id when the field is blank (L8). Set
   `ZOHO_BOOKS_WRITE_ORG_ID` in `.env` to the trial org id. Confirm the card shows the trial org's
   name.
3. **On test**, only after local passes: use **Connect** with the trial credentials and org id —
   it overwrites the stored row without revoking anything (`connect/route.ts:66`). **Never press
   Disconnect on test.** Set `ZOHO_BOOKS_WRITE_ORG_ID` on the test deployment to the trial org id.
   With the guard in place, a test deployment still pointing at production refuses every write.
4. In the trial org: switch on bill approval (Simple); create two vendors, a bank account
   "ICICI (test)" and a cash account; create bills — one Open, one submitted for approval, one
   Draft.
5. **Go-live smoke on production** — only with the owner's sign-off: set
   `ZOHO_BOOKS_WRITE_ORG_ID` to the live org id, push **one** small real payment, check it in
   Zoho; if anything is wrong, delete it in Zoho and use **Check in Zoho** to reset it here.

**Build and static checks:** `npx tsc --noEmit`, `npx eslint` on touched files, then
`npm run build` (needs Postgres up — CLAUDE.md environment notes). `npx prisma migrate status`
clean on local after each migration; both migrations' SQL read against §3.

**Part B — approval** (trial org connected):

1. B0 recorded: which statuses arrive, and the status string right after approval.
2. `/bills` → Fetch → import all three bills. Each shows its chip; **Awaiting Zoho approval** lists
   the pending one (and the draft under Q10 = b).
3. `/bills/[id]` of the pending bill → **Approve in Zoho** → confirm → chip becomes *Approved*;
   in Zoho the bill is approved and carries the comment (Q11); `/activity` shows *Zoho · bill
   approved* by you; `SELECT "zohoStatus","zohoApprovedAt","zohoApprovedById" FROM "VendorBill"
   WHERE id = '…';` is filled.
4. Press Approve again from a second tab that still shows the old state → *"Zoho already shows
   this bill as Approved"*, no error, nothing duplicated.
5. Edit the bill's amount in Zoho, then approve another pending one with a changed total → the
   amount-differs line appears; our amount is unchanged (Q12 = a).
6. Approve the draft (Q10 = a) → refused with the "submit it in Zoho first" sentence.
7. Approve something in Zoho directly → **Refresh from Zoho** on its page, and **Refresh Zoho
   statuses** on the list, pick it up.
8. A user without `bills.approve` sees no Approve button; `curl -X POST …/zoho-approve` with their
   session cookie → `403`.

**Part A — push** (paid-through accounts mapped on `/settings/integrations` first):

9. `/payments/new` → one approved bill, NEFT, Paid from ICICI (test) → Save → lands on
   `/payments` with the card highlighted, *Not pushed* → **Push to Zoho** → *In Zoho · <number>*.
   In Zoho: one payment, applied to that bill, paid through the mapped account, the UTR as
   reference, the BCHOPS token in the description. `SELECT * FROM "ZohoPaymentPush" ORDER BY
   "createdAt" DESC LIMIT 1;` → `PUSHED`, `attempts 1`.
10. **Double tap / two people:** open the same unpushed payment in two tabs, press Push in both
    as fast as possible → one success, one *"Someone is pushing this right now"* or *"Already in
    Zoho"*; Zoho holds **one** payment.
11. **Lost response:** after a successful push, simulate the unknown outcome —
    `UPDATE "ZohoPaymentPush" SET status='UNKNOWN', "zohoPaymentId"=NULL, "zohoPaymentNumber"=NULL
    WHERE id='…';` → press Push → it **adopts** the existing Zoho payment (`adopted = true`); Zoho
    still holds one.
12. **Stale claim:** set a row to `PUSHING` with `claimedAt` 5 minutes ago → Push proceeds, the
    log shows `stale claim recovered`.
13. **Typed by hand:** create a payment in Zoho by hand for a vendor, date and amount, record the
    same here, press Push → the look-alike sheet → **Link** → `PUSHED, adopted`. Repeat with
    **Push anyway** → a second Zoho payment exists (deliberate).
14. **Multi-bill + remainder:** ₹10,000 against two bills totalling ₹8,000 → three rows, one
    `paymentGroupId`, ₹2,000 advance row (Q6 = a) → one push → **one** Zoho payment of ₹10,000
    applied ₹X + ₹Y, ₹2,000 left as excess.
15. **Advance only**, no bill → a Zoho payment with no bills applied.
16. **Refusals, each with its sentence and nothing claimed:** a credit-adjustment row; a vendor
    with no Zoho id; a bill with no Zoho id; a bank mode with no Paid from; a draft bill (pre-check
    → *"Approve bill … in Zoho first"*, status `FAILED`).
17. **Deleted in Zoho:** delete the pushed payment in Zoho → **Check in Zoho** → *Failed — deleted
    in Zoho*; push again works. Record Zoho's error code for "does not exist" in the build record.
18. **Guard:** unset `ZOHO_BOOKS_WRITE_ORG_ID` → Push and Approve both refuse with the
    "switched off in this environment" sentence; Refresh still works.
19. **Legacy (Q1 = a):** a payment recorded before the migration shows *Skipped*; Push runs the
    look-alike check first.
20. Payment-mode labels: check how Zoho displays each of Cash / Check / Bank Transfer / UPI and fix
    `ZOHO_PAYMENT_MODE` if needed; check whether the create response nests under `vendorpayment`.
21. 375 px: the push sheet, the look-alike sheet and the bill card fit without horizontal scroll.

## 5. Out of scope, deliberately

- **Pushing automatically on save, or a "push all" button.** D11 asks for an explicit button per
  payment. A bulk push is a later, separate decision.
- **Editing or deleting a payment in this app.** None exists today (§2.3). The rule for whoever
  adds one is written on the model (A1): refuse while `PUSHED`, or carry the change to Zoho.
- **Creating vendor credits in Zoho**, including for a cash discount (D3, Q3). **Pushing credit
  applications** (`POST /bills/{bill_id}/credits`) unless Q7 = (b).
- **TDS withheld on a vendor payment** (`tax_amount_withheld`) — D22: TDS is not built.
- **Rejecting a bill in Zoho from here**, bulk approval, and approval of other Zoho documents.
- **Changing what the payables totals and aging count.** A bill awaiting approval in Zoho stays
  owed here (accrual); it is only labelled. Whether the supplier ledger should split approved and
  unapproved bills is plan B's (R18).
- **Overwriting a bill's amount from Zoho** (Q12 = a) — plan B's re-import owns financial resync.
- **The pull defects L2, L3, L4** — plan B's pipeline; this plan depends on L2 and L3 being fixed
  for its stamps to survive and its bill matches to be right.
- **The `createBill` defects (L6)** and putting the write guard on the existing writes
  (`createBill`, `createItem`, `createInvoice`, `createContact`, `updateItem`). Worth doing; a
  separate change.
- **Customer-side payments** (`customerpayments`) and anything on the Zakya or Zoho Inventory
  connections.
- **Correcting the integration-architect doc's payment key** (`referenceNo`) — flagged in the
  board check, edited when this ships.
