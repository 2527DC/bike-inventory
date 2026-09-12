# Database Schema Analysis: Bins, Serial Tracking, Ledgers, and Unwanted Tables


**Date:** 11 Sep 2026  
**Context:** Analysis of table usage, relationships, redundancy, and accounting structures in `prisma/schema.prisma`.

---

## 1. Warehouse and Bins Relationship

### Current State (Before Update)
- In `prisma/schema.prisma:654-672`, the `Bin` model is defined with:
  - `code @unique` (enforced company-wide across all stores and warehouses).
  - `name`, `location` (plain text), `zone?`, `capacity?`, `isActive`.
  - **No foreign key to `Warehouse` or `Store` exists.**
- This prevented the same code (e.g., `A1` or `ASM`) from existing in both the Godown and the Showroom Floor, and prevented scoping queries like "show all bins in Store 1's Godown".

### Target Architecture (Assembly Audit & Build-Line)
- Each **Store** contains one or more **Warehouses** (`kind: FLOOR` for showroom display/sales, `kind: GODOWN` for inventory storage).
- A **Bin** is strictly scoped to one warehouse:
  ```prisma
  model Bin {
    id              String     @id @default(cuid())
    code            String     // e.g. "A1", "ASM"
    name            String     // "Rack 1 Front"
    warehouseId     String     @map("warehouse_id")
    warehouse       Warehouse  @relation(fields: [warehouseId], references: [id], onDelete: Cascade)
    directions      String?    // "Ground floor, left of entrance, first rack"
    floor           String?    // "Ground Floor"
    zone            String?    // "Zone A"
    isAssemblyArea  Boolean    @default(false)
    ...

    @@unique([warehouseId, code])
  }
  ```
- **Key benefit**: Both the showroom floor and the back godown can have their own `A1` rack and their own `ASM` assembly area without collision.

---

## 2. Analysis of `SerialItem` and `SerialTransactionItem`

### 2.1 What is `SerialItem`?
- **Definition** (`prisma/schema.prisma:607-640`): Intended to store individual serialized products (e.g. bicycles carrying a unique serial number).
- **Fields**: `id`, `serialCode` (`@unique`), `productId`, `binId`, `status`, `condition`, `receivedAt`, `soldAt`, `customerName`, `saleInvoiceNo`, `barcodeData`.
- **Relations**:
  - Belongs to `Product` (`productId`)
  - Optional relation to `Bin` (`binId`)
  - Has many `SerialTransactionItem`

#### On what operations is data interacted with `SerialItem`?
1. **Creation**: **Nowhere in the entire codebase is a row created.** Inward receiving (`/api/inbound/[id]`) increments numerical quantities in `StockLevel`, but never inserts rows into `SerialItem`.
2. **Reading**:
   - `/api/serials/route.ts`: List serial items.
   - `/api/serials/search/route.ts`: Lookup serial items by code.
   - `/api/products/[id]/route.ts`: Includes the latest 20 serial items (currently returns `[]`).
   - `/stock/[id]/page.tsx`: Displays serial items card if any exist.
3. **Updating**:
   - `/api/serials/[id]/route.ts`: Edits status or notes.
   - `/api/inventory/outwards/route.ts:124-136`: Runs `tx.serialItem.updateMany` marking status as `SOLD` when a delivery is dispatched.

> **Verdict on `SerialItem`**: Currently a hollow/dormant table (0 rows). In the upcoming Assembly Audit implementation, this table will either be replaced by or migrated into `InventoryUnit` (`U-xxxxxx` sticker codes).

---

### 2.2 What is `SerialTransactionItem`?
- **Definition** (`prisma/schema.prisma:642-652`): Intended as a join table linking `SerialItem` to `InventoryTransaction` to create an audit trail of which serial moved in which stock transaction.
- **Fields**: `id`, `serialItemId`, `transactionId`, `createdAt`.
- **Relations**:
  - Belongs to `SerialItem`
  - Belongs to `InventoryTransaction`

#### On what operations is data interacted with `SerialTransactionItem`?
- **ZERO operations**: There are **no queries, no inserts, no updates, and no reads** anywhere in `src/`. It is only referenced once in a code comment (`src/app/api/products/[id]/route.ts:221`).
- **Verdict**: **100% dead table.** It can be dropped or replaced cleanly by `BinMovementLog`.

---

## 3. Unwanted & Redundant Tables Analysis

### 3.1 `VendorContact` — Candidate for Removal
- **Schema** (`prisma/schema.prisma:818-830`):
  - Holds: `vendorId`, `name`, `designation`, `phone`, `email`, `whatsapp`, `isPrimary`.
