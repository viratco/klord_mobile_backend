/*
  Warnings:

  - You are about to drop the column `brand` on the `Lead` table. All the data in the column will be lost.
  - You are about to drop the column `category` on the `Lead` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Lead" DROP COLUMN "brand",
DROP COLUMN "category";

-- DropEnum
DROP TYPE "BookingCategory";
