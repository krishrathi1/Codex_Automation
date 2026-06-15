-- CreateEnum
CREATE TYPE "AgentRunJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "AgentRunJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "boardId" TEXT,
    "agentId" TEXT NOT NULL,
    "taskId" TEXT,
    "threadId" TEXT,
    "status" "AgentRunJobStatus" NOT NULL DEFAULT 'QUEUED',
    "prompt" TEXT NOT NULL,
    "contextPacket" JSONB,
    "output" TEXT,
    "summary" TEXT,
    "error" TEXT,
    "codexSessionId" TEXT,
    "staleCodexSessionId" TEXT,
    "nexusSessionId" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRunJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRunJob_organizationId_idx" ON "AgentRunJob"("organizationId");

-- CreateIndex
CREATE INDEX "AgentRunJob_boardId_idx" ON "AgentRunJob"("boardId");

-- CreateIndex
CREATE INDEX "AgentRunJob_agentId_idx" ON "AgentRunJob"("agentId");

-- CreateIndex
CREATE INDEX "AgentRunJob_taskId_idx" ON "AgentRunJob"("taskId");

-- CreateIndex
CREATE INDEX "AgentRunJob_threadId_idx" ON "AgentRunJob"("threadId");

-- CreateIndex
CREATE INDEX "AgentRunJob_status_idx" ON "AgentRunJob"("status");

-- CreateIndex
CREATE INDEX "AgentRunJob_queuedAt_idx" ON "AgentRunJob"("queuedAt");

-- AddForeignKey
ALTER TABLE "AgentRunJob" ADD CONSTRAINT "AgentRunJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunJob" ADD CONSTRAINT "AgentRunJob_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunJob" ADD CONSTRAINT "AgentRunJob_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunJob" ADD CONSTRAINT "AgentRunJob_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunJob" ADD CONSTRAINT "AgentRunJob_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