- **Redundancy Analysis**:
  - Look at the parent table `Vendor` (`prisma/schema.prisma:768-816`):
    - `phone`
    - `email`
    - `whatsappNumber`
    - `waGroupName`
    - `waGroupCode`
    - `addressLine1`, `addressLine2`, `city`, `state`, `pincode`
    - `gstin`, `pan`
  - The `Vendor` table already stores all primary communication channels.
  - In daily operations, BCH staff communicate with the vendor's primary point of contact or WhatsApp group directly.
- **Recommendation**:
  - If multiple contacts per vendor are not needed, `VendorContact` can be safely deprecated and dropped. Contact info can live directly on `Vendor`.

### 3.3 Complete Inventory of Dead / Zero-Operation Tables

Based on the automated codebase-wide audit of all 105 models in `prisma/schema.prisma`:

| Category | Table | Code Usage in `src/` | DB Count | Operational Reality & Recommendation |
|---|---|---|---|---|
| **100% Dead** | `SerialTransactionItem` | **0 calls** (only in 1 comment) | 0 rows | Intended as join between serial and inventory tx. Never written, never read. **Drop table.** |
| **100% Dead** | `BrandStockItem` | **0 calls** | 0 rows | Child items of old brand stock upload sheet. Never written or read. **Drop table.** |
| **Orphaned / Merge-only** | `BrandStockUpload` | 1 call (only in `brands/[id]/merge` FK update) | 0 rows | Upload header for brand excel stock sheets. No upload or read route exists. **Drop table.** |
| **Orphaned / Merge-only** | `BrandSkuMapping` | 3 calls (only in `brands/[id]/merge` FK update) | 0 rows | Annotated as "scheduled for removal with the rest of brand-stock". **Drop table.** |
| **Orphaned / Merge-only** | `VendorDiscountTerm` | 1 call (only in `brands/[id]/merge` FK update) | 0 rows | Intended for vendor trade terms; no CRUD or business logic touches it. **Drop table.** |
| **Hollow (No Inserts)** | `SerialItem` | 6 calls (read/search/update only) | 0 rows | **Zero creation code.** Inwarding does not insert serials. Dead helper functions. **Evolve into `InventoryUnit` or drop.** |
| **Redundant** | `VendorContact` | 6 calls (isolated `/api/vendors/[id]/contacts`) | 0 rows | **Redundant**. `Vendor` table already captures phone, email, WhatsApp, address. **Drop table.** |

---

## 4. Vendor Ledger vs. Brand Ledger: How Ledgers Relate to Brands

### 4.1 The Core Distinction: Vendor vs. Brand
In commercial business and GST accounting:
- **Vendor (The Legal Entity)**: The company you purchase from, receive GST tax invoices from, and send bank transfers to.
  - *Example*: `Aoki Mobility Pvt Ltd`, `Naren Cycles`, `Hero Cycles Ltd`.
- **Brand (The Product Trademark)**: The label or make of the bicycles.
  - *Example*: `Cultsport`, `Raleigh`, `Suncross`, `Hero`.

A vendor and a brand are often 1-to-1 (e.g. Hero Cycles sells Hero bikes), but frequently **1-to-many**:
- Distributor *Naren Cycles* (Vendor) supplies both *Raleigh* (Brand) and *Suncross* (Brand).
- A single payment or statement from Naren Cycles covers both brands on one ledger.

### 4.2 How the Schema Actually Models This Today
Looking at `BrandLedgerEntry` (`prisma/schema.prisma:2639-2689`):
```prisma
model BrandLedgerEntry {
  id       String   @id @default(cuid())
  vendorId String   // <-- MANDATORY: The vendor entity whose money is tracked
  vendor   Vendor   @relation(...)
  brandId  String?  // <-- OPTIONAL: tagged when a vendor supplies multiple brands
  brand    Brand?   @relation(...)
  amount   Float
  direction Int     // +1 invoice/debit note, -1 payment/credit note
  ...
}
```

Notice that:
1. `vendorId` is **mandatory** on every single row.
2. `brandId` is **nullable/optional**.
3. All payments (`VendorPayment`), bills (`VendorBill`), credits (`VendorCredit`), and gaps (`LedgerGap`) belong to `Vendor`.
4. The table is named `BrandLedgerEntry`, but it is structurally a **Vendor Ledger Entry** with an optional brand classifier!

