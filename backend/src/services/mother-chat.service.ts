import type { ActivityType } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import * as activityService from './activity.service.js';
import * as llmProviderService from './llm-provider.service.js';
import { ADMIN_AGENT_NAME, getOrCreateAdminAgent } from './system-agent.service.js';
import {
  getThreadCodexSessionId,
  resolveCodexCwd,
  runCodexCliPromptWithResumeRecovery,
  validateAuthentication,
  validateInstallation,
  type CodexCliUsage,
  type NexusCodexEvent,
  type NexusCodexEventType,
} from './codex-cli.service.js';

export const MOTHER_CHAT_AGENT_NAME = '__mother_chat__';

type JsonRecord = Record<string, unknown>;

interface MotherChatSendOptions {
  organizationId: string;
  message: string;
  boardId?: string;
  requestId?: string;
  io?: SocketIOServer;
}

interface MotherChatContextOptions {
  boardId?: string;
}

type MotherChatBoardScope = {
  id: string;
  name: string;
  slug: string;
  description: string;
  objective: string | null;
  boardType: string;
};

export interface MotherChatRunResult {
  status: 'finished' | 'failed';
  result: string;
  codexSessionId: string | null;
  nexusSessionId: string;
  durationMs: number;
  usage: CodexCliUsage | null;
  model: string;
}

function objectRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function truncate(value: string | null | undefined, length = 240) {
  const text = value?.trim() || '';
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function activityTypeForEvent(eventType: NexusCodexEventType): ActivityType {
  if (eventType === 'error') return 'ERROR';
  if (eventType === 'response') return 'MESSAGE';
  return 'SYSTEM';
}

function getMotherThreadId(agent: { identityProfile: unknown }, boardId?: string) {
  const profile = objectRecord(agent.identityProfile);
  if (boardId) {
    const boardThreads = objectRecord(profile.motherChatThreadIdsByBoard);
    return typeof boardThreads[boardId] === 'string' ? boardThreads[boardId] as string : undefined;
  }
  return typeof profile.motherChatThreadId === 'string' ? profile.motherChatThreadId : undefined;
}

function getMotherCodexSessionId(agent: { identityProfile: unknown; gatewayAgentId: string | null }, boardId?: string) {
  const profile = objectRecord(agent.identityProfile);
  if (boardId) {
    const boardSessions = objectRecord(profile.codexCliSessionIdsByBoard);
    return typeof boardSessions[boardId] === 'string' ? boardSessions[boardId] as string : getProfileCodexSessionId(agent);
  }
  return getProfileCodexSessionId(agent);
}

function getProfileCodexSessionId(agent: { identityProfile: unknown; gatewayAgentId: string | null }) {
  const profile = objectRecord(agent.identityProfile);
  for (const key of ['codexCliSessionId', 'codexSessionId', 'activeWorkflowSessionId']) {
    const value = profile[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  if (agent.gatewayAgentId?.startsWith('codex:')) {
    const sessionId = agent.gatewayAgentId.slice('codex:'.length).trim();
    if (sessionId) return sessionId;
  }
  return undefined;
}

async function getOrCreateMotherAgent(organizationId: string) {
  const existing = await prisma.agent.findUnique({
    where: { organizationId_name: { organizationId, name: MOTHER_CHAT_AGENT_NAME } },
  });
  if (existing) return existing;

  return prisma.agent.create({
    data: {
      organizationId,
      name: MOTHER_CHAT_AGENT_NAME,
      displayName: 'Mother Chat',
      description: 'Nexus system agent for organization-wide Codex CLI monitoring.',
      workspace: process.env.CODEX_WORKSPACE_ROOT || '',
      status: 'IDLE',
      enabled: false,
      agentToAgent: false,
      identityProfile: {
        systemRole: 'mother-chat',
        agentRuntime: 'codex-cli',
      } as any,
    },
  });
}

async function upsertMotherThread(
  agent: Awaited<ReturnType<typeof getOrCreateMotherAgent>>,
  boardScope?: MotherChatBoardScope | null,
) {
  const existingThreadId = getMotherThreadId(agent, boardScope?.id);
  if (existingThreadId) {
    const existing = await prisma.thread.findFirst({
      where: { id: existingThreadId, organizationId: agent.organizationId },
    });
    if (existing) return existing;
  }

  const thread = await prisma.thread.create({
    data: {
      organizationId: agent.organizationId,
      title: boardScope ? `Mother Chat: ${boardScope.name}` : 'Mother Chat',
    },
  });

  const profile = objectRecord(agent.identityProfile);
  const threadIdsByBoard = objectRecord(profile.motherChatThreadIdsByBoard);
  const nextProfile = boardScope
    ? {
        ...profile,
        motherChatThreadIdsByBoard: {
          ...threadIdsByBoard,
          [boardScope.id]: thread.id,
        },
        agentRuntime: 'codex-cli',
        systemRole: 'mother-chat',
      }
    : {
        ...profile,
        motherChatThreadId: thread.id,
        agentRuntime: 'codex-cli',
        systemRole: 'mother-chat',
      };

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      identityProfile: nextProfile as any,
    },
  });

  return thread;
}

