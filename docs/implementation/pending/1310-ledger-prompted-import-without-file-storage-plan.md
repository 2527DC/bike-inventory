# Ledger uploads: any Excel with a prompt, a review page before anything is added — and the file is never stored

Status: in-progress — built 13 Oct 2026 (§6). `tsc`, `eslint` and `npm run build` pass. A 25-check end-to-end run on the owner's real LUCIFER ledger passed, and all three sample ledgers tie out to the rupee through the plan code. The AI call itself has not run: no AI is configured on local or test. Not yet on `test`; the browser pass is the owner's.
Branch: **`feat/1310-ledger-prompted-import`** — off `feat/1210-bank-accounts-suspense` (13 Oct 2026), not `test`. All three features add migrations, so stacking them keeps the migration order linear and lets them be tested on one local database. They go to `test` together.

Every `file:line` below was read from disk on 13 Oct 2026, on branch `feat/1210-bank-accounts-suspense`. The ledger code there is unchanged from `test`. The four sample files were read locally only; they were never uploaded anywhere.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (13 Oct 2026)

> and also i need in this https://bike-inventory-delta.vercel.app/ledger/cmnydr87i0005ju04zu5bxq3r where i upload the legdere to  be totaly free  handed wheren when i updlad the files and i need the extarction and things  must be done frended like the  related prompt will be given and related to that  the action must be perfromed  for this dont implment tell me how it can be done  '/Users/chethanr/Projects/BCH/bike-inventory/BHARATH_CYCLE_HUB_All_Invoice.xlsx''/Users/chethanr/Projects/BCH/bike-inventory/LUCIFER LEDGER.xlsx''/Users/chethanr/Projects/BCH/bike-inventory/CULTSPORT_ final.xlsx''/Users/chethanr/Projects/BCH/bike-inventory/Stock as on 09.06.2026 (Pargaon Wh  Ludhiana Wh)-ALL.xlsx'  are the kinde of  file xcel file that i uplaod and  i need a review page after  after   the ai things is done after  the aprove it must be added to the ledger

> i dont need to  store the file   that are been uploaded at the time of ledger or bank state ment

> and I will also be uploading some text, some images, normal PNG images, any kind of things but in the prompt I will give the redirect data

### 0.2 Restated as requirements

1. **R1** — On a vendor's ledger page (`/ledger/[vendorId]`), any Excel file a vendor sends can be uploaded, whatever its layout. The four samples are the benchmark.
2. **R2** — Each upload carries a **prompt** in the owner's own words. The extraction follows the prompt: which columns mean what, what to skip, what to do with the file.
3. **R3** — The AI does the extraction and decides the **action** the prompt asks for, but only from a fixed list of actions.
4. **R4** — A **review page** shows what the AI produced before anything is saved.
5. **R5** — Only **after approve** is it added to the ledger.
6. **R6** — The uploaded **file is not stored**, for a ledger upload or for a bank statement upload. Only what was extracted from it is kept.
7. **R7** — **Any kind of input**, not only Excel: plain text (a file or text typed into the box), images (PNG, JPG and the like), PDFs, CSV and chat exports. All of them use the same flow. **The prompt says what the data is and where it should go**, and the review page and approve step are the same for every kind.

---

## 1. Questions and clarifications

### 1.1 Decisions on record

| Date | Question | Answer |
|---|---|---|
| 13 Oct 2026 | Re-running with a new prompt when the file is not stored — where does the data come from? | **Keep the extracted rows** — the sheet's cell text, not the file — with the run. A re-run needs no new upload. They are dropped when the run is accepted or discarded. |
| 13 Oct 2026 | Proof files attached to a claim or gap (photo or PDF of a credit note) | **Keep storing them.** Only statement and ledger uploads stop being stored; a proof attached to a claim *is* the evidence. |
| 13 Oct 2026 | Ledger files already stored by earlier uploads | **Leave them**, still downloadable. Only new uploads are not stored. |
| 13 Oct 2026 | Build the no-storage change now, or inside this plan? | **Inside this plan.** |
| 13 Oct 2026 | Go-ahead ("go implment it and let me know") | Build. Q1 (a), Q2b (a), Q3 (b) and Q4 (a) are taken on their recommended answers — none was objected to. |
| 13 Oct 2026 | Which file types? (was Q2) | **Any kind** — text, PNG and other images, PDFs, sheets, chats — with the prompt giving the direction (R7). |

