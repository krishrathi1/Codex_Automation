import type { Agent, AgentRunJob, Board, Message, Task, Thread } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import * as activityService from './activity.service.js';
import * as llmProviderService from './llm-provider.service.js';
import { getOrCreateAdminAgent } from './system-agent.service.js';
import {
  getAgentCodexSessionId,
  runCodexCliPromptWithResumeRecovery,
  resolveCodexCommand,
  resolveCodexCwd,
  validateAuthentication,
  validateInstallation,
  type CodexRunState,
  type NexusCodexEvent,
  type NexusCodexEventType,
} from './codex-cli.service.js';
import { advanceProductionErrorPipelineAfterJob } from './production-error-pipeline.service.js';

type JsonRecord = Record<string, unknown>;

type AgentRunJobWithRelations = AgentRunJob & {
  agent: Agent;
  board: Board | null;
  task: Task | null;
  thread: Thread | null;
};

type EnqueueBoardAgentRunJobsInput = {
  organizationId: string;
  board: Board;
  query: string;
  agents: Agent[];
  tasks: Task[];
  thread: Thread;
};

type LiveWorkflowStage = {
  agentId: string;
  displayName: string;
  role: string;
  work: string;
  taskId: string | null;
};

type EnqueueLiveAgentWorkflowInput = {
  organizationId: string;
  board: Board;
  goal: string;
  trigger: string;
  workflowId: string;
  agents: Agent[];
  tasks: Task[];
  thread: Thread;
};

let timer: NodeJS.Timeout | null = null;
let activeJobs = 0;
let started = false;

function objectRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function liveWorkflowStages(value: unknown): LiveWorkflowStage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => objectRecord(item))
    .map(item => ({
      agentId: stringValue(item.agentId) || '',
      displayName: stringValue(item.displayName) || 'Agent',
      role: stringValue(item.role) || 'Workflow agent',
      work: stringValue(item.work) || 'Continue the live workflow.',
      taskId: stringValue(item.taskId) || null,
    }))
    .filter(item => item.agentId);
}

function getLiveWorkflowContext(value: unknown) {
  const context = objectRecord(value);
  if (context.source !== 'live_agent_workflow') return null;

  const workflowId = stringValue(context.workflowId);
  const stepIndex = numberValue(context.stepIndex);
  const threadId = stringValue(context.threadId);
  const boardId = stringValue(context.boardId);
  const goal = stringValue(context.goal) || '';
  const trigger = stringValue(context.trigger) || goal;
  const stages = liveWorkflowStages(context.stages);

  if (!workflowId || stepIndex === undefined || !threadId || !boardId || stages.length === 0) {
    return null;
  }

  return {
    workflowId,
    stepIndex,
    threadId,
    boardId,
    boardName: stringValue(context.boardName) || 'Production group',
    goal,
    trigger,
    stages,
  };
}

function readBooleanEnv(name: string, fallback = false) {
  const value = process.env[name];
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function readNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function truncate(value: string | null | undefined, length = 500) {
  const text = value?.trim() || '';
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function summarizeOutput(output: string, fallback: string) {
  const firstUsefulLine = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean);
  return truncate(firstUsefulLine || fallback, 500);
}

function liveWorkflowPrompt(options: {
  goal: string;
  trigger: string;
  stage: LiveWorkflowStage;
  stepIndex: number;
  stages: LiveWorkflowStage[];
}) {
  const nextStage = options.stages[options.stepIndex + 1];
  const previousStages = options.stages.slice(0, options.stepIndex);

  return [
    `LIVE AGENT WORKFLOW TURN ${options.stepIndex + 1}/${options.stages.length}`,
    `Goal: ${options.goal}`,
    `Incoming event/request: ${options.trigger}`,
    '',
    `Your agent: ${options.stage.displayName}`,
    `Your role: ${options.stage.role}`,
    `Your stage work: ${options.stage.work}`,
    '',
    previousStages.length > 0
      ? `Before acting, read the previous stage messages in the Nexus context packet. Previous stages: ${previousStages.map(stage => stage.displayName).join(' -> ')}.`
      : 'You are the first agent. Convert the incoming event into an actionable diagnosis/handoff.',
    nextStage
      ? `Write your answer as a direct handoff to ${nextStage.displayName}. Include decisions, evidence, blockers, and exactly what ${nextStage.displayName} should do next.`
      : 'You are the final agent. Close the workflow with final status, evidence, artifacts changed or verified, and remaining risk.',
    '',
    'Do not answer as all agents. Speak only as your assigned agent and only for this turn.',
    'Use only local Nexus DB context and local Codex CLI runtime. Do not use external LLM APIs.',
  ].join('\n');
}

function eventActivityType(eventType: NexusCodexEventType) {
  if (eventType === 'error') return 'ERROR' as const;
  if (eventType === 'response') return 'MESSAGE' as const;
  return 'SYSTEM' as const;
}

function emitRunJobEvent(io: SocketIOServer | undefined, organizationId: string, payload: JsonRecord) {
  io?.to(`org:${organizationId}`).emit('agent-run-job:update', {
    ...payload,
    timestamp: new Date().toISOString(),
  });
}

async function updateAgentCodexSession(agent: Agent, codexSessionId: string, threadId?: string | null) {
  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      identityProfile: {
        ...objectRecord(agent.identityProfile),
        ...(threadId && { nexusChatThreadId: threadId }),
        codexCliSessionId: codexSessionId,
        activeWorkflowSessionId: codexSessionId,
        agentRuntime: 'codex-cli',
      } as any,
      gatewayAgentId: `codex:${agent.id}:${codexSessionId}`,
    },
  });
}