async function updateMotherSession(
  agent: Awaited<ReturnType<typeof getOrCreateMotherAgent>>,
  codexSessionId: string,
  threadId?: string,
  boardScope?: MotherChatBoardScope | null,
) {
  const profile = objectRecord(agent.identityProfile);
  const threadIdsByBoard = objectRecord(profile.motherChatThreadIdsByBoard);
  const sessionIdsByBoard = objectRecord(profile.codexCliSessionIdsByBoard);
  const nextProfile = boardScope
    ? {
        ...profile,
        motherChatThreadIdsByBoard: {
          ...threadIdsByBoard,
          ...(threadId && { [boardScope.id]: threadId }),
        },
        codexCliSessionIdsByBoard: {
          ...sessionIdsByBoard,
          [boardScope.id]: codexSessionId,
        },
        agentRuntime: 'codex-cli',
        systemRole: 'mother-chat',
      }
    : {
        ...profile,
        ...(threadId && { motherChatThreadId: threadId }),
        codexCliSessionId: codexSessionId,
        activeWorkflowSessionId: codexSessionId,
        agentRuntime: 'codex-cli',
        systemRole: 'mother-chat',
      };

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      identityProfile: nextProfile as any,
    },
  });
}

function emitMotherChatEvent(options: {
  io?: SocketIOServer;
  organizationId: string;
  boardId?: string | null;
  nexusSessionId: string;
  codexSessionId?: string | null;
  requestId?: string;
  event: NexusCodexEvent;
}) {
  options.io?.to(`org:${options.organizationId}`).emit('mother-chat:event', {
    sessionId: options.nexusSessionId,
    nexusSessionId: options.nexusSessionId,
    codexSessionId: options.codexSessionId ?? null,
    boardId: options.boardId ?? null,
    requestId: options.requestId ?? null,
    type: options.event.type,
    content: options.event.content,
    metadata: options.event.metadata ?? {},
    timestamp: new Date().toISOString(),
  });
}

async function persistMotherActivity(options: {
  organizationId: string;
  motherAgentId: string;
  boardId?: string | null;
  nexusSessionId: string;
  codexSessionId?: string | null;
  requestId?: string;
  event: NexusCodexEvent;
}) {
  return activityService.createActivity(options.organizationId, {
    agentId: options.motherAgentId,
    type: activityTypeForEvent(options.event.type),
    message: (options.event.content || options.event.type).slice(0, 500),
    metadata: {
      runtime: 'codex-cli',
      systemRole: 'mother-chat',
      boardId: options.boardId ?? null,
      nexusEventType: options.event.type,
      nexusSessionId: options.nexusSessionId,
      codexSessionId: options.codexSessionId ?? null,
      requestId: options.requestId ?? null,
      ...(options.event.metadata ?? {}),
    },
  });
}

function formatSection(title: string, rows: string[]) {
  return rows.length > 0 ? `${title}\n${rows.join('\n')}` : `${title}\n- None`;
}

