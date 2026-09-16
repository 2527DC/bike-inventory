-- Deliveries: Bangalore / Outstation / Not chosen, and Zoho's payment snapshot
-- (plan 1609-deliveries, Phase 3).
--
-- 1. DeliveryZone enum + Delivery.deliveryZone (null = not chosen, A22). Delivery.isOutstation stays
--    and is written alongside it for one release (T6, CLAUDE.md rule 7).
-- 2. BACKFILL (A34): a delivery whose customer filled the form, or that has already been scheduled
--    or gone further, keeps the side its isOutstation says. An unfilled PENDING / VERIFIED delivery
--    (and PREBOOKED / FLAGGED, which nobody has routed either) becomes "not chosen" — every import
--    arrived as isOutstation = false, so that value never meant Bangalore.
-- 3. zohoPaymentStatus + zohoBalance (Decimal, T7): filled at import from now on; no backfill (A32).
--
-- Additive; the backfill writes only the brand-new column.

-- CreateEnum
CREATE TYPE "DeliveryZone" AS ENUM ('BANGALORE', 'OUTSTATION');

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "deliveryZone" "DeliveryZone",
ADD COLUMN     "zohoBalance" DECIMAL(12,2),
ADD COLUMN     "zohoPaymentStatus" TEXT;

UPDATE "Delivery"
SET "deliveryZone" = CASE WHEN "isOutstation" THEN 'OUTSTATION'::"DeliveryZone" ELSE 'BANGALORE'::"DeliveryZone" END
WHERE "selfFillCompletedAt" IS NOT NULL
   OR "status" IN ('SCHEDULED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PACKED', 'SHIPPED', 'IN_TRANSIT', 'WALK_OUT');
