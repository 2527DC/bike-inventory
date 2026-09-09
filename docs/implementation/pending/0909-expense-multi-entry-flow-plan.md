# One expense module, entered a step at a time, several expenses to a single submit

Status: pending
Branch: **`feat/expense-multi-entry`** — create it with exactly this name, off `main`.

Written 9 Sep 2026. Nothing built. Every claim in §2 was read off the code on disk that day
and carries a `file:line`.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (9 Sep 2026)

> cretae a implmenation plan with having teh requirement with it  where i need it    for the
> expences module we can make this like the user clicks on the expense module and  the date is
> autoseleted with current date and  it will be like first it will ask  for the amount and
> category and after that  discription  , should  the paid by be search and selectable  and
> final payment mode selction and attachments  and  submitwhere one expences  creation can have
> more than one expece creatiin at a time before submitting it like confermation we can have the
> review        --> ask any doubtes if u have for creating this implmenation

And, on the category question:

> i think we have the enum ExpenseCategory in the schem where er can use that only

### 0.2 Restated as requirements

| # | Requirement |
|---|---|
| **R1** | The expense module is something a person **clicks into**. Today it is hidden from the sidebar (`route: null`), so this is part of the work, not an assumption. |
| **R2** | On entering, the **date is auto-selected to the current date**. |
| **R3** | Entry is **stepped, in this order**: amount → category → description → paid by → payment mode → attachments → submit. Not one flat form with every field showing at once. |
| **R4** | Category comes from the **existing `ExpenseCategory` enum**. No new enum, no new master table. |
| **R5** | "Paid by" — the owner asked whether it should be search-and-selectable. **Answered: it is the logged-in user, auto-filled and locked** (D2). |
| **R6** | Payment mode is **selected** from the existing `PaymentMode` enum. |
| **R7** | An expense can carry **attachments** — the bill or receipt, as a file or a photo. *Narrowed 9 Sep 2026 (Q2c, Q4a): **one photo**, image only, chosen from the gallery or taken with the camera. No PDF, no video.* |
| **R8** | **More than one expense can be built up in a single session and committed by one Submit.** A batch of one is the ordinary single-expense case. |
| **R9** | Before the batch is committed there is a **review / confirmation step** listing every expense in it. |

---

## 1. Questions and clarifications — answer before build

Each of these is something the code genuinely cannot answer. Recommendations are mine; the
`Answer` column is filled as the owner answers.

