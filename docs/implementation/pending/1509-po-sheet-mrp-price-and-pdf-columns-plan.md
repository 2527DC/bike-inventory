# The sheet's MRP becomes the PO line's locked unit price; the PO PDF drops SKU and HSN

Status: in-progress — built 15 Sep 2026 (§6), committed and pushed on the owner's instruction; the owner owes `npm run build` and the browser walk (§4).
Branch: **`feat/remove-static-team-health`**, the existing branch (owner, Q0).

Every `file:line` below was read from disk on 15 Sep 2026. Check rather than trust.

This plan **partly reverses decision D2** of
`docs/implementation/completed/0909-po-sheet-ai-extraction-and-catalogue-free-lines-plan.md`
(§1.1, line 79): *"No code, no HSN, no price from the sheet."* The price now travels from the
sheet; code and HSN still do not.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (15 Sep 2026)

> tell me this how can i need to improve this like in the purchase-orders/new  in this after  i upload ans extract  things and show in the review and after using it i dont what to enter the manually for the uniti peice i want it to take it from the extracted data where it must extract the prodct and its relatde mrp and in the quantiy it must use the same and it must not be editable it must be  non editable for  the price because i need to extract the data from the sheet itself respect to the product  and in the pdf  dont need the sku colum and hsn column

Answers to the first round of questions, same day:

> Which sheet column should become the line's Unit Price? — **by default it must take it as mrp**
>
> How should the extracted price be treated (GST)? — **let the gst be 0 as default**
>
> Quantity: locked or editable? — **quantity must be editable**
>
> A selected row has no price in the sheet? — **Can't be selected**

### 0.2 Restated as requirements

| # | Requirement | Part |
|---|---|---|
| R1 | A PO line built from the uploaded file takes its **Unit Price from the extracted data**: the **MRP** from the same row as the product. Nobody types it. | A, C |
| R2 | That unit price is **not editable** on the line. It is what the sheet said. | C |
| R3 | **Quantity** comes from the sheet, as it does today (1 when the sheet has no quantity column), and **stays editable**. | C |
| R4 | **GST %** on a sheet-built line **defaults to 0**. | C |
| R5 | A review row with **no price in the sheet cannot be selected**. | B |
| R6 | The purchase order **PDF has no SKU column and no HSN column**. | D |
| R7 | (implied by R1) It works for every kind of upload the screen accepts: Excel/CSV through the column step, the *"read it with AI"* rescue, and PDF/photo. | A |

---

## 1. Questions and clarifications — answer before build

Each question changes what gets built. Answering "defaults" to all of them is a complete answer.

| # | Question | Why it changes the build | Options | Recommended default | **Answer** |
|---|---|---|---|---|---|
| **Q0** | Which branch does this build on? | The current branch `feat/remove-static-team-health` has 13 uncommitted files unrelated to this plan. | (a) new `feat/1509-po-sheet-mrp-price` off `origin/main`; (b) off another branch you name | (a) — tell me if `main` is missing work this depends on | |
| **Q1** | A sheet with **no MRP column** (only a dealer price such as BDP): what is the unit price? | "By default MRP" reads as MRP first, but a sheet without MRP would otherwise make every row unselectable (R5). | (a) use the **Price** column when the sheet has no MRP; (b) no MRP → no price → rows cannot be selected | (a). The line shows which one it used ("MRP" / "Price"). | |
| **Q2** | Is the lock **enforced by the server**, or only on the screen? | CLAUDE.md: *"Frontend checks are cosmetic. The API must re-check."* A screen-only lock can be bypassed by a crafted request, and the PDF goes to the vendor. | (a) each sheet line carries its review-row id; the server reads the stored price from that row and **ignores the price the browser sent**; (b) screen only | (a). Side effect: lines taken from a sheet that was **replaced** by a later upload can no longer be submitted. The screen names them and asks you to remove and re-select them. | |
| **Q3** | GST 0 by default: is it still **editable**? And the lines carried over from **/reorder**? | Decides whether GST is an input or fixed text. | (a) sheet lines default to 0 and stay editable; /reorder lines keep the product's own rate, as today; (b) sheet lines fixed at 0 | (a) | |
| **Q4** | Drop SKU and HSN from **every** PO's PDF, including /reorder orders that do have a product SKU and HSN, and already-created orders? | The PDF is rendered on request (`pdf/route.ts:23-26`), so older POs change too. PDFs already emailed are stored snapshots and do not change. | (a) every PO; (b) only POs with no linked product | (a). That is what "in the pdf don't need the sku column and hsn column" says. | |
| **Q5** | A sheet with **two MRP-looking columns** (e.g. "MRP" and "New MRP"): which one wins? | Today only Item name and Quantity are one-per-sheet (`columns-step.tsx:90-95`, `prompts.ts:198-204`). | (a) one MRP column per sheet, like Item name: marking a second column MRP moves the role, and the old one becomes "Other"; (b) leftmost wins silently | (a). Same for Price. You see and fix it on the column step. | |