async function resolveBoardScope(organizationId: string, boardId?: string): Promise<MotherChatBoardScope | null> {
  if (!boardId) return null;
  const board = await prisma.board.findFirst({
    where: { id: boardId, organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      objective: true,
      boardType: true,
    },
  });
  if (!board) {
    const err = new Error('Board not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  return board;
}

export async function buildMotherChatContext(organizationId: string, options: MotherChatContextOptions = {}) {
  const boardScope = await resolveBoardScope(organizationId, options.boardId);
  const agentSelect = { id: true, name: true, displayName: true, avatar: true, status: true, boardId: true };
  const nonMotherAgentWhere = {
    organizationId,
    name: { notIn: [MOTHER_CHAT_AGENT_NAME, ADMIN_AGENT_NAME] },
    ...(boardScope && { boardId: boardScope.id }),
  };
  const nonMotherAgentRelationWhere = {
    name: { notIn: [MOTHER_CHAT_AGENT_NAME, ADMIN_AGENT_NAME] },
    ...(boardScope && { boardId: boardScope.id }),
  };
  const boardTaskWhere = boardScope
    ? { organizationId, boardId: boardScope.id }
    : { organizationId };
  const messageWhere = {
    thread: { organizationId },
    NOT: [
      { sender: { name: MOTHER_CHAT_AGENT_NAME } },
      { receiver: { name: MOTHER_CHAT_AGENT_NAME } },
    ],
  };

  const [
    agents,
    sessions,
    messages,
    activities,
    tasks,
    tokenUsages,
    errorActivities,
    failedMetrics,
    alertEvents,
    approvals,
  ] = await Promise.all([
    prisma.agent.findMany({
      where: nonMotherAgentWhere,
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        name: true,
        displayName: true,
        status: true,
        currentTask: true,
        enabled: true,
        gatewayAgentId: true,
        lastHeartbeat: true,
        boardId: true,
        identityProfile: true,
        updatedAt: true,
      },
    }),
    prisma.session.findMany({
      where: { organizationId, agent: nonMotherAgentRelationWhere },
      orderBy: { startedAt: 'desc' },
      take: 25,
      include: { agent: { select: agentSelect } },
    }),
    prisma.message.findMany({
      where: messageWhere,
      orderBy: { createdAt: 'desc' },
      take: boardScope ? 200 : 30,
      include: {
        sender: { select: agentSelect },
        receiver: { select: agentSelect },
      },
    }),
    prisma.activity.findMany({
      where: { organizationId, agent: nonMotherAgentRelationWhere },
      orderBy: { createdAt: 'desc' },
      take: 35,
      include: { agent: { select: agentSelect } },
    }),
    prisma.task.findMany({
      where: boardTaskWhere,
      orderBy: { updatedAt: 'desc' },
      take: 35,
      include: {
        agent: { select: agentSelect },
        board: { select: { id: true, name: true, slug: true } },
      },
    }),
    prisma.tokenUsage.findMany({
      where: { organizationId, agent: nonMotherAgentRelationWhere },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: { agent: { select: agentSelect } },
    }),
    prisma.activity.findMany({
      where: { organizationId, type: 'ERROR', agent: nonMotherAgentRelationWhere },
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: { agent: { select: agentSelect } },
    }),
    prisma.metricSnapshot.findMany({
      where: { organizationId, success: false, agent: nonMotherAgentRelationWhere },
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: { agent: { select: agentSelect } },
    }),
    prisma.alertEvent.findMany({
      where: {
        organizationId,
        acknowledged: false,
        ...(boardScope && { alertRule: { agent: { is: { boardId: boardScope.id } } } }),
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: { alertRule: { select: { id: true, name: true, agentId: true } } },
    }),
    prisma.approval.findMany({
      where: boardScope ? { boardId: boardScope.id } : { board: { organizationId } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        board: { select: { id: true, name: true, slug: true } },
        task: { select: { id: true, title: true, status: true } },
        agent: { select: agentSelect },
      },
    }),
  ]);

  const visibleMessages = boardScope
    ? messages.filter(message => {
        const metadata = objectRecord(message.metadata);
        const metadataBoardId = stringValue(metadata.boardId);
        if (metadataBoardId) return metadataBoardId === boardScope.id;
        return message.sender.boardId === boardScope.id || message.receiver.boardId === boardScope.id;
      }).slice(0, 30)
    : messages;

  const tokenTotals = tokenUsages.reduce((total, usage) => ({
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    totalTokens: total.totalTokens + usage.totalTokens,
    cost: total.cost + usage.cost,
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 });

  const activeTasks = tasks.filter(task => ['ASSIGNED', 'IN_PROGRESS', 'REVIEW'].includes(task.status));
  const runningSessions = sessions.filter(session => session.status === 'RUNNING');
  const errorCount = errorActivities.length + failedMetrics.length + alertEvents.length;

  const agentRows = agents.map(agent => {
    const profile = objectRecord(agent.identityProfile);
    const agentRuntime = typeof profile.agentRuntime === 'string' ? profile.agentRuntime : null;
    const codexCliSessionId = typeof profile.codexCliSessionId === 'string' && profile.codexCliSessionId.trim()
      ? profile.codexCliSessionId.trim()
      : null;
    const codexSessionId = typeof profile.codexSessionId === 'string' && profile.codexSessionId.trim()
      ? profile.codexSessionId.trim()
      : null;
    const activeWorkflowSessionId = typeof profile.activeWorkflowSessionId === 'string' && profile.activeWorkflowSessionId.trim()
      ? profile.activeWorkflowSessionId.trim()
      : null;
    const gatewayCodexSessionId = agent.gatewayAgentId?.startsWith('codex:')
      ? agent.gatewayAgentId.slice('codex:'.length).trim()
      : null;
    const effectiveCodexSessionId = codexCliSessionId || codexSessionId || activeWorkflowSessionId || gatewayCodexSessionId || null;
    const runtimeConnected = agent.enabled && agentRuntime === 'codex-cli' && Boolean(effectiveCodexSessionId);
    return {
      id: agent.id,
      name: agent.name,
      displayName: agent.displayName,
      status: agent.status,
      enabled: agent.enabled,
      agentRuntime,
      runtimeConnected,
      currentTask: agent.currentTask,
      lastHeartbeat: agent.lastHeartbeat?.toISOString() ?? null,
      boardId: agent.boardId,
      codexCliSessionId,
      codexSessionId,
      activeWorkflowSessionId,
      effectiveCodexSessionId,
      updatedAt: agent.updatedAt.toISOString(),
    };
  });

  const context = {
    generatedAt: new Date().toISOString(),
    scope: boardScope
      ? {
          type: 'board',
          board: boardScope,
        }
      : {
          type: 'organization',
          board: null,
        },
    counts: {
      agents: agents.length,
      runningSessions: runningSessions.length,
      activeTasks: activeTasks.length,
      recentMessages: visibleMessages.length,
      recentActivities: activities.length,
      recentErrors: errorCount,
      pendingApprovals: approvals.filter(approval => approval.status === 'PENDING').length,
      tokensInWindow: tokenTotals.totalTokens,
    },
    agents: agentRows,
    sessions: sessions.map(session => ({
      id: session.id,
      agent: session.agent.displayName,
      type: session.type,
      status: session.status,
      summary: session.summary,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      durationMs: session.durationMs,
      tokensUsed: session.tokensUsed,
    })),
    messages: visibleMessages.reverse().map(message => {
      const metadata = objectRecord(message.metadata);
      return {
        id: message.id,
        threadId: message.threadId,
        from: message.sender.displayName,
        to: message.receiver.displayName,
        content: truncate(message.content, 300),
        conversationKind: stringValue(metadata.conversationKind) ?? null,
        boardId: stringValue(metadata.boardId) ?? null,
        taskIds: Array.isArray(metadata.taskIds)
          ? metadata.taskIds.filter((taskId): taskId is string => typeof taskId === 'string')
          : [],
        createdAt: message.createdAt.toISOString(),
      };
    }),
    activities: activities.map(activity => ({
      id: activity.id,
      agent: activity.agent.displayName,
      type: activity.type,
      message: truncate(activity.message, 260),
      createdAt: activity.createdAt.toISOString(),
    })),
    tasks: tasks.map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      agent: task.agent?.displayName ?? 'Unassigned',
      board: task.board?.name ?? null,
      updatedAt: task.updatedAt.toISOString(),
    })),
    tokenUsage: tokenUsages.map(usage => ({
      id: usage.id,
      agent: usage.agent.displayName,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cost: usage.cost,
      createdAt: usage.createdAt.toISOString(),
    })),
    errors: [
      ...errorActivities.map(activity => ({
        source: 'activity',
        agent: activity.agent.displayName,
        message: truncate(activity.message, 260),
        createdAt: activity.createdAt.toISOString(),
      })),
      ...failedMetrics.map(metric => ({
        source: 'metric',
        agent: metric.agent.displayName,
        message: truncate(metric.errorMessage || metric.toolName || 'Failed metric', 260),
        createdAt: metric.createdAt.toISOString(),
      })),
      ...alertEvents.map(alert => ({
        source: 'alert',
        agent: alert.alertRule.agentId ?? 'organization',
        message: truncate(`${alert.alertRule.name}: ${alert.message}`, 260),
        createdAt: alert.createdAt.toISOString(),
      })),
    ],
    approvals: approvals.map(approval => ({
      id: approval.id,
      status: approval.status,
      actionType: approval.actionType,
      agent: approval.agent?.displayName ?? null,
      task: approval.task?.title ?? null,
      board: approval.board.name,
      createdAt: approval.createdAt.toISOString(),
    })),
  };

  const contextText = [
    boardScope
      ? `Nexus Mother Chat DB snapshot generated at ${context.generatedAt}. Scope: production board "${boardScope.name}" (${boardScope.id}). Objective: ${truncate(boardScope.objective, 180) || 'none'}.`
      : `Nexus Mother Chat DB snapshot generated at ${context.generatedAt}. Scope: organization-wide.`,
    `Counts: agents=${context.counts.agents}, runningSessions=${context.counts.runningSessions}, activeTasks=${context.counts.activeTasks}, recentMessages=${context.counts.recentMessages}, recentActivities=${context.counts.recentActivities}, recentErrors=${context.counts.recentErrors}, pendingApprovals=${context.counts.pendingApprovals}, recentTokens=${context.counts.tokensInWindow}.`,
    formatSection('Agents', context.agents.map(agent =>
      `- ${agent.displayName} (${agent.name}) status=${agent.status}, enabled=${agent.enabled}, runtime=${agent.agentRuntime || 'unknown'}, runtimeConnected=${agent.runtimeConnected ? 'yes' : 'no'}, currentTask=${truncate(agent.currentTask, 120) || 'none'}, effectiveCodexSessionId=${agent.effectiveCodexSessionId || 'none'}, codexCliSessionId=${agent.codexCliSessionId || 'none'}, activeWorkflowSessionId=${agent.activeWorkflowSessionId || 'none'}, lastHeartbeat=${agent.lastHeartbeat || 'none'}`
    )),
    formatSection('Recent sessions', context.sessions.map(session =>
      `- ${session.agent}: ${session.type}/${session.status}, id=${session.id}, tokens=${session.tokensUsed ?? 0}, summary=${truncate(session.summary, 180) || 'none'}`
    )),
    formatSection('Recent messages', context.messages.map(message =>
      `- ${message.createdAt} ${message.from} -> ${message.to}: ${message.content}`
    )),
    formatSection('Recent activities', context.activities.map(activity =>
      `- ${activity.createdAt} ${activity.agent} ${activity.type}: ${activity.message}`
    )),
    formatSection('Tasks', context.tasks.map(task =>
      `- ${task.title} [${task.status}/${task.priority}] agent=${task.agent}, board=${task.board || 'none'}, id=${task.id}`
    )),
    formatSection('Recent token usage', context.tokenUsage.map(usage =>
      `- ${usage.agent}: ${usage.totalTokens} tokens (${usage.inputTokens} in/${usage.outputTokens} out), model=${usage.model}, cost=${usage.cost}`
    )),
    formatSection('Errors and alerts', context.errors.map(error =>
      `- ${error.createdAt} ${error.source} ${error.agent}: ${error.message}`
    )),
    formatSection('Approvals', context.approvals.map(approval =>
      `- ${approval.status} ${approval.actionType}, agent=${approval.agent || 'none'}, task=${approval.task || 'none'}, board=${approval.board}, id=${approval.id}`
    )),
  ].join('\n\n');

  return { context, contextText };
}