| # | Question | Why it changes the build | Options | Recommended | Answer |
|---|---|---|---|---|---|
| **Q1** | Is the batch **atomic**? | Decides whether the route is one `$transaction` or a loop with a per-row result list, and whether the review screen can report partial failure. | (a) all-or-nothing (b) best-effort, report per row | **(a)** — a batch is one act of bookkeeping; half a batch landing is worse than none, and the person is standing right there to retry | **(a)** — 9 Sep 2026 |
| **Q2** | Attachment column shape | `receiptUrl String?` holds one URL. R7 says attachments, plural. | (a) add `attachments String[]` (b) new `ExpenseAttachment` table (c) reuse `receiptUrl` for one file only | **(a)** — matches `ServiceJob.photos`, additive, no join. Filename and MIME are lost; nothing in the product needs them today | **(c)** — 9 Sep 2026. Reuse `receiptUrl`; one photo per expense. **No new column.** |
| **Q3** | Group the batch with a `batchId`? | Without it, ten expenses entered together are indistinguishable from ten entered separately — you cannot find or undo the batch afterwards. | (a) add `batchId String?` + index (b) no grouping | **(a)** — one nullable column, and the only thing that makes "I fat-fingered that whole batch" recoverable | **(b)** — 9 Sep 2026. `recordedById` is enough. **No new column.** |
| **Q4** | Which files may be attached, and how big? | Decides whether the flow compresses, and whether the direct-POST fallback is reachable (4 MB serverless cap — `media-upload.ts:31`). | (a) images only, compressed (b) images + PDF (c) images + PDF + video | **(b)** — real bills arrive as PDFs. Images through `compressImage` (30–150 KB); PDFs capped at 4 MB so both upload paths work | **(a)** — 9 Sep 2026. Images only, picked from the gallery **or taken with the camera**. |
| **Q5** | On the review screen, can a row be **edited**, or only removed and re-added? | Edit means the stepper must reopen with a row loaded; remove-only is a delete button. | (a) edit in place (b) remove and re-add | **(a)** — a typo'd amount on row 7 of 8 should not cost seven re-entries | **(a)** — 9 Sep 2026 |
| **Q6** | Does deleting an expense delete its **stored files**? | Orphaned objects accumulate in the bucket forever, and nothing else in this app cleans up after itself. | (a) leave the objects (b) delete via the existing delete route | **(a)** for this plan, and say so in §5 — cleanup is a bucket-wide concern, not an expense one, and doing it here half-solves it | **(b)** — 9 Sep 2026. `DELETE /api/expenses/[id]` must remove the stored photo. See Part B. |
| **Q7** | **BLOCKER.** May a migration be written before the Prisma baseline lands? | `CLAUDE.md`: *"Until that plan's §3 baseline is marked done, no schema command of any kind runs against production."* `prisma-migrations-adoption-plan.md` is still `Status: pending`. | (a) write it, apply locally, hold production (b) wait for the baseline (c) ship the UI first, schema after | **(a)** — the migration is purely additive (two nullable/defaulted columns), so it is safe to sit committed-but-unapplied. **But nothing goes to production until the baseline is done.** | **(a)** as a standing rule — 9 Sep 2026: Claude may create a migration and apply it to the **local** database only; the owner applies to production and the cloud test database by hand. **Moot for this plan**: Q2(c) + Q3(b) leave the schema untouched, so there is no migration. |
| **Q8** | PDF under the `expenses/` upload prefix | `upload-policy.ts:57` lets only `transfers/` accept `application/pdf`; `:75` rejects anything that is not image or video. Q4(b) would have needed an edit to that file. | (a) add `expenses/` to the PDF rule (b) images only, no policy edit | (a) if Q4(b) | **(b)** — follows from Q4(a). `upload-policy.ts` is not touched. |
| **Q9** | `amount` stays `Float`? | `database-architect.md:56`: money is `Decimal(12,2)`, the existing `Float` columns are a known defect. Converting is an `ALTER COLUMN TYPE` on a populated table. | (a) leave it, name the defect in §5 (b) convert in this plan | **(a)** — it belongs to the schema-review work list, not an entry-flow plan | *unanswered — default (a) applies* |
| **Q10** | Base branch for `feat/expense-multi-entry` | Line 4 says "off `main`". Local `main` may be stale. | (a) `origin/main` after `git fetch` (b) another branch's tip | **(a)** | *unanswered — Claude asks before creating the branch* |

### 1.1 Decisions on record

| # | Decision | Date | Consequence |
|---|---|---|---|
| **D1** | **Target repo is `BCH-Management`.** | 9 Sep 2026 | Not Buildline (no expense code, different stack), not `bike-inventory` (identical model, last commit 31 Jul 2026 — the predecessor). |
| **D2** | **`paidBy` is auto-filled and locked to the logged-in user.** | 9 Sep 2026 | Answers R5. The field leaves the client payload entirely and is derived server-side — see §3 Part B. No user search, no payee master. |
| **D3** | **No approval step.** Submit records the expense as final. | 9 Sep 2026 | The `approve` action already seeded on the `expenses` module (`rbac-catalog.ts:444`) stays unused, as today. |
| **D4** | **Attachments go through the existing storage layer**, not Supabase. | 9 Sep 2026 | `uploadMedia()` → `/api/media/presign` → S3/R2 or local, provider read from `StorageConfig`. Supabase was removed from this repo (`media-upload.ts:11-13`). |
| **D5** | **Category is the existing `ExpenseCategory` enum, unchanged.** | 9 Sep 2026 | Answers R4. No migration for categories. |
| **D6** | **Only date and paid-by are shared across a batch.** | 9 Sep 2026 | Amount, category, description, payment mode and attachments are **per expense**. Cash and UPI can be mixed in one batch. |
| **D7** | **The stepped flow replaces `/expenses/new`.** | 9 Sep 2026 | One way to record an expense. The current flat form is deleted, not kept alongside. |

