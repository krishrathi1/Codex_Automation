-- CreateTable
CREATE TABLE "BoardConversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "threadId" TEXT,
    "title" TEXT NOT NULL,
    "goal" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "maxRounds" INTEGER NOT NULL DEFAULT 3,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "completedReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlackboardEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderAgentId" TEXT,
    "receiverAgentId" TEXT,
    "runJobId" TEXT,
    "taskId" TEXT,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlackboardEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentConversationCursor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "lastSeenEventAt" TIMESTAMP(3),
    "lastSeenEventId" TEXT,
    "turnsTaken" INTEGER NOT NULL DEFAULT 0,
    "lastQueuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConversationCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRuntimeSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "codexSessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "lockedUntil" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRuntimeSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoardConversation_organizationId_idx" ON "BoardConversation"("organizationId");
CREATE INDEX "BoardConversation_boardId_idx" ON "BoardConversation"("boardId");
CREATE INDEX "BoardConversation_threadId_idx" ON "BoardConversation"("threadId");
CREATE INDEX "BoardConversation_status_idx" ON "BoardConversation"("status");
CREATE INDEX "BoardConversation_updatedAt_idx" ON "BoardConversation"("updatedAt");

CREATE INDEX "BlackboardEvent_organizationId_idx" ON "BlackboardEvent"("organizationId");
CREATE INDEX "BlackboardEvent_boardId_idx" ON "BlackboardEvent"("boardId");
CREATE INDEX "BlackboardEvent_conversationId_idx" ON "BlackboardEvent"("conversationId");
CREATE INDEX "BlackboardEvent_senderAgentId_idx" ON "BlackboardEvent"("senderAgentId");
CREATE INDEX "BlackboardEvent_receiverAgentId_idx" ON "BlackboardEvent"("receiverAgentId");
CREATE INDEX "BlackboardEvent_runJobId_idx" ON "BlackboardEvent"("runJobId");
CREATE INDEX "BlackboardEvent_createdAt_idx" ON "BlackboardEvent"("createdAt");

CREATE UNIQUE INDEX "AgentConversationCursor_conversationId_agentId_key" ON "AgentConversationCursor"("conversationId", "agentId");
CREATE INDEX "AgentConversationCursor_organizationId_idx" ON "AgentConversationCursor"("organizationId");
CREATE INDEX "AgentConversationCursor_boardId_idx" ON "AgentConversationCursor"("boardId");
CREATE INDEX "AgentConversationCursor_agentId_idx" ON "AgentConversationCursor"("agentId");

CREATE UNIQUE INDEX "AgentRuntimeSession_boardId_agentId_key" ON "AgentRuntimeSession"("boardId", "agentId");
CREATE INDEX "AgentRuntimeSession_organizationId_idx" ON "AgentRuntimeSession"("organizationId");
CREATE INDEX "AgentRuntimeSession_boardId_idx" ON "AgentRuntimeSession"("boardId");
CREATE INDEX "AgentRuntimeSession_agentId_idx" ON "AgentRuntimeSession"("agentId");
CREATE INDEX "AgentRuntimeSession_status_idx" ON "AgentRuntimeSession"("status");

-- AddForeignKey
ALTER TABLE "BoardConversation" ADD CONSTRAINT "BoardConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoardConversation" ADD CONSTRAINT "BoardConversation_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoardConversation" ADD CONSTRAINT "BoardConversation_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BlackboardEvent" ADD CONSTRAINT "BlackboardEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlackboardEvent" ADD CONSTRAINT "BlackboardEvent_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlackboardEvent" ADD CONSTRAINT "BlackboardEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "BoardConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentConversationCursor" ADD CONSTRAINT "AgentConversationCursor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentConversationCursor" ADD CONSTRAINT "AgentConversationCursor_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentConversationCursor" ADD CONSTRAINT "AgentConversationCursor_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "BoardConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentRuntimeSession" ADD CONSTRAINT "AgentRuntimeSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentRuntimeSession" ADD CONSTRAINT "AgentRuntimeSession_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
