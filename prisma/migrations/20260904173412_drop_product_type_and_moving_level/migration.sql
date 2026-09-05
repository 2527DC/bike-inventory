-- P3 of the 0409 unified plan (R4): remove product type and category movingLevel.
--
-- Destroys, deliberately and with the owner scoping it:
--   * ProductType (3 rows: Cycles, Spares, Accessories)
--   * Product.productTypeId on 5739 products -- the classification, not the products
--   * Category.movingLevel     (0 rows held anything but the NORMAL default)
--   * StockCount.productType   (0 rows were non-null)
--
-- The FK and both indexes are dropped BEFORE the column, and the column before the
-- table, because Postgres refuses the reverse order.
--
-- Prisma has no down migrations. The rollback is the snapshot taken before merge.

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_productTypeId_fkey";

-- DropIndex
DROP INDEX "Product_productTypeId_idx";

-- DropIndex
DROP INDEX "Product_status_productTypeId_idx";

-- AlterTable
ALTER TABLE "Category" DROP COLUMN "movingLevel";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "productTypeId";

-- AlterTable
ALTER TABLE "StockCount" DROP COLUMN "productType";

-- DropTable
DROP TABLE "ProductType";