### 1.2 Open questions — each has a recommended default

| # | Question | Why it changes the build | Options | Recommended |
|---|---|---|---|---|
| Q1 | The **allowed actions** (R3). | It decides what the AI may ask the code to do. | (a) ledger statement rows; claims and gaps; "not a ledger — refuse with a sentence" (b) as (a), plus "update product prices" | **(a).** A price list like the Stock file gets the answer "This is a price and scheme list, not a ledger — import it on Products". Price updates from a file would be a separate feature with its own review page and permission. |
| Q2 | ~~Files that are not Excel — same new flow?~~ | Answered 13 Oct 2026: **yes, every kind (R7)**. | — | — |
| Q2b | A file type the app cannot read — a Word `.docx`, an audio note, a `.heic` photo from an iPhone. | "Any kind of things" has to stop somewhere, and the screen must say where. | (a) read text, images (PNG, JPG, WEBP; HEIC converted in the browser where it can be), PDF, XLSX, XLS, CSV, TXT, chat ZIP and DOCX (text pulled out in the browser), and refuse anything else with the list of what works; (b) the same list without DOCX | **(a)** |
| Q3 | Very large files on the test site. | A Vercel function takes a request body of about 4.5 MB. Today the file is stored first, then read back; once it is not stored, it must arrive in the same request. | (a) keep the 100 MB limit on the VPS and say plainly on Vercel "files over 4 MB: upload on production"; (b) read the file in the browser and send the extracted rows, not the file | **(b) for sheets:** the browser reads the workbook (the same `xlsx` library) and sends cell text, which is tiny — the Hub invoice export is 52,619 characters. PDFs and images go as files and stay under the limit. |
| Q4 | The bank statement upload. | It already stores no file (§2.1). | (a) nothing to change; (b) also add a prompt box there | **(a) now.** A prompt on the bank upload can follow this plan with the same building blocks. |

---

## 2. How it works today — verified

### 2.1 Bank statement upload — already stores nothing (R6 already met)

`src/app/api/bank-statements/route.ts` reads the file in memory (`:278-286`, xls/xlsx → CSV with `xlsx`) and sends the text to the AI (`:355-362`). It writes `BankStatement` with the **file name only**; there is no storage call anywhere in the file. **No change is needed for R6 here.**

### 2.2 Ledger upload — stores the file, reads it back later

1. **Upload.** `POST /api/ledger/vendors/[id]/uploads` (`brand_ledger.create`, `uploads/route.ts:74`):
   - `storeLedgerFile(...)` (`:94`, `src/lib/brand-ledger/uploads.ts:88`) puts the file in storage;
   - writes `LedgerUpload { kind, fileName, contentType, sizeBytes, fileUrl }` (`schema.prisma:3796-3816`);
   - **refuses to work without storage** (`StorageNotConfiguredError`, `:9`, comment `:70`: "stored nowhere is a refusal").
2. **Run AI.** `POST /api/ledger/uploads/[id]/run` (guard by task, `run/route.ts:40-41`):
   - refuses with 410 if the file is gone (`:51-52`);
   - `runLedgerAi` (`src/lib/brand-ledger/ai-run.ts`) **reads the stored file back** (`:114-115`, `readLedgerFile`, `uploads.ts:114`);
   - writes `LedgerAiRun { task, userPrompt, reply, proposals Json, status }` (`schema.prisma:3837-3853`). Tasks are `STATEMENT_ROWS`, `CLAIMS_FROM_CHAT`, `CLAIMS_FROM_IMAGE` (`:3818-3822`).
