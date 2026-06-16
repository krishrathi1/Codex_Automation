import { prisma } from '../lib/prisma.js';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { logger } from '../lib/logger.js';
import { ADMIN_AGENT_NAME } from './system-agent.service.js';
const tracer = trace.getTracer('nexus-thread');
const MOTHER_CHAT_AGENT_NAME = '__mother_chat__';
const VIRTUAL_ADMIN_NODE_ID = 'virtual:admin';
const VIRTUAL_MOTHER_NODE_PREFIX = 'virtual:mother:';
const ORG_MOTHER_SCOPE = 'organization';

const agentSelectFields = {
  id: true,
  name: true,
  displayName: true,
  avatar: true,
  status: true,
} as const;
const graphAgentSelectFields = {
  ...agentSelectFields,
  currentTask: true,
  identityProfile: true,
  enabled: true,
  boardId: true,
  gatewayAgentId: true,
  updatedAt: true,
} as const;

type JsonRecord = Record<string, unknown>;
type GraphEdgeKind = 'admin_agent' | 'admin_mother' | 'agent_agent' | 'mother_observation' | 'system';

interface GraphEdgeDetail {
  id: string;
  role?: string;
  content: string;
  createdAt: string;
  threadId: string;
  codexSessionId?: string;
  nexusSessionId?: string;
  requestId?: string;
}

interface GraphObservationLink {
  type: 'task' | 'session' | 'context' | 'run_job';
  id: string;
  label: string;
  status?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  kind: GraphEdgeKind;
  label: string;
  messageCount: number;
  lastMessage: string;
  boardId?: string | null;
  boardName?: string | null;
  threadIds: string[];
  codexSessionIds: string[];
  sessionIds: string[];
  activeRunIds: string[];
  queuedRunIds: string[];
  failedRunIds: string[];
  taskIds: string[];
  recentMessages: GraphEdgeDetail[];
  observationLinks: GraphObservationLink[];
}

function objectRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function pushUnique(target: string[], value: string | undefined) {
  if (value && !target.includes(value)) target.push(value);
}

function roleFromAgentName(name: string) {
  if (name === ADMIN_AGENT_NAME) return 'admin';
  if (name === MOTHER_CHAT_AGENT_NAME) return 'mother_chat';
  return 'agent';
}

function virtualMotherNodeId(boardId?: string | null) {
  return `${VIRTUAL_MOTHER_NODE_PREFIX}${boardId || ORG_MOTHER_SCOPE}`;
}

function edgeLabel(kind: GraphEdgeKind) {
  if (kind === 'admin_agent') return 'Admin chat';
  if (kind === 'admin_mother') return 'Mother Chat';
  if (kind === 'agent_agent') return 'Agent to agent';
  if (kind === 'mother_observation') return 'Mother observation';
  return 'System';
}

function codexSessionIdFromMetadata(metadata: JsonRecord) {
  return stringValue(metadata.codexSessionId)
    || stringValue(metadata.codexCliSessionId)
    || stringValue(metadata.activeWorkflowSessionId)
    || stringValue(metadata.resumeCodexSessionId);
}

function semanticKind(metadata: JsonRecord, sourceName: string, targetName: string): GraphEdgeKind {
  const semantic = stringValue(metadata.edgeSemantic);
  const conversationKind = stringValue(metadata.conversationKind);
  if (semantic?.includes('mother') || conversationKind === 'admin_mother') return 'admin_mother';
  if (semantic?.includes('admin') || conversationKind === 'admin_agent') return 'admin_agent';
  if (sourceName === MOTHER_CHAT_AGENT_NAME || targetName === MOTHER_CHAT_AGENT_NAME) return 'admin_mother';
  if (sourceName === ADMIN_AGENT_NAME || targetName === ADMIN_AGENT_NAME) return 'admin_agent';
  if (sourceName !== targetName) return 'agent_agent';
  return 'system';
}

function getOrCreateEdge(
  edgeMap: Map<string, GraphEdge>,
  source: string,
  target: string,
  kind: GraphEdgeKind,
  fallbackDate: Date,
  scope?: { boardId?: string | null; boardName?: string | null },
) {
  const key = `${source}->${target}::${kind}::${scope?.boardId ?? ORG_MOTHER_SCOPE}`;
  const existing = edgeMap.get(key);
  if (existing) return existing;

  const edge: GraphEdge = {
    source,
    target,
    kind,
    label: edgeLabel(kind),
    messageCount: 0,
    lastMessage: fallbackDate.toISOString(),
    boardId: scope?.boardId ?? null,
    boardName: scope?.boardName ?? null,
    threadIds: [],
    codexSessionIds: [],
    sessionIds: [],
    activeRunIds: [],
    queuedRunIds: [],
    failedRunIds: [],
    taskIds: [],
    recentMessages: [],
    observationLinks: [],
  };
  edgeMap.set(key, edge);
  return edge;
}

