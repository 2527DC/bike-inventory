# A purchase order is the product and the quantity — no price, no GST, anywhere

Status: in-progress — built 15 Sep 2026 (§6), uncommitted; the owner owes `npm run build` and the browser walk (§4).
Branch: **`feat/remove-static-team-health`** — the existing branch (owner, 15 Sep 2026). Its unrelated uncommitted stock-count work is left alone.

Every `file:line` below was read from disk on 15 Sep 2026. Check rather than trust.

This plan **reverses** the price half of
`docs/implementation/pending/1509-po-sheet-mrp-price-and-pdf-columns-plan.md` (R1, R2, R4, R5 — the
locked MRP, GST 0, "no price → cannot be selected"), built and pushed earlier the same day in `a40c352`.
That plan's R6 (no SKU/HSN on the PDF) stays and is taken further.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (15 Sep 2026)

> in this /purchase-orders/new screen in the po pdf and even i dont need anything except the product and the quantity   thats it donte need gst , price  ntg even after comferming from the revire even in the review just show the product listing dont need any other columns not even the mrp

Answers to the first round of questions, same day:

> Should a PO raised on /purchase-orders/new still carry a price at all? — **No price at all**
> (every line is product + qty, /reorder lines included; the PO total is ₹0; rows with no MRP become selectable again)
>
> In the review, what should each row show? — **Checkbox + product name**
>
> Which should drop the price too? — **Email to vendor, WhatsApp message, PO detail page**
>
> Which branch? — **same branch**

### 0.2 Restated as requirements

| # | Requirement | Part |
|---|---|---|
| R1 | The **PO PDF** lists only **product and quantity**. No Rate, GST %, Amount columns and no Subtotal / GST / Grand Total block. | D |
| R2 | The **review** shows only a checkbox and the **product name** per row. No other sheet column, and not the MRP. | B |
| R3 | After **"Use selected"**, a line on `/purchase-orders/new` is the product name and an **editable quantity**. No unit price, no GST, no line amount, no totals. | C |
| R4 | A purchase order **carries no price at all**. It stores no rate and no GST. This applies to sheet lines and to lines carried over from /reorder, and it is enforced by the server, not only hidden on the screen. | C, E |
| R5 | A review row with **no MRP in the sheet can be selected**, because price no longer matters. This undoes plan 1509's R5. | B |
| R6 | The **email to the vendor** does not state a total. | D |
| R7 | The **WhatsApp message** on the PO page lists products and quantities only, with no per-line price and no total. | F |
| R8 | The **PO detail page** (`/purchase-orders/[id]`) shows no rate, GST, line amount or totals. | F |

---

## 1. Questions and clarifications

### 1.1 Decisions on record

| # | Decision | Date |
|---|---|---|
| D1 | No price at all on a PO raised from this screen, /reorder lines included. The stored rate, GST and totals are 0. | 15 Sep 2026 |
| D2 | The review shows a checkbox and the product name. The sheet's row colour and the colour filter stay: they are highlighting, not columns. Search matches the product name only. | 15 Sep 2026 |
| D3 | The price also comes off the vendor email, the WhatsApp message and the PO detail page. | 15 Sep 2026 |
| D4 | Build on `feat/remove-static-team-health`. | 15 Sep 2026 |
| Q6–Q8 | Owner: *"go ahead with your defaults where we dont need the money in the po itself ntg only product and quantity thats it keep our gst ok older stop showin the the money and the gst"*. **Q6 (a)**: the PO list and its export drop Total. **Q7 (a)**: both GSTIN lines stay on the PDF. **Q8 (a)**: price and GST are hidden on every PO, older ones included. | 15 Sep 2026 |

### 1.2 Still open — each has a recommended default; confirm with the plan

| # | Question | Why it changes the build | Options | Recommended default | **Answer** |
|---|---|---|---|---|---|
| **Q6** | The **PO list** (`/purchase-orders`) has a **Total** column and a "Grand Total" column in its export. New POs will read ₹0 there. | You didn't list it, and without a change every new order shows ₹0 on the list. | (a) remove Total from the list and its export; (b) leave it | (a), which matches "don't need price, nothing". | |
| **Q7** | The PDF header prints **our GSTIN** and the **vendor's GSTIN**. They identify the two businesses; they are not a charge. | "Don't need GST" could mean these too. | (a) keep both GSTIN lines; (b) remove them | (a). A PO with no identity on it reads as an unofficial document. | |
| **Q8** | **Older POs** that were created with prices: once the detail page and the PDF stop printing price, those prices disappear from view too. The data is not deleted. | One PDF renderer and one detail page serve every PO. Showing price on old POs only would mean keeping two layouts. | (a) hide price on every PO, old and new; (b) show it when the stored total is above 0 | (a). One layout, the one you asked for. | |

