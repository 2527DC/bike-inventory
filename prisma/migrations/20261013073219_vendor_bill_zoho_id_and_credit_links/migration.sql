-- CreateEnum
CREATE TYPE "CreditApplicationSource" AS ENUM ('ZOHO', 'APP');

-- AlterTable
ALTER TABLE "VendorBill" ADD COLUMN     "creditAppliedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "zohoBillId" TEXT,
ADD COLUMN     "zohoLocationId" TEXT;

-- CreateTable
CREATE TABLE "VendorCreditApplication" (
    "id" TEXT NOT NULL,
    "source" "CreditApplicationSource" NOT NULL DEFAULT 'ZOHO',
    "zohoVendorCreditBillId" TEXT,
    "zohoVendorCreditId" TEXT,
    "zohoBillId" TEXT,
    "vendorCreditId" TEXT,
    "billId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "appliedDate" TIMESTAMP(3) NOT NULL,
    "appliedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorCreditApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorCreditApplication_zohoVendorCreditBillId_key" ON "VendorCreditApplication"("zohoVendorCreditBillId");

-- CreateIndex
CREATE INDEX "VendorCreditApplication_vendorCreditId_idx" ON "VendorCreditApplication"("vendorCreditId");

-- CreateIndex
CREATE INDEX "VendorCreditApplication_billId_idx" ON "VendorCreditApplication"("billId");

-- CreateIndex
CREATE INDEX "VendorCreditApplication_zohoBillId_idx" ON "VendorCreditApplication"("zohoBillId");

-- CreateIndex
CREATE INDEX "VendorCreditApplication_zohoVendorCreditId_idx" ON "VendorCreditApplication"("zohoVendorCreditId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBill_zohoBillId_key" ON "VendorBill"("zohoBillId");

-- AddForeignKey
ALTER TABLE "VendorCreditApplication" ADD CONSTRAINT "VendorCreditApplication_vendorCreditId_fkey" FOREIGN KEY ("vendorCreditId") REFERENCES "VendorCredit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorCreditApplication" ADD CONSTRAINT "VendorCreditApplication_billId_fkey" FOREIGN KEY ("billId") REFERENCES "VendorBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorCreditApplication" ADD CONSTRAINT "VendorCreditApplication_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