---

## 2. How it works today — verified against the code

### 2.1 The model already exists, and one of its columns is dead

`prisma/schema.prisma:997-1016`:

```prisma
model Expense {
  id           String          @id @default(cuid())
  date         DateTime
  amount       Float
  category     ExpenseCategory
  description  String
  paidBy       String
  paymentMode  PaymentMode
  referenceNo  String?
  receiptUrl   String?
  notes        String?
  recordedById String
  recordedBy   User            @relation("ExpenseRecordedBy", fields: [recordedById], references: [id])
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  @@index([date])
  @@index([category])
  @@index([recordedById])
}
```

- `ExpenseCategory` — `schema.prisma:159-168`: `DELIVERY`, `TRANSPORT`, `SHOP_MAINTENANCE`,
  `UTILITIES`, `SALARY_ADVANCE`, `FOOD_TEA`, `STATIONERY`, `MISCELLANEOUS`. The owner was
  right that it exists; R4 needs no schema work.
- `PaymentMode` — `schema.prisma:150-157`: `CASH`, `CHEQUE`, `NEFT`, `RTGS`, `UPI`,
  `CREDIT_ADJUSTMENT`. Note the form offers only the first five
  (`expenses/new/page.tsx:17`) — `CREDIT_ADJUSTMENT` is unreachable from the UI today.
- **`receiptUrl` is dead.** It is declared on the model and mirrored in
  `src/types/index.ts:326`, and **no route or page reads or writes it** — it appears in neither
  the POST `data` block (`api/expenses/route.ts:47-58`) nor the PUT one (`[id]/route.ts:37-46`).
  There has never been an attachment on an expense.
- **`paidBy` and `recordedById` are already near-duplicates.** `recordedById` is set from the
  session (`api/expenses/route.ts:57`); `paidBy` is whatever the person typed. D2 makes them
  the same person by rule.

### 2.2 The entry form is flat, and has no attachment control

`src/app/(dashboard)/expenses/new/page.tsx`, 199 lines. Every field renders at once: date
(defaulting to today, `:33`), amount, category `<select>`, description, a free-text **Paid By**
`<input>` (`:150-156`), payment-mode chips, reference no, notes, one submit button. There is no
file input anywhere in the file, and no batching — one POST, one expense, `router.push("/expenses")`.

So against the requirement: **R2 is met today** (`:33`). R1, R3, R7, R8 and R9 are not, and R5
is met by a free-text box that anyone can type anything into.

### 2.3 The API is single-row and trusts the client for `paidBy`

- `POST /api/expenses` (`api/expenses/route.ts:39-65`) — `requireFeature("expenses","create")`,
  `expenseSchema.parse(body)`, one `prisma.expense.create`, `recordedById: user.id`.
- `expenseSchema` (`src/lib/validations.ts:466-475`) — `paidBy: z.string().min(1)`, i.e. the
  client supplies it. Under D2 that becomes wrong: a client could send any name and the server
  would store it.
- `GET` supports `category`, `dateFrom`, `dateTo` and pagination (`:9-36`).
- `PUT`/`DELETE` at `api/expenses/[id]/route.ts`, guarded `expenses.edit` / `expenses.delete`.
- **There is no batch route.** Ten expenses today is ten POSTs from the browser.

### 2.4 The module is hidden from the sidebar

`prisma/rbac-catalog.ts:433-445` carries `route: null` with the comment *"hidden from the
sidebar, not removed … `/expenses` stays reachable by URL and from the dashboard card."* It was
hidden by `sidebar-categories-and-accounts-trim-plan.md` (31 Aug 2026).

The sidebar is built from the `modules` table filtered by the user's `view` grant
(`src/components/app-sidebar.tsx:69-72`) — a null route renders nothing. So **R1 is a
catalog edit plus `npm run db:seed:rbac`, not a code change**, and per `CLAUDE.md` rule 11 that
is data, not a migration.

