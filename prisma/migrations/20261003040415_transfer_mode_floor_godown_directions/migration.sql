-- Transfers run in four Floor/Godown directions (plan 0310-bin-delete-multi-category-rules-and-
-- transfer-directions, R7, Part D). GODOWN_TO_FLOOR already exists; these are the other three.
--
-- Additive only (CLAUDE.md rule 7): STORE_TO_STORE / STORE_TO_WAREHOUSE stay for older orders.
-- The new values are not used anywhere in this migration (55P04).

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransferMode" ADD VALUE 'FLOOR_TO_FLOOR';
ALTER TYPE "TransferMode" ADD VALUE 'FLOOR_TO_GODOWN';
ALTER TYPE "TransferMode" ADD VALUE 'GODOWN_TO_GODOWN';
