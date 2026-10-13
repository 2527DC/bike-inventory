# Daily settlement per store, card fees (MDR), Bajaj loans case by case, and the pending-receivables sheet

Status: pending — written 12 Oct 2026; plan only, nothing built. Q1 and Q2 block the build; the rest run on their stated defaults unless answered.
Branch: **`feat/1210-settlement-per-store`** — create it with exactly this name, off `main`.

This plan covers four of the owner's 28 points: **4** (count the counter cash), **5** (card-machine
settlements against the bank), **7** (Bajaj loans against the bank) and **11** (the daily pending
receivables sheet). In the requirements map
(`docs/implementation/requiremnts/accounts-and-compliance-feature-map.md`) these are map R4, R5,
R7 and R11.

Every `file:line` below was read from disk on 12 Oct 2026 on branch
`fix/1210-push-integrations-same-db-check` (HEAD `d878426`). Check it; do not trust it.

Seven sibling plans were written the same day. This one depends on two of them:
**plan B** (`1210-zoho-credit-notes-and-payables-plan.md`) owns the customer credit-note table this
plan only reads, and **plan D** (`1210-bank-accounts-and-suspense-plan.md`) owns bank accounts,
the new bank permission module and suspense lines, all of which the matching screens here sit
next to.

**Words used in this plan, explained once:**

- **Settlement** — the end-of-day check that the money the till says it took actually exists:
  cash in the drawer, and card / UPI / loan money arriving in the bank.
- **EDC** — the card-swipe machine. At night it sends the day's card sales to the bank as one
  **batch**; the bank pays the batch into our account a day or two later.
- **MDR** (merchant discount rate) — the percentage the bank keeps from each card sale as its fee.
  The bank also charges **18 % GST on that fee**, so what it keeps is `sales × rate × 1.18`.
- **Variance** — the difference between what was expected and what happened.
  **Tolerance** — the size of variance we accept as rounding.
- **Receivable** — money someone owes us. **In transit** — money that is owed to us but is
  already on its way (a card batch not yet credited, a loan the financier has not yet paid out).
- **Financier / payout** — Bajaj Finance (or another lender) pays us for a bike a customer bought
  on EMI. It pays the **amount financed** minus its own **charges** (subvention, processing fee);
  what lands in our bank is the **payout**.
- **Credit note** — a document that reduces what a customer owes us (a return, a discount given
  after the sale).

---

## 0. Requirement

### 0.1 The owner's words, verbatim (8 Oct 2026)

> 4. Physical verification of counter cash vs. billing software registers at the end of each shift/day.
> 5. Daily verification of ICICI EDC/POS machine MDR batch settlements and emails against actual bank credits.
> 7. Logging into the Bajaj merchant portal daily to verify loan approvals, disbursements, and settlement receipts and verifying with bank credits.
> 11. Updating the "Pending Receivables Sheet" daily (uncollected customer dues, corporate deliveries, pending card/loan disbursements).

The answers given in session on 12 Oct 2026 (§1.1) sharpen these: one cash count **per store per
day** (D13), a **fixed MDR rate per card type** (D14), Bajaj **entered loan by loan by hand now,
file import later** (D15), corporate as **both a customer type and a per-delivery flag** (D18).
They do not replace the words above.

### 0.2 Restated as requirements

| # | Requirement | Owner's point / map | Part |
|---|---|---|---|
| **R1** | At day end, the cash physically counted at each store's counter is compared with the cash the billing software (Zakya POS) says that store took, net of cash put in and taken out. One count per store per day. | 4 · map R4 · D13 | A |
| **R2** | A day's settlement is **per store** (BCH, BCC — the `Store` rows). Days already settled as one combined row stay as they are and are shown as "both stores, before the split". | 4 · map R4 · D1, D13 | A |
| **R3** | Every day, each store's card-machine sales are matched to the bank credit(s) that paid them. | 5 · map R5 | B |
| **R4** | A **fixed MDR rate per card type** is a setting. The card match computes the expected fee from it and says plainly whether the bank kept **the fee we expected**, **₹X more** ("short by ₹X") or **₹X less** ("over by ₹X"). Settlement emails are not read. | 5 · map R5 · D14 | B |
| **R5** | Every loan sale has its own record: store, customer, invoice, financier (Bajaj and others), loan / application number, amount financed, expected payout, and a status **Approved → Disbursed → Received** (or Cancelled). Entered by hand. | 7 · map R7 · D15 | C |
| **R6** | A loan is **Received** only when it is matched to an actual bank credit. One financier credit may pay several loans. | 7 · map R7 | C |
| **R7** | The loan record is keyed so a future financier settlement file can be imported and matched **by loan number** without a redesign. No import is built now. | 7 · map R7 · D15 | C |
| **R8** | `/receivables` is the daily pending-receivables sheet: uncollected customer dues (the invoice list it already has). | 11 · map R11 | D |
| **R9** | "Corporate" is a customer type, and each delivery can override it (yes / no / follow the customer). `/receivables` can be filtered to corporate dues. | 11 · map R11 · D18 | D |
| **R10** | `/receivables` gets an **In transit** tab: card sales not yet credited by the bank, and loans not yet received from the financier. | 11 · map R11 | D |
| **R11** | Customer credit notes pulled from Zoho (by plan B) reduce what a customer is shown to owe — each rupee once. | 11 · map R11, map R3 · D3, D4 | D |
| **R12** | The sheet exports to Excel / PDF, and the accountant reaches it every day from `/accounts`. | 11 · map R11 | D |

---

## 1. Questions and clarifications — answer before build

### 1.1 Decisions on record

Answered in session, 12 Oct 2026. Only the ones that shape this plan are repeated.

| # | Decision | What it means here | Date |
|---|---|---|---|
| D1 | Link records to the existing `Store` table (BCH_STORE, BCC_STORE) with a `storeId` foreign key. No more "HUB"/"CENTRE" strings. | `PosSession.storeId`, `DailySettlement.storeId`, `FinanceCase.storeId` are FKs to `Store`. | 12 Oct 2026 |
| D2 | One Zoho Books organisation for both stores. | A Zoho record does not say which store it belongs to by organisation; the store must come from something inside the record (Q1). | 12 Oct 2026 |
| D3, D4 | Credit notes are typed in Zoho and pulled; the pull takes vendor credits **and customer credit notes**. | Plan B owns the customer credit-note table and its pull. This plan only reads it (Part D6). | 12 Oct 2026 |
| D9 | A credit note reduces a balance on the day it is received; applying it later only links it — never subtracted twice. | The customer side (D6) follows the same "each rupee once" rule. | 12 Oct 2026 |
| D13 | Cash count: once per **store** per **day** — not per shift, not whole-business. | `DailySettlement` becomes one row per (date, store). No shift dimension. | 12 Oct 2026 |
| D14 | Card MDR: a **fixed rate setting per card type** the match compares against. | An `AppSetting` holding rates; the card match classifies the fee. Emails are not read. | 12 Oct 2026 |
| D15 | Bajaj settlement export: **unknown**. Manual per-loan entry now, file import later. | `FinanceCase`, unique on (financier, loan number). | 12 Oct 2026 |
| D16 | Bank statements and suspense lines get their own permission module, separate from `bills`. | Plan D creates it. Matching *sales* money to a bank credit stays on `pos.approve` here (Q12). | 12 Oct 2026 |
| D18 | Corporate: **both** a customer type and a per-delivery flag; the customer type sets the default, the delivery can override. | `CustomerType.CORPORATE` + `Delivery.isCorporate Boolean?` (null = follow the customer). | 12 Oct 2026 |

### 1.2 Open questions

Each one changes what gets built. A default is given so "defaults" is a complete answer.

