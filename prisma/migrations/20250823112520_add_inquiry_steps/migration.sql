-- CreateTable
CREATE TABLE "InquiryStep" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InquiryStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InquiryStep_inquiryId_idx" ON "InquiryStep"("inquiryId");

-- CreateIndex
CREATE UNIQUE INDEX "InquiryStep_inquiryId_index_key" ON "InquiryStep"("inquiryId", "index");

-- AddForeignKey
ALTER TABLE "InquiryStep" ADD CONSTRAINT "InquiryStep_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
