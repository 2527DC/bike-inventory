-- Fix the drift left by 20260912040000_assembly_audit_build_line (plan
-- 1509-assembly-queue-single-bin-and-product-assembly-level, §6.1).
--
-- That migration was hand-written and does not build what schema.prisma declares:
--   * nine foreign keys are written with NO `ON DELETE` rule (schema: SET NULL / RESTRICT), and
--     on some databases (local bch_local, a 14 Sep copy) they are missing altogether;
--   * the table was renamed Bin -> bins but kept the primary-key name "Bin_pkey";
--   * bins.warehouse_id was added nullable and never made NOT NULL (schema: required);
--   * one index was named ..._created_at_idx where Prisma names it ..._createdAt_idx.
--
-- The statements below are exactly what
--   prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma
-- printed against a throwaway shadow database on 15 Sep 2026, made safe to run on BOTH shapes:
--   * DROP CONSTRAINT IF EXISTS, because a key may be present (wrong rule) or absent;
--   * the primary-key rename only when "Bin_pkey" still exists;
--   * ALTER INDEX IF EXISTS.
-- No table, column or row is dropped. Nothing here is a reset.
--
-- All-or-nothing: if any step fails (a bin with no warehouse, or a row pointing at a user,
-- shipment or bin that no longer exists), the whole file rolls back and the database is left
-- exactly as it was. Prisma then marks the migration failed; fix the data, run
-- `npx prisma migrate resolve --rolled-back 20260915201206_fix_assembly_fk_and_bins_drift`,
-- and deploy again.

BEGIN;

-- 0. Refuse, with a sentence, instead of guessing a warehouse for a bin that has none.
DO $$
DECLARE
  missing integer;
BEGIN
  SELECT count(*) INTO missing FROM "bins" WHERE "warehouse_id" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'bins.warehouse_id: % bin(s) have no warehouse. Give each one a warehouse, then apply this migration again.', missing;
  END IF;
END $$;

-- 1. Drop the nine keys wherever they exist, so they can be re-added with the schema's rules.
ALTER TABLE "assembly_tasks"    DROP CONSTRAINT IF EXISTS "assembly_tasks_assigned_by_id_fkey";
ALTER TABLE "assembly_tasks"    DROP CONSTRAINT IF EXISTS "assembly_tasks_assigned_to_id_fkey";
ALTER TABLE "bin_movement_logs" DROP CONSTRAINT IF EXISTS "bin_movement_logs_from_bin_id_fkey";
ALTER TABLE "bin_movement_logs" DROP CONSTRAINT IF EXISTS "bin_movement_logs_moved_by_id_fkey";
ALTER TABLE "bin_movement_logs" DROP CONSTRAINT IF EXISTS "bin_movement_logs_to_bin_id_fkey";
ALTER TABLE "complaints"        DROP CONSTRAINT IF EXISTS "complaints_attributed_by_id_fkey";
ALTER TABLE "complaints"        DROP CONSTRAINT IF EXISTS "complaints_fault_mechanic_id_fkey";
ALTER TABLE "inventory_units"   DROP CONSTRAINT IF EXISTS "inventory_units_assembled_by_id_fkey";
ALTER TABLE "inventory_units"   DROP CONSTRAINT IF EXISTS "inventory_units_inbound_shipment_id_fkey";

-- 2. bins: the primary-key name Prisma expects, and a warehouse on every bin.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Bin_pkey' AND conrelid = '"bins"'::regclass) THEN
    ALTER TABLE "bins" RENAME CONSTRAINT "Bin_pkey" TO "bins_pkey";
  END IF;
END $$;

ALTER TABLE "bins" ALTER COLUMN "warehouse_id" SET NOT NULL;

-- 3. Re-add the nine keys with the ON DELETE rule schema.prisma declares.
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_inbound_shipment_id_fkey"
  FOREIGN KEY ("inbound_shipment_id") REFERENCES "InboundShipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_assembled_by_id_fkey"
  FOREIGN KEY ("assembled_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "assembly_tasks" ADD CONSTRAINT "assembly_tasks_assigned_to_id_fkey"
  FOREIGN KEY ("assigned_to_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assembly_tasks" ADD CONSTRAINT "assembly_tasks_assigned_by_id_fkey"
  FOREIGN KEY ("assigned_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bin_movement_logs" ADD CONSTRAINT "bin_movement_logs_from_bin_id_fkey"
  FOREIGN KEY ("from_bin_id") REFERENCES "bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bin_movement_logs" ADD CONSTRAINT "bin_movement_logs_to_bin_id_fkey"
  FOREIGN KEY ("to_bin_id") REFERENCES "bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bin_movement_logs" ADD CONSTRAINT "bin_movement_logs_moved_by_id_fkey"
  FOREIGN KEY ("moved_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "complaints" ADD CONSTRAINT "complaints_fault_mechanic_id_fkey"
  FOREIGN KEY ("fault_mechanic_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "complaints" ADD CONSTRAINT "complaints_attributed_by_id_fkey"
  FOREIGN KEY ("attributed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. The index name Prisma expects.
ALTER INDEX IF EXISTS "bin_movement_logs_warehouse_id_created_at_idx"
  RENAME TO "bin_movement_logs_warehouse_id_createdAt_idx";

COMMIT;
