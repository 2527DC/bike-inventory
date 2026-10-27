# Every expense names its store and who paid, can be deleted, and one report answers "how much did this person spend, at this store, this month"

Status: completed — 13 Oct 2026, built 12 Oct, committed `02705a6`, merged into `test` (`d3ae966`) and live on the Vercel test site; migration applied to the test database 13 Oct. Not yet on `main`; the browser pass (§4) is the owner's.
Branch: **`feat/1210-expense-store-department`** — create it with exactly this name, off `origin/main` (local `main` is 11 commits behind).

The file name keeps "department" so links from the feature map and the README index stay valid;
**departments are not built** — the owner removed them on 12 Oct (§0.1b, §1.1 E1).

Every `file:line` in §2 was read from disk on 12 Oct 2026. Production facts in §2.9 were counted
the same day on a local restore of the production snapshot taken that morning. Check rather than
trust.

Sibling plans written the same day, in `docs/implementation/pending/`, referenced by letter:
**B** `1210-zoho-credit-notes-and-payables-plan.md`, **D** `1210-bank-accounts-and-suspense-plan.md`,
**E** `1210-settlement-per-store-and-receivables-plan.md`.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (8 Oct 2026)

> 12. Recording daily operational expenses (Porter logistics/freight charges, staff food, tea, fuel/diesel, cleaning materials, godown maintenance).
> 13. Mapping every expense to the specific person/department (e.g., Iqbal Bhai's logistics spends).

Source: `docs/implementation/requiremnts/accounts-and-compliance-feature-map.md` §1.1, points 12
and 13.

### 0.1b Added in session, verbatim (12 Oct 2026)

> there is no department in the aplication  dont need it  or dont create  it and i need u to add the delet action for create expenses

> the expeces are respected to the store specific

### 0.2 Restated as requirements

| # | Requirement | Source | Part |
|---|---|---|---|
| **R1** | Daily operating expenses — Porter freight, staff food, tea, fuel and diesel, cleaning materials, godown maintenance — are recorded under the **existing eight categories**. No category is added, renamed or re-hinted. Already true today (§2.1); **no work**. | point 12 · map R12 · D7 | — |
| **R2** | Every expense names the **store** it belongs to, from the `Store` table — never a `"HUB"`/`"CENTRE"` string. The form lists every active store; when exactly one is active (production today, §2.9) it is selected automatically, and a second store appears on the form the day the owner adds it under Settings › Store management, with no code change. | point 13 · 12 Oct "store specific" · D1 · E5 | A, B, C |
| **R3** | Every expense names **who paid**: me, another staff member (linked to their account), or a typed name for someone not on staff (e.g. a Porter driver). Anyone allowed to create an expense may choose. | point 13 ("person") · D6 · E3 | A, B, C |
| **R4** | One report answers *"how much did &lt;person&gt; spend at &lt;store&gt; in &lt;period&gt;"* — the owner's example is *Iqbal Bhai's logistics spends* — by filtering and grouping by **store, who paid and category** over a date range; every total opens the list of the expenses behind it, showing **the same total**. | point 13 | E, D |
| **R5** | `/expenses` gets a **Delete** action for holders of Expenses › Delete, on any row: the expense is removed for good (with its receipt photo), an **activity-log entry** records what was deleted and by whom, and if the expense was created from a bank statement line, that line goes back to *to review*. | 12 Oct ("add the delet action") · E9 | B, D |
| **R6** | *Every* expense includes those created from a **bank statement line**: the reconcile screen's *Expense* panel names the store too, and recording the same line twice can no longer create two expenses. | point 13 ("every") · E6 | G |

**No department** anywhere: no table, no form step, no screen, no report grouping (§0.1b, E1).
Point 13's "department" is not built at the owner's instruction; category already says *what*
an expense was for.

Two words used throughout:

- **Store** answers *"which shop's money, under which GSTIN"* (`Store.gstin`).
- **Payer** answers *"whose hands did the money leave from"*. It is recorded, not judged: this plan
  does not track whether the business owes that person a refund (§5).

---

## 1. Questions and clarifications — answer before build

### 1.1 Decisions on record — answered in session, 12 Oct 2026

| # | Question | Answer | Effect |
|---|---|---|---|
| D1 | How is Hub/Centre recorded? | The existing `Store` table, by `storeId` foreign key. | `Expense.storeId → Store`. |
| D6 | Who paid? | A staff user (foreign key to `User`) **or** a typed name for outsiders. | `Expense.paidById → User`; `paidBy` text kept. |
| D7 | New categories? | None — keep the existing eight. | `ExpenseCategory` untouched; card hints untouched too. |
| **E1** | Departments? | **Dropped entirely.** *"there is no department in the aplication dont need it or dont create it"*. Supersedes the department half of D5 and Q1–Q3 of the first draft. | No `Department` model, step, screen or report group. |
| **E2** | A company-wide expense with no store? (first draft Q7) | **No** — every expense picks one store; a shared cost is entered once per store. | `storeId` required by the API for every new expense. |
| **E3** | Who may name another payer? (Q4) | **Anyone holding Expenses › Create.** Supersedes 0909 D2 (*"paidBy … locked to the logged-in user"*). | The *Who paid?* step is shown to everyone who can create. No `approve` check. |
| **E4** | Old expenses and old typed payers? (Q5, Q6) | Old typed payers are **left as text**. Production has **zero** expenses (§2.9), so nothing needs mapping. | No backfill, no "Link typed names" screen, no Assign sheet. |
| **E5** | How does the form pick the store? | From the `Store` table; **auto-selected when exactly one active store exists.** Production has one store, `BCH1` "BCH" (§2.9). | Second store appears automatically once added. |
| **E6** | Bank-line expenses name the store? (Q8) | **Yes**; payer stays *"Bank Transfer"*. | Part G. |
| **E7** | `POST /api/expenses/batch` (no caller since 18 Sep)? (Q10) | **Delete it.** | Route and its two schemas removed. |
| **E8** | An edit sheet for store / who paid? | **No — delete and re-enter** fixes a mistake. | `PUT /api/expenses/[id]` stays without a screen (§3 B3). |
| **E9** | Delete — who, and how? | **Expenses › Delete, any row; hard delete + activity-log entry.** | Part B (`DELETE`), Part D (button). |
| **E10** | Where is it built and tested? | A **fresh local restore** of the 12 Oct production snapshot, database `bch_dev_1210`, credentials blanked (Zoho, storage, SMTP/FCM, AI keys; push devices deleted). `.env` is pointed at it for the build and put back afterwards. | Migration runs on localhost only (CLAUDE.md rule 2). |

### 1.2 Open questions

None. Every question in the first draft is answered or made moot by E1/E4.

### 1.3 Raised for the other plans, not this one

Production has **one** `Store` row (`BCH1`, "BCH", no GSTIN) and two warehouses under it
(`BCH_STORE` floor, `BCH_WARE` godown). **Bharath Cycle Centre is not in the app.** Plans **B**, **D**
and **E** assumed two store rows coded `BCH_STORE` / `BCC_STORE` (a schema comment). Their
store backfills and "Hub vs Centre" splits need the Centre store created first — the owner's call.

---

## 2. How it works today — verified against the code

### 2.1 The model and the categories

`prisma/schema.prisma:1368-1387`: `Expense` has `date`, `amount Float`, `category
ExpenseCategory`, `description`, `paidBy String`, `paymentMode`, `referenceNo?`, `receiptUrl?`,
`notes?`, `recordedById → User ("ExpenseRecordedBy")`, timestamps; indexes on `date`,
`category`, `recordedById`.

- **No store, and the payer is a string** (`:1374`). Nothing links an expense to a `User` except
  who *recorded* it.
- `ExpenseCategory` (`schema.prisma:169-178`): `DELIVERY, TRANSPORT, SHOP_MAINTENANCE, UTILITIES,
  SALARY_ADVANCE, FOOD_TEA, STATIONERY, MISCELLANEOUS`. Every item in point 12 has a home among
  them, so **R1 is already met** (D7).
- `Store` (`schema.prisma:248-298`): `code` unique, `gstin`, `isActive`; back-relations use named
  `Restrict` relations (`transfersFrom`/`transfersTo`, `:294-297`).
- `User.storeId` exists, nullable (`:396-397`); it is **not** in the session — `CurrentUser`
  (`src/lib/auth-helpers.ts:10-30`) has no `storeId`, and `getAccess` does not select it
  (`src/lib/rbac.ts:140-151`).

### 2.2 The entry form and its API

The batch form was built on 9 Sep (`4791c94`) and **removed on 18 Sep** (`e16d51f` / `382dc7c`).
`src/app/(dashboard)/expenses/new/page.tsx` today:

- Four steps — amount, category, payment mode, photo (`:34-39`; `ENTRY_STEPS` at
  `_components/types.ts:37-40`). The photo step's button is Submit.
- Payer is the signed-in user (`:48-50`), shown locked in the top bar
  (`_components/batch-bar.tsx:30-41`).
- One `apiTry` POST to `/api/expenses` (`:99-112`). Modes offered: `UPI`, `CASH` (`types.ts:70`).
- Stale comment: `types.ts:1-4` still describes the batch POST.

`POST /api/expenses` (`src/app/api/expenses/route.ts:40-68`): `expenses.create`, `expenseSchema`,
`paidBy: user.name` (`:52-53`). `GET` (`:9-38`): filters `category`, `dateFrom`, `dateTo`.
`POST /api/expenses/batch` (`src/app/api/expenses/batch/route.ts`): **no caller in `src/`**.
`PUT /api/expenses/[id]` (`src/app/api/expenses/[id]/route.ts:30-57`): `expenses.edit`, accepts
free-text `paidBy` (`:44`); **no caller**. `DELETE` (same file, `:59-85`): `expenses.delete`,
hard delete then `removeReceipt` (row first, then the photo), logs `row deleted` — **no caller,
no activity-log entry, and a bank line pointing at the expense is left behind**.

Validation — `src/lib/validations.ts:623-674`: `expenseRowSchema` (`:641`), `expenseBatchSchema`
(`:653`; used only by the batch route), `expenseSchema` (`:664-674`).

### 2.3 The list — `/expenses`

`src/app/(dashboard)/expenses/page.tsx`: `ExpenseItem` (`:18-29`) has no store; fetches
`limit=50` (`:89`); filters category and date (`:173-184`); shows `paidBy` text (`:202`,
`:220`); **no delete control**; *"Total shown"* sums only the 50 rows fetched (`:105`) — L9.

### 2.4 The report — `/reports/expense-summary`

`src/app/api/reports/expense-summary/route.ts:8-52`: `reports.view`; `groupBy: ["category"]`
only; `dateTo` used as 00:00 UTC of the last day (L4). The page
(`src/app/(dashboard)/reports/expense-summary/page.tsx`) uses raw `fetch().then(r => r.json())`
with `.catch(() => {})` (`:42-46`) — L3. The owner's question cannot be asked today.

### 2.5 Every other reader and writer of `Expense`

| Where | What it does | Affected? |
|---|---|---|
| `src/app/api/bank-statements/[id]/review/route.ts:76-95` (bulk), `:200-235` (single) | **Writes** an expense from a bank debit: `paidBy: "Bank Transfer"`, `paymentMode: "NEFT"`, no store. Guard `bills.create`. | **Yes — Part G** |
| `src/app/(dashboard)/accounts/reconcile/[id]/page.tsx:362-374`, `:567-585` | The *Expense* panels; one category tap creates the expense. | **Yes — Part G** |
| `BankTransaction.confirmedExpenseId` (`schema.prisma:1448`) | Plain string, no relation; set only by the single path (`review/route.ts:229`). | **Yes** — `DELETE` resets lines that point at the deleted expense (R5). |
| `DailySettlement.cashOut` (`schema.prisma:2587-2588`) | Free-text reason; no link. | No (plan E). |
| `src/app/api/activity/route.ts:126-138`, `:350-362`, `LOG_MODULES` `:208-218` | Feed infers *Recorded Expense*; `expenses` has no module label. | Label added (Part B). |
| `src/app/api/accounts/summary/route.ts:47-50`, `health/summary/route.ts:96-99`, `reports/daily/route.ts:33-37` | Totals by date. | No. |
| `src/types/index.ts:313-326` | `Expense` interface, imported by nothing. | Two ids added. |
| `src/app/api/stores/[id]/route.ts:72-120` | Store `DELETE` lists blocking relations (`:82-91`, `:96-104`). | **Yes** — expenses join the list (A3). |

### 2.7 RBAC today

`prisma/rbac-catalog.ts:509-522` — `expenses`: `view, create, edit, delete, approve`. Guards:
`view` (list), `create` (POST, batch), `edit` (PUT), `delete` (DELETE). The report is
`reports.view`. **No catalog change in this plan.**

### 2.8 Live defects in code this plan touches

| # | Defect | Where | Fixed in |
|---|---|---|---|
| L1 | `/api/expenses` has no logger; catches return silently. | `api/expenses/route.ts` | B3 |
| L2 | `GET`/`PUT` on `/api/expenses/[id]` catch without logging. | `api/expenses/[id]/route.ts:24-27`, `:53-56` | B3 |
| L3 | Report page: raw `fetch().json()`, `.catch(() => {})`; report API catch silent. | `reports/expense-summary/page.tsx:42-46`; API `:48-51` | E |
| L4 | Date window ends at 00:00 UTC of the last day. | `api/expenses/route.ts:20`; report `:16-18` | B4 (`istDayBounds`, `src/lib/services/timezone.ts:42`) |
| L5 | Bank path not idempotent: single confirm reads the line without `processedAt: null` (`review/route.ts:116-120`) → a retry creates a **second expense**; create + update outside a transaction; **bulk never sets `confirmedExpenseId`** (`:91-94`); no `DEBIT` check server-side. | `review/route.ts` | G |
| L6 | `recordedById` from `getServerSession()` with `""` fallback (`:42-44`). | same | G |
| L7 | The bank route's `POST` catch does not log (`:254-257`). | same | G |
| L8 | Bank-created expenses are always `NEFT` (`:86`, `:218`). | same | G |
| L9 | `/expenses` *"Total shown"* sums only the first 50 rows. | `expenses/page.tsx:89`, `:105` | D |
| L10 | `DELETE /api/expenses/[id]` leaves a bank line marked *EXPENSE* pointing at a row that no longer exists. | `api/expenses/[id]/route.ts:59-85` | B3 (R5) |

### 2.9 Production data, 12 Oct 2026

Counted read-only on `bch_dev_1210`, a local restore of `backups/prod-izighywsutktzarkfbiv-20261012-092527.dump`:

| Fact | Value |
|---|---|
| `Expense` rows | **0** |
| `Store` rows | **1** — `BCH1` "BCH", active, no GSTIN, no invoice prefix |
| `Warehouse` rows | 2 — `BCH_STORE` "Bch store" (FLOOR, prefix `INV`, primary), `BCH_WARE` "Bch warehouse" (GODOWN); both under `BCH1` |
| Active users with a store | 4 of 5 |

So there is nothing to backfill, and the store picker will show exactly one store today.

---

## 3. Implementation plan

Six parts. **A** is the only one with a migration. No cron, no timer, no polling, no Zoho call,
no JWT change, **no RBAC catalog change**.

### Part A — schema and migration

#### A1 — `prisma/schema.prisma`

```prisma
model Expense {
  // … every existing field unchanged …

  // The payer as it should READ: the staff user's name at entry, or a typed outsider's name.
  // Always filled — every existing reader keeps working.
  paidBy       String
  // Set when the payer is a staff user (D6). Null = a typed outsider. SetNull: a deleted user
  // leaves `paidBy` as the record of who it was.
  paidById     String?
  paidByUser   User?   @relation("ExpensePaidBy", fields: [paidById], references: [id], onDelete: SetNull)

  // Required for every new expense by the API (D1, E2). Nullable in the database for one
  // release: between `migrate deploy` and the new code going live, the old code still saves
  // expenses without it (CLAUDE.md rule 7), and the test database may hold such rows.
  storeId      String?
  store        Store?  @relation("ExpenseStore", fields: [storeId], references: [id], onDelete: Restrict)

  @@index([storeId])
  @@index([paidById])
}
```

Back-relations: `Store.expenses Expense[] @relation("ExpenseStore")`; `User.paidExpenses Expense[]
@relation("ExpensePaidBy")` next to `recordedExpenses`.

#### A2 — the migration

`npm run db:migrate -- --name expense_store_and_payer` (asserts localhost first). Expected SQL,
read before committing (rule 3):

```sql
ALTER TABLE "Expense" ADD COLUMN "paidById" TEXT, ADD COLUMN "storeId" TEXT;
CREATE INDEX "Expense_storeId_idx" ON "Expense"("storeId");
CREATE INDEX "Expense_paidById_idx" ON "Expense"("paidById");
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Additive only: no `DROP`, no type change, no `SET NOT NULL`; no data written. Anything else in
the generated file is a stop-and-ask. Rule 9: `npm run db:snapshot` before merging. Nothing
applies migrations automatically (rule 4): `migrate status` then `migrate deploy` on the target
**before** the new code goes live. `SET NOT NULL` on `storeId` belongs to the release after (§5).

#### A3 — the store delete route

`src/app/api/stores/[id]/route.ts:82-91` gains `expenses: true` in `_count`, and `:96-104` the
blocker `` `${n} expense(s)` ``.

#### A4 — `src/types/index.ts:313-326`

`Expense` gains `storeId?`, `paidById?`.

### Part B — server

#### B1 — `src/lib/expenses/assignment.ts` (new)

One place for the two rules, used by the expense route and the bank route.

```ts
const log = createLogger("expenses:assignment");

resolveStore(storeId)
  → storeById(storeId)            // src/lib/stores.ts — active stores only
  → missing/inactive: 400 "Pick the store this expense belongs to."

resolvePayer(db, actor: CurrentUser, payer)
  self        → { paidById: actor.id, paidBy: actor.name }
  user, id    → user must exist and be active, else 400 "That staff member is not active."
              → { paidById: user.id, paidBy: user.name }
  name        → trim, collapse inner spaces, 2–80 chars
              → { paidById: null, paidBy: <normalised name> }
```

No permission check beyond `expenses.create` (E3). `log.warn` on refusals with `{ actorId,
reason }` — never the typed name.

#### B2 — validation, `src/lib/validations.ts`

```ts
export const expensePayerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("self") }),
  z.object({ kind: z.literal("user"), userId: z.string().min(1) }),
  z.object({ kind: z.literal("name"), name: z.string().trim().min(2, "Type the payer's name").max(80) }),
]);
```

- `expenseSchema` (POST) = today's fields **minus** `paidBy`, plus `storeId` (required, message
  *"Pick the store this expense belongs to"*) and `payer`.
- `expenseUpdateSchema` (PUT) = today's optional fields **without** `paidBy` — a free-text payer
  would desynchronise `paidById`; `PUT` has no caller, so nothing breaks.
- `expenseRowSchema` and `expenseBatchSchema` are **deleted** with the batch route (E7).

#### B3 — routes

| Method, path | Guard | Change |
|---|---|---|
| `POST /api/expenses` | `expenses.create` | Parse → `resolveStore`, `resolvePayer` → create with `storeId`, `paidById`, `paidBy`; `recordedById` = actor. Logger `expenses:api` (L1). |
| `GET /api/expenses` | `expenses.view` | Filters via B4: `storeId` (id or `none`), `payer` (`user:<id>` or `name:<key>`), `category`, `dateFrom`/`dateTo`; `include` adds `store {id,name}`, `paidByUser {id,name}`. |
| `GET /api/expenses/totals` *(new)* | `expenses.view` | Same filter → `{ count, amount }` (L9), without changing the shared `paginatedResponse`. |
| `GET /api/expenses/options` *(new)* | `expenses.create` | `me { id, name, storeId }`, active `stores {id, code, name}`, active `users {id, name}`, and up to 50 recent typed payer names (last 180 days, `paidById IS NULL`). |
| `DELETE /api/expenses/[id]` | `expenses.delete` | **One `$transaction`**: read the row (404 if gone) → reset every `BankTransaction` with `confirmedExpenseId = id` to `matchStatus: UNMATCHED, confirmedExpenseId: null, processedAt: null` → delete → `logActivity(tx, { module: "expenses", action: "deleted", entityType: "Expense", entityId, entityRef: "<category> ₹<amount> <date>", details: "<store> · paid by <payer> · recorded by <recorder>" })`. Then `removeReceipt` as today (row first, photo second). Response `{ deleted: true, bankLinesReopened: n }`. (L10) |
| `PUT /api/expenses/[id]` | `expenses.edit` | `expenseUpdateSchema` (no `paidBy`); catches log (L2). No screen (E8). |
| `POST /api/expenses/batch` | — | **Deleted** (E7), with its schemas; the stale comment at `types.ts:1-4` is corrected. |

`src/app/api/activity/route.ts:208-218` — `LOG_MODULES` gains `expenses: { category: "EXPENSE",
label: "Expense" }`.

#### B4 — `src/lib/expenses/filters.ts` (new) — one filter for the list, the totals and the report

```ts
parseExpenseFilter(searchParams) → { from, to, storeId, payer, category }
                                   // from/to via istDayBounds; default = this month (IST)