---

## 2. How it works today — verified against the code

### 2.1 The PDF prints price, GST and totals
- The table header is `["#", "Description", "Qty", "Rate", "GST %", "Amount"]` (`src/lib/purchase-orders/pdf.ts:195-203`), followed by a Subtotal / GST / Grand Total block (`pdf.ts:221-243`).
- `PoPdfLine` carries `unitPrice`, `gstRate` and `amount`. `PoPdfInput` carries `subtotal`, `gstTotal` and `grandTotal` (`pdf.ts:22-41`).
- Two callers build the input, and both select those fields: the preview/download route (`src/app/api/purchase-orders/[id]/pdf/route.ts:41-43, 67-69, 80-97`) and the email send (`src/app/api/purchase-orders/[id]/send/route.ts:94, 111, 152-158, 190-192`).
- The company and vendor GSTIN lines are at `pdf.ts:128` and `pdf.ts:178` (Q7).

### 2.2 The review shows every sheet column plus the price
- Each row renders a checkbox, a **Unit price** cell, and one cell per non-ignored sheet column (`src/app/(dashboard)/purchase-orders/new/_components/sheet-review.tsx:396-468`).
- A row with no price cannot be ticked, either on screen (`sheet-review.tsx:430`, `168-172`, `373-377`) or on the server: the one-row PATCH refuses it (`src/app/api/purchase-orders/extract/[id]/items/[itemId]/route.ts:39-42`) and the bulk select filters it out (`extract/[id]/select/route.ts:9, 40, 47-49`).
- Search matches the name **and** every column value (`sheet-review.tsx:161-163`).

### 2.3 The line on the screen has a locked rate, GST and totals
- `sheetLine` sets the unit price from the review row, sets `gstRate: 0`, and sets `extractionItemId` and `priceSource` (`new/_components/sheet-import.tsx:30-40`). `useSelected` drops rows that have no price (`sheet-import.tsx:188-200`).
- `POLineItem` has `unitPrice`, `gstRate`, `extractionItemId` and `priceSource` (`new/_components/vendor-section.tsx:20-33`). The line renders Qty, a locked or typed Unit Price, GST %, a line amount, and a Subtotal / GST / Grand Total card (`vendor-section.tsx:225-305`). A ₹0 line blocks submit (`vendor-section.tsx:131, 136, 351-356, 384`).
- `/reorder` lines take `costPrice` as the rate (`new/page.tsx:57-66`). The page blocks "Create all" on ₹0 lines (`page.tsx:272, 358, 484-487`) and POSTs `unitPrice`, `gstRate` and `extractionItemId` (`page.tsx:288-298`).
- The column step says the MRP reaches the PO (`new/_components/columns-step.tsx:110-112`).

### 2.4 The server enforces a price
- The item schema requires `unitPrice` and accepts `gstRate` and `extractionItemId` (`src/lib/validations.ts:469-485`). `purchaseOrderSchema` has exactly one user: `api/purchase-orders/route.ts:85`.
- `applySheetPrices` overwrites a sheet line's rate from the stored review row, and refuses stale or priceless rows (`src/lib/po-extraction/store.ts:351-427`, called at `api/purchase-orders/route.ts:87-94`). It uses `unitPriceOf`, `PRICED_ROW` and `positive` (`store.ts:138-161`). `serializeItem` spreads `unitPriceOf` into the view (`store.ts:173`).
- `createPurchaseOrder` refuses a ₹0 line through `onPricelessLine` (`src/lib/purchase-orders/create.ts:50-65, 183, 246-279`). It defaults GST to 18 and computes `amount`, `subtotal`, `gstTotal` and `grandTotal` (`create.ts:281-293, 332-334`). Its **only** caller is `api/purchase-orders/route.ts:101`.
- `PurchaseOrderItem.unitPrice` and `.amount` are required `Float`s, and `gstRate` defaults to 18 (`prisma/schema.prisma:1174-1176`). Writing `0` needs no migration.
- `ExtractionItemView.unitPrice` / `priceSource`, `PriceSource` and `SheetLine`'s price fields: `src/lib/po-extraction/types.ts:81-100, 139-153`.

