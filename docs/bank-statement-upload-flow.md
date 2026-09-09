# The Bank Statement Upload — a story of one file

**Date:** 9 Sep 2026
**Question this answers:** I drop a file on `/accounts/bank-upload`. What is extracted, what
instructions is the AI given, what is written where, and what else in the app moves as a result?
**Verified against:** `6cbdf4b` (branch `docs/plan-requirements-rule`) — every claim carries a
`file:line`.

> **Written twice on 9 Sep 2026.** The first version described this route calling Anthropic
> directly with a hardcoded model. That code was replaced the same day by `c8f1b61`
> (*"which AI provider is live becomes data, and one client answers for all of it"*), which
> moved both calls onto `runAi` from `src/lib/ai`. **Everything below describes the new
> code.** Three of the findings in `ai-usage-audit.md` were fixed by that change; §7 lists
> which.

**Companion doc:** [`brand-ledger-flow.md`](./brand-ledger-flow.md) — the *other* reconciliation,
which compares a supplier's statement to our books.

**Where the defects are tracked** — this document describes behaviour; it is not the finding
register:

| Doc | Holds |
|---|---|
| [`ai-usage-audit.md`](./ai-usage-audit.md) | **F1–F11**, the AI findings. F2, F6 and F7 were closed by `c8f1b61`; **F1 is still open** |
| [`implementation/completed/0809-ai-provider-settings-and-shared-client-plan.md`](./implementation/completed/0809-ai-provider-settings-and-shared-client-plan.md) | the change that rewrote this route — shipped 9 Sep |
| [`implementation/pending/ai-provider-config-and-task-routing-plan.md`](./implementation/pending/ai-provider-config-and-task-routing-plan.md) | what remains: per-task routing and spend visibility |
| [`ledger-and-reconciliation-flow.md §8`](./ledger-and-reconciliation-flow.md) | **L1–L15**, the flow-level defects — the bulk `confirm_payment` bill link (L3) and the settlement status collision (L13) |

---

## 0. Before the story starts — one correction

**This screen does not accept PDFs.**

```tsx
accept=".csv,.xls,.xlsx,.txt"        // bank-upload/page.tsx:165
```

Only CSV, TXT, XLS and XLSX. If your bank sends a PDF, this flow cannot read it — export
CSV/XLS from net-banking first. The server never sniffs the type; a PDF renamed to `.csv`
would be read as text and reach the model as binary noise.

PDF *is* handled elsewhere — `src/lib/pdf-parser.ts` sends a real base64 `document` block —
but it is wired only to `POST /api/brand-stock/upload`, and it extracts **products**, not
transactions. Nothing connects it to banking.

Two banks are offered: **HDFC** and **ICICI** (`page.tsx:135`). Any other bank gets no hint.

---

## 1. The story, act by act

### Act 1 — a person drops a file

`/accounts` → *Bank Statement* tile → `/accounts/bank-upload`.

They pick a bank (a chip, defaulting to HDFC — `page.tsx:52`) and choose a file. The browser
posts `multipart/form-data` with `file` and `bank` to `POST /api/bank-statements`
(`page.tsx:80-87`). A four-step progress bar shows *Reading → AI parsing → Matching →
Complete* (`page.tsx:37-41`) — the first and third steps are **cosmetic `setTimeout` calls**
(`page.tsx:83`, `page.tsx:95`); the whole server round-trip happens inside step two.

**Permission:** `bills.create` (`route.ts:33`). There is no `bank` module — whoever can create
a bill can upload a statement.

### Act 2 — the server turns the file into text

`route.ts:45-57`. Excel goes through the `xlsx` package: `XLSX.read`, then `sheet_to_csv` on
`workbook.SheetNames[0]` — **the first sheet only** (`route.ts:51`). A workbook whose
transactions live on sheet two is silently read as whatever sheet one holds. CSV and TXT are
read as-is.

Under 20 characters of text → `400`, quoting the byte count and file name (`route.ts:59`).

The first five lines are logged at debug with a 200-char sample (`route.ts:64`).

### Act 3 — call A: "you are an expert bank statement parser"

This answers *"is there an inbuilt prompt?"* — **yes, two, hardcoded as template literals in
the route file.** What changed on 9 Sep is *how they are sent*, not what they say.

- **There is still no system prompt.** One user prompt per call.
- **The prompts are still hardcoded** in `route.ts` — not in the database, not in settings.
- **The model is no longer hardcoded.** The route names a *purpose* and the shared client
  resolves provider and model from the `AiProvider` table (`src/lib/ai/index.ts`). The model
  actually used comes back on the result and is logged (`route.ts:148`).