3. **Sheets ignore the prompt.** `ai-run.ts:173-174`: for `STATEMENT_ROWS`, an `xlsx`/`xls`/`csv` file goes to `statementFromSheet(fileName, bytes, ctx)` — a fixed reader, **no AI, no prompt**. PDFs and images go to the AI with the prompt (`statementFromDocument`, `:175`). The prompt is sanitised by `sanitizeUserPrompt` (`ai-prompts.ts:22`).
4. **Review.** An inline card on `/ledger/[id]` (`_components/files-card.tsx`) shows the proposals and the opening-to-closing balance check.
5. **Accept.** `POST /api/ledger/runs/[id]/accept` (guard by task, `:96-97`) is the **only** writer:
   - `brandStatement.create` (`:157`) and `brandLedgerEntry.createMany` (`:178`), or `ledgerGap.create` (`:217`);
   - Discard (`runs/[id]/discard`) keeps nothing.

### 2.3 What the fixed reader does with the four samples (read locally, 13 Oct 2026)

| File | What it is | Fixed reader today |
|---|---|---|
| `LUCIFER LEDGER.xlsx` | Vendor ledger: Date, Transactions, Details, AMOUNT, PAYMENT, Balance; mixed dates (1/4/25, 05/04/2025) | **Wrong** — no debit/credit headers, so PAYMENT is ignored and every amount is read as a debit |
| `CULTSPORT_ final.xlsx` | A 5-column summary block, then the ledger from row 5 (Date … Balance, Source), 244 rows from 1/1/23 | **Wrong** — the summary row ("CREDIT NOTES", "DEBIT NOTES") is taken as the header |
| `BHARATH_CYCLE_HUB_All_Invoice.xlsx` | Brand portal export: Invoice No, Posting Date, Debit, Credit, Outstanding, Voucher Type; 810 rows, 52,619 characters | Probably right — the one shape the reader was built for |
| `Stock as on 09.06.2026 (…)-ALL.xlsx` (2 sheets) | Price and scheme list: Item, Code, BDP, MRP, Scheme, Size — **not a ledger** | **Wrong** — no ledger rows can come out of it |

### 2.4 The test site cannot run any of this today

- **No AI:** the test database's `ai_provider` row is `anthropic`, inactive, not connected, no key. `loadActiveAiSettings` (`src/lib/ai/index.ts:101-117`) only falls back to `ANTHROPIC_API_KEY` when the table has **no** rows.
- **No working storage:** storage is `LOCAL` and not connected, which Vercel cannot keep. Every ledger upload on test fails at `storeLedgerFile` before the AI. **R6 removes this blocker for ledger uploads.**

---

## 3. Implementation plan

### Part A — upload and AI in one request, nothing stored (R6)

- **The new entry point** is `POST /api/ledger/vendors/[id]/import`, guarded by `brand_ledger.create`. The browser prepares each input so that what crosses the wire is small, and nothing is stored on either side (R6, R7). **By kind:**
  - **Sheet** (XLSX, XLS, CSV; Q3 b) — the browser reads the workbook with `xlsx` and sends `{ fileName, sheets: [{ name, rows: string[][] }], prompt }`: cell text only, capped at 5,000 rows per sheet and 2 MB of JSON.
  - **Text** — a `.txt` file, or text typed or pasted into the box with no file at all — sent as `{ text, prompt }`, capped at 200,000 characters.
  - **Chat export** (`.txt` / `.zip`) — unzipped in the browser and sent as text, as above.
  - **DOCX** (Q2b) — its text is pulled out in the browser and sent as text.
  - **Image** (PNG, JPG, WEBP; HEIC where the browser can decode it) — the browser **downscales** it to at most 2,000 px on the long side and re-encodes it as JPEG, so a 6 MB phone photo becomes about 400 KB. It is sent with the prompt and read by the AI's vision.
  - **PDF** — sent as the file with the prompt, refused over 4 MB on Vercel with the sentence "Files over 4 MB: upload on production, or send a photo of each page". The VPS keeps the 100 MB limit.
  - **Anything else** — refused before upload, with the list of what works (Q2b).