async function claimNextJob(filter: { organizationId?: string } = {}): Promise<AgentRunJobWithRelations | null> {
  const queued = await prisma.agentRunJob.findFirst({
    where: {
      status: 'QUEUED',
      ...(filter.organizationId && { organizationId: filter.organizationId }),
    },
    orderBy: { queuedAt: 'asc' },
    select: { id: true },
  });
  if (!queued) return null;

  const claimedAt = new Date();
  const result = await prisma.agentRunJob.updateMany({
    where: { id: queued.id, status: 'QUEUED' },
    data: {
      status: 'RUNNING',
      startedAt: claimedAt,
      error: null,
      attempt: { increment: 1 },
    },
  });
  if (result.count !== 1) return null;

  return prisma.agentRunJob.findUnique({
    where: { id: queued.id },
    include: {
      agent: true,
      board: true,
      task: true,
      thread: true,
    },
  });
}

async function buildAgentRunContextPacket(job: AgentRunJobWithRelations) {
  const boardId = job.boardId;
  const [messages, tasks, previousJobs, activities] = await Promise.all([
    prisma.message.findMany({
      where: { thread: { organizationId: job.organizationId } },
      orderBy: { createdAt: 'desc' },
      take: 120,
      include: {
        sender: { select: { id: true, displayName: true, boardId: true } },
        receiver: { select: { id: true, displayName: true, boardId: true } },
      },
    }),
    prisma.task.findMany({
      where: {
        organizationId: job.organizationId,
        ...(boardId && { boardId }),
      },
      orderBy: { updatedAt: 'desc' },
      take: 25,
      include: {
        agent: { select: { id: true, displayName: true } },
      },
    }),
    prisma.agentRunJob.findMany({
      where: {
        organizationId: job.organizationId,
        agentId: job.agentId,
        id: { not: job.id },
      },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      select: {
        id: true,
        status: true,
        summary: true,
        codexSessionId: true,
        taskId: true,
        durationMs: true,
        updatedAt: true,
      },
    }),
    prisma.activity.findMany({
      where: {
        organizationId: job.organizationId,
        agentId: job.agentId,
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
  ]);

  const visibleMessages = boardId
    ? messages.filter(message => {
        const metadata = objectRecord(message.metadata);
        return metadata.boardId === boardId
          || message.sender.boardId === boardId
          || message.receiver.boardId === boardId;
      }).slice(0, 25)
    : messages.slice(0, 25);

  const latestJobSessionId = previousJobs.find(item => item.codexSessionId)?.codexSessionId ?? null;
  const resumeCodexSessionId = getAgentCodexSessionId(job.agent) || latestJobSessionId;

  return {
    kind: 'nexus_agent_run_context',
    generatedAt: new Date().toISOString(),
    runJob: {
      id: job.id,
      status: job.status,
      attempt: job.attempt,
      queuedAt: job.queuedAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
    },
    sourceContext: objectRecord(job.contextPacket),
    board: job.board ? {
      id: job.board.id,
      name: job.board.name,
      slug: job.board.slug,
      objective: job.board.objective,
      boardType: job.board.boardType,
    } : null,
    agent: {
      id: job.agent.id,
      name: job.agent.name,
      displayName: job.agent.displayName,
      description: job.agent.description,
      currentTask: job.agent.currentTask,
      identityProfile: objectRecord(job.agent.identityProfile),
    },
    task: job.task ? {
      id: job.task.id,
      title: job.task.title,
      description: job.task.description,
      status: job.task.status,
      priority: job.task.priority,
    } : null,
    resumeCodexSessionId,
    recentBoardMessages: visibleMessages.reverse().map(message => ({
      id: message.id,
      threadId: message.threadId,
      from: message.sender.displayName,
      to: message.receiver.displayName,
      content: truncate(message.content, 600),
      createdAt: message.createdAt.toISOString(),
      metadata: objectRecord(message.metadata),
    })),
    activeTasks: tasks.map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      agent: task.agent?.displayName ?? 'Unassigned',
      updatedAt: task.updatedAt.toISOString(),
    })),
    previousAgentRuns: previousJobs.map(item => ({
      id: item.id,
      taskId: item.taskId,
      status: item.status,
      summary: item.summary,
      codexSessionId: item.codexSessionId,
      durationMs: item.durationMs,
      updatedAt: item.updatedAt.toISOString(),
    })),
    recentAgentActivities: activities.map(activity => ({
      id: activity.id,
      type: activity.type,
      message: truncate(activity.message, 300),
      createdAt: activity.createdAt.toISOString(),
    })),
  };
}

