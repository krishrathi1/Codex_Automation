-- AlterEnum
ALTER TYPE "ProductionErrorStatus" ADD VALUE 'AWAITING_MANUAL';

-- AlterTable
ALTER TABLE "Board" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'AUTOMATIC';

-- AlterTable
ALTER TABLE "ProductionErrorEvent" ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'AUTOMATIC',
ADD COLUMN     "prBranch" TEXT,
ADD COLUMN     "prNumber" INTEGER,
ADD COLUMN     "prUrl" TEXT;
