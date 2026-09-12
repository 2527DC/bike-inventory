-- Assembly Audit & Build-Line Inventory Management
-- Migration: assembly_audit_build_line
-- Date: 2026-09-12

-- ═══════════════════════════════════════════════════════════════════════
-- 1. ENUMS
-- ═══════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UnitStatus') THEN
    CREATE TYPE "UnitStatus" AS ENUM (
      'RECEIVED', 'PUT_AWAY', 'ASSIGNED', 'IN_ASSEMBLY', 'ASSEMBLED',
      'RESERVED', 'SOLD', 'RETURNED', 'DAMAGED', 'TRANSFERRED', 'LOST'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssemblyLevel') THEN
    CREATE TYPE "AssemblyLevel" AS ENUM ('A50', 'A85', 'FULL');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssemblyTaskStatus') THEN
    CREATE TYPE "AssemblyTaskStatus" AS ENUM (
      'PENDING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'
    );
  END IF;
END $$;

-- Add GODOWN_TO_FLOOR to TransferMode enum
ALTER TYPE "TransferMode" ADD VALUE IF NOT EXISTS 'GODOWN_TO_FLOOR';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. TABLE "Bin" -> "bins" & EXTENSIONS
-- ═══════════════════════════════════════════════════════════════════════

-- In 0_init, the table was named "Bin". Rename to "bins" if it exists as "Bin"
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'Bin') THEN
    ALTER TABLE "Bin" RENAME TO "bins";
  END IF;
END $$;

-- If bins table doesn't exist at all (fallback), create it
CREATE TABLE IF NOT EXISTS "bins" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "location" TEXT,
  "zone" TEXT,
  "capacity" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Bin_pkey" PRIMARY KEY ("id")
);

-- Drop NOT NULL on legacy location column
ALTER TABLE "bins" ALTER COLUMN "location" DROP NOT NULL;

-- Add new columns to bins
ALTER TABLE "bins" ADD COLUMN IF NOT EXISTS "warehouse_id" TEXT;
ALTER TABLE "bins" ADD COLUMN IF NOT EXISTS "directions" TEXT;
ALTER TABLE "bins" ADD COLUMN IF NOT EXISTS "floor" TEXT;
ALTER TABLE "bins" ADD COLUMN IF NOT EXISTS "is_assembly_area" BOOLEAN NOT NULL DEFAULT false;

-- Backfill warehouse_id from first warehouse if rows exist without it
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Warehouse" LIMIT 1) THEN
    UPDATE "bins" SET "warehouse_id" = (SELECT "id" FROM "Warehouse" LIMIT 1) WHERE "warehouse_id" IS NULL;
  END IF;
END $$;

-- Drop legacy unique index on code alone
DROP INDEX IF EXISTS "Bin_code_key";
DROP INDEX IF EXISTS "bins_code_key";