function composeAgentRunPrompt(contextPacket: Awaited<ReturnType<typeof buildAgentRunContextPacket>>, prompt: string) {
  return [
    `You are Nexus production sub-agent "${contextPacket.agent.displayName}".`,
    'You are being launched by the Nexus backend through the local Codex CLI only. Do not ask for OpenAI, Codex, Claude, or Anthropic API keys.',
    'Work only within the assigned production group and task. Keep the response audit-ready.',
    'Return a concise report with: status, evidence checked, blockers, files/commands touched, and next action.',
    'Do not commit, push, deploy, or change production state unless the task explicitly asks for that action.',
    '',
    'NEXUS CONTEXT PACKET',
    JSON.stringify(contextPacket, null, 2),
    '',
    'ASSIGNED TASK',
    prompt,
  ].join('\n');
}

async function persistRunJobActivity(options: {
  job: AgentRunJobWithRelations;
  nexusSessionId?: string | null;
  codexSessionId?: string | null;
  event: NexusCodexEvent;
}) {
  return activityService.createActivity(options.job.organizationId, {
    agentId: options.job.agentId,
    type: eventActivityType(options.event.type),
    message: truncate(options.event.content || options.event.type, 500),
    metadata: {
      runtime: 'codex-cli',
      agentRunJobId: options.job.id,
      boardId: options.job.boardId,
      taskId: options.job.taskId,
      threadId: options.job.threadId,
      nexusSessionId: options.nexusSessionId ?? null,
      codexSessionId: options.codexSessionId ?? null,
      nexusEventType: options.event.type,
      ...(options.event.metadata ?? {}),
    },
  });
}

async function createAgentRunMessage(job: AgentRunJobWithRelations, responseText: string, state: CodexRunState): Promise<Message | null> {
  if (!job.threadId) return null;
  const liveWorkflow = getLiveWorkflowContext(job.contextPacket);
  const nextLiveStage = liveWorkflow?.stages[liveWorkflow.stepIndex + 1];
  const leadAgent = job.boardId
    ? await prisma.agent.findFirst({
        where: {
          organizationId: job.organizationId,
          boardId: job.boardId,
          isBoardLead: true,
          name: { notIn: ['__mother_chat__', '__admin__'] },
        },
      })
    : null;
  const receiverId = nextLiveStage?.agentId
    || (leadAgent && leadAgent.id !== job.agentId ? leadAgent.id : job.agentId);

  return prisma.message.create({
    data: {
      threadId: job.threadId,
      senderId: job.agentId,
      receiverId,
      content: responseText,
      metadata: {
        role: 'assistant',
        runtime: 'codex-cli',
        conversationKind: 'agent_agent',
        edgeSemantic: liveWorkflow || (leadAgent && leadAgent.id !== job.agentId) ? 'agent_to_agent' : 'agent_self_report',
        boardId: job.boardId,
        boardName: job.board?.name ?? null,
        assignedTaskId: job.taskId,
        taskIds: job.taskId ? [job.taskId] : [],
        agentRunJobId: job.id,
        nexusSessionId: job.nexusSessionId,
        codexSessionId: state.codexSessionId,
        codexSessionConfirmed: Boolean(state.codexSessionId),
        usage: state.usage,
        ...(liveWorkflow && {
          workflowId: liveWorkflow.workflowId,
          workflowStepIndex: liveWorkflow.stepIndex,
          workflowStepNumber: liveWorkflow.stepIndex + 1,
          nextAgentId: nextLiveStage?.agentId ?? null,
        }),
        source: liveWorkflow ? 'live_agent_workflow' : 'agent_run_worker',
      } as any,
    },
  });
}

