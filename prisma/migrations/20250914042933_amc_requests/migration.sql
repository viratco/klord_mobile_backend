-- CreateEnum
CREATE TYPE "AmcStatus" AS ENUM ('pending', 'in_progress', 'resolved', 'rejected');

-- CreateTable
CREATE TABLE "AmcRequest" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "AmcStatus" NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "AmcRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AmcRequest_leadId_idx" ON "AmcRequest"("leadId");

-- CreateIndex
CREATE INDEX "AmcRequest_customerId_idx" ON "AmcRequest"("customerId");

-- AddForeignKey
ALTER TABLE "AmcRequest" ADD CONSTRAINT "AmcRequest_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcRequest" ADD CONSTRAINT "AmcRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
