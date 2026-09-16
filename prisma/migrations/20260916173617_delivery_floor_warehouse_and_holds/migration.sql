-- Deliveries: the FLOOR warehouse sells, holds and reduces stock (plan 1609-deliveries, Phase 1).
--
-- WHAT
-- ----
-- 1. Warehouse.invoicePrefix — the prefix moves from Store to the FLOOR warehouse (R30). Nullable
--    here on purpose (R32); the API requires it on a FLOOR. Store.invoicePrefix is left in place
--    and no longer read (CLAUDE.md rule 7) — it is dropped in a later release.
-- 2. Warehouse.isPrimary + a PARTIAL unique index: at most one primary FLOOR per store (R33).
--    Prisma cannot express a partial index, so it lives only here, exactly like
--    `Brand_name_ci_key` in 20260908151058_brand_name_ci_unique. `migrate diff` does not model
--    partial indexes and will not try to drop it — re-verify on the target after deploy.
-- 3. Delivery.warehouseId — the floor that sold the invoice. Null on an open delivery = "Dummy".
--    Restrict + index, same reasoning as Delivery.storeId.
-- 4. DATA — every existing stock hold is RELEASED (owner, B4). Holds were a product-wide counter
--    with no warehouse recorded anywhere, so they cannot be moved onto a floor honestly. After
--    this migration Product.reservedStock is a cache of SUM(StockLevel.reservedQuantity), and a
--    scheduled delivery re-holds on its floor with "Reserve stock now".
--
-- IRREVERSIBLE except by restoring the snapshot: `npm run db:snapshot` before `migrate deploy`.
-- Blast radius on any target, before deploying:
--
--   select count(*) as held_deliveries from "Delivery" where "stockReservedAt" is not null;
--   select count(*) as products_with_holds, coalesce(sum("reservedStock"),0) as units from "Product" where "reservedStock" > 0;

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "warehouseId" TEXT;

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "invoicePrefix" TEXT,
ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Delivery_warehouseId_idx" ON "Delivery"("warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_invoicePrefix_key" ON "Warehouse"("invoicePrefix");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One primary FLOOR per store (hand-written; see header). Every row starts false, so this can
-- never fail at creation.
CREATE UNIQUE INDEX "Warehouse_one_primary_floor_per_store"
  ON "Warehouse" ("storeId") WHERE "isPrimary" AND "kind" = 'FLOOR';

-- Release every existing hold (B4).
UPDATE "StockLevel" SET "reservedQuantity" = 0 WHERE "reservedQuantity" <> 0;
UPDATE "Product" SET "reservedStock" = 0 WHERE "reservedStock" <> 0;
UPDATE "Delivery" SET "stockReservedAt" = NULL WHERE "stockReservedAt" IS NOT NULL;
