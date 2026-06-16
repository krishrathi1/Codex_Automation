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
    const orgMother = graph.nodes.find(node => node.kind === 'mother_chat' && node.id.startsWith('virtual:mother:'));
    const adminToMother = graph.edges.find(edge => edge.source === admin.id && edge.target === orgMother?.id && edge.kind === 'admin_mother');
    const motherToAdmin = graph.edges.find(edge => edge.source === orgMother?.id && edge.target === admin.id && edge.kind === 'admin_mother');
    const adminToWorker = graph.edges.find(edge => edge.source === admin.id && edge.target === worker.id && edge.kind === 'admin_agent');
    const workerToAdmin = graph.edges.find(edge => edge.source === worker.id && edge.target === admin.id && edge.kind === 'admin_agent');
    const motherObservation = graph.edges.find(edge => edge.source === orgMother?.id && edge.target === worker.id && edge.kind === 'mother_observation');
    const workerSelfLoop = graph.edges.find(edge => edge.source === worker.id && edge.target === worker.id);

    expect(mother).toBeDefined();
    expect(orgMother).toBeDefined();
    expect(graph.nodes.map(node => node.id)).toEqual(expect.arrayContaining([admin.id, worker.id, orgMother!.id]));
    expect(adminToMother).toBeDefined();
    expect(adminToMother?.messageCount).toBe(3);
    expect(adminToMother?.codexSessionIds).toEqual(expect.arrayContaining([
      '0199a213-81c0-7800-8aa1-bbab2a035a53',
      '0199a213-81c0-7800-8aa1-bbab2a035a54',
    ]));
    expect(adminToMother?.sessionIds).toContain(activeSession.id);
    expect(motherToAdmin).toBeUndefined();
    expect(adminToWorker).toBeUndefined();
    expect(workerToAdmin).toBeUndefined();
    expect(motherObservation?.observationLinks.map(link => link.id)).toEqual(expect.arrayContaining([worker.id, activeSession.id, task.id]));
    expect(workerSelfLoop).toBeUndefined();
  });

  it('creates isolated Mother Chat graph scopes per production board', async () => {
    const admin = await getOrCreateAdminAgent(orgId);
    const alphaBoard = await prisma.board.create({
      data: {
        organizationId: orgId,
        name: 'Graph Alpha Board',
        slug: `graph-alpha-${Date.now()}`,
        description: 'Alpha graph room',
      },
    });
    const betaBoard = await prisma.board.create({
      data: {
        organizationId: orgId,
        name: 'Graph Beta Board',
        slug: `graph-beta-${Date.now()}`,
        description: 'Beta graph room',
      },
    });
    const alphaAgent = await prisma.agent.create({
      data: {
        organizationId: orgId,
        name: 'graph-alpha-agent',
        displayName: 'Graph Duplicate Agent',
        description: 'Alpha scoped worker',
        boardId: alphaBoard.id,
      },
    });
    const betaAgent = await prisma.agent.create({
      data: {
        organizationId: orgId,
        name: 'graph-beta-agent',
        displayName: 'Graph Duplicate Agent',
        description: 'Beta scoped worker',
        boardId: betaBoard.id,
      },
    });
    await prisma.agent.upsert({
      where: { organizationId_name: { organizationId: orgId, name: '__mother_chat__' } },
      create: {
        organizationId: orgId,
        name: '__mother_chat__',
        displayName: 'Mother Chat',
        description: 'Graph observer',
        enabled: false,
        status: 'IDLE',
        identityProfile: {
          systemRole: 'mother-chat',
          codexCliSessionIdsByBoard: {
            [alphaBoard.id]: 'alpha-codex-session',
            [betaBoard.id]: 'beta-codex-session',
          },
        },
      },
      update: {
        identityProfile: {
          systemRole: 'mother-chat',
          codexCliSessionIdsByBoard: {
            [alphaBoard.id]: 'alpha-codex-session',
            [betaBoard.id]: 'beta-codex-session',
          },
        },
      },
    });
    const thread = await prisma.thread.create({
      data: { organizationId: orgId, title: 'Scoped graph thread' },
    });

    await prisma.message.createMany({
      data: [
        {
          threadId: thread.id,
          senderId: admin.id,
          receiverId: alphaAgent.id,
          content: 'Alpha only.',
          metadata: { conversationKind: 'admin_agent', edgeSemantic: 'admin_to_agent', boardId: alphaBoard.id },
        },
        {
          threadId: thread.id,
          senderId: admin.id,
          receiverId: betaAgent.id,
          content: 'Beta only.',
          metadata: { conversationKind: 'admin_agent', edgeSemantic: 'admin_to_agent', boardId: betaBoard.id },
        },
        {
          threadId: thread.id,
          senderId: alphaAgent.id,
          receiverId: betaAgent.id,
          content: 'This cross-board message must not become a graph edge.',
          metadata: { conversationKind: 'agent_agent', edgeSemantic: 'agent_to_agent', boardId: alphaBoard.id },
        },
      ],
    });

    const graph = await getCommGraph(orgId);
    const alphaMother = graph.nodes.find(node => node.kind === 'mother_chat' && node.boardId === alphaBoard.id);
    const betaMother = graph.nodes.find(node => node.kind === 'mother_chat' && node.boardId === betaBoard.id);

    expect(alphaMother).toBeDefined();
    expect(betaMother).toBeDefined();
    expect(graph.nodes.find(node => node.id === alphaAgent.id)?.displayName).toBe(`Graph Duplicate Agent · ${alphaBoard.name}`);
    expect(graph.nodes.find(node => node.id === betaAgent.id)?.displayName).toBe(`Graph Duplicate Agent · ${betaBoard.name}`);
    const alphaMotherId = alphaMother!.id;
    const betaMotherId = betaMother!.id;
    expect(alphaMother?.codexSessionId).toBe('alpha-codex-session');
    expect(betaMother?.codexSessionId).toBe('beta-codex-session');
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: admin.id, target: alphaMotherId, kind: 'admin_mother', boardId: alphaBoard.id }),
      expect.objectContaining({ source: admin.id, target: betaMotherId, kind: 'admin_mother', boardId: betaBoard.id }),
      expect.objectContaining({ source: alphaMotherId, target: alphaAgent.id, kind: 'mother_observation', boardId: alphaBoard.id }),
      expect.objectContaining({ source: betaMotherId, target: betaAgent.id, kind: 'mother_observation', boardId: betaBoard.id }),
    ]));
    expect(graph.edges.some(edge => edge.source === alphaAgent.id && edge.target === betaAgent.id)).toBe(false);

    const alphaGraph = await getCommGraph(orgId, { boardId: alphaBoard.id });
    expect(alphaGraph.nodes.map(node => node.id)).toEqual(expect.arrayContaining([admin.id, alphaMotherId, alphaAgent.id]));
    expect(alphaGraph.nodes.map(node => node.id)).not.toContain(betaAgent.id);
    expect(alphaGraph.edges.every(edge => edge.boardId === alphaBoard.id || edge.boardId === null)).toBe(true);
  });
});
