# AI Vendor Invoice Extraction, Review, and Zoho Books Push on Purchase Order Screen

Status: completed — 19 Nov 2026, AI vendor invoice extraction, review modal, and Zoho Books Bill creation built and verified with npm run build
Branch: **feat/po-invoice-ai-zoho-upload**

---

## 0. Requirement

### 0.1 The owner's words, verbatim (19 Nov 2026)

> in this i haad a req of creating the invoice respected to the vendor to zoho like creating it from our application to zoho can it be done
>
> '/Users/chethanr/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/B9E543E4-38C2-4BB6-9AD9-AFFE3C82F8E4/27-EM-2627-14004.pdf' this one of the kinde of invoice where i will upload and i need to use the help of ai to creat the respectde one and which shwos the review screen after uploading and them to create the invoice in zoho first i need u to investigate an analysis what are the fild that adre alowed in zoho to create the invoice and and thing to be revied and after the extarction form the ai to create the invoice in zoho where i need this in the respected to the purchase order screen respected to the purchase order i need u to plan on this and implment it
>
> for the above quest what is ur recomendation -> yes do it

### 0.2 Restated as requirements

| # | Requirement | Scope |
|---|---|---|
| **R1** | Upload a vendor Tax Invoice (PDF or image, such as `27-EM-2627-14004.pdf`) from the Purchase Order creation area. | UI & API |
| **R2** | Extract full B2B invoice fields via AI: vendor name, vendor GSTIN, invoice number, invoice date, due date, reference/order number, and line items (name, HSN/SAC code, quantity, unit rate, GST rate, tax amount, line total). | AI Parser |
| **R3** | Automatically match the extracted vendor against the database and Zoho Books using GSTIN / Vendor Name, resolving the Zoho Contact ID. | Vendor Resolution |
| **R4** | Display a dedicated **Invoice Review Screen (Modal)** showing all extracted fields, allowing full inline editing of invoice header and line items, and calculating summary totals (subtotal, tax, grand total). | Review UI |
| **R5** | Allow optional mapping of invoice line items to existing catalog products without blocking new or variant items (free-line support). | Review UI |
| **R6** | On approval in the review screen, create the Vendor Bill in Zoho Books (`POST /bills`) with the invoice number, date, line items, taxes, HSN codes, and attach the original PDF. | Zoho Integration |
| **R7** | Simultaneously record the transaction locally (Purchase Order / Vendor Bill) with a reference link to the created Zoho Bill. | Local DB |

---

## 1. Questions and clarifications — answer before build

| # | Question | Options | Recommended default | **Answer** |
|---|---|---|---|---|
| **Q1** | What document to create in Zoho Books? | (a) Vendor Bill (`/bills`); (b) Purchase Order (`/purchaseorders`); (c) Both | (a) Vendor Bill | **(a) Vendor Bill** — confirmed by owner ("yes do it" to recommendation). |
| **Q2** | What to do if an item is not in the catalog? | (a) Free-line item with vendor's name and HSN; (b) Require strict catalog match | (a) Free-line with optional mapping | **(a) Free-line with optional mapping** — confirmed by owner. |
| **Q3** | Where does the invoice upload button sit? | (a) Prominent tab/card on `/purchase-orders/new`; (b) Dedicated `/purchase-orders/upload-invoice` route | (a) Tab/card on `/purchase-orders/new` | **(a) On `/purchase-orders/new`** |

### 1.1 Decisions on record
- **19 Nov 2026**: Owner confirmed recommendation to push as a Vendor Bill (`/bills`) to Zoho Books with free-line items and full review screen before dispatching to Zoho.

---

## 2. How it works today

1. **Existing Purchase Order Upload**:
   - `src/app/api/purchase-orders/extract/route.ts:49` accepts multipart uploads for sheets and quotations.
   - `src/lib/pdf-parser.ts:37` currently runs an AI prompt (`catalogue.pdf_extract`) tailored for product price lists, returning only `name, sku, category, qty, price, mrp`. It does **not** extract vendor GSTIN, invoice numbers, invoice dates, HSN codes, tax amounts, or billing totals.
   - Plan 1509 stripped financial lines from PO creation: `src/app/(dashboard)/purchase-orders/new/_components/sheet-import.tsx:28` drops rate and GST, retaining only name and quantity.
2. **Existing Zoho Books Client**:
   - `src/lib/integrations/books.ts:179` already provides `createBill(data)`, but does not support document attachments, line-item HSN codes, or inter-state IGST mapping.
   - `src/lib/inbound/complete-shipment.ts:195` uses `createBill`, showing the Zoho integration connection works when `getBooks()` is initialized.