- **The API key is no longer read here.** `src/lib/ai` resolves it, falling back to
  `ANTHROPIC_API_KEY` only to bootstrap an empty provider table (`lib/ai/index.ts:63-70`).

```ts
const parseResult = await runAi({
  purpose: "bank.statement_parse",   // route.ts:127
  prompt: parsePrompt,
  maxTokens: 16384,                  // route.ts:129
  json: true,
});
```

**The bank hint**, injected first (`route.ts:73-77`), abridged:

> *ICICI* — "columns: S No., Value Date, Transaction Date, Cheque Number, Transaction Remarks,
> Withdrawal Amount (Dr), Deposit Amount (Cr), Balance … Some ICICI statements have headers
> spread across multiple rows or have a summary section at top — skip those."
>
> *HDFC* — "columns: Date, Narration, Chq./Ref.No., Value Dt, Withdrawal Amt., Deposit Amt.,
> Closing Balance."

**The parse prompt** (`route.ts:79-109`), verbatim in its essentials:

> You are an expert bank statement parser. Parse the following {bank} bank statement data and
> extract ALL transactions. […] Skip non-transaction rows (headers, totals, blank rows, account
> info). […] Return a JSON array of transactions with this exact structure:
> `[{ "date": "YYYY-MM-DD", "description": …, "reference": …, "amount": 1234.56, "type": "CREDIT"|"DEBIT", "balance": … }]`
>
> Rules:
> - Extract ALL transaction rows — do not skip any
> - Convert dates to YYYY-MM-DD format (input might be DD/MM/YYYY, DD-MM-YYYY, DD/MM/YY etc.)
> - **Amount MUST be a positive number (never negative)**
> - If there are separate Withdrawal/Deposit columns, use Withdrawal for DEBIT and Deposit for CREDIT
> - Balance is the closing balance after that transaction (null if not available)
> - Reference: extract cheque number, UTR, NEFT ref, or transaction ID
> - Return ONLY the JSON array, no markdown, no explanation

**So this is what gets extracted, per row: date, description, reference, amount, type,
balance.** Six fields. No counterparty entity, no category, no split of bank charges.

Then the payload: `${text.slice(0, 50000)}` (`route.ts:109`). **The file is still truncated at
50,000 characters and nobody is told** — this is finding **F1**, and it is the one silent
data-loss path the 9 Sep change did *not* close.

### Act 4 — reading the answer (the salvage is gone)

This act used to be forty lines of rescue code: find the last `}`, close the array by hand,
store whatever survived. **That is deleted.** `runAi` now owns the contract
(`lib/ai/index.ts:167-227`):

| Condition | Old behaviour | Now |
|---|---|---|
| reply stopped on `max_tokens` | array closed by hand, partial rows **stored as complete** | **throws** `AiError("max_tokens")` — *"The bank.statement_parse reply was cut off at N output tokens. Raise maxTokens or send a smaller input."* |
| model refused | fell through to a parse error | throws `AiError("refusal")` |
| rate limited / overloaded / no response | hand-rolled retry | retried inside `runAi`, 3s then 6s |
| JSON in prose | regex-scraped | parsed by the client (`json: true`) |

The route is left with one shape check — *is it an array* (`route.ts:135`) — which logs an
error with the model name and returns the same `{ step: "json_parse" }` diagnostics as before.
On success it logs `statement parsed` with the count and model (`route.ts:148`).

An AI failure is converted by `toAiErrorResponse` into the response the page already knew how
to render, with `diagnostics: { step: "ai_call", fileStats, filePreview }` bolted back on
(`route.ts:149-169`). A non-AI error is logged and rethrown rather than disguised.

Zero transactions → `400`, with a hint separating "AI returned `[]`" from "AI could not
identify transaction rows" (`route.ts:171`).

### Act 5 — the rows become records

`route.ts:193`. One `prisma.bankStatement.create` with a nested `transactions.create`
(`route.ts:203`), so the statement and all its rows land in a single write.

Totals are **recomputed in JavaScript from the parsed rows** (`route.ts:186-191`): sum of
CREDITs, sum of DEBITs, min and max date. They are not read from the statement's own summary
line — so they *cannot* disagree with the rows. Which also means **there is no equivalent of
the brand ledger's tie-out check**: nothing compares the closing balance the bank claims
against what the parsed rows add up to.

The uploaded file itself is **not stored**. `BankStatement` has `fileName` but no `fileUrl`
(`schema.prisma:1033-1051`). Once processed the original is gone, and a mis-parse cannot be
replayed against its source.