### 2.5 Email, WhatsApp, detail page
- The email body prints `Total: ₹…` in both the text and HTML versions (`src/lib/purchase-orders/email.ts:8-9, 73, 98`). The send route passes `grandTotal` (`send/route.ts:223`).
- WhatsApp: `- name (sku): N pcs @ ₹price`, then `Total: ₹…` (`src/app/(dashboard)/purchase-orders/[id]/page.tsx:157-164`).
- Detail page: each line shows its amount, `@ ₹rate` and `GST: n%` (`[id]/page.tsx:455-461`), followed by a Subtotal / GST / Grand Total card (`[id]/page.tsx:468-484`). The type is at `[id]/page.tsx:18-59`, and `formatCurrency` at `61-63`.
- The PO list shows `grandTotal` (`src/app/(dashboard)/purchase-orders/page.tsx:27, 163, 208`) (Q6).

### 2.6 Where a ₹0 PO lands, and nothing breaks
- The approve route selects `grandTotal` (`api/purchase-orders/[id]/approve/route.ts:41`) and nothing else there reads it.
- `api/reports/purchase`, `api/accounts/summary` and the vendor pages sum PO totals. New POs will add ₹0 to them. That follows from D1; see §3 *Board of agents*.

---

## 3. Implementation plan

No migration: 0 fits the existing columns. No RBAC change, and no new dependency.

### Part E — the server stores no price (R4)

| # | File | Change |
|---|---|---|
| E1 | `src/lib/validations.ts` (PO section only; this file has unrelated uncommitted edits, which are left alone) | The item object loses `unitPrice`, `gstRate` and `extractionItemId`. Zod strips unknown keys, so an old tab that still sends a rate has it dropped at the gate. |
| E2 | `src/lib/purchase-orders/create.ts` | `PoLineInput` loses `unitPrice` and `gstRate`. Every line is written with `unitPrice: 0, gstRate: 0, amount: 0`, and the header with `subtotal / gstTotal / grandTotal: 0`. The `onPricelessLine` option, `SkippedLine`, `skipped` and the ₹0 loop (`create.ts:50-65, 82-88, 104-105, 183, 246-279`) are removed: they exist only to police a price, and the one caller passes `"reject"`. The activity details and the `purchase order created` log drop `skipped`. |
| E3 | `src/app/api/purchase-orders/route.ts` | Drop the `applySheetPrices` call and the `onPricelessLine` option. The `extractionId` consumption (`route.ts:109-124`) stays. |
| E4 | `src/lib/po-extraction/store.ts` | Remove `unitPriceOf`, `PRICED_ROW`, `positive`, `SheetPriceResult`, `listNames` and `applySheetPrices`. `serializeItem` stops adding the price. `ExtractionItemRow` keeps `price` and `mrp` only if a select still reads them; otherwise they are dropped from the type. |
| E5 | `src/lib/po-extraction/types.ts` | Remove `PriceSource`, `ExtractionItemView.unitPrice` / `priceSource`, and `SheetLine.extractionItemId` / `unitPrice` / `priceSource` / `gstRate`. `SheetLine` becomes `{ key, name, quantity }`. |

### Part B — the review: checkbox + product name (R2, R5)

| # | File | Change |
|---|---|---|
| B1 | `extract/[id]/items/[itemId]/route.ts` | Remove the "no price" refusal and the `unitPriceOf` import. |
| B2 | `extract/[id]/select/route.ts` | Remove the `PRICED_ROW` filter and the `skipped` count. The response goes back to `{ selectedCount }`, which is all `sheet-review.tsx:229-234` reads. |
| B3 | `new/_components/sheet-review.tsx` | The table becomes two columns: the checkbox and **Product**, which shows the name with its legend chip. The Unit price column, the per-sheet column cells and headers, the "No price" chip and note, and the `rate` helper are removed. "Select all N shown" counts every visible row again. Search matches `it.name` only. Row tint, the colour filter and the sheet filter are unchanged. |

### Part C — the line: product + editable qty (R3, R4)