buildExpenseWhere(db, filter)    → Prisma.ExpenseWhereInput
```

A typed payer is matched by its **key** — lower-cased, trimmed, inner spaces collapsed — so
*"Iqbal bhai "* and *"Iqbal Bhai"* are one person. `buildExpenseWhere` resolves the key to the
spellings that exist with one parameterised `$queryRaw` and filters `paidById: null, paidBy:
{ in: spellings }`. Because the list, the totals and the report all call this one function,
**a report total and the list it opens always agree** (L4, L9).

### Part C — the entry form (`/expenses/new`)

Still one expense per submit, photo step last.

| Where | Today | Becomes |
|---|---|---|
| Top bar — `_components/batch-bar.tsx` | Date · *Paid by: you* (locked) | Date · **Store**. One active store → shown as a fixed chip, already selected. Several → one 44 px button each, pre-selected from `me.storeId` when it is one of them, otherwise none selected and an amber *"Pick the store"*. |
| Step 1 | Amount | unchanged |
| Step 2 | Category | unchanged |
| **Step 3** *(new)* | — | **Who paid?** — `_components/payer-step.tsx`: (1) *Me — &lt;name&gt;* (pre-selected); (2) *Staff member* — `SearchableSelect` over `users`; (3) *Someone not on staff* — text field with recent typed names as tap-to-fill chips. If a typed name equals a staff member's name, a note offers to switch to that staff member; it never blocks. |
| Step 4 | Payment mode | unchanged |
| Step 5 | Photo + **Submit** | Disabled with a sentence naming what is missing until store and payer are set. |

- Options load once on mount via `apiTry("/api/expenses/options")`; spinner, `ErrorBanner` with
  retry. No polling.
- Payload adds `storeId`, `payer`. Stale comments corrected (`types.ts:1-4`,
  `batch-bar.tsx:12-15`).

### Part D — the list (`/expenses`)

- Each row shows a **store** chip beside the category; the payer reads `paidByUser.name` when
  linked, otherwise `paidBy` with a small *not staff* marker; rows with no store show *No store*.
- `FilterSheet` gains a **Store** group. A **payer** filter arrives from the report's links as a
  removable chip.
- Initial filters come from the URL (`?storeId=&payer=&category=&dateFrom=&dateTo=`).
  `useSearchParams` needs a Suspense boundary or the production build fails — copy
  `src/app/(dashboard)/purchase-orders/page.tsx:76-84`; read `node_modules/next/dist/docs/` on
  it first (CLAUDE.md).
- The total card uses `GET /api/expenses/totals`: *"₹48,200 across 63 expenses · showing the
  latest 50"* (L9).
- **Delete** (R5): for `canDelete("expenses")` (cosmetic; the API re-checks), a trash button on
  each row opens a confirm sheet — *"Delete ₹1,200 Transport, 12 Oct, paid by Iqbal Bhai? This
  cannot be undone."* plus, when the row came from a bank line, *"Its bank line goes back to
  'to review'."* → `apiTry(DELETE)`; button disabled while busy; the API's sentence on failure;
  the row leaves the list and the total reloads.
- `createLogger("expenses:list")` — `error` on failed load or delete.

### Part E — the report (`/reports/expense-summary`)

#### E1 — `GET /api/reports/expense-summary` (rewritten; guard stays `reports.view`)

```
query   dateFrom, dateTo (IST; default this month), storeId | none, payer, category,
        groupBy = payer (default) | store | category