- **What the route does:**
  - creates a `LedgerUpload` row with `fileUrl: null` — the metadata only;
  - runs the AI (Part B) on the bytes in memory;
  - returns the run id.
  - It calls nothing in `src/lib/storage`.
- **`LedgerAiRun` gains `source Json?`**, the extracted cell text (sheets) or extracted document text, so a re-run needs no upload (§1.1). It is set to `null` when the run is accepted or discarded. Additive migration, nullable, metadata-only on a populated table.
- `POST /api/ledger/uploads/[id]/run` (re-run) reads `run.source`, never `fileUrl`, for uploads made after this change. Old uploads with a stored file still work through `readLedgerFile` (§1.1 "leave them").
- The old `POST …/uploads` stays only for **gap evidence** (§1.1) and the files already stored; the Files card stops using it for statements.

### Part B — the AI writes a plan, the code applies it (R2, R3)

1. **Plan call.** One `runAi({ purpose: "ledger.import_plan" })`:
   - **Input:** up to 40 rows from each sheet, plus the sanitised prompt (`sanitizeUserPrompt`), treated as data.
   - **Output, validated with zod in code:** `{ action: "STATEMENT_ROWS" | "CLAIMS" | "NOT_A_LEDGER", sheet, headerRow, columns: { date, amount | debit + credit, reference?, type?, balance?, description? }, sideRule, dateFormat, skip: [...], dateFrom?, dateTo?, explanation }`.
   - **Refused:** a column index that does not exist, or an action not in the list (Q1).
2. **Apply in code.** Each row is mapped through the plan, reusing `classifyEntry`, `sideForType` and `checkBalance` in `src/lib/brand-ledger/reconcile.ts`. **Amounts come from the cells, never re-typed by the AI**, so this holds for thousands of rows at one AI call.
3. **Text, images, PDFs and chats have no cells to map**, so for them the AI extracts the rows itself — the `statementFromDocument` / `claimsFromChat` patterns, which already read text and images with the prompt. Long text is read in chunks. **Every such row is marked "AI-typed amount — check it"** on the review page, and its source line or crop is shown beside it where the AI gives one. The same fallback covers a sheet whose layout the plan cannot map.
   - The prompt still decides the action (R7): "these are claims from the Hero WhatsApp group" → claims; "this photo is their statement for September" → statement rows; "this is a price list" → not a ledger.
4. **`NOT_A_LEDGER`** ends the run with the AI's sentence ("This is a price and scheme list…"); nothing can be accepted.
5. **New task** `PROMPTED_IMPORT` on `LedgerAiTask` (additive enum value). The plan, the applied rows and the skipped rows are stored in `proposals`.

### Part C — the review page (R4)

`/ledger/[vendorId]/runs/[runId]` (new) — mobile first, `apiTry`, logger `ledger:review`:

- **"What the AI understood"** in plain words: "Sheet1, header row 5, AMOUNT = invoice, PAYMENT = our payment, 38 rows, 1 Apr 25 – 31 Mar 26".
- **A dropdown per column** to correct the mapping, re-applied in code at once. No new AI call.
- **The rows**, each with a tick and an edit box. AI-typed rows are flagged.
- **Rows skipped**, with the reason.
- **Duplicates** against entries already on this ledger (same date, amount, reference), unticked by default.
- **The opening-to-closing balance check** (`checkBalance`). Approve stays disabled while it fails, unless the person ticks "accept with a difference of ₹X", which is recorded on the statement.
- **"Re-run with a new prompt"**, which reads `run.source` and keeps earlier runs listed.

The inline review card on `files-card.tsx` becomes a link to this page.

### Part D — approve writes the ledger (R5)