export async function getAllThreads(organizationId: string) {
  return prisma.thread.findMany({
    where: { organizationId },
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        include: {
          sender: { select: agentSelectFields },
          receiver: { select: agentSelectFields },
        },
      },
    },
  });
}

export async function getThreadById(id: string, organizationId: string) {
  return prisma.thread.findFirst({
    where: { id, organizationId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        include: {
          sender: { select: agentSelectFields },
          receiver: { select: agentSelectFields },
        },
      },
    },
  });
}

export async function getCommGraph(organizationId: string, options: { boardId?: string } = {}) {
  const boardScope = options.boardId
    ? await prisma.board.findFirst({
        where: { id: options.boardId, organizationId },
        select: { id: true, name: true, slug: true, updatedAt: true },
      })
    : null;
  if (options.boardId && !boardScope) {
    return { nodes: [], edges: [] };
  }

  const [
    agents,
    boards,
    messages,
    runningSessions,
    openTasks,
    agentRunJobs,
  ] = await Promise.all([
    prisma.agent.findMany({
      where: options.boardId
        ? {
            organizationId,
            OR: [
              { boardId: options.boardId },
              { name: { in: [ADMIN_AGENT_NAME, MOTHER_CHAT_AGENT_NAME] } },
            ],
          }
        : { organizationId },
      orderBy: { name: 'asc' },
      select: graphAgentSelectFields,
    }),
    prisma.board.findMany({
      where: options.boardId ? { id: options.boardId, organizationId } : { organizationId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, updatedAt: true },
    }),
    prisma.message.findMany({
      where: { thread: { organizationId } },
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: {
        id: true,
        threadId: true,
        senderId: true,
        receiverId: true,
        content: true,
        metadata: true,
        createdAt: true,
        sender: { select: { id: true, name: true, displayName: true, boardId: true } },
        receiver: { select: { id: true, name: true, displayName: true, boardId: true } },
      },
    }),
    prisma.session.findMany({
      where: { organizationId, status: 'RUNNING' },
      orderBy: { startedAt: 'desc' },
      select: { id: true, agentId: true, type: true, status: true, summary: true, startedAt: true },
    }),
    prisma.task.findMany({
      where: {
        organizationId,
        status: { not: 'DONE' },
        ...(options.boardId && { boardId: options.boardId }),
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, agentId: true, boardId: true, title: true, status: true, priority: true },
    }),
    prisma.agentRunJob.findMany({
      where: {
        organizationId,
        status: { not: 'CANCELLED' },
        ...(options.boardId && { boardId: options.boardId }),
      },
      orderBy: { queuedAt: 'asc' },
      take: 500,
      select: {
        id: true,
        status: true,
        agentId: true,
        boardId: true,
        taskId: true,
        threadId: true,
        codexSessionId: true,
        summary: true,
        error: true,
      },
    }),
  ]);

  const agentById = new Map(agents.map(agent => [agent.id, agent]));
  const adminAgent = agents.find(agent => agent.name === ADMIN_AGENT_NAME);
  const motherAgent = agents.find(agent => agent.name === MOTHER_CHAT_AGENT_NAME);
  const boardsById = new Map(boards.map(board => [board.id, board]));
  const allowedBoardIds = new Set(boards.map(board => board.id));
  const graphBoardIds = new Set<string>();
  const hasUngroupedScope = { value: false };
  const hasUngroupedAgents = agents.some(agent => (
    agent.name !== ADMIN_AGENT_NAME &&
    agent.name !== MOTHER_CHAT_AGENT_NAME &&
    !agent.boardId
  ));
  const hasLegacyAdminMessages = messages.some(message => {
    const metadata = objectRecord(message.metadata);
    return message.senderId === message.receiverId && Boolean(stringValue(metadata.role));
  });
  const needsAdminNode = Boolean(adminAgent) || hasLegacyAdminMessages || boards.length > 0;
  const adminNodeId = adminAgent?.id ?? VIRTUAL_ADMIN_NODE_ID;
  const taskIdsByAgent = new Map<string, string[]>();
  const activeRunIdsByAgent = new Map<string, string[]>();
  const queuedRunIdsByAgent = new Map<string, string[]>();
  const failedRunIdsByAgent = new Map<string, string[]>();
  const completedRunJobsByAgent = new Map<string, Array<{
    id: string;
    status: string;
    taskId: string | null;
    threadId: string | null;
    summary: string | null;
    error: string | null;
    codexSessionId: string | null;
  }>>();

  function boardInfo(boardId?: string | null) {
    if (!boardId) return { boardId: null, boardName: 'Organization' };
    const board = boardsById.get(boardId);
    return { boardId, boardName: board?.name ?? 'Unknown group' };
  }

  function rememberScope(boardId?: string | null) {
    if (boardId) graphBoardIds.add(boardId);
    else hasUngroupedScope.value = true;
  }

  function messageBoardId(message: typeof messages[number], metadata: JsonRecord) {
    const metadataBoardId = stringValue(metadata.boardId);
    if (metadataBoardId && allowedBoardIds.has(metadataBoardId)) return metadataBoardId;

    const senderBoardId = message.sender.boardId;
    const receiverBoardId = message.receiver.boardId;
    if (senderBoardId && receiverBoardId && senderBoardId === receiverBoardId && allowedBoardIds.has(senderBoardId)) {
      return senderBoardId;
    }
    if (senderBoardId && [ADMIN_AGENT_NAME, MOTHER_CHAT_AGENT_NAME].includes(message.receiver.name) && allowedBoardIds.has(senderBoardId)) {
      return senderBoardId;
    }
    if (receiverBoardId && [ADMIN_AGENT_NAME, MOTHER_CHAT_AGENT_NAME].includes(message.sender.name) && allowedBoardIds.has(receiverBoardId)) {
      return receiverBoardId;
    }
    return undefined;
  }

  function endpointNodeId(agentName: string, agentId: string, boardId?: string | null) {
    if (agentName === MOTHER_CHAT_AGENT_NAME) return virtualMotherNodeId(boardId);
    if (agentName === ADMIN_AGENT_NAME) return adminNodeId;
    return agentId;
  }

  function endpointBelongsToScope(agentName: string, endpointBoardId: string | null, boardId?: string | null) {
    if ([ADMIN_AGENT_NAME, MOTHER_CHAT_AGENT_NAME].includes(agentName)) return true;
    return boardId ? endpointBoardId === boardId : !endpointBoardId;
  }

  for (const task of openTasks) {
    if (!task.agentId) continue;
    if (!agentById.has(task.agentId)) continue;
    rememberScope(task.boardId);
    const ids = taskIdsByAgent.get(task.agentId) ?? [];
    ids.push(task.id);
    taskIdsByAgent.set(task.agentId, ids);
  }
  for (const job of agentRunJobs) {
    if (!job.agentId) continue;
    if (!agentById.has(job.agentId)) continue;
    rememberScope(job.boardId);
    if (job.status === 'RUNNING') {
      const ids = activeRunIdsByAgent.get(job.agentId) ?? [];
      ids.push(job.id);
      activeRunIdsByAgent.set(job.agentId, ids);
      continue;
    }
    if (job.status === 'QUEUED') {
      const ids = queuedRunIdsByAgent.get(job.agentId) ?? [];
      ids.push(job.id);
      queuedRunIdsByAgent.set(job.agentId, ids);
      continue;
    }
    if (job.status === 'FAILED') {
      const ids = failedRunIdsByAgent.get(job.agentId) ?? [];
      ids.push(job.id);
      failedRunIdsByAgent.set(job.agentId, ids);
      continue;
    }
    if (job.status === 'COMPLETED') {
      const list = completedRunJobsByAgent.get(job.agentId) ?? [];
      if (list.length < 3) {
        list.push({
          id: job.id,
          status: job.status,
          taskId: job.taskId,
          threadId: job.threadId,
          summary: job.summary,
          error: job.error,
          codexSessionId: job.codexSessionId,
        });
        completedRunJobsByAgent.set(job.agentId, list);
      }
    }
  }
  for (const session of runningSessions) {
    if (!agentById.has(session.agentId)) continue;
    const sessionAgent = agentById.get(session.agentId);
    if (options.boardId && sessionAgent?.boardId !== options.boardId) continue;
    rememberScope(sessionAgent?.boardId);
    const ids = activeRunIdsByAgent.get(session.agentId) ?? [];
    ids.push(session.id);
    activeRunIdsByAgent.set(session.agentId, ids);
  }

  const nodes = agents
    .filter(agent => agent.name !== MOTHER_CHAT_AGENT_NAME)
    .map(agent => {
    const profile = objectRecord(agent.identityProfile);
    if (agent.name !== ADMIN_AGENT_NAME) rememberScope(agent.boardId);
    return {
      id: agent.id,
      name: agent.name,
      displayName: agent.displayName,
      avatar: agent.avatar,
      status: agent.status,
      kind: roleFromAgentName(agent.name),
      boardId: agent.boardId,
      boardName: agent.boardId ? boardsById.get(agent.boardId)?.name ?? null : null,
      enabled: agent.enabled,
      currentTask: agent.currentTask,
      codexSessionId: stringValue(profile.codexCliSessionId) || stringValue(profile.activeWorkflowSessionId),
      activeRunIds: activeRunIdsByAgent.get(agent.id) ?? [],
      taskIds: taskIdsByAgent.get(agent.id) ?? [],
      queuedRunIds: queuedRunIdsByAgent.get(agent.id) ?? [],
      failedRunIds: failedRunIdsByAgent.get(agent.id) ?? [],
    };
  });

  if (!adminAgent && needsAdminNode) {
    nodes.push({
      id: adminNodeId,
      name: ADMIN_AGENT_NAME,
      displayName: 'Admin',
      avatar: 'A',
      status: 'IDLE',
      kind: 'admin',
      boardId: null,
      boardName: null,
      enabled: false,
      currentTask: null,
      codexSessionId: undefined,
      activeRunIds: [],
      taskIds: [],
      queuedRunIds: [],
      failedRunIds: [],
    });
  }

  if (boardScope) graphBoardIds.add(boardScope.id);
  for (const agent of agents) {
    if (agent.name === ADMIN_AGENT_NAME || agent.name === MOTHER_CHAT_AGENT_NAME) continue;
    rememberScope(agent.boardId);
  }

  const motherProfile = objectRecord(motherAgent?.identityProfile);
  const motherSessionsByBoard = objectRecord(motherProfile.codexCliSessionIdsByBoard);
  function scopedMotherCodexSessionId(boardId: string) {
    const sessionId = stringValue(motherSessionsByBoard[boardId]);
    if (!sessionId) return undefined;
    const globalSessions = [
      stringValue(motherProfile.codexCliSessionId),
      stringValue(motherProfile.codexSessionId),
      stringValue(motherProfile.activeWorkflowSessionId),
      motherAgent?.gatewayAgentId?.startsWith('codex:')
        ? motherAgent.gatewayAgentId.slice('codex:'.length).trim()
        : undefined,
    ].filter((value): value is string => Boolean(value));
    if (globalSessions.includes(sessionId)) return undefined;
    const usedByAnotherBoard = Object.entries(motherSessionsByBoard).some(([otherBoardId, value]) => (
      otherBoardId !== boardId && value === sessionId
    ));
    return usedByAnotherBoard ? undefined : sessionId;
  }
  for (const boardId of graphBoardIds) {
    const board = boardsById.get(boardId);
    nodes.push({
      id: virtualMotherNodeId(boardId),
      name: `${MOTHER_CHAT_AGENT_NAME}:${boardId}`,
      displayName: `${board?.name ?? 'Group'} Mother Chat`,
      avatar: 'M',
      status: motherAgent?.status ?? 'IDLE',
      kind: 'mother_chat',
      boardId,
      boardName: board?.name ?? null,
      enabled: false,
      currentTask: board?.name ? `Monitoring ${board.name}` : 'Monitoring group',
      codexSessionId: scopedMotherCodexSessionId(boardId),
      activeRunIds: [],
      taskIds: [],
      queuedRunIds: [],
      failedRunIds: [],
    });
  }

  const shouldShowOrganizationMother = !options.boardId && hasUngroupedScope.value && hasUngroupedAgents;

  if (shouldShowOrganizationMother) {
    nodes.push({
      id: virtualMotherNodeId(null),
      name: `${MOTHER_CHAT_AGENT_NAME}:${ORG_MOTHER_SCOPE}`,
      displayName: 'Organization Mother Chat',
      avatar: 'M',
      status: motherAgent?.status ?? 'IDLE',
      kind: 'mother_chat',
      boardId: null,
      boardName: 'Organization',
      enabled: false,
      currentTask: 'Monitoring ungrouped agents',
      codexSessionId: stringValue(motherProfile.codexCliSessionId) || stringValue(motherProfile.activeWorkflowSessionId),
      activeRunIds: [],
      taskIds: [],
      queuedRunIds: [],
      failedRunIds: [],
    });
  }

  const edgeMap = new Map<string, GraphEdge>();

  for (const message of messages) {
    const metadata = objectRecord(message.metadata);
    const boardId = messageBoardId(message, metadata);
    if (options.boardId && boardId !== options.boardId) continue;
    if (!boardId) {
      const senderBoardId = message.sender.boardId;
      const receiverBoardId = message.receiver.boardId;
      if (senderBoardId || receiverBoardId) continue;
      if (message.sender.name !== MOTHER_CHAT_AGENT_NAME && message.receiver.name !== MOTHER_CHAT_AGENT_NAME) {
        rememberScope(null);
      }
    } else {
      rememberScope(boardId);
    }
    if (
      !endpointBelongsToScope(message.sender.name, message.sender.boardId, boardId) ||
      !endpointBelongsToScope(message.receiver.name, message.receiver.boardId, boardId)
    ) {
      continue;
    }
    const scope = boardInfo(boardId);
    const role = stringValue(metadata.role);
    const isLegacySelfChat = message.senderId === message.receiverId && Boolean(role);
    const isLegacyMotherChat = isLegacySelfChat && (
      message.sender.name === MOTHER_CHAT_AGENT_NAME || stringValue(metadata.systemRole) === 'mother-chat'
    );

    let source = endpointNodeId(message.sender.name, message.senderId, boardId);
    let target = endpointNodeId(message.receiver.name, message.receiverId, boardId);
    let kind = semanticKind(metadata, message.sender.name, message.receiver.name);

    if (isLegacySelfChat) {
      kind = isLegacyMotherChat ? 'admin_mother' : 'admin_agent';
      if (role === 'user') {
        source = adminNodeId;
        target = endpointNodeId(message.receiver.name, message.receiverId, boardId);
      } else {
        source = endpointNodeId(message.sender.name, message.senderId, boardId);
        target = adminNodeId;
      }
    }

    // The topology is a control-plane view: admins talk to a scoped Mother Chat,
    // and that Mother Chat observes/directs the group agents. Historical direct
    // admin-agent chat rows are therefore projected through the scoped mother
    // node instead of drawing noisy Admin -> Agent spokes.
    if (kind === 'admin_agent') {
      const motherNodeId = virtualMotherNodeId(boardId);
      if (nodes.some(node => node.id === motherNodeId)) {
        source = adminNodeId;
        target = motherNodeId;
        kind = 'admin_mother';
      }
    }
    if (kind === 'admin_mother') {
      const motherNodeId = virtualMotherNodeId(boardId);
      if (nodes.some(node => node.id === motherNodeId)) {
        source = adminNodeId;
        target = motherNodeId;
      }
    }

    if (!nodes.some(node => node.id === source)) continue;
    if (!nodes.some(node => node.id === target)) continue;

    const edge = getOrCreateEdge(edgeMap, source, target, kind, message.createdAt, scope);
    edge.messageCount += 1;
    if (message.createdAt > new Date(edge.lastMessage)) {
      edge.lastMessage = message.createdAt.toISOString();
    }
    pushUnique(edge.threadIds, message.threadId);
    pushUnique(edge.codexSessionIds, codexSessionIdFromMetadata(metadata));
    pushUnique(edge.sessionIds, stringValue(metadata.nexusSessionId));

    for (const endpoint of [source, target]) {
      for (const id of activeRunIdsByAgent.get(endpoint) ?? []) pushUnique(edge.activeRunIds, id);
      for (const id of queuedRunIdsByAgent.get(endpoint) ?? []) pushUnique(edge.queuedRunIds, id);
      for (const id of failedRunIdsByAgent.get(endpoint) ?? []) pushUnique(edge.failedRunIds, id);
      for (const id of taskIdsByAgent.get(endpoint) ?? []) pushUnique(edge.taskIds, id);
    }

    if (edge.recentMessages.length < 6) {
      edge.recentMessages.push({
        id: message.id,
        role,
        content: message.content.slice(0, 240),
        createdAt: message.createdAt.toISOString(),
        threadId: message.threadId,
        codexSessionId: codexSessionIdFromMetadata(metadata),
        nexusSessionId: stringValue(metadata.nexusSessionId),
        requestId: stringValue(metadata.requestId),
      });
    }
  }

  if (motherAgent || graphBoardIds.size > 0 || shouldShowOrganizationMother) {
    const motherScopes = [
      ...Array.from(graphBoardIds).map(boardId => boardInfo(boardId)),
      ...(shouldShowOrganizationMother ? [boardInfo(null)] : []),
    ];
    for (const scope of motherScopes) {
      const motherNodeId = virtualMotherNodeId(scope.boardId);
      if (!nodes.some(node => node.id === motherNodeId)) continue;
      if (needsAdminNode) {
        const adminEdge = getOrCreateEdge(edgeMap, adminNodeId, motherNodeId, 'admin_mother', new Date(), scope);
        adminEdge.messageCount = Math.max(adminEdge.messageCount, 1);
        adminEdge.observationLinks = [
          { type: 'context', id: scope.boardId || ORG_MOTHER_SCOPE, label: `${scope.boardName} Mother Chat context`, status: 'SCOPED' },
        ];
      }
    }

    for (const agent of agents) {
      if (agent.name === ADMIN_AGENT_NAME || agent.name === MOTHER_CHAT_AGENT_NAME) continue;
      if (options.boardId && agent.boardId !== options.boardId) continue;
      const scope = boardInfo(agent.boardId);
      const motherNodeId = virtualMotherNodeId(agent.boardId);
      if (!nodes.some(node => node.id === motherNodeId)) continue;
      const edge = getOrCreateEdge(edgeMap, motherNodeId, agent.id, 'mother_observation', agent.updatedAt, scope);
      edge.lastMessage = agent.updatedAt.toISOString();
      for (const id of activeRunIdsByAgent.get(agent.id) ?? []) pushUnique(edge.activeRunIds, id);
      for (const id of queuedRunIdsByAgent.get(agent.id) ?? []) pushUnique(edge.queuedRunIds, id);
      for (const id of failedRunIdsByAgent.get(agent.id) ?? []) pushUnique(edge.failedRunIds, id);
      for (const id of taskIdsByAgent.get(agent.id) ?? []) pushUnique(edge.taskIds, id);
      edge.observationLinks = [
        { type: 'context', id: agent.id, label: `Mother Chat observes ${agent.displayName}`, status: agent.status },
        ...completedRunJobsByAgent.get(agent.id)?.map(job => ({
          type: 'run_job' as const,
          id: job.id,
          label: `${job.summary ?? 'Completed run'} (${job.status})`,
          status: job.status,
        })) ?? [],
        ...runningSessions
          .filter(session => session.agentId === agent.id)
          .slice(0, 3)
          .map(session => ({ type: 'session' as const, id: session.id, label: session.summary || session.type, status: session.status })),
        ...queuedRunIdsByAgent.get(agent.id)?.slice(0, 3).map(id => ({
          type: 'run_job' as const,
          id,
          label: `Queued run ${id.slice(0, 8)}`,
          status: 'QUEUED',
        })) ?? [],
        ...failedRunIdsByAgent.get(agent.id)?.slice(0, 3).map(id => ({
          type: 'run_job' as const,
          id,
          label: `Failed run ${id.slice(0, 8)}`,
          status: 'FAILED',
        })) ?? [],
        ...openTasks
          .filter(task => task.agentId === agent.id)
          .slice(0, 3)
          .map(task => ({ type: 'task' as const, id: task.id, label: task.title, status: task.status })),
      ];
    }
  }

  const agentDisplayNameCounts = new Map<string, number>();
  for (const node of nodes) {
    if (node.kind !== 'agent') continue;
    const key = node.displayName.trim().toLowerCase();
    agentDisplayNameCounts.set(key, (agentDisplayNameCounts.get(key) ?? 0) + 1);
  }
  for (const node of nodes) {
    if (node.kind !== 'agent') continue;
    const key = node.displayName.trim().toLowerCase();
    if ((agentDisplayNameCounts.get(key) ?? 0) <= 1) continue;
    const suffix = node.boardName || node.boardId?.slice(0, 8) || node.id.slice(0, 8);
    node.displayName = `${node.displayName} · ${suffix}`;
  }

  return {
    nodes,
    edges: Array.from(edgeMap.values()).sort((a, b) => new Date(b.lastMessage).getTime() - new Date(a.lastMessage).getTime()),
  };
}
