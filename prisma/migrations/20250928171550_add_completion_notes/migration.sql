-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "assigned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "assignedStaffId" TEXT;

-- AlterTable
ALTER TABLE "LeadStep" ADD COLUMN     "completionNotes" TEXT;

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "phone" TEXT;

-- CreateIndex
CREATE INDEX "Lead_assignedStaffId_idx" ON "Lead"("assignedStaffId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