function emitThreadMessage(io: SocketIOServer | undefined, organizationId: string, message: Message | null) {
  if (!message) return;
  io?.to(`org:${organizationId}`).emit('thread:message', {
    threadId: message.threadId,
    message,
  });
}

async function createLiveWorkflowRunJob(options: {
  organizationId: string;
  board: Pick<Board, 'id' | 'name'>;
  thread: Pick<Thread, 'id'>;
  stage: LiveWorkflowStage;
  stages: LiveWorkflowStage[];
  stepIndex: number;
  workflowId: string;
  goal: string;
  trigger: string;
  previousJobId?: string | null;
  previousAgentId?: string | null;
}) {
  const nextStage = options.stages[options.stepIndex + 1];
  const prompt = liveWorkflowPrompt({
    goal: options.goal,
    trigger: options.trigger,
    stage: options.stage,
    stepIndex: options.stepIndex,
    stages: options.stages,
  });

  return prisma.agentRunJob.create({
    data: {
      organizationId: options.organizationId,
      boardId: options.board.id,
      agentId: options.stage.agentId,
      taskId: options.stage.taskId,
      threadId: options.thread.id,
      prompt,
      status: 'QUEUED',
      contextPacket: {
        source: 'live_agent_workflow',
        workflowId: options.workflowId,
        boardId: options.board.id,
        boardName: options.board.name,
        threadId: options.thread.id,
        goal: options.goal,
        trigger: options.trigger,
        stages: options.stages,
        stepIndex: options.stepIndex,
        currentAgentId: options.stage.agentId,
        nextAgentId: nextStage?.agentId ?? null,
        previousJobId: options.previousJobId ?? null,
        previousAgentId: options.previousAgentId ?? null,
        queuedAt: new Date().toISOString(),
      } as any,
    },
  });
}

async function advanceLiveAgentWorkflowAfterJob(
  job: AgentRunJobWithRelations,
  responseText: string,
  options: { io?: SocketIOServer } = {},
) {
  const liveWorkflow = getLiveWorkflowContext(job.contextPacket);
  if (!liveWorkflow || !job.board) return;

  const nextStepIndex = liveWorkflow.stepIndex + 1;
  const nextStage = liveWorkflow.stages[nextStepIndex];

  if (job.taskId) {
    await prisma.task.update({
      where: { id: job.taskId },
      data: { status: 'DONE' },
    }).catch(() => {});
    options.io?.to(`org:${job.organizationId}`).emit('task:update', { id: job.taskId, status: 'DONE' });
  }

  if (!nextStage) {
    await prisma.boardMemory.create({
      data: {
        boardId: job.board.id,
        content: `${job.board.name} live workflow ${liveWorkflow.workflowId} completed. Final agent: ${job.agent.displayName}. Summary: ${summarizeOutput(responseText, 'Workflow completed')}`,
        tags: ['live-workflow', 'agent-agent', 'mother-chat', 'completed'] as any,
        isChat: true,
        source: 'live_agent_workflow',
      },
    }).catch(() => {});

    emitRunJobEvent(options.io, job.organizationId, {
      id: job.id,
      status: 'COMPLETED',
      boardId: job.boardId,
      agentId: job.agentId,
      taskId: job.taskId,
      workflowId: liveWorkflow.workflowId,
      workflowStatus: 'COMPLETED',
    });
    options.io?.to(`org:${job.organizationId}`).emit('board:liveWorkflowCompleted', {
      board: job.board,
      workflowId: liveWorkflow.workflowId,
      finalJobId: job.id,
      finalAgentId: job.agentId,
    });
    return;
  }

  if (nextStage.taskId) {
    await prisma.task.update({
      where: { id: nextStage.taskId },
      data: { status: 'IN_PROGRESS' },
    }).catch(() => {});
    options.io?.to(`org:${job.organizationId}`).emit('task:update', { id: nextStage.taskId, status: 'IN_PROGRESS' });
  }

  const nextJob = await createLiveWorkflowRunJob({
    organizationId: job.organizationId,
    board: job.board,
    thread: { id: liveWorkflow.threadId },
    stage: nextStage,
    stages: liveWorkflow.stages,
    stepIndex: nextStepIndex,
    workflowId: liveWorkflow.workflowId,
    goal: liveWorkflow.goal,
    trigger: liveWorkflow.trigger,
    previousJobId: job.id,
    previousAgentId: job.agentId,
  });

  await activityService.createActivity(job.organizationId, {
    agentId: nextStage.agentId,
    type: 'TASK_START',
    message: `Queued live workflow turn ${nextStepIndex + 1}/${liveWorkflow.stages.length} for ${liveWorkflow.boardName}`,
    metadata: {
      runtime: 'codex-cli',
      source: 'live_agent_workflow',
      workflowId: liveWorkflow.workflowId,
      previousAgentId: job.agentId,
      previousJobId: job.id,
      agentRunJobId: nextJob.id,
      boardId: job.boardId,
      taskId: nextStage.taskId,
      threadId: liveWorkflow.threadId,
      stepIndex: nextStepIndex,
    },
  }).catch(err => logger.warn({ err, jobId: nextJob.id }, 'Failed to persist live workflow queue activity'));

  await prisma.boardMemory.create({
    data: {
      boardId: job.board.id,
      content: `${job.agent.displayName} handed live workflow ${liveWorkflow.workflowId} to ${nextStage.displayName}. Previous summary: ${summarizeOutput(responseText, 'No summary')}`,
      tags: ['live-workflow', 'agent-agent', 'mother-chat', 'handoff'] as any,
      isChat: true,
      source: 'live_agent_workflow',
    },
  }).catch(() => {});

  emitRunJobEvent(options.io, job.organizationId, {
    id: nextJob.id,
    status: nextJob.status,
    boardId: nextJob.boardId,
    agentId: nextJob.agentId,
    taskId: nextJob.taskId,
    threadId: nextJob.threadId,
    workflowId: liveWorkflow.workflowId,
    workflowStepIndex: nextStepIndex,
    previousJobId: job.id,
  });
  options.io?.to(`org:${job.organizationId}`).emit('board:liveWorkflowAdvanced', {
    board: job.board,
    workflowId: liveWorkflow.workflowId,
    previousJobId: job.id,
    nextJob,
    nextStage,
  });
}