### 4.3 Key Questions for Decision:
> **Question 1 (Naming & Domain Consistency)**:
> Since financial accounting, bank payments, and GST bills operate at the **Vendor** level, should we rename `BrandLedgerEntry` and `BrandStatement` to **`VendorLedgerEntry`** and **`VendorStatement`** to reflect reality, while retaining `brandId` as an optional tag for brand-specific reporting?

> **Question 2 (Brand Linking)**:
> Today, brands link to vendors via the `BrandVendor` join table (`prisma/schema.prisma:2849-2862`). Does a vendor statement need to be split by brand on screen, or is viewing the total financial balance by **Vendor** with brand filters sufficient?

---

## 5. Bank Statements vs. Brand Statements: What Do They Hold?

They serve two completely different halves of the accounting reconciliation puzzle:

```
                    ┌────────────────────────────────────────┐
                    │          BCH Bank Account              │
                    │   (HDFC / ICICI Current Account)       │
                    └──────────────────┬─────────────────────┘
                                       │
                        Bank Statement (Money Out / In)
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            RECONCILIATION ENGINE                            │
│  Matches Bank Debits (Payments) ◄───► Vendor Bills & Claims                │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                        Vendor/Brand Statement (Bills & Ledger)
                                       │
                    ┌──────────────────▼─────────────────────┐
                    │          Vendor / Brand Books          │
                    │   (External Statement from Hero/Cult)  │
                    └────────────────────────────────────────┘
```

### 5.1 What is a Bank Statement (`BankStatement` & `BankTransaction`)?
- **What it is**: The official statement of **BCH's own bank current accounts** (e.g. HDFC or ICICI), uploaded as a CSV or Excel file.
- **What it holds** (`prisma/schema.prisma:1070-1123`):
  - `accountNumber`: BCH's bank account number.
  - `date`: Date money entered or left BCH's bank.
  - `description`: The bank narration (e.g. `NEFT-N12345-AOKI MOBILITY`, `UPI-482910-CUSTOMER`).
  - `reference`: Bank UTR or cheque reference number.
  - `type`: `CREDIT` (money received from customers or card settlements) or `DEBIT` (money paid out for vendor bills, rent, expenses).
  - `amount`: Exact financial transaction amount.
  - `matchStatus`: `UNMATCHED`, `MATCHED`, `FLAGGED`.
- **Purpose**: Verifies that every rupee leaving or entering BCH's bank account matches a valid invoice, payment voucher, or POS cash settlement.

### 5.2 What is a Brand/Vendor Statement (`BrandStatement` & `BrandLedgerEntry`)?
- **What it is**: The external ledger statement **sent to BCH by the supplier/brand** (e.g., Hero Cycles sending their quarterly PDF/Excel statement).
- **What it holds** (`prisma/schema.prisma:2638-2724`):
  - `statementDate`, `periodFrom`, `periodTo`.
  - `claimedClosing`: What the brand/vendor claims BCH owes them (e.g. ₹14,50,000).
  - `computedClosing`: What the sum of their statement entries actually equals.
  - `entries` (`BrandLedgerEntry[]`):
    - Each line item: their invoice number, their recorded receipt of BCH's payment, credit notes passed for discounts or damaged goods.
- **Purpose**: **Supplier balance reconciliation & gap detection**. It answers:
  - *"Did Hero give us the 5% monsoon discount credit note they promised?"*
  - *"Did the vendor record our ₹2,00,000 NEFT transfer from 14 Aug, or are they still claiming we owe it?"*
  - *"Are there bills on their statement for bicycles we never received?"*

---

## 6. Summary Comparison Table

| Concept | What It Represents | Key Identifiers / Fields | Primary Purpose |
|---|---|---|---|
| **`BankStatement`** | BCH's own HDFC/ICICI bank records | Bank name, UTR, Debit/Credit amount, Bank Narration | Proving money actually left or entered BCH's bank account. |
| **`BrandStatement`** *(Vendor Statement)* | External supplier's billing ledger sent to BCH | Vendor ID, claimed closing balance, their invoice/voucher numbers | Finding missing discounts, short credits, or erroneous billing by the supplier. |
| **`SerialItem`** | Individual physical cycle unit | `serialCode`, `productId`, `binId`, `status` | Unit-level tracking (to be modernized for `U-xxxxxx` sticker codes). |
| **`SerialTransactionItem`** | Join between serial and inventory tx | `serialItemId`, `transactionId` | **Unused/dead**; candidate for removal. |
| **`VendorContact`** | Subsidiary contact person for vendor | `vendorId`, `name`, `phone`, `email` | **Redundant** with primary contact columns on `Vendor`. |
