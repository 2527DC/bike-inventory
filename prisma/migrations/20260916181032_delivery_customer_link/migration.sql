-- Delivery.customerId -> Customer (plan 1609-deliveries, Phase 2, A2).
--
-- Save Contact finds or creates the Customer row by phone and links it here. "The customer is
-- saved" is this column being set; the server requires it before Schedule, Walk-out and Generate
-- Link. Nullable and additive (CLAUDE.md rule 7): every existing delivery stays valid and simply
-- reads as not saved. Restrict + index, the same reasoning as Delivery.storeId.

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "customerId" TEXT;

-- CreateIndex
CREATE INDEX "Delivery_customerId_idx" ON "Delivery"("customerId");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
