# AI / LLM Usage Audit

**Date:** 31 Aug 2026
**Scope:** every place this codebase calls an AI model, why, with which model, whether
it is worth it, and what to change.
**Branch audited:** `refactor/zoho-endpoint-registry`

---

## 1. Summary

| Question | Answer |
|---|---|
| Do we use an AI API key? | **Yes — exactly one.** `ANTHROPIC_API_KEY` (Claude), `.env` line 18. |
| Any other provider? | **No.** No OpenAI, no Gemini key. `@google/generative-ai` is in `package.json` but **imported nowhere** — dead dependency, already flagged in `docs/dead-code.md:163`. |
| How many files call a model? | **3 files** |
| How many API calls to Claude? | **4 call sites** (one file makes two separate calls) |
| How many modules? | **3** — Brand Stock / Purchasing, Payments, Accounts / Bank Reconciliation |
| Models in use | `claude-sonnet-4-20250514` (1 call), `claude-haiku-4-5-20251001` (3 calls) |
| Is the spend worth it? | **3 of 4 calls: yes.** **1 call is not worth it** and should be replaced with code. **1 model ID is two generations stale** and costs more than its replacement. |
| Is any AI output written to the DB without a human seeing it? | **Yes, one path** — the bank-reconciliation suggestions (`suggestedVendorId`, `suggestedBillId`, `confidence`, `flagReason`, `matchStatus`) are written straight from the model. A human confirms before money moves, but the suggestion itself is unreviewed. |

---

## 2. The key

```
.env:18    ANTHROPIC_API_KEY=<secret>
```

Read in three places:

| File | How |
|---|---|
| `src/lib/pdf-parser.ts:4` | **Implicitly** — `new Anthropic()` with no args; the SDK reads `ANTHROPIC_API_KEY` from the environment itself |
| `src/app/api/payments/parse-screenshot/route.ts:29` | `process.env.ANTHROPIC_API_KEY` into the `x-api-key` header |
| `src/app/api/bank-statements/route.ts:72` | `process.env.ANTHROPIC_API_KEY` into the `x-api-key` header |

The key is server-side only. It is never sent to the browser, never in a `NEXT_PUBLIC_*`
var, and never logged. **That part is correct.**

One inconsistency: two files hand-roll a `fetch` to `https://api.anthropic.com/v1/messages`
while the third uses the official SDK. Same key, two transports, two retry
implementations, two error shapes.

---

## 3. Where AI is used — full inventory

### 3.1 Brand Stock upload — PDF / image product catalogue

| | |
|---|---|
| **Call site** | `src/lib/pdf-parser.ts:16` (SDK: `client.messages.create`) |
| **Called by** | `src/app/api/brand-stock/upload/route.ts:39` |
| **Screen** | `/brand-stock/upload` |
| **Module** | Brand Stock / Purchasing |
| **Permission** | `requireFeature("purchase_orders", "create")` — correct |
| **Model** | `claude-sonnet-4-20250514` |
| **max_tokens** | 4096 |

**What the module does.** A brand (Hero, Hercules, ...) sends a stock / price list. We
parse it into `BrandStockItem` rows, match each row to a `Product`, pull our own stock
and reorder level alongside, and let the buyer tick what to order.

**Why AI is used here.** Look at `route.ts:26-42` — this is a **fallback, not the default**:

```
EXCEL_TYPES = ["xlsx", "xls", "csv"]      ->  parseExcelBuffer()   (deterministic)
AI_TYPES    = ["pdf", "png", "jpg", ...]  ->  parsePdfWithAI()     (Claude)
```

`src/lib/excel-parser.ts` already does deterministic header detection (keyword scoring
over the first 8 rows) for spreadsheets. AI is reached **only** when the brand sends a
PDF or a photo of a printed list — a format no deterministic parser can handle.
**This is a correct and well-designed use of a model.**

Note the *matching* step after parsing (`src/lib/brand-stock-matcher.ts`) is **pure code** —
saved SKU mappings first, then normalised fuzzy string scoring. No AI. Also correct.

**Verdict: keep the AI, change the model.** See section 5.

---

### 3.2 Payment screenshot scan