Today the only ways in are the Accounts card (`accounts/page.tsx:126`) and the dashboard.

### 2.5 The storage layer is ready and has a working precedent

- Resolver: `src/lib/storage/index.ts` — provider comes from the `StorageConfig` row, cached
  30 s, S3/R2 or local.
- Client helper: `uploadMedia(blob, key, contentType)` — `src/lib/media-upload.ts:55`. Presigned
  PUT by default, POST through `/api/upload` as a size-capped fallback when the bucket's CORS
  rule is missing (`:22-31`).
- Compression: `compressImage` — `src/lib/media-compress.ts:91`.
- **Closest working example: `vendor-issues/new/page.tsx:177-180`** — loops over picked files,
  compresses, builds a keyed path, `uploadMedia`, appends the returned URL to a `String[]`.
  The expense flow should look like that, with a different key prefix.

### 2.6 Two live convention violations on the pages we are about to touch

`CLAUDE.md`: *"Never call `fetch().then(r => r.json())` from the browser. Use `apiFetch` /
`apiTry`."* Both expense pages do exactly that — the list at
`expenses/page.tsx:66-67`, and the form at `expenses/new/page.tsx:53-59` (raw `fetch` +
`res.json()`). An expired session returns HTML with status 200, so `res.ok` does not catch it
and the person sees `Unexpected token '<'` instead of being sent to login.

Since D7 rewrites the form and this plan touches the list, both get fixed here rather than left
behind as the only two callers still doing it.

---

## 3. Implementation plan

### Part A — schema: nothing changes

*Rewritten 9 Sep 2026 after Q2(c) and Q3(b).* The original Part A added `attachments String[]`
and `batchId String?`. Both were declined:

- **The photo lives in the existing `receiptUrl String?`** (`schema.prisma:1006`). It has been
  dead since the model was written (§2.1); this plan is the first writer and the first reader.
  One photo per expense, `null` when none was attached.
- **No `batchId`.** `recordedById` plus `createdAt` is the owner's chosen audit trail.

So **there is no migration, no `prisma migrate dev`, no snapshot, and nothing to apply by
hand.** Q7 does not bite. The `src/types/index.ts:326` mirror already carries `receiptUrl?`.

Standing rule recorded under Q7 for any later plan: Claude may write a migration and apply it to
the local database only; production and the cloud test database are applied by the owner.

### Part B — API: one batch route, `paidBy` derived server-side

**New: `POST /api/expenses/batch`** — `src/app/api/expenses/batch/route.ts`

```ts
const log = createLogger("expenses:batch");

// One date and one payer for the batch (D6); everything else per row.
const expenseBatchSchema = z.object({
  date: z.string().min(1),
  expenses: z.array(expenseRowSchema).min(1).max(50),
});
```

- Guard: `requireFeature("expenses", "create")` — two arguments, no role names anywhere
  (`CLAUDE.md`, access control rules 1 and 2).
- `paidBy` is **not accepted from the client**. The route sets `paidBy: user.name` and
  `recordedById: user.id` from the `CurrentUser` that `requireFeature` returns
  (`auth-helpers.ts:10-18, 137-148`). This is what makes D2 true rather than merely displayed.
- ~~`batchId = cuid()`, stamped on every row.~~ *Dropped 9 Sep 2026, Q3(b).*
- One `prisma.$transaction` with `createMany` — Q1(a). The transaction is the whole point of
  the route: every row lands or none does.
- Logging: `log.info("batch recorded", { count, total, recordedById })` on success;
  `log.error("batch failed", { count, reason })` in the catch. Identifiers, never payloads.
- Errors follow the file's neighbours: `AuthError` → `errorResponse(e.message, e.status)`,
  otherwise 400.

**Changed: `src/lib/validations.ts:466-475`**

- `expenseRowSchema` = the per-expense shape: `amount`, `category`, `description`,
  `paymentMode`, `receiptUrl: z.string().url().optional()` *(was `attachments[]`; changed
  9 Sep 2026, Q2c)*, `referenceNo?`, `notes?`.