### Act 6 — call B: "you are a bank reconciliation AI"

`route.ts:218-336`. Before calling, the route loads **every active vendor** (`id, name, code`
— `route.ts:218`) and **every bill in `PENDING` or `PARTIALLY_PAID`** (`route.ts:223`) —
unbounded, no vendor filter, no date window — and pastes them into the prompt as
pipe-delimited lines, followed by every transaction just saved.

The match prompt (`route.ts:231-265`), verbatim in its essentials:

> You are a bank reconciliation AI. Match bank transactions to vendors and bills.
> VENDORS (id, name): `{id}|{name}|{code}` …
> PENDING BILLS (id, billNo, amount, balance, vendorId, vendorName): …
> BANK TRANSACTIONS TO MATCH: `{id}|{date}|{description}|{amount}|{type}|{reference}` …
>
> For each DEBIT transaction, try to match it to a vendor payment:
> - Match by vendor name in description
> - Match by amount to pending bill balance
> - Match by reference/cheque number
>
> Return a JSON array: `[{ "txnId", "vendorId"|null, "billId"|null, "category", "confidence" 0.0-1.0, "flagReason"|null }]`
> where category ∈ `VENDOR_PAYMENT | EXPENSE_SALARY | EXPENSE_RENT | EXPENSE_UTILITY | EXPENSE_DELIVERY | EXPENSE_OTHER | TRANSFER | UNKNOWN`
>
> Flag suspicious transactions if:
> - Large round amounts with no matching vendor (>50000)
> - Duplicate amounts on same day
> - Description contains unusual keywords
> - Unknown payee for large debits

Note "**for each DEBIT**" — credits get no matching instruction, so incoming money is
effectively unhandled by this step.

Sent as `purpose: "bank.vendor_resolve"` (`route.ts:281`), also `maxTokens: 16384`, `json: true`.
**Call B is deliberately non-fatal**: the statement is already saved, so any failure here
leaves every transaction `UNMATCHED` for manual review, logged as
`vendor resolve skipped` with the error kind (`route.ts:335`).

What the answer does (`route.ts:293-326`):

| AI said | Written onto `BankTransaction` |
|---|---|
| always | `confidence`, `suggestedCategory` |
| `vendorId` | `suggestedVendorId` |
| `billId` | `suggestedBillId` |
| `flagReason` present | `matchStatus = FLAGGED`, `flagReason`, `flaggedCount++` |
| otherwise, a vendor or an `EXPENSE*` category | `matchStatus = MATCHED`, `matchedCount++` |

**`MATCHED` here means "the AI has an opinion", not "this is in the books".** `processedAt` is
still null; no payment and no expense exists yet.

A hallucinated `txnId` still fails its update — but it is no longer swallowed. The `.catch` now
logs a warning naming the statement and the invented id (`route.ts:319-325`), with the comment:

> The model can invent a txnId. Skip that row — but say so, or a statement that comes back
> fully UNMATCHED has no trail to explain why.

Finally `matchedCount` / `flaggedCount` are written onto the statement (`route.ts:339`).

### Act 7 — a human decides (`/accounts/reconcile/[id]`)

Everything so far was a suggestion. This screen is where money enters the books.

The page loads the statement with its suggested vendor and bill joined
(`api/bank-statements/[id]/review/route.ts:19-30`), plus 500 vendors and 500 pending bills for
the dropdowns (`reconcile/[id]/page.tsx:154-155`). Rows are grouped by flag reason or category
and filtered by status; **only unprocessed `DEBIT` rows are actionable** (`page.tsx:237`).

Four actions post back to the same route:

| Action | What it writes |
|---|---|
| `confirm_payment` | a `VendorPayment`; if a bill was chosen, updates that bill's `paidAmount` and `status` |
| `confirm_expense` | an `Expense`, category mapped from the AI's guess |
| `ignore` | `matchStatus = IGNORED`, `processedAt` set |
| `flag` | `matchStatus = FLAGGED` with a reason |

**The single `confirm_payment` path is the careful one** (`review/route.ts:137-188`). It runs
inside `prisma.$transaction`, re-reads the bill within it, and refuses if the transaction
exceeds the bill's remaining balance by more than ₹0.01:

> "Bank transaction ₹X exceeds bill Y remaining ₹Z. Confirm against the right bill, or split
> the payment."

The comment records why: this path once ran three bare statements in sequence and could drive
`paidAmount` past `amount`. The ₹0.01 epsilon exists because the money columns are `Float`; it
disappears the day they become `Decimal`.

