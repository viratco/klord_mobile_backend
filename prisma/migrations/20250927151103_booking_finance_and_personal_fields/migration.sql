-- CreateEnum
CREATE TYPE "BookingCategory" AS ENUM ('industrial', 'residential', 'commercial', 'ground');

-- CreateEnum
CREATE TYPE "PanelProvider" AS ENUM ('waare', 'tata', 'satvik', 'rayzon', 'navitas', 'pahal', 'vikram');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "annualGenPerKW" DOUBLE PRECISION,
ADD COLUMN     "billingCycleMonths" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "budgetINR" INTEGER,
ADD COLUMN     "category" "BookingCategory" NOT NULL DEFAULT 'residential',
ADD COLUMN     "email" TEXT,
ADD COLUMN     "gstAmount" INTEGER,
ADD COLUMN     "gstPct" DOUBLE PRECISION,
ADD COLUMN     "lifeYears" INTEGER,
ADD COLUMN     "moduleDegradationPct" DOUBLE PRECISION,
ADD COLUMN     "networkChargePerUnit" DOUBLE PRECISION,
ADD COLUMN     "omEscalationPct" DOUBLE PRECISION,
ADD COLUMN     "omPerKWYear" DOUBLE PRECISION,
ADD COLUMN     "provider" "PanelProvider",
ADD COLUMN     "ratePerKW" DOUBLE PRECISION,
ADD COLUMN     "tariffEscalationPct" DOUBLE PRECISION,
ADD COLUMN     "tariffINR" DOUBLE PRECISION,
ADD COLUMN     "totalInvestment" INTEGER;