- **`paidBy` is removed from the client-facing schema.** `expenseSchema` keeps it optional for
  `PUT /api/expenses/[id]`, which still edits historical rows that have a typed name.
- `paymentMode` gains `CREDIT_ADJUSTMENT` in the UI's list, since the enum has always had it
  (§2.1) and the flow is being rewritten anyway.

**Changed: `DELETE /api/expenses/[id]`** (`api/expenses/[id]/route.ts:55-66`) — *added 9 Sep
2026, Q6(b).*

- Read the row first. If `receiptUrl` is set, resolve the provider with `getStorage()`
  (`src/lib/storage/index.ts:94`), turn the URL back into a key with `keyFromUrl`
  (`storage/types.ts:56`) and call `delete(key)` (`types.ts:47`). Precedent:
  `api/services/upload/delete/route.ts:42`.
- **Order: delete the row, then the object.** A row that outlives its photo is a broken link;
  a photo that outlives its row is an orphan, which is the lesser fault. Both providers treat
  deleting an absent object as success (`local.ts:103`, `s3.ts:120`), so a retry is safe.
- A storage failure after the row is gone is logged with `log.warn("receipt not removed",
  { expenseId, key })` and the request still returns success — the bookkeeping action
  succeeded. `tryGetStorage()` (`index.ts:126`) covers the unconfigured case without throwing.
- Scope: `createLogger("expenses:delete")`.

**Unchanged:** `GET`, `PUT`, and `/api/reports/expense-summary` — the report groups by
`category` only (`reports/expense-summary/route.ts:20-24`). `PUT` does not accept
`receiptUrl`; the photo is set at creation and removed with the row, never edited after.

### Part C — the stepped entry flow (replaces `/expenses/new`)

`src/app/(dashboard)/expenses/new/page.tsx` is **rewritten** (D7), with the steps as
components under `src/app/(dashboard)/expenses/new/_components/`.

State: `{ date, rows: ExpenseRow[], draft: Partial<ExpenseRow>, step }`.

| Step | Shows | Meets |
|---|---|---|
| — | Date, defaulted to today, editable once for the whole batch; the payer shown read-only as the signed-in user's name | R2, R5 |
| 1 | **Amount** — big numeric keypad-friendly input, `inputMode="decimal"` | R3 |
| 2 | **Category** — the eight enum values as tappable cards, not a `<select>` | R3, R4 |
| 3 | **Description** | R3 |
| 4 | **Payment mode** — chips, all six values | R3, R6 |
| 5 | **Photo** — two buttons, *Take photo* and *Choose from gallery*; one image, thumbnail, remove; optional *(narrowed 9 Sep 2026, Q2c + Q4a)* | R3, R7 |
| 6 | **"Add another"** or **"Review"** | R8 |
| 7 | **Review** — every row with all fields, per-row edit and remove, batch total, one Submit | R9 |

Rules:
- One step per screen, a back arrow on each, and the running batch count visible throughout so
  the person knows they are 3 expenses in.
- Forward is blocked until the step's field is valid — amount `> 0`, category chosen,
  description non-empty.
- **Editing from review** (Q5) re-opens the stepper with that row loaded and returns to review
  on save.
- The whole thing is client state until Submit. Nothing is written per step; one call to
  `POST /api/expenses/batch`, then `router.push("/expenses")`.
- Reads and writes go through **`apiFetch` / `apiTry`** (`src/lib/api-client.ts`), never raw
  `fetch().json()` — §2.6.
- Client logging: `createLogger("expenses:entry")`, `log.debug` on step transitions with
  `{ step, rowCount }`, `log.error` on a failed submit. No `console.log` anywhere.
- Permission: `usePermissions().canCreate("expenses")` gates the screen cosmetically, exactly as
  the current form does (`expenses/new/page.tsx:12-14`) — the API re-checks (access rule 5).

### Part D — the receipt photo

*Rewritten 9 Sep 2026 for Q2(c), Q4(a).* One image per expense, camera or gallery.