async function completeJob(
  job: AgentRunJobWithRelations,
  state: CodexRunState,
  startedAt: number,
  io?: SocketIOServer,
) {
  const responseText = state.result || state.rawStdout.trim() || 'No response';
  const durationMs = Date.now() - startedAt;
  const summary = summarizeOutput(responseText, `Completed ${job.agent.displayName} run job`);

  if (state.codexSessionId) {
    await updateAgentCodexSession(job.agent, state.codexSessionId, job.threadId);
  }

  const runMessage = await createAgentRunMessage(job, responseText, state);
  emitThreadMessage(io, job.organizationId, runMessage);

  await prisma.agentRunJob.update({
    where: { id: job.id },
    data: {
      status: 'COMPLETED',
      output: responseText,
      summary,
      error: null,
      codexSessionId: state.codexSessionId,
      completedAt: new Date(),
      durationMs,
    },
  });

  if (job.taskId) {
    await prisma.task.update({
      where: { id: job.taskId },
      data: { status: 'REVIEW' },
    }).catch(() => {});
  }

  await prisma.session.update({
    where: { id: job.nexusSessionId! },
    data: {
      status: 'COMPLETED',
      endedAt: new Date(),
      durationMs,
      summary,
      ...(state.usage && { tokensUsed: state.usage.inputTokens + state.usage.outputTokens }),
    },
  }).catch(() => {});

  await prisma.metricSnapshot.create({
    data: {
      organizationId: job.organizationId,
      agentId: job.agentId,
      responseTimeMs: durationMs,
      success: true,
      toolName: 'agent-run-worker',
    },
  }).catch(() => {});

  if (state.usage) {
    await llmProviderService.recordTokenUsage({
      organizationId: job.organizationId,
      agentId: job.agentId,
      inputTokens: state.usage.inputTokens,
      outputTokens: state.usage.outputTokens,
      model: process.env.CODEX_MODEL?.trim() || 'codex-cli',
      mode: 'BYOK',
    }).catch(err => logger.warn({ err, jobId: job.id }, 'Failed to record agent run token usage'));
  }

  if (job.boardId) {
    await prisma.boardMemory.create({
      data: {
        boardId: job.boardId,
        content: `${job.agent.displayName} completed run job ${job.id}. Summary: ${summary}`,
        tags: ['agent-run', 'codex-cli', 'mother-chat'] as any,
        isChat: true,
        source: 'agent_run_worker',
      },
    }).catch(() => {});
  }

  await activityService.createActivity(job.organizationId, {
    agentId: job.agentId,
    type: 'TASK_COMPLETE',
    message: `${job.agent.displayName} completed queued Codex run`,
    metadata: {
      runtime: 'codex-cli',
      agentRunJobId: job.id,
      boardId: job.boardId,
      taskId: job.taskId,
      codexSessionId: state.codexSessionId,
      durationMs,
    },
  }).catch(() => {});

  await prisma.agent.update({
    where: { id: job.agentId },
    data: {
      status: 'IDLE',
      currentTask: null,
      lastHeartbeat: new Date(),
    },
  }).catch(() => {});

  emitRunJobEvent(io, job.organizationId, {
    id: job.id,
    status: 'COMPLETED',
    boardId: job.boardId,
    agentId: job.agentId,
    taskId: job.taskId,
    durationMs,
    summary,
    codexSessionId: state.codexSessionId,
  });
  io?.to(`org:${job.organizationId}`).emit('agent:updated', { id: job.agentId, status: 'IDLE' });
  if (job.taskId) io?.to(`org:${job.organizationId}`).emit('task:update', { id: job.taskId, status: 'REVIEW' });

  await advanceLiveAgentWorkflowAfterJob(job, responseText, { io })
    .catch(err => logger.warn({ err, jobId: job.id }, 'Failed to advance live agent workflow'));

  await advanceProductionErrorPipelineAfterJob(job, responseText, { io })
    .catch(err => logger.warn({ err, jobId: job.id }, 'Failed to advance production error pipeline'));
}