function composeMotherPrompt(contextText: string, message: string) {
  return [
    'You are Nexus Mother Chat, the admin-facing control-plane assistant for a multi-agent Codex CLI system.',
    'Use only the Nexus DB snapshot below as operational truth. If the snapshot does not contain enough information, say what is missing.',
    'Answer like an operations lead: concise, specific, and grounded in agent names, task/session IDs, statuses, errors, and token usage when relevant.',
    'Do not ask for OpenAI or Codex API keys. Nexus uses the local Codex CLI login.',
    '',
    'NEXUS DB SNAPSHOT',
    contextText,
    '',
    'ADMIN QUESTION',
    message,
  ].join('\n');
}

export async function getMotherChatHistory(
  organizationId: string,
  limit = 50,
  options: MotherChatContextOptions = {},
) {
  const boardScope = await resolveBoardScope(organizationId, options.boardId);
  const motherAgent = await prisma.agent.findUnique({
    where: { organizationId_name: { organizationId, name: MOTHER_CHAT_AGENT_NAME } },
  });
  if (!motherAgent) {
    return { sessionKey: '', messages: [] };
  }

  const threadId = getMotherThreadId(motherAgent, boardScope?.id);
  if (!threadId) {
    return {
      sessionKey: getMotherCodexSessionId(motherAgent, boardScope?.id) || '',
      messages: [],
    };
  }

  const messages = await prisma.message.findMany({
    where: {
      threadId,
      thread: { organizationId },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const threadCodexSessionId = await getThreadCodexSessionId(threadId, organizationId);

  return {
    sessionKey: threadCodexSessionId || getMotherCodexSessionId(motherAgent, boardScope?.id) || '',
    messages: messages.reverse().map(message => {
      const metadata = objectRecord(message.metadata);
      return {
        id: message.id,
        role: metadata.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
        timestamp: message.createdAt.toISOString(),
        requestId: typeof metadata.requestId === 'string' ? metadata.requestId : undefined,
        metadata,
      };
    }),
  };
}

export async function sendMotherChatMessage(options: MotherChatSendOptions): Promise<MotherChatRunResult> {
  if (!options.message.trim()) {
    const err = new Error('message is required') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  const installation = await validateInstallation();
  if (!installation.ok || !installation.command) {
    const err = new Error(`Codex CLI installation check failed: ${installation.details}`) as Error & { statusCode?: number };
    err.statusCode = 503;
    throw err;
  }

  const authentication = await validateAuthentication();
  if (!authentication.ok) {
    const err = new Error(`Codex CLI authentication check failed. Run "codex login" locally. Details: ${authentication.details}`) as Error & { statusCode?: number };
    err.statusCode = 503;
    throw err;
  }

  const motherAgent = await getOrCreateMotherAgent(options.organizationId);
  const boardScope = await resolveBoardScope(options.organizationId, options.boardId);
  const thread = await upsertMotherThread(motherAgent, boardScope);
  const adminAgent = await getOrCreateAdminAgent(options.organizationId);
  const threadCodexSessionId = await getThreadCodexSessionId(thread.id, options.organizationId);
  const agentCodexSessionId = getMotherCodexSessionId(motherAgent, boardScope?.id);
  const existingCodexSessionId = threadCodexSessionId || agentCodexSessionId;
  const { context, contextText } = await buildMotherChatContext(options.organizationId, { boardId: boardScope?.id });
  const cwd = resolveCodexCwd(motherAgent);
  const command = installation.command;
  const chatSession = await prisma.session.create({
    data: {
      organizationId: options.organizationId,
      agentId: motherAgent.id,
      type: 'MOTHER_CHAT',
      status: 'RUNNING',
      summary: `Mother Chat: ${options.message.slice(0, 120)}`,
    },
  });

  const startedAt = Date.now();
  await prisma.message.create({
    data: {
      threadId: thread.id,
      senderId: adminAgent.id,
      receiverId: motherAgent.id,
      content: options.message,
      metadata: {
        role: 'user',
        runtime: 'codex-cli',
        systemRole: 'mother-chat',
        conversationKind: 'admin_mother',
        edgeSemantic: 'admin_to_mother_chat',
        boardId: boardScope?.id ?? null,
        boardName: boardScope?.name ?? null,
        nexusSessionId: chatSession.id,
        resumeCodexSessionId: existingCodexSessionId ?? null,
        requestId: options.requestId ?? null,
        contextCounts: context.counts,
      } as any,
    },
  });

  await prisma.agent.update({ where: { id: motherAgent.id }, data: { status: 'ONLINE' } });

  logger.info({
    command,
    cwd,
    resume: Boolean(existingCodexSessionId),
    sessionSource: threadCodexSessionId ? 'thread' : agentCodexSessionId ? 'agent' : 'new',
    threadId: thread.id,
    nexusSessionId: chatSession.id,
    boardId: boardScope?.id ?? null,
  }, 'Starting Mother Chat Codex CLI run');

  try {
    const state = await runCodexCliPromptWithResumeRecovery({
      command,
      cwd,
      existingCodexSessionId,
      prompt: composeMotherPrompt(contextText, options.message),
      logContext: {
        motherAgentId: motherAgent.id,
        nexusSessionId: chatSession.id,
        threadId: thread.id,
      },
      onEvent: async (event, state) => {
        emitMotherChatEvent({
          io: options.io,
          organizationId: options.organizationId,
          boardId: boardScope?.id ?? null,
          nexusSessionId: chatSession.id,
          codexSessionId: state.codexSessionId,
          requestId: options.requestId,
          event,
        });
        await persistMotherActivity({
          organizationId: options.organizationId,
          motherAgentId: motherAgent.id,
          boardId: boardScope?.id ?? null,
          nexusSessionId: chatSession.id,
          codexSessionId: state.codexSessionId,
          requestId: options.requestId,
          event,
        }).catch(err => logger.warn({ err }, 'Failed to persist Mother Chat activity'));
      },
    });

    const responseText = state.result || 'No response';
    const durationMs = Date.now() - startedAt;
    if (state.codexSessionId) {
      await updateMotherSession(motherAgent, state.codexSessionId, thread.id, boardScope);
    }

    await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: motherAgent.id,
        receiverId: adminAgent.id,
        content: responseText,
        metadata: {
          role: 'assistant',
          runtime: 'codex-cli',
          systemRole: 'mother-chat',
          conversationKind: 'admin_mother',
          edgeSemantic: 'mother_chat_to_admin',
          boardId: boardScope?.id ?? null,
          boardName: boardScope?.name ?? null,
          nexusSessionId: chatSession.id,
          codexSessionId: state.codexSessionId,
          codexSessionConfirmed: Boolean(state.codexSessionId),
          requestId: options.requestId ?? null,
          usage: state.usage,
          contextCounts: context.counts,
        } as any,
      },
    });

    await prisma.session.update({
      where: { id: chatSession.id },
      data: {
        status: 'COMPLETED',
        endedAt: new Date(),
        durationMs,
        summary: `Mother Chat: ${options.message.slice(0, 120)}`,
        ...(state.usage && { tokensUsed: state.usage.inputTokens + state.usage.outputTokens }),
      },
    });

    await prisma.metricSnapshot.create({
      data: {
        organizationId: options.organizationId,
        agentId: motherAgent.id,
        responseTimeMs: durationMs,
        success: true,
        toolName: 'mother-chat',
      },
    });

    if (state.usage) {
      await llmProviderService.recordTokenUsage({
        organizationId: options.organizationId,
        agentId: motherAgent.id,
        inputTokens: state.usage.inputTokens,
        outputTokens: state.usage.outputTokens,
        model: process.env.CODEX_MODEL?.trim() || 'codex-cli',
        mode: 'BYOK',
      }).catch(err => logger.warn({ err }, 'Failed to record Mother Chat token usage'));
    }

    emitMotherChatEvent({
      io: options.io,
      organizationId: options.organizationId,
      boardId: boardScope?.id ?? null,
      nexusSessionId: chatSession.id,
      codexSessionId: state.codexSessionId,
      requestId: options.requestId,
      event: {
        type: 'response_end',
        content: 'Mother Chat response complete',
        metadata: { usage: state.usage, contextCounts: context.counts },
      },
    });

    await prisma.agent.update({ where: { id: motherAgent.id }, data: { status: 'IDLE' } });

    return {
      status: 'finished',
      result: responseText,
      codexSessionId: state.codexSessionId,
      nexusSessionId: chatSession.id,
      durationMs,
      usage: state.usage,
      model: process.env.CODEX_MODEL?.trim() || 'codex-cli',
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = (err as Error).message;
    await prisma.session.update({
      where: { id: chatSession.id },
      data: {
        status: 'FAILED',
        endedAt: new Date(),
        durationMs,
        summary: `Mother Chat failed: ${errorMessage.slice(0, 120)}`,
      },
    }).catch(() => {});
    await prisma.metricSnapshot.create({
      data: {
        organizationId: options.organizationId,
        agentId: motherAgent.id,
        responseTimeMs: durationMs,
        success: false,
        errorMessage,
        toolName: 'mother-chat',
      },
    }).catch(() => {});
    await prisma.agent.update({ where: { id: motherAgent.id }, data: { status: 'ERROR' } }).catch(() => {});

    emitMotherChatEvent({
      io: options.io,
      organizationId: options.organizationId,
      boardId: boardScope?.id ?? null,
      nexusSessionId: chatSession.id,
      codexSessionId: existingCodexSessionId,
      requestId: options.requestId,
      event: { type: 'error', content: errorMessage },
    });
    throw err;
  }
}
