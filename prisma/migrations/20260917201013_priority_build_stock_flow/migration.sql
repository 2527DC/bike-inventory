-- Priority build & stock flow — Wave 0 schema (plan 1709-priority-build-and-stock-flow, §3.1).
--
-- 1. Hold issue on a build: HoldIssue enum + assembly_tasks.hold_issue / hold_note (R3, R6).
--    hold_reason stays, no longer written (rule 7).
-- 2. Units: UnitStatus RESET (P3); reserved_for_delivery_id / reserved_at for ★ (R16, R21);
--    non_assemblable stamp (R42, P6); source_transaction_id — the inward that created it (P4).
-- 3. ★ priority and outbound approval columns on Delivery (R19–R21, R26a).
-- 4. Returned + resubmit: TransferOrderStatus RETURNED, TransferOrder.resubmittedAt; inbound
--    rejectedAt/ById, rejectionNote, resubmittedAt (R25). TransferOrder.deliveryId (R45, P16).
-- 5. StockCountItem.assembledQty / unassembledQty (Q42).
-- 6. approval_events table + ApprovalActivity / ApprovalEventType enums (R26).
-- 7. modules.dividerBefore (P5), bins.non_assemblable (R42), Customer Google sync status (P14c).
--
-- Additive only. The two ADD VALUE statements are not used anywhere in this migration (55P04).

-- CreateEnum
CREATE TYPE "HoldIssue" AS ENUM ('CYCLE', 'WORKFLOOR');

-- CreateEnum
CREATE TYPE "ApprovalActivity" AS ENUM ('INBOUND', 'OUTBOUND', 'TRANSFER', 'STOCK_AUDIT');

-- CreateEnum
CREATE TYPE "ApprovalEventType" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'RESUBMITTED', 'REVERSED', 'CORRECTED', 'SHORT_RECEIVED', 'FLAGGED');

-- AlterEnum
ALTER TYPE "TransferOrderStatus" ADD VALUE 'RETURNED';

-- AlterEnum
ALTER TYPE "UnitStatus" ADD VALUE 'RESET';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "googleContactId" TEXT,
ADD COLUMN     "googleSyncError" TEXT,
ADD COLUMN     "googleSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "approvalNote" TEXT,
ADD COLUMN     "approvalRequestedAt" TIMESTAMP(3),
ADD COLUMN     "approvalRequestedById" TEXT,
ADD COLUMN     "approvalReturnedAt" TIMESTAMP(3),
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "priorityAt" TIMESTAMP(3),
ADD COLUMN     "priorityById" TEXT;

-- AlterTable
ALTER TABLE "InboundShipment" ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedById" TEXT,
ADD COLUMN     "rejectionNote" TEXT,
ADD COLUMN     "resubmittedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StockCountItem" ADD COLUMN     "assembledQty" INTEGER,
ADD COLUMN     "unassembledQty" INTEGER;

-- AlterTable
ALTER TABLE "TransferOrder" ADD COLUMN     "deliveryId" TEXT,
ADD COLUMN     "resubmittedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "assembly_tasks" ADD COLUMN     "hold_issue" "HoldIssue",
ADD COLUMN     "hold_note" TEXT;

-- AlterTable
ALTER TABLE "bins" ADD COLUMN     "non_assemblable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "inventory_units" ADD COLUMN     "non_assemblable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reserved_at" TIMESTAMP(3),
ADD COLUMN     "reserved_for_delivery_id" TEXT,
ADD COLUMN     "source_transaction_id" TEXT;

-- AlterTable
ALTER TABLE "modules" ADD COLUMN     "dividerBefore" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "approval_events" (
    "id" TEXT NOT NULL,
    "activity" "ApprovalActivity" NOT NULL,
    "event" "ApprovalEventType" NOT NULL,
    "record_id" TEXT NOT NULL,
    "record_ref" TEXT,
    "actor_id" TEXT NOT NULL,
    "approver_id" TEXT,
    "product_id" TEXT,
    "warehouse_id" TEXT,
    "quantity" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_events_activity_record_id_idx" ON "approval_events"("activity", "record_id");

-- CreateIndex
CREATE INDEX "approval_events_approver_id_event_created_at_idx" ON "approval_events"("approver_id", "event", "created_at");

-- CreateIndex
CREATE INDEX "approval_events_product_id_warehouse_id_created_at_idx" ON "approval_events"("product_id", "warehouse_id", "created_at");

-- CreateIndex
CREATE INDEX "TransferOrder_deliveryId_idx" ON "TransferOrder"("deliveryId");

-- CreateIndex
CREATE INDEX "inventory_units_reserved_for_delivery_id_idx" ON "inventory_units"("reserved_for_delivery_id");

-- CreateIndex
CREATE INDEX "inventory_units_source_transaction_id_idx" ON "inventory_units"("source_transaction_id");

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_reserved_for_delivery_id_fkey" FOREIGN KEY ("reserved_for_delivery_id") REFERENCES "Delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_source_transaction_id_fkey" FOREIGN KEY ("source_transaction_id") REFERENCES "InventoryTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_priorityById_fkey" FOREIGN KEY ("priorityById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_approvalRequestedById_fkey" FOREIGN KEY ("approvalRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrder" ADD CONSTRAINT "TransferOrder_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundShipment" ADD CONSTRAINT "InboundShipment_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

