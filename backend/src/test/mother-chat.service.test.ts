import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { cleanupTestData, createTestUser } from './setup.js';
import { buildMotherChatContext, MOTHER_CHAT_AGENT_NAME } from '../services/mother-chat.service.js';
import { getThreadCodexSessionId } from '../services/codex-cli.service.js';

describe('mother-chat service', () => {
  let orgId: string;

  beforeAll(async () => {
    const setup = await createTestUser('mother-chat');
    orgId = setup.organization.id;
  });

  afterAll(async () => {
    await cleanupTestData(orgId);
  });

  it('builds an operations context and excludes the hidden Mother Chat agent', async () => {
    const agent = await prisma.agent.create({
      data: {
        organizationId: orgId,
        name: 'worker-agent',
        displayName: 'Worker Agent',
        description: 'Handles work',
        status: 'ONLINE',
        currentTask: 'Review active tasks',
        identityProfile: { codexCliSessionId: '0199a213-81c0-7800-8aa1-bbab2a035a53' },
      },
    });

    await prisma.agent.create({
      data: {
        organizationId: orgId,
        name: MOTHER_CHAT_AGENT_NAME,
        displayName: 'Mother Chat',
        description: 'Hidden system agent',
        enabled: false,
        identityProfile: { systemRole: 'mother-chat' },
      },
    });

    const thread = await prisma.thread.create({
      data: { organizationId: orgId, title: 'Worker thread' },
    });

    await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: agent.id,
        receiverId: agent.id,
        content: 'I am working on task triage.',
      },
    });

    await prisma.session.create({
      data: {
        organizationId: orgId,
        agentId: agent.id,
        type: 'MESSAGE',
        status: 'RUNNING',
        summary: 'Active Codex run',
        tokensUsed: 42,
      },
    });

    await prisma.task.create({
      data: {
        organizationId: orgId,
        agentId: agent.id,
        title: 'Triage current board',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
      },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        agentId: agent.id,
        type: 'ERROR',
        message: 'Tool command failed',
      },
    });

    await prisma.tokenUsage.create({
      data: {
        organizationId: orgId,
        agentId: agent.id,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        model: 'codex-cli',
        cost: 0,
      },
    });

    const { context, contextText } = await buildMotherChatContext(orgId);

    expect(context.counts.agents).toBe(1);
    expect(context.agents.map(item => item.name)).toEqual(['worker-agent']);
    expect(context.counts.runningSessions).toBe(1);
    expect(context.counts.activeTasks).toBe(1);
    expect(context.counts.recentErrors).toBe(1);
    expect(context.counts.tokensInWindow).toBe(15);
    expect(contextText).toContain('Worker Agent');
    expect(contextText).not.toContain(MOTHER_CHAT_AGENT_NAME);
  });

  it('recovers the latest Codex session id from a persisted chat thread', async () => {
    const agent = await prisma.agent.create({
      data: {
        organizationId: orgId,
        name: 'session-recovery-agent',
        displayName: 'Session Recovery Agent',
        description: 'Tests chat session recovery',
        status: 'IDLE',
      },
    });
    const thread = await prisma.thread.create({
      data: { organizationId: orgId, title: 'Session recovery thread' },
    });

    await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: agent.id,
        receiverId: agent.id,
        content: 'Older reply',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        metadata: {
          role: 'assistant',
          codexSessionId: '0199a213-81c0-7800-8aa1-bbab2a035a53',
        },
      },
    });
    await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: agent.id,
        receiverId: agent.id,
        content: 'Newest reply',
        createdAt: new Date('2026-01-01T00:01:00.000Z'),
        metadata: {
          role: 'assistant',
          codexSessionId: '0199a213-81c0-7800-8aa1-bbab2a035a54',
        },
      },
    });
    await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: agent.id,
        receiverId: agent.id,
        content: 'User message attempted a stale resume',
        createdAt: new Date('2026-01-01T00:02:00.000Z'),
        metadata: {
          role: 'user',
          resumeCodexSessionId: '019ebb77-b1c9-71c0-b32c-81deb69477c2',
          codexSessionId: '019ebb77-b1c9-71c0-b32c-81deb69477c2',
        },
      },
    });

    await expect(getThreadCodexSessionId(thread.id, orgId)).resolves.toBe('0199a213-81c0-7800-8aa1-bbab2a035a54');
    await expect(getThreadCodexSessionId(thread.id, 'wrong-org')).resolves.toBeUndefined();
  });
});