### 1.1 Decisions on record

| # | Decision | Date |
|---|---|---|
| D1 | The unit price is the row's **MRP**. | 15 Sep 2026 |
| D2 | GST % defaults to **0** on sheet lines. | 15 Sep 2026 |
| D3 | Quantity stays **editable**. | 15 Sep 2026 |
| D4 | A row with no price **cannot be selected**. | 15 Sep 2026 |
| Q0 | Build on the **existing** branch `feat/remove-static-team-health` — *"implent in the existing brand itself"*. Its unrelated uncommitted work is left alone. | 15 Sep 2026 |
| Q1–Q5 | Owner: *"if u have clarification start implmenating it"*. All five run on their recommended defaults: MRP else Price; server-enforced lock; GST 0 editable, /reorder lines unchanged; SKU/HSN off every PO's PDF; one MRP and one Price column per sheet. | 15 Sep 2026 |

---

## 2. How it works today — verified against the code

### 2.1 The extraction reads price and MRP, then throws them away

- **Column roles already include both.** `ColumnRole` has `price` ("a dealer / purchase price") and `mrp` ("the MRP or retail price"): `src/lib/po-extraction/types.ts:12-24`, `src/lib/po-extraction/prompts.ts:63-64`. On the sample workbook the AI tags `BDP` = Price and `MRP` = MRP (0909 plan §4 step 2).
- **Excel/CSV, deterministic read.** `extractRows` looks up only the item-name and quantity columns (`src/lib/po-extraction/sheet.ts:368-369`). Each row stores `name`, `quantity` and the display text of every kept column (`sheet.ts:419-427`). Price and MRP survive only as strings in `columns`.
- **The rescue read.** `ROWS_SCHEMA` asks for `sheet, name, quantity, columns` and nothing else (`prompts.ts:234-266`). `validateRowsReply` keeps the same (`prompts.ts:296-322`).
- **PDF/photo.** `parsePdfWithAIDetailed` already returns `brandPrice` and `brandMrp` as numbers (`src/lib/pdf-parser.ts:95-96`). The upload route writes them only as text columns "Price" and "MRP" (`src/app/api/purchase-orders/extract/route.ts:219-225`).
- **The columns route** writes rows without price or MRP (`src/app/api/purchase-orders/extract/[id]/columns/route.ts:98-110`).
- **The database has room.** `PoExtractionItem.price` and `.mrp` are `Decimal(12,2)` (`prisma/schema.prisma:3883-3884`), created in `20260909101928_po_extraction/migration.sql:27-28` and unwritten since D2. No migration drops them. **No schema change is needed.**
- **The view carries neither.** `ExtractionItemRow` (`src/lib/po-extraction/store.ts:52-62`), `serializeItem` (`store.ts:134-149`) and `ExtractionItemView` (`types.ts:80-97`).

### 2.2 The line is typed

- `sheetLine` sets `unitPrice: 0` and `gstRate: 18` (`src/app/(dashboard)/purchase-orders/new/_components/sheet-import.tsx:28-35`).
- The Unit Price is an `<Input>` that is always editable, amber when empty (`new/_components/vendor-section.tsx:222-242`). Quantity and GST are inputs too (`vendor-section.tsx:210-253`).
- `useSelectedLines` copies the line as-is (`new/page.tsx:243-256`). The POST sends `name, quantity, unitPrice, gstRate, productId?` with no link back to the review row (`page.tsx:280-286`).
- The item schema has no such link (`src/lib/validations.ts:452-472`). `createPurchaseOrder` stores the browser's `unitPrice` and defaults `gstRate` to 18 (`src/lib/purchase-orders/create.ts:281-289`). A ₹0 line is refused (`create.ts:253-263`).
- The column step tells the person *"Only the item name and a quantity reach the purchase order"* (`new/_components/columns-step.tsx:108-110`). That becomes false.

