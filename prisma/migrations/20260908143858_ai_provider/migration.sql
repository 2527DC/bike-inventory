-- CreateTable
CREATE TABLE "ai_provider" (
    "key" TEXT NOT NULL,
    "apiKey" TEXT,
    "model" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestError" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_pkey" PRIMARY KEY ("key")
);
