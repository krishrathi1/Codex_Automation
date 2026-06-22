import type { Agent, BlackboardEvent, BoardConversation } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { prisma } from '../lib/prisma.js';

export const LIVE_BLACKBOARD_SOURCE = 'live_blackboard';
export const LIVE_BLACKBOARD_MAX_AGENTS = 4;
export const LIVE_BLACKBOARD_DEFAULT_ROUNDS = 3;

type JsonRecord = Record<string, unknown>;

export type LiveBlackboardJobContext = {
  source: typeof LIVE_BLACKBOARD_SOURCE;
  conversationId: string;
  boardId: string;
  boardName: string;
  threadId: string;
  goal: string;
  round: number;
  maxRounds: number;
  agentIds: string[];
  taskIdsByAgentId: Record<string, string | null>;
};

export type BlackboardTurnContext = {
  conversation: {
    id: string;
    title: string;
    goal: string | null;
    status: string;
    currentRound: number;
    maxRounds: number;
  };
  currentAgent: {
    id: string;
    displayName: string;
    description: string;
  };
  participants: Array<{
    id: string;
    displayName: string;
    description: string;
    status: string;
  }>;
  newEvents: Array<ReturnType<typeof serializeBlackboardEvent>>;
  recentEvents: Array<ReturnType<typeof serializeBlackboardEvent>>;
  cursor: {
    lastSeenEventAt: string | null;
    turnsTaken: number;
  };
};

type BlackboardTraceJob = {
  id: string;
  agentId: string;
  agentName: string;
  status: string;
  round: number | null;
  prompt: string;
  reconstructedPrompt: string | null;
  output: string | null;
  summary: string | null;
  error: string | null;
  codexSessionId: string | null;
  nexusSessionId: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
};

type BlackboardTraceJobWithConversation = BlackboardTraceJob & {
  conversationId: string;
};

type BlackboardTraceEvent = ReturnType<typeof serializeBlackboardEvent> & {
  round: number | null;
  linkedJob: BlackboardTraceJob | null;
};

function objectRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function truncate(value: string | null | undefined, length = 900) {
  const text = value?.trim() || '';
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function serializeBlackboardEvent(event: BlackboardEvent & {
  senderAgent?: Pick<Agent, 'id' | 'displayName'> | null;
  receiverAgent?: Pick<Agent, 'id' | 'displayName'> | null;
}) {
  return {
    id: event.id,
    type: event.type,
    from: event.type === 'admin_task'
      ? 'Admin'
      : event.senderAgent?.displayName ?? (event.senderAgentId ? `Agent ${event.senderAgentId}` : 'Admin/System'),
    to: event.receiverAgent?.displayName ?? (event.receiverAgentId ? `Agent ${event.receiverAgentId}` : 'Group'),
    senderAgentId: event.senderAgentId,
    receiverAgentId: event.receiverAgentId,
    runJobId: event.runJobId,
    taskId: event.taskId,
    content: truncate(event.content, 900),
    metadata: objectRecord(event.metadata),
    createdAt: event.createdAt.toISOString(),
  };
}

export function getLiveBlackboardJobContext(value: unknown): LiveBlackboardJobContext | null {
  let context = objectRecord(value);
  for (let depth = 0; depth < 5 && context.source !== LIVE_BLACKBOARD_SOURCE; depth += 1) {
    context = objectRecord(context.sourceContext);
  }
  if (context.source !== LIVE_BLACKBOARD_SOURCE) return null;

  const conversationId = stringValue(context.conversationId);
  const boardId = stringValue(context.boardId);
  const boardName = stringValue(context.boardName) || 'Production group';
  const threadId = stringValue(context.threadId);
  const goal = stringValue(context.goal) || '';
  const round = numberValue(context.round);
  const maxRounds = numberValue(context.maxRounds) || LIVE_BLACKBOARD_DEFAULT_ROUNDS;
  const agentIds = stringArray(context.agentIds).slice(0, LIVE_BLACKBOARD_MAX_AGENTS);
  const taskIdsByAgentId = objectRecord(context.taskIdsByAgentId);

  if (!conversationId || !boardId || !threadId || round === undefined || agentIds.length === 0) {
    return null;
  }

  return {
    source: LIVE_BLACKBOARD_SOURCE,
    conversationId,
    boardId,
    boardName,
    threadId,
    goal,
    round,
    maxRounds,
    agentIds,
    taskIdsByAgentId: Object.fromEntries(
      Object.entries(taskIdsByAgentId).map(([agentId, taskId]) => [
        agentId,
        typeof taskId === 'string' ? taskId : null,
      ]),
    ),
  };
}

export function liveBlackboardCompletionSignal(text: string) {
  return /\b(FINAL_DECISION|CONSENSUS_REACHED|TASK_COMPLETE|WORKFLOW_COMPLETE)\b/i.test(text);
}

export async function createBoardConversation(input: {
  organizationId: string;
  boardId: string;
  threadId: string;
  title: string;
  goal: string;
  maxRounds?: number;
  agents: Array<Pick<Agent, 'id' | 'displayName'>>;
  metadata?: JsonRecord;
}) {
  const maxRounds = Math.max(1, Math.min(input.maxRounds || LIVE_BLACKBOARD_DEFAULT_ROUNDS, 8));
  const conversation = await prisma.boardConversation.create({
    data: {
      organizationId: input.organizationId,
      boardId: input.boardId,
      threadId: input.threadId,
      title: input.title,
      goal: input.goal,
      maxRounds,
      metadata: {
        ...(input.metadata ?? {}),
        agentIds: input.agents.slice(0, LIVE_BLACKBOARD_MAX_AGENTS).map(agent => agent.id),
      } as any,
    },
  });

  await Promise.all(input.agents.slice(0, LIVE_BLACKBOARD_MAX_AGENTS).map(agent => (
    prisma.agentConversationCursor.upsert({
      where: {
        conversationId_agentId: {
          conversationId: conversation.id,
          agentId: agent.id,
        },
      },
      create: {
        organizationId: input.organizationId,
        boardId: input.boardId,
        conversationId: conversation.id,
        agentId: agent.id,
      },
      update: {},
    })
  )));

  return conversation;
}

export async function postBlackboardEvent(input: {
  organizationId: string;
  boardId: string;
  conversationId: string;
  senderAgentId?: string | null;
  receiverAgentId?: string | null;
  runJobId?: string | null;
  taskId?: string | null;
  type: string;
  content: string;
  metadata?: JsonRecord;
  io?: SocketIOServer;
}) {
  const event = await prisma.$transaction(async (tx) => {
    if (input.runJobId) {
      const existing = await tx.blackboardEvent.findFirst({
        where: {
          conversationId: input.conversationId,
          runJobId: input.runJobId,
          type: input.type,
        },
      });
      if (existing) return existing as BlackboardEvent;
    }

    return tx.blackboardEvent.create({
      data: {
        organizationId: input.organizationId,
        boardId: input.boardId,
        conversationId: input.conversationId,
        senderAgentId: input.senderAgentId ?? null,
        receiverAgentId: input.receiverAgentId ?? null,
        runJobId: input.runJobId ?? null,
        taskId: input.taskId ?? null,
        type: input.type,
        content: input.content,
        metadata: input.metadata as any,
      },
    });
  });

  input.io?.to(`org:${input.organizationId}`).emit('blackboard:event', {
    ...event,
    timestamp: new Date().toISOString(),
  });

  return event;
}

export async function buildBlackboardTurnContext(input: {
  organizationId: string;
  boardId: string;
  conversationId: string;
  agentId: string;
}) {
  const [conversation, cursor, currentAgent, participants, events] = await Promise.all([
    prisma.boardConversation.findFirst({
      where: {
        id: input.conversationId,
        organizationId: input.organizationId,
        boardId: input.boardId,
      },
    }),
    prisma.agentConversationCursor.findUnique({
      where: {
        conversationId_agentId: {
          conversationId: input.conversationId,
          agentId: input.agentId,
        },
      },
    }),
    prisma.agent.findFirst({
      where: {
        id: input.agentId,
        organizationId: input.organizationId,
      },
      select: { id: true, displayName: true, description: true },
    }),
    prisma.agent.findMany({
      where: {
        organizationId: input.organizationId,
        boardId: input.boardId,
        enabled: true,
        name: { notIn: ['__mother_chat__', '__admin__'] },
      },
      orderBy: [
        { isBoardLead: 'desc' },
        { displayName: 'asc' },
      ],
      take: LIVE_BLACKBOARD_MAX_AGENTS,
      select: { id: true, displayName: true, description: true, status: true },
    }),
    prisma.blackboardEvent.findMany({
      where: {
        organizationId: input.organizationId,
        boardId: input.boardId,
        conversationId: input.conversationId,
      },
      orderBy: { createdAt: 'desc' },
      take: 80,
    }),
  ]);

  if (!conversation || !currentAgent) return null;

  const ascendingEvents = events.reverse();
  const newEvents = ascendingEvents.filter(event => {
    if (event.senderAgentId === input.agentId) return false;
    if (!cursor?.lastSeenEventAt) return true;
    return event.createdAt > cursor.lastSeenEventAt;
  });

  return {
    conversation: {
      id: conversation.id,
      title: conversation.title,
      goal: conversation.goal,
      status: conversation.status,
      currentRound: conversation.currentRound,
      maxRounds: conversation.maxRounds,
    },
    currentAgent,
    participants,
    newEvents: newEvents.map(serializeBlackboardEvent),
    recentEvents: ascendingEvents.slice(-40).map(serializeBlackboardEvent),
    cursor: {
      lastSeenEventAt: cursor?.lastSeenEventAt?.toISOString() ?? null,
      turnsTaken: cursor?.turnsTaken ?? 0,
    },
  } satisfies BlackboardTurnContext;
}

export function composeBlackboardAgentPrompt(turnContext: BlackboardTurnContext, assignedPrompt: string) {
  const newEventRows = turnContext.newEvents.length > 0
    ? turnContext.newEvents.map(event => `- ${event.createdAt} ${event.from} -> ${event.to}: ${event.content}`)
    : ['- No unseen peer events. Make progress from the group goal and recent context.'];
  const recentRows = turnContext.recentEvents.map(event => `- ${event.createdAt} ${event.from} -> ${event.to}: ${event.content}`);

  return [
    `You are Nexus production sub-agent "${turnContext.currentAgent.displayName}".`,
    `Your role: ${turnContext.currentAgent.description || 'Production sub-agent'}.`,
    'You are participating in a live group blackboard conversation through the local Claude CLI only.',
    'Speak only as your assigned agent. Do not impersonate all agents.',
    'Reply to the unseen peer events first. Ask a direct question, answer a direct question, challenge a claim, or hand off the next concrete step.',
    'Keep this turn concise and audit-ready. Include evidence, blocker, next action, and who should respond next when useful.',
    'If the group has truly reached a conclusion, include the exact marker FINAL_DECISION with the decision and tradeoffs.',
    'Do not ask for API keys directly. Use only local Nexus context and the Claude CLI authentication.',
    '',
    `Conversation: ${turnContext.conversation.title}`,
    `Goal: ${turnContext.conversation.goal || assignedPrompt}`,
    `Round: ${turnContext.conversation.currentRound + 1}/${turnContext.conversation.maxRounds}`,
    `Your previous turns in this conversation: ${turnContext.cursor.turnsTaken}`,
    '',
    'Participants',
    ...turnContext.participants.map(agent => `- ${agent.displayName}: ${agent.description || 'Production sub-agent'} (${agent.status})`),
    '',
    'UNSEEN BLACKBOARD EVENTS',
    ...newEventRows,
    '',
    'RECENT BLACKBOARD CONTEXT',
    ...(recentRows.length > 0 ? recentRows : ['- None yet']),
    '',
    'ASSIGNED TASK',
    assignedPrompt,
  ].join('\n');
}

export async function markBlackboardCursorSeen(input: {
  organizationId: string;
  boardId: string;
  conversationId: string;
  agentId: string;
}) {
  const latestEvent = await prisma.blackboardEvent.findFirst({
    where: {
      organizationId: input.organizationId,
      boardId: input.boardId,
      conversationId: input.conversationId,
    },
    orderBy: { createdAt: 'desc' },
  });

  await prisma.agentConversationCursor.upsert({
    where: {
      conversationId_agentId: {
        conversationId: input.conversationId,
        agentId: input.agentId,
      },
    },
    create: {
      organizationId: input.organizationId,
      boardId: input.boardId,
      conversationId: input.conversationId,
      agentId: input.agentId,
      lastSeenEventAt: latestEvent?.createdAt ?? null,
      lastSeenEventId: latestEvent?.id ?? null,
      turnsTaken: 1,
    },
    update: {
      lastSeenEventAt: latestEvent?.createdAt ?? null,
      lastSeenEventId: latestEvent?.id ?? null,
      turnsTaken: { increment: 1 },
    },
  });
}

export async function upsertAgentRuntimeSession(input: {
  organizationId: string;
  boardId: string;
  agentId: string;
  codexSessionId?: string | null;
  status: string;
  metadata?: JsonRecord;
}) {
  return prisma.agentRuntimeSession.upsert({
    where: {
      boardId_agentId: {
        boardId: input.boardId,
        agentId: input.agentId,
      },
    },
    create: {
      organizationId: input.organizationId,
      boardId: input.boardId,
      agentId: input.agentId,
      codexSessionId: input.codexSessionId ?? null,
      status: input.status,
      lastUsedAt: new Date(),
      metadata: input.metadata as any,
    },
    update: {
      ...(input.codexSessionId && { codexSessionId: input.codexSessionId }),
      status: input.status,
      lastUsedAt: new Date(),
      metadata: input.metadata as any,
    },
  });
}

export async function getRecentBlackboardEventsForMotherChat(organizationId: string, boardId?: string) {
  return prisma.blackboardEvent.findMany({
    where: {
      organizationId,
      ...(boardId && { boardId }),
    },
    orderBy: { createdAt: 'desc' },
    take: boardId ? 60 : 25,
  });
}

export async function getActiveBoardConversationsForMotherChat(organizationId: string, boardId?: string) {
  return prisma.boardConversation.findMany({
    where: {
      organizationId,
      ...(boardId && { boardId }),
    },
    orderBy: { updatedAt: 'desc' },
    take: boardId ? 10 : 5,
  });
}

export function serializeMotherChatBlackboardEvent(event: BlackboardEvent) {
  return serializeBlackboardEvent(event);
}

export async function getBoardLiveBlackboardTrace(organizationId: string, boardId: string, conversationId?: string) {
  const board = await prisma.board.findFirst({
    where: {
      id: boardId,
      organizationId,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      objective: true,
      maxAgents: true,
    },
  });
  if (!board) {
    const err = new Error('Board not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const conversations = await prisma.boardConversation.findMany({
    where: {
      organizationId,
      boardId,
      ...(conversationId && { id: conversationId }),
    },
    orderBy: { createdAt: 'desc' },
    take: conversationId ? 1 : 10,
  });
  const conversationIds = conversations.map(conversation => conversation.id);
  const threadIds = conversations
    .map(conversation => conversation.threadId)
    .filter((threadId): threadId is string => Boolean(threadId));

  const [events, jobs, agents] = await Promise.all([
    conversationIds.length > 0
      ? prisma.blackboardEvent.findMany({
          where: {
            organizationId,
            boardId,
            conversationId: { in: conversationIds },
          },
          orderBy: { createdAt: 'asc' },
        })
      : Promise.resolve([]),
    threadIds.length > 0
      ? prisma.agentRunJob.findMany({
          where: {
            organizationId,
            boardId,
            threadId: { in: threadIds },
          },
          orderBy: { queuedAt: 'asc' },
          include: {
            agent: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    prisma.agent.findMany({
      where: { organizationId, boardId },
      select: {
        id: true,
        displayName: true,
        description: true,
        status: true,
        isBoardLead: true,
      },
      orderBy: [
        { isBoardLead: 'desc' },
        { displayName: 'asc' },
      ],
    }),
  ]);

  const agentNameById = new Map(agents.map(agent => [agent.id, agent.displayName]));
  const traceJobs = jobs.reduce<BlackboardTraceJobWithConversation[]>((rows, job) => {
      const liveContext = getLiveBlackboardJobContext(job.contextPacket);
      if (!liveContext || !conversationIds.includes(liveContext.conversationId)) return rows;
      const expandedPacket = objectRecord(job.contextPacket);
      const turnContext = objectRecord(expandedPacket.liveBlackboard) as BlackboardTurnContext;
      const reconstructedPrompt = turnContext?.conversation
        ? composeBlackboardAgentPrompt(turnContext, job.prompt)
        : null;
      rows.push({
        id: job.id,
        conversationId: liveContext.conversationId,
        agentId: job.agentId,
        agentName: job.agent.displayName,
        status: job.status,
        round: liveContext.round,
        prompt: job.prompt,
        reconstructedPrompt,
        output: job.output,
        summary: job.summary,
        error: job.error,
        codexSessionId: job.codexSessionId,
        nexusSessionId: job.nexusSessionId,
        queuedAt: job.queuedAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        completedAt: job.completedAt?.toISOString() ?? null,
        durationMs: job.durationMs,
      });
      return rows;
    }, []);

  const participantAgentIds = new Set<string>();
  for (const job of traceJobs) participantAgentIds.add(job.agentId);
  for (const event of events) {
    if (event.senderAgentId) participantAgentIds.add(event.senderAgentId);
    if (event.receiverAgentId) participantAgentIds.add(event.receiverAgentId);
  }
  const traceAgents = participantAgentIds.size > 0
    ? agents.filter(agent => participantAgentIds.has(agent.id))
    : agents;

  const jobById = new Map(traceJobs.map(job => [job.id, job]));
  const eventsByConversationId = new Map<string, BlackboardTraceEvent[]>();
  for (const event of events) {
    const serialized = serializeBlackboardEvent({
      ...event,
      senderAgent: event.senderAgentId ? { id: event.senderAgentId, displayName: agentNameById.get(event.senderAgentId) || 'Agent' } : null,
      receiverAgent: event.receiverAgentId ? { id: event.receiverAgentId, displayName: agentNameById.get(event.receiverAgentId) || 'Agent' } : null,
    });
    const metadata = objectRecord(event.metadata);
    const traceEvent = {
      ...serialized,
      round: numberValue(metadata.round) ?? null,
      linkedJob: event.runJobId ? jobById.get(event.runJobId) ?? null : null,
    };
    const rows = eventsByConversationId.get(event.conversationId) ?? [];
    rows.push(traceEvent);
    eventsByConversationId.set(event.conversationId, rows);
  }

  const jobsByConversationId = new Map<string, BlackboardTraceJob[]>();
  for (const job of traceJobs) {
    const rows = jobsByConversationId.get(job.conversationId) ?? [];
    const { conversationId: _conversationId, ...jobWithoutConversation } = job;
    rows.push(jobWithoutConversation);
    jobsByConversationId.set(job.conversationId, rows);
  }

  return {
    generatedAt: new Date().toISOString(),
    board,
    agents: traceAgents.map(agent => ({
      id: agent.id,
      displayName: agent.displayName,
      description: agent.description,
      status: agent.status,
      isBoardLead: agent.isBoardLead,
    })),
    conversations: conversations.map(conversation => {
      const conversationEvents = eventsByConversationId.get(conversation.id) ?? [];
      const conversationJobs = jobsByConversationId.get(conversation.id) ?? [];
      const roundNumbers = [
        ...conversationEvents.map(event => event.round).filter((round): round is number => typeof round === 'number'),
        ...conversationJobs.map(job => job.round).filter((round): round is number => typeof round === 'number'),
      ];
      const maxObservedRound = roundNumbers.length > 0 ? Math.max(...roundNumbers) : 0;
      return {
        id: conversation.id,
        title: conversation.title,
        goal: conversation.goal,
        status: conversation.status,
        currentRound: conversation.currentRound,
        maxRounds: conversation.maxRounds,
        maxObservedRound,
        completedReason: conversation.completedReason,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
        events: conversationEvents,
        jobs: conversationJobs,
      };
    }),
  };
}

export async function finishBoardConversation(input: {
  organizationId: string;
  boardId: string;
  conversationId: string;
  reason: string;
  io?: SocketIOServer;
}) {
  const conversation = await prisma.boardConversation.update({
    where: { id: input.conversationId },
    data: {
      status: 'COMPLETED',
      completedReason: input.reason,
      updatedAt: new Date(),
    },
  });
  input.io?.to(`org:${input.organizationId}`).emit('blackboard:conversationCompleted', {
    conversation,
    boardId: input.boardId,
    timestamp: new Date().toISOString(),
  });
  return conversation;
}

export async function advanceBoardConversationRound(input: {
  conversationId: string;
  expectedCurrentRound: number;
}) {
  return prisma.boardConversation.updateMany({
    where: {
      id: input.conversationId,
      status: 'RUNNING',
      currentRound: input.expectedCurrentRound,
    },
    data: {
      currentRound: { increment: 1 },
      updatedAt: new Date(),
    },
  });
}
