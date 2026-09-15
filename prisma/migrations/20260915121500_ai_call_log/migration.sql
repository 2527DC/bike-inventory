-- CreateTable
CREATE TABLE "ai_call_log" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "costInr" DECIMAL(10,4) NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "stopReason" TEXT,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "errorKind" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_call_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_call_log_purpose_createdAt_idx" ON "ai_call_log"("purpose", "createdAt");

-- CreateIndex
CREATE INDEX "ai_call_log_providerKey_createdAt_idx" ON "ai_call_log"("providerKey", "createdAt");

-- CreateIndex
CREATE INDEX "ai_call_log_createdAt_idx" ON "ai_call_log"("createdAt");
