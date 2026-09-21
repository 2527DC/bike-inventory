-- Plan 2109 R28, step 1 (Q17a): one contact person on Vendor.
-- Additive only (rule 7). VendorContact is NOT dropped here; a later release drops it after the
-- owner has seen which vendors hold more than one contact (npm run db:backfill:vendor-contact).
-- Hand-written (no shadow database used); verified against the schema with
-- `prisma migrate diff --from-url <bch_local> --to-schema-datamodel` after applying.

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "contactDesignation" TEXT,
ADD COLUMN     "contactPerson" TEXT;
