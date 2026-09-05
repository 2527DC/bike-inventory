-- P1 of the 0409 unified plan (MIG-1a): the activity log, the sequence counter, and the
-- scope / lane / send columns that later phases fill in.
--
-- ADDITIVE except for one statement. Every column below is nullable or defaulted, so the
-- code running when this applies -- which is the OLD code, minutes before the new deploy --
-- keeps working untouched (CLAUDE.md rule 7).
--
-- The one irreversible statement is `DROP TABLE "OpsActivityLog"`, and it is safe by
-- MEASUREMENT, not by assumption:
--
--     SELECT count(*) FROM "OpsActivityLog";   ->  0     (checked on bch-local, 5 Sep 2026)
--
-- Its only writer was src/app/api/ops-activity-logs/route.ts, deleted in this same commit,
-- and no client ever called it -- /activity reads /api/activity. `ActivityLog` replaces it
-- with a shape that records who / module / from -> to / when (R11).
--
-- Prisma has no down migrations. The rollback is the snapshot taken before merge.
--
-- -- On the two enum values ---------------------------------------------------------------
-- `ALTER TYPE ... ADD VALUE` runs inside this transaction, which PostgreSQL allows from
-- version 12 (this server is 17.6). What it does NOT allow is USING the new value in the
-- same transaction (error 55P04). Neither backfill below touches IN_TRANSIT or RECEIVED --
-- the UPDATE that does is MIG-2 in P14, which is a separate folder for exactly this reason.

-- CreateEnum
CREATE TYPE "PurchaseOrderSendStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "PurchaseOrderSendChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'MANUAL');

-- CreateEnum
CREATE TYPE "TransferType" AS ENUM ('INTRA_STORE', 'INTER_STORE');

-- CreateEnum
CREATE TYPE "TransferDocType" AS ENUM ('DELIVERY_CHALLAN', 'TAX_INVOICE');

-- CreateEnum
CREATE TYPE "BrandStockAvailability" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'UNKNOWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransferOrderStatus" ADD VALUE 'IN_TRANSIT';
ALTER TYPE "TransferOrderStatus" ADD VALUE 'RECEIVED';

-- DropForeignKey
ALTER TABLE "OpsActivityLog" DROP CONSTRAINT "OpsActivityLog_userId_fkey";

-- AlterTable
ALTER TABLE "BrandStockItem" ADD COLUMN     "availability" "BrandStockAvailability" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "rowColor" TEXT;

-- AlterTable
ALTER TABLE "BrandStockUpload" ADD COLUMN     "colorLegend" JSONB,
ADD COLUMN     "legendConfirmedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "storeId" TEXT;

-- AlterTable
ALTER TABLE "InboundShipment" ADD COLUMN     "categoryId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "sendCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "sentById" TEXT,
ADD COLUMN     "sentToEmail" TEXT,
ADD COLUMN     "sentVia" "PurchaseOrderSendChannel";

-- AlterTable
ALTER TABLE "StockCount" ADD COLUMN     "storeId" TEXT,
ADD COLUMN     "warehouseId" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "invoicePrefix" TEXT,
ADD COLUMN     "stateCode" TEXT;

-- AlterTable
ALTER TABLE "TransferOrder" ADD COLUMN     "consignmentValue" DECIMAL(12,2),
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "dispatchedById" TEXT,
ADD COLUMN     "docDate" TIMESTAMP(3),
ADD COLUMN     "docNumber" TEXT,
ADD COLUMN     "docType" "TransferDocType",
ADD COLUMN     "docUploadedAt" TIMESTAMP(3),
ADD COLUMN     "docUploadedById" TEXT,
ADD COLUMN     "docUrl" TEXT,
ADD COLUMN     "eWayBillNo" TEXT,
ADD COLUMN     "fromWarehouseId" TEXT,
ADD COLUMN     "receiveNote" TEXT,
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedById" TEXT,
ADD COLUMN     "requiredDocType" "TransferDocType",
ADD COLUMN     "toWarehouseId" TEXT,
ADD COLUMN     "transferType" "TransferType",
ADD COLUMN     "transporterName" TEXT,
ADD COLUMN     "vehicleNo" TEXT;

-- AlterTable
ALTER TABLE "TransferOrderItem" ADD COLUMN     "receivedQty" INTEGER,
ADD COLUMN     "unitCost" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "integration_config" ADD COLUMN     "lastAuthErrorAt" TIMESTAMP(3);

-- DropTable
DROP TABLE "OpsActivityLog";