| | |
|---|---|
| **Call site** | `src/app/api/payments/parse-screenshot/route.ts:75-99` (raw `fetch`) |
| **Called by** | `src/app/(dashboard)/payments/new/page.tsx:177` |
| **Screen** | `/payments/new` — the scan-screenshot button |
| **Module** | Payments |
| **Permission** | `requireFeature("bills", "create")` — correct |
| **Model** | `claude-haiku-4-5-20251001` |
| **max_tokens** | 1024, `maxDuration = 30` |

**What it does.** Staff paste a screenshot of a UPI / NEFT / RTGS / IMPS confirmation or a
photo of a cheque. Claude Vision reads: `amount`, `paymentMode`, `referenceNo` (UTR),
`paymentDate`, `vendorName`, `payerName`, `bankName`, `notes` — and is additionally given
the **live active-vendor list** in the prompt so it can name the closest match.

**Why AI.** There is no other way. A payment screenshot is an arbitrary image from any of
a dozen bank apps with no consistent layout. OCR alone would give you text with no idea
which number is the amount and which is the account number.

**Human in the loop.** Yes. Output only **pre-fills the form**. The user reviews every
field and presses save. Nothing is written to the DB by the model.

**Cost.** Roughly 2.5K input tokens (image + vendor list) plus ~300 output — about
**$0.004 per scan**. Negligible.

**Verdict: keep it. This is the best AI use in the codebase.** Highest time saved per
rupee spent, lowest blast radius, correct model tier.

---

### 3.3 Bank statement parse — **call A**

| | |
|---|---|
| **Call site** | `src/app/api/bank-statements/route.ts:117-129`, prompt at `:88-112` |
| **Called by** | `src/app/(dashboard)/accounts/bank-upload/page.tsx:87` |
| **Screen** | `/accounts/bank-upload` |
| **Module** | Accounts / Bank Reconciliation |
| **Permission** | `requireFeature("bills", "create")` — correct |
| **Model** | `claude-haiku-4-5-20251001` |
| **max_tokens** | 16384, **no `maxDuration`** |

**What it does.** Staff upload an HDFC or ICICI statement (`.csv`, `.txt`, `.xls`, `.xlsx`).
The route converts a spreadsheet to CSV with `XLSX.utils.sheet_to_csv`, then sends **that
CSV text** to Claude with bank-specific column hints and asks for
`{date, description, reference, amount, type, balance}` rows.

**Why AI was chosen.** Bank exports vary: header rows in different places, summary blocks
at the top, `DD/MM/YY` vs `DD-MM-YYYY`, separate Withdrawal/Deposit columns vs a single
amount with a Dr/Cr flag. Writing a parser per bank per format is real work.

**Why it is questionable.** The route **already parsed the spreadsheet** with the `xlsx`
library at lines 47-52 — it has the cells — and then throws that structure away and asks a
language model to re-read it as flat text. And `excel-parser.ts` in this same codebase
already proves deterministic header detection works for exactly this shape of problem.

**Verdict: worth keeping for now, but as a fallback, not the default.** See section 7.2.

---

### 3.4 Bank reconciliation matching — **call B**

| | |
|---|---|
| **Call site** | `src/app/api/bank-statements/route.ts:296`, prompt at `:260-294` |
| **Module** | Accounts / Bank Reconciliation |
| **Model** | `claude-haiku-4-5-20251001`, `max_tokens: 16384` |

**What it does.** After the transactions are saved, the route sends Claude:

- **every active vendor** (id, name, code)
- **every PENDING / PARTIALLY_PAID bill** (id, billNo, amount, balance, vendorId, vendorName)
- **every transaction just imported**

...and asks it to return, per transaction: `vendorId`, `billId`, `category`, `confidence`
(0-1) and a `flagReason`. Those values are written directly onto `BankTransaction`
(`:311-335`), and `matchStatus` is set to `MATCHED` or `FLAGGED`.

**Why it was done this way.** One prompt does name matching, amount matching, reference
matching, expense categorisation and anomaly flagging at once. It looked like one problem.

**Why it is the one call that is not worth it.** Most of those jobs are arithmetic:

| Sub-task | Should be |
|---|---|
| Match a debit to a bill by **exact amount** | SQL |
| Match by **UTR / cheque / reference number** | SQL |
| Flag "round amount over Rs 50,000 with no vendor" | an `if` statement |
| Flag "duplicate amount same day" | `GROUP BY date, amount HAVING count > 1` |
| Match `NEFT-HRO CYCLE IND-4471` to vendor *Hero Cycles* | **genuinely fuzzy — keep AI** |
| Categorise `RENT AUG SHOP2` as `EXPENSE_RENT` | **genuinely fuzzy — keep AI** |

We are paying a model, non-deterministically, to do exact comparison — and re-sending the
whole vendor and bill catalogue on every single upload, uncached. A model can also
hallucinate a `billId` that does not exist; the code handles that by silently swallowing
the failed update (`:333`).

**Human in the loop.** Partially. `/accounts/reconcile/[id]` shows every suggestion and a
person must POST `confirm_payment` / `confirm_expense` / `ignore` before an `Expense` or
payment row is created. **But** `matchStatus`, `confidence` and `flagReason` land in the DB
unreviewed, and a wrong `FLAGGED` / `MATCHED` steers what the reviewer looks at.

**Verdict: replace most of this with code. Keep AI only for name resolution and
categorisation.**

---

## 4. Where AI is *not* used (and correctly so)

Worth recording, because it shows the codebase already has the right instinct in places:

| Deterministic component | What it does | Why no AI is right |
|---|---|---|
| `src/lib/excel-parser.ts` | Header-row detection and column mapping for `.xlsx/.xls/.csv` brand lists | Spreadsheets have structure; keyword scoring is exact, free, instant |
| `src/lib/brand-stock-matcher.ts` | Brand SKU to `Product` matching (saved mappings, then normalised fuzzy scoring) | Deterministic, auditable, and mappings *improve* as they are saved |
| `fuzzyMatchVendor` in `payments/new/page.tsx` | Client-side vendor fallback when the API returns no `vendorId` | Free second chance, no round trip |
| Zoho sync, WhatsApp, Supabase storage, RBAC, GST | — | No AI anywhere. Correct. |

---

## 5. Model assessment — is what we use worth it?

Current published pricing (per million tokens):

| Model | Input | Output | Context |
|---|---|---|---|
| `claude-opus-5` | $5 | $25 | 1M |
| `claude-sonnet-5` | $2 | $10 | 1M |
| `claude-haiku-4-5` | $1 | $5 | 200K |
| `claude-sonnet-4-20250514` *(what we use)* | ~$3 | ~$15 | 200K |

### 5.1 Haiku 4.5 — the right tier, the wrong string

Haiku 4.5 is **the correct choice** for "read this document and return JSON". Structured
extraction is exactly the workload the small model is for; spending Opus money on it would
be waste. No complaint about the tier.

**But the ID is malformed.** Current Claude model IDs carry **no date suffix**:

```
claude-haiku-4-5-20251001     ->   claude-haiku-4-5
```

Three call sites use the suffixed form. It works today; it is not the documented ID and it
is the kind of string that breaks quietly later.

### 5.2 `claude-sonnet-4-20250514` — this one genuinely costs us

`src/lib/pdf-parser.ts:16` runs the **hardest** job in the whole system — reading a
multi-page PDF price table, or a photo of a printed one — on a model **two generations
behind**, at a price **higher than its replacement**:

| | Sonnet 4 (current) | Sonnet 5 (recommended) |
|---|---|---|
| Input | ~$3 / MTok | **$2 / MTok** |
| Output | ~$15 / MTok | **$10 / MTok** |
| Table-structure accuracy | older generation | materially better |
| Est. cost, 20-page catalogue | ~$0.18 | **~$0.12** |

**Changing one string makes it about 33% cheaper and more accurate.** There is no argument
for keeping it.

### 5.3 Rough spend today

| Operation | Est. cost | Frequency | Verdict |
|---|---|---|---|
| Payment screenshot | ~$0.004 | per payment entry | Excellent value |
| Brand PDF catalogue | ~$0.18 | per brand upload | ~$0.12 after the model fix |
| Bank statement — call A (parse) | ~$0.08 | per statement | Mostly avoidable |
| Bank statement — call B (match) | ~$0.08 | per statement | Largely avoidable |