**The bulk path is not the careful one.** `review/route.ts:99` creates every payment with
`billId: null` — bulk-confirming ten payments records ten `VendorPayment` rows and updates
**zero** bill balances. Those bills stay `PENDING` forever. Tracked as **L3**; still open.

Payment mode is inferred from the reference prefix: `UPI…` → UPI, `NEFT…`/`RTGS…` → NEFT,
everything else → **CHEQUE** (`review/route.ts:154`). A cash deposit or an unlabelled debit is
therefore recorded as a cheque.

Expense category mapping (`review/route.ts:77-81`, repeated at `:202-209`): `EXPENSE_SALARY` →
`SALARY_ADVANCE`, `EXPENSE_RENT` → `SHOP_MAINTENANCE`, `EXPENSE_UTILITY` → `UTILITIES`,
`EXPENSE_DELIVERY` → `DELIVERY`, `EXPENSE_TRANSPORT` → `TRANSPORT`, anything else →
`MISCELLANEOUS`. Note `EXPENSE_TRANSPORT` is in the map but **absent from the prompt's category
list**, so the AI never produces it.

---

## 2. Which tables are affected

### Written directly

| Table | When | Where |
|---|---|---|
| `BankStatement` | upload | `route.ts:193` — one row per file; counts patched at `:339` |
| `BankTransaction` | upload | `route.ts:203` nested create; AI suggestions at `:313`; status on every review action |
| `VendorPayment` | `confirm_payment` | `review/route.ts:149` (single) · `:97` (bulk) |
| `VendorBill` | `confirm_payment` **with a bill** | `review/route.ts:167` — `paidAmount` += amount, `status` → `PAID` / `PARTIALLY_PAID` |
| `Expense` | `confirm_expense` | `review/route.ts:211` (single) · `:82` (bulk) |

### Read but never written

| Table | Why |
|---|---|
| `Vendor` | the active list pasted into the match prompt (`route.ts:218`) |
| `VendorBill` | the pending list pasted into the match prompt (`route.ts:223`) |
| `User` | `uploadedById` on the statement, `recordedById` on payments and expenses |
| `AiProvider` | read by `src/lib/ai` to resolve which provider and model answer both calls |

### Moved indirectly — the second-order effects

Nothing below is touched by this flow, but each **changes what it shows** the moment a
transaction is confirmed:

| Reader | Effect of one confirmed payment / expense |
|---|---|
| `api/vendors/[id]/ledger` → `/accounts/vendor-ledger` and the vendor *Ledger* tab | a new credit line; running balance and `currentBalance` drop |
| `api/ledger/vendors/[id]` → **the brand ledger** | the new `VendorPayment` joins the "our books" side, so `matchEntries` can now match a supplier statement row that was previously `WE_MISSING`, and `assessCoverage` improves |
| `api/accounts/summary` | payables and expense totals |
| `api/reports/daily`, `api/reports/expense-summary`, `api/health/summary` | expense and payment figures |
| `api/activity` | the payment or expense appears in the feed |
| `api/bills/[id]` and the bills list | bill status and remaining balance |

And one that runs the other way:

| Writer | What it does to this flow |
|---|---|
| `api/pos/settlement/[id]/match` | Daily Settlement links a `BankTransaction` to a `SettlementMatch` and sets that transaction to `MATCHED` + `processedAt` (`match/route.ts:55-59`) — **without creating any `VendorPayment`.** The row then vanishes from the reconcile queue as though it had been dealt with. Two modules own the same status column. Tracked as **L13**. |

```
        bank file (CSV / XLS / XLSX / TXT — never PDF)
            │
            ▼
   ┌──── BankStatement ────┐      runAi "bank.statement_parse"  ← AiProvider decides the model
   │                       │
   └──► BankTransaction ◄──┴──────runAi "bank.vendor_resolve"   ← suggestions only
            │
            │  a human confirms on /accounts/reconcile/[id]
            ├──────────────► VendorPayment ──► VendorBill.paidAmount / status
            └──────────────► Expense
                                 │
                                 ▼
              vendor ledger · brand ledger "our books" side ·
              accounts summary · daily & expense reports · activity feed

   (sideways)  DailySettlement ──► SettlementMatch ──► marks BankTransaction MATCHED
```

---

## 3. What the AI is *not* asked to do

- It never sees the bank's stated opening or closing balance, and nothing checks the rows
  against one. Compare the brand ledger, where exactly that check is the point
  (`reconcile.ts:122`).
