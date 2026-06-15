import { prisma } from '../lib/prisma.js';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { logger } from '../lib/logger.js';
import { ADMIN_AGENT_NAME } from './system-agent.service.js';
const tracer = trace.getTracer('nexus-thread');
const MOTHER_CHAT_AGENT_NAME = '__mother_chat__';
const VIRTUAL_ADMIN_NODE_ID = 'virtual:admin';

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
  type: 'task' | 'session' | 'context';
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
  threadIds: string[];
  codexSessionIds: string[];
  sessionIds: string[];
  activeRunIds: string[];
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

function getOrCreateEdge(edgeMap: Map<string, GraphEdge>, source: string, target: string, kind: GraphEdgeKind, fallbackDate: Date) {
  const key = `${source}->${target}::${kind}`;
  const existing = edgeMap.get(key);
  if (existing) return existing;

  const edge: GraphEdge = {
    source,
    target,
    kind,
    label: edgeLabel(kind),
    messageCount: 0,
    lastMessage: fallbackDate.toISOString(),
    threadIds: [],
    codexSessionIds: [],
    sessionIds: [],
    activeRunIds: [],
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

export async function getCommGraph(organizationId: string) {
  const [agents, messages, runningSessions, openTasks] = await Promise.all([
    prisma.agent.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: graphAgentSelectFields,
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
        sender: { select: { id: true, name: true, displayName: true } },
        receiver: { select: { id: true, name: true, displayName: true } },
      },
    }),
    prisma.session.findMany({
      where: { organizationId, status: 'RUNNING' },
      orderBy: { startedAt: 'desc' },
      select: { id: true, agentId: true, type: true, status: true, summary: true, startedAt: true },
    }),
    prisma.task.findMany({
      where: { organizationId, status: { not: 'DONE' } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, agentId: true, title: true, status: true, priority: true },
    }),
  ]);

  const agentById = new Map(agents.map(agent => [agent.id, agent]));
  const adminAgent = agents.find(agent => agent.name === ADMIN_AGENT_NAME);
  const motherAgent = agents.find(agent => agent.name === MOTHER_CHAT_AGENT_NAME);
  const hasLegacyAdminMessages = messages.some(message => {
    const metadata = objectRecord(message.metadata);
    return message.senderId === message.receiverId && Boolean(stringValue(metadata.role));
  });
  const adminNodeId = adminAgent?.id ?? VIRTUAL_ADMIN_NODE_ID;
  const taskIdsByAgent = new Map<string, string[]>();
  const activeRunIdsByAgent = new Map<string, string[]>();

  for (const task of openTasks) {
    if (!task.agentId) continue;
    const ids = taskIdsByAgent.get(task.agentId) ?? [];
    ids.push(task.id);
    taskIdsByAgent.set(task.agentId, ids);
  }
  for (const session of runningSessions) {
    const ids = activeRunIdsByAgent.get(session.agentId) ?? [];
    ids.push(session.id);
    activeRunIdsByAgent.set(session.agentId, ids);
  }

  const nodes = agents.map(agent => {
    const profile = objectRecord(agent.identityProfile);
    return {
      id: agent.id,
      name: agent.name,
      displayName: agent.displayName,
      avatar: agent.avatar,
      status: agent.status,
      kind: roleFromAgentName(agent.name),
      enabled: agent.enabled,
      currentTask: agent.currentTask,
      codexSessionId: stringValue(profile.codexCliSessionId) || stringValue(profile.activeWorkflowSessionId),
      activeRunIds: activeRunIdsByAgent.get(agent.id) ?? [],
      taskIds: taskIdsByAgent.get(agent.id) ?? [],
    };
  });

  if (!adminAgent && hasLegacyAdminMessages) {
    nodes.push({
      id: adminNodeId,
      name: ADMIN_AGENT_NAME,
      displayName: 'Admin',
      avatar: 'A',
      status: 'IDLE',
      kind: 'admin',
      enabled: false,
      currentTask: null,
      codexSessionId: undefined,
      activeRunIds: [],
      taskIds: [],
    });
  }

  const edgeMap = new Map<string, GraphEdge>();

  for (const message of messages) {
    const metadata = objectRecord(message.metadata);
    const role = stringValue(metadata.role);
    const isLegacySelfChat = message.senderId === message.receiverId && Boolean(role);
    const isLegacyMotherChat = isLegacySelfChat && (
      message.sender.name === MOTHER_CHAT_AGENT_NAME || stringValue(metadata.systemRole) === 'mother-chat'
    );

    let source = message.senderId;
    let target = message.receiverId;
    let kind = semanticKind(metadata, message.sender.name, message.receiver.name);

    if (isLegacySelfChat) {
      kind = isLegacyMotherChat ? 'admin_mother' : 'admin_agent';
      if (role === 'user') {
        source = adminNodeId;
        target = message.receiverId;
      } else {
        source = message.senderId;
        target = adminNodeId;
      }
    }

    if (!agentById.has(source) && source !== adminNodeId) continue;
    if (!agentById.has(target) && target !== adminNodeId) continue;

    const edge = getOrCreateEdge(edgeMap, source, target, kind, message.createdAt);
    edge.messageCount += 1;
    if (message.createdAt > new Date(edge.lastMessage)) {
      edge.lastMessage = message.createdAt.toISOString();
    }
    pushUnique(edge.threadIds, message.threadId);
    pushUnique(edge.codexSessionIds, codexSessionIdFromMetadata(metadata));
    pushUnique(edge.sessionIds, stringValue(metadata.nexusSessionId));

    for (const endpoint of [source, target]) {
      for (const id of activeRunIdsByAgent.get(endpoint) ?? []) pushUnique(edge.activeRunIds, id);
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

  if (motherAgent) {
    for (const agent of agents) {
      if (agent.name === ADMIN_AGENT_NAME || agent.name === MOTHER_CHAT_AGENT_NAME) continue;
      const edge = getOrCreateEdge(edgeMap, motherAgent.id, agent.id, 'mother_observation', agent.updatedAt);
      edge.lastMessage = agent.updatedAt.toISOString();
      for (const id of activeRunIdsByAgent.get(agent.id) ?? []) pushUnique(edge.activeRunIds, id);
      for (const id of taskIdsByAgent.get(agent.id) ?? []) pushUnique(edge.taskIds, id);
      edge.observationLinks = [
        { type: 'context', id: agent.id, label: `Mother Chat observes ${agent.displayName}`, status: agent.status },
        ...runningSessions
          .filter(session => session.agentId === agent.id)
          .slice(0, 3)
          .map(session => ({ type: 'session' as const, id: session.id, label: session.summary || session.type, status: session.status })),
        ...openTasks
          .filter(task => task.agentId === agent.id)
          .slice(0, 3)
          .map(task => ({ type: 'task' as const, id: task.id, label: task.title, status: task.status })),
      ];
    }
  }

  return {
    nodes,
    edges: Array.from(edgeMap.values()).sort((a, b) => new Date(b.lastMessage).getTime() - new Date(a.lastMessage).getTime()),
  };
}
