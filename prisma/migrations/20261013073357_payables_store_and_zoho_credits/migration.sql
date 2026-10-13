-- Plan 1210 credit notes and payables, migration M2 — additive only (CLAUDE.md rules 3, 7).
-- The plan's two hand-added backfills (billedTo -> storeId, payment store from its bill) are
-- deliberately omitted: Phase 0 (13 Oct 2026) found 0 vendor bills and 0 vendor payments on the
-- test copy of production, billedTo has never had a writer, and the store codes the first one
-- mapped to (BCH_STORE / BCC_STORE) do not exist — production has one store, BCH1. Stores are
-- filled from Zoho locations once a store is linked on /stores.

-- CreateEnum
CREATE TYPE "VendorCreditStatus" AS ENUM ('OPEN', 'CLOSED', 'VOID');

-- CreateEnum
CREATE TYPE "CustomerCreditNoteStatus" AS ENUM ('OPEN', 'CLOSED', 'VOID');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "zohoLocationId" TEXT;

-- AlterTable
ALTER TABLE "VendorBill" ADD COLUMN     "storeId" TEXT;

-- AlterTable
ALTER TABLE "VendorCredit" ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "referenceNo" TEXT,
ADD COLUMN     "status" "VendorCreditStatus" NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "storeId" TEXT,
ADD COLUMN     "zohoLastModifiedAt" TIMESTAMP(3),
ADD COLUMN     "zohoLocationId" TEXT,
ADD COLUMN     "zohoVendorCreditId" TEXT;

-- AlterTable
ALTER TABLE "VendorIssue" ADD COLUMN     "vendorCreditId" TEXT;

-- AlterTable
ALTER TABLE "VendorPayment" ADD COLUMN     "storeId" TEXT;

-- AlterTable
ALTER TABLE "ZohoPullLog" ADD COLUMN     "creditNotesNew" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vendorCreditsNew" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "VendorCreditRefund" (
    "id" TEXT NOT NULL,
    "zohoRefundId" TEXT NOT NULL,
    "vendorCreditId" TEXT NOT NULL,
    "refundDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "refundMode" TEXT,
    "referenceNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorCreditRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCreditNote" (
    "id" TEXT NOT NULL,
    "zohoCreditNoteId" TEXT NOT NULL,
    "creditNoteNo" TEXT NOT NULL,
    "referenceNo" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "zohoCustomerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerId" TEXT,
    "storeId" TEXT,
    "total" DECIMAL(12,2) NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "status" "CustomerCreditNoteStatus" NOT NULL DEFAULT 'OPEN',
    "zohoLocationId" TEXT,
    "zohoLastModifiedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerCreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCreditNoteApplication" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "zohoInvoiceId" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "deliveryId" TEXT,
    "customerInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerCreditNoteApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorCreditRefund_zohoRefundId_key" ON "VendorCreditRefund"("zohoRefundId");

-- CreateIndex
CREATE INDEX "VendorCreditRefund_vendorCreditId_idx" ON "VendorCreditRefund"("vendorCreditId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCreditNote_zohoCreditNoteId_key" ON "CustomerCreditNote"("zohoCreditNoteId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCreditNote_creditNoteNo_key" ON "CustomerCreditNote"("creditNoteNo");

-- CreateIndex
CREATE INDEX "CustomerCreditNote_customerId_idx" ON "CustomerCreditNote"("customerId");

-- CreateIndex
CREATE INDEX "CustomerCreditNote_storeId_idx" ON "CustomerCreditNote"("storeId");

-- CreateIndex
CREATE INDEX "CustomerCreditNote_date_idx" ON "CustomerCreditNote"("date");

-- CreateIndex
CREATE INDEX "CustomerCreditNoteApplication_invoiceNo_idx" ON "CustomerCreditNoteApplication"("invoiceNo");

-- CreateIndex
CREATE INDEX "CustomerCreditNoteApplication_deliveryId_idx" ON "CustomerCreditNoteApplication"("deliveryId");

-- CreateIndex
CREATE INDEX "CustomerCreditNoteApplication_customerInvoiceId_idx" ON "CustomerCreditNoteApplication"("customerInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCreditNoteApplication_creditNoteId_zohoInvoiceId_key" ON "CustomerCreditNoteApplication"("creditNoteId", "zohoInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_zohoLocationId_key" ON "Store"("zohoLocationId");

-- CreateIndex
CREATE INDEX "VendorBill_storeId_status_idx" ON "VendorBill"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VendorCredit_zohoVendorCreditId_key" ON "VendorCredit"("zohoVendorCreditId");

-- CreateIndex
CREATE INDEX "VendorCredit_storeId_idx" ON "VendorCredit"("storeId");

-- CreateIndex
CREATE INDEX "VendorCredit_status_idx" ON "VendorCredit"("status");

-- CreateIndex
CREATE INDEX "VendorIssue_vendorCreditId_idx" ON "VendorIssue"("vendorCreditId");

-- CreateIndex
CREATE INDEX "VendorPayment_storeId_idx" ON "VendorPayment"("storeId");

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorCredit" ADD CONSTRAINT "VendorCredit_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorCreditRefund" ADD CONSTRAINT "VendorCreditRefund_vendorCreditId_fkey" FOREIGN KEY ("vendorCreditId") REFERENCES "VendorCredit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditNote" ADD CONSTRAINT "CustomerCreditNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditNote" ADD CONSTRAINT "CustomerCreditNote_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditNoteApplication" ADD CONSTRAINT "CustomerCreditNoteApplication_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CustomerCreditNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditNoteApplication" ADD CONSTRAINT "CustomerCreditNoteApplication_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditNoteApplication" ADD CONSTRAINT "CustomerCreditNoteApplication_customerInvoiceId_fkey" FOREIGN KEY ("customerInvoiceId") REFERENCES "CustomerInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorIssue" ADD CONSTRAINT "VendorIssue_vendorCreditId_fkey" FOREIGN KEY ("vendorCreditId") REFERENCES "VendorCredit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