Follows `vendor-issues/new/page.tsx` — the upload loop at `:177-180` and the two hidden inputs
at `:506-518`:

1. Two hidden `<input type="file">`s: one with `accept="image/*" capture="environment"` (forces
   the camera), one with `accept="image/*"` and no `capture` (opens the gallery). **No
   `multiple`** — one photo. The two visible buttons trigger them.
2. Reject anything whose type is not `image/*` with *"Only a photo can be attached."*
   `upload-policy.ts:75` enforces the same rule server-side; `expenses/` is already an allowed
   prefix (`upload-policy.ts:12`), so **that file is not touched**.
3. Image through `compressImage` (`media-compress.ts:91`) — 30–150 KB, so the direct-POST
   fallback (`media-upload.ts:31`) is always reachable.
4. Key: `expenses/${Date.now()}-${random}.${ext}`.
5. `uploadMedia(blob, key, contentType)` → the returned URL becomes the row's `receiptUrl`.
   Picking a second photo replaces the first in client state (the first object is orphaned in
   the bucket until submit-time cleanup — see §5).
6. Upload happens **at the photo step**, not at submit, so the review screen shows a real
   thumbnail and a slow upload never sits inside the transaction.
7. A failed upload surfaces the helper's human-written message — *"Storage is not configured.
   Set it up in Settings → Storage."* is real product behaviour, not a developer error. An
   expense with no photo still submits.

### Part E — make the module clickable, and show attachments in the list

- `prisma/rbac-catalog.ts:441` — `route: null` → `route: "/expenses"`, and remove the stale
  comment above it. **Data, not a migration**: the owner runs `npm run db:seed:rbac` after
  deploy (`CLAUDE.md` migration rule 11). This is all of R1.
- `src/app/(dashboard)/expenses/page.tsx` — add a paperclip indicator when `receiptUrl` is
  set, linking to the photo, and **replace the raw `fetch().then(r => r.json())` at `:65-66`
  with `apiFetch`** (§2.6). Add `receiptUrl?: string` to the `ExpenseItem` interface (`:16-25`).
- Leave the Accounts card (`accounts/page.tsx:126`) and the dashboard link alone — they already
  point at `/expenses`.

### Phases and dependencies

| Phase | Work | Depends on |
|---|---|---|
| ~~**P0**~~ | ~~Part A — schema + migration~~ *removed 9 Sep 2026: no schema change* | — |
| **P1** | Part B — batch route, validation split, `paidBy` server-derived, `DELETE` removes the photo | — |
| **P2** | Part C — the stepper, steps 1–4 and 6 | P1 |
| **P3** | Part D — the receipt photo, step 5 | P2 |
| **P4** | Part C step 7 — review, edit, remove, submit | P2, P3 |
| **P5** | Part E — sidebar route, list page, `apiFetch` fixes | — (independent; can land first) |

One commit per phase.

### Logging

| Scope | Where | Lines |
|---|---|---|
| `expenses:batch` | `api/expenses/batch/route.ts` | `info` on commit with `{ count, total, recordedById }`; `error` on failure with `{ count, reason }` |
| `expenses:delete` | `api/expenses/[id]/route.ts` | `info` on row deleted `{ expenseId, hadReceipt }`; `warn` when the photo could not be removed `{ expenseId, key }` |
| `expenses:entry` | the stepper page | `debug` on each step transition `{ step, rowCount }`; `error` on submit failure |
| `expenses:upload` | the photo step | `debug` per upload `{ ext, bytes }`; `warn` when compression falls back to the original |

No `console.log`. Every `catch` logs before it rethrows or swallows. No file names, no payloads,
no secrets.

### Board of agents — to check before this is called done

| Agent | Why it applies |
|---|---|
| `docs/agents/accounting-consultant.md` | **Expenses is named in its scope.** Whether a locked `paidBy` is acceptable bookkeeping, and whether a batch needs a reference of its own, are its calls. |
| `docs/agents/database-architect.md` | No schema change; the transaction in the batch route, and `amount Float` left as the known defect (Q9). |
| `docs/agents/backend-engineer.md` | New route, zod split, the transaction, the guard. |
| `docs/agents/frontend-engineer.md` | Multi-step mobile flow, loading and error states, the review screen. |
| `docs/agents/integration-architect.md` | Storage — it owns the upload path. |

