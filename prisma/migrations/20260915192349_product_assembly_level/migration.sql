-- Plan 1509-assembly-queue-single-bin-and-product-assembly-level, A1 / D3.
-- The ONE assembly condition level per product. Nullable and additive: null means "not decided
-- yet", so every existing row stays valid and the old code never reads it (rule 7).
-- Hand-written because `migrate dev` on local bch_local reported pre-existing drift
-- (inventory_units / assembly_tasks / bin_movement_logs FKs) and asked for a reset; this file
-- is exactly the Product line of `migrate diff --from-schema-datasource --to-schema-datamodel`.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "assemblyLevel" "AssemblyLevel";