| # | Question | Why it changes the build | Options | Recommended default | Blocks build? | **Answer** |
|---|---|---|---|---|---|---|
| **Q1** | **How does the app tell which store a sale belongs to?** Today nothing does (§2.1): the "session" is built per *date* from invoices and payments, and none of its fields names a store. | This is the whole of R2. Every other part keys off it. | (a) **The invoice number's prefix**, using the prefixes already on the FLOOR warehouses at `/stores` (`Warehouse.invoicePrefix`) — the rule deliveries already use. A payment takes the store of the invoice(s) it pays. (b) Zoho **Locations**, if the Zoho organisation has one location per store — map each `location_id` to a `Store` as data. (c) The bank/cash **account** a payment is deposited to (`account_name`). | (a), with (b) added later only if (a) leaves too many sales unassigned. A payment with no invoice, or paying invoices of both stores, is shown as **Unassigned** on the screen, never guessed. | **Yes** | |
| **Q2** | **From which day are settlements split by store, and what happens to days already settled?** | Decides the cut-over rule and what "In transit" counts. A combined day's totals cannot be divided after the fact. | (a) Split every day fetched after deploy. A combined day nobody has cash-counted or matched can be **re-fetched** to split it; a combined day someone has acted on stays combined for ever, badged "both stores, before split". (b) Also split acted-on days by deleting and redoing them. | (a). The In-transit tab counts from the first split day; a toggle includes older combined days. | **Yes** | |
| Q3 | **Card types and rates.** Does the counter record card payments in Zakya under different payment modes per card type (e.g. "Credit Card", "Debit Card", "RuPay")? What are the ICICI rates? | Zoho does **not** record card network or credit/debit (§2.10). Per-type rates only work if the counter's payment-mode names carry the type. | (a) The rate table lists card types, each with the Zakya payment-mode names that mean it; any card mode not listed uses one **blended** rate. (b) The accountant types the day's card-type split from the EDC batch slip. | (a). The rates themselves are data, typed on the settings page after deploy — not needed to build. The read-only query in §4 step 1 lists the payment-mode names actually in use. | No | |
| Q4 | Do both stores' card machines have the **same** rates (one ICICI agreement)? | Per-store rates means a per-store rate table. | (a) one table; (b) one table per store | (a); (b) is a small later change to the setting's shape | No | |
| Q5 | Does one bank credit ever pay **more than one** settlement line — a weekend's batches credited together, or one terminal shared by both stores? | Today a bank line, once matched, is used up whole (§2.3). A combined credit cannot be matched to two days. | (a) A bank credit can be **split** across several settlement lines and loans; it is "matched" when fully used. (b) Keep one-to-one. | (a) — it is a superset of (b) and costs one sum query | No | |
| Q6 | Which financiers? Bajaj only, or also HDFC, IDFC First, TVS Credit, Home Credit…? | The financier is half of the loan's unique key (R7). | a list kept as a setting | A setting seeded with "Bajaj Finance"; the accountant adds names | No | |
| Q7 | **Who records a loan, and from where?** | Decides the screen and the permission. | (a) the accountant, from the settlement day's Zoho finance payments ("Add as loan", prefilled) or by hand on the In-transit tab; (b) the counter, at the sale | (a), on `pos.create` | No | |
| Q8 | On new per-store settlements, retire the single "match the day's FINANCE total to a bank line" button, since loans are now settled one by one? | Two ways of matching the same Bajaj money would let it be counted twice. | (a) retire it on split days, keep it on combined days; (b) keep both | (a) | No | |
| Q9 | Expected **cash in the drawer** = cash sales + cash put in − cash taken out. Is there a fixed opening float (change) left in the drawer that the count includes? | Today's variance ignores cash in / cash out entirely (defect DF6). | (a) count excludes the float — formula as stated; (b) a per-store float setting added in | (a); the screen prints the formula | No | |
| Q10 | A delivery marked corporate whose invoice was never imported as a receivable (`/receivables` → Fetch) — show it in the corporate view from the delivery's own Zoho balance snapshot? | Corporate dues may otherwise be invisible. | (a) show it, labelled "balance as at import"; (b) only imported receivables | (a) | No | |
| Q11 | Customer credit notes: subtract only the **unused** part of each credit note from what the customer owes (the used part already shows on the invoice it was used against)? | Choosing wrong double-counts or under-counts a credit (§3 D6). | (a) unused balance only, plus applications made after the invoice was imported, if plan B stores them; (b) the full credit note total | (a) | No — waits for plan B | |
| Q12 | Matching a sale's money to a bank credit (card, loan) needs `pos.approve`, as matching does today. Should it **also** need plan D's bank module? | A person who can match settlements but not see bank statements. | (a) `pos.approve` only; (b) both | (a) — the match reads the bank lines it needs itself | No | |
| Q13 | The receivables import overstates partly-paid invoices (defect DF14). Fix the import to store what was already paid, and repair existing rows from the "Balance: ₹X" note they carry? | The sheet's main figure is wrong for those rows. | (a) fix the import; count the affected rows read-only; repair only on your sign-off; (b) fix the import only | (a) | No | |

---

## 2. How it works today — verified against the code

### 2.1 A "POS session" is not a Zakya session — and nothing in it names a store

`POST /api/pos/sessions` (`src/app/api/pos/sessions/route.ts:39-211`, guard `pos.create` at `:41`)
does **not** pull register sessions from Zakya. It builds one synthetic row per **date**:

1. Lists every sales invoice in the window from **Zakya** — `zakya.listAllInvoices(dateFrom, dateTo)` (`:76`).
2. Lists customer payments from **Zoho Books** (`:87-90`), falling back to Zakya's (`:100-111`).
3. Groups invoices by `inv.date` (`:121-134`): `total`, `count`, `creditSales += balance`.
4. Buckets each payment by its `payment_mode` text into cash / UPI / finance / card (`:137-162`).
5. Writes one `PosSession` per date with `zakyaSessionId = "ZAKYA-" + date` (`:167`) and
   `registerName: "Zakya POS"` — a constant (`:179`). `cashierName` is never set. `rawData` keeps
   only the per-mode totals (`:189-193`).

So the answer to "what in a Zakya session identifies the store?" is **nothing**: there is no
session, the register name is hard-coded, there is no cashier (so `User.storeId`,
`schema.prisma:396`, cannot help), and the raw data is already aggregated across both stores.

What *can* identify the store:

- **The invoice number's prefix.** Since 16 Sep 2026 each FLOOR warehouse carries
  `invoicePrefix` (`schema.prisma:328-333`, unique) and `floorWarehouseForInvoice()`
  (`src/lib/deliveries/zoho-invoice.ts:30-50`) maps an invoice number to `{ warehouseId, storeId }`,
  longest prefix first, returning `null` (a "Dummy") rather than guessing. The deliveries import
  and the Zoho bulk fetch already use it (`api/zoho/trigger-pull/route.ts:488-498`,
  `api/deliveries/import-zoho/route.ts:98`). The prefixes are typed in at `/stores`.
- **A payment's invoice.** A Zoho customer payment names the invoice(s) it pays (§2.10), so it can
  take that invoice's store.
- **Zoho Locations**, if switched on (§2.10). Not known.

### 2.2 The settlement is one row per day for the whole business

