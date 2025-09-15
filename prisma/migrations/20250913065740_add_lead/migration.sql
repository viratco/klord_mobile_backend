/*
  Warnings:

  - You are about to drop the `AmcRequest` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Inquiry` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `InquiryStep` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AmcRequest" DROP CONSTRAINT "AmcRequest_customerId_fkey";

-- DropForeignKey
ALTER TABLE "AmcRequest" DROP CONSTRAINT "AmcRequest_inquiryId_fkey";

-- DropForeignKey
ALTER TABLE "Inquiry" DROP CONSTRAINT "Inquiry_customerId_fkey";

-- DropForeignKey
ALTER TABLE "InquiryStep" DROP CONSTRAINT "InquiryStep_inquiryId_fkey";

-- DropTable
DROP TABLE "AmcRequest";

-- DropTable
DROP TABLE "Inquiry";

-- DropTable
DROP TABLE "InquiryStep";

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "projectType" TEXT NOT NULL,
    "sizedKW" DOUBLE PRECISION NOT NULL,
    "monthlyBill" INTEGER NOT NULL,
    "pincode" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "withSubsidy" BOOLEAN NOT NULL DEFAULT true,
    "estimateINR" INTEGER NOT NULL,
    "wp" INTEGER,
    "plates" INTEGER,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_customerId_idx" ON "Lead"("customerId");

-- CreateIndex
CREATE INDEX "Lead_pincode_idx" ON "Lead"("pincode");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
