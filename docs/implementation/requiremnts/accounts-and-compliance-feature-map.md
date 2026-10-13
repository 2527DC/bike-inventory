# Owner's accounts and compliance list — what each item means and where it belongs

Written 8 Oct 2026 from a 28-point list the owner sent. This is a **requirements map**, not an
implementation plan. Nothing here has been built. Its job is to let a developer who has never
done accounts work read each line, understand what the business is asking for, see what the
app already has, and know which screen or module the work belongs in.

Every "Today" claim was checked against the code on branch `fix/0510-audit-apply-timeout`,
with the file named so it can be re-checked.

How to read it:

1. **§1** — the owner's words, verbatim, then the same 28 points as `R1…R28`.
2. **§2** — one table: every point, what it means in one line, where it goes, and whether the
   app has it (**Exists**, **Partly**, **Missing**, **Not this app**).
3. **§3** — the points grouped by the part of the app they touch, each explained in plain
   words, with what exists today and what is missing.
4. **§4** — the questions to put to the owner before any plan is written.
5. **§5** — a suggested order of work.

A short glossary is at the end for the accounting words.

---

## 1. The requirement

### 1.1 The owner's words, verbatim (8 Oct 2026)

> 1. credit note section for the vendors.
> 2. can we push vendor payments to Zoho.
> 3. can we pull credit and debit note from Zoho.
> 4. Physical verification of counter cash vs. billing software registers at the end of each shift/day.
> 5. Daily verification of ICICI EDC/POS machine MDR batch settlements and emails against actual bank credits.
> 6. Verifying Brand Credit of EM and other brands.
> 7. Logging into the Bajaj merchant portal daily to verify loan approvals, disbursements, and settlement receipts and verifying with bank credits.
> 8. Receiving supplier invoices (Hero, Cult, EMotorad, Stryder, Tube Investments, Aoki, Lucifer, Guru Mahima, etc.).
> 9. Verifying invoiced quantities vs. physical stock received; identifying shortages or damages.
> 10. approving purchase bills in Zoho Books and posting them to vendor ledgers.
> 11. Updating the "Pending Receivables Sheet" daily (uncollected customer dues, corporate deliveries, pending card/loan disbursements).
> 12. Recording daily operational expenses (Porter logistics/freight charges, staff food, tea, fuel/diesel, cleaning materials, godown maintenance).
> 13. Mapping every expense to the specific person/department (e.g., Iqbal Bhai's logistics spends).
> 14. Generating E-Way bills for customer dispatches, inter-branch transfers (Warehouse to Hub/Centre), and supplier return pickups.
> 15. Monitoring daily floor attendance, login/logout timings on Petpooja, and tracking unauthorized leaves or late arrivals.
> 16. Reconciling primary bank accounts every week (especially Tuesday ICICI reconciliation, along with HDFC Hub, Centre HDFC, and Dhanlaxmi Bank).
> 17. Investigating bank credits/debits without narrations or bills; following up with the CEO and external accountant (Deekshith) to map suspense entries.
> 18. Maintaining ledger sheets for over 70+ suppliers across BCH and BCC.
> 19. Calculating Cash Discounts (CD), credit note adjustments, and preparing priority lists for overdue supplier payments (>30 / >45 days).
> 20. Tracking stock levels of high-velocity models (electric cycles, geared bikes) and alerting leadership regarding stock-outs (pumps, displays, accessories).
> 21. Pulling monthly punch logs, tracking total working days, loss of pay (LOP), and approved week-offs.
> 22. Calculating overtime (OT) hours and performance/hiring incentives.
> 23. Factoring in salary advance deductions, compiling QR payment codes/bank details, and generating the final Monthly Salary Sheet.
> 24. Reconciling monthly Sales and Purchases (GSTR-1, GSTR-2B, GSTR-3B) against books for both Bharath Cycle Hub (Hub) and Bharath Cycle Centre (Centre).
> 25. Preparing monthly GST Summary & Payable Reports (Output Liability vs. Eligible Input Tax Credit - ITC).
> 26. Assisting CA/accountant with return filings, generating payment challans, and tracking voluntary DRC-03 payments.
> 27. Maintaining correct HSN codes and GST tax slabs across the item catalog (cycles, spares, RC cars, EV scooters)
> 28. Maintaining monthly TDS deduction registers and ensuring challan generation/payment before deadlines.

### 1.2 Restated as requirements

- **R1** — A screen to record and see credit notes a vendor gives us.
- **R2** — Push a vendor payment recorded here into Zoho Books.
- **R3** — Pull vendor credit notes and debit notes from Zoho into the app.
- **R4** — At shift or day end, compare cash physically counted with what the billing software says was taken in cash.
- **R5** — Every day, check that the ICICI card-machine (EDC) batch settlements, after MDR fees, arrived as bank credits.
- **R6** — Track and verify credits that brands (EMotorad and others) owe us: discounts, schemes, returns.
- **R7** — Verify Bajaj Finance loan approvals, disbursements and settlements against bank credits.
- **R8** — Receive supplier invoices from the named brands into the system.
- **R9** — Compare invoiced quantity with what physically arrived and record shortages and damage.
- **R10** — Approve purchase bills in Zoho Books so they post to the vendor's ledger.
- **R11** — A daily "pending receivables" view: customer dues, corporate deliveries not yet paid, card and loan amounts not yet disbursed to us.
- **R12** — Record daily operating expenses by type (Porter freight, food, tea, fuel, cleaning, godown maintenance).
- **R13** — Every expense is tied to a person or department.
- **R14** — Generate e-way bills for customer dispatches, inter-branch transfers and supplier return pickups.
- **R15** — Daily attendance: Petpooja login and logout times, unauthorised leave, late arrival.
- **R16** — Weekly bank reconciliation for four accounts: ICICI, HDFC Hub, HDFC Centre, Dhanlaxmi.
- **R17** — A way to park bank lines nobody can explain, assign them to someone to chase, and close them later.
- **R18** — A ledger per supplier, 70-plus suppliers, separated by company (BCH and BCC).
- **R19** — Compute cash discounts, net off credit notes, and list overdue supplier payments past 30 and 45 days.
- **R20** — Watch stock of fast-selling models and alert leadership on stock-outs, including accessories.
- **R21** — Monthly punch logs, working days, loss of pay, approved week-offs.
- **R22** — Overtime hours and incentives.
- **R23** — Salary advance deductions, staff bank or QR details, the monthly salary sheet.
- **R24** — Reconcile monthly sales and purchases against GSTR-1, GSTR-2B and GSTR-3B for Hub and Centre.
- **R25** — Monthly GST summary: output tax owed minus eligible input credit.
- **R26** — Help the CA with return filing, payment challans and DRC-03 payments.
- **R27** — Keep HSN codes and GST slabs correct across the whole item catalogue.
- **R28** — Monthly TDS deduction register and challan payment before the deadline.

---

## 2. The map in one table

| # | In one line | Where it belongs | Today |
|---|---|---|---|
| R1 | Record a vendor's credit note and use it against a bill | `/vendors/[id]` → Credits tab, plus `/bills` | **Partly** — table and API exist, no screen to create or apply one |
| R2 | Send our vendor payment to Zoho Books | `/payments/new`, `src/lib/integrations/books.ts` | **Missing** — no Zoho endpoint for it |
| R3 | Import vendor credit notes and debit notes from Zoho | `/bills` pull flow, `settings/integrations` | **Missing** — pull knows four entity types, neither note is one |
| R4 | Cash in the drawer vs POS cash sales | `/accounts/settlement` | **Exists** — `cashCounted`, `cashVariance`, verifier |
| R5 | Card-machine batches vs bank credits | `/accounts/settlement` + `/accounts/bank-upload` | **Partly** — CARD match exists, MDR fee and batch email are not modelled |
| R6 | Brand credits owed to us | `/ledger` (brand ledger, claim register) | **Exists** — build, verify it is being used |
| R7 | Bajaj loan disbursements vs bank credits | `/accounts/settlement` FINANCE line | **Partly** — FINANCE total exists, no per-loan tracking |
| R8 | Supplier invoices into the system | `/inbound` (Zoho bill pull) | **Exists** — plus a pending PO → Zoho bill requirement |
| R9 | Invoiced vs received, shortages, damage | `/inbound/[id]` → Report Issue | **Exists** |
| R10 | Approve bills in Zoho from here | `/bills`, Zoho endpoint registry | **Missing** — no approve endpoint; question whether Zoho needs it |
| R11 | Daily pending receivables sheet | `/receivables` | **Partly** — aging exists; corporate and card/loan pending are not |
| R12 | Daily operating expenses | `/expenses/new` | **Exists** — categories need extending |
| R13 | Expense tied to person or department | `/expenses/new`, `Expense` model | **Partly** — `paidBy` is free text |
| R14 | E-way bill generation | `/transfers/[id]`, `/deliveries/[id]`, vendor returns | **Partly** — transfers take a number by hand; no generation anywhere |
| R15 | Attendance from Petpooja | new module | **Not this app** today |
| R16 | Weekly reconciliation of four bank accounts | `/accounts/bank-upload` | **Partly** — HDFC and ICICI only, no account identity, no weekly view |
| R17 | Suspense entries with a follow-up owner | `/accounts/reconcile/[id]` | **Partly** — FLAGGED exists, no owner or notes |
| R18 | Ledger per supplier, Hub vs Centre | `/vendors/[id]` → Ledger tab, `/accounts/vendor-ledger` | **Partly** — exists, not split by company |
| R19 | CD, credit-note netting, overdue priority list | `/bills`, `/reports/cd-summary` | **Partly** — CD per bill exists; no 45-day bucket, no priority list |
| R20 | Stock-out alerts for fast movers | `/reorder`, notifications | **Partly** — low-stock rule exists, "velocity" and leadership alert do not |
| R21–R23 | Attendance, overtime, salary sheet | new payroll module | **Not this app** today |
| R24–R26 | GST return reconciliation, GST summary, challans | Zoho Books; possibly a report here | **Not this app** today |
| R27 | HSN and GST slab across the catalogue | `/stock/[id]`, `/categories`, Zoho item push | **Partly** — fields exist, read-only on screen, no audit view |
| R28 | TDS register and challans | new or Zoho Books | **Not this app** today |

---

## 3. The points, grouped by the part of the app they touch

### 3.1 Vendor money — R1, R2, R3, R10, R18, R19

This is the **Accounts → Bills** area. The app's own books for a vendor are three tables:
`VendorBill` (what we owe), `VendorPayment` (what we paid) and `VendorCredit` (what they owe
us back). All three are in `prisma/schema.prisma:1291-1366`.

**R1 — credit note section for vendors.**
A credit note is a paper from the vendor saying "we owe you ₹X" — because goods were returned,
were damaged, or a promised discount was not on the bill. It is used later to pay less on the
next bill.

*Today:* `VendorCredit` exists with `creditNoteNo`, `amount`, `usedAmount`, `reason`. The API
`POST /api/credits` creates one (`src/app/api/credits/route.ts:36`) and `POST /api/payments`
can consume one through `creditId` (`src/app/api/payments/route.ts:53-78`). The vendor page
has a **Credits** tab that lists them (`src/app/(dashboard)/vendors/[id]/page.tsx:120, 508`).
**No screen calls `POST /api/credits`**, and the payment form at `/payments/new` has no credit
field, so a credit note can be neither entered nor used from the browser.

*Where:* a "Record credit note" button on the vendor's Credits tab and on `/bills/[id]`, and
a "Apply credit" choice on `/payments/new`. No new table is needed.

**R2 — push vendor payments to Zoho.**
When a payment is recorded here it must also appear in Zoho Books, so the vendor's balance in
Zoho matches ours without typing it twice.

*Today:* the Zoho endpoint registry (`src/lib/integrations/endpoints.ts`) has
`bills.create`, `invoices.create`, `contacts.create`, `items.create` and `items.update` as
its only writes. There is **no vendor-payment write**. `VendorBill` has no Zoho id column:
only `InboundShipment.zohoBillId` (`schema.prisma:2454`) carries it, and a bill imported
from `/bills` has no shipment, so a payment could not name which Zoho bill it pays.

*Where:* a new registry entry (Zoho Books `POST /vendorpayments`), a `BooksClient` method,
and a "Push to Zoho" step after `POST /api/payments`. Prerequisite: store the Zoho bill id
on `VendorBill` at import (the pending plan
`2409-zoho-vendor-id-on-bill-import-plan.md` did this for the vendor; the bill needs the
same). This depends on the integration-architect doc (`docs/agents/integration-architect.md`).

**R3 — pull credit and debit notes from Zoho.**
Zoho Books has *vendor credits* (vendor owes us) and *debit notes*. Pulling them would fill
`VendorCredit` automatically instead of by hand, the same way bills are pulled.

*Today:* the pull pipeline (`POST /api/zoho/trigger-pull` → preview → approve) understands
exactly four entity types: `contact`, `item`, `bill`, `invoice`
(`docs/data-flow-and-modules.md` §3). Neither note type exists in the registry.

*Where:* a fifth entity type `vendorcredit` in the pull pipeline, a registry entry for Zoho
Books `GET /vendorcredits`, and an approve handler that writes `VendorCredit`. The `/bills`
screen's fetch tab is where the button goes.

**R10 — approve purchase bills in Zoho Books.**
In Zoho a bill can sit as a draft until someone approves it; only then does it count in the
vendor's ledger. The owner wants that approval done from here.

*Today:* the app only *reads* bills from Zoho. Whether Zoho's approval workflow is even
enabled for this organisation is not known from the code. See Q4.

*Where:* if needed, a registry entry for the Zoho bill status change and an "Approve in
Zoho" button on `/bills/[id]`. Do not build until Q4 is answered.

**R18 — ledger sheets for 70-plus suppliers across BCH and BCC.**
A supplier ledger is a running statement: opening balance, each bill adds, each payment or
credit subtracts, closing balance.

*Today:* `GET /api/vendors/[id]/ledger` computes exactly this and the vendor page shows it in
the **Ledger** tab; `/accounts/vendor-ledger` is a picker for the same report. There is one
defect on record: the running balance is computed over a capped 50 bills plus 50 payments, so
a vendor with longer history starts from the wrong number
(`docs/ledger-and-reconciliation-flow.md`, finding L14). `VendorBill.billedTo` holds `"HUB"`
or `"CENTRE"` (`schema.prisma:1307`), but the ledger does not filter by it, and payments and
credits have no such column at all.

*Where:* the existing ledger tab. Add a Hub / Centre filter, put `billedTo` (or a store link)
on payments and credits, and fix L14. **This is not a new module.**

**R19 — cash discount, credit note netting, overdue priority list.**
A cash discount (CD) is a percentage the vendor knocks off if we pay within N days. The
accountant wants to know, every day, which bills still qualify, how much a credit note reduces
what is owed, and which unpaid bills are more than 30 and more than 45 days old.

*Today:* `Vendor.cdTermsDays` and `cdPercentage` exist; `GET /api/bills/[id]/cd-eligibility`
computes the deadline and the discount for one bill; `/reports/cd-summary` exists;
`VendorPayment.cdDiscountAmount` records what was taken. The bills aging summary has buckets
of 1-30, 31-60 and 60-plus days (`src/app/api/bills/aging-summary/route.ts:19-38`). There is
**no 45-day bucket** and no single "pay these first" list that combines CD deadline, age and
credit notes available.

*Where:* `/bills` — a "Payment priority" view, sorted by CD deadline then age, with the
45-day cut the owner uses. Pure read, no schema change beyond the bucket.

### 3.2 Daily cash and bank — R4, R5, R7, R16, R17

This is the **Accounts → Daily Settlement** and **Bank Statement** area.

**R4 — counter cash vs the billing software.**
At the end of the day the cash in the drawer should equal cash sales the POS reports, plus
any cash put in, minus cash taken out.

*Today:* **done.** `POST /api/pos/sessions` pulls the day's register sessions from Zakya POS
into `PosSession` (cash, card, UPI, finance totals). `DailySettlement` then holds
`cashCounted`, `cashVariance`, `cashVerifiedAt` and the verifier (`schema.prisma:2562-2600`).
The screen is `/accounts/settlement/[id]`.

*Where:* nothing new. Confirm the owner knows the screen exists and whether "per shift" (two
counts a day) is needed — `DailySettlement.date` is unique, so today it is one per day (Q6).

**R5 — ICICI EDC batch settlements vs bank credits.**
The card machine sends the day's card sales to the bank as one batch. The bank credits the
amount **minus MDR** (the merchant fee), usually a day or two later, and emails a settlement
report. The accountant checks: did every batch arrive, and was the fee what it should be?

*Today:* `SettlementMatch` links an expected amount (`paymentMode: "CARD"`) to a
`BankTransaction` and records the `variance` (`schema.prisma:2602`). So "did the money
arrive" works once a bank statement is uploaded. **MDR is not modelled** — the variance is just
a number, nobody can say whether it is the fee or a missing batch — and the batch email is
not read.

*Where:* `/accounts/settlement/[id]`. Add an expected MDR rate (a setting) so the match can
say "variance equals fee, fine" versus "short". Reading the settlement emails is a separate,
larger piece (Q7).

**R7 — Bajaj loan approvals, disbursements and settlements.**
When a customer buys on Bajaj Finance EMI, the shop gives the cycle today and Bajaj pays the
shop later, minus its charge. Until Bajaj pays, that sale is money owed to us.

*Today:* `PosSession.financeSales` and `DailySettlement.totalFinance` carry the day's total,
and a `SettlementMatch` with `paymentMode: "FINANCE"` can be matched to a bank credit. There
is no per-loan record (customer, loan number, approved, disbursed, received), so a loan that
Bajaj never pays is invisible once the day's total is "mostly matched".

*Where:* this is the "pending card/loan disbursements" half of R11. A small `FinanceCase`
record per finance sale, listed under `/receivables`, and settled from the reconcile screen.
Logging in to the Bajaj portal stays manual; the app cannot do that (Q8).

**R16 — weekly reconciliation of four bank accounts.**
Reconciliation means: every line on the bank statement is explained by a payment, an expense,
a sale deposit or a known transfer, and every payment we recorded appears on the statement.

*Today:* `/accounts/bank-upload` accepts a CSV or XLS, the file is parsed by AI, matches are
suggested, and a person confirms each line on `/accounts/reconcile/[id]`. The bank picker
offers **HDFC and ICICI only** (`src/app/(dashboard)/accounts/bank-upload/page.tsx:135`).
`BankStatement.accountNumber` exists but nothing fills it, so "HDFC Hub" and "HDFC Centre"
cannot be told apart. Dhanlaxmi has no parser hints. There is no weekly view, and the
reconcile step still uses the AI matcher rather than the deterministic engine the brand ledger
has (`docs/ledger-and-reconciliation-flow.md` §9.2).

*Where:* `/accounts/bank-upload` — four named accounts instead of two bank names (a
`BankAccount` table or a setting), the account stamped on every statement, and a weekly
status tile on `/accounts`. Fix L3 (bulk confirm drops the bill link) before relying on it.

**R17 — suspense entries.**
A bank line with no narration or no matching bill. The accountant parks it, asks the CEO or
the outside accountant, and closes it when explained.

*Today:* `BankTxnMatchStatus.FLAGGED` with `flagReason` is the parking. There is no owner, no
note trail and no "resolved on" date, so a flagged line has nowhere to record who was asked.

*Where:* `/accounts/reconcile/[id]`. Add `assignedToId`, a notes list and `resolvedAt` on
`BankTransaction` (or a small `SuspenseNote` table), and a "Suspense" filter on `/accounts`.
The `LedgerGapNote` pattern in the brand ledger is the model to copy.

### 3.3 Brand credits — R6

**R6 — verifying brand credit of EMotorad and other brands.**
Brands promise schemes, target discounts and return credits. Their monthly statement and our
books never agree, and the difference is money to chase.

*Today:* this is exactly what `/ledger` is for. `BrandLedgerEntry`, `BrandStatement`,
`LedgerGap` (the claim register), evidence, notes, and a deterministic matching engine in
`src/lib/brand-ledger/reconcile.ts`. Since the 31 Aug audit, a statement can be uploaded
(`LedgerUpload`, `LedgerAiRun`, routes under `src/app/api/ledger/uploads/`), so the "engine
with no fuel" finding in `docs/ledger-and-reconciliation-flow.md` §4 is stale.

*Where:* nothing new to build first. The question is whether the accountant is using it
(Q9). If the answer is no, the follow-ups in `docs/brand-ledger-flow.md` are the backlog.

### 3.4 Supplier invoices and receiving — R8, R9

**R8 — receiving supplier invoices.**
*Today:* **done** for the normal path. A supplier bill is created in Zoho, pulled on
`/inbound`, and approved into an `InboundShipment`. The reverse direction, where the app
creates the bill in Zoho from an uploaded invoice PDF, is written up in
`po-vendor-invoice-to-zoho-bill-requirements.md` in this folder and is not built.

**R9 — invoiced quantity vs physical stock, shortages and damage.**
*Today:* **done.** Receiving on `/inbound/[id]` takes the full billed quantity by design, and a
short or damaged delivery is raised through **Report Issue**, which creates a `VendorIssue`
with the quantity and type (`src/app/api/inbound/[id]/issues/route.ts`). The issue is what
later becomes a credit note claim (R1, R6).

*Where:* nothing new. Worth linking: when a shortage issue is closed, offer "record the credit
note" so R9 feeds R1.

### 3.5 Receivables — R11

**R11 — the pending receivables sheet.**
Three kinds of money owed to the shop: customers who took goods on credit, corporate orders
delivered and invoiced but unpaid, and card or finance amounts the bank or Bajaj has not yet
paid over.

*Today:* `/receivables` lists `CustomerInvoice` with aging buckets and overdue flags
(`src/app/(dashboard)/receivables/page.tsx:395-416`). `Delivery.zohoPaymentStatus` is
snapshotted at import. "Corporate" is not a customer type (`CustomerType` is WALK_IN,
REGULAR, DEALER) and nothing marks a delivery as corporate. Card and loan amounts in transit
exist only as settlement totals (R5, R7).

*Where:* `/receivables`. Add a corporate flag (a `CustomerType` value or a customer tag), and a
third tab, "In transit", fed by the unmatched CARD and FINANCE settlement lines. The daily
"sheet" is then this screen filtered to today, exportable through the existing
`src/lib/export.ts`.

### 3.6 Expenses — R12, R13

**R12 — daily operating expenses.**
*Today:* **done** in shape. `/expenses/new` is a stepped mobile form with a photo of the
receipt. Categories are `DELIVERY, TRANSPORT, SHOP_MAINTENANCE, UTILITIES, SALARY_ADVANCE,
FOOD_TEA, STATIONERY, MISCELLANEOUS` (`schema.prisma:169`). The owner's list names fuel,
cleaning materials and godown maintenance, which today fall into MISCELLANEOUS or
SHOP_MAINTENANCE.

*Where:* extend `ExpenseCategory` (a migration plus the labels in
`src/app/(dashboard)/expenses/new/_components/types.ts`), and add Porter as a vendor-like
payee if freight is to be tracked by carrier.

**R13 — map every expense to a person or department.**
*Today:* `Expense.paidBy` is a free string (`schema.prisma:1374`), and the batch form locks it
once per batch. Nothing links it to a `User` or a department, so "Iqbal Bhai's logistics
spends" cannot be totalled without string matching.

*Where:* `/expenses/new` and `/reports/expense-summary`. Add `paidById → User` and a
`department` (or cost centre) column; keep `paidBy` text for people who are not users. The
report then groups by person and department.

### 3.7 E-way bills — R14

**R14 — generating e-way bills.**
An e-way bill is a government document required to move goods worth more than ₹50,000. It is
generated on the government portal (or through a licensed API provider) and its number
travels with the goods.

*Today:* transfers only. `TransferOrder.eWayBillNo` is typed in by hand on the dispatch
sheet, the consignment value is computed, and the route warns when the value is over the
threshold and no number was entered (`src/app/api/transfer-orders/[id]/dispatch/route.ts:271`,
`src/lib/transfers/policy.ts:29`). Customer deliveries have no e-way field, and there is no
supplier-return flow at all.

*Where:* three places. `/deliveries/[id]` needs the same number-and-warning the transfer has.
Supplier returns need a new outward document (a `VendorReturn` or a transfer type). Actual
*generation* needs a GSP (GST Suvidha Provider) API such as the one Zoho Books itself offers;
whether to call Zoho's e-way API or a third party is Q10. See `docs/agents/gst-consultant.md`
for the thresholds.

### 3.8 Stock alerts — R20

**R20 — stock-outs of fast-moving models.**
*Today:* `/reorder` and `src/lib/reorder.ts` decide "low" from `Product.reorderLevel`, and
`src/lib/notify/stock.ts` sends a notification when stock crosses that level downward. There
is no notion of **velocity** (sales per week), so a slow model and a fast model at the same
count look the same. `AlertConfig.redFlagPhones` exists for who gets told.

*Where:* `/reorder`. Add a sold-per-week figure from `InventoryTransaction` outward rows,
flag products whose days-of-cover is below a threshold, and route the existing low-stock
notification to the leadership list. The inventory-consultant doc applies.

### 3.9 Compliance — R24, R25, R26, R27, R28

**R27 — HSN codes and GST slabs across the catalogue.**
*Today:* `Product.hsnCode` and `gstRate` exist (`schema.prisma:582-583`) and are shown
read-only on `/stock/[id]` (`page.tsx:613`). Nothing checks that every product in a category
carries the same HSN, nothing lists blanks, and the Zoho item push (`items.update`) sends
only price. Zoho Books is the filing system, so the rule from `docs/agents/gst-consultant.md`
is that a rate change goes to both places.

*Where:* a "Tax audit" view on `/categories` or `/stock`: blank HSN, rate differing from the
category's expected rate, mismatch with Zoho. Edit on the product page, and extend the Zoho
item update to carry `hsn_or_sac` and `tax_id`.

**R24, R25, R26 — GST returns, GST summary, challans, DRC-03.**
These are filing tasks done inside Zoho Books and the GST portal, by the CA. The app does not
hold invoices with tax breakup for Hub and Centre separately — sales live in Zoho and arrive
here as deliveries. Building GSTR reconciliation here would mean duplicating Zoho Books.

*Where:* **not this app**, unless the owner wants a read-only monthly summary pulled from Zoho
(Q11). Record the decision and leave it.

**R28 — TDS register and challans.**
TDS is tax deducted at source on certain payments (rent, contractors, professional fees) and
paid to the government monthly. It belongs in the accounting system and payroll, not in an
operations app.

*Where:* **not this app**. If the owner insists, it is a small register alongside payroll (R23).

### 3.10 Attendance and payroll — R15, R21, R22, R23

Attendance (Petpooja punches, late arrivals, leave), overtime, incentives, salary advances and
the monthly salary sheet are one connected system: payroll.

*Today:* nothing. The only touch point is the `SALARY_ADVANCE` expense category, which records
money handed over but not who must repay it. Petpooja is not integrated and has no entry in
`src/lib/integrations/`. Staff are `User` rows with a store (`User.storeId`), which is the one
reusable piece.

*Where:* a **new module** (`payroll` in the RBAC catalog), with attendance import,
monthly summary and salary sheet export. It is the largest item on the list and should be its
own requirements document once the owner confirms they want it in this app rather than in
Petpooja or a payroll product (Q12). The `SALARY_ADVANCE` expenses would then link to it.

---

## 4. Questions for the owner

These change what gets built, so they come before any plan.

| # | Question | Why it matters |
|---|---|---|
| Q1 | For R1, should a credit note be recorded from the vendor page, from the bill it relates to, or both? | Decides where the button lives and whether a credit must name a bill |
| Q2 | For R2, is the Zoho organisation one or two (Hub and Centre)? Does each have its own Zoho Books? | A payment push must target the right organisation; today there is one `ZohoConfig` |
| Q3 | For R3, are credit notes in Zoho *vendor credits* (purchase side) only, or also *credit notes* (sales side, to customers)? | Different Zoho endpoints and different tables here |
| Q4 | For R10, is bill approval actually enabled in this Zoho Books? Who approves today? | If approval is off, R10 is already done by the import and nothing is built |
| Q5 | For R18, must payments and credits be tagged Hub or Centre like bills are? | Adds a column to two tables and a filter |
| Q6 | For R4, is one count per day enough or do shifts need separate counts? | `DailySettlement.date` is unique today |
| Q7 | For R5, what is the MDR rate per card type, and are the settlement emails available as files to upload? | Decides whether MDR is a setting or read from email |
| Q8 | For R7, does Bajaj provide a downloadable settlement report (CSV or Excel)? | With a file, loans can be matched like a bank statement; without, it is manual entry |
| Q9 | For R6, is `/ledger` being used today for EMotorad? If not, what stopped it? | Decides whether R6 is a usage issue or a build issue |
| Q10 | For R14, generate e-way bills through Zoho Books' e-way feature, a GSP provider, or keep typing the number from the portal? | API cost and credentials differ |
| Q11 | For R24-R26, is a read-only GST summary pulled from Zoho wanted here, or does the CA work only in Zoho? | Decides whether anything is built |
| Q12 | For R15 and R21-R23, is payroll meant to live in this app, or in Petpooja / a payroll product? | Largest item on the list; a new module either way |
| Q13 | For R16, which account is "primary" and what does Tuesday mean — a reminder, a report, or a deadline? | A weekly tile versus a notification |

### 4.1 Answers on record — answered in session, 12 Oct 2026

| # | Answer |
|---|---|
| Q1 | Superseded by D3: credit notes are typed in Zoho and pulled here; the vendor's Credits tab shows them. No manual entry form. |
| Q2 | **One** Zoho Books organisation for both Hub and Centre. |
| Q3 | **Both** — vendor credits (purchase side) and customer credit notes (sales side). |
| Q4 | Bill approval **is on** in Zoho Books. R10 is wanted. |
| Q5 | Yes — and through the existing `Store` table (`storeId`), not more `"HUB"`/`"CENTRE"` text. Applies to bills, payments, credits, bank accounts, settlements and expenses. |
| Q6 | **Once per store per day.** Not per shift. |
| Q7 | A **fixed MDR rate setting** per card type. Settlement emails are not read. |
| Q8 | **Not known.** Design for manual per-loan entry now, file import later. |
| Q9 | **In use.** R6 needs nothing built. |
| Q10 | **Through Zoho Books** (the existing connection). |
| Q11 | **Nothing built.** The CA works in Zoho. R24–R26 and R28 are out of scope. |
| Q12 | **Not now.** Payroll (R15, R21–R23) is deferred. |
| Q13 | A **status tile** per bank account on `/accounts` (reconciled up to, unmatched and suspense counts, red when older than 7 days). No reminder — the app has no scheduler. "Primary" account not decided. |

Further decisions taken the same day:

- **R1 / R3** — credit notes are typed in Zoho first and pulled here (D3).
- **R12** — no new expense categories; the existing eight stay.
- **R13** — every expense names a store **and** a department; the payer is a staff user, or a typed name for outsiders.
- **R16 / R17** — bank statements and suspense lines get their **own permission module**, separate from `bills`.
- **R17** — a suspense line is assigned to a staff user or a typed name (e.g. the external accountant), with notes and a resolved date.
- **R18** — a credit note reduces the supplier balance **on the day it is received**; applying it to a bill later only links it.
- **R19** — the overdue list shows **both** days since bill date and days past due date.
- **R2** — vendor payments reach Zoho through an explicit **Push to Zoho** button; a Zoho failure never blocks saving.
- **R11** — "corporate" is **both** a customer type and a per-delivery flag.
- **R20** — fast movers are **computed from sales speed** (days of cover below N), no manual flag.

---

## 5. Suggested order of work

Grouped so each step reuses the one before it. Not a commitment; the owner's answers in §4
may reorder it.

1. **Vendor credit notes end to end (R1, then R19).** Smallest gap, everything already exists
   below the screen. Record, apply on payment, show in the priority list.
2. **Bank accounts as data (R16, R17).** Four named accounts, account stamped on every
   statement, suspense owner and notes. Fix L3 on the way.
3. **Settlement fees and finance cases (R5, R7, R11).** MDR setting, per-loan records, and the
   "in transit" tab on receivables.
4. **Expenses (R12, R13).** Categories and the person or department link, then the report.
5. **Zoho writes and pulls (R2, R3, R10).** Needs Q2-Q4 first and the Zoho bill id on
   `VendorBill`.
6. **E-way bills (R14).** Deliveries first (same as transfers), then generation once Q10 is
   answered.
7. **Stock velocity alerts (R20).**
8. **HSN audit (R27).**
9. **Payroll (R15, R21-R23)** as its own requirements document after Q12.
10. **R24-R26, R28** recorded as out of scope unless Q11 says otherwise.

---

## 6. Plans written 12 Oct 2026

One plan per group, all in `docs/implementation/pending/`, each opening with the owner's words
for its points. None is built.

| Plan | Covers | Depends on |
|---|---|---|
| `1210-expense-store-department-and-payer-plan.md` | R12, R13 | — |
| `1210-zoho-credit-notes-and-payables-plan.md` | R1, R3, R18, R19 | — (its Part 1 adds `VendorBill.zohoBillId`) |
| `1210-zoho-vendor-payment-push-and-bill-approval-plan.md` | R2, R10 | B's `VendorBill.zohoBillId`; D's `BankAccount.zohoAccountId` |
| `1210-bank-accounts-and-suspense-plan.md` | R16, R17 | — |
| `1210-settlement-per-store-and-receivables-plan.md` | R4, R5, R7, R11 | B's customer credit notes (for one deduction); D's bank accounts (for store-filtered pickers) |
| `1210-eway-bills-through-zoho-plan.md` | R14 | — (generation runs through Zoho **Inventory**: Zoho Books' API has no e-way endpoint) |
| `1210-fast-mover-stock-out-alerts-plan.md` | R20 | — |
| `1210-hsn-gst-catalogue-audit-plan.md` | R27 | — |

Not planned: R6, R8, R9 (exist), R15 and R21–R23 (payroll, deferred), R24–R26 and R28 (stay in
Zoho with the CA).

---

## Glossary

- **Credit note** — a vendor's written promise that we owe them less (returns, damage, missed
  discount). **Debit note** — the mirror, raised by us to tell the vendor we are deducting.
- **Cash discount (CD)** — a percentage off for paying within an agreed number of days.
- **EDC / POS machine** — the card swipe machine. **MDR** — the fee the bank keeps on each
  card sale. **Batch settlement** — the day's card sales sent to the bank as one lot.
- **Reconciliation** — proving two lists of money movements agree, line by line.
- **Suspense entry** — a bank line nobody can explain yet, parked until it is.
- **Receivables** — money owed to us. **Payables** — money we owe.
- **E-way bill** — a government movement document for goods worth over ₹50,000.
- **GSTR-1 / GSTR-2B / GSTR-3B** — monthly GST returns: our sales, our purchases as reported
  by suppliers, and the summary that nets the two. **ITC** — the tax on purchases we can
  claim back. **DRC-03** — a voluntary tax payment form.
- **TDS** — tax deducted at source on certain payments and deposited monthly with a challan.
- **LOP** — loss of pay for unapproved absence. **OT** — overtime.