3. **Existing Vendor Linkage**:
   - `Vendor` model holds `zohoVendorId` (`prisma/schema.prisma:1128`).
   - `src/lib/vendors/resolve-zoho-vendor.ts:51` resolves vendors by `zohoVendorId` or GSTIN. For example, `INKODOP TECHNOLOGIES PRIVATE LIMITED` is already linked to Zoho Contact ID `1593656000003112611`.

---

## 3. Implementation plan

### Phase 1: AI Invoice Extractor & Validator
- Add `parseInvoicePdfWithAI` in [src/lib/pdf-parser.ts](file:///Users/chethanr/Projects/BCH/bike-inventory/src/lib/pdf-parser.ts).
- Prompt extracts:
  - `invoiceNumber`, `invoiceDate`, `dueDate`, `orderNumber`
  - `vendorName`, `vendorGstin`, `vendorAddress`
  - `buyerGstin`
  - `taxType` (IGST vs CGST/SGST)
  - `lineItems`: `description`, `hsn`, `quantity`, `rate`, `gstPercent`, `taxAmount`, `total`
  - `totals`: `subTotal`, `taxTotal`, `grandTotal`
- Add validation schema `invoiceExtractSchema` in `src/lib/validations/invoice-extract.ts`.

### Phase 2: Zoho Books Client Enhancement
- Extend `BooksClient.createBill` in [src/lib/integrations/books.ts](file:///Users/chethanr/Projects/BCH/bike-inventory/src/lib/integrations/books.ts):
  - Support `vendorId` (Zoho contact ID), `reference_number`, HSN codes, tax treatment (`business_gst`), and inter-state IGST percentages.
  - Add `attachFileToBill(billId, fileName, fileBuffer)` via Zoho's attachment API (`POST /bills/{bill_id}/attachment`).

### Phase 3: Backend API Endpoints
- Create `POST /api/purchase-orders/invoice-extract`:
  - Receives uploaded PDF/image.
  - Calls `parseInvoicePdfWithAI`.
  - Searches local DB for matching vendor by GSTIN / Name.
  - Returns structured extraction view with vendor match status.
- Create `POST /api/purchase-orders/create-from-invoice`:
  - Receives reviewed & edited invoice payload.
  - Creates Vendor Bill in Zoho Books via `getBooks()`.
  - Optionally attaches original PDF to Zoho Bill.
  - Creates local `PurchaseOrder` (and `PurchaseOrderItem`) and links or records `VendorBill`.
  - Returns created IDs and Zoho direct bill URL / reference.

### Phase 4: Frontend UI (Purchase Orders Screen)
- Update [src/app/(dashboard)/purchase-orders/new/page.tsx](file:///Users/chethanr/Projects/BCH/bike-inventory/src/app/(dashboard)/purchase-orders/new/page.tsx):
  - Add an **"Upload Vendor Invoice (AI)"** button/card alongside existing sheet import.
- Build `src/app/(dashboard)/purchase-orders/new/_components/invoice-review-modal.tsx`:
  - Upload dropzone accepting PDF / images.
  - Extraction loading state.
  - Header review: Vendor name & Zoho badge, invoice number, invoice date, due date, PO reference.
  - Line items editable table: item name, HSN, quantity, unit rate, GST rate dropdown, line total.
  - Totals banner: subtotal, tax breakdown, grand total with discrepancy warning if math doesn't sum.
  - Action button: **"Create Bill in Zoho Books & Save"** (with progress indicator).
  - Success feedback with Zoho Bill link and PO confirmation.

---

## 4. Verification

1. **Unit / Parsing Test**:
   - Run AI extraction on `/Users/chethanr/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/B9E543E4-38C2-4BB6-9AD9-AFFE3C82F8E4/27-EM-2627-14004.pdf`.
   - Verify all 4 line items, HSN `87116090`, vendor `INKODOP TECHNOLOGIES`, and grand total `₹2,195,958.00` are correctly parsed.
2. **Review Screen Walkthrough**:
   - Open `/purchase-orders/new` in the browser.
   - Upload the sample PDF.
   - Verify all fields populate accurately in the modal.
   - Edit a quantity or rate and confirm recalculations.
3. **Zoho Push Verification**:
   - Confirm bill creation against Zoho Books test / connected organization.
4. **Build Check**:
   - Run `npm run build` and ensure zero TypeScript or Turbopack errors.

---

## 5. Out of scope

- Customer sales invoices (this is strictly for vendor purchase bills / invoices).
- Automatic inventory unit creation before goods physically arrive (inbound receipt handles put-away).
- Deleting or modifying historical Zoho invoices.