### 2.3 Any row can be selected

- The one-row PATCH updates `selected` unconditionally (`src/app/api/purchase-orders/extract/[id]/items/[itemId]/route.ts:38-42`). So does the bulk select (`extract/[id]/select/route.ts:36-40`).
- The review's checkbox is enabled for every row (`new/_components/sheet-review.tsx:408-415`). *"Select all N shown"* sends every visible unselected row (`sheet-review.tsx:334-341`).

### 2.4 The PDF prints SKU and HSN

- Header `["#", "SKU", "Description", "HSN", "Qty", "Rate", "GST %", "Amount"]` with fixed widths per column index (`src/lib/purchase-orders/pdf.ts:195-217`). `PoPdfLine` carries `sku` and `hsnCode` (`pdf.ts:18-30`).
- Two callers map them from the linked product: the preview/download route (`src/app/api/purchase-orders/[id]/pdf/route.ts:72, 83-91`) and the email send (`src/app/api/purchase-orders/[id]/send/route.ts:111, 152-155`). The email body (`src/lib/purchase-orders/email.ts`) does not mention SKU or HSN.
- The PO list's own PDF export (`src/app/(dashboard)/purchase-orders/page.tsx:109`) lists orders, not lines. It is unaffected.

### 2.5 A money parser exists twice

`toNumber` in `src/lib/excel-parser.ts:77-81` (not exported) and `parseAmount` in `src/lib/brand-ledger/reconcile.ts:48-52` do the same thing: strip `₹`, commas and spaces. Neither handles `Rs.` or `/-`, which Indian price lists use.

---

## 3. Implementation plan

No migration. No RBAC change. No new dependency.

### Part A — the extraction keeps the price

| # | File | Change |
|---|---|---|
| A1 | `src/lib/po-extraction/sheet.ts` | `ExtractedRow` gains `price: number \| null` and `mrp: number \| null`. `extractRows` finds the `price` and `mrp` columns next to `nameCol`/`qtyCol` and reads them with a new `parsePrice(text)`. It strips `₹`, `Rs`, `Rs.`, `/-`, commas and spaces, and returns a finite number > 0 or `null`. "On request", `-` and `0` all give `null`. The `sheet extracted` debug line gains `rowsWithMrp` and `rowsWithPrice`. |
| A2 | `src/lib/po-extraction/prompts.ts` | `ROWS_SCHEMA` and `buildRowsPrompt` gain nullable `price` and `mrp` numbers per row. `validateRowsReply` keeps them only when finite and > 0. Q5: `validateColumnsReply` demotes a second `price` or `mrp` column to `other`, as it already does for `quantity`. |
| A3 | `extract/[id]/columns/route.ts`, `extract/route.ts` | Both `createMany` calls write `price` and `mrp`. The PDF path takes them from `brandPrice` and `brandMrp` when > 0. |
| A4 | `src/lib/po-extraction/types.ts`, `store.ts` | `ExtractionItemView` gains `unitPrice: number \| null` and `priceSource: "mrp" \| "price" \| null`. The value is MRP, else Price (Q1 a), else null. `serializeItem` converts the Prisma `Decimal` with `Number()`. The rule lives in **one** exported function, `unitPriceOf(row)`, which the server lock (C5) reuses. |
| A5 | `new/_components/columns-step.tsx` | Q5: `setRole` makes `price` and `mrp` one-per-sheet, like `itemName`. The helper text at 108-110 becomes: *"The item name, quantity and MRP reach the purchase order…"* |

### Part B — rows without a price cannot be selected (R5)

| # | File | Change |
|---|---|---|
| B1 | `extract/[id]/items/[itemId]/route.ts` | Selecting (`selected: true`) a row where `unitPriceOf` is null → **400** *"This row has no price in the sheet, so it cannot be ordered."* Unselecting is always allowed. |
| B2 | `extract/[id]/select/route.ts` | When `selected: true`, the `updateMany` filter adds `OR: [{ mrp: { not: null } }, { price: { not: null } }]`. The answer gains `skipped` (requested − updated), logged. |
| B3 | `new/_components/sheet-review.tsx` | Priceless row: checkbox disabled, a grey **"No price"** chip beside the name, `aria-label` says why. *"Select all N shown"* counts and sends only priced rows. A priced row shows its unit price in the first cell's chip area, so you can check it against the sheet before ticking. |

