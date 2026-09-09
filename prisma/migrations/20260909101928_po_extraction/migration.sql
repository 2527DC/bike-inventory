-- CreateTable
CREATE TABLE "PoExtraction" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileUrl" TEXT,
    "source" TEXT NOT NULL,
    "aiModel" TEXT,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "matchedItems" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoExtractionItem" (
    "id" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "rawName" TEXT NOT NULL,
    "rawSku" TEXT,
    "rawCategory" TEXT,
    "rawSize" TEXT,
    "qty" INTEGER,
    "price" DECIMAL(12,2),
    "mrp" DECIMAL(12,2),
    "productId" TEXT,
    "matchStatus" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "matchConfidence" DOUBLE PRECISION,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "orderQty" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PoExtractionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PoExtraction_createdById_idx" ON "PoExtraction"("createdById");

-- CreateIndex
CREATE INDEX "PoExtraction_vendorId_idx" ON "PoExtraction"("vendorId");

-- CreateIndex
CREATE INDEX "PoExtractionItem_extractionId_idx" ON "PoExtractionItem"("extractionId");

-- CreateIndex
CREATE INDEX "PoExtractionItem_productId_idx" ON "PoExtractionItem"("productId");

-- AddForeignKey
ALTER TABLE "PoExtraction" ADD CONSTRAINT "PoExtraction_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoExtraction" ADD CONSTRAINT "PoExtraction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoExtractionItem" ADD CONSTRAINT "PoExtractionItem_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "PoExtraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoExtractionItem" ADD CONSTRAINT "PoExtractionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