| # | File | Change |
|---|---|---|
| C1 | `new/_components/sheet-import.tsx` | `sheetLine` → `{ key, name, quantity }`. `useSelected` stops filtering out rows without a price. |
| C2 | `new/_components/vendor-section.tsx` | `POLineItem` → `{ key, name, quantity, productId? }`. Each line is the name, a Qty input and Remove. The Unit Price, GST %, line amount, totals card and "no rate" warnings are removed, and so are `formatCurrency` / `formatRate` (imported nowhere else, per a grep across the whole `purchase-orders` tree). The "Created." note becomes *"Created with N line(s)."* `blocked` becomes: no vendor, or no items. |
| C3 | `new/page.tsx` | `toLine` drops the rate and GST. `PreparedItem` loses `costPrice` and `gstRate`, which are no longer read; the prepare API itself is untouched. `useSelectedLines` copies `{ key, name, quantity }`. The POST sends `{ name, quantity, productId? }`. `anyBlocked` and its "no rate" message go. |
| C4 | `new/_components/columns-step.tsx` | Helper text (`110-112`) → *"Only the item name and the quantity reach the purchase order."* The column roles are unchanged (§5). |

### Part D — the PDF and the email (R1, R6)

| # | File | Change |
|---|---|---|
| D1 | `src/lib/purchase-orders/pdf.ts` | `PoPdfLine` → `{ name, quantity }`. `PoPdfInput` loses the three totals. The table becomes `["#", "Product", "Qty"]`. The totals block, `rs()` and the "amounts are read, not recomputed" note go. Header, vendor block, delivery address, notes, approval line and footer stay. GSTIN lines stay per Q7 (a). |
| D2 | `[id]/pdf/route.ts`, `[id]/send/route.ts` | Stop selecting `unitPrice / gstRate / amount / subtotal / gstTotal / grandTotal` for the PDF, and stop mapping them. |
| D3 | `src/lib/purchase-orders/email.ts`, `send/route.ts` | `PoEmailInput` loses `grandTotal`. The "Total" row goes from the text and HTML bodies, along with `inr()`. The send route stops passing it. |

### Part F — detail page, WhatsApp, list (R7, R8, Q6)

| # | File | Change |
|---|---|---|
| F1 | `src/app/(dashboard)/purchase-orders/[id]/page.tsx` | Each line keeps name, SKU/stock (linked lines only), Qty and Rcvd. The amount, `@ rate`, GST and the totals card go. WhatsApp lines become `- name (sku): N pcs` with no Total. `formatCurrency` and the price fields of `PODetail` go. |
| F2 | `src/app/(dashboard)/purchase-orders/page.tsx` (only if Q6 = a) | Remove the Total column (`163`), the card total (`208`) and the export column (`27`). |

### Order of work
E first, because B, C and D compile against its types. Then B, C, D and F in parallel. They touch disjoint files, so one agent can take D + F while this session builds B + C. `npx tsc --noEmit` after each part.

### Logging
The logs the removed code carried go with it: `sheet prices read / applied`, `sheet lines refused`, `extraction row select refused`, `selected rows without a price left out`. The remaining logs keep their identifiers: `purchase order created { poId, poNumber, vendorId, lines }`, `extraction rows selected { requested, updated, selectedCount }`, and `purchase order pdf rendered { lines, pages, bytes }`. No new branch is added without a log.

### Board of agents — flags to raise before "done"
- **Accounting consultant.** This is the big one. A PO stops being a financial commitment: `grandTotal` is 0, so the purchase report, the accounts summary and a vendor's open-PO value all read ₹0 for new orders, and a bill can no longer be checked against its PO's price. This is the owner's explicit choice (D1). Flagged, not changed.
- **GST consultant.** A purchase order is not a tax document, and GST is charged on the vendor's invoice. Removing it from the PO is compliant.
- **Backend engineer.** "No price" is enforced at the schema (E1) and in `createPurchaseOrder` (E2), not only by hiding inputs.
- **Frontend engineer.** A line is still ≥ 44 px to tap. The review loses its horizontal scroll, which helps on a phone.

---

## 4. Verification

