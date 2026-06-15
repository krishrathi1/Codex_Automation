import { createHash } from 'crypto';
import type { Agent, Board, ProductionErrorEvent } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import * as activityService from './activity.service.js';

type JsonRecord = Record<string, unknown>;

export type ProductionErrorIngestInput = {
  boardId?: string;
  source?: string;
  severity?: string;
  title?: string;
  message: string;
  stack?: string;
  url?: string;
  route?: string;
  userAgent?: string;
  environment?: string;
  fingerprint?: string;
  payload?: JsonRecord;
};

type PipelineRole = 'debug' | 'review' | 'commit';

type PipelineSourceContext = JsonRecord & {
  source?: string;
  pipelineRole?: PipelineRole;
  productionErrorEventId?: string;
  pipelineAttempt?: number;
};

type CompletedPipelineJob = {
  id: string;
  organizationId: string;
  boardId: string | null;
  taskId: string | null;
  threadId: string | null;
  agentId: string;
  contextPacket: unknown;
};

const DEFAULT_AUTOMATION_BOARD_SLUG = 'production-error-automation';
const SYSTEM_AGENT_NAMES = {
  debug: 'production-debug-agent',
  review: 'production-review-agent',
  commit: 'production-commit-agent',
} as const;

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

function truncate(value: string | null | undefined, length = 500) {
  const text = value?.trim() || '';
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function fingerprintFor(input: ProductionErrorIngestInput) {
  if (input.fingerprint?.trim()) return input.fingerprint.trim();
  const stableParts = [
    input.source || 'website',
    input.environment || 'local',
    input.route || input.url || '',
    input.message,
    input.stack?.split(/\r?\n/).slice(0, 3).join('\n') || '',
  ];
  return createHash('sha256').update(stableParts.join('\n---\n')).digest('hex').slice(0, 32);
}

function parsePipelineContext(value: unknown): PipelineSourceContext {
  const record = objectRecord(value);
  const role = stringValue(record.pipelineRole);
  return {
    ...record,
    pipelineRole: role === 'debug' || role === 'review' || role === 'commit' ? role : undefined,
    productionErrorEventId: stringValue(record.productionErrorEventId),
    pipelineAttempt: numberValue(record.pipelineAttempt),
  };
}

function isReviewApproved(output: string) {
  const normalized = output.trim().toLowerCase();
  if (/approved\s*:\s*yes/.test(normalized)) return true;
  if (/approved\s*:\s*no/.test(normalized)) return false;
  return /\bapproved\b/.test(normalized) && !/\brejected\b|\bnot approved\b|\bblocked\b/.test(normalized);
}

async function resolveAutomationBoard(organizationId: string, boardId?: string) {
  if (boardId) {
    const board = await prisma.board.findFirst({ where: { id: boardId, organizationId } });
    if (!board) {
      const err = new Error('Board not found') as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    }
    return board;
  }

  return prisma.board.upsert({
    where: {
      organizationId_slug: {
        organizationId,
        slug: DEFAULT_AUTOMATION_BOARD_SLUG,
      },
    },
    update: {},
    create: {
      organizationId,
      name: 'Production Error Automation',
      slug: DEFAULT_AUTOMATION_BOARD_SLUG,
      description: 'Default production group for website, Telegram, Slack, and MCP error automation.',
      objective: 'Capture production errors, queue local Codex agents, review fixes, and prepare commit/PR audit trails.',
      boardType: 'automation',
      requireReviewBeforeDone: true,
    },
  });
}

async function ensurePipelineAgent(organizationId: string, board: Board, role: PipelineRole) {
  const displayNameByRole = {
    debug: 'Debug Agent',
    review: 'Review Agent',
    commit: 'Commit Agent',
  };
  const descriptionByRole = {
    debug: 'Investigates production errors and prepares code fixes through the local Codex CLI.',
    review: 'Reviews debug output, validates evidence, and approves or rejects the fix path.',
    commit: 'Prepares the final commit and PR handoff after review approval.',
  };

  const name = `${SYSTEM_AGENT_NAMES[role]}-${board.slug}`;
  const existing = await prisma.agent.findUnique({
    where: { organizationId_name: { organizationId, name } },
  });

  const identityProfile = {
    agentRuntime: 'codex-cli',
    productionErrorPipelineRole: role,
    productionBoardId: board.id,
    workflowSessionPolicy: 'single-session-for-agents-and-workflows',
  };

  if (existing) {
    return prisma.agent.update({
      where: { id: existing.id },
      data: {
        boardId: board.id,
        enabled: true,
        agentToAgent: true,
        isBoardLead: role === 'review',
        identityProfile: {
          ...objectRecord(existing.identityProfile),
          ...identityProfile,
        } as any,
      },
    });
  }

  return prisma.agent.create({
    data: {
      organizationId,
      boardId: board.id,
      name,
      displayName: `${displayNameByRole[role]} - ${board.name}`,
      description: descriptionByRole[role],
      workspace: process.env.CODEX_WORKSPACE_ROOT || '',
      status: 'IDLE',
      enabled: true,
      agentToAgent: true,
      isBoardLead: role === 'review',
      avatar: role === 'debug' ? 'D' : role === 'review' ? 'R' : 'C',
      identityProfile: identityProfile as any,
    },
  });
}

async function ensurePipelineAgents(organizationId: string, board: Board) {
  const [debugAgent, reviewAgent, commitAgent] = await Promise.all([
    ensurePipelineAgent(organizationId, board, 'debug'),
    ensurePipelineAgent(organizationId, board, 'review'),
    ensurePipelineAgent(organizationId, board, 'commit'),
  ]);
  return { debugAgent, reviewAgent, commitAgent };
}

function composeDebugPrompt(errorEvent: ProductionErrorEvent, attempt = 0, reviewOutput?: string) {
  return [
    'PIPELINE ROLE: debug',
    `PRODUCTION_ERROR_EVENT_ID: ${errorEvent.id}`,
    `REWORK_ATTEMPT: ${attempt}`,
    '',
    'A production website/integration error was captured by Nexus.',
    'Use the local workspace and local Codex CLI runtime only. Do not ask for API keys.',
    'Investigate and fix the issue if the evidence is sufficient. Do not commit or push.',
    'Return an audit-ready report with files touched, commands run, confidence, and remaining risk.',
    reviewOutput ? `Previous review feedback:\n${reviewOutput}` : '',
    '',
    'Captured error:',
    JSON.stringify({
      id: errorEvent.id,
      source: errorEvent.source,
      severity: errorEvent.severity,
      title: errorEvent.title,
      message: errorEvent.message,
      stack: errorEvent.stack,
      url: errorEvent.url,
      route: errorEvent.route,
      environment: errorEvent.environment,
      fingerprint: errorEvent.fingerprint,
      payload: errorEvent.payload,
    }, null, 2),
  ].filter(Boolean).join('\n');
}

function composeReviewPrompt(errorEvent: ProductionErrorEvent, debugOutput: string) {
  return [
    'PIPELINE ROLE: review',
    `PRODUCTION_ERROR_EVENT_ID: ${errorEvent.id}`,
    '',
    'Review the Debug Agent output for this production error.',
    'Inspect the repository state if useful. Do not commit or push.',
    'Your first line must be exactly one of:',
    'APPROVED: yes',
    'APPROVED: no',
    'Then provide concise evidence and required next action.',
    '',
    'Captured error:',
    JSON.stringify({
      id: errorEvent.id,
      title: errorEvent.title,
      message: errorEvent.message,
      stack: errorEvent.stack,
      url: errorEvent.url,
      route: errorEvent.route,
      fingerprint: errorEvent.fingerprint,
    }, null, 2),
    '',
    'Debug Agent output:',
    debugOutput,
  ].join('\n');
}

function composeCommitPrompt(errorEvent: ProductionErrorEvent, reviewOutput: string) {
  return [
    'PIPELINE ROLE: commit',
    `PRODUCTION_ERROR_EVENT_ID: ${errorEvent.id}`,
    '',
    'The Review Agent approved this production error fix path.',
    'Prepare the commit/PR handoff locally. Do not push to a remote unless the repository and task explicitly permit it.',
    'Return the exact files changed, validation performed, suggested commit title, suggested branch name, and PR summary.',
    '',
    'Captured error:',
    JSON.stringify({
      id: errorEvent.id,
      title: errorEvent.title,
      message: errorEvent.message,
      fingerprint: errorEvent.fingerprint,
    }, null, 2),
    '',
    'Review Agent output:',
    reviewOutput,
  ].join('\n');
}

async function enqueuePipelineJob(options: {
  organizationId: string;
  boardId: string;
  taskId: string;
  threadId: string;
  agentId: string;
  prompt: string;
  role: PipelineRole;
  productionErrorEventId: string;
  pipelineAttempt?: number;
}) {
  return prisma.agentRunJob.create({
    data: {
      organizationId: options.organizationId,
      boardId: options.boardId,
      taskId: options.taskId,
      threadId: options.threadId,
      agentId: options.agentId,
      prompt: options.prompt,
      status: 'QUEUED',
      contextPacket: {
        source: 'production_error_pipeline',
        pipelineRole: options.role,
        productionErrorEventId: options.productionErrorEventId,
        pipelineAttempt: options.pipelineAttempt ?? 0,
      } as any,
    },
  });
}

function emitPipelineEvent(io: SocketIOServer | undefined, organizationId: string, payload: JsonRecord) {
  io?.to(`org:${organizationId}`).emit('production-error:update', {
    ...payload,
    timestamp: new Date().toISOString(),
  });
}

export async function ingestProductionErrorEvent(
  organizationId: string,
  input: ProductionErrorIngestInput,
  options: { io?: SocketIOServer } = {},
) {
  if (!input.message?.trim()) {
    const err = new Error('message is required') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  const board = await resolveAutomationBoard(organizationId, input.boardId);
  const { debugAgent, reviewAgent, commitAgent } = await ensurePipelineAgents(organizationId, board);
  const fingerprint = fingerprintFor(input);
  const title = truncate(input.title || input.message.split(/\r?\n/)[0] || 'Production error', 180);

  const errorEvent = await prisma.productionErrorEvent.create({
    data: {
      organizationId,
      boardId: board.id,
      source: input.source?.trim() || 'website',
      severity: input.severity?.trim() || 'error',
      title,
      message: input.message,
      stack: input.stack || null,
      url: input.url || null,
      route: input.route || null,
      userAgent: input.userAgent || null,
      environment: input.environment || process.env.NODE_ENV || 'development',
      fingerprint,
      payload: input.payload as any ?? undefined,
      status: 'RECEIVED',
      debugAgentId: debugAgent.id,
      reviewAgentId: reviewAgent.id,
      commitAgentId: commitAgent.id,
    },
  });

  const thread = await prisma.thread.create({
    data: {
      organizationId,
      title: `Production error: ${title}`,
    },
  });

  const task = await prisma.task.create({
    data: {
      organizationId,
      boardId: board.id,
      agentId: debugAgent.id,
      title: `Fix production error: ${title}`,
      description: [
        `Production error event: ${errorEvent.id}`,
        `Source: ${errorEvent.source}`,
        `Severity: ${errorEvent.severity}`,
        `Fingerprint: ${errorEvent.fingerprint}`,
        '',
        errorEvent.message,
        errorEvent.stack ? `\nStack:\n${errorEvent.stack}` : '',
      ].filter(Boolean).join('\n'),
      status: 'ASSIGNED',
      priority: errorEvent.severity.toLowerCase() === 'critical' ? 'CRITICAL' : 'HIGH',
    },
  });

  const debugRunJob = await enqueuePipelineJob({
    organizationId,
    boardId: board.id,
    taskId: task.id,
    threadId: thread.id,
    agentId: debugAgent.id,
    prompt: composeDebugPrompt(errorEvent),
    role: 'debug',
    productionErrorEventId: errorEvent.id,
  });

  const updatedErrorEvent = await prisma.productionErrorEvent.update({
    where: { id: errorEvent.id },
    data: {
      taskId: task.id,
      debugRunJobId: debugRunJob.id,
      status: 'DEBUG_QUEUED',
    },
  });

  await activityService.createActivity(organizationId, {
    agentId: debugAgent.id,
    type: 'ERROR',
    message: `Production error queued for Debug Agent: ${title}`,
    metadata: {
      source: 'production_error_pipeline',
      productionErrorEventId: errorEvent.id,
      boardId: board.id,
      taskId: task.id,
      debugRunJobId: debugRunJob.id,
      fingerprint,
    },
  }).catch(err => logger.warn({ err, productionErrorEventId: errorEvent.id }, 'Failed to persist production error activity'));

  await prisma.boardMemory.create({
    data: {
      boardId: board.id,
      content: `Production error ${errorEvent.id} queued. Title: ${title}. Debug job: ${debugRunJob.id}.`,
      tags: ['production-error', 'codex-cli', 'mother-chat'] as any,
      isChat: true,
      source: 'production_error_pipeline',
    },
  }).catch(() => {});

  emitPipelineEvent(options.io, organizationId, {
    id: errorEvent.id,
    status: updatedErrorEvent.status,
    boardId: board.id,
    taskId: task.id,
    debugRunJobId: debugRunJob.id,
  });
  options.io?.to(`org:${organizationId}`).emit('task:update', task);
  options.io?.to(`org:${organizationId}`).emit('agent-run-job:update', debugRunJob);

  return {
    errorEvent: updatedErrorEvent,
    board,
    task,
    agents: { debugAgent, reviewAgent, commitAgent },
    runJobs: { debugRunJob },
  };
}

async function queueReviewJob(errorEvent: ProductionErrorEvent, job: CompletedPipelineJob, debugOutput: string) {
  if (!errorEvent.boardId || !errorEvent.taskId || !job.threadId || !errorEvent.reviewAgentId) return null;
  const reviewRunJob = await enqueuePipelineJob({
    organizationId: job.organizationId,
    boardId: errorEvent.boardId,
    taskId: errorEvent.taskId,
    threadId: job.threadId,
    agentId: errorEvent.reviewAgentId,
    prompt: composeReviewPrompt(errorEvent, debugOutput),
    role: 'review',
    productionErrorEventId: errorEvent.id,
    pipelineAttempt: parsePipelineContext(job.contextPacket).pipelineAttempt ?? 0,
  });

  await prisma.task.update({
    where: { id: errorEvent.taskId },
    data: { status: 'REVIEW', agentId: errorEvent.reviewAgentId },
  }).catch(() => {});

  await prisma.productionErrorEvent.update({
    where: { id: errorEvent.id },
    data: {
      status: 'REVIEW_QUEUED',
      reviewRunJobId: reviewRunJob.id,
    },
  });

  return reviewRunJob;
}

async function queueCommitJob(errorEvent: ProductionErrorEvent, job: CompletedPipelineJob, reviewOutput: string) {
  if (!errorEvent.boardId || !errorEvent.taskId || !job.threadId || !errorEvent.commitAgentId) return null;
  const commitRunJob = await enqueuePipelineJob({
    organizationId: job.organizationId,
    boardId: errorEvent.boardId,
    taskId: errorEvent.taskId,
    threadId: job.threadId,
    agentId: errorEvent.commitAgentId,
    prompt: composeCommitPrompt(errorEvent, reviewOutput),
    role: 'commit',
    productionErrorEventId: errorEvent.id,
  });

  await prisma.task.update({
    where: { id: errorEvent.taskId },
    data: { status: 'IN_PROGRESS', agentId: errorEvent.commitAgentId },
  }).catch(() => {});

  await prisma.productionErrorEvent.update({
    where: { id: errorEvent.id },
    data: {
      status: 'COMMIT_QUEUED',
      commitRunJobId: commitRunJob.id,
    },
  });

  return commitRunJob;
}

async function queueDebugReworkJob(errorEvent: ProductionErrorEvent, job: CompletedPipelineJob, reviewOutput: string, nextAttempt: number) {
  if (!errorEvent.boardId || !errorEvent.taskId || !job.threadId || !errorEvent.debugAgentId) return null;
  const debugRunJob = await enqueuePipelineJob({
    organizationId: job.organizationId,
    boardId: errorEvent.boardId,
    taskId: errorEvent.taskId,
    threadId: job.threadId,
    agentId: errorEvent.debugAgentId,
    prompt: composeDebugPrompt(errorEvent, nextAttempt, reviewOutput),
    role: 'debug',
    productionErrorEventId: errorEvent.id,
    pipelineAttempt: nextAttempt,
  });

  await prisma.task.update({
    where: { id: errorEvent.taskId },
    data: { status: 'ASSIGNED', agentId: errorEvent.debugAgentId },
  }).catch(() => {});

  await prisma.productionErrorEvent.update({
    where: { id: errorEvent.id },
    data: {
      status: 'DEBUG_QUEUED',
      debugRunJobId: debugRunJob.id,
    },
  });

  return debugRunJob;
}

export async function advanceProductionErrorPipelineAfterJob(
  job: CompletedPipelineJob,
  output: string,
  options: { io?: SocketIOServer } = {},
) {
  const context = parsePipelineContext(job.contextPacket);
  if (context.source !== 'production_error_pipeline' || !context.productionErrorEventId || !context.pipelineRole) {
    return null;
  }

  const errorEvent = await prisma.productionErrorEvent.findFirst({
    where: {
      id: context.productionErrorEventId,
      organizationId: job.organizationId,
    },
  });
  if (!errorEvent) return null;

  let nextJob = null;
  if (context.pipelineRole === 'debug') {
    nextJob = await queueReviewJob(errorEvent, job, output);
  } else if (context.pipelineRole === 'review') {
    if (isReviewApproved(output)) {
      await prisma.productionErrorEvent.update({
        where: { id: errorEvent.id },
        data: { status: 'APPROVED' },
      });
      nextJob = await queueCommitJob(errorEvent, job, output);
    } else {
      const currentAttempt = context.pipelineAttempt ?? 0;
      const maxReworks = Number(process.env.PRODUCTION_ERROR_PIPELINE_MAX_REWORKS || 1);
      if (currentAttempt < maxReworks) {
        await prisma.productionErrorEvent.update({
          where: { id: errorEvent.id },
          data: { status: 'REJECTED' },
        });
        nextJob = await queueDebugReworkJob(errorEvent, job, output, currentAttempt + 1);
      } else {
        await prisma.productionErrorEvent.update({
          where: { id: errorEvent.id },
          data: { status: 'FAILED' },
        });
      }
    }
  } else if (context.pipelineRole === 'commit') {
    await prisma.productionErrorEvent.update({
      where: { id: errorEvent.id },
      data: {
        status: 'COMPLETED',
        resolvedAt: new Date(),
      },
    });
    if (errorEvent.taskId) {
      await prisma.task.update({
        where: { id: errorEvent.taskId },
        data: { status: 'DONE' },
      }).catch(() => {});
    }
  }

  await activityService.createActivity(job.organizationId, {
    agentId: job.agentId,
    type: context.pipelineRole === 'commit' ? 'TASK_COMPLETE' : 'SYSTEM',
    message: `Production error pipeline advanced after ${context.pipelineRole} job ${job.id}`,
    metadata: {
      source: 'production_error_pipeline',
      productionErrorEventId: errorEvent.id,
      pipelineRole: context.pipelineRole,
      nextRunJobId: nextJob?.id ?? null,
      boardId: job.boardId,
      taskId: job.taskId,
    },
  }).catch(err => logger.warn({ err, jobId: job.id }, 'Failed to persist production error pipeline activity'));

  emitPipelineEvent(options.io, job.organizationId, {
    id: errorEvent.id,
    pipelineRole: context.pipelineRole,
    completedRunJobId: job.id,
    nextRunJobId: nextJob?.id ?? null,
  });

  return nextJob;
}

export async function listProductionErrorEvents(
  organizationId: string,
  options: { boardId?: string; limit?: number } = {},
) {
  return prisma.productionErrorEvent.findMany({
    where: {
      organizationId,
      ...(options.boardId && { boardId: options.boardId }),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(options.limit ?? 50, 1), 100),
    include: {
      board: { select: { id: true, name: true, slug: true } },
      task: { select: { id: true, title: true, status: true } },
    },
  });
}

export async function getProductionErrorEvent(organizationId: string, id: string) {
  return prisma.productionErrorEvent.findFirst({
    where: { id, organizationId },
    include: {
      board: { select: { id: true, name: true, slug: true } },
      task: { select: { id: true, title: true, status: true } },
    },
  });
}
