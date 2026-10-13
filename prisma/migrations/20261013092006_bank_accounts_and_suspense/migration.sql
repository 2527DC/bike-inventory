-- Plan 1210 bank accounts and suspense — one migration, additive (CLAUDE.md rules 3, 7).
-- Unique indexes on BankTransaction.confirmedPaymentId / confirmedExpenseId: the test copy of
-- production (3 Oct) holds 0 bank lines. BEFORE applying to production, run the plan §4 step 0
-- duplicate check — a duplicate link would fail this migration.

-- CreateEnum
CREATE TYPE "BankCode" AS ENUM ('ICICI', 'HDFC', 'DHANLAXMI', 'OTHER');

-- CreateEnum
CREATE TYPE "SuspenseResolution" AS ENUM ('RECORDED', 'EXPLAINED', 'WRITTEN_OFF');

-- AlterTable
ALTER TABLE "BankStatement" ADD COLUMN     "bankAccountId" TEXT;

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "bankAccountId" TEXT,
ADD COLUMN     "fingerprint" TEXT;

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bank" "BankCode" NOT NULL,
    "accountLast4" TEXT,
    "storeId" TEXT,
    "zohoAccountId" TEXT,
    "reconcileFrom" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_suspense" (
    "id" TEXT NOT NULL,
    "bankTxnId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "assigneeId" TEXT,
    "assigneeName" TEXT,
    "parkedById" TEXT NOT NULL,
    "parkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" "SuspenseResolution",
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_suspense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_suspense_notes" (
    "id" TEXT NOT NULL,
    "suspenseId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_suspense_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_name_key" ON "bank_accounts"("name");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_zohoAccountId_key" ON "bank_accounts"("zohoAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_suspense_bankTxnId_key" ON "bank_suspense"("bankTxnId");

-- CreateIndex
CREATE INDEX "bank_suspense_resolvedAt_parkedAt_idx" ON "bank_suspense"("resolvedAt", "parkedAt");

-- CreateIndex
CREATE INDEX "bank_suspense_assigneeId_resolvedAt_idx" ON "bank_suspense"("assigneeId", "resolvedAt");

-- CreateIndex
CREATE INDEX "bank_suspense_notes_suspenseId_createdAt_idx" ON "bank_suspense_notes"("suspenseId", "createdAt");

-- CreateIndex
CREATE INDEX "BankStatement_bankAccountId_toDate_idx" ON "BankStatement"("bankAccountId", "toDate");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_confirmedPaymentId_key" ON "BankTransaction"("confirmedPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_confirmedExpenseId_key" ON "BankTransaction"("confirmedExpenseId");

-- CreateIndex
CREATE INDEX "BankTransaction_bankAccountId_date_idx" ON "BankTransaction"("bankAccountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_bankAccountId_fingerprint_key" ON "BankTransaction"("bankAccountId", "fingerprint");

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_suspense" ADD CONSTRAINT "bank_suspense_bankTxnId_fkey" FOREIGN KEY ("bankTxnId") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_suspense" ADD CONSTRAINT "bank_suspense_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_suspense" ADD CONSTRAINT "bank_suspense_parkedById_fkey" FOREIGN KEY ("parkedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_suspense" ADD CONSTRAINT "bank_suspense_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_suspense_notes" ADD CONSTRAINT "bank_suspense_notes_suspenseId_fkey" FOREIGN KEY ("suspenseId") REFERENCES "bank_suspense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_suspense_notes" ADD CONSTRAINT "bank_suspense_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── HAND-ADDED, data (plan §3 B1). Read before committing. ──
-- 1. AI suggestions stop living in matchStatus (C1). An unprocessed line was never decided by a
--    person, so its MATCHED / FLAGGED is a guess; flagReason and suggested* are kept.
UPDATE "BankTransaction" SET "matchStatus" = 'UNMATCHED'
 WHERE "processedAt" IS NULL AND "matchStatus" IN ('MATCHED', 'FLAGGED');
-- 2. A line flagged by a person before suspense existed gets its case, so "FLAGGED and processed
--    ⇔ an open suspense case" holds from the first day. Expected 0 rows — no screen ever called flag.
INSERT INTO "bank_suspense" ("id", "bankTxnId", "reason", "parkedById", "parkedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."id", COALESCE(t."flagReason", 'Flagged before suspense tracking existed'),
       s."uploadedById", t."processedAt", now(), now()
  FROM "BankTransaction" t JOIN "BankStatement" s ON s."id" = t."statementId"
 WHERE t."matchStatus" = 'FLAGGED' AND t."processedAt" IS NOT NULL;
