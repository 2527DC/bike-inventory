-- Give Brand and Category the id their counterpart has in Zoho Inventory.
--
-- WHY
-- ---
-- The Zoho item export (prisma/data/Item.xls) carries a brand NAME and a category NAME, never
-- an id. Names are not a stable handle: Zoho's /brands and /categories endpoints are keyed on
-- `brand_id` / `category_id`, and `category.parent_category_id` points at a ZOHO id, not at
-- one of ours. Without these two columns the category tree cannot be rebuilt from the export
-- at all, and a brand renamed in Zoho silently becomes a second brand here.
--
-- These columns were previously created OUTSIDE Prisma, by an `ALTER TABLE ... ADD COLUMN IF
-- NOT EXISTS` at the top of the generated prisma/data/catalog.sql. That put the database ahead
-- of prisma/schema.prisma, which is exactly the drift `prisma migrate dev` responds to by
-- offering to reset. This migration is that DDL moved to where CLAUDE.md requires it, so
-- catalog.sql's `IF NOT EXISTS` / `CREATE UNIQUE INDEX IF NOT EXISTS` now find their work
-- already done and do nothing. The index NAMES below match the ones catalog.sql uses
-- (`Brand_zohoBrandId_key`, `Category_zohoCategoryId_key`) — that is what makes it a no-op
-- rather than a duplicate.
--
-- ADDITIVE ONLY (CLAUDE.md rule 7): both columns are nullable and nothing reads them yet, so
-- the code running before this migration survives the new schema unchanged.
--
-- The unique constraints are safe to add on a populated table here because both columns are
-- new and therefore NULL on every existing row, and Postgres does not consider two NULLs
-- equal. They start being enforced from the first row that carries a Zoho id.

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "zohoBrandId" TEXT;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "zohoCategoryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Brand_zohoBrandId_key" ON "Brand"("zohoBrandId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_zohoCategoryId_key" ON "Category"("zohoCategoryId");