- It is told to match **DEBITs only**. Credits get a category at best.
- It cannot create anything. Every write into the books needs a human click.
- It receives every active vendor and every pending bill on every upload, so the prompt grows
  with the business and has no ceiling.

---

## 4. Failure modes, in the order they will bite

| # | What happens | Where | Visible? |
|---|---|---|---|
| 1 | File over 50,000 chars → tail dropped (**F1**) | `route.ts:109` | **No** — still reports success |
| 2 | Multi-sheet workbook → only sheet 1 read | `route.ts:51` | **No** |
| 3 | Bulk `confirm_payment` → bill balances never update (**L3**) | `review/route.ts:99` | **No** — bills stay PENDING |
| 4 | Settlement marks a txn MATCHED with no payment behind it (**L13**) | `pos/settlement/[id]/match/route.ts:55` | **No** |
| 5 | Reply cut off at `maxTokens` | `lib/ai/index.ts:219` | **Yes** — refused with the token count and advice *(was silent before `c8f1b61`)* |
| 6 | Hallucinated `txnId` | `route.ts:319` | **Yes** — logged as a warning naming the id *(was silent)* |
| 7 | Call B fails entirely | `route.ts:335` | **Yes** — logged; rows stay UNMATCHED |
| 8 | No provider configured | `lib/ai/index.ts` — `AiNotConfiguredError` | Yes |
| 9 | Provider overloaded / rate limited | `lib/ai/index.ts:213` | Yes — retried 3s then 6s, then a readable error |

**The list is half the length it was this morning.** Items 5–7 moved from *silent* to *visible*
in `c8f1b61`. Item 1 did not.

---

## 5. CLAUDE.md compliance

| Rule | Status |
|---|---|
| Logging is mandatory | ✅ **now compliant in the route** — debug before each call with prompt size, info on success with the model, error on parse failure, warn on every skipped row and skipped call |
| Every `catch` logs | ✅ in `route.ts` — the bare `catch {}` blocks are gone |
| `readJson()` / no raw `res.json()` on a third party | ✅ the route no longer touches the provider's HTTP response; `src/lib/ai` owns it |
| Never log a secret | ✅ |
| Use `apiFetch` / `apiTry` in the browser | ❌ **still open** — raw `fetch().then(r => r.json())` at `bank-upload/page.tsx:61`, `:87`; `reconcile/[id]/page.tsx:143`, `:154`, `:165`, `:182` |

---

## 6. Open questions

1. **F1 is the last silent one.** Should the 50,000-character truncation fail loudly, the way
   a cut-off reply now does? The asymmetry is odd: the app refuses a truncated *answer* but
   still silently truncates the *question*.
2. Should the original file be stored (R2, the way `BrandStatement.fileUrl` anticipates) so a
   mis-parse can be replayed?
3. Should this get the brand ledger's **tie-out check** — the bank's closing balance against
   the sum of parsed rows? It is the cheapest guard against #1, and the data is on the page.
4. Both prompts are still hardcoded strings in a route handler. The provider and model are now
   configuration; the instructions are not.

---

## 7. What changed on 9 Sep 2026

**`c8f1b61` — "which AI provider is live becomes data, and one client answers for all of it"**
(plan: `implementation/completed/0809-ai-provider-settings-and-shared-client-plan.md`).

| Finding | Before | After |
|---|---|---|
| **F2** — partial JSON salvaged and stored as complete | forty lines of hand-rolled rescue | **fixed** — `runAi` throws on `stopReason === "max_tokens"` (`lib/ai/index.ts:219`) |
| **F4** — `res.json()` on a third-party response | in this route | **fixed** — the route never sees the HTTP response |
| **F6** — bare `catch {}` | two of them | **fixed** — every catch logs |
| **F7** — no logger | scoped but barely used | **fixed** — used at every branch |
| **F1** — 50,000-character truncation | silent | **still silent** (`route.ts:109`) |
| **F5** — browser `fetch` + `res.json()` | both pages | **still open** |

Still owed by that plan: `npx prisma migrate deploy` for `20260908143858_ai_provider` anywhere
but the local database.

**From the 31 Aug audit** (`ledger-and-reconciliation-flow.md`):

| Finding | Today |
|---|---|
| L3 — bulk `confirm_payment` drops the bill link | **still open** (`review/route.ts:99`) |
| L7 — the `brand_ledger` `fetch` permission guards nothing | **fixed** — gone from `rbac-catalog.ts:505` |
| *(unnumbered)* single `confirm_payment` had no transaction or balance guard | **fixed** (`review/route.ts:137-188`) |
| L9 — no statement file stored | **still open** |
