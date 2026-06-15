-- CreateEnum
CREATE TYPE "ProductionErrorStatus" AS ENUM ('RECEIVED', 'TASK_CREATED', 'DEBUG_QUEUED', 'REVIEW_QUEUED', 'APPROVED', 'REJECTED', 'COMMIT_QUEUED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "ProductionErrorEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "boardId" TEXT,
    "taskId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'website',
    "severity" TEXT NOT NULL DEFAULT 'error',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "url" TEXT,
    "route" TEXT,
    "userAgent" TEXT,
    "environment" TEXT,
    "fingerprint" TEXT NOT NULL,
    "payload" JSONB,
    "status" "ProductionErrorStatus" NOT NULL DEFAULT 'RECEIVED',
    "debugAgentId" TEXT,
    "reviewAgentId" TEXT,
    "commitAgentId" TEXT,
    "debugRunJobId" TEXT,
    "reviewRunJobId" TEXT,
    "commitRunJobId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionErrorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionErrorEvent_organizationId_idx" ON "ProductionErrorEvent"("organizationId");
CREATE INDEX "ProductionErrorEvent_boardId_idx" ON "ProductionErrorEvent"("boardId");
CREATE INDEX "ProductionErrorEvent_taskId_idx" ON "ProductionErrorEvent"("taskId");
CREATE INDEX "ProductionErrorEvent_status_idx" ON "ProductionErrorEvent"("status");
CREATE INDEX "ProductionErrorEvent_fingerprint_idx" ON "ProductionErrorEvent"("fingerprint");
CREATE INDEX "ProductionErrorEvent_createdAt_idx" ON "ProductionErrorEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "ProductionErrorEvent" ADD CONSTRAINT "ProductionErrorEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionErrorEvent" ADD CONSTRAINT "ProductionErrorEvent_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductionErrorEvent" ADD CONSTRAINT "ProductionErrorEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
