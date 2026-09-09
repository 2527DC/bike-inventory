-- CreateEnum
CREATE TYPE "LedgerUploadKind" AS ENUM ('STATEMENT', 'CHAT', 'SCREENSHOT', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "LedgerAiTask" AS ENUM ('STATEMENT_ROWS', 'CLAIMS_FROM_CHAT', 'CLAIMS_FROM_IMAGE');

-- CreateEnum
CREATE TYPE "LedgerAiRunStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED', 'ACCEPTED', 'DISCARDED');

-- AlterEnum
ALTER TYPE "LedgerEntryType" ADD VALUE 'NOTE';

-- AlterTable
ALTER TABLE "ledger_gap_evidence" ADD COLUMN     "capturedLabel" TEXT;

-- AlterTable
ALTER TABLE "modules" ADD COLUMN     "assignable" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "vendor_ledger_profiles" (
    "vendorId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sub" TEXT,
    "position" TEXT,
    "notes" TEXT,
    "theirBalAmount" DOUBLE PRECISION,
    "theirBalLabel" TEXT,
    "ourBalAmount" DOUBLE PRECISION,
    "ourBalLabel" TEXT,
    "recovAmount" DOUBLE PRECISION,
    "recovText" TEXT,
    "deadlineLabel" TEXT,
    "deadlineDate" TIMESTAMP(3),
    "ledgerOpeningAmount" DOUBLE PRECISION,
    "ledgerOpeningDate" TIMESTAMP(3),
    "ledgerCoverage" TEXT,
    "ledgerMatchable" BOOLEAN NOT NULL DEFAULT false,
    "ledgerNote" TEXT,
    "updatedOn" TIMESTAMP(3),
    "lastReviewed" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_ledger_profiles_pkey" PRIMARY KEY ("vendorId")
);

-- CreateTable
CREATE TABLE "ledger_uploads" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "kind" "LedgerUploadKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "fileUrl" TEXT,
    "deletedAt" TIMESTAMP(3),
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_ai_runs" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "task" "LedgerAiTask" NOT NULL,
    "userPrompt" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "usageIn" INTEGER,
    "usageOut" INTEGER,
    "latencyMs" INTEGER,
    "chunks" INTEGER NOT NULL DEFAULT 1,
    "reply" JSONB,
    "proposals" JSONB,
    "status" "LedgerAiRunStatus" NOT NULL DEFAULT 'RUNNING',
    "error" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "statementId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ledger_uploads_vendorId_createdAt_idx" ON "ledger_uploads"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_ai_runs_vendorId_createdAt_idx" ON "ledger_ai_runs"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_ai_runs_uploadId_idx" ON "ledger_ai_runs"("uploadId");

-- AddForeignKey
ALTER TABLE "vendor_ledger_profiles" ADD CONSTRAINT "vendor_ledger_profiles_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_uploads" ADD CONSTRAINT "ledger_uploads_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_uploads" ADD CONSTRAINT "ledger_uploads_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_ai_runs" ADD CONSTRAINT "ledger_ai_runs_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "ledger_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_ai_runs" ADD CONSTRAINT "ledger_ai_runs_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_ai_runs" ADD CONSTRAINT "ledger_ai_runs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