`POST /api/ledger/runs/[id]/accept` (today's route, `:96-217`) gains:

- the `PROMPTED_IMPORT` task;
- the **edited, ticked** rows from the review page, re-validated with zod and re-checked against `run.proposals` so only reviewed rows can be written;
- `run.source = null` on accept and on discard.

It writes the same rows as today, in one transaction (`BrandStatement` + `BrandLedgerEntry`, or `LedgerGap`), plus `logActivity`. The guard stays by task: `brand_ledger.create` for ledger rows, `brand_ledger_gaps.create` for claims.

### Schema, RBAC, logging

- **One additive migration:** `LedgerAiTask` gains `PROMPTED_IMPORT`; `LedgerAiRun` gains `source Json?`. No new money column, no catalog change.
- **Logging:** `ledger:import` (`info` run created `{ vendorId, runId, sheets, rows }`, `warn` plan refused or not a ledger, `error` AI failure) and `ledger:review` on the client. Never the cell text, never the prompt.
- **Board of agents:** integration-architect (AI as a planner whose output is validated, never trusted); database-architect (nullable `Json` source cleared on accept); frontend-engineer (the review page); accounting-consultant (amounts only from the file; balance check before approve).

---

## 4. Verification

1. **Storage off** (the test site's state today): every upload still works; `LedgerUpload.fileUrl` is null; nothing is written to storage.
2. `LUCIFER LEDGER` with the prompt "AMOUNT is their invoice, PAYMENT is our payment" → the review shows two sides and the balance check passes. **Approve** → entries appear on the ledger, and `run.source` is null.
3. `CULTSPORT_ final` → the summary block is listed under "skipped", and the ledger starts at row 5.
4. `BHARATH_CYCLE_HUB_All_Invoice` (810 rows) → one plan call, every amount equal to its cell.
5. `Stock as on 09.06.2026` → "This is a price and scheme list, not a ledger", and Approve is not offered.
5b. **A PNG photo of a statement page** with "this is their September statement" → statement rows marked "AI-typed — check", the photo was downscaled in the browser, and nothing is in storage.
5c. **Text pasted with no file** ("credit note 1,250 for 3 damaged tyres, 12 Oct") with "add as a claim" → one claim proposed. Approve → a `LedgerGap`.
5d. **A `.mp3`** → refused before upload, with the list of what works.
6. **Re-run** with a different prompt → no upload, a new run, and the earlier one still listed.
7. **Discard** → nothing written, `source` cleared.
8. **Gap evidence** upload still stores its file. Old stored ledger files still download.

---

## 5. Out of scope

- **Updating product prices or schemes from a price list** (the Stock file) — a separate feature (Q1).
- **A prompt box on the bank statement upload** (Q4) — it already stores no file.
- **Deleting ledger files already in storage** (§1.1: leave them).
- **Setting up AI and storage on the test site** — Settings → AI and Settings → Storage. That is the owner's call, and this plan removes only the storage need for ledger uploads.

---

## 6. Build record — 13 Oct 2026

On `feat/1310-ledger-prompted-import`, off `feat/1210-bank-accounts-suspense`.

**Who built what.**

- The lead built the server side:
  - migration `20261013104613_ledger_prompted_import`: enum value `PROMPTED_IMPORT` and nullable `ledger_ai_runs.source` (additive; local only);
  - `src/lib/brand-ledger/prompted-import.ts` (pure, browser-safe): limits, input and plan schemas, `cellText`, `planDate`, `applyPlan`, `tieOut`, `sheetPreview`;
  - `import-prompts.ts` and `prompted-import-run.ts` (the engine);
  - `import-access.ts`;
  - the routes `POST /api/ledger/vendors/[id]/import` and `POST /api/ledger/runs/[id]/rerun`;
  - the changes to `GET runs/[id]`, `accept` and `discard`.
- Two engineers built the screens in parallel:
  - `src/lib/brand-ledger/client-input.ts`, `import-panel.tsx`, `import-notice.tsx` and the Files card;
  - the review page `/ledger/[id]/runs/[runId]` (15 files).
- `review-card.tsx`, superseded, was deleted.

**R6 as built.** The import path makes no storage call. `LedgerUpload.fileUrl` is null for every new upload, and the statement written on approve has no `fileUrl`. A run keeps cells or text (`source`), never an attachment; `source` is cleared on accept and on discard. A FAILED run keeps its cells or text, so it can be re-run once the AI works. Gap evidence still stores its proof, and old stored files keep their download (§1.1).

**What the owner's real files taught the build** (each fix is in the code, and each guess is flagged on the review page):

1. **Dates a day early in India.** SheetJS builds date cells from an 1899 epoch whose Asia/Kolkata offset carries seconds, so every date cell came back at 23:59:50 the day before. `cellText` now rounds to the nearest minute. It is shared, so the old server sheet reader (`ai-run.ts`) is fixed too — that was a live defect wherever the server runs in IST.
2. **A mangled date** ("30/12/202" in LUCIFER) dropped a ₹2,18,113 discount and broke the tie-out by exactly that amount. Such a row now takes the line above's date, flagged.
3. **Excel's US day/month swap** (a typed "2/9/2025" stored as 9 Feb). When the rows either side clearly agree with the swapped date, the swap is used, flagged. Two mis-stored rows cannot vouch for each other.
4. **Journal lines with the same figure in Debit and Credit** (106 in the Hub export) cancel out and are listed as skipped; unequal ones are netted.
5. **A running balance with no opening line** (the Hub export, newest first). The opening is worked back from the oldest row; the closing is the newest row's balance.
6. **The prompt check refused the word "ignore"**, which blocked "ignore the totals row". It now refuses only phrases aimed at the model's rules. The cap was raised from 500 to 2,000 characters (it was 500 for every ledger run).

**Result on the samples** (the plan code, with hand-written plans of the kind the AI returns), all three tying out to the rupee:

| File | Rows | Ties out | Notes |
|---|---|---|---|
| LUCIFER | 37 | ✓ ₹14,86,026 | 3 flagged dates |
| CULTSPORT | 234 | ✓ ₹25,71,987.77 | — |
| Hub export | 704 | ✓ ₹88,87,251.90 | opening ₹64,78,990 worked back; 106 cancelling lines skipped |

**Checks run:**

- `npx tsc --noEmit` is clean; `eslint` on every changed file is clean; `npm run build` exits 0.
- **Engineers' own tests.** The browser reader was tested on all four samples, plus CSV, TXT, pasted text, a chat ZIP, DOCX, PDF and 11 refusal cases (the image path needs a browser). The review page was rendered for 11 run shapes.
- **The lead's 25-check end-to-end run** on localhost with the real LUCIFER file — all passed, and every row was cleaned up:
  - the prompt check, both ways;
  - an import with no AI configured → 501, `fileUrl` null, the run FAILED with its cells kept;
  - a re-run from the failed run reaches the AI;
  - a DONE run built by `applyPlan` is approved → 37 entries, a statement with no file, "AI plan applied in code";
  - approving twice → 409;
  - the duplicate list sees the 37;
  - edited rows that do not tie → 409, then accepted with the difference recorded;
  - "not a ledger" cannot be approved;
  - discard drops `source`;
  - a re-run with nothing kept → 410;
  - four pages answer 200.

**Not run:**

- **The AI call itself:** local and test have no AI key. The prompts, schemas and reply validators are written to the existing ledger pattern, but no real model reply has been seen yet. The first real import on test is the check.
- The image path, in a real browser.
- The signed-in browser pass at 375 px.

**Decisions beyond the plan, kept:**

- **One JSON body for every kind.** PDFs and images are capped at 3 MB everywhere (Vercel's body limit) instead of 100 MB on the VPS. Images are downscaled in the browser, so this binds only PDFs ("send a photo of each page, or split the PDF").
- **The accept route does not compare sent rows against the stored proposals** (Part D said it would). The mapping editor legitimately produces rows that were never proposed. The guard is the permission, and the statement records "rows edited in review".
- **A statement's period follows the rows actually accepted**, and the duplicate list covers all of the vendor's entries — a corrected mapping can widen the dates.
- **The browser request log** (`src/lib/api-client.ts`) now records a body's field names and size, never its values. It had been logging whole bodies, prompts included, at debug level.

**Open:**

- The uploads list shows "0 proposed" for a run that decided "not a ledger" (it does not read the proposals' kind).
