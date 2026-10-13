# Bank accounts as data, a weekly reconciliation tile, and a suspense register for bank lines

Status: pending — written 12 Oct 2026; plan only, nothing built — waiting for the owner's answers to §1 (Q1–Q6 block the build).
Branch: **`feat/1210-bank-accounts-suspense`** — create it with exactly this name, off `main`.

Covers the owner's points 16 and 17 of the 8 Oct list (feature map
`docs/implementation/requiremnts/accounts-and-compliance-feature-map.md`, map R16 and R17) and
the 12 Oct decision D16 (bank work gets its own permission module). Every `file:line` in §2
was read from disk on 12 Oct 2026 on branch `fix/1210-push-integrations-same-db-check`.
Check rather than trust.

Words used throughout, explained once:

- **Bank statement** — the file the bank gives you: every money movement on one account over a
  period. One upload here is one `BankStatement` row; each movement on it is one
  `BankTransaction` row, called a **bank line** below.
- **Debit** — money leaving the account (we paid someone). **Credit** — money arriving (a
  customer paid, the card machine settled, Bajaj disbursed).
- **Reconciliation** — proving every bank line is explained by something in our books (a
  vendor payment, an expense, a day's settlement deposit), line by line.
- **Suspense** — a bank line nobody can explain yet. It is parked, someone is asked, and it is
  closed when the answer comes.
- **Narration** — the description the bank prints on a line ("NEFT-HDFC0001234-HERO CYCLES").
  Many suspense lines have none, or one that names nobody.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (8 Oct 2026)

> 16. Reconciling primary bank accounts every week (especially Tuesday ICICI reconciliation, along with HDFC Hub, Centre HDFC, and Dhanlaxmi Bank).
> 17. Investigating bank credits/debits without narrations or bills; following up with the CEO and external accountant (Deekshith) to map suspense entries.

### 0.2 Restated as requirements

| # | Requirement | Source |
|---|---|---|
| R1 | The four bank accounts — **ICICI, HDFC Hub, HDFC Centre, Dhanlaxmi** — exist as **data**, not as names in code. An admin can add, rename or retire one without a deploy. | map R16 |
| R2 | Each account belongs to one **store** (`Store` row: Hub = `BCH_STORE`, Centre = `BCC_STORE`). | map R16, D1 |
| R3 | Every statement upload names its account, and every statement and every bank line carries it — so "HDFC Hub" and "HDFC Centre" can be told apart. | map R16 |
| R4 | Dhanlaxmi Bank statements can be uploaded and parsed like HDFC and ICICI. | map R16 |
| R5 | A weekly status, per account, on `/accounts`: **"reconciled up to <date>"**, the count of lines still unmatched and the count in suspense, shown **red when older than 7 days**. No reminder and no scheduler. | map R16, D17 |
| R6 | A bank line — debit **or** credit — that nobody can explain can be **parked in suspense** with a reason. | map R17 |
| R7 | A parked line has an **owner to chase it**: a staff user, or a typed name for someone outside the app (the external accountant Deekshith). | map R17, D19 |
| R8 | A parked line carries a **notes trail** — who wrote what, and when. | map R17, D19 |
| R9 | A parked line is **closed** with a resolved date, who closed it, and how it ended: recorded (as a payment, an expense or a settlement deposit), explained, or written off with a reason. | map R17, D19 |
| R10 | One **suspense list** across all accounts, filterable by open / closed, account and assignee. | map R17 |
| R11 | Bank statements and suspense lines get **their own permission module**, separate from `bills` — and nobody who uses the bank screens today loses them on the day the guards switch. | D16 |
| R12 | Fix finding **L3** (bulk "confirm payment" drops the bill link) before reconciliation is relied on. | map §3.2 R16 ("Fix L3 … before relying on it") |

---

## 1. Questions and clarifications — answer before build

### 1.1 Decisions on record

All answered in session, 12 Oct 2026. Quoted from the coordinator's record; only those that
bear on this plan.

| # | Decision | What it settles here |
|---|---|---|
| D1 | "Hub/Centre: link records to the existing `Store` table (rows BCH_STORE / BCC_STORE, each with its GSTIN) via a `storeId` foreign key. Do NOT add more "HUB"/"CENTRE" strings." | `BankAccount.storeId → Store`, required. No `"HUB"` string anywhere. |
| D2 | "ONE Zoho Books organisation for both stores (today's single IntegrationConfig row per provider is correct)." | One `zohoAccountId` per bank account is enough; no organisation column. |
| D5 | "Expenses tie to Store + department." | An expense created from a bank line takes the **account's** store (plan A owns the column — §3 dependencies). |
| D6 | "Expense payer: a staff user (FK to User) OR a typed name for outsiders." | Same "user or typed name" shape as the suspense assignee; one shared picker component (§3 D4). |
| D7 | "Expense categories: NO new categories — keep the existing eight." | The bank screen's expense choices stay mapped onto the existing eight. |
| D11 | "Vendor payment → Zoho by an explicit "Push to Zoho" button after save …" | Plan C pushes payments; it needs to know which bank account paid → `BankAccount.zohoAccountId`, added here, read by plan C. |
| D16 | "Bank statements and suspense lines get their own permission module, separate from `bills`." | Part A. |
| D17 | "Weekly reconciliation = a status tile on /accounts per bank account ("reconciled up to <date>", unmatched/suspense counts, red when older than 7 days). No reminder (no scheduler in this app)." | Part E. |
| D19 | "Suspense line assignee: a staff user or a typed name for outsiders (e.g. the external accountant Deekshith), plus a notes trail and resolved date." | Part D. |

### 1.2 Open questions

Every question changes what gets built. Each has a recommended default, so "defaults" is a
complete answer. **Q1–Q6 block the build**; the rest can be answered while it is underway.

| # | Question | Why it changes the build | Options | Recommended default | **Answer** |
|---|---|---|---|---|---|
| **Q1** (blocks) | **How do we switch the bank screens from `bills` to the new module without anyone losing access?** | A guard that checks a permission no role holds yet refuses everyone except ADMIN (ADMIN passes anything — §2.4). The seeder grants ADMIN only; it cannot know the custom roles. | (a) **one release**: the seeder copies today's `bills` grants onto the new module the first time it creates it (§3 A2), and the owner runs `npm run db:seed:rbac` against the target **before** merging, after `migrate deploy` — so the grants exist before the new guards do; (b) same, but seed **after** the deploy as usual — a few minutes in which non-admin bank users get 403; (c) two releases — release 1 ships the module and the grant copy with the guards still on `bills`, release 2 switches the guards; (d) one release whose guards accept *either* module, removed in a later release | **(a)**. Zero window, one release, no "either" guard to forget to remove. Old code ignores the new permissions, so seeding early is harmless (§3 A5). | |
| **Q2** (blocks) | **What does each action of the new module allow, and who inherits what?** | It decides every guard in this plan and who gains or loses something on switch day. | Actions as defined in §3 A1: `view` (see statements, lines, suspense, the tile), `create` (upload a statement), `edit` (work the lines, park, assign, note, explain), `approve` (write a line off; manage the bank-account list). Inherited once: `bills.view` → `bank_recon.view`; `bills.create` → `bank_recon.view` + `create` + `edit`; `approve` to ADMIN only | As stated. Nobody gains or loses on switch day; write-off and the account list are new powers, so they start with ADMIN and are granted by hand on `/team/permissions`. | |
| **Q3** (blocks) | When a bank line is confirmed as a **new vendor payment**, should the person also need `bills.create`? As a **new expense**, also `expenses.create`? | Today `bills.create` alone lets a person create *expenses* from the bank screen without any expenses grant. With a separate bank module, a person given only bank access could create vendor payments and expenses through the back door. | (a) yes — two checks each (`bank_recon.edit` + the record's own module); (b) no — `bank_recon.edit` is enough | **(a)**. Every role that inherits `bank_recon.edit` already holds `bills.create`, so payments are unaffected; the §4 pre-flight query lists any role holding `bills.create` but **not** `expenses.create` — those would lose "confirm as expense" and are named before the switch. | |
| **Q4** (blocks) | **What exactly is "reconciled up to <date>"?** | It is the number on the tile (D17). Defined loosely it turns green when a week was never uploaded, or when a line was skipped by the parser. | Definition in §3 E1. Two inputs it needs: (i) the uploader **types the statement period** (from / to) on every upload — the dates the bank printed — so a missing week is visible; (ii) an optional per-account **"reconcile from" date** so lines from before the team started are not counted forever | Both. The period is two date fields on the upload form; every parsed line must fall inside it (which also catches a day/month mix-up by the parser). | |
| **Q5** (blocks) | **How can a suspense line end?** | It is the enum in the schema and the buttons on the screen. | (a) three outcomes: **Recorded** (set by the app when the line is confirmed as a payment or expense, linked to one, or matched in a daily settlement), **Explained** (a person writes what it was — e.g. "own transfer ICICI → HDFC Hub", "customer receipt, booked in Zoho by Deekshith"; needs `edit`), **Written off** (nobody can explain it; reason required; needs `approve`). Explained and written-off lines can be reopened with a note. (b) only Recorded and Written off | **(a)**. Most suspense lines turn out to be things this app does not record (customer receipts, inter-account transfers, bank charges); without "Explained" they would all have to be "written off", which says the wrong thing. | |
| **Q6** (blocks) | When a new upload **overlaps** a period already uploaded for the same account, skip the lines already there? | Weekly downloads overlap at the edges. Today every overlapping line is stored twice and can be confirmed twice — two vendor payments for one bank debit (§2.7 D9). Needs two columns and a unique index (§3 B1). | (a) yes — each line gets a fingerprint (date, debit/credit, amount, running balance; reference when there is no balance); a line already on file for that account is skipped and counted; a file that is entirely duplicates is refused; (b) no | **(a)** | |
| Q7 | Statements uploaded **before** accounts existed carry only `"HDFC"` or `"ICICI"`. What happens to them? | HDFC Hub vs HDFC Centre cannot be inferred. | (a) leave them unassigned; `/accounts/bank-upload` lists them under "Assign an account" — an ICICI file pre-selects the only ICICI account, an HDFC file must be chosen by hand; (b) a script guesses; (c) leave them forever | **(a)**. Unassigned statements are not counted by the tile. | |
| Q8 | Who may add, rename, retire a bank account or set its Zoho id? | One more guard. | (a) `bank_recon.approve`; (b) `settings.edit`; (c) `stores.edit` | **(a)** | |
| Q9 | **L3 fix — bulk "Record N payments"**: the person picks one vendor for many lines, and no bill. Which bill does each payment pay? | Today: none (`billId: null`) — the bills stay unpaid. | (a) each line uses its **own** AI-suggested bill when that bill belongs to the chosen vendor and its balance covers the line; otherwise it is recorded as an advance — and the result says how many of each; (b) refuse bulk payment confirmation; (c) keep advances, say so on screen | **(a)** | |
| Q10 | Has bulk confirm **already** produced payments with no bill, and expenses the bank line forgot? | Decides whether L3 needs a data repair as well as the code fix. | Run the §4 step 0 read-only queries on a fresh restore of production; repair, if any, is per row by a person (which bill a payment belonged to is a judgement, not a query) | Run the queries; no automatic re-linking. | |
| Q11 | Build Part F — **link a bank line to a payment or expense already recorded** (e.g. entered on `/payments/new`)? | Without it, a payment recorded on `/payments/new` and later seen on the statement can only be recorded a second time or skipped (§2.7 D12). | yes / no | **yes** — it is how a debit gets reconciled without a duplicate. | |
| Q12 | An expense created from a bank line is later **deleted** on `/expenses`. What happens to the line? | Today it stays "reconciled" against an expense that no longer exists (§2.7 D11). | (a) the line returns to "to review" (or to suspense, if it came from there); (b) refuse the delete and say "undo it on the bank screen" | **(a)** | |
| Q13 | Should **Skip** require a reason? | A skipped line counts as reconciled. With no reason, a line can turn the tile green with nothing explaining it. | (a) no — Skip stays one tap for bank charges and the like; the activity log records who skipped (§3 C1); (b) yes, a short reason | **(a)**, recorded in §5. A parked line cannot be skipped — it closes only through Q5's outcomes. | |
| Q14 | Give the new module a **sidebar entry** ("Bank Reconciliation" → `/accounts/bank-upload`)? | One catalog field. | yes / no (reachable only from `/accounts`) | **yes** | |

**Data needed from the owner, not decisions** (the build does not wait for these):

1. For each of the four accounts: which store it belongs to (ICICI and Dhanlaxmi are not named
   Hub or Centre in the owner's list), the last four digits of the account number, and — if
   known — its Zoho Books bank account id.
2. One real Dhanlaxmi Bank statement, amounts redacted if wished, to write its parser hints
   from (§3 B4). Until then Dhanlaxmi gets generic hints.

---

## 2. How it works today — verified against the code

### 2.1 The flow, end to end

1. `/accounts` (`src/app/(dashboard)/accounts/page.tsx`) shows a **Bank Statement** quick link
   to everyone holding `accounts.view` (`:68-70`, `:122`).
2. `/accounts/bank-upload` (`src/app/(dashboard)/accounts/bank-upload/page.tsx`): two chips,
   **HDFC** and **ICICI**, hard-coded (`:134-146`, the array at `:135`; default `"HDFC"` at
   `:52`; helper text "CSV or XLS from HDFC / ICICI" at `:130`). The file is POSTed with raw
   `fetch(...).then(r => r.json())` (`:87-88`); the list of past uploads the same way, errors
   swallowed (`:59-66`).
3. `POST /api/bank-statements` (`src/app/api/bank-statements/route.ts`):
   - guard `requireFeature("bills", "create")` (`:34`); `bank` from the form, default `"HDFC"`
     (`:39`); `uploadedById` falls back to `""` if the session has no id (`:35`);
   - a debug log prints the first 200 characters of the file (`:63-70`);
   - bank-specific hints for ICICI and HDFC, generic text for anything else (`:73-77`) —
     **no Dhanlaxmi**;
   - **`text.slice(0, 50000)`** (`:109`) — anything past 50,000 characters never reaches the
     parser and nothing says so (finding F1 in `docs/ai-usage-audit.md:17`, still OPEN);
   - AI call A parses rows; the statement and all its lines are created in one nested create
     (`:193-215`) with `bank` as a string — `accountNumber` is never written;
   - AI call B suggests a vendor, bill and category per line and **writes the suggestion into
     `matchStatus`**: `FLAGGED` when the model gave a reason (`:304-307`), `MATCHED` when it
     named a vendor or an expense category (`:308-311`) — with `processedAt` left null.
     `matchedCount` / `flaggedCount` on the statement are these AI counts (`:339-342`);
   - the outer `catch` returns without logging (`:352-355`); so does `GET`'s (`:24-27`).
4. `/accounts/reconcile/[id]` (`src/app/(dashboard)/accounts/reconcile/[id]/page.tsx`, 615
   lines): filters All / Pending (= `UNMATCHED` only) / Matched / Flagged / Expenses / Ignored
   (`:56-63`); the "To Review" card counts `UNMATCHED` only (`:212`, `:436`). Actions —
   Confirm, Vendor, Expense, Skip — render only for `!isProcessed && isDebit` (`:339`); the
   bulk checkbox is debit-only too (`:287`). **Credit lines have no action at all.** There is
   **no Flag button**. The vendor picker loads `/api/vendors?limit=500` and the bill picker
   `/api/bills?status=PENDING&limit=500` (`:152-160`) — `PARTIALLY_PAID` and `OVERDUE` bills
   are never offered. Every call is raw `fetch().then(r => r.json())` (`:143-147`, `:165-169`,
   `:182-186`); `handleAction` ignores `success: false`, so a refused action shows nothing
   (`:170-174`).
5. `POST /api/bank-statements/[id]/review` (`src/app/api/bank-statements/[id]/review/route.ts`),
   guard `bills.create` (`:43`), body unvalidated (`:47-55`):

   | Action | Single line | Bulk (`txnIds`, `:62-113`) |
   |---|---|---|
   | `confirm_payment` | one `$transaction` with a remaining-balance guard; updates the bill (`:137-188`) | **`billId: null`** (`:99`) — finding **L3**; no transaction, no guard |
   | `confirm_expense` | expense, then line update — no transaction (`:200-235`) | **never writes `confirmedExpenseId`** (`:91-94`) — the line forgets which expense it became |
   | `ignore` | `IGNORED` + `processedAt` (`:237-243`) | same (`:70-75`) |
   | `flag` | `FLAGGED` + `flagReason` + `processedAt` (`:245-251`) — no screen calls it | — |

   The single path looks the line up with **no "already processed" check** (`:117-119`), and
   neither path checks debit vs credit. The `catch` does not log (`:254-257`).

### 2.2 The data

- `BankStatement` — `prisma/schema.prisma:1404-1423`: `bank String // HDFC, ICICI`,
  `accountNumber String?` (never written), `fromDate`/`toDate` (min/max of the parsed line
  dates, `route.ts:188-190`), AI counts. No account, no store.
- `BankTransaction` — `:1425-1457`: `matchStatus` (`UNMATCHED | MATCHED | FLAGGED | EXPENSE |
  IGNORED`, enum at `:1396-1402`), `flagReason`, AI `suggested*` + `confidence`,
  `confirmedVendorId` (FK), `confirmedPaymentId` and `confirmedExpenseId` — **plain strings, no
  foreign key** (`:1447-1448`), `processedAt`. Indexes on `statementId`, `matchStatus`, `date`.
  `amount` is `Float` (an existing defect, `docs/schema-review.md` §4).
- What "processed" means today: `processedAt` set. `matchStatus` alone does not tell you —
  `MATCHED` can be an AI guess nobody confirmed.
- `Store` — `:248-298`, table `"Store"` (no `@@map`), rows `BCH_STORE` / `BCC_STORE`
  (`prisma/seed-stores.ts:34,43`). No bank relation.
- `SettlementMatch` — `:2605-2621`: `bankTxnId` FK to a bank line, `paymentMode` string.
- `LedgerGap` / `LedgerGapNote` — `:3300-3340`, `:3361-3372`: the brand ledger's claim and its
  progress log, the pattern R8 copies.

### 2.3 Who reads and writes bank lines — every caller

Found by grep for `bankStatement`, `bankTransaction`, `settlementMatch`, `bankTxn`,
`suggestedBankTxns`, `confirmedBankTxns` across `src/`:

| Caller | Guard | Touches bank lines how |
|---|---|---|
| `api/bank-statements/route.ts` GET / POST | `bills.view` (`:15`) / `bills.create` (`:34`) | lists statements; creates statements + lines; writes AI suggestions |
| `api/bank-statements/[id]/review/route.ts` GET / POST | `bills.view` (`:14`) / `bills.create` (`:43`) | reads lines; every human action |
| `api/pos/settlement/[id]/route.ts` GET | `pos.view` (`:12`) | lists **credit** lines ±1 day of the settlement with `matchStatus in [UNMATCHED, FLAGGED]` (`:37-45`) — not filtered by `processedAt` |
| `api/pos/settlement/[id]/match/route.ts` POST / DELETE | `pos.approve` (`:11`, `:91`) | POST sets `MATCHED` + `processedAt` with no check of the line's current state (`:28-29`, `:56-59`) — finding L13; DELETE resets `UNMATCHED`, `processedAt: null` (`:105-110`). No logger in the file. |
| `api/pos/settlement/route.ts` DELETE | `pos.delete` (`:107`) | resets every matched line to `UNMATCHED` (`:130-138`) |
| `api/pos/sessions/route.ts` POST `force` | `pos.create` (`:41`) | **deletes `SettlementMatch` rows without resetting their lines** (`:50-67`, delete at `:62`) |

**No bills, payments, credits or expenses route reads a bank line.** The relation fields
`VendorBill.suggestedBankTxns` (`:1313`) and `Vendor.suggestedBankTxns` /
`confirmedBankTxns` (`:1134-1135`) have no reader in `src/`. The settlement screens read bank
lines under their own `pos` guard and never call the bank-statement routes, so switching those
routes to a new module cannot reach them. (The settlement *pages* gate cosmetically on
`canView("bills")` — `accounts/settlement/page.tsx:48`, `settlement/[id]/page.tsx:116` — while
their APIs use `pos`; that is plan E's screen and is left to it.)

The reconcile screen does call two other modules: `/api/vendors` (`vendors.view`,
`api/vendors/route.ts:11`) and `/api/bills` (`bills.view`, `api/bills/route.ts:12`) for its
pickers. A person without those grants gets an empty picker today, silently.

### 2.4 RBAC mechanics that decide the switch

- **F9 confirmed:** the four bank-statement handlers check `bills` (`view` / `create`), above.
- `bills` is `route: null`, `actions: view, create, edit, delete, approve`
  (`prisma/rbac-catalog.ts:483-508`). `accounts` is the read-only hub, `view` only
  (`:462-482`). The Accounts band is 290–399 (`:62-70`); taken: 290 `accounts`, 300 `bills`,
  310 `expenses`, 315 `pos`, 330 `cost_price`, 340 `brand_ledger`, 350 `brand_ledger_gaps`.
  **320 is free.**
- The seeder (`prisma/seed-rbac.ts`) upserts modules and permissions (`:165-175`), deletes any
  not in the catalog (`:142-158`, `:177-180`), grants **ADMIN** every permission (`:194-213`),
  and creates default roles only if missing (`:215-262`) — and `ROLE_CATALOG` is empty by the
  owner's decision (`rbac-catalog.ts:1009-1031`). **So the seeder cannot give a new module to
  any custom role.** Roles are made at runtime on `/team/permissions`.
- **Surprise: ADMIN passes every check regardless of grants.** `userCan` returns `true` when
  `access.roleKey === "ADMIN"` (`src/lib/rbac.ts:258`, added in `fd75434`, 12 Sep 2026, inside
  a feature commit), and the client store does the same (`src/stores/permissions.ts:174-205`).
  This contradicts CLAUDE.md rules 1–2 and `requireFeature`'s own comment ("no superuser
  short-circuit", `src/lib/auth-helpers.ts:130-136`). Consequences for this plan: (1) ADMIN
  never sees the switch-day 403, so **testing as ADMIN proves nothing** — §4 tests as a custom
  role; (2) it is not fixed here (§5).
- `/api/stores` is `requireAuth` only, deliberately, so store pickers work for everyone
  (`api/stores/route.ts:16-35`). `/api/users` needs `team.view` (`api/users/route.ts:13`) —
  unusable as an assignee list for bank staff.
- Module icons resolve through an explicit map (`src/lib/module-icons.ts:52`); a new icon name
  needs one line there.

### 2.5 The accounts hub and the patterns to copy

- `/accounts` reads `/api/accounts/summary` under `accounts.view` (`api/accounts/summary/route.ts:13`)
  with `apiFetch` and an error banner (`page.tsx:76-96`). Nothing about bank status.
- **Notes trail:** `POST /api/ledger/gaps/[id]/notes` (`src/app/api/ledger/gaps/[id]/notes/route.ts:15-35`)
  — zod `ledgerNoteWriteSchema` (`src/lib/validations.ts:342-344`), author from the session,
  `failure()` in the catch. **Closing needs `approve`, not `edit`**: `gaps/[id]/route.ts:22-46`
  refuses with a sentence and appends a "Marked resolved" note inside the same transaction.
- **IST calendar day:** `businessDate()` and `fromDateColumn()` in `src/lib/analytics/time.ts:34,65`.
- **A transaction-taking helper in `src/lib`** has precedent: `setWarehouseQty(tx, …)`,
  `src/lib/stock-location.ts:325`; `logActivity(tx, …)`, `src/lib/activity-log.ts:76`.
- **Activity feed** maps module keys to a category (`api/activity/route.ts:208-218`); an
  unmapped module still renders, with a warning.
- **The deterministic matcher** the ledger doc wants for banks: `matchEntries` in
  `src/lib/brand-ledger/reconcile.ts:183` — exact reference first, then same amount and nearest
  date within 30 days; pure, no I/O.

### 2.6 What the ledger doc said, re-checked today

`docs/ledger-and-reconciliation-flow.md` §8.1 lists **L3 OPEN** at `review/route.ts:99` — still
true today, same line. **L4** (bank reconciliation ignores `reconcile.ts`) — still true. **L9**
(no stored statement file) — still true. **L13** (settlement marks a line matched with no
payment behind it) — still true, by design: a settlement deposit is not a vendor payment.

### 2.7 Live defects found while mapping

All in code this plan touches; each is fixed where it sits (§3 names the step).

| # | Defect | Where | Effect | Fixed in |
|---|---|---|---|---|
| D1 | **L3** — bulk "Record N payments" writes `billId: null`; no transaction, no balance guard | `review/route.ts:96-110` | bills paid by bulk confirm still show unpaid | C2 |
| D2 | Bulk expense never stamps `confirmedExpenseId`; no transaction | `review/route.ts:76-95` | the line cannot say which expense it became | C2 |
| D3 | Single confirm has no "already processed" check | `review/route.ts:117-119` | a double tap, or two people, record **two** payments for one bank debit | C2 |
| D4 | Payment / expense can be confirmed on a **credit** line through the API | `review/route.ts:62-113, :122, :200` | money received booked as money paid | C2 |
| D5 | AI suggestions are written into `matchStatus` | `route.ts:304-311` | the "Pending" filter and "To Review" count miss every AI-suggested line (`page.tsx:212, :436`); "156 matched" on the upload list is the AI's guess, not progress (`bank-upload/page.tsx:308`); a credit the AI "matched" disappears from settlement matching (`pos/settlement/[id]/route.ts:41`) | B4, C1 |
| D6 | Credit lines have no action on the reconcile screen | `reconcile/[id]/page.tsx:287, :339` | a credit that is not a settlement deposit can never be closed — the tile could never pass it | C3 |
| D7 | No way to park a line: `flag` exists in the API but no button calls it | `review/route.ts:245-251` | R6 impossible today | D2 |
| D8 | **F1** — silent truncation at 50,000 characters | `route.ts:109` | lines dropped without a word; the tile would call the statement reconciled | B4 |
| D9 | Overlapping uploads store every shared line twice | `route.ts:193-215` | the same debit can be confirmed as two payments | B4 |
| D10 | Sessions force re-pull deletes settlement matches without releasing their lines | `pos/sessions/route.ts:50-67` | lines stay `MATCHED` with nothing behind them, invisible to every queue | plan E (its DF4); D5 if this plan lands first |
| D11 | Deleting an expense leaves its bank line "recorded" against nothing | `api/expenses/[id]/route.ts:59-76`; `confirmedExpenseId` has no FK | a reconciled line whose record is gone | D5 |
| D12 | A payment already recorded (e.g. on `/payments/new`) cannot be linked to its bank line | `review/route.ts:51` — only create actions exist | recorded twice, or skipped with nothing linking them | F |
| D13 | Bill picker offers `PENDING` bills only | `reconcile/[id]/page.tsx:155` | a part-paid or overdue bill cannot be chosen; its next instalment becomes an "advance" | C3 |
| D14 | Raw `fetch().then(r => r.json())`, swallowed errors, a refused action shows nothing | `bank-upload/page.tsx:59-66, :87-88`; `reconcile/[id]/page.tsx:143-186` | CLAUDE.md non-negotiable | B5, C3 |
| D15 | Catches that do not log; no logger at all in the settlement match route | `route.ts:24-27, :352-355`; `review/route.ts:33-36, :254-257`; `pos/settlement/[id]/match/route.ts` | CLAUDE.md non-negotiable | B4, C2, D5 |
| D16 | The upload's debug log prints the statement's first 200 characters | `route.ts:63-70` | the header carries the account holder's name and full account number | B4 |

Noticed, **not** touched (not this plan's code): `pos/settlement/route.ts:107` requires
`pos.delete`, an action the `pos` module never declares (`rbac-catalog.ts:272`), so only ADMIN
can delete a settlement; expense `PUT` can change the amount of an expense confirmed from a bank
line (`api/expenses/[id]/route.ts:30-56`).

---

## 3. Implementation plan

Six parts, one branch, one commit per part, **one migration**, **one catalog change**. No cron,
no timer, no polling, no Zoho call, no JWT change. Every new route carries
`export const dynamic = "force-dynamic"`, zod at the boundary, `requireFeature(module, action)`
with exactly two arguments, and `failure()` in its catch.

### Part A — the `bank_recon` permission module (R11, D16)

#### A1 — catalog entry

`prisma/rbac-catalog.ts`, after `expenses` (`:514-522`):

```ts
{
  // Bank statements, bank lines and the suspense register (plan 1210-bank-accounts-and-suspense,
  // D16, owner 12 Oct 2026). These screens were guarded by `bills` until now.
  //   view    = statements, lines, the suspense list and its notes, the weekly status tile
  //   create  = upload a statement (runs the AI parse, which costs money)
  //   edit    = work the lines: confirm / link / skip, park in suspense, assign, add notes,
  //             mark explained, assign an account to an old statement
  //   approve = write a suspense line off; add, edit or retire a bank account
  // ⚠ RUN npm run db:seed:rbac — BEFORE the merge deploys (plan §3 A5)
  key: "bank_recon",
  label: "Bank Reconciliation",
  description: "Bank accounts, statements, line matching and the suspense register",
  icon: "Landmark",
  route: "/accounts/bank-upload",            // Q14; null to keep it out of the sidebar
  group: "Accounts",
  sortOrder: 320,
  actions: ["view", "create", "edit", "approve"],
  inheritGrantsFrom: {                       // Q2 — applied ONCE, when the permission is first created
    view: ["bills.view", "bills.create"],
    create: ["bills.create"],
    edit: ["bills.create"],
  },
},
```

`src/lib/module-icons.ts`: import `Landmark` and add it to `ICONS` (`:52`).

#### A2 — the seeder copies today's grants, once

The mapping lives in the catalog as **permission keys**, never role names (CLAUDE.md rule 1).

- `ModuleSeed` (`rbac-catalog.ts:25-60`) gains
  `inheritGrantsFrom?: Partial<Record<ActionKey, string[]>>`, documented: *"When
  `<module>.<action>` is created by a seed run, every non-system role already holding any of the
  listed permissions is granted it in the same run. Never re-applied once the permission exists,
  so an admin's later revocation is never undone."*
- `prisma/seed-rbac.ts`, step 2 (`:165-175`): read the set of existing permission keys **before**
  the upsert loop. After it, for each catalog module with `inheritGrantsFrom`, for each action
  whose key was **not** in that set: find roles with `isSystem: false` holding any source key
  (`rolePermission.findMany` joined to `permission.key in …`), skip if the module is
  `assignable: false`, then `rolePermission.createMany({ skipDuplicates: true })`. Print one
  line per grant — `bank_recon.edit ← bills.create : ACCOUNTS, MANAGER (2 roles)` — so the
  owner sees exactly who got what.

Idempotent: a second run finds the permission existing and copies nothing.

#### A3 — the guard switch, every call site

| File | Today | Becomes |
|---|---|---|
| `api/bank-statements/route.ts` GET (`:15`) | `bills.view` | `bank_recon.view` |
| `api/bank-statements/route.ts` POST (`:34`) | `bills.create` | `bank_recon.create` |
| `api/bank-statements/[id]/review/route.ts` GET (`:14`) | `bills.view` | `bank_recon.view` |
| `api/bank-statements/[id]/review/route.ts` POST (`:43`) | `bills.create` | `bank_recon.edit` **+** `userCan(user.id, "bills", "create")` for a new payment, `userCan(user.id, "expenses", "create")` for a new expense (Q3), 403 with a sentence otherwise |
| every new route in Parts B–F | — | `bank_recon.*` as listed per route |

**Not switched, on purpose:** the four `pos` routes in §2.3 stay on `pos` — they read bank lines
as the input to a settlement, and putting `bank_recon` on them would 403 the settlement screen
for every role that holds `pos` but not bank access. `bills`, `payments`, `credits`, `expenses`
routes are untouched.

**Screens (cosmetic — the API re-checks):** `/accounts/bank-upload`, `/accounts/reconcile/[id]`,
`/accounts/suspense`, `/accounts/bank-accounts` use `canView / canCreate / canEdit /
canApprove("bank_recon")` from `usePermissions()` to show or hide actions; the hub's Bank
Statement link and the tile show only with `canView("bank_recon")`. No role name anywhere.

#### A4 — RBAC re-seed note

Data, not a migration. `npm run db:seed:rbac` after the catalog change; it creates four
permissions, grants ADMIN all four, and runs A2. Nothing is removed from the catalog, so the
seeder's cascade delete (§2.4) never fires.

#### A5 — release sequence (Q1 = a)

1. Rebase the branch on the current `main` — the seeder deletes any module not in the branch's
   catalog, so seeding from a stale branch would delete modules added on `main` since.
2. `npm run db:snapshot` (rule 9).
3. Against the target: `npx prisma migrate status`, then `npx prisma migrate deploy` (rule 4).
4. Against the target: `npm run db:seed:rbac` from the branch. Read the inherited-grant lines.
   The **old** code still checks `bills` and ignores `bank_recon`; the sidebar may already show
   "Bank Reconciliation" to holders, linking to the existing upload page, which works.
5. Merge → deploy. The new guards find every grant already in place.
6. On `/team/permissions`, grant `bank_recon.approve` to whoever should write off and manage
   accounts.

### Part B — bank accounts as data, and the upload that uses them (R1–R4)

#### B1 — schema and the one migration

```prisma
/// Which bank an account is at. Chooses the parser hints (src/lib/bank-recon/parse-hints.ts).
/// OTHER = generic hints. A new bank is one value here and one hint entry.
enum BankCode {
  ICICI
  HDFC
  DHANLAXMI
  OTHER
}

/// How a suspense line was closed (Q5). RECORDED is set by the app, never chosen by a person:
/// the line was confirmed as a payment or expense, linked to one, or matched in a settlement.
enum SuspenseResolution {
  RECORDED
  EXPLAINED
  WRITTEN_OFF
}

/// One real bank account (R1). The owner's four are rows, not strings in code.
model BankAccount {
  id            String    @id @default(cuid())
  name          String    @unique   // the owner's own names: "ICICI", "HDFC Hub", "HDFC Centre", "Dhanlaxmi"
  bank          BankCode
  accountLast4  String              // last four digits only — enough to tell two HDFC accounts apart
  storeId       String              // D1 — required: an account belongs to one legal entity
  store         Store     @relation(fields: [storeId], references: [id], onDelete: Restrict)
  zohoAccountId String?   @unique   // Zoho Books bank `account_id`; plan C sends it as paid_through_account_id
  reconcileFrom DateTime? @db.Date  // Q4 — the weekly tile ignores lines dated before this
  isActive      Boolean   @default(true)
  sortOrder     Int       @default(0)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  statements   BankStatement[]
  transactions BankTransaction[]

  @@map("bank_accounts")
}
```

`Store` gains `bankAccounts BankAccount[]`. No index on `isActive`: four rows (the 0809 plan's
reasoning, §2.5 there).

`BankStatement` gains:

```prisma
  // null = uploaded before bank accounts existed (2 Sep–12 Oct 2026); a person assigns it (B5).
  bankAccountId String?
  bankAccount   BankAccount? @relation(fields: [bankAccountId], references: [id], onDelete: Restrict)
  @@index([bankAccountId, toDate])
```

and two comment changes, no type change: `bank` — "copy of the account's BankCode for rows
written after 12 Oct; the free strings HDFC / ICICI before"; `fromDate`/`toDate` — "the period
the uploader typed (Q4); on rows before this plan, the min/max of the parsed line dates";
`matchedCount`/`flaggedCount` — "AI suggestion counts at upload. NOT reconciliation progress,
which is computed live (B6)".

`BankTransaction` gains:

```prisma
  // Copy of statement.bankAccountId. Written by exactly two places, each inside the transaction
  // that writes the statement's: the upload (B4) and "assign account" (B5). Exists so the
  // duplicate guard below can be a unique index, and the tile (E1) reads one indexed column.
  bankAccountId      String?
  bankAccount        BankAccount? @relation(fields: [bankAccountId], references: [id], onDelete: Restrict)
  // Same bank line seen in an overlapping upload → same value (Q6). null before this plan.
  fingerprint        String?
  suspense           BankSuspense?
  // Part F: one recorded payment / expense explains at most one bank line.
  confirmedPaymentId String? @unique   // was plain String?
  confirmedExpenseId String? @unique   // was plain String?

  @@unique([bankAccountId, fingerprint])
  @@index([bankAccountId, date])
```

Suspense models (Part D's, in the same migration):

```prisma
/// A bank line parked because nobody can explain it yet (R6–R9). At most one per line — re-parking
/// a closed line reopens the same row, so its whole history stays in one notes trail.
model BankSuspense {
  id             String              @id @default(cuid())
  bankTxnId      String              @unique
  bankTxn        BankTransaction     @relation(fields: [bankTxnId], references: [id], onDelete: Cascade)
  reason         String              // why it was parked
  // D19 — who is chasing it: a staff user OR a typed outsider name (zod allows one, the other, or neither)
  assigneeId     String?
  assignee       User?               @relation("BankSuspenseAssignee", fields: [assigneeId], references: [id], onDelete: SetNull)
  assigneeName   String?             // "Deekshith (external accountant)"
  parkedById     String
  parkedBy       User                @relation("BankSuspenseParkedBy", fields: [parkedById], references: [id])
  parkedAt       DateTime            @default(now())
  resolvedAt     DateTime?           // null = open
  resolvedById   String?
  resolvedBy     User?               @relation("BankSuspenseResolvedBy", fields: [resolvedById], references: [id])
  resolution     SuspenseResolution?
  resolutionNote String?             // required for EXPLAINED and WRITTEN_OFF
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  notes BankSuspenseNote[]

  @@index([resolvedAt, parkedAt])    // the open list, oldest first
  @@index([assigneeId, resolvedAt])  // "assigned to me"
  @@map("bank_suspense")
}

/// The chase history (R8). The LedgerGapNote pattern, plus isSystem for the lines the app writes.
model BankSuspenseNote {
  id         String       @id @default(cuid())
  suspenseId String
  suspense   BankSuspense @relation(fields: [suspenseId], references: [id], onDelete: Cascade)
  body       String
  isSystem   Boolean      @default(false) // "Parked: …", "Assigned to …", "Explained: …", "Reopened: …"
  authorId   String
  author     User         @relation("BankSuspenseNoteAuthor", fields: [authorId], references: [id])
  createdAt  DateTime     @default(now())

  @@index([suspenseId, createdAt])
  @@map("bank_suspense_notes")
}
```

`User` gains the four back-relations. **No new money column** — amounts stay on the bank line.

**Migration** — `npm run db:migrate -- --name bank_accounts_and_suspense` on localhost only
(the script asserts localhost). Expected SQL, which the builder reads before committing:

```sql
CREATE TYPE "BankCode" AS ENUM ('ICICI', 'HDFC', 'DHANLAXMI', 'OTHER');
CREATE TYPE "SuspenseResolution" AS ENUM ('RECORDED', 'EXPLAINED', 'WRITTEN_OFF');
CREATE TABLE "bank_accounts" (…);  CREATE TABLE "bank_suspense" (…);  CREATE TABLE "bank_suspense_notes" (…);
ALTER TABLE "BankStatement"   ADD COLUMN "bankAccountId" TEXT;                              -- populated table, nullable: metadata-only
ALTER TABLE "BankTransaction" ADD COLUMN "bankAccountId" TEXT, ADD COLUMN "fingerprint" TEXT; -- same
CREATE UNIQUE INDEX … ON "BankTransaction"("bankAccountId", "fingerprint");  -- all NULL today: Postgres treats NULLs as distinct
CREATE UNIQUE INDEX … ON "BankTransaction"("confirmedPaymentId");            -- §4 step 0 proves no duplicates first
CREATE UNIQUE INDEX … ON "BankTransaction"("confirmedExpenseId");
CREATE INDEX … ("bankAccountId", "date");  CREATE INDEX … ("bankAccountId", "toDate");  + the suspense indexes and FKs

-- ── HAND-ADDED, data. Read before committing. ──
-- 1. AI suggestions stop living in matchStatus (C1). An unprocessed line was never decided by a
--    person, so its MATCHED / FLAGGED is a guess; flagReason and suggested* are kept.
UPDATE "BankTransaction" SET "matchStatus" = 'UNMATCHED'
 WHERE "processedAt" IS NULL AND "matchStatus" IN ('MATCHED', 'FLAGGED');
-- 2. A line flagged by a person before suspense existed gets its case, so "FLAGGED and processed
--    ⇔ an open suspense case" holds from the first day. Expected 0 rows — no screen ever called flag.
INSERT INTO "bank_suspense" ("id", "bankTxnId", "reason", "parkedById", "parkedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."id", COALESCE(t."flagReason", 'Flagged before suspense tracking existed'),
       s."uploadedById", t."processedAt", now(), now()
  FROM "BankTransaction" t JOIN "BankStatement" s ON s."id" = t."statementId"
 WHERE t."matchStatus" = 'FLAGGED' AND t."processedAt" IS NOT NULL;
```

CLAUDE.md migration rules: **3** — no `DROP`, no `ALTER COLUMN … TYPE`, no `SET NOT NULL`; the
two populated tables get nullable columns only. **7** — additive: the old code never reads the
new columns, and the data UPDATE only moves AI guesses from "Matched" to "Pending" on the old
screen, which is the truth. **4** — applied by hand before the code goes live (A5). **9** —
snapshot first. `bankAccountId` stays nullable for good: old HDFC statements may never be
assigned (Q7); zod makes it required for every new upload.

#### B2 — bank-account API

| Method, path | Guard | Body (zod, `src/lib/validations.ts`) | Does |
|---|---|---|---|
| `GET /api/bank-accounts` | `bank_recon.view` | `?includeInactive=1` | rows with `store { code, name }`; active only by default (the `api/vendors/route.ts:17` convention) |
| `POST /api/bank-accounts` | `bank_recon.approve` (Q8) | `bankAccountWriteSchema` | create; `P2002` on name or Zoho id → 409 "An account named HDFC Hub already exists" |
| `PATCH /api/bank-accounts/[id]` | `bank_recon.approve` | `bankAccountUpdateSchema` (partial + `isActive`) | edit / retire. No DELETE — an account with statements is Restrict; retire it |

```ts
export const bankAccountWriteSchema = z.object({
  name: z.string().trim().min(2, "Name the account, e.g. HDFC Hub").max(60),
  bank: z.enum(["ICICI", "HDFC", "DHANLAXMI", "OTHER"]),
  accountLast4: z.string().regex(/^\d{4}$/, "The last 4 digits of the account number"),
  storeId: z.string().min(1, "Pick the store this account belongs to"),
  zohoAccountId: z.string().trim().max(40).nullable().optional(),
  reconcileFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date, YYYY-MM-DD").nullable().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});
```

The store must exist and be active (400 otherwise). `createLogger("bank-accounts")`.

#### B3 — `/accounts/bank-accounts` (new screen)

List of accounts as cards (name, bank, ••••1234, store, "reconcile from", Zoho id if set,
inactive dimmed with a badge — the `/team` pattern). An add / edit bottom sheet with the B2
fields; the store picker reads `/api/stores` (`requireAuth`, so it never empties). Add / edit /
retire buttons render only with `canApprove("bank_recon")`. Linked from the hub's quick links
and from the upload screen's account chips ("Manage accounts").

#### B4 — the upload

`POST /api/bank-statements` (multipart). Fields `file`, `bankAccountId`, `periodFrom`,
`periodTo`, parsed with `bankStatementUploadSchema` (both dates `YYYY-MM-DD`, `from ≤ to`, the
period at most 92 days).

1. `const user = await requireFeature("bank_recon", "create")` — `uploadedById: user.id`, no
   `""` fallback (§2.1).
2. Load the account; missing or retired → 400 "Pick an active bank account".
3. Read the file as today. **F1:** if the text is over 50,000 characters, refuse — 400 "This
   file is too long to read in one go (N characters). Download a shorter period — a week is
   ideal — and upload each part." `log.warn`. Nothing is silently cut.
4. Hints from `src/lib/bank-recon/parse-hints.ts` (new): the ICICI and HDFC text moved out of
   `route.ts:73-77` unchanged, plus **DHANLAXMI** — *"Dhanlaxmi Bank statements usually carry
   Date / Value Date, Particulars, Cheque or Reference No., Withdrawal (Dr), Deposit (Cr) and
   Balance, the balance sometimes suffixed Cr or Dr; dates DD-MM-YYYY or DD/MM/YYYY."* — written
   **without a sample** and marked so in the file; replaced from the owner's sample when it
   arrives. `OTHER` gets today's generic line. The prompt names the bank by the account's name.
5. AI call A, as today.
6. **Every parsed line must fall inside the typed period** — otherwise 400 "The file has a line
   dated 09/10/2026, outside the period you entered (01/10/2026 – 07/10/2026). Check the period,
   or the date format." This catches a wrong period and a day/month mix-up by the parser.
7. Fingerprint each line in file order (`src/lib/bank-recon/fingerprint.ts`, pure): with a
   running balance, `sha1(date | CREDIT/DEBIT | amount.toFixed(2) | balance.toFixed(2))`;
   without one, `sha1(date | type | amount | normalised reference)` plus `#n` for the n-th
   repeat inside the file, so two genuinely identical lines in one file both land.
8. One `$transaction`: create the statement (`bank: account.bank`, `bankAccountId`,
   `fromDate = periodFrom`, `toDate = periodTo`); `bankTransaction.createManyAndReturn({ data,
   skipDuplicates: true })` with `bankAccountId` and `fingerprint` on every line; if nothing was
   inserted, throw → **409** "Every line in this file is already uploaded for HDFC Hub. Nothing
   was imported."; set `txnCount` and the totals from the **inserted** lines.
9. AI call B, as today but on the inserted lines only, and it writes **suggestions only** —
   `suggestedVendorId`, `suggestedBillId`, `suggestedCategory`, `confidence`, and `flagReason`
   as an AI note. **`matchStatus` is never touched by the AI** (D5). `matchedCount` /
   `flaggedCount` keep receiving the AI counts, per the B1 comment.
10. Response `{ id, txnCount, duplicatesSkipped, suggested, aiFlagged, totalCredits, totalDebits }`.

The 200-character debug sample is removed (D16); the debug line keeps file size, bank code and
`bankAccountId`. Errors return through `errorResponse(msg, status, { diagnostics })` so the
existing diagnostics panel keeps working through `apiTry`'s `errorData`.

#### B5 — statements from before accounts existed (Q7)

`PATCH /api/bank-statements/[id]` — `bank_recon.edit`, body `{ bankAccountId }`.

- Allowed when the statement has no account. Changing an **assigned** statement needs
  `bank_recon.approve` (a mis-click between HDFC Hub and HDFC Centre must be correctable, by
  someone senior).
- The account's `bank` must equal the statement's `bank` string — an ICICI file cannot be put on
  an HDFC account (400 with the sentence).
- One transaction: the statement and **all its lines** get the `bankAccountId`. Old lines have no
  fingerprint, so no collision; a newer statement moved onto an account that already holds the
  same lines raises `P2002` → 409 "These lines are already on HDFC Centre".
- `log.info("statement assigned", { statementId, bankAccountId, lines })`.

#### B6 — `/accounts/bank-upload`

- Account chips from `GET /api/bank-accounts` (active, `sortOrder`), each "HDFC · Hub ••••1234";
  `?account=<id>` pre-selects (the tile links here). No accounts yet → an empty state linking to
  `/accounts/bank-accounts`.
- Two date inputs **Statement from / to** (required) above the file button; the button stays
  disabled until account and period are set.
- Success line: "Imported 214 lines to HDFC Hub. 12 were already uploaded and were skipped.
  The AI suggested a match for 156." 409 / 400 sentences render as they come.
- **Past uploads** from `GET /api/bank-statements?bankAccountId=&take=50`, which now returns the
  account and **live progress per statement** — two `groupBy`s on `BankTransaction`
  (by `statementId` where `processedAt` is null; by `statementId, matchStatus`) — shown as
  "180 done · 31 to review · 3 in suspense" instead of the AI's "matched".
- **"Assign an account"** section listing statements with no account, each with an account select
  (filtered to the statement's bank, pre-selected when exactly one matches) and an Assign
  button (B5).
- `apiTry` / `apiFetch` throughout (D14); `createLogger("accounts:bank-upload")`.

### Part C — working the lines (R3, R12, D1–D6, D13)

#### C1 — one state machine for a bank line

`src/lib/bank-recon/lines.ts` (new) is the **only** code that changes a line's state. Every
writer — the review route, the suspense routes, the three settlement routes, the expense delete
— calls it, so "FLAGGED ⇔ an open suspense case" cannot drift between modules (today two modules
write the column independently — L13).

| State | `matchStatus` | `processedAt` | Suspense case |
|---|---|---|---|
| To review | `UNMATCHED` (AI may have left suggestions and an AI note) | null | none, or closed |
| Recorded as a vendor payment | `MATCHED` + `confirmedPaymentId` | set | none, or closed RECORDED |
| Recorded as an expense | `EXPENSE` + `confirmedExpenseId` | set | none, or closed RECORDED |
| Matched in a daily settlement | `MATCHED` + a `SettlementMatch` (fully used, once plan E allows partial use; a partly used credit stays *to review*, or *in suspense*) | set | none, or closed RECORDED |
| Skipped | `IGNORED` | set | none |
| **In suspense** | `FLAGGED` | set | **open** |
| Suspense closed — explained / written off | `IGNORED` | set | closed EXPLAINED / WRITTEN_OFF |

Functions, each taking the transaction client:

- `claimLine(tx, txnId, data)` — `updateMany({ where: { id, OR: [{ processedAt: null }, {
  matchStatus: "FLAGGED" }] }, data: { …, processedAt: now } })`; a count of 0 throws a 409
  "This line was already handled — reload to see how". Under Postgres' row lock a second,
  simultaneous claim re-reads the row and finds nothing to claim. **This is the idempotency
  guard D3 lacks.**
- `closeCaseAsRecorded(tx, txnId, userId, sentence)` — if an open case exists, close it
  `RECORDED` with a system note ("Recorded as payment to Hero Cycles ₹48,200").
- `releaseLine(tx, txnId, userId, why)` — when the record behind a line goes away (settlement
  match removed, settlement deleted, sessions re-pulled, expense deleted): if the line's case
  was closed `RECORDED`, reopen it and set `FLAGGED` (it goes back to suspense, where it came
  from) with a system note; otherwise `UNMATCHED`, `processedAt: null`. Clears
  `confirmedExpenseId` / `confirmedPaymentId` as appropriate.

A transaction-taking helper in `src/lib` departs from `backend-engineer.md`'s "business logic in
the route"; it is named here and justified by the cross-module invariant, with
`stock-location.ts:325` as precedent.

#### C2 — `POST /api/bank-statements/[id]/review`

Body parsed with `bankReviewActionSchema`, a `z.discriminatedUnion("action", …)`:

| Action | Lines | Guard | What changes |
|---|---|---|---|
| `confirm_payment` `{ txnId \| txnIds (≤200), vendorId, billId? }` | **debit** only (400 otherwise — D4); to review or in suspense | `bank_recon.edit` + `bills.create` (Q3) | per line, one `$transaction`: `claimLine` → bill guard (the single path's existing `:137-175` logic) → `VendorPayment` → `confirmedPaymentId` → `closeCaseAsRecorded` |
| `confirm_expense` `{ txnId \| txnIds, category }` | debit only | `bank_recon.edit` + `expenses.create` (Q3) | per line, one `$transaction`; **always** stamps `confirmedExpenseId` (D2) |
| `link_payment` / `link_expense` `{ txnId, paymentId \| expenseId }` | debit only | `bank_recon.edit` | Part F |
| `ignore` `{ txnId \| txnIds }` | **to review only** — a parked line closes through Q5's outcomes | `bank_recon.edit` | `IGNORED` |
| `flag` `{ txnId, reason, assigneeId?, assigneeName? }` | debit or credit, to review | `bank_recon.edit` | Part D2 |

**L3, the bulk payment (Q9 = a):** each line in its own transaction; its bill is its **own**
`suggestedBillId` when that bill belongs to the chosen vendor and its remaining balance covers
the line (±₹0.01, the existing epsilon); otherwise `billId: null` (an advance). Response
`{ processed, againstBills, asAdvances, refused: [{ txnId, reason }] }`, rendered as "12
recorded — 9 against bills, 3 as advances. 1 refused: already handled." One line failing never
rolls back the others.

Every successful action writes `logActivity(tx, { module: "bank_recon", action, entityType:
"BankTransaction", entityId, entityRef: "<account> <date> ₹<amount>", userId, userName })` —
this is the "who skipped this?" trail Q13 relies on. `api/activity/route.ts:208-218` gains
`bank_recon: { category: "PAYMENT", label: "Bank" }`.

`GET` returns the statement with its account, each line's suspense case (reason, assignee,
note count) when it has one, and Part F's suggestions.

**Data already damaged (Q10).** The code fix does not repair old rows. §4 step 0 lists them;
a person decides per row.

**Overlap with plan A (its Part G, finding L5).** Plan A fixes the *expense* branches of this
same route — the "already processed" re-read, the transaction, `confirmedExpenseId` on bulk,
the debit check — and adds store and department to `confirm_expense`, leaving the guard and the
payment branch to this plan. That is this plan's D2 and the expense half of D3/D4. One
implementation, not two: **whichever plan lands second** replaces its own re-read with
`claimLine` (the same rule — `processedAt` null — plus a parked line) and keeps the other's
fields. Plan A's store pre-selection from the statement's bank account reads
`BankStatement.bankAccountId → BankAccount.storeId` from this plan.

#### C3 — `/accounts/reconcile/[id]`

Split the 615-line page (frontend red flag) into `page.tsx` (fetch, filters, list) and
`_components/`: `types.ts`, `txn-card.tsx`, `bulk-bar.tsx`, `park-sheet.tsx`,
`link-panel.tsx` — each under 300 lines.

- Filters: **To review** (`processedAt` null — every AI-suggested line included, with an "AI
  suggests Hero Cycles · 82%" chip and the AI note in amber), **Suspense**, **Recorded**,
  **Skipped**, **All**. The "To Review" card uses the same rule.
- **Credit lines get actions** (D6): *Park in suspense* and *Skip*, plus a line of help: "Card,
  UPI, finance and cash deposits are matched on Daily Settlement." Once plan E's allocation
  exists, a partly used credit shows "₹80,000 of ₹1,50,000 already matched in settlement" from
  its `remainingOn` helper — plan E asks for exactly this.
- Debit lines: Confirm (AI suggestion), Vendor, Expense, *Link to a recorded payment* (Part F),
  *Park in suspense*, Skip.
- The bill picker loads `/api/bills?vendorId=<id>&limit=100` **when a vendor is chosen** and
  keeps `PENDING`, `PARTIALLY_PAID` and `OVERDUE` (D13), instead of 500 `PENDING` bills up front.
  If `/api/vendors` or `/api/bills` answer 403, the picker says "You can see bank lines but not
  vendors/bills — ask an admin for Vendors view / Bills view", never an empty list.
- Every call through `apiTry`; a refused action shows the API's sentence in the existing error
  strip (D14). All buttons disabled while busy, min-height 44 px.
- `createLogger("accounts:reconcile")`.

### Part D — the suspense register (R6–R10)

#### D1 — rules

- Parking needs a reason (3–500 characters). The assignee is optional at park time, and is
  either `assigneeId` (an active user) **or** `assigneeName` (typed, ≤80 characters) — both
  given → 400.
- A parked line can still be **recorded** (confirmed or linked) from the reconcile screen; that
  closes the case `RECORDED` automatically.
- `EXPLAINED` needs `bank_recon.edit` and a note (5–500 characters). `WRITTEN_OFF` needs
  `bank_recon.approve` and a reason — refused otherwise with "Writing a bank line off needs
  approve permission on Bank Reconciliation — it is a financial decision, not a note" (the
  `ledger/gaps/[id]/route.ts:40-46` wording). Both set the line `IGNORED`.
- Reopening an `EXPLAINED` or `WRITTEN_OFF` case needs a note; the line goes back to `FLAGGED`.
  A `RECORDED` case cannot be reopened here — undo the record instead (§5).
- Every park, assign, resolve and reopen writes a system note **in the same transaction**.

#### D2 — routes

| Method, path | Guard | Body | Does |
|---|---|---|---|
| `POST /api/bank-statements/[id]/review` `action: "flag"` | `bank_recon.edit` | `{ txnId, reason, assigneeId?, assigneeName? }` | `claimLine` → `FLAGGED`; create the case, or **reopen** the line's existing one; system note "Parked: <reason>" |
| `GET /api/bank-suspense` | `bank_recon.view` | `?status=open\|closed\|all&bankAccountId=&assignee=me\|<userId>&page=` | the list: line date, amount, debit/credit, narration, account, reason, assignee, days parked, last note; open first, oldest first |
| `GET /api/bank-suspense/[id]` | `bank_recon.view` | — | the case, its line, the notes oldest first |
| `PATCH /api/bank-suspense/[id]` | `bank_recon.edit` (+ `approve` for `WRITTEN_OFF`) | `bankSuspenseUpdateSchema` = `{ assign: { assigneeId? , assigneeName? } }` \| `{ resolve: "EXPLAINED" \| "WRITTEN_OFF", note }` \| `{ reopen: true, note }` | as D1 |
| `POST /api/bank-suspense/[id]/notes` | `bank_recon.edit` | `{ text }` (1–1000) | add a note — the `ledger/gaps/[id]/notes` pattern |
| `GET /api/bank-suspense/assignees` | `bank_recon.edit` | — | active users `{ id, name }` only — `/api/users` needs `team.view` (§2.4) |

`createLogger("bank-suspense")`.

#### D3 — `/accounts/suspense` (new screen)

- Chips **Open** (default) / **Closed** / **All**; an account select; **Assigned to me**.
- Cards: amount (red debit, green credit), date, account, two lines of narration, reason,
  "Deekshith (outside)" or the user's name, "parked 9 days", the latest note.
- Tap → bottom sheet: the line, a link to it on its statement (`/accounts/reconcile/<statementId>?txn=<id>`),
  the notes trail, an add-note box, Reassign, **Mark explained**, **Write off** (only with
  `canApprove`), **Reopen** on a closed explained / written-off case.
- Loading skeleton, error banner, empty state ("Nothing in suspense"); 375 px first.
- Linked from the tile's suspense count, the hub's quick links, and the reconcile screen's
  Suspense filter. `createLogger("accounts:suspense")`.

#### D4 — the "staff user or a typed name" picker

`src/components/person-or-name-picker.tsx`: a searchable list of users (from
`/api/bank-suspense/assignees` here — the component takes the list as a prop) with a last
option **"Someone outside the team…"** that turns into a text field. Plan A needs the same shape
for the expense payer (D6): **whichever plan lands first creates the component; the other
reuses it** with its own user list.

#### D5 — hooks in the routes that release or claim lines

**The settlement files belong to plan E**, which rewrites them: one bank credit may be split
across several settlement lines and loans (its Q5, Part B3, `src/lib/settlement/bank-allocation.ts`
— `lockBankCredit`, `remainingOn`, `settleStatus`), its re-fetch fix restores bank lines (its
DF4 = this plan's D10), and its match refuses double use (its DF8). So a credit is **not**
consumed on its first match there; it becomes `MATCHED` only when fully used. The contract
between the two plans is therefore two calls, not a rewrite:

- whenever settlement moves a line **to** `MATCHED` (fully used), it also calls
  `closeCaseAsRecorded(tx, txnId, userId, "Matched in settlement 12 Oct, CARD")`;
- whenever it moves a line **off** `MATCHED` (a match removed, a settlement deleted, a day
  re-fetched), it calls `releaseLine(tx, txnId, userId, why)` instead of writing `UNMATCHED`
  itself — so a line that came out of suspense goes back to suspense with its case reopened.
  A partly used credit that was parked stays `FLAGGED`, as plan E's `settleStatus` already
  intends ("or the FLAGGED it had").

**If this plan lands before E**, the minimal version of the same contract goes into today's
code, and E's rewrite keeps the calls:

| File | Change |
|---|---|
| `api/pos/settlement/[id]/match/route.ts` POST | refuse a line already recorded, skipped or matched (409 — L13's double use) and `closeCaseAsRecorded`, inside the existing transaction; `createLogger("pos:settlement-match")` (D15) |
| same file, DELETE (`:105-110`) | `releaseLine` instead of the bare reset |
| `api/pos/settlement/route.ts` DELETE (`:130-138`) | `releaseLine` per match |
| `api/pos/sessions/route.ts` POST `force` (`:50-67`) | `releaseLine` for each match **before** `settlementMatch.deleteMany` (D10), in one transaction |

**Expenses** (plan A's file): `api/expenses/[id]/route.ts` DELETE (`:59-76`) — in one
transaction with the delete, find the line with `confirmedExpenseId = id` and `releaseLine` it
(D11, Q12 = a); `log.warn("expense behind a bank line deleted", { expenseId, bankTxnId })`.
Plan A does not touch this handler's bank side; whichever plan lands second keeps the call.

### Part E — the weekly status tile (R5, D17)

#### E1 — the definition (Q4)

For an active account, with `start = reconcileFrom` (or, when blank, the earliest period start
among its statements):

1. **Covered to** — walk its statements' periods (`fromDate`–`toDate`) in order from `start`. A
   period starting more than one day after the run so far ends is a **missing statement**; the
   run stops there. *Covered to* = the end of the unbroken run.
2. **First open line** — the earliest line dated on or after `start` that is still to review
   (`processedAt` null) **or** in suspense (`FLAGGED`).
3. **Reconciled up to** = the earlier of *covered to* and *the day before the first open line*.
   No statement at all → none.
4. **Red** when there is no date, or when today (IST, `businessDate()`) minus *reconciled up to*
   is **more than 7 days** — 8 days or more. Otherwise green.
5. **Unmatched** = lines on or after `start` with `processedAt` null. **In suspense** = open
   cases on the account's lines, whatever their date (a deliberate park is never filtered out).

A pure function, `src/lib/bank-recon/status.ts` → `computeStatus(periods, firstOpen, start,
today)`, so the rule lives in one place and the route only gathers inputs.

#### E2 — `GET /api/bank-accounts/status`

`bank_recon.view`. Per active account, in `Promise.all`: `bankStatement.findMany` (periods,
latest upload and uploader), `bankTransaction.count` (unmatched), `bankTransaction.aggregate
_min.date` (first open), `bankSuspense.count` (open, via the line's account). Four accounts →
16 small indexed queries (`[bankAccountId, date]`, `[bankAccountId, toDate]`) — no raw SQL.
Returns `{ today, accounts: [{ id, name, bank, accountLast4, store, reconciledUpTo,
daysBehind, stale, unmatched, suspense, coveredTo, missing: { from, to } | null, lastUpload }] }`.
`log.debug` with the account count and milliseconds.

#### E3 — the tile on `/accounts`

Under the summary cards, when `canView("bank_recon")`: a "Bank reconciliation" section, one card
per account (one column on a phone, two from `sm`):

```
HDFC · Hub  ••••1234                                   ● red
Reconciled up to Sat 4 Oct (8 days ago)
12 unmatched · 3 in suspense
Missing statement 8 Oct – 14 Oct
[ Upload ]   [ Review ]
```

*Upload* → `/accounts/bank-upload?account=<id>`; the suspense count → `/accounts/suspense?account=<id>`.
Its own `apiTry`, skeleton and error line — a failing tile never blanks the hub. Quick links
gain **Bank accounts** and **Suspense**; **Bank Statement** shows only with
`canView("bank_recon")`. Nothing fires on a timer — the numbers load with the page (no cron, no
polling).

### Part F — link a bank line to a record that already exists (Q11, D12)

- **Suggestions on the statement.** `GET …/review` runs `matchEntries`
  (`src/lib/brand-ledger/reconcile.ts:183`, unchanged) twice — the statement's to-review debit
  lines against (1) vendor payments and (2) non-cash expenses dated within the statement period
  ±30 days and **not already linked** to another line. Each hit shows on the line as "Already
  recorded? Payment to Hero Cycles ₹48,200 on 3 Oct — UTR matches". Exact reference first, then
  amount and nearest date — the ledger doc's §9.2 step 1, for this use only.
- **`GET /api/bank-statements/[id]/candidates?txnId=`** (`bank_recon.edit`): for the manual
  picker, every unlinked payment and expense of the same amount (±₹0.01) within ±30 days,
  reference matches first, at most 10.
- **`link_payment` / `link_expense`** (C2): `claimLine` → the record's amount must equal the
  line's (±₹0.01) or 400 "₹48,200 on the bank, ₹48,000 recorded — not the same payment" →
  set `confirmedPaymentId` / `confirmedExpenseId` (and `confirmedVendorId`) → `MATCHED` /
  `EXPENSE` → `closeCaseAsRecorded`. Nothing is created and the bill is not touched — the
  payment already moved it when it was recorded. The unique index refuses a second line
  claiming the same record (→ 409).
- Confirm-as-new on a line that has an "Already recorded?" suggestion asks once: "This looks
  already recorded — link it instead?"

### Phases, dependencies, ownership

| Phase | Work | Depends on |
|---|---|---|
| 1 | A1–A2: catalog entry, `inheritGrantsFrom`, icon | Q1, Q2 |
| 2 | B1: schema + migration | Q4, Q5, Q6 |
| 3 | B2–B6: accounts API and screen, upload, assign, list | 2 |
| 4 | C1–C3: line state machine, review route, reconcile screen | 2, Q3, Q9 |
| 5 | D1–D5: suspense routes, screen, picker, settlement / expense hooks | 4 |
| 6 | E1–E3: status endpoint and tile | 3, 5 |
| 7 | F: link to an existing record | 4, Q11 |
| 8 | A3: guard switch, last, so every screen moves at once | 3–7 |

One commit per phase. Phases 3–7 can be parallel agents once 2 is in, with file ownership:
review route + reconcile screen (4, 7) to one agent; suspense (5) to another; upload and
accounts (3) to a third; the tile (6) last. Then `/code-review` across the branch.

**Sibling plans:**

| Plan | Relationship |
|---|---|
| A — expenses (`1210-expense-store-department-and-payer-plan.md`) | A's Part G adds store and department to `confirm_expense` (the store pre-selected from this plan's bank account) and fixes the same expense-branch defects as C2 — one implementation, merged as C2 says. A and D share `person-or-name-picker.tsx` (D4). D5's expense-delete hook sits in A's file. |
| B — payables (`1210-zoho-credit-notes-and-payables-plan.md`) | If B adds `storeId` to `VendorPayment`, `confirm_payment` stamps the account's store. B owns the column. |
| C — Zoho payment push (`1210-zoho-vendor-payment-push-and-bill-approval-plan.md`) | **C consumes `BankAccount.zohoAccountId`** as Zoho's `paid_through_account_id` (documented: [Zoho Books — Vendor Payments](https://www.zoho.com/books/api/v3/vendor-payments/), "ID of the cash/ bank account from which the payment is made"). C owns any `VendorPayment.bankAccountId` column and the account picker on `/payments/new`; once it exists, `confirm_payment` here stamps it from the statement's account — one line. A Zoho-backed picker for `zohoAccountId` (`GET /bankaccounts`, field `account_id`, [Zoho Books — Bank Accounts](https://www.zoho.com/books/api/v3/bank-accounts/)) is C's to add if wanted; this plan types the id. |
| E — settlement per store (`1210-settlement-per-store-and-receivables-plan.md`) | E filters a store's bank pickers to its own accounts through `BankTransaction.bankAccountId` → `BankAccount.storeId` (its "Sibling plans" note). E owns and rewrites the settlement routes (partial allocation, its DF4 = D10, DF8); the contract in D5 is two calls its `settleStatus` and re-fetch make. E's matches stay on `pos`, not `bank_recon` (its Q12, this plan's A3) — the two plans agree. |

### Logging

| Scope | Level · what |
|---|---|
| `bank-statements` (exists) | `debug` → AI calls (file size, bank code, `bankAccountId`, prompt chars); `info` "statement uploaded" `{ statementId, bankAccountId, inserted, duplicatesSkipped, suggested }`; `warn` refused uploads — too long, outside period, all duplicates — with `bankAccountId` and counts; `error` through `failure()` |
| `bank-statements:review` (exists) | `info` per action `{ statementId, txnIds, action, paymentId \| expenseId, againstBills, asAdvances }`; `warn` refusals — already handled, credit line, permission layer, bill balance; `error` via `failure()` |
| `bank-statements:assign` (new) | `info` `{ statementId, bankAccountId, lines }`; `warn` on bank mismatch or collision |
| `bank-accounts` (new) | `info` created / updated / retired `{ bankAccountId, fields }`; `warn` duplicate name |
| `bank-accounts:status` (new) | `debug` `{ accounts, ms }` |
| `bank-suspense` (new) | `info` parked / assigned / note added / resolved / reopened `{ suspenseId, bankTxnId, resolution }`; `warn` write-off refused without approve |
| `bank-recon:lines` (new, in `lines.ts`) | `debug` each claim / release `{ txnId, from, to }`; `warn` when a release reopens a suspense case |
| `pos:settlement-match` (new) | `info` matched / unmatched `{ settlementId, bankTxnId, paymentMode }`; `warn` line already handled |
| `expenses` (exists) | `warn` "expense behind a bank line deleted" `{ expenseId, bankTxnId }` |
| clients: `accounts:bank-upload`, `accounts:reconcile`, `accounts:suspense`, `accounts:bank-accounts`, `accounts:hub` | `error` on every failed call, with the API's sentence |
| `prisma/seed-rbac.ts` | the seeder's existing `console` style — one line per inherited grant |

**Never logged:** narrations, account numbers (beyond the stored last four), file contents, the
Zoho id is fine (not a secret). Identifiers and counts only. Every `catch` logs before it
returns.

### Board of agents — checked

- **accounting-consultant** — *"Payment received but not reconciled to an invoice (float
  risk)"*: R6–R10 make an unexplained line visible with an owner and an age instead of a
  Pending row nobody owns ✓. *"Always distinguish between a timing difference and an error"*:
  Explained vs Written off is that distinction ✓. *"Zoho Books is the source of truth for
  financials"*: an Explained or Written-off line posts nothing here — the accountant still has to
  post it in Zoho; **flagged to the owner** (§5) because a write-off here does not move the books.
  *3-way match*: L3 restores the bill link on bulk payments ✓. **Flagged:** Skip still closes a
  line with no reason (Q13) — the activity log names who, not why.
- **database-architect** — every new model has `createdAt`/`updatedAt`, explicit relations with
  `onDelete`, indexes for the queries that will run (open list, mine, tile) ✓; enums for fixed
  value sets ✓; **no new `Float` money column** ✓ (amounts stay on the existing `Float` line —
  known defect, not extended); additive migration, hand-added data steps written out for review
  ✓; idempotency by unique index (fingerprint, one record per line) and atomic claim ✓.
  **Named deviation:** `BankTransaction.bankAccountId` duplicates the statement's — justified by
  the unique index and the tile, kept in step by exactly two writers inside one transaction
  each. Nullable FKs carry their reason in a comment ✓.
- **backend-engineer** — zod on every body, including the review route that had none ✓;
  `$transaction` for every multi-row write, re-read via the conditional claim ✓; "what if this
  runs twice / two users at once" — the claim answers both ✓; human sentences for every refusal
  ✓; the line state machine is one table in one file ✓. **Named deviation:** `lines.ts` puts
  transaction-taking logic in `src/lib` (C1). The doc's example `requireAuth(["ADMIN", …])` is
  stale and contradicts CLAUDE.md; this plan follows CLAUDE.md (`requireFeature`, two arguments).
- **frontend-engineer** — 375 px first; loading, error and empty states on all four screens;
  44 px targets; disabled-while-busy; the 615-line page split under 300 per file; no role names,
  `usePermissions()` only ✓. The doc's `fetch().then(r => r.json())` example contradicts
  CLAUDE.md; this plan uses `apiTry`.
- **integration-architect** — AI output stays a **suggestion** until a person confirms (stricter
  than today: the AI no longer moves `matchStatus`) ✓; a deduplication key on re-imported data
  (fingerprint) ✓; no silent truncation ✓; no Zoho call in this plan, so no rate-limit concern;
  `zohoAccountId` is unique, so plan C cannot push to an ambiguous account ✓.
- **`docs/ledger-and-reconciliation-flow.md`** — L3 fixed (C2); §9.2 partly adopted
  (`matchEntries` for already-recorded payments, Part F) and partly not (§5); L13's two writers
  now share one helper (C1, D5); L9 still open (§5).

---

## 4. Verification

**No Zoho write anywhere in this plan.** The test database has held production's live Zoho
credentials since 12 Oct 2026; the only Zoho traffic these steps cause is the settlement
detail's existing **read** of customer payments (`pos/settlement/[id]/route.ts:53-62`) when
step 11 opens a settlement. Do not press Settings › Integrations › Disconnect on test — it
revokes production's token.

**0. Pre-flight, read-only, on a fresh local restore of production** (`npm run db:restore:local
-- backups/<file>`, rule 10). Record the answers in the build record.

```sql
-- a. What exists, by bank (Q7)
SELECT bank, count(*), min("fromDate"), max("toDate") FROM "BankStatement" GROUP BY bank;
-- b. Lines flagged by a person (the migration's INSERT; expect 0)
SELECT count(*) FROM "BankTransaction" WHERE "matchStatus" = 'FLAGGED' AND "processedAt" IS NOT NULL;
-- c. L3 damage: payments made by bulk confirm, with no bill (Q10)
SELECT id, "vendorId", amount, "paymentDate", "referenceNo" FROM "VendorPayment"
 WHERE notes = 'Auto-recorded from bank statement' AND "billId" IS NULL;
-- d. Bulk-confirmed expense lines that lost their expense (D2)
SELECT count(*) FROM "BankTransaction" WHERE "matchStatus" = 'EXPENSE' AND "confirmedExpenseId" IS NULL;
-- e. Would the two new unique indexes fail? (must return no rows)
SELECT "confirmedPaymentId", count(*) FROM "BankTransaction" WHERE "confirmedPaymentId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
SELECT "confirmedExpenseId", count(*) FROM "BankTransaction" WHERE "confirmedExpenseId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
-- f. Who inherits what (Q2)
SELECT r.key, r.name, p.key FROM role_permissions rp
  JOIN roles r ON r.id = rp."roleId" JOIN permissions p ON p.id = rp."permissionId"
 WHERE p.key IN ('bills.view', 'bills.create') ORDER BY r.key, p.key;
-- g. Who would lose "confirm as expense" under Q3 = a
SELECT r.key FROM roles r
 WHERE EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp."permissionId" WHERE rp."roleId" = r.id AND p.key = 'bills.create')
   AND NOT EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp."permissionId" WHERE rp."roleId" = r.id AND p.key = 'expenses.create');
```

If (e) returns rows, **stop** — the unique indexes would fail the migration; ask.

**1. Migration.** Read the SQL against §3 B1: two enums, three tables, three nullable columns,
the indexes and FKs, then the two hand-added statements — nothing else. `npx prisma migrate
status` clean on local. Re-run query (b): the migration's INSERT created that many cases.

**2. Seed.** On local, first create a custom role **"Bank test"** on `/team/permissions` with
`bills.view`, `bills.create`, `vendors.view` (and *not* `expenses.create`), plus a user on it.
Then `npm run db:seed:rbac`: it prints `bank_recon.view / create / edit ← … : Bank test`;
`/team/permissions` shows Bank Reconciliation with four actions; ADMIN holds all four. Run it
again: nothing inherited the second time.

**3. Build.** `npx tsc --noEmit`, `npx eslint` on every touched file, then `npm run build` with
Postgres running.

**4. As the "Bank test" user — never as ADMIN, who passes every check (`rbac.ts:258`):**
upload and review work; "confirm as expense" is refused with the Q3 sentence; Write off and the
account buttons are hidden, and their APIs answer 403. Remove `bills.create` from the role:
upload still works (it now rides on `bank_recon.create`, which the seed copied). A role with
only `bills.view` sees statements and cannot upload.

**5. Accounts** (`/accounts/bank-accounts`, as ADMIN): create ICICI, HDFC Hub, HDFC Centre,
Dhanlaxmi with their stores. A duplicate name → 409 sentence; last four "12a4" → 400 sentence;
retire one → it leaves the upload chips and the tile.

**6. Upload** (`/accounts/bank-upload`): HDFC Hub, period 1–7 Oct, a real statement → lines
carry the account (check `BankTransaction."bankAccountId"`). The same file again → 409 "already
uploaded". An overlapping 5–12 Oct file → "N were already uploaded and were skipped", and no
line exists twice. A period of 1–3 Oct for a file with 7 Oct lines → 400 naming the date. A
file over 50,000 characters → the refusal, nothing imported. A Dhanlaxmi file parses (or, if the
generic hints fail, the diagnostics panel shows why — report it with the sample).

**7. Old statements:** they appear under "Assign an account"; an ICICI one pre-selects ICICI;
an HDFC one must be chosen; assigning an HDFC file to the ICICI account → 400.

**8. Lines** (`/accounts/reconcile/[id]`): "To review" equals the count of `processedAt IS
NULL` lines for that statement, AI-suggested ones included. Confirm one payment against a bill
→ the bill's paid amount rises. Press Confirm in two tabs → the second gets "already handled"
and only one `VendorPayment` exists. Bulk-confirm three debits to a vendor whose bills the AI
suggested → bills updated, the result says how many against bills and how many as advances
(L3). `curl` a `confirm_payment` on a credit line → 400. A part-paid bill appears in the bill
picker.

**9. Suspense:** park a credit with a reason, assigned to a user; park a debit assigned to
"Deekshith". Both appear on `/accounts/suspense`, Assigned to me filters. Add notes; each shows
author and time. Mark one Explained → the line is Skipped-with-a-case, the case closed with the
note. Write off as "Bank test" → 403 sentence; as ADMIN → closed. Reopen → back in suspense.

**10. Recorded closes a case:** park a debit, then confirm it as an expense → the case closes
RECORDED with a system note. Delete that expense on `/expenses` → the line is back in suspense
and the case reopened with a note (Q12).

**11. Settlement interplay:** park a credit on a settlement day; open that settlement → the line
is offered; match it → its case closes RECORDED. Remove the match → back in suspense. Re-pull
POS sessions with *force* for that day → its matched lines are released, none left `MATCHED`
with no `SettlementMatch` (D10).

**12. The tile** (`/accounts`), with `reconcileFrom` = 1 Oct on HDFC Hub:
no statements → red, "No statement uploaded". 1–7 Oct uploaded and every line handled →
"Reconciled up to 7 Oct", green while today is within 7 days. One line on 4 Oct left open →
"up to 3 Oct". Upload 15–21 Oct, skip 8–14 → "Missing statement 8 Oct – 14 Oct", reconciled up
to 7 Oct. A parked line → counted under suspense, and holds the date back. At 8 days behind →
red. A user without `bank_recon.view` sees no tile.

**13. Link existing:** record a payment on `/payments/new` with its UTR; upload the statement
that contains it → the line shows "Already recorded?"; Link → `MATCHED`, no new payment, the
bill unchanged. Link the same payment to another line → 409.

**14. 375 px:** the four screens and the tile at iPhone SE width — no sideways scroll, sheets
reachable.

**15. Logs** at `LOG_LEVEL=0`: the lines in §3 Logging appear; no narration, file text or full
account number anywhere.

---

## 5. Out of scope, deliberately

- **Replacing the AI matcher with the deterministic engine (ledger doc §9.2 / L4).** Not built.
  The AI's job on a bank line is *vendor resolution from a narration* across ~83 vendors and
  every open bill; `matchEntries` matches one counterparty's statement against our records by
  amount, date and reference and cannot read "NEFT-HDFC0001234-HERO CYCLES PVT". Swapping it
  changes the suggestions the accountant works from every day, needs real statements of all
  four banks to tune (the ledger doc's own Q3 is still unanswered), and R16/R17 do not ask for
  it. This plan takes only the safe half — `matchEntries` to find payments **already recorded**
  (Part F) — and leaves the AI's suggestions as suggestions. Its own plan, after real samples.
- **A running-balance check** (each line's balance = the previous ± amount; one statement's
  opening = the last one's closing). It would catch a parser that drops a line and a missing
  week without a typed period. Stronger than Q4's typed period; a follow-up.
- **Storing the uploaded file** (L9). Separate small change, as the ledger doc suggested.
- **Recording a customer receipt from a bank credit** against a customer invoice. Credits close
  here through settlement, Explained or Skip; receivables are plan E's area.
- **Posting a write-off or explanation to Zoho as a journal.** The app records why; the
  accountant posts it in Zoho Books. Raised in the board check.
- **Reminders** — "Tuesday ICICI" is not scheduled, per D17; no cron, no timer, no push on
  assignment. An event-driven "you were assigned a suspense line" push is possible later
  without a scheduler; not asked for.
- **Outsiders logging in.** Deekshith has no account; a staff member records his replies as
  notes.
- **A reason on Skip** (Q13 = a).
- **Undoing a confirmed payment** from the bank screen. Not possible today, still not.
- **The ADMIN short-circuit in `userCan`** (`rbac.ts:258`) and the client store. It breaks
  CLAUDE.md rules 1–2 and makes admin testing meaningless; it deserves its own plan because
  removing it changes every screen an admin uses.
- **`Float` → `Decimal` on bank amounts** — `docs/schema-review.md` item 5, whole-schema work.
- **`pos.delete` undeclared** (§2.7, noticed) and the settlement pages' `canView("bills")`
  gate — plan E's screens.
- **The full account number** — last four digits only.
- **Settlement filtered by store's accounts, per-store settlement** — plan E, on the columns
  this plan adds.