async function failJob(
  job: AgentRunJobWithRelations,
  error: unknown,
  startedAt: number,
  io?: SocketIOServer,
) {
  const durationMs = Date.now() - startedAt;
  const errorMessage = error instanceof Error ? error.message : String(error);

  await prisma.agentRunJob.update({
    where: { id: job.id },
    data: {
      status: 'FAILED',
      error: errorMessage,
      summary: `Failed: ${truncate(errorMessage, 300)}`,
      completedAt: new Date(),
      durationMs,
    },
  }).catch(() => {});

  if (job.nexusSessionId) {
    await prisma.session.update({
      where: { id: job.nexusSessionId },
      data: {
        status: 'FAILED',
        endedAt: new Date(),
        durationMs,
        summary: `Agent run failed: ${truncate(errorMessage, 120)}`,
      },
    }).catch(() => {});
  }

  await prisma.metricSnapshot.create({
    data: {
      organizationId: job.organizationId,
      agentId: job.agentId,
      responseTimeMs: durationMs,
      success: false,
      errorMessage,
      toolName: 'agent-run-worker',
    },
  }).catch(() => {});

  await activityService.createActivity(job.organizationId, {
    agentId: job.agentId,
    type: 'ERROR',
    message: truncate(errorMessage, 500),
    metadata: {
      runtime: 'codex-cli',
      agentRunJobId: job.id,
      boardId: job.boardId,
      taskId: job.taskId,
      durationMs,
    },
  }).catch(() => {});

  await prisma.agent.update({
    where: { id: job.agentId },
    data: { status: 'ERROR', lastHeartbeat: new Date() },
  }).catch(() => {});

  emitRunJobEvent(io, job.organizationId, {
    id: job.id,
    status: 'FAILED',
    boardId: job.boardId,
    agentId: job.agentId,
    taskId: job.taskId,
    durationMs,
    error: errorMessage,
  });
  io?.to(`org:${job.organizationId}`).emit('agent:updated', { id: job.agentId, status: 'ERROR' });
}