*(Order-of-magnitude estimates derived from prompt sizes in the code, not from billing
data. We have no usage logging, so real spend is currently unknown — see finding F9.)*

The bill is not large. The concern is **not cost — it is silent wrongness in the accounting
module**, covered next.

---

## 6. Findings

Severity: **H** correctness / data loss · **M** project-rule violation · **L** cost / hygiene

### H — F1: Bank statements are silently truncated at 50,000 characters

`src/app/api/bank-statements/route.ts:112`

```ts
${text.slice(0, 50000)}
```

A statement longer than about 50 KB has its tail **cut off before the model ever sees it**.
Those transactions are never parsed, never counted, and **never reported as missing** —
`txnCount` reports only what survived. On a busy month's HDFC export this loses real
transactions from a reconciliation screen people trust. **This is the single most
dangerous line in the AI code.**

### H — F2: Partial JSON is salvaged and stored as if complete

`route.ts:165-196`. When the model hits `max_tokens: 16384` mid-array, the code finds the
last `}`, appends `]`, and parses that. A **partial** transaction list is then written to
`BankStatement` with `txnCount`, `totalCredits` and `totalDebits` computed from the
fragment. Nothing warns the user. `stop_reason` — the field that would say `"max_tokens"` —
is **never checked anywhere in the codebase**.

### H — F3: `pdf-parser.ts` caps output at 4096 tokens and then blames the document

`src/lib/pdf-parser.ts:17`. A catalogue over roughly 60-80 items exceeds 4096 output
tokens. The response is cut off, so `text.match(/\[[\s\S]*\]/)` finds no closing `]`, and
the user is told:

> "Could not extract product data from this document. The AI could not find a product table."

The document was fine. **The error message points the buyer at the wrong problem.**

### M — F4: `res.json()` called directly on a third-party response

`bank-statements/route.ts:130`, `parse-screenshot/route.ts:101`.
`CLAUDE.md` requires `readJson()` from `src/lib/http-json.ts` for third-party responses,
precisely so a non-JSON error body names the service and status instead of throwing
`Unexpected token '<'`.

### M — F5: Browser `fetch(...)` followed by `res.json()`

`payments/new/page.tsx:177-178`, `accounts/bank-upload/page.tsx:87-88`.
`CLAUDE.md` bans this outright — must use `apiFetch` / `apiTry` from
`src/lib/api-client.ts`. As written, an expired session returns the login HTML with status
200 and the user sees a JSON parse error instead of "please log in".

### M — F6: Bare `catch {}` and swallowed failures

`bank-statements/route.ts:333` (`.catch(() => {})`) and `:336-338`.
`CLAUDE.md`: *"Every `catch` logs before it rethrows or swallows. A bare `catch {}` is a
bug."* Today, if AI matching fails entirely, `matchedCount` is 0 and **nothing anywhere
records why**.

### M — F7: Two of three AI files have no logger at all

`src/lib/pdf-parser.ts` and `parse-screenshot/route.ts` import no logger. `CLAUDE.md`
requires `log.debug` on every outbound request and `log.error` on every failure. We cannot
answer "why did that upload fail last Tuesday".

### L — F8: `bank-statements` sets no `maxDuration`

It makes **two** Claude calls (one with `max_tokens: 16384`) plus a large transactional
write, with no duration declared — while the much lighter `parse-screenshot` sets 30.

### L — F9: No prompt caching, no usage logging, no spend visibility

Call B re-sends the full vendor plus pending-bill catalogue on every upload with no
`cache_control`. `response.usage` is never read, so cached-versus-uncached tokens and
actual spend are invisible.

### L — F10: JSON is scraped out of prose with a regex

All four call sites do `text.match(/\[[\s\S]*\]/)` or `/\{[\s\S]*\}/`. Structured outputs
(`output_config.format`) make the response schema-valid by construction and delete every
one of these regexes and their salvage branches.

### L — F11: Dead dependency

`@google/generative-ai` is installed and imported nowhere.

