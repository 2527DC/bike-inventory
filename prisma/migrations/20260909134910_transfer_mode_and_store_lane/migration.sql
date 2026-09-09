-- CreateEnum
CREATE TYPE "TransferMode" AS ENUM ('STORE_TO_STORE', 'STORE_TO_WAREHOUSE');

-- AlterTable
ALTER TABLE "TransferOrder" ADD COLUMN     "fromStoreId" TEXT,
ADD COLUMN     "mode" "TransferMode",
ADD COLUMN     "toStoreId" TEXT;

-- AddForeignKey
ALTER TABLE "TransferOrder" ADD CONSTRAINT "TransferOrder_fromStoreId_fkey" FOREIGN KEY ("fromStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrder" ADD CONSTRAINT "TransferOrder_toStoreId_fkey" FOREIGN KEY ("toStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
