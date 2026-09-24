-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "zohoVendorId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_zohoVendorId_key" ON "Vendor"("zohoVendorId");