### Part C — the line: price locked, qty editable, GST 0 (R1–R4)

| # | File | Change |
|---|---|---|
| C1 | `new/_components/sheet-import.tsx` | `sheetLine` → `unitPrice: item.unitPrice`, `gstRate: 0`, `extractionItemId: item.id`, `priceSource`. |
| C2 | `new/_components/vendor-section.tsx`, `lib/po-extraction/types.ts` | `POLineItem` and `SheetLine` gain `extractionItemId?` and `priceSource?`. When `extractionItemId` is set, the Unit Price is **read-only text** (e.g. "₹1,250.00 · MRP from sheet") instead of an `<Input>`, and `update()` refuses `unitPrice` for that line. Qty and GST stay inputs. /reorder lines are unchanged (Q3). |
| C3 | `new/page.tsx` | `useSelectedLines` carries the new fields. The POST sends `extractionItemId` on sheet lines. |
| C4 | `src/lib/validations.ts` | The item schema gains `extractionItemId: z.string().min(1).optional()`. |
| C5 | `src/app/api/purchase-orders/route.ts` + new `applySheetPrices()` in `store.ts` | **Q2 a.** Before `createPurchaseOrder`: if any line carries `extractionItemId`, `extractionId` is required. Load those rows scoped to `extraction.createdById = user.id` **and** `extraction.vendorId = body.vendorId`. A missing row → 400 naming the lines (*"from a sheet that was replaced — remove them and select again"*). A row with no price → 400. Otherwise **overwrite `unitPrice` with `unitPriceOf(row)`**. `create.ts` is untouched: it still refuses ₹0 and still computes amounts. Logs: `info "sheet prices applied" { extractionId, lines }`; `warn` with the ids of refused lines. |

### Part D — the PDF (R6)

| # | File | Change |
|---|---|---|
| D1 | `src/lib/purchase-orders/pdf.ts` | Header → `["#", "Description", "Qty", "Rate", "GST %", "Amount"]`. `columnStyles` re-indexed; Description takes the freed width. `sku` and `hsnCode` removed from `PoPdfLine`. |
| D2 | `[id]/pdf/route.ts`, `[id]/send/route.ts` | Stop selecting `product: { sku, hsnCode }` and stop mapping them. The comments about HSN at `pdf/route.ts:62-66` are rewritten. |

### Phases and dependencies