---

## 7. Recommendations

### 7.1 Where AI **must** stay

| Use | Why it cannot be code |
|---|---|
| Payment screenshot reading | Arbitrary image from any bank app. No fixed layout exists. |
| Brand PDF / photo catalogue | Layout differs per brand and per year; may be a photo of paper. |
| Bank vendor-name resolution | `NEFT-HRO CYCLE IND-4471` to *Hero Cycles* is language, not arithmetic. |
| Expense categorisation from narration | `RENT AUG SHOP2` to `EXPENSE_RENT` is semantics. |
| Unknown / new bank format (fallback only) | The long tail no parser covers. |

### 7.2 Where AI should be **replaced by code**

**Bank reconciliation, call B.** Restructure it as three stages:

1. **Deterministic pass (SQL).** Match by exact amount, by reference/UTR/cheque number,
   and by date window. In a typical statement this resolves the large majority of rows,
   with an audit trail, for zero cost. Flags for round amounts, duplicates and large
   unknown debits are `if` statements and a `GROUP BY`.
2. **AI pass — only the leftovers.** Send Claude only the rows stage 1 could not resolve,
   and only the vendors plausibly involved. Ask for **name resolution and category only** —
   never a `billId` it could invent.
3. **Human pass.** Unchanged; `/accounts/reconcile/[id]` already does this well.

This mirrors the pattern the codebase already uses successfully in
`brand-stock-matcher.ts`: exact mappings first, fuzzy second.

**Bank statement parse, call A.** Try a deterministic parser first — the route already has
the workbook object in memory. Fall back to Claude only when column detection fails or the
file is not a spreadsheet. Same shape as `brand-stock/upload` already uses.

### 7.3 How to optimise what remains

| # | Change | Effect |
|---|---|---|
| 1 | `claude-sonnet-4-20250514` to **`claude-sonnet-5`** in `pdf-parser.ts` | ~33% cheaper, better tables. One line. |
| 2 | `claude-haiku-4-5-20251001` to **`claude-haiku-4-5`** (3 sites) | Correct documented ID |
| 3 | **Fix F1 first** — chunk long statements instead of `slice(0, 50000)`, or reject with an honest message | Stops silent transaction loss |
| 4 | **Check `stop_reason`** on every response; if `max_tokens`, fail loudly | Kills F2 and F3 |
| 5 | Raise `pdf-parser` `max_tokens` (4096 to 16000) and **stream** | Large catalogues actually parse |
| 6 | Adopt **structured outputs** (`output_config.format`) | Deletes every JSON regex and salvage branch (F10) |
| 7 | Add **prompt caching** on the stable prefix (vendor list, bank hints) | ~90% off the repeated input tokens |
| 8 | Single **`src/lib/ai.ts`** wrapper: SDK only, one retry policy, `readJson`, `createLogger`, `usage` logging | Fixes F4, F6, F7, F9 in one place |
| 9 | Switch both frontend callers to `apiFetch` / `apiTry` | Fixes F5 |
| 10 | Add `maxDuration` to `bank-statements` | Fixes F8 |
| 11 | `npm uninstall @google/generative-ai` | Fixes F11 |

### 7.4 Suggested order

Each phase names the questions in section 8 that must be answered before it can start.

