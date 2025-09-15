-- CreateTable
CREATE TABLE "AmcRequest" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmcRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AmcRequest_inquiryId_idx" ON "AmcRequest"("inquiryId");

-- CreateIndex
CREATE INDEX "AmcRequest_customerId_idx" ON "AmcRequest"("customerId");

-- AddForeignKey
ALTER TABLE "AmcRequest" ADD CONSTRAINT "AmcRequest_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcRequest" ADD CONSTRAINT "AmcRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