A → B → C in order (B and C read A's `unitPriceOf`). D is independent and can be built in parallel. One agent for D; A, B and C are one chain.

### Logging

Every new branch logs through `createLogger`, with identifiers only (extractionId, itemId, counts), never a row's name or price text. Every new `catch` logs before it answers.

### Board of agents — flags to raise before "done"

- **Accounting consultant.** The PO rate is now the **MRP**, the retail price, not the dealer price (BDP) the vendor bills. The PO total will be higher than the vendor's bill, and a later bill-to-PO match will show every line as a variance. This is the owner's explicit choice (D1). Flagged, not changed.
- **GST consultant.** HSN is mandatory on a **tax invoice**, not on a purchase order, so removing it from the PO PDF is compliant. GST 0 by default means the PO shows no tax. Also acceptable, since MRP is tax-inclusive, but the vendor's invoice will carry GST.
- **Backend engineer.** The price lock is re-checked on the server (C5), not only hidden in the UI.
- **Frontend engineer.** Read-only price is text, not a disabled input. Tap targets stay ≥ 44 px. The disabled checkbox says why.

---

## 4. Verification

1. `npx tsc --noEmit` (Claude). `npm run build` (owner, per the 8 Sep rule for plan work).
2. Browser, `/purchase-orders/new`, with the sample vendor workbook:
   - Column step: `MRP` is tagged MRP. Marking a second column MRP moves the role (Q5).
   - Review: rows with an MRP show it. Rows without one show **No price** and cannot be ticked. *Select all shown* skips them.
   - *Use N selected rows*: each line shows the MRP as read-only text, Qty 1 and editable, GST 0 and editable.
   - Submit: the PO's stored `unitPrice` equals the sheet's MRP.
   - *Download PDF*: columns are `# · Description · Qty · Rate · GST % · Amount`.
3. Tamper test (Q2 a): the same POST with `unitPrice` edited in devtools stores the MRP, not the edited value.
4. Replaced upload: take lines from sheet 1, upload sheet 2, and submit. You get a 400 naming the stale lines.
5. The rescue read (*"This is wrong — read it with AI"*) and a PDF upload both come back with prices.
6. A /reorder handoff still has an editable rate with the product's GST (Q3).

---

## 5. Out of scope, deliberately

- **/reorder lines.** Their price stays editable and prefilled from cost price. They do not come from a sheet.
- **The PO detail page** still shows a linked product's SKU (`src/app/(dashboard)/purchase-orders/[id]/page.tsx:449-452`). R6 is about the PDF.
- **The PO list PDF export** (`purchase-orders/page.tsx:109`): it has no line columns.
- **Dropping `PoExtractionItem.matchStatus` / `matchConfidence`**, marked for removal in the 0909 plan: not this plan.
- **PDFs already emailed** are stored snapshots and keep their SKU and HSN columns.
- **An extraction open at deploy time** has no stored prices. Its rows read as "No price" until the sheet is uploaded again. No backfill.
- `docs/manual-testing/090926-four-plans-verification.md` §7 still describes a typed price. It gets updated when this ships, not before.

---

## 6. Build record — 15 Sep 2026

Built on `feat/remove-static-team-health`. Committed and pushed 15 Sep 2026 on the owner's
instruction (*"make a commit as of now and push it"*). It is one commit that also carries the
owner's other in-progress work from the same tree. Parts A–C by this session; Part D by one sub-agent in
parallel, its diff reviewed line by line. 18 files, +381 / −76 (the `sheet.ts` count includes
another session's unrelated `maxTokens: 8000` line).

| Part | Files |
|---|---|
| A | `po-extraction/sheet.ts` (`parsePrice`, price/mrp per row), `prompts.ts` (rescue schema, one Price/MRP per sheet), `types.ts`, `store.ts` (`unitPriceOf`, `PRICED_ROW`, `applySheetPrices`), `extract/route.ts`, `extract/[id]/columns/route.ts`, `new/_components/columns-step.tsx` |
| B | `extract/[id]/items/[itemId]/route.ts` (400 on ticking a priceless row), `extract/[id]/select/route.ts` (skips them), `new/_components/sheet-review.tsx` ("Unit price" column, "No price" chip, disabled checkbox) |
| C | `new/_components/sheet-import.tsx`, `vendor-section.tsx` (read-only rate, `formatRate`), `new/page.tsx`, `lib/validations.ts`, `api/purchase-orders/route.ts` (server re-reads the price) |
| D | `lib/purchase-orders/pdf.ts`, `[id]/pdf/route.ts`, `[id]/send/route.ts` |

**Checked:**
- `npx tsc --noEmit`: exit 0.
- The real extraction code, run with no AI and no database on the sample workbook
  `docs/asset/Stock as on 04.09.2026 (Pargaon Wh & Ludhiana Wh)-ALL.xlsx`, with the
  columns confirmed as the column step would:
  - Pargaon WH: 267 of 267 rows priced from MRP.
  - Ludhiana WH: 122 of 122 rows priced from MRP.
  - 0 rows unpriced.
  - Example: *DODGE ACE DX 24 SS IX* → MRP 13,990, BDP 7,790, unit price 13,990.
- `parsePrice` handles `₹ 1,250`, `Rs. 1,250/-`, `INR 99.5` and `1250 /-`, and returns null for "On request", "-" and "0".
- The rescue validator drops non-numeric and non-positive prices. A second MRP or Price column is demoted to Other.

**Not checked:**
- `npm run build`, owed by the owner.
- The browser walk (§4): the dev server was not running.
- The tamper and replaced-upload cases (§4 items 3–4) need a logged-in session.

**Board of agents, as flagged in §3.** The accounting flag is now concrete: on the sample,
a PO at MRP is about 80 % above the dealer price the vendor will bill.
