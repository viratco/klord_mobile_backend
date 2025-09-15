-- CreateTable
CREATE TABLE "LeadStep" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadStep_leadId_idx" ON "LeadStep"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadStep_leadId_order_key" ON "LeadStep"("leadId", "order");

-- AddForeignKey
ALTER TABLE "LeadStep" ADD CONSTRAINT "LeadStep_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
