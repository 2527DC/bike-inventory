/*
  Warnings:

  - Added the required column `name` to the `PurchaseOrderItem` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "PurchaseOrderItem" DROP CONSTRAINT "PurchaseOrderItem_productId_fkey";

-- AlterTable
ALTER TABLE "PoExtraction" ADD COLUMN     "columnRoles" JSONB,
ADD COLUMN     "hint" TEXT,
ADD COLUMN     "legend" JSONB,
ADD COLUMN     "stage" TEXT NOT NULL DEFAULT 'columns';

-- AlterTable
ALTER TABLE "PoExtractionItem" ADD COLUMN     "columns" JSONB,
ADD COLUMN     "rowColor" TEXT,
ADD COLUMN     "rowIndex" INTEGER,
ADD COLUMN     "sheetName" TEXT;

-- AlterTable — hand-edited (CLAUDE.md migration rule 3): a NOT NULL column on a populated
-- table is added nullable, backfilled, then constrained. Every existing line has a product,
-- so its name is the product name it printed until now.
ALTER TABLE "PurchaseOrderItem" ADD COLUMN     "name" TEXT,
ALTER COLUMN "productId" DROP NOT NULL;

UPDATE "PurchaseOrderItem" i SET "name" = p."name" FROM "Product" p WHERE p."id" = i."productId" AND i."name" IS NULL;
UPDATE "PurchaseOrderItem" SET "name" = '(unnamed line)' WHERE "name" IS NULL;

ALTER TABLE "PurchaseOrderItem" ALTER COLUMN "name" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
