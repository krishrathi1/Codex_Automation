import { randomUUID } from 'crypto';
import type { Agent, AgentRunJob, Board, Message, Task, Thread } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import * as activityService from './activity.service.js';
import * as agentService from './agent.service.js';
import { enqueueBoardAgentRunJobs, enqueueLiveAgentWorkflowInitialJob, enqueueLiveBlackboardRoundJobs } from './agent-run-queue.service.js';
import { getOrCreateAdminAgent } from './system-agent.service.js';
import { LIVE_BLACKBOARD_DEFAULT_ROUNDS, LIVE_BLACKBOARD_MAX_AGENTS, createBoardConversation, postBlackboardEvent } from './blackboard.service.js';

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

export type StartLiveAgentWorkflowInput = {
  goal?: string;
  trigger?: string;
  agents?: AgentInput[];
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
};

export type StartLiveBlackboardInput = {
  goal?: string;
  trigger?: string;
  query?: string;
  agents?: AgentInput[];
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  maxRounds?: number;
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

function defaultLiveWorkflowAgentInputs(board: Pick<Board, 'slug'>): Required<Pick<AgentInput, 'name' | 'displayName' | 'role' | 'work' | 'avatar'>>[] {
  return [
    {
      name: `${board.slug}-log-intake`,
      displayName: 'Log Intake Agent',
      role: 'Runtime log intake',
      work: 'Read the incoming error/event log, extract symptoms, affected files/routes, severity, and hand off a compact incident packet.',
      avatar: 'L',
    },
    {
      name: `${board.slug}-diagnosis-planner`,
      displayName: 'Diagnosis Planner',
      role: 'Root-cause analysis',
      work: 'Read the incident packet, inspect context, identify likely root cause, and hand off a concrete implementation approach.',
      avatar: 'D',
    },
    {
      name: `${board.slug}-code-fix-engineer`,
      displayName: 'Code Fix Engineer',
      role: 'Implementation',
      work: 'Apply the smallest code change that matches the codebase language and existing patterns, then hand off files changed and rationale.',
      avatar: 'C',
    },
    {
      name: `${board.slug}-verification-agent`,
      displayName: 'Verification Agent',
      role: 'Verification and tests',
      work: 'Run focused checks/tests/builds, verify the fix, capture failures, and hand off evidence with pass/fail status.',
      avatar: 'V',
    },
    {
      name: `${board.slug}-release-steward`,
      displayName: 'Release Steward',
      role: 'Release and audit',
      work: 'Review the verification evidence, prepare final audit notes, and only commit/push when the initiating task explicitly allows it.',
      avatar: 'R',
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

function normalizeLiveAgentInputs(board: Pick<Board, 'slug'>, data: StartLiveAgentWorkflowInput, existingAgents: Agent[]): AgentInput[] {
  if (Array.isArray(data.agents) && data.agents.length > 0) {
    const defaults = defaultLiveWorkflowAgentInputs(board);
    return data.agents.slice(0, 8).map((item, index) => {
      const fallback = defaults[index] ?? defaults[defaults.length - 1];
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

  if (existingAgents.length > 0) {
    return existingAgents.slice(0, 8).map((agent, index) => ({
      agentId: agent.id,
      name: agent.name,
      displayName: agent.displayName,
      role: agent.description,
      work: agent.currentTask || agent.description || `Continue live workflow stage ${index + 1}.`,
      avatar: agent.avatar || String(index + 1),
      isLead: index === 0 ? true : agent.isBoardLead,
    }));
  }

  return defaultLiveWorkflowAgentInputs(board).map((agent, index) => ({
    ...agent,
    isLead: index === 0,
  }));
}

function normalizeLiveBlackboardAgentInputs(board: Pick<Board, 'slug'>, data: StartLiveBlackboardInput, existingAgents: Agent[]): AgentInput[] {
  if (Array.isArray(data.agents) && data.agents.length > 0) {
    const defaults = defaultLiveWorkflowAgentInputs(board);
    return data.agents.slice(0, LIVE_BLACKBOARD_MAX_AGENTS).map((item, index) => {
      const fallback = defaults[index] ?? defaults[defaults.length - 1];
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

  if (existingAgents.length > 0) {
    return existingAgents.slice(0, LIVE_BLACKBOARD_MAX_AGENTS).map((agent, index) => ({
      agentId: agent.id,
      name: agent.name,
      displayName: agent.displayName,
      role: agent.description,
      work: agent.currentTask || agent.description || `Continue live blackboard turn ${index + 1}.`,
      avatar: agent.avatar || String(index + 1),
      isLead: index === 0 ? true : agent.isBoardLead,
    }));
  }

  return defaultLiveWorkflowAgentInputs(board).slice(0, LIVE_BLACKBOARD_MAX_AGENTS).map((agent, index) => ({
    ...agent,
    isLead: index === 0,
  }));
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
  runJobs: AgentRunJob[];
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

  const runJobs = await enqueueBoardAgentRunJobs({
    organizationId,
    board,
    query,
    agents,
    tasks,
    thread,
  });

  return { board, query, agents, tasks, thread, messages, runJobs };
}

export async function startLiveAgentWorkflow(
  organizationId: string,
  boardId: string,
  data: StartLiveAgentWorkflowInput,
): Promise<{
  board: Board;
  workflowId: string;
  goal: string;
  trigger: string;
  agents: BoardCollaborationAgent[];
  tasks: Task[];
  thread: Thread;
  messages: Message[];
  runJobs: AgentRunJob[];
}> {
  const board = await prisma.board.findFirst({
    where: { id: boardId, organizationId },
  });
  if (!board) {
    const err = new Error('Board not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const existingAgents = await prisma.agent.findMany({
    where: {
      organizationId,
      boardId: board.id,
      enabled: true,
      name: { notIn: ['__mother_chat__', '__admin__'] },
    },
    orderBy: [
      { isBoardLead: 'desc' },
      { createdAt: 'asc' },
    ],
  });

  const goal = data.goal?.trim()
    || board.objective?.trim()
    || `Run a live agent-to-agent workflow for ${board.name}.`;
  const trigger = data.trigger?.trim() || goal;
  const workflowId = randomUUID();
  const agentInputs = normalizeLiveAgentInputs(board, data, existingAgents);
  const agents = await Promise.all(agentInputs.map(input => (
    resolveCollaborationAgent(organizationId, board.id, input)
  )));

  await Promise.all(agents.map((agent, index) => prisma.agent.update({
    where: { id: agent.id, organizationId },
    data: {
      status: index === 0 ? 'ONLINE' : 'IDLE',
      currentTask: index === 0 ? agent.assignedWork : null,
      isBoardLead: index === 0,
      agentToAgent: true,
      updatedAt: new Date(),
    },
  })));

  const priority = data.priority || 'HIGH';
  const tasks = await Promise.all(agents.map((agent, index) => prisma.task.create({
    data: {
      organizationId,
      boardId: board.id,
      agentId: agent.id,
      title: agent.assignedWork.slice(0, 180),
      description: [
        `Live workflow: ${goal}`,
        `Trigger: ${trigger}`,
        '',
        `Stage ${index + 1}/${agents.length}: ${agent.displayName}`,
        `Role: ${agent.collaborationRole}`,
      ].join('\n'),
      status: index === 0 ? 'IN_PROGRESS' : 'ASSIGNED',
      priority,
    },
  })));

  const thread = await prisma.thread.create({
    data: {
      organizationId,
      title: `${board.name}: live workflow ${workflowId}`,
    },
  });
  const adminAgent = await getOrCreateAdminAgent(organizationId);
  const firstAgent = agents[0];
  const messages = firstAgent ? [
    await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: adminAgent.id,
        receiverId: firstAgent.id,
        content: [
          `Live workflow started: ${goal}`,
          '',
          `Trigger/event: ${trigger}`,
          '',
          `First stage: ${firstAgent.displayName}`,
          `Expected chain: ${agents.map(agent => agent.displayName).join(' -> ')}`,
        ].join('\n'),
        metadata: {
          runtime: 'local-orchestration',
          conversationKind: 'admin_agent',
          edgeSemantic: 'admin_to_agent',
          boardId: board.id,
          boardName: board.name,
          workflowId,
          workflowStepIndex: 0,
          taskIds: tasks.map(task => task.id),
          source: 'live_agent_workflow',
        } as any,
      },
    }),
  ] : [];

  await prisma.thread.update({
    where: { id: thread.id },
    data: { updatedAt: new Date() },
  });

  const runJob = await enqueueLiveAgentWorkflowInitialJob({
    organizationId,
    board,
    goal,
    trigger,
    workflowId,
    agents,
    tasks,
    thread,
  });

  await prisma.boardMemory.create({
    data: {
      boardId: board.id,
      content: `Live workflow ${workflowId} started. Goal: ${goal}. Chain: ${agents.map(agent => agent.displayName).join(' -> ')}.`,
      tags: ['live-workflow', 'agent-agent', 'mother-chat', 'started'] as any,
      isChat: true,
      source: 'live_agent_workflow',
    },
  }).catch(() => {});

  return {
    board,
    workflowId,
    goal,
    trigger,
    agents,
    tasks,
    thread,
    messages,
    runJobs: runJob ? [runJob] : [],
  };
}

export async function startLiveBlackboardConversation(
  organizationId: string,
  boardId: string,
  data: StartLiveBlackboardInput,
): Promise<{
  board: Board;
  conversationId: string;
  goal: string;
  trigger: string;
  agents: BoardCollaborationAgent[];
  tasks: Task[];
  thread: Thread;
  messages: Message[];
  runJobs: AgentRunJob[];
}> {
  const board = await prisma.board.findFirst({
    where: { id: boardId, organizationId },
  });
  if (!board) {
    const err = new Error('Board not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const existingAgents = await prisma.agent.findMany({
    where: {
      organizationId,
      boardId: board.id,
      enabled: true,
      name: { notIn: ['__mother_chat__', '__admin__'] },
    },
    orderBy: [
      { isBoardLead: 'desc' },
      { createdAt: 'asc' },
    ],
    take: LIVE_BLACKBOARD_MAX_AGENTS,
  });

  const goal = data.goal?.trim()
    || board.objective?.trim()
    || `Run live agent-to-agent work for ${board.name}.`;
  const trigger = data.trigger?.trim() || data.query?.trim() || goal;
  const maxRounds = Math.max(1, Math.min(data.maxRounds || LIVE_BLACKBOARD_DEFAULT_ROUNDS, 8));
  const agentInputs = normalizeLiveBlackboardAgentInputs(board, data, existingAgents);
  const agents = (await Promise.all(agentInputs.map(input => (
    resolveCollaborationAgent(organizationId, board.id, input)
  )))).slice(0, LIVE_BLACKBOARD_MAX_AGENTS);

  if (agents.length === 0) {
    const err = new Error('No enabled agents found in this production group') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  await Promise.all(agents.map((agent, index) => prisma.agent.update({
    where: { id: agent.id, organizationId },
    data: {
      status: 'IDLE',
      currentTask: null,
      isBoardLead: index === 0,
      agentToAgent: true,
      updatedAt: new Date(),
    },
  })));

  const priority = data.priority || 'HIGH';
  const tasks = await Promise.all(agents.map((agent, index) => prisma.task.create({
    data: {
      organizationId,
      boardId: board.id,
      agentId: agent.id,
      title: `${agent.assignedWork || trigger}`.slice(0, 180),
      description: [
        `Live blackboard conversation: ${goal}`,
        `Trigger: ${trigger}`,
        '',
        `Participant ${index + 1}/${agents.length}: ${agent.displayName}`,
        `Role: ${agent.collaborationRole}`,
        'Mode: short Codex CLI turns through a shared group blackboard.',
      ].join('\n'),
      status: 'IN_PROGRESS',
      priority,
    },
  })));

  const thread = await prisma.thread.create({
    data: {
      organizationId,
      title: `${board.name}: live blackboard`,
    },
  });
  const adminAgent = await getOrCreateAdminAgent(organizationId);
  const messages = [
    await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: adminAgent.id,
        receiverId: agents[0].id,
        content: [
          `Live blackboard started: ${goal}`,
          '',
          `Trigger/request: ${trigger}`,
          '',
          `Participants: ${agents.map(agent => agent.displayName).join(', ')}`,
          `Max agents: ${LIVE_BLACKBOARD_MAX_AGENTS}`,
          `Max rounds: ${maxRounds}`,
        ].join('\n'),
        metadata: {
          runtime: 'local-orchestration',
          conversationKind: 'admin_agent',
          edgeSemantic: 'admin_to_agent',
          boardId: board.id,
          boardName: board.name,
          taskIds: tasks.map(task => task.id),
          source: 'live_blackboard',
        } as any,
      },
    }),
  ];

  const conversation = await createBoardConversation({
    organizationId,
    boardId: board.id,
    threadId: thread.id,
    title: `${board.name}: ${goal.slice(0, 120)}`,
    goal,
    maxRounds,
    agents,
    metadata: {
      trigger,
      maxAgents: LIVE_BLACKBOARD_MAX_AGENTS,
      source: 'live_blackboard',
    },
  });

  await prisma.message.update({
    where: { id: messages[0].id },
    data: {
      metadata: {
        ...(messages[0].metadata as Record<string, unknown>),
        conversationId: conversation.id,
      } as any,
    },
  }).catch(() => {});

  await postBlackboardEvent({
    organizationId,
    boardId: board.id,
    conversationId: conversation.id,
    senderAgentId: adminAgent.id,
    type: 'admin_task',
    content: trigger,
    metadata: {
      source: 'live_blackboard',
      goal,
      maxRounds,
      agentIds: agents.map(agent => agent.id),
      taskIds: tasks.map(task => task.id),
    },
  });

  await prisma.thread.update({
    where: { id: thread.id },
    data: { updatedAt: new Date() },
  });

  const runJobs = await enqueueLiveBlackboardRoundJobs({
    organizationId,
    board,
    conversationId: conversation.id,
    goal,
    agents,
    tasks,
    thread,
    round: 1,
    maxRounds,
  });

  await Promise.all(agents.map((agent, index) => activityService.createActivity(organizationId, {
    agentId: agent.id,
    type: 'TASK_START',
    message: `${agent.displayName} joined live blackboard conversation in ${board.name}`,
    metadata: {
      runtime: 'codex-cli',
      source: 'live_blackboard',
      conversationId: conversation.id,
      boardId: board.id,
      taskId: tasks[index]?.id ?? null,
      round: 1,
      maxRounds,
    },
  })));

  await prisma.boardMemory.create({
    data: {
      boardId: board.id,
      content: `Live blackboard ${conversation.id} started. Goal: ${goal}. Trigger: ${trigger}. Agents: ${agents.map(agent => agent.displayName).join(', ')}.`,
      tags: ['live-blackboard', 'agent-agent', 'mother-chat', 'started'] as any,
      isChat: true,
      source: 'live_blackboard',
    },
  }).catch(() => {});

  return {
    board,
    conversationId: conversation.id,
    goal,
    trigger,
    agents,
    tasks,
    thread,
    messages,
    runJobs,
  };
}