async function processJob(job: AgentRunJobWithRelations, io?: SocketIOServer) {
  const startedAt = Date.now();
  logger.info({ jobId: job.id, agentId: job.agentId, boardId: job.boardId }, 'Starting queued Codex agent run');

  const installation = await validateInstallation();
  if (!installation.ok || !installation.command) {
    throw new Error(`Codex CLI installation check failed: ${installation.details}`);
  }

  const authentication = await validateAuthentication();
  if (!authentication.ok) {
    throw new Error(`Codex CLI authentication check failed. Run "codex login" locally. Details: ${authentication.details}`);
  }

  const adminAgent = await getOrCreateAdminAgent(job.organizationId);
  const session = await prisma.session.create({
    data: {
      organizationId: job.organizationId,
      agentId: job.agentId,
      type: 'AGENT_RUN_JOB',
      status: 'RUNNING',
      summary: `Queued Codex run: ${truncate(job.prompt, 120)}`,
    },
  });

  await prisma.agentRunJob.update({
    where: { id: job.id },
    data: { nexusSessionId: session.id },
  });
  job.nexusSessionId = session.id;

  await prisma.agent.update({
    where: { id: job.agentId },
    data: {
      status: 'ONLINE',
      currentTask: job.prompt,
      lastHeartbeat: new Date(),
      identityProfile: {
        ...objectRecord(job.agent.identityProfile),
        agentRuntime: 'codex-cli',
        activeAgentRunJobId: job.id,
      } as any,
    },
  });
  io?.to(`org:${job.organizationId}`).emit('agent:updated', { id: job.agentId, status: 'ONLINE', currentTask: job.prompt });

  const contextPacket = await buildAgentRunContextPacket(job);
  await prisma.agentRunJob.update({
    where: { id: job.id },
    data: {
      contextPacket: contextPacket as any,
      staleCodexSessionId: contextPacket.resumeCodexSessionId ?? null,
    },
  });

  emitRunJobEvent(io, job.organizationId, {
    id: job.id,
    status: 'RUNNING',
    boardId: job.boardId,
    agentId: job.agentId,
    taskId: job.taskId,
    nexusSessionId: session.id,
    resumeCodexSessionId: contextPacket.resumeCodexSessionId,
  });

  await prisma.message.create({
    data: {
      threadId: job.threadId ?? (await prisma.thread.create({
        data: {
          organizationId: job.organizationId,
          title: `Queued run for ${job.agent.displayName}`,
        },
      })).id,
      senderId: adminAgent.id,
      receiverId: job.agentId,
      content: job.prompt,
      metadata: {
        role: 'user',
        runtime: 'codex-cli',
        conversationKind: 'admin_agent',
        edgeSemantic: 'admin_to_agent',
        boardId: job.boardId,
        boardName: job.board?.name ?? null,
        taskIds: job.taskId ? [job.taskId] : [],
        assignedTaskId: job.taskId,
        agentRunJobId: job.id,
        nexusSessionId: session.id,
        resumeCodexSessionId: contextPacket.resumeCodexSessionId ?? null,
        source: 'agent_run_worker',
      } as any,
    },
  }).catch(err => logger.warn({ err, jobId: job.id }, 'Failed to persist queued run user message'));

  const command = await resolveCodexCommand();
  const cwd = resolveCodexCwd(job.agent);
  const state = await runCodexCliPromptWithResumeRecovery({
    command,
    cwd,
    existingCodexSessionId: contextPacket.resumeCodexSessionId,
    prompt: composeAgentRunPrompt(contextPacket, job.prompt),
    logContext: {
      agentRunJobId: job.id,
      agentId: job.agentId,
      boardId: job.boardId,
      nexusSessionId: session.id,
    },
    onEvent: async (event, state) => {
      emitRunJobEvent(io, job.organizationId, {
        id: job.id,
        status: 'RUNNING',
        boardId: job.boardId,
        agentId: job.agentId,
        taskId: job.taskId,
        nexusSessionId: session.id,
        codexSessionId: state.codexSessionId,
        event,
      });
      await persistRunJobActivity({
        job,
        nexusSessionId: session.id,
        codexSessionId: state.codexSessionId,
        event,
      }).catch(err => logger.warn({ err, jobId: job.id }, 'Failed to persist queued Codex event'));
    },
  });

  await completeJob(job, state, startedAt, io);
}

async function pumpQueue(io?: SocketIOServer) {
  const concurrency = readNumberEnv('AGENT_RUN_WORKER_CONCURRENCY', 2);
  while (activeJobs < concurrency) {
    const job = await claimNextJob();
    if (!job) return;

    activeJobs += 1;
    processJob(job, io)
      .catch(err => failJob(job, err, job.startedAt?.getTime() ?? Date.now(), io))
      .finally(() => {
        activeJobs -= 1;
        void pumpQueue(io).catch(pumpErr => logger.warn({ err: pumpErr }, 'Agent run queue pump failed'));
      });
  }
}

export async function processNextAgentRunJobForTest(options: { organizationId?: string; io?: SocketIOServer } = {}) {
  const job = await claimNextJob({ organizationId: options.organizationId });
  if (!job) return null;

  activeJobs += 1;
  try {
    await processJob(job, options.io);
    return job.id;
  } catch (err) {
    await failJob(job, err, job.startedAt?.getTime() ?? Date.now(), options.io);
    throw err;
  } finally {
    activeJobs -= 1;
  }
}