| What | Where |
|---|---|
| `DailySettlement.date` is `@unique` — "One settlement per day" | `prisma/schema.prisma:2567` |
| `PosSession` has no store column; `sessionDate`, `registerName`, `cashierName`, mode totals, `rawData Json?` | `schema.prisma:2523-2563` |
| `SettlementMatch` — `paymentMode String // CARD, UPI, FINANCE, CASH_DEPOSIT`, `expectedAmount`, `bankTxnId`, `matchedAmount`, `variance` — all money `Float` | `schema.prisma:2605-2621` |
| `SettlementStatus` PENDING / CASH_VERIFIED / PARTIALLY_MATCHED / FULLY_MATCHED / DISCREPANCY. **DISCREPANCY is never written** (grep finds it only in the two screens' style maps) | `schema.prisma:2515-2521` |
| Create: refuses if a row exists for the date (`findUnique({ where: { date } })`), takes every unlinked session of that UTC day, sums the five mode totals, links the sessions — in one transaction | `api/pos/settlement/route.ts:42-102` (`:51-52`, `:58-63`, `:74-95`) |
| Delete: guard `pos.delete`; restores matched bank lines to UNMATCHED, deletes matches, unlinks sessions, deletes the row — one transaction | `api/pos/settlement/route.ts:105-158` |
| Cash verification: `cashVariance = cashCounted − totalCash` | `api/pos/settlement/[id]/route.ts:84-100` |
| Manual totals edit and Cash In / Cash Out entry, same PUT, no zod | `[id]/route.ts:103-128` |
| The list screen fetches 1–30 days, then POSTs one settlement per date in a client loop | `accounts/settlement/page.tsx:86-161` |

**Per-store today is impossible by construction**: the unique index allows one row per date and
the sessions it sums carry no store.

### 2.3 Bank matching, and why the card line cannot tell a fee from a missing batch

- `POST /api/pos/settlement/[id]/match` (`match/route.ts:9-86`, guard `pos.approve` `:11`) takes
  `{ paymentMode, bankTxnId, matchedAmount }` from the body, sets `expectedAmount` to the day's
  **gross** total for that mode (`:32-38`), `variance = matchedAmount − expectedAmount` (`:39`),
  marks the bank line `MATCHED` (`:56-59`), and calls the day `FULLY_MATCHED` once matches reach
  **95 %** of the grand total (`:67`).
- For CARD the variance is therefore *always* negative — the bank keeps its fee — and a ₹1,800
  shortfall looks the same whether it is the fee or a lost batch. There is no rate anywhere.
- The screen offers **one** match per mode: `settlement.matches.find(mt => mt.paymentMode === m.key)`
  (`accounts/settlement/[id]/page.tsx:364`) hides "Match to bank txn" once any match exists.
- Candidate bank lines: CREDIT lines ±1/+2 days, UNMATCHED or FLAGGED, top 50 by amount, from
  **any** account (`[id]/route.ts:31-45`). Bank lines carry no account or store
  (`BankStatement.bank` is free text, `schema.prisma:1404-1423`) — plan D adds that.
- A bank line, once MATCHED, is used up whole. Nothing models part of a credit (Q5).

### 2.4 Bajaj today: one number per day

`PosSession.financeSales` (`schema.prisma:2536`) and `DailySettlement.totalFinance` (`:2574`) hold
the day's finance total, built from payments whose mode contains "bajaj", "finance" or "emi"
(`sessions/route.ts:153-154`). A FINANCE match links the whole day to one bank line. There is no
record per loan, so one loan Bajaj never pays is invisible once the day is "mostly matched".

### 2.5 Receivables today

| What | Where |
|---|---|
| `/receivables` lists `CustomerInvoice` rows, 50 at a time, with aging cards (Current, 1-30, 31-60, 60+) and a status filter. **No tabs, no export, no page-level permission check** — it relies on the API's 403 | `src/app/(dashboard)/receivables/page.tsx` (536 lines): list fetch `:99-102`, aging `:394-416`, filters `:439-451` |
| API guards: list, detail, aging all `customers.view`; create `customers.create` | `api/customer-invoices/route.ts:12, :85`; `[id]/route.ts:10`; `aging-summary/route.ts:9` |
| "What a customer owes" = Σ `amount` − Σ `paidAmount` over invoices with `status != PAID`, computed in two places that must agree | `api/customers/route.ts:73-83`, `api/customers/[id]/route.ts:45-60` |
| `CustomerInvoice` has no store, no delivery link (joined to `Delivery` by `invoiceNo` — the delivery detail route already does this) | `schema.prisma:1855-1874`; `api/deliveries/[id]/route.ts:76` |
| **No nav entry**: the `customers` module owns `/customers`; `/receivables` "simply has no nav entry now" and is reached from four links | `prisma/rbac-catalog.ts:538-575` |
| The `/accounts` hub has a **Receivable** tile linking to `/receivables` and a quick-link list without it | `accounts/page.tsx:185-197` (tile), `:121-127` (links) |
| The hub's summary already rolls up `customerInvoice` under `accounts.view` | `api/accounts/summary/route.ts:13, :63-67` |
| `src/lib/export.ts` — `exportToExcel(data, columns, filename)` and `exportToPDF(title, data, columns, filename)`, client-side; `ExportButtons` component; used by six screens, e.g. `accounts/vendor-ledger/page.tsx:146-150` | `src/lib/export.ts:16-79` |

### 2.6 Customer type and the delivery

`CustomerType` is `WALK_IN | REGULAR | DEALER` (`schema.prisma:186-190`); `Customer.type` defaults
`WALK_IN` (`:1830`). **Every place it is listed or switched on** (grep across `src/`, `prisma/*.ts`,
`scripts/`):

| File:line | What it does with the type |
|---|---|
| `src/types/index.ts:377` | `type CustomerType = "WALK_IN" \| "REGULAR" \| "DEALER"` |
| `src/lib/validations.ts:695` | `customerSchema.type: z.enum([...])`; `customerUpdateSchema` derives from it (`:698`) |
| `src/app/(dashboard)/customers/page.tsx:66-68, :75` | filter chips; badge colour by type |
| `src/app/(dashboard)/customers/_components/customer-edit-sheet.tsx:33-35, :73` | the type picker; default `WALK_IN` |
| `src/app/api/customers/route.ts:16, :131` | list filter (passes any string through); create default `WALK_IN` |
| `src/app/api/customers/[id]/route.ts:113, :127` | records a type change in the activity log and writes it |
| `src/lib/customers/find-or-create-by-phone.ts:49` | every customer the deliveries flow creates is `WALK_IN` |

Nothing else — no report, no service screen, no seed — reads it.

`Delivery` already has `storeId` (`:1992`), `customerId`, `zohoPaymentStatus` and `zohoBalance`
(a snapshot at import, `:2008-2009`). Nothing marks a delivery as corporate. Its PUT is guarded
`deliveries.edit` and parses `deliveryUpdateSchema` (`api/deliveries/[id]/route.ts:167, :172`;
schema `validations.ts:767-795`).

### 2.7 Where a setting lives

`AppSetting { key, value Text }` (`schema.prisma:2767-2771`). The typed pattern is
`src/lib/settings/stuck-hours.ts`: a zod schema, defaults, a 5-second cache, `get…()` that never
throws and `set…()` that validates and logs; its route is `GET` → `requireAuth`,
`PUT` → `requireFeature("settings", "edit")` (`api/settings/stuck-hours/route.ts:32, :46`).
`approval-rules.ts` is the same shape. `AlertConfig` is a singleton for alert phones and WhatsApp
templates — not a fit. `StorageConfig` / `IntegrationConfig` hold credentials — not a fit.
The `/settings` hub is a hard-coded list of entries (`settings/page.tsx:29-99`).

### 2.8 Guards as they stand

| Surface | Guard today |
|---|---|
| `GET/POST /api/pos/sessions` | `pos.view` / `pos.create` |
| `GET/POST/DELETE /api/pos/settlement` | `pos.view` / `pos.create` / **`pos.delete`** |
| `GET/PUT /api/pos/settlement/[id]` | `pos.view` / `pos.edit` |
| `POST/DELETE …/match` | `pos.approve` |
| `/accounts/settlement` and `/[id]` **screens** | **`bills.view`**, delete button on **`bills.delete`** (`settlement/page.tsx:48, :51`; `[id]/page.tsx:116`) |
| `pos` module in the catalog | actions `["view","create","edit","approve"]` — **no `delete`** (`rbac-catalog.ts:265-273`) |
| bank statements | `bills.view` / `bills.create` (`api/bank-statements/route.ts:15, :34`; `[id]/review/route.ts:14, :43`) — F9 confirmed |
| receivables data | `customers.view` / `customers.create` |

### 2.9 Every reader of `PosSession`, `DailySettlement`, `SettlementMatch`

| Reader | Reads | What it needs from this plan |
|---|---|---|
| `api/pos/sessions/route.ts` | writes sessions; force mode deletes settlements | Rewritten (A2) |
| `api/pos/settlement/route.ts` | list, create, delete | Store-aware (A3) |
| `api/pos/settlement/[id]/route.ts` | detail + bank candidates + Zoho payments; PUT | Store-aware, zod, lock, cash formula (A3, B3) |
| `api/pos/settlement/[id]/match/route.ts` | match / unmatch | Zod, allocation, card fee (B3) |
| `accounts/settlement/page.tsx`, `/[id]/page.tsx` | the two screens | Store chips, badge, card fee, loans (A4, B4, C3) |
| `src/lib/analytics/store.ts:325-328` | `posSession.aggregate({ _sum: { invoiceCount } })` for one day, **estate-wide**; withholds bills when two stores count (`:360-366`) | **Nothing to keep working**: per-store rows sum to the same day total. A store filter becomes *possible* once rows carry `storeId` — out of scope (§5) |
| `src/lib/analytics/time.ts:72-75` | comment only (UTC-midnight anchoring) | nothing |
| `BankTransaction.settlementMatches` back-relation | — | nothing |
| Dashboard, reports | **none** — grep finds no other reader | — |

### 2.10 What Zoho can tell us (public API documentation, read 12 Oct 2026)

- **Zoho Books — customer payments** (<https://www.zoho.com/books/api/v3/customer-payments/>):
  the *List customer payments* example response carries `payment_id`, `payment_number`, the paid
  invoice number(s), `date`, `payment_mode`, `amount`, `location_id`, `location_name`. The list
  can be filtered `filter_by=PaymentMode.CreditCard`. **No field carries card network (Visa /
  Mastercard / RuPay) or credit vs debit.** The single-payment shape has `invoices[]` with
  `amount_applied`. The example's exact field name for the invoice number(s) differs from what the
  code's type assumes; it must be confirmed from one live read before code relies on it (E0).
  The code also reads `account_name` (`sessions/route.ts:81`), which the example does not show.
- **Zoho Inventory (Zakya's API) — invoices** (<https://www.zoho.com/inventory/api/v1/invoices/>):
  the invoice object carries `location_id` / `location_name`; whether the *list* response includes
  them was not confirmed from the documentation.
- **No new Zoho endpoint is needed.** Everything reads through the two list calls already in the
  registry: `invoices.list` and `customerpayments.list` (`src/lib/integrations/endpoints.ts:65-96`).
  **This plan writes nothing to Zoho.**

### 2.11 Live defects found while mapping

All in code this plan rewrites. Listed so the diff surprises nobody.

| # | Defect | Where | Effect |
|---|---|---|---|
| **DF1** | Any payment mode containing "bank" — including "Bank Transfer" — is counted as **card**; the explicit `banktransfer` branch below it is unreachable for those, and the final `else` puts **every unknown mode** into card too. | `sessions/route.ts:155-161` | Card totals are inflated by NEFT receipts and anything unrecognised, so the card match always looks short — exactly the number R4 must be able to trust. |
| **DF2** | Void invoices are not skipped. The Zoho bulk fetch skips them (`trigger-pull/route.ts:454-458`); this route does not. | `sessions/route.ts:121-134` | `totalSales` and `invoiceCount` include cancelled sales. |
| **DF3** | A payment on a date with no invoice is dropped with `continue`. | `sessions/route.ts:139` | A Sunday collection against Saturday's invoice never reaches any settlement. |
| **DF4** | **Re-fetch** deletes the range's settlements — cash-verified and matched ones included — **outside a transaction**, and deletes their matches **without** restoring the bank lines. | `sessions/route.ts:51-70` (contrast the DELETE route `settlement/route.ts:129-151`, which restores them) | Bank lines are left MATCHED to nothing; a counted, verified day is silently destroyed. |
| **DF5** | A day fetched before close is frozen: the next fetch sees `ZAKYA-<date>` exists and skips it. | `sessions/route.ts:168-169` | A noon fetch leaves half a day's cash in the settlement and the evening count shows a false variance. |
| **DF6** | `cashVariance = cashCounted − totalCash` ignores the Cash In / Cash Out saved on the same row. | `[id]/route.ts:86` vs `:118-127` | Any day with petty cash taken out shows a shortage that is not one. |
| **DF7** | Verifying cash sets `PARTIALLY_MATCHED` whenever any amount is matched — including on a `FULLY_MATCHED` day. | `[id]/route.ts:87` | The status goes backwards. |
| **DF8** | The match takes `matchedAmount` from the client, never checks the line is a CREDIT, still unmatched, or near the date, and reads the settlement outside the transaction; two clicks can match one bank line twice. "Fully matched" is a 95 % guess. | `match/route.ts:14-39, :67` | Wrong amounts, double use of a credit, and a status that means nothing precise. |
| **DF9** | DELETE requires `pos.delete`, which **does not exist** in the catalog, so only ADMIN passes (through the short-circuit at `src/lib/rbac.ts:258`); the screen decides whether to show the button from `bills.delete`. | `settlement/route.ts:107`; `rbac-catalog.ts:272`; `settlement/page.tsx:51` | Nobody else can ever be granted it; the button and the API disagree. |
| **DF10** | Both settlement screens gate on `bills.view`; every API they call is `pos`. | `settlement/page.tsx:48`; `[id]/page.tsx:116` | A `pos` user without `bills` sees "Access Denied"; a `bills` user without `pos` sees a screen that 403s. |
| **DF11** | Deleting a single session that belongs to a settlement leaves the settlement's totals unchanged. | `settlement/route.ts:112-118` | Totals no longer equal their sessions. |
| **DF12** | The detail GET reads only page 1 of the day's Zoho payments and swallows a failure with an empty `catch`. | `[id]/route.ts:53-62` | A busy day shows a partial list with no warning. |
| **DF13** | No `createLogger` anywhere under `src/app/api/pos/`; every screen in scope calls `fetch().then(r => r.json())`. | e.g. `settlement/page.tsx:77-79, :107-112`; `receivables/page.tsx:76-79, :99-102, :208-235` | CLAUDE.md non-negotiables. |
| **DF14** | The receivables import creates each invoice with `amount = Zoho total` and **no `paidAmount`**; Zoho's balance goes only into `notes`. Due date is hard-coded to invoice date + 30. A customer that fails to save (e.g. no phone) is skipped silently. | `receivables/page.tsx:222-237`, `:213-214` | A ₹50,000 invoice with ₹45,000 paid shows ₹50,000 owed — the sheet's headline number is overstated. |
| **DF15** | The settlement list computes "today" with `toISOString()` in the browser. | `settlement/page.tsx:97-98` | Before 05:30 IST it fetches yesterday — the same fault `/receivables` already fixed (`receivables/page.tsx:130-135`). |

Not a defect in this plan's code, but surprising and recorded: `userCan` returns `true` for any
user whose role key is `"ADMIN"` (`src/lib/rbac.ts:258`), and the client store does the same
(`src/stores/permissions.ts:174-205`). CLAUDE.md says there is "no admin short-circuit — ADMIN
passes only because it holds every permission". This plan does not touch it; DF9 is only possible
because of it.

---

## 3. Implementation plan

Four parts, in order, on one branch, one commit per part. Three migrations, all additive. No new
Zoho endpoint, no Zoho write, no cron, no timer, no polling.

| Part | Requirements | Migration |
|---|---|---|
| E0 — confirm two facts, read-only | Q1, Q3 | — |
| A — settlement per store per day | R1, R2 | **M1** |
| B — card fees (MDR) and bank-credit allocation | R3, R4 | (in M1) |
| C — finance (loan) cases | R5, R6, R7 | **M2** |
| D — the pending-receivables sheet | R8–R12 | **M3** |

### Part E0 — confirm two facts before writing code (read-only)

1. **The payment row's fields.** On a local database restored from production
   (`npm run db:restore:local -- backups/<file>` nulls the Zoho credentials — reconnect Zoho Books
   locally with a **read-only** self-client, or use the test database, which holds production's
   live credentials since 12 Oct), add one temporary `log.debug` in `listCustomerPayments` printing
   `Object.keys(row)` of the first row — **keys only, never values** — and run one 1-day fetch.
   Record whether the invoice number(s) (`invoice_numbers` or `invoice_number`) and `location_id`
   are present. Remove the line. This is a READ; it does not touch the books.
2. **The payment-mode names in use.** Run the read-only SQL in §4 step 1 against production's
   snapshot. It lists every Zakya/Zoho payment-mode name and its total since the module went live.
   That list is what Q3's card-type mapping is typed from.

If (1) shows **no** invoice number on the list row, Q1(a) for payments would need one
`GET /customerpayments/{id}` per payment — a new registry entry and roughly 100 extra calls per day
fetched. Stop and re-plan with the owner rather than add it silently.

### Part A — settlement per store per day (R1, R2)

#### A1 — schema and migration M1 (`<ts>_settlement_per_store_and_card_fee`)

```prisma
model PosSession {
  …
  // Which store's sales these are (R2). Resolved from the invoice-number prefix (Q1). Null on
  // rows written before the split ("combined, pre-split") AND on the day's unassigned row —
  // `storeUnmatched` tells the two apart.
  storeId        String?
  store          Store?   @relation(fields: [storeId], references: [id], onDelete: Restrict)
  storeUnmatched Boolean  @default(false) // sales whose invoice matched no store prefix
  otherSales     Decimal  @default(0) @db.Decimal(12, 2) // bank transfers + unrecognised modes (DF1)
  …
  @@index([storeId, sessionDate])
}

model DailySettlement {
  id      String   @id @default(cuid())
  date    DateTime            // @unique REMOVED — see @@unique and the partial index below
  storeId String?             // null = a combined day settled before the split (R2)
  store   Store?   @relation(fields: [storeId], references: [id], onDelete: Restrict)
  …
  totalOther        Decimal   @default(0) @db.Decimal(12, 2)
  // Set by the first human write (cash count, totals edit, cash in/out, a match, a loan).
  // Until then a re-fetch may refresh the totals from Zoho (DF5); after, never.
  lockedAt          DateTime?
  // Card fee (Part B), computed at the first CARD match and kept until "Recalculate".
  cardFeeExpected   Decimal?  @db.Decimal(12, 2)
  cardFeeRatePct    Decimal?  @db.Decimal(6, 4) // effective rate actually applied
  cardFeeComputedAt DateTime?
  financeCases      FinanceCase[]                // Part C
  …
  @@unique([date, storeId])
  @@index([storeId, date])
}
```

`Store` gains `posSessions PosSession[]`, `settlements DailySettlement[]`, `financeCases FinanceCase[]`.

**SQL shape** (written by `npx prisma migrate dev --name settlement_per_store_and_card_fee` on
localhost, then the last statement appended by hand):

```sql
ALTER TABLE "PosSession" ADD COLUMN "storeId" TEXT,
  ADD COLUMN "storeUnmatched" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "otherSales" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "DailySettlement" ADD COLUMN "storeId" TEXT,
  ADD COLUMN "totalOther" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "cardFeeExpected" DECIMAL(12,2),
  ADD COLUMN "cardFeeRatePct" DECIMAL(6,4),
  ADD COLUMN "cardFeeComputedAt" TIMESTAMP(3);
DROP INDEX "DailySettlement_date_key";
CREATE UNIQUE INDEX "DailySettlement_date_storeId_key" ON "DailySettlement"("date", "storeId");
CREATE INDEX "DailySettlement_storeId_date_idx" ON "DailySettlement"("storeId", "date");
CREATE INDEX "PosSession_storeId_sessionDate_idx" ON "PosSession"("storeId", "sessionDate");
ALTER TABLE "PosSession" ADD CONSTRAINT "PosSession_storeId_fkey" FOREIGN KEY ("storeId")
  REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailySettlement" ADD CONSTRAINT "DailySettlement_storeId_fkey" FOREIGN KEY ("storeId")
  REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- HAND-WRITTEN. Postgres treats NULLs as distinct in a unique index, so (date, storeId) alone
-- would allow two combined rows for one date. This keeps the old one-per-day rule for exactly
-- the rows the old rule governed. Prisma cannot express a partial index; `migrate diff` does not
-- model it and will not try to drop it — the precedent is Warehouse_one_primary_floor_per_store in
-- 20260916173617_delivery_floor_warehouse_and_holds. Every existing row has storeId NULL and was
-- unique on date, so this cannot fail at creation.
CREATE UNIQUE INDEX "DailySettlement_one_combined_per_date"
  ON "DailySettlement" ("date") WHERE "storeId" IS NULL;
```

**Backfill: none, deliberately.** A combined day's totals cannot be divided between stores after
the fact. Existing rows keep `storeId NULL` and are the "combined, pre-split" rows of R2.

**Migration rules.** *Rule 3* — the only `DROP` is an **index**, not a column; it is replaced in the
same file by two indexes that together keep every existing row's guarantee. No `ALTER COLUMN`, no
`SET NOT NULL`. *Rule 7* — between `migrate deploy` and the new code going live, the old code keeps
working: `findUnique({ where: { date } })` (`settlement/route.ts:51`) still compiles to
`WHERE "date" = $1`, the old sessions route writes `ZAKYA-<date>` rows with `storeId NULL` — a
combined row, guarded by the partial index exactly as before — and nothing old reads a new column.
The one hazard: a fetch run by the **old** code after the new code has split a date would add a
combined row beside the store rows. Deploy the code within minutes of the migration and do not
fetch in between. *Rule 9* — `npm run db:snapshot` before applying.

New money columns are `Decimal(12, 2)` (database-architect red flag on `Float`). The existing
settlement columns stay `Float` — converting them is `docs/schema-review.md` item 5, not this plan
— so every comparison between the two is done in **paise** (integer `Math.round(x * 100)`), in one
helper, `src/lib/settlement/money.ts`.

#### A2 — the pull: one row per store per day (`POST /api/pos/sessions`)

Rewrite the handler body; keep the route and its guard `pos.create`. Pure pieces move to
`src/lib/settlement/` because two routes and a test need them:

- `src/lib/settlement/payment-modes.ts` — `classifyPaymentMode(name, cardModeNames)` →
  `CASH | UPI | FINANCE | CARD | OTHER`. Fixes **DF1**: "bank transfer" / "bank remittance" →
  `OTHER`; an unrecognised name → `OTHER` with a `log.warn` naming the mode (a mode name is not a
  secret); a name listed under any card type in the card-fee setting (B1) → `CARD` regardless of
  its spelling.
- `src/lib/settlement/store-of.ts` — `storeOfInvoice(invoiceNo, floors)` wraps
  `floorWarehouseForInvoice`; `storeOfPayment(payment, invoiceStore)` returns the store of the
  invoice(s) it pays when they all agree, else `null` (unassigned). No store is ever guessed (the
  "Dummy" rule, `zoho-invoice.ts:13-15`).

The handler, in order:

1. zod `posFetchSchema = { dateFrom, dateTo (YYYY-MM-DD, ≤ 31 days), force?: boolean }`.
2. Load floors once (`listFloorWarehousesWithPrefix`). Load the card-fee setting (B1) for the card
   mode names.
3. Fetch invoices (Zakya) and payments (Books, else Zakya) exactly as today. **Skip void invoices**
   (DF2).
4. Bucket by `(date, storeId | UNASSIGNED)`. A payment on a date with no invoice still creates its
   bucket (DF3). Per bucket keep `total`, `count`, the five mode totals plus `other`, and
   `paymentModes: { "<mode name>": amount }` in `rawData` (Part B reads it for the card-type split).
5. Per bucket, inside one `$transaction` per date:
   - `zakyaSessionId = "ZAKYA-<date>-<store.code>"` or `"ZAKYA-<date>-UNASSIGNED"`.
   - **A combined row exists for that date** (`storeId NULL`, `storeUnmatched false`, i.e. a
     pre-split day) → skip the date and report it as "settled as combined — Re-fetch to split".
   - **Store row exists and its settlement is locked** (`lockedAt` set) → skip, report "locked".
   - **Store row exists, unlocked** → **refresh** its totals in place and recompute its
     settlement's totals (fixes DF5). Idempotent: running it twice gives the same row.
   - **New** → create.
   - The `UNASSIGNED` row is always deleted and rebuilt (it is never settled).
6. **Force (Re-fetch)** — fixes DF4: in the same transaction, list every settlement in the range.
   If **any** is locked (or is a combined day with a cash count or a match), refuse with **409**
   and the list of dates: *"These days have been counted or matched and cannot be re-fetched:
   3 Oct (BCH), 4 Oct (both stores). Delete them first."* Otherwise delete their matches,
   restore their bank lines' allocation (B3), unlink and delete sessions and settlements, then pull.
   This is also how an untouched combined day is **split** (Q2).
7. Response: `{ fetched, voidSkipped, paymentsFound, created, refreshed, skippedLocked,
   skippedCombined, unassigned: { invoices, amount }, otherModes: [names], source, paymentError }`.

No Pull-Preview-Approve step: these rows are an aggregate snapshot of Zoho that the settlement
screen itself presents for review, and they are refreshed from Zoho until a person acts — the
existing behaviour, made honest (see the board check).

#### A3 — settlement routes

`src/lib/settlement/status.ts` — one pure function replacing the 95 % guess (DF7, DF8):

```
PENDING            nothing counted, nothing matched
CASH_VERIFIED      cash counted, no bank match yet
PARTIALLY_MATCHED  some bank-settled modes (CARD, UPI, CASH_DEPOSIT) with a non-zero total
                   are not yet matched in full
FULLY_MATCHED      every such mode is matched to within tolerance, the card fee is "as expected",
                   and the cash variance is within ₹1
DISCREPANCY        every mode is matched but the card fee is short/over beyond tolerance,
                   or the cash variance is beyond ₹1
```

FINANCE is **not** in the status on split days — loans settle case by case over weeks (Part C), and
a day must not stay "partially matched" until Bajaj pays (Q8). Combined days keep counting it.

| Route | Change |
|---|---|
| `GET /api/pos/settlement` (`pos.view`) | `?storeId=` and `?scope=split\|combined\|all`; include `store { id, name, code }`; list order date desc, store sortOrder |
| `POST /api/pos/settlement` (`pos.create`) | zod `{ date, storeId? }`. With `storeId`: create that store's row from its unlinked sessions. Without: create one per store that has unlinked sessions that date (the list screen's loop then makes one call per date, not per store). Refuse **409** if a combined row exists for the date. Never creates a combined row. Concurrency: `@@unique([date, storeId])` turns a double-click into a P2002 → "already exists" |
| `DELETE /api/pos/settlement` (`pos.delete` — now real, A5) | zod; unchanged transaction; restores allocations through the B3 helper. Single-session delete **refuses** when the session is linked (DF11) |
| `GET /api/pos/settlement/[id]` (`pos.view`) | include `store`; bank candidates via B3's helper (remaining > ₹1), filtered to the store's bank accounts **once plan D lands**; Zoho payments: **all pages** (`listAllCustomerPayments`) for the date, filtered to this store with `storeOfPayment`; the `catch` logs a `warn` and returns `paymentsError` so the screen can say so (DF12) |
| `PUT /api/pos/settlement/[id]` (`pos.edit`) | zod `settlementUpdateSchema` (a discriminated union: `cash`, `totals`, `cashFlow`). Cash: `expectedCash = totalCash + cashIn − cashOut`, `cashVariance = cashCounted − expectedCash` (DF6, Q9); status from `status.ts` (DF7). Every branch sets `lockedAt` if null. All in one transaction |

#### A4 — the two settlement screens

Both move to `apiFetch` / `apiTry` (DF13), gate on `canView("pos")` (DF10), show the delete button
on `canDelete("pos")` (DF9), and get `createLogger("settlement:screen")`.

- **List** (`accounts/settlement/page.tsx`): a store chip row (All · BCH · BCC · Before split),
  default All. Each card shows the store name; a combined row shows a grey badge **"Both stores ·
  before split"**. The fetch result card adds "₹X of sales matched no store prefix — set the prefix
  on /stores and fetch again" when `unassigned.amount > 0`, and lists `skippedLocked` /
  `skippedCombined` dates. "Today" is built as an IST calendar date, not `toISOString()` (DF15).
  "New" asks date and store.
- **Detail** (`accounts/settlement/[id]/page.tsx`, 659 lines — new sections go in
  `accounts/settlement/[id]/_components/`): the header names the store; a combined day shows one
  sentence: *"This day was settled before settlements were split by store. Its totals cover both
  stores and cannot be divided."* The Cash Verification block prints the formula with the numbers:
  *"Expected ₹41,200 = cash sales ₹43,000 + cash in ₹0 − cash out ₹1,800"*. The "Payments
  Received" block shows this store's payments only and a warning line when `paymentsError` is set.

#### A5 — RBAC

`prisma/rbac-catalog.ts` `pos` (`:265-273`): actions become
`["view", "create", "edit", "delete", "approve"]` (DF9); description becomes *"Point-of-sale
totals per store, daily cash settlement, card fees and loan (finance) cases"*. Adding an action
creates permission rows and revokes nothing. **Owner step after deploy: `npm run db:seed:rbac`**,
then grant `pos.delete` on `/team/permissions` to whoever should delete settlements (until then
only ADMIN can, as today).

### Part B — card fees (MDR) and bank-credit allocation (R3, R4)

#### B1 — the rate setting

`src/lib/settings/card-fees.ts`, the `stuck-hours.ts` pattern exactly, `AppSetting` key
`card_fee_rates`:

```ts
cardFeeSettingSchema = z.object({
  cardTypes: z.array(z.object({
    key: z.string().regex(/^[A-Z_]{2,20}$/),   // "DEBIT", "CREDIT", "RUPAY_DEBIT", "AMEX"
    label: z.string().min(1).max(40),
    ratePct: z.number().min(0).max(5),         // 1.75 means 1.75 %
    zohoModes: z.array(z.string().min(1)),     // payment-mode names that mean this card type
  })).max(12),
  fallbackRatePct: z.number().min(0).max(5),   // the blended rate for card modes not listed
  gstOnFeePct: z.number().min(0).max(28),      // default 18
  toleranceRupees: z.number().min(0).max(1000),// default 10
  financiers: z.array(z.string().min(1).max(60)).min(1), // Part C, default ["Bajaj Finance"]
});
```

Defaults: no card types, `fallbackRatePct` **0** with the screen saying *"No card fee rate set —
set it in Settings › Card fees"* rather than inventing a rate; GST 18; tolerance ₹10; financiers
`["Bajaj Finance"]`. (RuPay debit cards and UPI carry **zero** MDR by law since 1 Jan 2020 — a
`RUPAY_DEBIT` type at 0 % expresses that; the actual ICICI rates are the owner's data, Q3.)

Route `src/app/api/settings/card-fees/route.ts`: `GET` → `requireFeature("pos", "view")` (the
settlement screen needs the rates to explain its numbers); `PUT` → `requireFeature("settings",
"edit")`, zod-parsed, logged. (If `notifications-and-settings-rbac-plan.md` Part A lands first, the
PUT moves to that plan's per-section action; the route is the only line that changes.)

Screen: `src/app/(dashboard)/settings/card-fees/page.tsx` — a table of card types (label, rate,
the Zakya mode names as chips picked from the names seen in the last 90 days of `PosSession.rawData`
plus free text), the fallback rate, GST, tolerance, and the financiers list. A new entry
**"Card fees & finance companies"** in the `/settings` hub list (`settings/page.tsx`). The
settlement detail links to it.

#### B2 — the expected fee

`src/lib/settlement/card-fee.ts` (pure):

```
input : the settlement's card-classified mode amounts (Σ of its sessions' rawData.paymentModes
        whose mode is CARD) and the setting
lines : for each card type, sales = Σ amounts of its zohoModes; any card amount in no type
        → one "Other / blended" line at fallbackRatePct
fee   : Σ round2(sales × ratePct / 100) × (1 + gstOnFeePct / 100)
output: { lines[], expectedFee, effectiveRatePct = expectedFee / cardSales × 100,
          usedFallback: boolean, expectedCredit = cardSales − expectedFee }
```

Classification, after the matches (paise arithmetic):

```
actualFee   = totalCard − Σ CARD matched amounts
difference  = actualFee − cardFeeExpected
|difference| ≤ toleranceRupees  →  "Fee as expected"
difference  >  toleranceRupees  →  "Short by ₹difference"   (the bank kept more, or a batch is missing)
difference  < −toleranceRupees  →  "Over by ₹|difference|"  (more arrived — e.g. another day's batch)
```

Worked example: BCH card sales ₹1,00,000, of which ₹60,000 "Debit Card" at 0.40 % and ₹40,000
"Credit Card" at 1.75 %. Fee = (240 + 700) × 1.18 = **₹1,109.20**. Expected credit ₹98,890.80.
The bank credits ₹98,700 → actual fee ₹1,300 → difference +₹190.80 → **"Short by ₹190.80"**.

`cardFeeExpected` / `cardFeeRatePct` / `cardFeeComputedAt` are written at the **first** CARD match
and kept, so a later rate change does not rewrite a settled day. A **Recalculate with current
rates** action (`pos.approve`) refreshes them.

#### B3 — one bank credit, several uses (Q5)

`src/lib/settlement/bank-allocation.ts` (takes a transaction client; shared by the settlement
match and the loan receive in Part C — the reason it lives in `src/lib` rather than in a route):

- `lockBankCredit(tx, bankTxnId)` — `SELECT … FROM "BankTransaction" WHERE id = $1 FOR UPDATE`
  (parameterised `$queryRaw`), then checks `type = CREDIT`.
- `remainingOn(tx, bankTxnId)` = `amount − Σ SettlementMatch.matchedAmount − Σ FinanceCase.receivedAmount`.
- `settleStatus(tx, bankTxnId)` — `MATCHED` + `processedAt` when remaining ≤ ₹1, else back to
  `UNMATCHED` (or the `FLAGGED` it had). Existing matches used whole credits, so existing data is
  already consistent with this rule.

`POST /api/pos/settlement/[id]/match` (`pos.approve`), rewritten (DF8): zod
`{ paymentMode: "CARD"|"UPI"|"CASH_DEPOSIT"|"FINANCE"(combined days only), bankTxnId, amount }`.
In one transaction: re-read the settlement; lock the credit; refuse if `amount > remaining` (**409**,
*"Only ₹12,400 of this credit is still unused"*); create the match; on CARD, compute the fee if not
yet computed (B2); update `matchedAmount` / `unmatchedAmount` / status via `status.ts`; set
`lockedAt`; `settleStatus`. `DELETE` reverses the same way. The screen pre-fills `amount` with
`min(remaining, still expected for the mode)` and lets the accountant change it.

Coordination with **plan D**: two modules keep writing `BankTransaction.matchStatus` (finding L13 in
`docs/ledger-and-reconciliation-flow.md`). If plan D adds a "who matched this" column, these two
writers stamp it `SETTLEMENT` and `FINANCE`. Plan D's reconcile screen should show "₹X already used
by settlement" on a partly allocated credit; the helper above is what it calls.

#### B4 — the card line on the detail screen

`_components/card-fee-card.tsx`: card sales; one row per card type (sales, rate, fee) and the
blended row flagged *"rate not set for these modes — blended rate used"*; GST on fee; expected
credit; the matched credits (several allowed now — the `find` at `[id]/page.tsx:364` becomes a
`filter`); and the verdict in words and colour: green *Fee as expected*, red *Short by ₹190.80*,
amber *Over by ₹X*. The UPI and cash-deposit lines get the same multi-match list without a fee.

### Part C — finance (loan) cases (R5, R6, R7)

#### C1 — schema and migration M2 (`<ts>_finance_case`)

```prisma
/// A loan sale's life with the financier. Never deleted — CANCELLED instead.
enum FinanceCaseStatus {
  APPROVED   // the financier approved the loan; the customer took the goods
  DISBURSED  // the financier's portal says it has paid us
  RECEIVED   // the money is matched to a bank credit (R6)
  CANCELLED  // loan cancelled or sale reversed
}

model FinanceCase {
  id               String            @id @default(cuid())
  storeId          String
  store            Store             @relation(fields: [storeId], references: [id], onDelete: Restrict)
  financier        String            // one of the setting's `financiers` (Q6) — validated by zod
  loanNo           String?           // application / loan number from the financier's portal
  customerName     String
  customerId       String?           // resolved from the invoice's delivery or receivable when found
  customer         Customer?         @relation(fields: [customerId], references: [id], onDelete: Restrict)
  invoiceNo        String?           // the Zoho/Zakya sales invoice
  saleDate         DateTime
  settlementId     String?           // the store-day it came from, when created there
  settlement       DailySettlement?  @relation(fields: [settlementId], references: [id], onDelete: SetNull)
  zohoPaymentId    String?           @unique // the Zoho finance-mode payment it was created from
  amountFinanced   Decimal           @db.Decimal(12, 2)
  financierCharges Decimal           @default(0) @db.Decimal(12, 2) // subvention / processing fee kept by the financier
  expectedPayout   Decimal           @db.Decimal(12, 2)             // amountFinanced − financierCharges, written by the API
  status           FinanceCaseStatus @default(APPROVED)
  approvedAt       DateTime?
  disbursedAt      DateTime?
  disbursementRef  String?           // UTR / reference on the portal
  bankTxnId        String?
  bankTxn          BankTransaction?  @relation(fields: [bankTxnId], references: [id], onDelete: Restrict)
  receivedAmount   Decimal?          @db.Decimal(12, 2)
  receivedAt       DateTime?
  receivedById     String?
  receivedBy       User?             @relation("FinanceCaseReceivedBy", fields: [receivedById], references: [id], onDelete: SetNull)
  cancelledReason  String?
  notes            String?
  createdById      String
  createdBy        User              @relation("FinanceCaseCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt

  @@unique([financier, loanNo]) // R7: a future financier file matches here; NULL loanNo rows do not collide
  @@index([status, storeId])    // the In-transit tab
  @@index([bankTxnId])
  @@index([settlementId])
  @@index([invoiceNo])
  @@index([customerId])
}
```

Back-relations on `Store`, `Customer`, `DailySettlement`, `BankTransaction`
(`financeCases FinanceCase[]`) and `User` (two named relations). `BankTransaction` → `Restrict`:
nothing deletes bank lines today (no delete route exists under `api/bank-statements/`), and a
received loan must never silently lose its bank link. **SQL:** `CREATE TYPE`, `CREATE TABLE`, the
indexes and foreign keys — a new table, nothing populated is touched (rules 3 and 7 trivially met).

**Why `financier` is text and not an enum:** adding a lender must be a setting change, not a
migration (the `IntegrationConfig.provider` precedent, `schema.prisma:1463-1466`). The unique key
stays stable because the API only accepts names from the setting's list and stores them exactly.

#### C2 — API (`src/app/api/pos/finance-cases/`)

| Method + path | Guard | Body (zod, `src/lib/validations.ts`) | Does |
|---|---|---|---|
| `GET /api/pos/finance-cases` | `pos.view` | query: `status`, `storeId`, `q`, `page` | list, newest sale first |
| `POST /api/pos/finance-cases` | `pos.create` | `financeCaseCreateSchema`: `storeId, financier (∈ setting), loanNo?, customerName, invoiceNo?, saleDate, amountFinanced > 0, financierCharges ≥ 0 (≤ amountFinanced), status: APPROVED\|DISBURSED, disbursedAt?, disbursementRef?, settlementId?, zohoPaymentId?, notes?` | writes `expectedPayout`; resolves `customerId` by `invoiceNo` (Delivery, else CustomerInvoice); **409** on a duplicate `zohoPaymentId` ("This payment is already loan LN-123") or `(financier, loanNo)` |
| `PATCH /api/pos/finance-cases/[id]` | `pos.edit` | `financeCaseUpdateSchema` | edits while not RECEIVED; transitions through a `VALID_TRANSITIONS` map: APPROVED→DISBURSED (stamps `disbursedAt`), APPROVED/DISBURSED→CANCELLED (reason required); never into RECEIVED (only `receive` does that) |
| `POST /api/pos/finance-cases/receive` | `pos.approve` | `{ bankTxnId, cases: [{ id, receivedAmount > 0 }] (1..50) }` | one transaction: `lockBankCredit`; every case APPROVED/DISBURSED and unreceived; **Σ receivedAmount must equal the credit's remaining amount to within ₹1** (409 otherwise, naming both numbers — the accountant adds the missing loan or fixes a charge first); cases → RECEIVED with `bankTxnId`, `receivedAt`, `receivedById`; `settleStatus` |
| `POST /api/pos/finance-cases/[id]/unreceive` | `pos.approve` | — | back to DISBURSED, link cleared, `settleStatus` recomputed |

Each status change also writes `logActivity` (`src/lib/activity-log.ts:76`) with the case id —
the trail of who approved, disbursed and received what.

Per-case variance (`receivedAmount − expectedPayout`) is stored implicitly and shown red when short:
*"Bajaj paid ₹480 less than expected on LN-123"* — that is a financier charge we did not expect,
to be chased or written into `financierCharges`.

#### C3 — screens

- **Settlement detail** — `_components/finance-cases-card.tsx` replaces the FINANCE match button
  on split days (Q8): the day's finance total, the Zoho finance-mode payments for this store with an
  **Add as loan** button each (prefilled; a payment already turned into a case shows its loan
  number instead), and the day's cases with status chips. Combined days keep today's button.
- **In-transit tab** (Part D4) — the full loan list with **+ Add loan** (a sheet:
  `receivables/_components/finance-case-sheet.tsx`), **Mark disbursed**, **Cancel**, and
  **Receive from bank** (`receivables/_components/receive-sheet.tsx`): pick a bank credit (CREDIT
  lines, remaining > ₹1, last 30 days, searchable by narration — the financier's name is usually in
  it), tick the loans it pays, see *"Selected ₹2,41,300 of ₹2,41,300 — matches"* go green, confirm.

### Part D — the pending-receivables sheet (R8–R12)

#### D1 — schema and migration M3 (`<ts>_corporate_customer_and_delivery_flag`)

```prisma
enum CustomerType { WALK_IN  REGULAR  DEALER  CORPORATE }

model Delivery {
  …
  // R9 / D18: null = follow the customer's type; true / false = this delivery overrides it.
  isCorporate Boolean?
  …
  @@index([isCorporate])
}
```

```sql
ALTER TYPE "CustomerType" ADD VALUE 'CORPORATE';
ALTER TABLE "Delivery" ADD COLUMN "isCorporate" BOOLEAN;
CREATE INDEX "Delivery_isCorporate_idx" ON "Delivery"("isCorporate");
```

Additive. **Rule 7 note specific to enums:** an old Prisma client that *reads* a row holding a value
it does not know throws. No row can hold `CORPORATE` until the new code writes one, and the old
code's zod (`validations.ts:695`) rejects it — so: do not set any customer to Corporate on an
environment until the new code is live there. The migration itself must **not** backfill
`CORPORATE` (Postgres also forbids using a just-added enum value in the same transaction).

#### D2 — `CORPORATE` everywhere the type is listed

Exactly the files in §2.6: `src/types/index.ts:377`; `validations.ts:695`;
`customers/page.tsx:66-68` (chip **Corporate**) and `:75` (badge `warning`, so it differs from the
three existing colours); `customer-edit-sheet.tsx:33-35`; `api/customers/route.ts:16` comment.
`find-or-create-by-phone.ts:49` stays `WALK_IN` — the deliveries flow cannot know a customer is a
company; a person marks it on `/customers`. `api/customers/[id]/route.ts` needs no change (it
already logs a type change).

#### D3 — the delivery override

`deliveryUpdateSchema` (`validations.ts:767-795`) gains `isCorporate: z.boolean().nullable().optional()`;
the PUT (`api/deliveries/[id]/route.ts`, guard `deliveries.edit`) writes it and
`log.info("delivery corporate flag set", { deliveryId, isCorporate })`; the GET returns
`customer.type` so the screen can show the inherited value. On the delivery's summary card
(`deliveries/[id]/_components/summary-card.tsx`, the Payment block) a three-way control:
**Follow customer (Corporate)** · **Corporate** · **Not corporate**, disabled without
`canEdit("deliveries")`.

#### D4 — the In-transit tab (R10)

`GET /api/pos/in-transit` (`pos.view`) — query `storeId?`, `includePreSplit?` (default false; the
first split day is the cut-over, Q2):

```ts
{
  card: Array<{ settlementId, date, store: { id, name } | null, preSplit: boolean,
                cardSales, expectedFee, expectedCredit, received, outstanding, ageDays }>,
                // a settlement with totalCard > 0 and outstanding > tolerance
  finance: Array<{ id, store, financier, loanNo, customerName, invoiceNo, saleDate,
                   expectedPayout, status, disbursedAt, ageDays }>,
                // status APPROVED or DISBURSED
  totals: { card, finance, all },
}
```

Both lists are bounded: card rows from the cut-over date (or 90 days with `includePreSplit`), loans
all open ones (small by nature). One query each plus one `groupBy` of CARD matches — no per-row
query.

`/receivables` gains a tab bar **Invoices · In transit**; the In-transit tab is
`receivables/_components/in-transit-tab.tsx` and appears only with `canView("pos")`. Age colours
follow the accounting doc's timing-versus-error rule: card ≤ 2 days grey (normal T+1 timing),
3–6 amber, ≥ 7 red; loans by days since sale, ≤ 7 grey, 8–30 amber, > 30 red.

#### D5 — the corporate filter (R9)

`GET /api/customer-invoices` (`customers.view`) gains `?corporate=1`. The effective corporate rule
lives in one helper, `src/lib/receivables/corporate.ts`:

```
corporate invoice =   (customer.type = CORPORATE AND invoiceNo NOT IN deliveries with isCorporate = false)
                    OR invoiceNo IN deliveries with isCorporate = true
```

The two override lists are small (only explicitly overridden deliveries) and read in one query.
With Q10 = (a), the response also carries `corporateDeliveriesWithoutReceivable`: deliveries that
are effectively corporate, have `zohoBalance > 0`, and have no `CustomerInvoice` row — shown under
the list as *"From the delivery's Zoho balance at import — Fetch Receivables to track payments"*.
The FilterSheet (`receivables/page.tsx:440`) gets a **Customer** group: All · Corporate.

#### D6 — customer credit notes reduce what is owed (R11) — after plan B

Plan B owns the table and the pull. This plan needs from it, per credit note: `customerId`
(resolved at pull), Zoho id, number, date, `total`, **`balance`** (the unused part, as Zoho reports
it), status (open / closed / void), and — if B stores them — its **applications**
(invoice number, amount, date).

The read (Q11 default), in `src/lib/receivables/customer-balance.ts`, used by **both** places that
compute a customer's balance today (`api/customers/route.ts:73-83` and `api/customers/[id]/route.ts:56-60`)
so they keep agreeing:

```
owed = Σ (amount − paidAmount) over the customer's invoices with status ≠ PAID     (today's rule)
     − Σ balance over the customer's open credit notes                              (unused credit)
     − Σ applications made AFTER the invoice they were applied to was imported here (used credit
       our snapshot cannot see — only if B stores applications)
```

Why not the full credit-note total: an imported invoice carries Zoho's balance at import (after D7),
which already reflects credits applied before the import; subtracting the full total would take
those rupees off twice. Each rupee is subtracted once — the D9 rule, on the customer side. The
customer page (`/customers/[id]/receivables`) shows a line *"Credit notes not yet used: ₹X"* and
the net figure; the list shows the net. If plan B ships without applications, the third term is
dropped and the screen says *"invoice balances are as imported"*.

#### D7 — the import stops overstating (DF14, Q13)

`customerInvoiceSchema` gains `paidAmount: z.number().min(0).optional()` (refined ≤ amount); the
POST derives the status (PAID / PARTIALLY_PAID / PENDING). The import
(`receivables/page.tsx:198-243`) sends `paidAmount = total − balance`, uses `apiFetch`, and lists
the invoices it skipped and why instead of `continue`. **Existing rows:** a read-only count first
(§4); repair from the `"Imported from Zoho. Balance: ₹X"` note only on the owner's sign-off, as a
reviewed SQL file — not inside a migration. The hard-coded +30-day due date is left alone (§5).

#### D8 — how the accountant reaches it daily (R12)

`/receivables` stays without a sidebar entry — the `customers` module comment explains why
(`rbac-catalog.ts:538-560`). The daily path is **Accounts** (sidebar) → the `/accounts` hub:

- the existing **Receivable** tile (`accounts/page.tsx:185-197`) adds a second line,
  *"₹X in transit"*, from `api/accounts/summary` (the hub already rolls up receivables under
  `accounts.view`; the in-transit total is the same kind of roll-up and returns only the number);
- the quick-link list (`:121-127`) gains **Receivables → /receivables**.

Anyone may also pin `/receivables` as a bottom-bar tab (per-user nav tabs). **Export:** an
`ExportButtons` row on each tab — Invoices (the filtered list: customer, invoice, date, due, amount,
paid, balance, days overdue, corporate) and In transit (both sections, one sheet each in Excel,
two tables in the PDF) through `exportToExcel` / `exportToPDF`, filename
`pending-receivables-<YYYY-MM-DD>`.

### Phases and dependencies

| Phase | Work | Depends on |
|---|---|---|
| E0 | confirm payment fields; list payment-mode names | — |
| A1 | M1 | Q2 |
| A2 | pull per store; DF1–DF5 | A1, Q1, E0 |
| A3 | routes; status; DF6–DF8, DF11–DF12 | A1 |
| A4 | screens; DF10, DF13, DF15 | A3 |
| A5 | catalog `pos.delete` | — |
| B1 | card-fee setting + settings page | — |
| B2–B4 | fee calc, allocation helper, match route, card line | A3, B1 |
| C1–C2 | M2, finance-case API | B3 (allocation) |
| C3 | finance card on settlement, sheets | C2 |
| D1–D3 | M3, CORPORATE, delivery flag | — |
| D4 | In-transit tab | B2, C2 |
| D5 | corporate filter | D1 |
| D6 | credit-note read | **plan B's table** |
| D7 | import fix | Q13 |
| D8 | hub tile, link, export | D4 |

**Sibling plans.** Plan **D** (bank accounts): once `BankAccount → Store` exists, the bank pickers
in B3 and C3 filter to the store's accounts; until then they list all credits, as today. Plan D's
new bank module does **not** guard these matches (Q12). Plan **B**: D6 waits for its customer
credit-note model; nothing else here does. No other sibling touches these files.

### Logging

| Scope | Level · line |
|---|---|
| `pos:sessions` | `debug` → window, pages fetched, ms; `info` "pos totals fetched" `{ dateFrom, dateTo, created, refreshed, skippedLocked, skippedCombined, voidSkipped, unassignedInvoices }`; `warn` "payment mode not recognised — counted as other" `{ mode }`; `warn` "payment matched no store" `{ paymentId }`; `warn` "re-fetch refused — days counted or matched" `{ dates }`; `error` "pos fetch failed" `{ dateFrom, dateTo, message }` |
| `pos:settlement` | `info` created `{ settlementId, storeId, date }`, deleted, cash verified `{ settlementId, variance }`; `warn` create refused (combined day exists); `error` on every failed write |
| `pos:match` | `info` matched `{ settlementId, bankTxnId, mode, amount }`; `info` card fee `{ settlementId, expectedFee, actualFee, verdict }`; `warn` "credit over-allocated" 409 `{ bankTxnId, remaining }`; `info` unmatched |
| `pos:finance-cases` | `info` created `{ financeCaseId, storeId, financier, fromZohoPayment: bool }`; `info` status `{ financeCaseId, from, to }`; `info` received `{ bankTxnId, cases, total }`; `warn` sum mismatch 409; `warn` duplicate loan 409; `error` |
| `pos:in-transit` | `debug` row counts and ms; `error` |
| `settings:card-fees` | `info` updated `{ cardTypes, fallbackRatePct, gstOnFeePct, toleranceRupees, financiers }`; `warn` stored JSON invalid → defaults; `error` write failed |
| `deliveries` (existing) | `info` corporate flag set `{ deliveryId, isCorporate }` |
| `settlement:screen`, `receivables:screen` (client) | `error` on every failed `apiTry`, with the API's sentence |

Every `catch` logs before it returns. Only ids, dates, counts and amounts are logged — never a
customer's name or phone, never a Zoho payload.

### Board of agents — checked

- **accounting-consultant** (`docs/agents/accounting-consultant.md`) — *Payment received but not
  reconciled (float risk)*: the In-transit tab is precisely the list of such money ✓. *Always
  distinguish a timing difference from an error*: card ages ≤ 2 days are grey (timing), the fee
  verdict separates "fee" from "missing" ✓. *Receivables discipline — no invoice unpursued past
  30 days*: loan and card age colours ✓. *Zoho is the source of truth for financials*: settlement
  totals are recomputed from Zoho until a person acts; loan amounts typed here are operational
  tracking, never written to Zoho ✓. **Flagged:** the bank's GST invoice for MDR (an input-tax-credit
  document) and the financier's subvention are expenses in Zoho, not recorded here — §5.
- **database-architect** — `Decimal(12, 2)` for every new money column ✓, with the Float/Decimal
  boundary handled in paise in one helper (the existing Float columns are a known defect, not
  extended); nullable FKs each have a stated reason (pre-split rows; optional customer link) ✓;
  indexes on every new filter (`storeId, date`; `status, storeId`; `bankTxnId`; `isCorporate`) ✓;
  every multi-table write in one transaction with a row lock on the bank credit ✓; idempotency by
  unique keys (`date, storeId`; `zohoPaymentId`; `financier, loanNo`) ✓; soft delete (`CANCELLED`) ✓;
  migrations additive, the one `DROP INDEX` reviewed under rule 3 and replaced in the same file ✓.
  **Named deviation:** the per-card-type split is read from `PosSession.rawData` JSON. It is never
  filtered on in SQL — only read per settlement — which the doc's "avoid JSON for data that needs
  querying" permits.
- **backend-engineer** — zod on every body ✓; transitions in a `VALID_TRANSITIONS` map ✓; "what if
  this runs twice" — unique keys and the allocation check ✓; "two users at once" — `FOR UPDATE` on
  the credit ✓; human error sentences ✓. **Named deviations from the doc's text, not its
  principles:** its route example uses `requireAuth(["ADMIN","SUPERVISOR"])` — CLAUDE.md forbids
  that; every route here uses `requireFeature(module, action)`. It says business logic stays in
  route files; the allocation helper and the pure calculators are shared by two routes each, so they
  live in `src/lib/settlement/` (precedent `src/lib/purchase-orders/create.ts`).
- **frontend-engineer** — loading, error and empty states on both new tabs and sheets ✓; buttons
  disabled while busy ✓; 375 px: the card-fee rows stack, the receive sheet is a full-height sheet ✓;
  no role names — `canView("pos")`, `canEdit("deliveries")`, `canEdit("settings")` ✓; the 659-line
  settlement detail and 536-line receivables page get their new parts as `_components/` ✓;
  `apiFetch`/`apiTry` only ✓.
- **integration-architect** — idempotent sync keyed on `zakyaSessionId` per store-day and on
  `zohoPaymentId` ✓; no per-record Zoho call (rate limits) unless E0 forces it, in which case the
  plan stops ✓; Zoho wins on amounts — totals refresh until locked ✓. **Flagged:** the POS pull
  writes `PosSession` without the Pull-Preview-Approve step. That is pre-existing; the settlement
  screen is the review, and nothing is final until a person counts or matches. **Doc drift flagged,
  not edited:** the doc's table lists "Zakya POS Session → Settlement, key `zakyaSessionId`" — there
  is no Zakya session (§2.1).

---

## 4. Verification

`npx tsc --noEmit` and `npx eslint` on touched files after each part; **`npm run build` must pass**
(it needs a reachable database — CLAUDE.md "Environment gotchas"). Work on a local restore of
production (`npm run db:restore:local -- backups/<file>`), `migrate dev` on **localhost only**.

**Zoho — reads only.** This plan writes nothing to Zoho. The test database has held production's
live Zoho credentials since 12 Oct 2026: a fetch there reads the **real** Bharath Cycle Hub books
(harmless to them, but it spends the daily API quota), and **Settings › Integrations › Disconnect on
test revokes production's token — do not press it.** E0's key-logging line must be removed before
the commit.

**Read-only SQL before M1** (on the restore, then on production's snapshot):

```sql
-- 1. payment-mode names ever seen, for Q3's mapping
SELECT key AS mode, round(sum(value::numeric), 2) AS total
FROM "PosSession", jsonb_each_text("rawData"->'paymentModes') GROUP BY key ORDER BY total DESC;
-- 2. what M1 will see
SELECT count(*) AS settlements, count(*) FILTER (WHERE "cashVerifiedAt" IS NOT NULL) AS counted,
       (SELECT count(*) FROM "SettlementMatch") AS matches FROM "DailySettlement";
-- 3. DF14: receivables imported with a balance note but no payment recorded
SELECT count(*) FROM "CustomerInvoice" WHERE "paidAmount" = 0 AND notes LIKE 'Imported from Zoho. Balance:%';
```

**Part A**
1. M1's SQL read: nine column adds, two FKs, one `DROP INDEX` + two unique indexes + two plain
   indexes, the hand-written partial index last. `npx prisma migrate status` clean.
2. `/stores`: both FLOOR warehouses carry their invoice prefix.
3. `/accounts/settlement` → Fetch POS, 1 day → two cards, BCH and BCC; their totals sum to what one
   combined row showed before. An invoice with a prefix matching no floor → "matched no store prefix"
   line with the amount.
4. Fetch the same day again before counting → `refreshed: 2`, not duplicates. Count cash on BCH →
   fetch again → BCH `skippedLocked`, BCC refreshed.
5. Re-fetch over a range containing a counted day → 409 naming the date; nothing deleted. Re-fetch an
   untouched combined (pre-split) day → it becomes two store rows; a counted combined day stays,
   badged "Both stores · before split".
6. Cash count with ₹1,800 cash out → the formula line shows it and the variance excludes it (DF6).
   Count on a FULLY_MATCHED day → status stays FULLY_MATCHED (DF7).
7. As a role holding `pos.view` but not `bills.view` → both screens open (DF10). After
   `npm run db:seed:rbac`, `/team/permissions` shows **Delete** under POS & Settlement.

**Part B**
8. `/settings/card-fees`: add Debit 0.40 % (mode "Debit Card"), Credit 1.75 % ("Credit Card"),
   fallback 1.2 %, GST 18, tolerance 10. As a user without `settings.edit`, Save → 403.
9. On a store-day with ₹60,000 debit and ₹40,000 credit card sales, match a ₹98,700 credit →
   "Short by ₹190.80" in red. Match a second ₹200 credit → "Fee as expected", status FULLY_MATCHED.
10. Match one ₹1,50,000 credit to two days, ₹80,000 + ₹70,000 → the line leaves every picker only
    after the second; trying ₹80,001 on the second → 409 "Only ₹70,000 … still unused". Remove a match
    → the line returns with its remaining amount.
11. Change a rate → a settled day's verdict does not change until **Recalculate**.

**Part C**
12. On a split day with two Bajaj payments in Zoho → **Add as loan** twice → two cases; a third press
    on the first → 409 "already loan …". Add one loan by hand with the same loan number → 409.
13. Mark both Disbursed. Receive: pick a credit equal to their two payouts → Received; pick one whose
    amount differs → 409 with both figures. Unreceive → Disbursed, credit back in the pickers.
14. Cancel a loan without a reason → 400; with one → Cancelled, gone from In transit.

**Part D**
15. M3's SQL: one `ADD VALUE`, one `ADD COLUMN`, one index.
16. `/customers`: set a customer Corporate → chip filter finds them. A delivery of theirs set
    **Not corporate** → its invoice leaves the `/receivables` Corporate filter; another customer's
    delivery set **Corporate** → its invoice appears.
17. `/receivables` → **In transit**: the unmatched card days and open loans from steps 9–14, with
    ages and totals. **Export** Excel → two sheets; PDF → two tables.
18. As a role with `customers.view` but no `pos.view` → no In transit tab; `GET /api/pos/in-transit`
    → 403.
19. `/accounts` → the Receivable tile shows "₹X in transit"; **Receivables** is in the link list.
20. Fetch Receivables, import a partly paid Zoho invoice → it shows its real balance (DF14).
21. After plan B: a customer with an unused ₹2,000 credit note shows "Credit notes not yet used:
    ₹2,000" and a net balance ₹2,000 lower — on the list and on the customer page, the same figure.

Logs: run once with `LOG_LEVEL=0` and read the `pos:*` lines for steps 3, 9, 13 — ids and amounts
only.

---

## 5. Out of scope, deliberately

- **Reading the ICICI settlement emails** (owner, 12 Oct: not read) and the **Bajaj portal** —
  the app cannot log in to it; the accountant reads it and records the status here.
- **A Bajaj settlement-file import.** Designed for (`@@unique([financier, loanNo])`), not built (D15).
- **Per-shift counts** — D13 says per store per day.
- **UPI money in transit.** Not asked; the In-transit tab could add it the same way as card.
- **Converting the existing `Float` settlement columns to `Decimal`** — `docs/schema-review.md`
  item 5; this plan only stops adding new ones.
- **Bank accounts, the bank permission module, suspense lines, the weekly tile** — plan D.
- **Pulling customer credit notes** — plan B; only the read is here.
- **Store-scoped "bills" in store analytics** (`src/lib/analytics/store.ts:360-366`). Possible once
  `PosSession.storeId` is filled; a separate change to a screen this plan does not own.
- **Posting the MDR fee, its GST, or a financier's subvention as expenses in Zoho**, and claiming
  input tax credit on the bank's MDR invoice — Zoho Books and the CA (D22).
- **A corporate filter on `/deliveries`**, refreshing `CustomerInvoice` rows from Zoho after import,
  and the hard-coded +30-day receivable due date.
- **The `"ADMIN"` short-circuit in `userCan` and the client store** (§2.11) — recorded, not touched.
