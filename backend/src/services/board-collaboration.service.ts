import type { Agent, Board, Message, Task, Thread } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import * as activityService from './activity.service.js';
import * as agentService from './agent.service.js';

type AgentInput = {
  agentId?: string;
  name?: string;
  displayName?: string;
  role?: string;
  work?: string;
  avatar?: string;
  isLead?: boolean;
};

export type StartBoardCollaborationInput = {
  goal?: string;
  agents?: AgentInput[];
};

export type DispatchBoardTaskInput = {
  query?: string;
  message?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
};

type BoardCollaborationAgent = Agent & {
  assignedWork: string;
  collaborationRole: string;
};

function toSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function defaultAgentInputs(board: Pick<Board, 'slug'>): Required<Pick<AgentInput, 'name' | 'displayName' | 'role' | 'work' | 'avatar'>>[] {
  return [
    {
      name: `${board.slug}-backend-ops`,
      displayName: 'Backend Ops Engineer',
      role: 'Backend operations',
      work: 'Check backend health, database state, Codex CLI runtime, sessions, and API blockers.',
      avatar: 'B',
    },
    {
      name: `${board.slug}-frontend-qa`,
      displayName: 'Frontend QA Engineer',
      role: 'Frontend QA',
      work: 'Test login, production group UI, scoped Mother Chat, sub-agent creation, and visible layout issues.',
      avatar: 'Q',
    },
  ];
}

function normalizeAgentInputs(board: Pick<Board, 'slug'>, data: StartBoardCollaborationInput): AgentInput[] {
  const defaults = defaultAgentInputs(board);
  const provided = Array.isArray(data.agents) ? data.agents.slice(0, 2) : [];
  return [0, 1].map(index => {
    const item = provided[index] ?? {};
    const fallback = defaults[index];
    return {
      agentId: item.agentId,
      name: item.name || fallback.name,
      displayName: item.displayName || fallback.displayName,
      role: item.role || fallback.role,
      work: item.work || fallback.work,
      avatar: item.avatar || fallback.avatar,
      isLead: item.isLead ?? index === 0,
    };
  });
}

async function resolveCollaborationAgent(
  organizationId: string,
  boardId: string,
  input: AgentInput,
): Promise<BoardCollaborationAgent> {
  const displayName = input.displayName?.trim() || 'Production Agent';
  const role = input.role?.trim() || 'Production operator';
  const work = input.work?.trim() || 'Coordinate on the production goal and report blockers.';
  let agent: Agent | null = null;

  if (input.agentId) {
    agent = await prisma.agent.findFirst({
      where: { id: input.agentId, organizationId },
    });
    if (!agent) {
      const err = new Error(`Agent not found: ${input.agentId}`) as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    }
  } else {
    const baseName = toSlug(input.name || displayName);
    const name = baseName || `production-agent-${Date.now()}`;
    agent = await prisma.agent.findUnique({
      where: { organizationId_name: { organizationId, name } },
    });

    if (!agent) {
      agent = await agentService.createAgent(organizationId, {
        name,
        displayName,
        description: role,
        avatar: input.avatar,
        heartbeatInterval: 30,
        enabled: true,
        identityProfile: {
          collaborationRole: role,
          source: 'production-a2a-starter',
        },
        soulMd: `You are ${displayName}. Role: ${role}. Current production work: ${work}`,
      });
    }
  }

  const updated = await prisma.agent.update({
    where: { id: agent.id, organizationId },
    data: {
      boardId,
      isBoardLead: input.isLead ?? false,
      agentToAgent: true,
      status: 'ONLINE',
      currentTask: work,
      description: agent.description || role,
      updatedAt: new Date(),
    },
  });

  return {
    ...updated,
    assignedWork: work,
    collaborationRole: role,
  };
}

function collaborationMetadata(options: {
  board: Pick<Board, 'id' | 'name'>;
  thread: Pick<Thread, 'id'>;
  goal: string;
  tasks: Task[];
}) {
  return {
    runtime: 'local-orchestration',
    conversationKind: 'agent_agent',
    edgeSemantic: 'agent_to_agent',
    boardId: options.board.id,
    boardName: options.board.name,
    collaborationId: options.thread.id,
    goal: options.goal,
    taskIds: options.tasks.map(task => task.id),
    source: 'production_a2a_start',
  };
}