export async function enqueueBoardAgentRunJobs(input: EnqueueBoardAgentRunJobsInput) {
  const jobs = await Promise.all(input.agents.map(agent => {
    const task = input.tasks.find(item => item.agentId === agent.id);
    return prisma.agentRunJob.create({
      data: {
        organizationId: input.organizationId,
        boardId: input.board.id,
        agentId: agent.id,
        taskId: task?.id ?? null,
        threadId: input.thread.id,
        prompt: input.query,
        status: 'QUEUED',
        contextPacket: {
          source: 'production_task_dispatch',
          boardId: input.board.id,
          boardName: input.board.name,
          threadId: input.thread.id,
          taskId: task?.id ?? null,
          agentId: agent.id,
          query: input.query,
          queuedAt: new Date().toISOString(),
        } as any,
      },
    });
  }));

  await Promise.all(jobs.map(job => activityService.createActivity(input.organizationId, {
    agentId: job.agentId,
    type: 'TASK_START',
    message: `Queued local Codex run for ${input.board.name}`,
    metadata: {
      runtime: 'codex-cli',
      agentRunJobId: job.id,
      boardId: job.boardId,
      taskId: job.taskId,
      threadId: job.threadId,
      queueStatus: job.status,
      source: 'agent_run_queue',
    },
  }).catch(err => logger.warn({ err, jobId: job.id }, 'Failed to persist queue activity'))));

  return jobs;
}

export async function enqueueLiveAgentWorkflowInitialJob(input: EnqueueLiveAgentWorkflowInput) {
  const stages = input.agents.map((agent, index) => {
    const task = input.tasks.find(item => item.agentId === agent.id);
    return {
      agentId: agent.id,
      displayName: agent.displayName,
      role: agent.description || `Workflow stage ${index + 1}`,
      work: task?.title || agent.currentTask || `Complete workflow stage ${index + 1}`,
      taskId: task?.id ?? null,
    };
  });
  const firstStage = stages[0];
  if (!firstStage) return null;

  const job = await createLiveWorkflowRunJob({
    organizationId: input.organizationId,
    board: input.board,
    thread: input.thread,
    stage: firstStage,
    stages,
    stepIndex: 0,
    workflowId: input.workflowId,
    goal: input.goal,
    trigger: input.trigger,
  });

  await activityService.createActivity(input.organizationId, {
    agentId: firstStage.agentId,
    type: 'TASK_START',
    message: `Queued live workflow turn 1/${stages.length} for ${input.board.name}`,
    metadata: {
      runtime: 'codex-cli',
      source: 'live_agent_workflow',
      workflowId: input.workflowId,
      agentRunJobId: job.id,
      boardId: input.board.id,
      taskId: firstStage.taskId,
      threadId: input.thread.id,
      stepIndex: 0,
    },
  }).catch(err => logger.warn({ err, jobId: job.id }, 'Failed to persist live workflow initial queue activity'));

  return job;
}

export async function recoverInterruptedAgentRunJobs() {
  const result = await prisma.agentRunJob.updateMany({
    where: { status: 'RUNNING' },
    data: {
      status: 'QUEUED',
      startedAt: null,
      error: 'Recovered from an interrupted backend worker and re-queued.',
    },
  });
  if (result.count > 0) {
    logger.warn({ count: result.count }, 'Re-queued interrupted agent run jobs');
  }
  return result.count;
}

export function startAgentRunWorker(io?: SocketIOServer) {
  if (started) return;
  started = true;

  if (readBooleanEnv('AGENT_RUN_WORKER_DISABLED', false)) {
    logger.info('Agent run worker disabled by AGENT_RUN_WORKER_DISABLED');
    return;
  }

  const intervalMs = readNumberEnv('AGENT_RUN_WORKER_POLL_MS', 1000);
  void recoverInterruptedAgentRunJobs()
    .then(() => pumpQueue(io))
    .catch(err => logger.warn({ err }, 'Agent run worker startup recovery failed'));

  timer = setInterval(() => {
    void pumpQueue(io).catch(err => logger.warn({ err }, 'Agent run queue pump failed'));
  }, intervalMs);
  timer.unref?.();

  logger.info({
    intervalMs,
    concurrency: readNumberEnv('AGENT_RUN_WORKER_CONCURRENCY', 2),
  }, 'Agent run worker started');
}

export function stopAgentRunWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