| Phase | Work | Why here | Blocked by |
|---|---|---|---|
| 1 | **F1, F2, F3** | Silent data loss in accounting and purchasing. Nothing else matters more. | **Q1, Q2, Q3** |
| 2 | **Model IDs** (#1, #2) | A two-line change, immediately cheaper and better. | **Q4** |
| 3 | **`src/lib/ai.ts`** wrapper | Fixes four project-rule violations at once (F4, F6, F7, F9) and is the prerequisite for everything after it. | Q13 |
| 4 | **Deterministic-first reconciliation** (7.2) | The real accuracy and cost win. | **Q5, Q6**, then Q7-Q10 |
| 5 | **Caching and structured outputs** | Polish once the shape is right. | Q12 |
| 6 | **F5, F8, F11** | Small, independent cleanups. | Q14 |

If the answer to **Q6** is yes, phase 4 moves ahead of phases 2 and 3 — it stops being an
optimisation and becomes a correctness fix.

### 7.5 Where AI could be added later (not now)

Only after the above. Worth considering, in this order:

- **Vendor bill PDF to `VendorBill` draft.** Same problem shape as the brand catalogue,
  already solved once. Highest value of any new AI feature here.
- **GST / HSN suggestion on new products** — advisory only, never auto-applied to a filing.
- **Natural-language stock search** ("26 inch MTB under 15k in stock").

Explicitly **not** recommended: anything that writes to the ledger, sets a price, or acts
without a human pressing a button. And per `CLAUDE.md`, none of it may be a scheduled job.

---

## 8. Questions to clarify while implementing

Work through these in order. **Q1-Q6 are blocking** — they change what the code should be,
so they must be answered before that phase starts. **Q7-Q14 come up mid-build** — they can
be answered when you reach them. Section 8.4 has a table to record the answers so the
decision is not re-litigated later.

### 8.1 Blocking — answer before writing code

#### Phase 1 (F1, F2, F3 — the data-loss fixes)

**Q1. How big is a real bank statement?**
Give me one actual monthly HDFC export and one ICICI export: file size in KB, number of
transaction rows, and the character count after `sheet_to_csv`.
*Why it blocks:* if a normal month fits well under 50,000 characters, F1 is a guard clause
plus an honest error. If it does not, F1 needs windowed chunking — several Claude calls
stitched together — which is a different and larger change.
*Blocks:* recommendation 3.

**Q2. When a statement is too big, what should happen?**
Options:
 (a) **Reject** with "this file has ~N transactions, split it by month" — simplest, safest,
     no new failure modes;
 (b) **Chunk** transparently and parse in windows — better UX, more code, and the chunk
     boundary can split a row;
 (c) **Parse what fits and warn loudly** — closest to today, but still loses data.
*My recommendation:* (a) now, (b) only if Q1 shows normal months genuinely overflow.
*Blocks:* recommendation 3.

**Q3. What is the largest brand catalogue we actually receive?**
Roughly how many line items in the biggest PDF or photo list a brand has sent?
*Why it blocks:* it sets the new `max_tokens` in `pdf-parser.ts` and decides whether that
call must switch to streaming. Over ~250 items, streaming stops being optional.
*Blocks:* recommendation 5.

#### Phase 2 (model IDs)

**Q4. Approve the model change on `pdf-parser.ts`?**
`claude-sonnet-4-20250514` to `claude-sonnet-5` — cheaper per token and better at tables.
*Why it blocks:* it is your spend, and the output feeds purchasing decisions.
*Also confirm:* should I keep Haiku 4.5 for the three bank/payment calls (my
recommendation), or do you want the bank-statement parse on Sonnet 5 too for accuracy?
*Blocks:* recommendations 1 and 2.

#### Phase 4 (deterministic-first reconciliation)

**Q5. Is the HDFC `.xls` column layout stable month to month?**
Download two different months and tell me whether the header row sits in the same place
with the same column names.
*Why it blocks:* if stable, a deterministic parser is roughly a day and Claude call A
becomes a fallback only. If every download differs, AI stays primary and we only add
caching. This is the difference between two very different implementations.
*Blocks:* section 7.2, second half.

**Q6. Has a wrong AI match ever been confirmed by staff and had to be corrected?**
Even once.
*Why it blocks:* if yes, deterministic-first moves **above** the model changes in the
order — it stops being an optimisation and becomes a correctness fix.
*Blocks:* the phase order in 7.4.

### 8.2 Non-blocking — but tell me if the answer is unusual

**Q7. What tolerance counts as an "exact amount" match?**
Bank rounding and charges mean `12,500.00` in the statement may be `12,500` on the bill.
*Default if you do not answer:* exact to the paisa, then a second pass at +/- Rs 1.

**Q8. How far apart can a payment date and a bill date be and still match?**
*Default:* a 7-day window either side.

**Q9. When code and AI disagree on a vendor, who wins?**
*Default:* deterministic wins; the AI suggestion is stored alongside as a second opinion so
the reviewer sees both.

**Q10. Should a deterministic exact match auto-set `matchStatus = MATCHED`?**
It is exact, so it is safe — but it changes what the reviewer sees first.
*Default:* yes, with the match reason recorded ("amount + UTR"), so a person can tell a
code match from an AI guess at a glance.

**Q11. Do staff currently trust the `FLAGGED` / `MATCHED` labels, or review every row anyway?**
*Why it matters:* if they trust them, the unreviewed DB write in call B is a bigger risk
than this document assumes and Q6 gets more weight.

**Q12. Is there a monthly AI budget to design to?**
*Why it matters:* it sets how aggressive the caching and chunking targets should be.
*Default:* optimise for correctness first, cost second — current spend is small.

**Q13. Should `src/lib/ai.ts` log token usage per call?**
*Default:* yes — `log.info` with `{ endpoint, inputTokens, outputTokens, cacheRead, stopReason }`.
Without it we cannot answer Q12 next quarter. No payloads, no secrets, identifiers only.

**Q14. Remove `@google/generative-ai` in the same PR, or separately?**
*Default:* separately — it is unrelated to the AI fixes and `docs/dead-code.md` lists five
other unused packages that should go together.

### 8.3 Checkpoints — I will stop and ask when I hit these

I will not decide these alone; expect a message when the build reaches one:

| When | What I will ask |
|---|---|
| Before touching `bank-statements/route.ts` | Confirm the diff, because this route writes to `BankStatement` and `BankTransaction` and a mistake corrupts reconciliation history |
| If a fix needs a Prisma schema change | Stop and confirm — e.g. a `matchSource` column to distinguish a code match from an AI match |
| If `npm run build` fails after a change | Revert and re-plan, per `AGENTS.md`. I will not stack fixes. |
| Before the deterministic reconciliation rewrite | Walk through the matching rules with you line by line before writing them |
| If real statements reveal a bank format not in the code | Ask rather than guess at ICICI/HDFC variants |
| Before any `git` or `npm` command | Always — per `AGENTS.md`, every one is gated |

### 8.4 Answer log

Fill this in as decisions are made, so they are not revisited:

| Q | Question | Answer | Decided on |
|---|---|---|---|
| Q1 | Real statement size (KB / rows / chars) | | |
| Q2 | Oversized statement: reject / chunk / warn | | |
| Q3 | Largest brand catalogue (line items) | | |
| Q4 | Approve Sonnet 5 on `pdf-parser.ts` | | |
| Q5 | Is the HDFC `.xls` layout stable | | |
| Q6 | Has a wrong AI match been confirmed | | |
| Q7 | Amount-match tolerance | | |
| Q8 | Date-match window | | |
| Q9 | Code vs AI conflict winner | | |
| Q10 | Auto-`MATCHED` on exact match | | |
| Q11 | Do staff trust the flags | | |
| Q12 | Monthly AI budget | | |
| Q13 | Log token usage | | |
| Q14 | Drop `@google/generative-ai` when | | |

---

## 9. Quick reference — every AI call in the codebase

```
src/lib/pdf-parser.ts:16
  claude-sonnet-4-20250514 · max_tokens 4096 · SDK
  Brand PDF/image catalogue -> product rows
  <- src/app/api/brand-stock/upload/route.ts:39        [purchase_orders.create]

src/app/api/payments/parse-screenshot/route.ts:83
  claude-haiku-4-5-20251001 · max_tokens 1024 · raw fetch · maxDuration 30
  Payment screenshot -> amount / mode / UTR / date / vendor
  <- src/app/(dashboard)/payments/new/page.tsx:177     [bills.create]

src/app/api/bank-statements/route.ts:125   (call A)
  claude-haiku-4-5-20251001 · max_tokens 16384 · raw fetch · no maxDuration
  Bank CSV/XLS -> transaction rows
  <- src/app/(dashboard)/accounts/bank-upload/page.tsx:87   [bills.create]

src/app/api/bank-statements/route.ts:296   (call B)
  claude-haiku-4-5-20251001 · max_tokens 16384 · raw fetch
  Transactions + vendors + pending bills -> match / category / confidence / flag
  same request as call A                               [bills.create]
```