function dispatchMetadata(options: {
  board: Pick<Board, 'id' | 'name'>;
  thread: Pick<Thread, 'id'>;
  query: string;
  tasks: Task[];
  agents: Agent[];
}) {
  return {
    runtime: 'local-orchestration',
    conversationKind: 'agent_agent',
    edgeSemantic: 'agent_to_agent',
    boardId: options.board.id,
    boardName: options.board.name,
    dispatchId: options.thread.id,
    query: options.query,
    taskIds: options.tasks.map(task => task.id),
    assignedAgentIds: options.agents.map(agent => agent.id),
    source: 'production_task_dispatch',
  };
}

export async function startBoardAgentCollaboration(
  organizationId: string,
  boardId: string,
  data: StartBoardCollaborationInput,
): Promise<{
  board: Board;
  goal: string;
  agents: BoardCollaborationAgent[];
  tasks: Task[];
  thread: Thread;
  messages: Message[];
}> {
  const board = await prisma.board.findFirst({
    where: { id: boardId, organizationId },
  });
  if (!board) {
    const err = new Error('Board not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const goal = data.goal?.trim()
    || board.objective?.trim()
    || `Complete the production goal for ${board.name} and report readiness.`;
  const agentInputs = normalizeAgentInputs(board, data);
  const agents = [
    await resolveCollaborationAgent(organizationId, board.id, agentInputs[0]),
    await resolveCollaborationAgent(organizationId, board.id, agentInputs[1]),
  ];

  const tasks = await Promise.all(agents.map(agent => prisma.task.create({
    data: {
      organizationId,
      boardId: board.id,
      agentId: agent.id,
      title: agent.assignedWork.slice(0, 180),
      description: `Goal: ${goal}\n\nRole: ${agent.collaborationRole}`,
      status: 'IN_PROGRESS',
      priority: 'HIGH',
    },
  })));

  const thread = await prisma.thread.create({
    data: {
      organizationId,
      title: `${board.name}: ${agents[0].displayName} ↔ ${agents[1].displayName}`,
    },
  });
  const metadata = collaborationMetadata({ board, thread, goal, tasks });

  const messages = [
    await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: agents[0].id,
        receiverId: agents[1].id,
        content: [
          `Goal: ${goal}`,
          '',
          `My assigned work: ${agents[0].assignedWork}`,
          `${agents[1].displayName}, please handle: ${agents[1].assignedWork}`,
          'Share blockers, status, and anything Mother Chat should know.',
        ].join('\n'),
        metadata: {
          ...metadata,
          role: 'agent',
          direction: 'opening',
        } as any,
      },
    }),
    await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: agents[1].id,
        receiverId: agents[0].id,
        content: [
          `Acknowledged. I will handle: ${agents[1].assignedWork}`,
          '',
          `I need ${agents[0].displayName} to cover: ${agents[0].assignedWork}`,
          'First checkpoint: compare findings, list blockers, and prepare a readiness summary for Mother Chat.',
        ].join('\n'),
        metadata: {
          ...metadata,
          role: 'agent',
          direction: 'reply',
        } as any,
      },
    }),
    await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: agents[0].id,
        receiverId: agents[1].id,
        content: `Checkpoint agreed. We will keep this conversation inside ${board.name} and report against task IDs: ${tasks.map(task => task.id).join(', ')}.`,
        metadata: {
          ...metadata,
          role: 'agent',
          direction: 'checkpoint',
        } as any,
      },
    }),
  ];

  await prisma.thread.update({
    where: { id: thread.id },
    data: { updatedAt: new Date() },
  });

  await Promise.all(agents.map((agent, index) => activityService.createActivity(organizationId, {
    agentId: agent.id,
    type: 'MESSAGE',
    message: `${agent.displayName} started A2A work in ${board.name}`,
    metadata: {
      ...metadata,
      peerAgentId: agents[index === 0 ? 1 : 0].id,
      assignedWork: agent.assignedWork,
    },
  })));

  await prisma.boardMemory.create({
    data: {
      boardId: board.id,
      content: `A2A collaboration started. Goal: ${goal}. ${agents[0].displayName}: ${agents[0].assignedWork}. ${agents[1].displayName}: ${agents[1].assignedWork}.`,
      tags: ['a2a', 'collaboration', 'mother-chat'] as any,
      isChat: true,
      source: 'production_a2a_start',
    },
  }).catch(() => {});

  return { board, goal, agents, tasks, thread, messages };
}

