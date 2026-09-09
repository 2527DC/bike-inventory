-- CreateEnum
CREATE TYPE "WarehouseKind" AS ENUM ('FLOOR', 'GODOWN');

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "kind" "WarehouseKind" NOT NULL DEFAULT 'GODOWN';
