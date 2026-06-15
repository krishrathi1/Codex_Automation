import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { cleanupTestData, createTestUser } from './setup.js';
import { getCommGraph } from '../services/thread.service.js';
import { getOrCreateAdminAgent } from '../services/system-agent.service.js';

describe('thread graph service', () => {
  let orgId: string;

  beforeAll(async () => {
    const setup = await createTestUser('thread-graph');
    orgId = setup.organization.id;
  });

  afterAll(async () => {
    await cleanupTestData(orgId);
  });

  it('builds directional admin, agent, and Mother Chat observation edges with runtime links', async () => {
    const admin = await getOrCreateAdminAgent(orgId);
    const worker = await prisma.agent.create({
      data: {
        organizationId: orgId,
        name: 'graph-worker',
        displayName: 'Graph Worker',
        description: 'Worker used by graph tests',
        status: 'IDLE',
        identityProfile: { codexCliSessionId: '0199a213-81c0-7800-8aa1-bbab2a035a53' },
      },
    });
    const mother = await prisma.agent.create({
      data: {
        organizationId: orgId,
        name: '__mother_chat__',
        displayName: 'Mother Chat',
        description: 'Graph observer',
        enabled: false,
        status: 'IDLE',
        identityProfile: { systemRole: 'mother-chat' },
      },
    });
    const thread = await prisma.thread.create({
      data: { organizationId: orgId, title: 'Graph thread' },
    });
    const activeSession = await prisma.session.create({
      data: {
        organizationId: orgId,
        agentId: worker.id,
        type: 'MESSAGE',
        status: 'RUNNING',
        summary: 'Graph active run',
      },
    });
    const task = await prisma.task.create({
      data: {
        organizationId: orgId,
        agentId: worker.id,
        title: 'Graph task',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
      },
    });

    await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: admin.id,
        receiverId: worker.id,
        content: 'Please do graph work.',
        metadata: {
          role: 'user',
          conversationKind: 'admin_agent',
          edgeSemantic: 'admin_to_agent',
          nexusSessionId: activeSession.id,
          codexSessionId: '0199a213-81c0-7800-8aa1-bbab2a035a53',
        },
      },
    });
    await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: worker.id,
        receiverId: admin.id,
        content: 'Graph work is underway.',
        metadata: {
          role: 'assistant',
          conversationKind: 'admin_agent',
          edgeSemantic: 'agent_to_admin',
          nexusSessionId: activeSession.id,
          codexSessionId: '0199a213-81c0-7800-8aa1-bbab2a035a53',
        },
      },
    });
    await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: worker.id,
        receiverId: worker.id,
        content: 'Legacy user prompt stored as a self-loop.',
        metadata: {
          role: 'user',
          runtime: 'codex-cli',
          codexSessionId: '0199a213-81c0-7800-8aa1-bbab2a035a54',
        },
      },
    });

    const graph = await getCommGraph(orgId);
    const adminToWorker = graph.edges.find(edge => edge.source === admin.id && edge.target === worker.id && edge.kind === 'admin_agent');
    const workerToAdmin = graph.edges.find(edge => edge.source === worker.id && edge.target === admin.id && edge.kind === 'admin_agent');
    const motherObservation = graph.edges.find(edge => edge.source === mother.id && edge.target === worker.id && edge.kind === 'mother_observation');
    const workerSelfLoop = graph.edges.find(edge => edge.source === worker.id && edge.target === worker.id);

    expect(graph.nodes.map(node => node.id)).toEqual(expect.arrayContaining([admin.id, worker.id, mother.id]));
    expect(adminToWorker).toBeDefined();
    expect(adminToWorker?.messageCount).toBe(2);
    expect(adminToWorker?.codexSessionIds).toEqual(expect.arrayContaining([
      '0199a213-81c0-7800-8aa1-bbab2a035a53',
      '0199a213-81c0-7800-8aa1-bbab2a035a54',
    ]));
    expect(adminToWorker?.sessionIds).toContain(activeSession.id);
    expect(adminToWorker?.activeRunIds).toContain(activeSession.id);
    expect(adminToWorker?.taskIds).toContain(task.id);
    expect(workerToAdmin).toBeDefined();
    expect(motherObservation?.observationLinks.map(link => link.id)).toEqual(expect.arrayContaining([worker.id, activeSession.id, task.id]));
    expect(workerSelfLoop).toBeUndefined();
  });
});