export async function dispatchBoardTaskToAgents(
  organizationId: string,
  boardId: string,
  data: DispatchBoardTaskInput,
): Promise<{
  board: Board;
  query: string;
  agents: Agent[];
  tasks: Task[];
  thread: Thread;
  messages: Message[];
}> {
  const query = (data.query || data.message || '').trim();
  if (!query) {
    const err = new Error('query is required') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  const board = await prisma.board.findFirst({
    where: { id: boardId, organizationId },
  });
  if (!board) {
    const err = new Error('Board not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const agents = await prisma.agent.findMany({
    where: {
      organizationId,
      boardId: board.id,
      enabled: true,
      name: { notIn: ['__mother_chat__', '__admin__'] },
    },
    orderBy: [
      { isBoardLead: 'desc' },
      { displayName: 'asc' },
    ],
  });

  if (agents.length === 0) {
    const err = new Error('No enabled agents found in this production group') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  const priority = data.priority || 'HIGH';
  const thread = await prisma.thread.create({
    data: {
      organizationId,
      title: `${board.name}: Assign all agents`,
    },
  });

  const tasks = await Promise.all(agents.map(agent => prisma.task.create({
    data: {
      organizationId,
      boardId: board.id,
      agentId: agent.id,
      title: query.slice(0, 180),
      description: [
        `Group dispatch query: ${query}`,
        '',
        `Assigned to: ${agent.displayName}`,
        `Production group: ${board.name}`,
        'Status: assigned from Mother Chat control plane so no enabled agent remains idle.',
      ].join('\n'),
      status: 'IN_PROGRESS',
      priority,
    },
  })));

  const metadata = dispatchMetadata({ board, thread, query, tasks, agents });
  const coordinator = agents.find(agent => agent.isBoardLead) || agents[0];

  await Promise.all(agents.map(agent => prisma.agent.update({
    where: { id: agent.id, organizationId },
    data: {
      status: 'ONLINE',
      agentToAgent: true,
      currentTask: query,
      updatedAt: new Date(),
    },
  })));

  const messages = await Promise.all(agents.map(agent => {
    const task = tasks.find(item => item.agentId === agent.id);
    const isCoordinator = agent.id === coordinator.id;
    return prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: isCoordinator && agents.length > 1 ? agents.find(item => item.id !== coordinator.id)!.id : coordinator.id,
        receiverId: agent.id,
        content: [
          `Assigned query: ${query}`,
          `Agent: ${agent.displayName}`,
          `Task ID: ${task?.id || 'pending'}`,
          'Acknowledge the task, work in this production group, and keep Mother Chat audit-ready.',
        ].join('\n'),
        metadata: {
          ...metadata,
          role: 'agent',
          direction: 'dispatch',
          assignedAgentId: agent.id,
          assignedTaskId: task?.id ?? null,
        } as any,
      },
    });
  }));

  await prisma.thread.update({
    where: { id: thread.id },
    data: { updatedAt: new Date() },
  });

  await Promise.all(agents.map(agent => {
    const task = tasks.find(item => item.agentId === agent.id);
    return activityService.createActivity(organizationId, {
      agentId: agent.id,
      type: 'TASK_START',
      message: `${agent.displayName} assigned group query in ${board.name}`,
      metadata: {
        ...metadata,
        assignedTaskId: task?.id ?? null,
      },
    });
  }));

  await prisma.boardMemory.create({
    data: {
      boardId: board.id,
      content: `All-agent dispatch started. Query: ${query}. Agents assigned: ${agents.map(agent => agent.displayName).join(', ')}.`,
      tags: ['a2a', 'dispatch', 'mother-chat', 'all-agents'] as any,
      isChat: true,
      source: 'production_task_dispatch',
    },
  }).catch(() => {});

  return { board, query, agents, tasks, thread, messages };
}