---

## 4. Verification

**Build and schema**

1. ~~`npx prisma migrate status`~~ — no migration in this plan; `git diff prisma/` is empty.
2. `npm run build` passes. (Start Postgres first — three Staff LMS pages query at build time.)
3. `npm run db:seed:rbac`, then confirm **Expenses** appears in the sidebar for a role holding
   `expenses.view`. That is R1.

**The walk — the whole point, and the thing most plans here skip**

4. Click **Expenses** in the sidebar → **+ New**. The date shows **today** without being touched (R2).
5. The payer shows your own name, read-only, with no way to type another (R5, D2).
6. Enter ₹250 → **FOOD_TEA** → "tea for the counter" → **CASH** → skip attachments → **Add another** (R3).
7. Enter ₹1,200 → **TRANSPORT** → "tempo to Ludhiana" → **UPI** → **Take photo** on a phone opens
   the camera; **Choose from gallery** opens the library. Attach one; the thumbnail renders
   (R7, and cash + UPI in one batch proves D6). Try to pick a PDF → *"Only a photo can be attached."*
8. **Review** shows two rows with every field and a ₹1,450 total (R9).
9. Edit row 1's amount to ₹300 from the review screen; the total becomes ₹1,500 (Q5).
10. Remove row 1, re-add it, **Submit** once.
11. `/expenses` lists both, paperclip on the second only.
12. In the database: both rows have `paidBy` = your name and `recordedById` = your id, and row 2's
    `receiptUrl` holds the photo URL; row 1's is `null`.
13. Open the photo URL — it loads from the configured provider.
14. Delete row 2 from `/expenses` → the row is gone **and** the object is gone from the bucket or
    the local upload directory (Q6b). Delete row 1 → succeeds with no storage call.

**The failure cases**

15. With storage deliberately unconfigured, attaching a photo shows *"Storage is not configured…"*,
    and an expense with no photo still submits.
16. Submit a batch with a deliberately invalid row → **nothing** is written (Q1a).
17. Sign in as a role without `expenses.create` → the screen refuses, and a direct
    `POST /api/expenses/batch` returns 403.
18. Let the session expire, then submit → you land on login, **not** on `Unexpected token '<'` (§2.6).
19. Delete an expense whose photo was already removed from the bucket by hand → the delete still
    succeeds, with a `warn` in the log.

---

## 5. Out of scope, deliberately

- **Approval.** D3. The `approve` action stays seeded and unused; if approval is wanted later it
  is a status column plus a queue screen, not a change to this flow.
- **Grouping or undoing a batch as a unit.** Q3(b), 9 Sep 2026 — no `batchId`. Rows entered
  together are found by `recordedById` and `createdAt`.
- **More than one photo, or a PDF bill.** Q2(c) and Q4(a), 9 Sep 2026. `receiptUrl` holds one
  image. If PDFs are ever wanted, `upload-policy.ts:57` is where `expenses/` joins `transfers/`.
- **Cleaning up a photo that was replaced before submit, or uploaded and then abandoned.** The
  delete route (Q6b) removes the photo of a *saved* expense. A photo uploaded at step 5 and then
  swapped or discarded before Submit stays in the bucket. Bucket-wide orphan cleanup is a
  storage concern, not an expense one.
- **`amount Float` → `Decimal(12,2)`.** Q9 default. It is item 5 on the `docs/schema-review.md`
  work list and is done for all 83 columns at once, not one model at a time.
- **`/api/reports/expense-summary` and the expense-summary screen.** Untouched — grouping by
  category is unaffected.
- **A payee master, or "paid by" as a searchable user picker.** Explicitly closed by D2. If it
  is ever wanted, `paidBy` is still a `String` column and nothing here forecloses it.
