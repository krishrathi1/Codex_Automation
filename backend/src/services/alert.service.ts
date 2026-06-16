import { prisma } from '../lib/prisma.js';
import type { Severity } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';

const ACCESS_PATTERN = /(access|credential|credentials|token|unauthori[sz]ed|forbidden|permission|not authorized|eacces|enoent|workspace|failed to start codex cli command|github|vercel|mcp)/i;
const APPROVAL_PATTERN = /(approval|approve|pending approval|requires an approved|sandbox approval|human[- ]in[- ]the[- ]loop)/i;

function truncate(value: string, max = 240) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}

function classifyAgentTaskIssue(errorMessage: string, requestedKind?: string) {
  const normalizedKind = requestedKind?.trim();
  if (normalizedKind === 'access_needed' || (!normalizedKind && ACCESS_PATTERN.test(errorMessage))) {
    return {
      condition: 'agent_access_needed',
      ruleName: 'Agent needs access',
      severity: 'CRITICAL' as Severity,
      label: 'Access needed',
      nextAction: 'check repository, Vercel, MCP, token, or filesystem permissions for this agent',
    };
  }

  if (normalizedKind === 'approval_needed' || normalizedKind === 'policy_blocked' || (!normalizedKind && APPROVAL_PATTERN.test(errorMessage))) {
    return {
      condition: 'agent_approval_needed',
      ruleName: 'Agent waiting for approval',
      severity: 'WARNING' as Severity,
      label: 'Approval needed',
      nextAction: 'review the pending approval or board policy before retrying the task',
    };
  }

  return {
    condition: 'agent_task_incomplete',
    ruleName: 'Agent task incomplete',
    severity: 'CRITICAL' as Severity,
    label: 'Task incomplete',
    nextAction: 'open the run log, fix the blocker, then retry the task',
  };
}

export async function getAlertRules(organizationId: string) {
  return prisma.alertRule.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    include: {
      agent: { select: { id: true, name: true, displayName: true, avatar: true } },
      _count: { select: { events: true } },
    },
  });
}

export async function createAlertRule(organizationId: string, data: {
  name: string;
  description?: string;
  agentId?: string;
  condition: string;
  threshold?: number;
  windowMinutes?: number;
  enabled?: boolean;
}) {
  return prisma.alertRule.create({
    data: {
      organizationId,
      name: data.name,
      description: data.description,
      agentId: data.agentId || null,
      condition: data.condition,
      threshold: data.threshold ?? null,
      windowMinutes: data.windowMinutes ?? 5,
      enabled: data.enabled ?? true,
    },
    include: {
      agent: { select: { id: true, name: true, displayName: true, avatar: true } },
      _count: { select: { events: true } },
    },
  });
}

export async function updateAlertRule(
  id: string,
  organizationId: string,
  data: {
    name?: string;
    description?: string;
    agentId?: string | null;
    condition?: string;
    threshold?: number | null;
    windowMinutes?: number;
    enabled?: boolean;
  },
) {
  return prisma.alertRule.update({
    where: { id, organizationId },
    data,
    include: {
      agent: { select: { id: true, name: true, displayName: true, avatar: true } },
      _count: { select: { events: true } },
    },
  });
}

export async function getAlertEvents(organizationId: string, params?: {
  acknowledged?: boolean;
  limit?: number;
}) {
  const where: Record<string, unknown> = { organizationId };
  if (params?.acknowledged !== undefined) {
    where.acknowledged = params.acknowledged;
  }

  return prisma.alertEvent.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: params?.limit || 100,
    include: {
      alertRule: {
        select: { id: true, name: true, condition: true, agent: { select: { id: true, name: true, displayName: true, avatar: true } } },
      },
    },
  });
}

export async function acknowledgeEvent(id: string, organizationId: string) {
  return prisma.alertEvent.update({
    where: { id, organizationId },
    data: {
      acknowledged: true,
      acknowledgedAt: new Date(),
    },
    include: {
      alertRule: {
        select: { id: true, name: true, condition: true, agent: { select: { id: true, name: true, displayName: true, avatar: true } } },
      },
    },
  });
}

export async function createAgentTaskAlert(
  organizationId: string,
  data: {
    agentId?: string | null;
    boardId?: string | null;
    taskId?: string | null;
    runJobId?: string | null;
    agentName?: string | null;
    boardName?: string | null;
    taskTitle?: string | null;
    errorMessage: string;
    issueKind?: 'runtime_failure' | 'access_needed' | 'approval_needed' | 'policy_blocked';
    durationMs?: number | null;
  },
  io?: SocketIOServer,
) {
  const errorMessage = truncate(data.errorMessage || 'The agent task did not complete.');
  const issue = classifyAgentTaskIssue(errorMessage, data.issueKind);

  const [agent, board, task] = await Promise.all([
    data.agentId
      ? prisma.agent.findFirst({
          where: { id: data.agentId, organizationId },
          select: { id: true, displayName: true },
        })
      : Promise.resolve(null),
    data.boardId
      ? prisma.board.findFirst({
          where: { id: data.boardId, organizationId },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
    data.taskId
      ? prisma.task.findFirst({
          where: { id: data.taskId, organizationId },
          select: { id: true, title: true },
        })
      : Promise.resolve(null),
  ]);

  const agentName = data.agentName || agent?.displayName || 'Unassigned agent';
  const boardName = data.boardName || board?.name || 'No production group';
  const taskTitle = data.taskTitle || task?.title || 'untitled task';
  const duration = typeof data.durationMs === 'number' ? ` Duration=${Math.round(data.durationMs / 100) / 10}s.` : '';
  const ids = [
    data.runJobId ? `run=${data.runJobId}` : null,
    data.taskId ? `task=${data.taskId}` : null,
    data.boardId ? `group=${data.boardId}` : null,
  ].filter(Boolean).join(', ');

  const message = `${issue.label}: ${agentName} did not complete "${taskTitle}" in ${boardName}. Reason: ${errorMessage}.${duration} Next: ${issue.nextAction}.${ids ? ` ${ids}` : ''}`;

  const rule = await prisma.alertRule.findFirst({
    where: {
      organizationId,
      agentId: data.agentId || null,
      condition: issue.condition,
      name: issue.ruleName,
    },
  }) || await prisma.alertRule.create({
    data: {
      organizationId,
      agentId: data.agentId || null,
      name: issue.ruleName,
      description: 'Automatically created when a production group agent cannot finish its assigned task.',
      condition: issue.condition,
      threshold: 1,
      windowMinutes: 5,
      enabled: true,
    },
  });

  await prisma.alertRule.update({
    where: { id: rule.id },
    data: { lastTriggered: new Date(), enabled: true },
  }).catch(() => {});

  const event = await prisma.alertEvent.create({
    data: {
      organizationId,
      alertRuleId: rule.id,
      message,
      severity: issue.severity,
    },
    include: {
      alertRule: {
        select: {
          id: true,
          name: true,
          condition: true,
          agent: { select: { id: true, name: true, displayName: true, avatar: true } },
        },
      },
    },
  });

  io?.to(`org:${organizationId}`).emit('alert:new', event);
  return event;
}