-- CreateTable
CREATE TABLE "PurchaseOrderSend" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "channel" "PurchaseOrderSendChannel" NOT NULL,
    "status" "PurchaseOrderSendStatus" NOT NULL DEFAULT 'PENDING',
    "toEmail" TEXT,
    "ccEmail" TEXT,
    "subject" TEXT,
    "note" TEXT,
    "sentById" TEXT NOT NULL,
    "sentByName" TEXT NOT NULL,
    "messageId" TEXT,
    "error" TEXT,
    "pdfUrl" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PurchaseOrderSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityRef" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "details" TEXT,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counter" (
    "key" TEXT NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "counter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "PurchaseOrderSend_purchaseOrderId_attemptedAt_idx" ON "PurchaseOrderSend"("purchaseOrderId", "attemptedAt");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_createdAt_idx" ON "ActivityLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_module_createdAt_idx" ON "ActivityLog"("module", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_entityType_entityId_idx" ON "ActivityLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Delivery_storeId_idx" ON "Delivery"("storeId");

-- CreateIndex
CREATE INDEX "InboundShipment_categoryId_idx" ON "InboundShipment"("categoryId");

-- CreateIndex
CREATE INDEX "StockCount_assignedToId_status_idx" ON "StockCount"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "StockCount_storeId_idx" ON "StockCount"("storeId");

-- CreateIndex
CREATE INDEX "StockCount_warehouseId_idx" ON "StockCount"("warehouseId");

-- CreateIndex
CREATE INDEX "StockCountItem_stockCountId_idx" ON "StockCountItem"("stockCountId");

-- CreateIndex
CREATE INDEX "StockCountItem_productId_idx" ON "StockCountItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_invoicePrefix_key" ON "Store"("invoicePrefix");

-- CreateIndex
CREATE INDEX "TransferOrder_fromWarehouseId_idx" ON "TransferOrder"("fromWarehouseId");

-- CreateIndex
CREATE INDEX "TransferOrder_toWarehouseId_idx" ON "TransferOrder"("toWarehouseId");

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderSend" ADD CONSTRAINT "PurchaseOrderSend_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrder" ADD CONSTRAINT "TransferOrder_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrder" ADD CONSTRAINT "TransferOrder_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundShipment" ADD CONSTRAINT "InboundShipment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ------------------------------------------------------------------------------------------
-- HAND-WRITTEN BACKFILLS. Everything above this line was generated by `prisma migrate diff`
-- and read line by line; everything below was added by hand and is not reproducible from the
-- schema. Both are idempotent and both are no-ops on a database that has no such rows.
-- ------------------------------------------------------------------------------------------

-- 1. Audit scope, from the free-text location it replaces.
--
-- `StockCount.location` held the warehouse CODE for a warehouse-scoped audit
-- (api/stock-counts/route.ts wrote `scopedWarehouse?.code ?? locationScope ?? null`), so a
-- row whose location matches a Warehouse.code resolves to that warehouse AND its store.
--
-- A row whose location is NOT a warehouse code -- the bin-tracking branch wrote things like
-- "BCH-GF" -- is deliberately LEFT WITH BOTH FKs NULL. That is the explicit third state,
-- "legacy audit, no resolvable scope" (plan section 5.1). It must never be read as "the
-- whole store", which is why this does not fall back to a default store.
--
-- `location` itself is KEPT. It is dropped in MIG-2 (P14), a release after the code stopped
-- reading it -- additive first.
--
-- Checked on bch-local, 5 Sep 2026: 0 StockCount rows, so this is a no-op here. It is
-- written for the databases where it is not.
UPDATE "StockCount" sc
SET "warehouseId" = w.id,
    "storeId"     = w."storeId"
FROM "Warehouse" w
WHERE sc."location" IS NOT NULL
  AND upper(sc."location") = w.code;

-- 2. Normalise legacy 4-digit PO numbers to 5 digits.
--
-- The two PO allocators disagree: api/purchase-orders/route.ts pads to 5, generate-po pads
-- to 4. P9 fixes 5 (PO-00042) and routes both through one helper. Until every stored number
-- is the same width, string ordering is wrong -- "PO-0002" sorts above "PO-00010" -- and the
-- allocator's `orderBy: { poNumber: "desc" }` hands out a duplicate.
--
-- If a PO-0042 / PO-00042 PAIR already exists, the unique index refuses this UPDATE and the
-- migration FAILS. That is the intended outcome, not a bug: a failed migration is a failed
-- build and no deploy, so the collision is resolved by hand before anything ships rather
-- than being silently mangled here.
--
-- Checked on bch-local, 5 Sep 2026: 0 PurchaseOrder rows, so this is a no-op here.
UPDATE "PurchaseOrder"
SET "poNumber" = 'PO-' || lpad(substring("poNumber" from '\d+$'), 5, '0')
WHERE "poNumber" ~ '^PO-\d{4}$';
