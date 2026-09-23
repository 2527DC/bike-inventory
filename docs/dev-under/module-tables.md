# Database tables by module

Written 23 Sep 2026 from `prisma/schema.prisma`. If this file and the schema disagree, the schema is right.

**How table names work:** a model with an `@@map("...")` uses that mapped name in Postgres.
A model without one uses its model name as a quoted identifier, such as `"Product"`.

Modules covered: Build line / Assembly · Stock management · Vendor · Purchase orders ·
Vendor issues · Customers.

---

## 1. Build line / Assembly

| Model | Table | What it holds |
|---|---|---|
| `InventoryUnit` | `inventory_units` | One row per physical cycle (`U-000481`): product, warehouse, bin, frame number, status, assembler, assembly level, sale and reservation |
| `AssemblyTask` | `assembly_tasks` | A unit assigned to a mechanic: assigned, started, on hold (reason / issue / note), completed, photo |
| `AssemblyLog` | `assembly_logs` | The workshop's own assembly log (A50 / A85 / FULL). It comes from the old service app and is separate from `AssemblyTask` |
| `BinMovementLog` | `bin_movement_logs` | Unit and product moves from one bin to another |
| `Bin` | `bins` | Bins inside a warehouse |
| `BinStock` | `bin_stocks` | Quantity of a product held in a bin |
| `HomeBinRule` | `home_bin_rules` | Default-bin rules |
| `Complaint` | `complaints` | Complaints raised against a unit (`CMP-YYYYMM-NNNN`) |

`Product.assemblyLevel` is a column on the product table, not a table of its own.

---

## 2. Stock management

| Model | Table | What it holds |
|---|---|---|
| `Product` | `"Product"` | The catalog, including the reorder settings |
| `Category` | `"Category"` | Product categories |
| `Brand` | `"Brand"` | Brands |
| `StockLevel` | `"StockLevel"` | Quantity per product per warehouse |
| `InventoryTransaction` | `"InventoryTransaction"` | Every stock movement in and out |
| `SerialItem` | `"SerialItem"` | Serial-number tracking |
| `SerialTransactionItem` | `"SerialTransactionItem"` | Serials attached to a transaction |
| `StockCount` | `"StockCount"` | A stock audit (store → warehouse → optional bin) |
| `StockCountItem` | `"StockCountItem"` | Lines of a stock audit |
| `TransferOrder` | `"TransferOrder"` | Transfers between warehouses and stores |
| `TransferOrderItem` | `"TransferOrderItem"` | Lines of a transfer |
| `TransferOrderUnit` | `transfer_order_units` | Individual units on a transfer |
| `InboundShipment` | `"InboundShipment"` | Inbound receiving (from a Zoho Bill) |
| `InboundLineItem` | `"InboundLineItem"` | Lines of an inbound shipment |
| `Store` | `"Store"` | Stores (each has its own GSTIN) |
| `Warehouse` | `"Warehouse"` | Floor and godown warehouses of a store |

Shared with Assembly: `Bin`, `BinStock`, `BinMovementLog`, `InventoryUnit`.

---

## 3. Vendor

| Model | Table | What it holds |
|---|---|---|
| `Vendor` | `"Vendor"` | Vendor master |
| `VendorContact` | `"VendorContact"` | Vendor contact people |
| `VendorBill` | `"VendorBill"` | Bills from vendors (payables) |
| `VendorPayment` | `"VendorPayment"` | Payments made to vendors |
| `VendorCredit` | `"VendorCredit"` | Vendor credit notes |
| `BrandVendor` | `brand_vendors` | Which brand is supplied by which vendor |
| `VendorLedgerProfile` | `vendor_ledger_profiles` | Ledger settings per vendor |
| `VendorDiscountTerm` | `vendor_discount_terms` | Agreed discount terms |
| `BrandLedgerEntry` | `brand_ledger_entries` | Ledger entries (Ledger screens) |
| `BrandStatement` | `brand_statements` | Uploaded vendor statements |
| `LedgerGap` | `ledger_gaps` | Mismatches found in reconciliation |
| `LedgerGapEvidence` | `ledger_gap_evidence` | Evidence attached to a gap |
| `LedgerGapNote` | `ledger_gap_notes` | Notes on a gap |
| `LedgerUpload` | `ledger_uploads` | Files uploaded to the ledger |
| `LedgerAiRun` | `ledger_ai_runs` | AI runs over ledger data |

---

## 4. Purchase orders

| Model | Table | What it holds |
|---|---|---|
| `PurchaseOrder` | `"PurchaseOrder"` | PO header (vendor, store, status) |
| `PurchaseOrderItem` | `"PurchaseOrderItem"` | PO lines: product and quantity only (no price, plan 1509) |
| `PurchaseOrderSend` | `"PurchaseOrderSend"` | History of POs sent by email or WhatsApp |
| `PoExtraction` | `"PoExtraction"` | A vendor sheet uploaded to build a PO (AI or Excel) |
| `PoExtractionItem` | `"PoExtractionItem"` | Rows read from that sheet |

Reorder (the `/purchase-orders?tab=reorder` tab) has no table of its own. It reads the reorder
columns on `Product`, such as `reorderVendorId`, together with `StockLevel`.

---

## 5. Vendor issues

| Model | Table | What it holds |
|---|---|---|
| `VendorIssue` | `"VendorIssue"` | Issue raised with a brand or vendor (`ISS-YYYYMM-NNNN`). Links to `Vendor` and optionally to a `VendorBill` |
| `VendorIssueNote` | `"VendorIssueNote"` | Append-only follow-up notes on an issue |

---

## 6. Customers

| Model | Table | What it holds |
|---|---|---|
| `Customer` | `"Customer"` | One shared table for the counter and the workshop. `phone` is required and unique; it identifies the customer |
| `CustomerInvoice` | `"CustomerInvoice"` | Customer invoices (receivables) |
| `CustomerPayment` | `"CustomerPayment"` | Payments received from customers |

Other tables that point at `Customer`:

| Model | Table | Module |
|---|---|---|
| `Delivery` | `"Delivery"` | Deliveries |
| `ServiceJob` | `service_jobs` | Service / workshop |
| `Review` | `reviews` | Service / workshop |

---

## Tables every module uses

| Purpose | Tables |
|---|---|
| People and places | `"User"`, `"Store"`, `"Warehouse"` |
| History | `"ActivityLog"`, `approval_events` |
| Access control | `modules`, `permissions`, `roles`, `role_permissions` |

Each screen above is gated by a permission row in the access-control tables, not by code.
See `CLAUDE.md` → *Access control is DATA, not code*.