-- FK constraint to Warehouse
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bins_warehouse_id_fkey') THEN
    ALTER TABLE "bins" ADD CONSTRAINT "bins_warehouse_id_fkey"
      FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "bins_warehouse_id_isActive_idx" ON "bins"("warehouse_id", "isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "bins_warehouse_id_code_key" ON "bins"("warehouse_id", "code");

-- ═══════════════════════════════════════════════════════════════════════
-- 3. CREATE bin_stocks TABLE
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "bin_stocks" (
  "id" TEXT NOT NULL,
  "bin_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "bin_stocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "bin_stocks_bin_id_product_id_key" ON "bin_stocks"("bin_id", "product_id");
CREATE INDEX IF NOT EXISTS "bin_stocks_product_id_idx" ON "bin_stocks"("product_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bin_stocks_bin_id_fkey') THEN
    ALTER TABLE "bin_stocks" ADD CONSTRAINT "bin_stocks_bin_id_fkey"
      FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bin_stocks_product_id_fkey') THEN
    ALTER TABLE "bin_stocks" ADD CONSTRAINT "bin_stocks_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. CREATE home_bin_rules TABLE
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "home_bin_rules" (
  "id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "brand_id" TEXT,
  "category_id" TEXT,
  "product_id" TEXT,
  "bin_id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "home_bin_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "home_bin_rules_warehouse_id_brand_id_category_id_idx"
  ON "home_bin_rules"("warehouse_id", "brand_id", "category_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'home_bin_rules_warehouse_id_fkey') THEN
    ALTER TABLE "home_bin_rules" ADD CONSTRAINT "home_bin_rules_warehouse_id_fkey"
      FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'home_bin_rules_brand_id_fkey') THEN
    ALTER TABLE "home_bin_rules" ADD CONSTRAINT "home_bin_rules_brand_id_fkey"
      FOREIGN KEY ("brand_id") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'home_bin_rules_category_id_fkey') THEN
    ALTER TABLE "home_bin_rules" ADD CONSTRAINT "home_bin_rules_category_id_fkey"
      FOREIGN KEY ("category_id") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'home_bin_rules_product_id_fkey') THEN
    ALTER TABLE "home_bin_rules" ADD CONSTRAINT "home_bin_rules_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'home_bin_rules_bin_id_fkey') THEN
    ALTER TABLE "home_bin_rules" ADD CONSTRAINT "home_bin_rules_bin_id_fkey"
      FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. CREATE inventory_units TABLE
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "inventory_units" (
  "id" TEXT NOT NULL,
  "unit_code" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "bin_id" TEXT,
  "frame_number" TEXT,
  "status" "UnitStatus" NOT NULL DEFAULT 'RECEIVED',
  "inbound_shipment_id" TEXT,
  "assembled_by_id" TEXT,
  "assembled_at" TIMESTAMP(3),
  "assembly_level" "AssemblyLevel",
  "sale_invoice_no" TEXT,
  "sold_at" TIMESTAMP(3),
  "customer_name" TEXT,
  "customer_phone" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "inventory_units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_units_unit_code_key" ON "inventory_units"("unit_code");
CREATE INDEX IF NOT EXISTS "inventory_units_warehouse_id_status_idx" ON "inventory_units"("warehouse_id", "status");
CREATE INDEX IF NOT EXISTS "inventory_units_product_id_status_idx" ON "inventory_units"("product_id", "status");
CREATE INDEX IF NOT EXISTS "inventory_units_bin_id_idx" ON "inventory_units"("bin_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_units_product_id_fkey') THEN
    ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_units_warehouse_id_fkey') THEN
    ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_warehouse_id_fkey"
      FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_units_bin_id_fkey') THEN
    ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_bin_id_fkey"
      FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_units_inbound_shipment_id_fkey') THEN
    ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_inbound_shipment_id_fkey"
      FOREIGN KEY ("inbound_shipment_id") REFERENCES "InboundShipment"("id") ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_units_assembled_by_id_fkey') THEN
    ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_assembled_by_id_fkey"
      FOREIGN KEY ("assembled_by_id") REFERENCES "User"("id") ON UPDATE CASCADE;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. CREATE assembly_tasks TABLE
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "assembly_tasks" (
  "id" TEXT NOT NULL,
  "unit_id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "level" "AssemblyLevel" NOT NULL,
  "status" "AssemblyTaskStatus" NOT NULL DEFAULT 'PENDING',
  "assigned_to_id" TEXT NOT NULL,
  "assigned_by_id" TEXT NOT NULL,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "hold_started_at" TIMESTAMP(3),
  "total_hold_seconds" INTEGER NOT NULL DEFAULT 0,
  "hold_reason" TEXT,
  "completed_at" TIMESTAMP(3),
  "photo_url" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "assembly_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "assembly_tasks_warehouse_id_status_idx" ON "assembly_tasks"("warehouse_id", "status");
CREATE INDEX IF NOT EXISTS "assembly_tasks_assigned_to_id_status_idx" ON "assembly_tasks"("assigned_to_id", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assembly_tasks_unit_id_fkey') THEN
    ALTER TABLE "assembly_tasks" ADD CONSTRAINT "assembly_tasks_unit_id_fkey"
      FOREIGN KEY ("unit_id") REFERENCES "inventory_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assembly_tasks_warehouse_id_fkey') THEN
    ALTER TABLE "assembly_tasks" ADD CONSTRAINT "assembly_tasks_warehouse_id_fkey"
      FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assembly_tasks_assigned_to_id_fkey') THEN
    ALTER TABLE "assembly_tasks" ADD CONSTRAINT "assembly_tasks_assigned_to_id_fkey"
      FOREIGN KEY ("assigned_to_id") REFERENCES "User"("id") ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assembly_tasks_assigned_by_id_fkey') THEN
    ALTER TABLE "assembly_tasks" ADD CONSTRAINT "assembly_tasks_assigned_by_id_fkey"
      FOREIGN KEY ("assigned_by_id") REFERENCES "User"("id") ON UPDATE CASCADE;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. CREATE bin_movement_logs TABLE
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "bin_movement_logs" (
  "id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "unit_id" TEXT,
  "product_id" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "from_bin_id" TEXT,
  "to_bin_id" TEXT,
  "reason" TEXT NOT NULL,
  "moved_by_id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "bin_movement_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "bin_movement_logs_warehouse_id_created_at_idx" ON "bin_movement_logs"("warehouse_id", "createdAt");
CREATE INDEX IF NOT EXISTS "bin_movement_logs_unit_id_idx" ON "bin_movement_logs"("unit_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bin_movement_logs_warehouse_id_fkey') THEN
    ALTER TABLE "bin_movement_logs" ADD CONSTRAINT "bin_movement_logs_warehouse_id_fkey"
      FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bin_movement_logs_unit_id_fkey') THEN
    ALTER TABLE "bin_movement_logs" ADD CONSTRAINT "bin_movement_logs_unit_id_fkey"
      FOREIGN KEY ("unit_id") REFERENCES "inventory_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bin_movement_logs_product_id_fkey') THEN
    ALTER TABLE "bin_movement_logs" ADD CONSTRAINT "bin_movement_logs_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bin_movement_logs_from_bin_id_fkey') THEN
    ALTER TABLE "bin_movement_logs" ADD CONSTRAINT "bin_movement_logs_from_bin_id_fkey"
      FOREIGN KEY ("from_bin_id") REFERENCES "bins"("id") ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bin_movement_logs_to_bin_id_fkey') THEN
    ALTER TABLE "bin_movement_logs" ADD CONSTRAINT "bin_movement_logs_to_bin_id_fkey"
      FOREIGN KEY ("to_bin_id") REFERENCES "bins"("id") ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bin_movement_logs_moved_by_id_fkey') THEN
    ALTER TABLE "bin_movement_logs" ADD CONSTRAINT "bin_movement_logs_moved_by_id_fkey"
      FOREIGN KEY ("moved_by_id") REFERENCES "User"("id") ON UPDATE CASCADE;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. CREATE transfer_order_units TABLE
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "transfer_order_units" (
  "id" TEXT NOT NULL,
  "transfer_order_id" TEXT NOT NULL,
  "unit_id" TEXT NOT NULL,
  "dispatched_at" TIMESTAMP(3),
  "received_at" TIMESTAMP(3),

  CONSTRAINT "transfer_order_units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "transfer_order_units_transfer_order_id_unit_id_key"
  ON "transfer_order_units"("transfer_order_id", "unit_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfer_order_units_transfer_order_id_fkey') THEN
    ALTER TABLE "transfer_order_units" ADD CONSTRAINT "transfer_order_units_transfer_order_id_fkey"
      FOREIGN KEY ("transfer_order_id") REFERENCES "TransferOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfer_order_units_unit_id_fkey') THEN
    ALTER TABLE "transfer_order_units" ADD CONSTRAINT "transfer_order_units_unit_id_fkey"
      FOREIGN KEY ("unit_id") REFERENCES "inventory_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 9. CREATE complaints TABLE
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "complaints" (
  "id" TEXT NOT NULL,
  "ticket_no" TEXT NOT NULL,
  "unit_id" TEXT NOT NULL,
  "customer_name" TEXT NOT NULL,
  "customer_phone" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "photo_url" TEXT,
  "is_assembly_fault" BOOLEAN NOT NULL DEFAULT false,
  "fault_mechanic_id" TEXT,
  "attributed_by_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "complaints_ticket_no_key" ON "complaints"("ticket_no");
CREATE INDEX IF NOT EXISTS "complaints_unit_id_idx" ON "complaints"("unit_id");
CREATE INDEX IF NOT EXISTS "complaints_fault_mechanic_id_idx" ON "complaints"("fault_mechanic_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_unit_id_fkey') THEN
    ALTER TABLE "complaints" ADD CONSTRAINT "complaints_unit_id_fkey"
      FOREIGN KEY ("unit_id") REFERENCES "inventory_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_fault_mechanic_id_fkey') THEN
    ALTER TABLE "complaints" ADD CONSTRAINT "complaints_fault_mechanic_id_fkey"
      FOREIGN KEY ("fault_mechanic_id") REFERENCES "User"("id") ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_attributed_by_id_fkey') THEN
    ALTER TABLE "complaints" ADD CONSTRAINT "complaints_attributed_by_id_fkey"
      FOREIGN KEY ("attributed_by_id") REFERENCES "User"("id") ON UPDATE CASCADE;
  END IF;
END $$;
