# The Ledger & Reconciliation Flow — how money actually moves through BCH OPS

**Date:** 31 Aug 2026
**Question this answers:** what is "the ledger" in this application, how many modules need
it, how is it implemented end to end, and is the statement-upload screen missing?
**Branch audited:** `refactor/zoho-endpoint-registry`

---

## 0. The short answer

You are **half right**, and the half you are right about is the important half.

| | |
|---|---|
| **Bank statement upload** | **It exists and it works.** `/accounts` → tile *"Bank Statement"* → `/accounts/bank-upload`. Reachable, permission-gated, end to end. |
| **Brand / supplier statement upload** | **It does not exist.** No screen, no API route, no button. The database table, the file fields, the AI-extraction fields and even the RBAC permission were all built for it — but **nothing in the codebase ever creates a `BrandStatement` row.** |

The proof is in the app's own empty state. `src/app/(dashboard)/ledger/page.tsx:101` tells
the user:

> *"Import a supplier statement from a vendor's page to start reconciling."*

**There is no such import on the vendor page.** The screen instructs the user to do
something the application cannot do. That is why you feel the upload option is missing —
because for the brand ledger, it genuinely is.

---

## 1. There is not one "ledger" — there are four

This is the root of the confusion. The word *ledger* appears in four different places in
this app, meaning four different things:

| # | Name | Screen | What it compares | Import? |
|---|---|---|---|---|
| 1 | **Vendor Ledger** (simple) | `/vendors/[id]` → *Ledger* tab, and `/accounts/vendor-ledger` | Nothing. It is a **read-only running balance of our own books** — our bills minus our payments. | N/A — nothing to import |
| 2 | **Brand Ledger** (the real reconciliation) | `/ledger`, `/ledger/[id]` | **Their statement vs our books.** Plus a claim register for money they owe us. | **MISSING** |
| 3 | **Bank Reconciliation** | `/accounts/bank-upload` → `/accounts/reconcile/[id]` | **The bank's statement vs our books.** | ✅ Works |
| 4 | **Daily Settlement** | `/accounts/settlement` | **POS takings vs the bank.** | Uses #3's data |

Numbers 2, 3 and 4 are genuine reconciliation engines. Number 1 is just a report.

**#2 and #3 solve the same shape of problem — "an outside party sent us a list of money
movements; do they agree with ours?" — and they are implemented completely differently.**
That is the central finding of this document.

---

## 2. How many modules need the ledger?

From `prisma/rbac-catalog.ts`, permissions in the **Accounts** group:

| Module key | Label | Route | Actions |
|---|---|---|---|
| `brand_ledger` | Brand Ledgers | `/ledger` | view, create, edit, delete, **fetch** |
| `brand_ledger_gaps` | Ledger Claims | *(inside a vendor's ledger)* | view, create, edit, delete, approve |
| `bills` | Vendor Bills | — | gates bank upload + reconcile |
| `vendors` | Vendors | — | gates the simple ledger tab |
| `accounts` | Accounts | `/accounts` | the hub screen |

Note the **`fetch`** action on `brand_ledger`. That permission exists in the catalog, an
admin can grant it, and **no route in the codebase ever checks it.** It was created for the
statement import that was never built.

Modules that *read* ledger data, directly or indirectly: **Vendors, Bills, Payments,
Expenses, Purchase Orders, Accounts, Reports/Analytics, Daily Settlement.** So the ledger
is not a corner feature — eight areas depend on the numbers it produces.

---

## 3. Story 1 — the bank statement (this works today)

### Act 1: a person uploads a file

Ramesh in accounts opens `/accounts`. He sees a grid of tiles
(`accounts/page.tsx:121-127`) and taps **Bank Statement**, landing on
`/accounts/bank-upload`.

He picks **HDFC** or **ICICI** from a dropdown, chooses a file — `.csv`, `.txt`, `.xls` or
`.xlsx` — and presses upload. The screen shows a four-step progress bar:
*reading → parsing → matching → done*.

The browser POSTs the file as `FormData` to `/api/bank-statements`
(`bank-upload/page.tsx:87`).

### Act 2: the server reads the file

`src/app/api/bank-statements/route.ts`:

1. **`requireFeature("bills", "create")`** — if Ramesh lacks the grant, it stops here.
2. **Is it a spreadsheet?** If `.xls`/`.xlsx`, the `xlsx` library reads the workbook and
   `XLSX.utils.sheet_to_csv` flattens sheet 1 into CSV text. If `.csv`/`.txt`, it is read
   as text directly.
3. **Sanity check** — under 20 characters means an empty or unreadable file, and it returns
   an error naming the file and its size.
4. **A debug log** records file name, byte count, bank, and the first 200 characters.

### Act 3: an AI reads the rows

The route builds a prompt with **bank-specific column hints** — it knows HDFC statements
run *Date, Narration, Chq./Ref.No., Value Dt, Withdrawal Amt., Deposit Amt., Closing
Balance*, and that ICICI puts a summary block on top — and appends the statement text.

> ⚠️ **`route.ts:112` — `${text.slice(0, 50000)}`.** Anything past 50,000 characters is
> **cut off before the model ever sees it.** Those transactions are never parsed and never
> reported as missing. See `docs/ai-usage-audit.md` finding F1.

It calls Claude (`claude-haiku-4-5-20251001`, `max_tokens: 16384`) with up to two retries
on an overloaded response, and asks for a JSON array of
`{date, description, reference, amount, type, balance}`.

The reply is scraped with a regex. If the model ran out of tokens mid-array, the code finds
the last `}`, appends `]`, and parses **a partial list as if it were complete** (F2).

### Act 4: rows become database records

A `BankStatement` row is created with `bank`, `fileName`, `fromDate`, `toDate`,
`totalCredits`, `totalDebits`, `txnCount`, `uploadedById` — and all the `BankTransaction`
children in one nested `create`.

Every transaction starts at `matchStatus: UNMATCHED`.

### Act 5: an AI guesses the matches

Now the **second** Claude call. The route loads **every active vendor** and **every
PENDING / PARTIALLY_PAID bill**, and sends all of them plus all the new transactions in one
prompt, asking for `vendorId`, `billId`, `category`, `confidence` and `flagReason` per row.

Those answers are written straight onto each `BankTransaction`:
`suggestedVendorId`, `suggestedBillId`, `suggestedCategory`, `confidence`, and
`matchStatus` becomes `MATCHED` or `FLAGGED`.

> If the model invents a `billId` that does not exist, the update throws and is silently
> swallowed by `.catch(() => {})` at `:333`. Nothing is logged.

`matchedCount` and `flaggedCount` are saved back on the statement, and the browser shows:
*"Processed 214 transactions. 156 matched, 12 flagged."*

### Act 6: a human decides — nothing has touched the books yet

**This is the important part, and it is designed correctly.** Up to now, *no money has been
recorded anywhere.* Everything so far lives in `BankStatement` / `BankTransaction`, which
are a staging area, not the ledger.

Ramesh opens `/accounts/reconcile/[id]`. He sees every transaction with its AI suggestion,
its confidence, and its flag reason. Per row (or in bulk) he chooses:

| Action | What the server does (`bank-statements/[id]/review/route.ts`) |
|---|---|
| **`confirm_payment`** | Creates a **`VendorPayment`** (mode inferred from the reference prefix: `UPI…` → UPI, `NEFT…`/`RTGS…` → NEFT, else CHEQUE). If a `billId` is given, it adds to `VendorBill.paidAmount` and flips status to `PARTIALLY_PAID` or `PAID`. Marks the txn `MATCHED` and stamps `processedAt`. |
| **`confirm_expense`** | Creates an **`Expense`**, mapping the AI category (`EXPENSE_RENT` → `SHOP_MAINTENANCE`, etc.). Marks the txn `EXPENSE`. |
| **`ignore`** | Marks `IGNORED`. Nothing is created. |
| **`flag`** | Leaves it for someone else. |

`processedAt` is the guard: a row already processed is excluded from bulk actions, so the
same bank debit cannot create two payments.

**Only now does money exist in the books.** The chain is:

```
file  ->  BankStatement  ->  BankTransaction (staging, AI-suggested)
                                    |
                          [ a human presses confirm ]
                                    |
                    VendorPayment  or  Expense   <- the real ledger
                            |
                    VendorBill.paidAmount / status
```

> **One defect worth naming.** In the **bulk** `confirm_payment` branch (`:93`), the
> payment is created with **`billId: null`** — the bill link is dropped, so the bill's
> `paidAmount` is never updated. The single-row path does it correctly. Bulk-confirming
> vendor payments therefore records the money but leaves the bills looking unpaid.

---

## 4. Story 2 — the brand ledger (this is where the hole is)

### What it is for

A brand like Hero sends a monthly statement: *"as of 31 July you owe us ₹14,82,000"*. Their
number and your number never agree. The difference is made of promised discounts that never
arrived, credit notes never issued, payments they did not post, and short credits.

`/ledger` exists to find that difference and turn each piece of it into a **tracked claim**
you can chase — the `LedgerGap` table, described in the schema as *"the claim register —
the heart of the tool."*

### The data model is complete and thoughtfully designed

```
BrandStatement                    <- one import: their file, period, claimed closing balance
   |  (1:many)
BrandLedgerEntry                  <- one row off their statement
   |         \
   |          `-> matched to  VendorBill / VendorPayment / VendorCredit   (our books)
   |
   `-> evidences ->  LedgerGap    <- one unresolved money claim
                        |
                        +-- LedgerGapEvidence   (screenshots, PDFs, emails in R2)
                        +-- LedgerGapNote       (the chase history)
```

`LedgerMatchStatus` is unusually well thought out. It has **`THEY_MISSING`** (we paid, it is
absent from their statement) and **`WE_MISSING`** (it is on their statement, absent from our
books) as separate states — and the schema comment explains exactly why:

> *"NEEDS_REVIEW deliberately does NOT mean 'discrepancy': an unmatched row is ambiguous
> between 'they never posted our payment' and 'we never recorded it'. Only a human can tell
> which, so the system surfaces and never concludes."*

`BrandStatement` carries `claimedClosing` **and** `computedClosing` and a `tiesOut` boolean —
so the system can tell you *their own statement does not add up*, which is a finding in
itself.

### The reconciliation engine is real, deterministic, and already written

`src/lib/brand-ledger/reconcile.ts` — **356 lines, pure functions, no Prisma, no I/O**:

| Function | What it does |
|---|---|
| `parseLedgerDate`, `parseAmount` | Tolerant parsing of their formats |
| `classifyEntry` | Label → `INVOICE` / `PAYMENT` / `CREDIT_NOTE` / `DISCOUNT` / … |
| `sideForType`, `directionForType` | Whose entry it is, and whether it raises or lowers what we owe |
| `runningBalance` | Their balance, row by row, from our opening balance |
| `checkBalance` | Does their claimed closing match the sum of their own rows? |
| **`matchEntries`** | **Matches their rows against our bills, payments and credits — in code** |
| **`unclaimedBooks`** | **What we hold that never appeared on their statement.** The schema calls this *"the most valuable output"* |
| `assessCoverage` | Is this comparison meaningful, or are we missing too much data? |
| `expectedDiscount` | What the agreed terms say we should have received |

The file header explains its origin: *"Ported from the standalone ledgers workspace
(`scripts/extract-entries.mjs`), where this ran once at build time against files in a repo.
Here it runs against the database."*

**Read that again in the context of `docs/ai-usage-audit.md`.** The deterministic
matching engine I recommended building for bank reconciliation **already exists in this
codebase.** It was written, ported, and wired up — for the brand ledger. The bank
reconciliation pays an AI to do the same job worse.

### What actually happens today

`GET /api/ledger/vendors/[id]` assembles both sides live on every request — their entries
from `BrandLedgerEntry`, our side from `VendorBill` + `VendorPayment` + `VendorCredit` —
runs `matchEntries` and `unclaimedBooks`, and returns the comparison. **Nothing is written;
a match is persisted only when a human confirms it** via
`POST /api/ledger/entries/[id]/review`. That design is correct.

The `/ledger/[id]` screen shows their statement, our books, the running balance, the
match state per row, and the claim register, with a **New Gap** button at
`/ledger/[id]/gaps/new`.

### And here is the hole

**Every `BrandLedgerEntry` has to be typed in by hand, one row at a time.**

The only way to create one is `POST /api/ledger/vendors/[id]/entries` — a **single-row**
endpoint whose own comment describes its purpose as *"transcribing a row off a statement
that wasn't imported"* and as a *"MANUAL escape hatch"*. Its `source` defaults to `MANUAL`.

Meanwhile:

| Designed for import | Status |
|---|---|
| `BrandStatement` table with `fileUrl`, `fileName`, `sourceKind` | **`prisma.brandStatement.create` is called nowhere in `src/`, `prisma/` or `scripts/`.** Only `findFirst` (read), at `ledger/vendors/[id]/route.ts:80` |
| `extractionModel`, `extractionNote` — *"recorded so an AI extraction can be re-checked against what was actually returned"* | Never written |
| `LedgerEntrySource` values `STATEMENT_PDF`, `STATEMENT_XLSX`, `STATEMENT_CSV` | Unreachable — nothing can set them |
| `LedgerEntrySource.BCH_BOOKS` — *"mirrored from VendorBill / VendorPayment / VendorCredit"* | Never written; our side is assembled live instead |
| `brand_ledger` **`fetch`** permission | Granted by admins, checked by no route |
| `/ledger` empty state: *"Import a supplier statement from a vendor's page"* | **That import does not exist on the vendor page or anywhere else** |

So the module is a **fully-built reconciliation engine with no way to get data into it.**
An engine with no fuel line.

---

## 5. Story 3 — the simple vendor ledger (a different thing entirely)

`/vendors/[id]` → *Ledger* tab, and the standalone `/accounts/vendor-ledger` picker, both
call `GET /api/vendors/[id]/ledger` (`requireFeature("vendors", "view")`).

It returns the last 50 bills and last 50 payments and computes a running balance from the
vendor's `openingBalance`. **No comparison, no matching, no import — it is a statement of
our own books.** Useful, but it is not reconciliation, and it is not related to `/ledger`
despite the shared word.

This naming collision is almost certainly part of why the module feels confusing.

---

## 6. Story 4 — daily settlement (the third reconciliation)

`/accounts/settlement`. `DailySettlement` holds one row per day: POS totals split by cash /
card / UPI / finance / credit, a physical `cashCounted` with its `cashVariance`, and a cash
drawer (`cashIn` / `cashOut` / `cashOutReason`).

`SettlementMatch` then links an expected POS amount to an actual **`BankTransaction`** —
"the ₹48,200 of card sales on the 14th should appear as a bank credit". So settlement
**consumes the output of Story 1**. If a bank statement is not uploaded, settlement has
nothing to match against.

---

## 7. Complete picture

```
                    ┌──────────────── OUR BOOKS (the real ledger) ─────────────────┐
                    │  VendorBill · VendorPayment · VendorCredit · Expense         │
                    └──────▲────────────▲──────────────────▲───────────────────────┘
                           │            │                  │
        confirm creates ───┘            │                  └─── compared against
                           │            │                            │
   ┌───────────────────────┴──┐   ┌─────┴───────────┐   ┌────────────┴─────────────┐
   │ 3. BANK RECONCILIATION   │   │ 4. SETTLEMENT   │   │ 2. BRAND LEDGER          │
   │                          │   │                 │   │                          │
   │ /accounts/bank-upload    │   │ /accounts/      │   │ /ledger                  │
   │   ↓ file                 │   │   settlement    │   │   ↑                      │
   │ BankStatement            │   │ DailySettlement │   │ BrandLedgerEntry         │
   │   ↓ AI parse             │   │   ↓             │   │   ↑ typed by hand,       │
   │ BankTransaction          │◄──┤ SettlementMatch │   │     one row at a time    │
   │   ↓ AI suggest           │   │                 │   │                          │
   │   ↓ HUMAN CONFIRMS       │   └─────────────────┘   │ BrandStatement           │
   │ VendorPayment / Expense  │                         │   ✗ NO IMPORT EXISTS     │
   │                          │                         │ LedgerGap (claims)       │
   │ ✅ WORKS                 │                         │ ⚠️ ENGINE, NO FUEL       │
   └──────────────────────────┘                         └──────────────────────────┘

   1. VENDOR LEDGER TAB — /vendors/[id] → read-only view of OUR BOOKS. No reconciliation.
```

---

## 8. Findings

**H** = blocks real work or loses data · **M** = correctness · **L** = hygiene

### H — L1: The brand statement import does not exist

No screen, no route, no writer for `BrandStatement`. The entire `/ledger` module can only
be populated by hand, one row per API call. For a brand statement with 300 rows this is
not realistic, which means **the module is effectively unused in practice**.

### H — L2: The empty state instructs the user to do something impossible

`ledger/page.tsx:101` — *"Import a supplier statement from a vendor's page to start
reconciling."* There is no such control on `/vendors/[id]`. Every new user will look for
it, fail to find it, and conclude the app is broken. **This is exactly what happened to
you.**

### H — L3: Bulk `confirm_payment` drops the bill link

`bank-statements/[id]/review/route.ts:93` creates the `VendorPayment` with `billId: null`,
so `VendorBill.paidAmount` and `status` are never updated. The single-row path at `:118`
handles it correctly. Bulk-confirming leaves paid bills showing as outstanding.

### H — L4: Bank reconciliation ignores the deterministic engine that already exists

`src/lib/brand-ledger/reconcile.ts` has `matchEntries` and `unclaimedBooks` — tested, pure,
free. `bank-statements/route.ts` instead pays an AI to match by exact amount and reference
number. **Two reconciliation implementations, and the worse one is used on the higher-volume
data.**

### M — L5: Four things are called "ledger"

`/ledger`, `/vendors/[id]` → Ledger tab, `/accounts/vendor-ledger`, and
`GET /api/vendors/[id]/ledger`. Two are the same simple report; one is the real
reconciliation module; the naming gives no clue which is which.

### M — L6: `LedgerEntrySource.BCH_BOOKS` is declared but never used

Our side is assembled live from `VendorBill`/`VendorPayment`/`VendorCredit` on every
request. That is a defensible choice — it is always current — but the enum value implies a
mirroring design that does not exist. Either use it or delete it.

### M — L7: The `brand_ledger` `fetch` permission guards nothing

An admin can grant a permission that no route checks.

### L — L8: `/ledger` uses raw `fetch` + `res.json()`

`ledger/page.tsx:50`, `ledger/[id]/page.tsx:94,107`, `vendors/[id]/page.tsx:98` — must be
`apiFetch` / `apiTry` per `CLAUDE.md`.

### L — L9: No statement file is stored for bank uploads

`BankStatement` records `fileName` but not a `fileUrl`. `BrandStatement` has `fileUrl` (for
R2) and is the better design. Today, if a bank parse is later disputed, the original file is
gone.

---

## 9. What I suggest

### 9.1 Build the brand statement import — the missing piece

This is the highest-value work in the accounting area, because it activates an entire
module that is already written.

**Step 1 — the screen.** `/ledger/[vendorId]/import`, linked from the vendor's ledger page
*and* from the `/ledger` empty state (so L2 stops lying). Vendor + statement date + period +
file picker. Gate with `requireFeature("brand_ledger", "create")` — or finally give the
orphaned **`fetch`** action a job.

**Step 2 — the route.** `POST /api/ledger/vendors/[id]/import`, following the pattern
`brand-stock/upload` already proves:

```
.xlsx / .xls / .csv  ->  deterministic parse  (reuse reconcile.ts helpers)
.pdf  / image        ->  AI extraction        (record extractionModel — the field exists)
```

**Step 3 — upload the original to R2 first**, populate `fileUrl` and `fileName`. A
reconciliation you cannot re-check against the source document is not evidence.

**Step 4 — refuse to import a statement that does not tie out.** `checkBalance` is already
written. If `computedClosing !== claimedClosing`, set `tiesOut: false` and **show the
difference before importing**. The schema comment already says this should block the import.
That single check is worth more than the whole AI parse — it catches *their* errors.

**Step 5 — run `matchEntries` on import** and store the results as suggestions the reviewer
confirms, exactly as `/ledger/[id]` already works today.

### 9.2 Point bank reconciliation at the engine you already own

Replace the second Claude call in `bank-statements/route.ts` with:

1. **`matchEntries`** from `reconcile.ts` — exact amount, reference, date window. Free,
   deterministic, auditable, already written.
2. **AI only on the leftovers** — vendor-name resolution and expense category, on the rows
   code could not place, and **never** a `billId` it could invent.
3. **Human confirm** — unchanged.

This is the same recommendation as `docs/ai-usage-audit.md` §7.2, but stronger now that we
know the engine exists: it is largely a wiring job, not a build.

### 9.3 Fix the three defects that lose or corrupt data

| | Where | Fix |
|---|---|---|
| L3 | `review/route.ts:93` | Pass `billId` in the bulk branch and update the bill, as the single path does |
| L2 | `ledger/page.tsx:101` | Make the sentence true — or, until 9.1 ships, change it to say import is not available yet |
| F1 (AI audit) | `bank-statements/route.ts:112` | Stop silently truncating at 50,000 characters |

### 9.4 Fix the naming

Rename so the four things are distinguishable:

| Today | Suggested |
|---|---|
| `/ledger` | **`/reconciliation`** or **`/brand-statements`** |
| `/vendors/[id]` → *Ledger* tab | **Account Statement** |
| `/accounts/vendor-ledger` | **Vendor Account Statement** — or merge it into the vendor page, since it duplicates the tab |

### 9.5 Later

- Store the bank statement file in R2 too (L9), matching `BrandStatement`.
- Auto-open a `LedgerGap` when `unclaimedBooks` finds a payment they never posted — that is
  the exact case the claim register was built for, and it is currently manual.
- Decide `BCH_BOOKS` (L6): use it or delete it.

### 9.6 Suggested order

| Phase | Work | Why |
|---|---|---|
| 1 | **L3** — bulk `billId` bug | Bills wrongly showing unpaid, today, in production |
| 2 | **L2** — honest empty state | One line; stops misleading every user |
| 3 | **9.1** — brand statement import | Unlocks a whole finished module |
| 4 | **9.2** — bank reconciliation on `reconcile.ts` | Accuracy and cost; mostly wiring |
| 5 | **L5 / 9.4** — renames | Cheap once the flows are settled |
| 6 | L6, L7, L8, L9 | Hygiene |

---

## 10. Questions I need answered

**Q1-Q5 are blocking** — they change what gets built. **Q6-Q12** can be answered as we go.
Section 10.3 is a log to record the decisions.

### 10.1 Blocking

**Q1. Is the brand ledger being used at all right now, or is it dormant?**
How many `BrandLedgerEntry` rows exist, and were they typed in by hand or seeded?
*Why it blocks:* if the module is dormant because import is missing, 9.1 is the top
priority. If someone has been hand-typing statements, it is urgent *and* there is existing
data whose shape I must not break.
*Blocks:* the whole of 9.1.

**Q2. What do brand statements actually arrive as?**
PDF, Excel, a photo of a printed sheet, or a WhatsApp forward? Which brands, and roughly how
many rows per statement?
*Why it blocks:* it decides whether the import is a deterministic parser with an AI
fallback (like `brand-stock/upload`) or AI-first. Excel means mostly code; photos mean
mostly AI.
*Blocks:* 9.1 step 2.

**Q3. Can you give me one real brand statement and one real bank statement?**
Redact the amounts if you like — I need the *shape*: header position, column names, date
format, how credit notes and discounts are labelled.
*Why it blocks:* `classifyEntry` maps their labels to our types. Guessing those labels means
a parser that fails on the first real file.
*Blocks:* 9.1 and 9.2.

**Q4. When a statement does not tie out, block the import or import with a warning?**
`checkBalance` can tell you their own rows do not sum to their claimed closing.
Options: (a) **block** — the schema comment says it should; (b) import and flag `tiesOut:
false` prominently; (c) block only if the gap exceeds a threshold you set.
*My recommendation:* (a). A statement that does not add up is their bug, and importing it
puts a wrong number in your reconciliation.
*Blocks:* 9.1 step 4.

**Q5. Has the bulk `confirm_payment` bug (L3) already produced wrong data?**
Have staff used bulk confirm on the reconcile screen? If yes, there are `VendorPayment` rows
with no `billId` and bills that look unpaid but are not.
*Why it blocks:* it decides whether L3 is a code fix or a code fix **plus a data repair
script**.
*Blocks:* phase 1.

### 10.2 Non-blocking — defaults I will apply unless you say otherwise

**Q6. Who should be able to import a brand statement?**
*Default:* `brand_ledger.create`. Say the word and I will use the orphaned `fetch` action
instead, so importing is separable from hand-editing rows.

**Q7. Can a statement be re-imported / superseded?**
The schema hints at it (*"a revised statement can supersede an older one"*).
*Default:* allow re-import as a new `BrandStatement`; keep the old rows; show the newest as
current. Never delete an imported row — the delete route already refuses to.

**Q8. Amount tolerance for `matchEntries` on bank data?**
*Default:* exact to the paisa, then a second pass at ±₹1.

**Q9. Date window for a match?**
*Default:* ±7 days. Brand statements may need wider — tell me if their posting lags.

**Q10. Should an unclaimed payment auto-open a `LedgerGap`?**
*Default:* no — suggest it with a one-tap "open a claim" button. Auto-creating claims would
fill the register with noise.

**Q11. Should the bank statement file be stored in R2 like `BrandStatement`?**
*Default:* yes, but as a separate small change after phase 4.

**Q12. Are you open to the renames in 9.4?**
They touch routes, so they are a bigger diff than they look.
*Default:* leave names alone until the flows work; revisit after phase 4.

### 10.3 Checkpoints — I will stop and ask

| When | What I will ask |
|---|---|
| Before any change to `bank-statements/[id]/review/route.ts` | Confirm the diff — it creates `VendorPayment` and `Expense` rows; a mistake writes wrong money |
| If the import needs a schema change | Stop and confirm. I expect **none** — `BrandStatement` already has every field — but `matchSource` (code vs AI) may be worth adding |
| If Q5 turns out to be yes | Present the repair script and the affected rows **before** running anything |
| Before writing `classifyEntry` rules for a new brand | Walk through their labels with you rather than guess |
| If `npm run build` fails | Revert and re-plan, per `AGENTS.md`. No stacked fixes. |
| Before any `git` or `npm` command | Always — every one is gated |

### 10.4 Answer log

| Q | Question | Answer | Decided on |
|---|---|---|---|
| Q1 | Is the brand ledger in use / row count | | |
| Q2 | Brand statement formats + row counts | | |
| Q3 | Sample statements provided | | |
| Q4 | Block or warn when it does not tie out | | |
| Q5 | Has bulk confirm produced wrong data | | |
| Q6 | Permission for import | | |
| Q7 | Re-import / supersede behaviour | | |
| Q8 | Amount tolerance | | |
| Q9 | Date window | | |
| Q10 | Auto-open a gap | | |
| Q11 | Store bank file in R2 | | |
| Q12 | Approve the renames | | |

---

## 11. Quick reference

```
WORKS — bank reconciliation
  /accounts  ->  tile "Bank Statement"  ->  /accounts/bank-upload
    POST /api/bank-statements                    [bills.create]
      xlsx -> sheet_to_csv -> Claude parse  -> BankStatement + BankTransaction
      Claude match (vendors + pending bills) -> suggested* fields
  /accounts/reconcile/[id]
    POST /api/bank-statements/[id]/review        [bills.create]
      confirm_payment -> VendorPayment (+ bill paidAmount)   <- billId dropped in BULK (L3)
      confirm_expense -> Expense
      ignore / flag   -> status only

MISSING — brand statement import
  (no screen)
  (no route)                                     brandStatement.create called NOWHERE
  BrandStatement.fileUrl / extractionModel       never written
  brand_ledger."fetch" permission                checked by no route
  /ledger empty state points at an import that does not exist   (L2)

WORKS — brand ledger, once data is in it by hand
  POST /api/ledger/vendors/[id]/entries          [brand_ledger.create]   one row at a time
  GET  /api/ledger/vendors/[id]                  [brand_ledger.view]
       -> runningBalance / checkBalance / matchEntries / unclaimedBooks   (reconcile.ts)
  POST /api/ledger/entries/[id]/review           persists a confirmed match
  /ledger/[id]/gaps/new                          [brand_ledger_gaps.create]

REPORT ONLY — vendor account statement
  /vendors/[id] -> Ledger tab, and /accounts/vendor-ledger
    GET /api/vendors/[id]/ledger                 [vendors.view]   our bills + payments

CONSUMES BANK DATA — daily settlement
  /accounts/settlement  ->  DailySettlement -> SettlementMatch -> BankTransaction
```
