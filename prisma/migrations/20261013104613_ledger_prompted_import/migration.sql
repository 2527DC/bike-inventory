-- Plan 1310 ledger prompted import — additive (CLAUDE.md rules 3, 7): one enum value, one nullable column.

-- AlterEnum
ALTER TYPE "LedgerAiTask" ADD VALUE 'PROMPTED_IMPORT';

-- AlterTable
ALTER TABLE "ledger_ai_runs" ADD COLUMN     "source" JSONB;