- **Posting expenses to Zoho.** No expense has ever been pushed; this plan does not start.
- **Per-store or per-warehouse expense attribution.** The model has no store column and this
  plan does not add one.
- **The other repos.** `bike-inventory` carries an identical `Expense` model and expense pages
  and is **not** changed by this plan (D1). `bch-service-app` has no expense code; a mobile
  version of this flow would consume `POST /api/expenses/batch` and belongs with
  `mobile-stock-api-plan.md`.

---

## Clarifications — 9 Sep 2026

Run of `clarify-plan` against the code on disk. Every §2 claim was re-read; nothing was taken
from the earlier session.

### Verified against code
- `Expense` model, dead `receiptUrl` — CONFIRMED, `prisma/schema.prisma:997-1016`; only other
  reference `src/types/index.ts:326`; no route or page reads or writes it.
- `ExpenseCategory` (8) and `PaymentMode` (6) — CONFIRMED, `schema.prisma:159-168`, `:150-157`.
- UI offers five payment modes — CONFIRMED, `expenses/new/page.tsx:17`.
- Flat form, free-text Paid By, no file input, raw `fetch().json()` — CONFIRMED,
  199 lines, `:51-59`.
- POST single-row, `paidBy` from client — CONFIRMED, `api/expenses/route.ts:46-57`.
- `expenseSchema` used only by POST and PUT — CONFIRMED, two importers.
- No batch route, no `_components/` — CONFIRMED.
- `route: null` on the module — CONFIRMED, `rbac-catalog.ts:442`.
- `CurrentUser.name` available server-side — CONFIRMED, `auth-helpers.ts:12`, `:105`.
- `uploadMedia`, `compressImage`, vendor-issues precedent, camera + gallery inputs — CONFIRMED,
  `media-upload.ts:55`, `media-compress.ts:91`, `vendor-issues/new/page.tsx:177-180`, `:506-518`.
- `expenses/` is already an allowed upload prefix — CONFIRMED, `upload-policy.ts:12`.
- Only `transfers/` accepts PDF — CONFIRMED, `upload-policy.ts:57`, `:75`. Became Q8; moot after Q4(a).
- Storage provider exposes `delete(key)` and `keyFromUrl(url)` — CONFIRMED, `storage/types.ts:47`,
  `:56`; server-side precedent `api/services/upload/delete/route.ts:42`.
- Prisma baseline plan still `Status: pending` — CONFIRMED.
- Nothing built: no branch, no migration, no code — CONFIRMED (`git branch -a`, `prisma/migrations/`).
- `String[]` "defaults to `{}`" — DRIFTED (needs `@default([])`); moot after Q2(c).

### Answers (owner, 9 Sep 2026)
- Q1 atomic batch — **(a)**, one transaction.
- Q2 attachment shape — **(c)**, reuse `receiptUrl`, one photo. No new column.
- Q3 `batchId` — **(b)**, not needed; `recordedById` is enough.
- Q4 file types — **(a)**, image only; the person can pick a photo or take one with the camera.
- Q5 edit on review — **(a)**, yes.
- Q6 delete stored file on expense delete — **(b)**, yes, it must.
- Q7 migrations — Claude may create a migration and apply it to the local database only; the
  owner applies to production and the cloud test database. **No migration exists in this plan**
  after Q2(c) and Q3(b).
- Q8 PDF policy — **(b)**, follows from Q4(a); `upload-policy.ts` untouched.
- Q9 `amount Float` — not answered; default **(a)**, left as is, named in §5.
- Q10 base branch — not answered; Claude asks before creating `feat/expense-multi-entry`.

### Consequences applied to the plan the same day
- Part A rewritten: no schema change, no migration.
- Part B: `batchId` dropped; `attachments[]` → `receiptUrl?`; `DELETE /api/expenses/[id]` now
  removes the stored photo.
- Part C step 5 and Part D: one photo, camera or gallery, image only.
- Part E: paperclip keyed on `receiptUrl`.
- Phases: P0 removed; P1 gains the delete-route change.
- §4 and §5 updated to match.