where   buildExpenseWhere (B4)
groups  store / category → prisma.expense.groupBy by that column
        payer            → groupBy ["paidById", "paidBy"], folded in code: linked rows by user id
                           (label = the user's current name), typed rows by key
returns { dateFrom, dateTo, total, totalCount, dailyAvg, groupBy,
          groups: [{ key, label, amount, count, percentage }],   // null store → "No store"
          options: { stores, payers } }                          // payers = everyone in the window
```

`createLogger("reports:expense-summary")`: `debug { groupBy, groups, ms }`, `error` in the catch (L3).

#### E2 — the page (rewritten)

`DateFilter` presets · Store / Category / Who paid filters · a total card *"₹12,450 · 31
expenses · ₹415 a day"* with **View these expenses →** (`/expenses?<same filters>`) · *Group by:
Who paid / Store / Category*. Tapping a group row adds it as a filter and moves *Group by* to the
next dimension, so the owner's question is two taps: *Who paid → Iqbal Bhai*, then the store. All
fetches through `apiTry`; skeleton, `ErrorBanner` with retry, empty state.

### Part G — expenses created from a bank statement line (E6)

`src/app/api/bank-statements/[id]/review/route.ts`:

- `GET` adds `expenseStores` (active `{id, name}`) so the screen needs no `expenses` grant.
- `confirm_expense`, single and bulk, requires `storeId` (zod), checked by `resolveStore`. Payer
  stays *"Bank Transfer"*.
- **Single**: one `$transaction` — re-read the line with `processedAt: null` and `type: "DEBIT"`
  (409 *"This line has already been processed"*; L5), create, set `matchStatus: EXPENSE`,
  `confirmedExpenseId`, `processedAt`.
- **Bulk**: one `$transaction`; **set `confirmedExpenseId` on each line** (L5); same filter.
- `paymentMode` inferred from the reference as the payment branch does (L8).
- `recordedById` = the user `requireFeature` returns (L6).
- `log.info("bank line recorded as expense", { statementId, txnIds, expenseIds, storeId })`;
  catch logs `error` (L7). **Guard unchanged** (`bills.create`; plan **D** moves it).

`src/app/(dashboard)/accounts/reconcile/[id]/page.tsx`: both *Expense* panels gain a Store row
(chips; auto-selected when there is one store); category chips stay the single commit tap but are
disabled until a store is chosen. The two handlers this touches move from raw `fetch().json()` to
`apiTry` and show the API's sentence on failure.

### Phases and dependencies

| Phase | Work | Depends on |
|---|---|---|
| P1 | Part A — schema, migration, store-delete blocker, type | — |
| P2 | Part B — resolvers, validation, routes, filter, delete, batch removal | P1 |
| P3 | Part C — the form | P2 |
| P4 | Part D — the list, delete button | P2 |
| P5 | Part E — the report | P2 |
| P6 | Part G — the bank path | P2 |

**Sibling plans.** **D** edits the same two bank files and changes their guard — whichever lands
second rebases. **B** adds its own `storeId` relations to `Store` and edits the same store-delete
blocker list — a mechanical merge. Relation name `"ExpenseStore"` is this plan's.

### RBAC

No catalog change. Used: `expenses.view` (list, totals), `expenses.create` (form, options, naming
any payer — E3), `expenses.delete` (Delete — E9), `expenses.edit` (`PUT`, no screen),
`reports.view` (report). No role name anywhere; screen checks are `usePermissions()` and cosmetic.

### Logging

| Scope | File | Lines |
|---|---|---|
| `expenses:api` *(new)* | `api/expenses/route.ts` | `debug` list `{ count }`; `info` "expense recorded" `{ expenseId, storeId, payerKind, paidById, recordedById }`; `warn` validation/refusal; `error` (L1) |
| `expenses:assignment` *(new)* | `lib/expenses/assignment.ts` | `warn` per refusal `{ actorId, reason }` |
| `expenses:delete` (existing) | `api/expenses/[id]/route.ts` | `info` "row deleted" gains `{ bankLinesReopened }`; `error` unchanged |
| `expenses:edit` *(new)* | same file | `error` in `GET`/`PUT` catches (L2) |
| `expenses:options` *(new)* | `api/expenses/options/route.ts` | `debug { stores, users }`; `error` |
| `expenses:totals` *(new)* | `api/expenses/totals/route.ts` | `debug { count }`; `error` |
| `reports:expense-summary` *(new)* | report API | `debug { groupBy, groups, ms }`; `error` (L3) |
| `bank-statements:review` | existing | `info` "bank line recorded as expense"; `error` in the catch (L7) |
| client `expenses:entry`, `expenses:list`, `reports:expense-summary`, reconcile page | pages | `error` on every failed fetch `{ status, message }` |

Every `catch` logs before it returns. Typed payer names are never written to the application log
— ids and counts only.

### Board of agents — checked

- **`accounting-consultant.md`** — every report total traces to its expenses through one filter
  (B4) ✓; deletion leaves an activity-log record of what was removed ✓. **Red flag, not built:**
  expenses recorded here never reach Zoho Books, so Zoho's profit-and-loss does not contain them
  (§5). **Red flag, accepted by the owner:** hard delete removes a financial record; the activity
  log keeps who, what and when (E9).
- **`database-architect.md`** — foreign keys with explicit `onDelete` (`SetNull` payer, `Restrict`
  store, blocker listed in A3) ✓; indexes on the new filter columns ✓; transactions for delete +
  bank reset + log and for both bank branches ✓; idempotent bank path (`processedAt` guard) ✓;
  additive migration ✓. **Deviation, flagged:** `storeId` nullable in the database, required by
  the API, for one release (rule 7).
- **`backend-engineer.md`** — zod at every boundary, including the bank `confirm_expense` body ✓;
  `requireFeature` on every route ✓. Rules live in `src/lib/expenses/` because two routes share
  them (deviation, flagged). The doc's own template uses a role allow-list that CLAUDE.md forbids;
  not followed.
- **`frontend-engineer.md`** — 375 px first, 44 px targets ✓; loading/error/empty states ✓;
  `usePermissions()` only ✓; `apiTry` everywhere (the doc's raw-fetch template is stale; not
  followed).

---

## 4. Verification

Built and tested against `bch_dev_1210` (E10). **No Zoho call anywhere in this plan.**

### 4.1 Build and schema

1. The migration SQL matches A2; `npx prisma migrate status` clean on localhost.
2. `npm run build` passes (local Postgres running).

### 4.2 The form (R2, R3)

3. `/expenses/new` → the top bar shows *BCH* already selected (one store) → ₹1,200 → *Transport* →
   *Someone not on staff* → *Iqbal Bhai* → UPI → submit. The list row reads *BCH · Iqbal Bhai
   (not staff)*.
4. ₹350 → *Food & tea* → *Staff member* → a colleague → Cash → submit. Database: `paidById` = the
   colleague, `recordedById` = you.
5. Typing a staff member's exact name under *Someone not on staff* shows the switch note; it does
   not block.
6. Add a second active store locally → the top bar shows two buttons; submit is disabled until one
   is picked. (Deactivate it again afterwards.)
7. From devtools: `POST /api/expenses` without `storeId` → 400 *"Pick the store…"*; with an
   inactive user as payer → 400.

### 4.3 List, delete and report (R4, R5)

8. `/expenses` total card states the full count and amount, not just the 50 shown.
9. Delete an expense as a user with Expenses › Delete → confirm → the row is gone; the activity
   feed shows *Expense deleted* with the amount, store and payer. A user without the grant sees no
   button; `DELETE` from devtools → 403.
10. **The owner's question.** `/reports/expense-summary` → *This month* → *Who paid* → **Iqbal
    Bhai** → **BCH**. *View these expenses* opens `/expenses` with the same filters and **the same
    total and count**.
11. An expense dated on the last day of the window is inside the total (L4).
12. Expire the session on the report and change a filter → login page, not *"No expense data"*.

### 4.4 Bank path (R6, R5)

13. `/accounts/reconcile/<id>` → *Expense* on a debit: category chips enabled once the store is
    selected (auto with one store) → the expense has the store, payer *Bank Transfer*, and a mode
    matching the reference.
14. Repeat the same request from devtools → 409; still one expense.
15. Bulk-record two debits → both lines carry `confirmedExpenseId`.
16. Delete one of those expenses on `/expenses` → its bank line is back in *to review*.

### 4.5 Deploy checklist (owner)

1. `npm run db:snapshot` (rule 9).
2. On the target: `npx prisma migrate status`, then `npx prisma migrate deploy` — **before** the
   new code goes live.
3. Deploy the code.
4. On `/team/permissions`: Expenses › Delete to whoever may delete expenses.

No `npm run db:seed:rbac` needed.

### 4.6 Logs

With `LOG_LEVEL=0`: one `expenses:api` `info` per save with ids only; no typed payer name and no
request body anywhere.

---

## 6. Build record — 12 Oct 2026

Built on `feat/1210-expense-store-department` (from `origin/main` @ `1bb6c5a`), against
`bch_dev_1210`. Parts A and B by hand; C, D, E and G by four parallel agents on disjoint files.

- **Migration** `prisma/migrations/20261012104052_expense_store_and_payer/` — SQL identical to A2;
  applied to `bch_dev_1210` only. **Not applied to test or production.**
- **New:** `src/lib/expenses/assignment.ts`, `src/lib/expenses/filters.ts`,
  `src/app/api/expenses/options/route.ts`, `src/app/api/expenses/totals/route.ts`,
  `src/app/(dashboard)/expenses/_components/*` (list, totals card, URL filters, delete sheet),
  `src/app/(dashboard)/expenses/new/_components/payer-step.tsx`, `use-expense-options.ts`,
  `src/app/(dashboard)/reports/expense-summary/_components/*`.
- **Removed:** `src/app/api/expenses/batch/route.ts` and `expenseRowSchema` / `expenseBatchSchema` (E7);
  the unused batch helpers in `expenses/new/_components/types.ts`.
- **Checks run:** `npx tsc --noEmit` clean; `npx eslint` clean on every changed path; no
  `console.log`; `npm run build` exit 0 with every new route listed; the payer-key SQL verified
  in Postgres (`'  Iqbal ⇥ bhai '` → `iqbal bhai`); signed-out requests to every new route redirect
  to `/login`.
- **Not run:** the signed-in browser pass (§4.2–4.4) — no browser tool in the build session.

Additions beyond the plan, made by the builders and kept:

- Report: `range=all` query parameter for the page's "All" date preset (the shared filter
  defaults to this month); daily average counts days up to today; 400 when the start date is
  after the end date.
- List: waits for permissions before deciding access (it flashed "Access Denied" before); search
  also matches store and payer; the "(not staff)" marker is left off "Bank Transfer" rows.
- Bank path: the payment branches now share the same `paymentModeFromReference` helper and take
  `recordedById` from `requireFeature`, as the expense branch does. An unrecognised reference is
  saved as **CHEQUE** (the payment branch's existing rule); bank-line expenses were always NEFT
  before. The reconcile page's statement and vendor loads moved to `apiTry` with a Retry.

Found and left alone:

- `src/lib/api-client.ts:166` logs every request body at `debug` in the browser, so at
  `NEXT_PUBLIC_LOG_LEVEL=0` a typed payer name reaches the console. Shared by every screen;
  outside this plan. Fix: log the body's keys and size, not its values.
- The bulk ignore and bulk payment branches of the bank review route still run without a
  transaction — plan **D**.

---

## 5. Out of scope, deliberately

- **Departments** — removed by the owner (§0.1b, E1). If wanted later: a `Department` table
  (made inactive, never deleted) and a nullable `Expense.departmentId`, additive.
- **New, renamed or re-hinted categories** (D7).
- **An edit sheet** for store or payer (E8) — delete and re-enter. `PUT` stays without a screen.
- **Linking old typed payer names to staff** (E4) — production has no expenses.
- **`SET NOT NULL` on `Expense.storeId`** — the release after this one, once the old code is gone
  (rule 7) and every row has a store.
- **Creating the Centre store** — owner's data, on Settings › Store management (§1.3).
- **Pushing expenses to Zoho Books** — never done; flagged under the accounting red flag.
- **Reimbursement** of staff who paid from their own pocket.
- **Linking `DailySettlement.cashOut` to cash expenses** — plan **E**.
- **Splitting one bill across stores** in a single entry (E2: enter it per store).
- **Editing amount, date or category after saving.**
- **An Excel export of the report.**
- **`amount Float` → `Decimal`** — done for every money column at once (`docs/schema-review.md`).
- **The dead `sop_departments` default** in `api/settings/route.ts:8-9`.
- **The bank routes' guard** and the *payment* branch's bulk defect — plan **D**.
- **Payroll** (D23).