1. `npx tsc --noEmit` (Claude). `npm run build` (owner, per the 8 Sep rule for plan work).
2. Browser, `/purchase-orders/new`, with `docs/asset/Stock as on 04.09.2026 (Pargaon Wh & Ludhiana Wh)-ALL.xlsx`:
   - Review: each row is a checkbox and the product name, tinted in its sheet colour. No price, MRP or other column. Search finds by name.
   - A row with no MRP can be ticked.
   - *Use N selected rows*: each line is the name and an editable Qty. No rate, GST or totals.
   - Submit, then *Download PDF*: the table is `# · Product · Qty`, with no totals block.
3. A /reorder handoff: lines are name + Qty only, and the PO is created.
4. Tamper: POST with `unitPrice: 999` on a line stores `unitPrice 0`.
5. `/purchase-orders/[id]`: no rate, GST or totals. WhatsApp text has no `@ ₹` and no Total. Send-to-vendor email has no Total row.

---

## 5. Out of scope, deliberately

- **The extraction still reads MRP/Price.** `sheet.ts`, the rescue prompt and the PDF/photo path still store `PoExtractionItem.price` / `.mrp`, and the column step still offers the Price and MRP roles. Nothing reads those values after this plan. Removing them is a separate cleanup; leaving them costs nothing and keeps the column step's labels meaningful.
- **Dropping the price columns** (`PurchaseOrderItem.unitPrice / gstRate / amount`, `PurchaseOrder.subtotal / gstTotal / grandTotal`). They keep older POs' data and are still read by reports, bills and settlement. A drop would be a migration and a separate decision.
- **Reports, accounts summary, bills, settlement, vendor pages.** They keep reading the stored totals and will see ₹0 for new POs (§3, accounting flag).
- **The /reorder page and the prepare API.** They are untouched; only this screen stops reading `costPrice`.
- **PDFs already emailed** are stored snapshots and keep their prices.
- `docs/manual-testing/090926-four-plans-verification.md` §7 and plan 1509's §4 describe prices. They get corrected when this ships.
- **`sheet-review.tsx` still receives `columns` on every row** (`ExtractionItemView.columns`), though the review no longer shows them. Dropping them from `serializeItem` goes with the extraction cleanup above.

---

## 6. Build record — 15 Sep 2026

Built on `feat/remove-static-team-health`, **uncommitted**. Parts E, B and C by this session; Parts D and F by one sub-agent in parallel. Its diff was reviewed line by line.

| Part | Files |
|---|---|
| E | `lib/validations.ts` (PO item schema only), `lib/purchase-orders/create.ts`, `api/purchase-orders/route.ts`, `lib/po-extraction/store.ts`, `lib/po-extraction/types.ts` |
| B | `extract/[id]/items/[itemId]/route.ts`, `extract/[id]/select/route.ts`, `new/_components/sheet-review.tsx` |
| C | `new/_components/sheet-import.tsx`, `vendor-section.tsx`, `columns-step.tsx`, `new/page.tsx`; comments corrected in `extract/route.ts` and `extract/[id]/columns/route.ts` |
| D | `lib/purchase-orders/pdf.ts`, `lib/purchase-orders/email.ts`, `[id]/pdf/route.ts`, `[id]/send/route.ts` |
| F | `purchase-orders/[id]/page.tsx` (items, totals, WhatsApp), `purchase-orders/page.tsx` (Total column, card total, export column) |

**Checked:**
- `npx tsc --noEmit`: exit 0, across the whole tree, after both halves landed.
- `eslint` on every changed file: 0 new problems. There are two pre-existing ones, both in code this plan did not touch:
  - `sheet-import.tsx:107`, an exhaustive-deps warning;
  - `purchase-orders/page.tsx:81`, a set-state-in-effect error, which is at line 85 in `HEAD`.
- A grep of `src` finds no `unitPriceOf`, `applySheetPrices`, `PRICED_ROW`, `priceSource`, `extractionItemId`, `formatRate` or `onPricelessLine` left.
- The real `renderPurchaseOrderPdf` and `buildPoEmail` were run offline with sample lines (jiti, no DB):
  - The PDF table is `# · Product · Qty`, with no totals block.
  - A long name wraps inside Product.
  - Both GSTIN lines are present (Q7).
  - The email text and HTML contain no "Total", "₹" or "Rs.".

**Not checked:**
- `npm run build`, owed by the owner.
- The browser walk (§4). The dev server answered on :3000, but Chrome sat on the app's loading spinner for more than 20 s and never rendered the screen. This is the same failure an earlier session recorded.
- The tamper case (§4 item 4) needs a logged-in session.
