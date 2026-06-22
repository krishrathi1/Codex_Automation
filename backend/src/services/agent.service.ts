import { prisma } from '../lib/prisma.js';
import type { AgentStatus } from '@prisma/client';
import { logger } from '../lib/logger.js';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { ADMIN_AGENT_NAME } from './system-agent.service.js';

const SYSTEM_AGENT_NAMES = ['__mother_chat__', ADMIN_AGENT_NAME];

function normalizeVisibleAgentName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

async function ensureVisibleAgentNameAvailable(
  organizationId: string,
  displayName: string,
  excludeAgentId?: string,
) {
  const normalized = normalizeVisibleAgentName(displayName);
  if (!normalized) {
    const err = new Error('Display Name is required') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  const existingAgents = await prisma.agent.findMany({
    where: {
      organizationId,
      name: { notIn: SYSTEM_AGENT_NAMES },
      ...(excludeAgentId ? { id: { not: excludeAgentId } } : {}),
    },
    select: { id: true, displayName: true, board: { select: { name: true } } },
  });
  const duplicate = existingAgents.find(agent => (
    normalizeVisibleAgentName(agent.displayName).toLowerCase() === normalized.toLowerCase()
  ));
  if (duplicate) {
    const suffix = duplicate.board?.name ? ` in "${duplicate.board.name}"` : '';
    const err = new Error(`Agent display name "${normalized}" is already used${suffix}. Use a unique sub-agent name for each group.`) as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }

  return normalized;
}

const tracer = trace.getTracer('nexus-agent');

type RuntimeIdentityProfile = Record<string, unknown> & {
  activeWorkflowSessionId?: string;
  agentRuntime?: string;
  workflowSessionPolicy?: string;
};

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function getRuntimeIdentityProfile(organizationId: string): Promise<RuntimeIdentityProfile> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });
  const settings = objectRecord(org?.settings);
  const activeWorkflowSessionId =
    typeof settings.activeWorkflowSessionId === 'string' ? settings.activeWorkflowSessionId : undefined;

  return {
    activeWorkflowSessionId,
    agentRuntime: typeof settings.activeAgentRuntime === 'string' ? settings.activeAgentRuntime : 'claude-cli',
    workflowSessionPolicy:
      typeof settings.workflowSessionPolicy === 'string'
        ? settings.workflowSessionPolicy
        : 'single-session-for-agents-and-workflows',
  };
}

export async function getAllAgents(organizationId: string) {
  return prisma.agent.findMany({
    where: { organizationId, name: { notIn: SYSTEM_AGENT_NAMES } },
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { activities: true, tasks: true } },
    },
  });
}

export async function getAgentById(id: string, organizationId: string) {
  return prisma.agent.findFirst({
    where: { id, organizationId },
    include: {
      activities: {
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
      tasks: {
        orderBy: { updatedAt: 'desc' },
      },
      agentSkills: {
        include: { skill: true },
        orderBy: { createdAt: 'asc' },
      },
      integrations: {
        orderBy: { createdAt: 'asc' },
      },
      _count: { select: { activities: true, tasks: true } },
    },
  });
}

export async function getAgentByName(organizationId: string, name: string) {
  return prisma.agent.findUnique({ where: { organizationId_name: { organizationId, name } } });
}

export async function updateAgentStatus(id: string, organizationId: string, status: AgentStatus, currentTask?: string) {
  return prisma.agent.update({
    where: { id, organizationId },
    data: { status, currentTask, updatedAt: new Date() },
  });
}

export async function recordHeartbeat(id: string, organizationId: string) {
  return prisma.agent.update({
    where: { id, organizationId },
    data: { lastHeartbeat: new Date(), status: 'ONLINE' },
  });
}

export async function getAgentStats(organizationId: string) {
  const visibleAgents = { organizationId, name: { notIn: SYSTEM_AGENT_NAMES } };
  const [total, online, idle, offline, error] = await Promise.all([
    prisma.agent.count({ where: visibleAgents }),
    prisma.agent.count({ where: { ...visibleAgents, status: 'ONLINE' } }),
    prisma.agent.count({ where: { ...visibleAgents, status: 'IDLE' } }),
    prisma.agent.count({ where: { ...visibleAgents, status: 'OFFLINE' } }),
    prisma.agent.count({ where: { ...visibleAgents, status: 'ERROR' } }),
  ]);
  const recentActivities = await prisma.activity.count({
    where: { organizationId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  const activeTasks = await prisma.task.count({
    where: { organizationId, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'REVIEW'] } },
  });
  return { total, online, idle, offline, error, recentActivities, activeTasks };
}

export async function createAgent(organizationId: string, data: {
  name: string;
  displayName: string;
  description: string;
  workspace?: string;
  avatar?: string;
  heartbeatInterval?: number;
  heartbeatConfig?: Record<string, unknown>;
  identityProfile?: Record<string, unknown>;
  identityTemplate?: string;
  soulMd?: string;
  soulTemplateId?: string;
  enabled?: boolean;
  gatewayId?: string;
}) {
  const displayName = await ensureVisibleAgentNameAvailable(organizationId, data.displayName);
  const runtimeIdentityProfile = await getRuntimeIdentityProfile(organizationId);
  const identityProfile = {
    ...objectRecord(data.identityProfile),
    ...runtimeIdentityProfile,
  };

  const agent = await prisma.agent.create({
    data: {
      organizationId,
      name: data.name,
      displayName,
      description: data.description,
      workspace: data.workspace ?? '',
      avatar: data.avatar ?? null,
      heartbeatInterval: data.heartbeatInterval ?? 30,
      heartbeatConfig: data.heartbeatConfig as any ?? undefined,
      identityProfile: identityProfile as any,
      identityTemplate: data.identityTemplate ?? null,
      soulMd: data.soulMd ?? null,
      soulTemplateId: data.soulTemplateId ?? null,
      enabled: data.enabled ?? true,
      gatewayId: data.gatewayId ?? null,
      agentToAgent: true,
    },
    include: {
      _count: { select: { activities: true, tasks: true } },
    },
  });

  return agent;
}

export async function deleteAgent(id: string, organizationId: string) {
  const agent = await prisma.agent.findFirst({ where: { id, organizationId } });
  if (!agent) throw new Error('Agent not found');

  return prisma.agent.delete({ where: { id, organizationId } });
}

export async function updateAgent(id: string, organizationId: string, data: {
  name?: string;
  displayName?: string;
  description?: string;
  workspace?: string;
  avatar?: string;
  heartbeatInterval?: number;
  heartbeatConfig?: Record<string, unknown>;
  identityProfile?: Record<string, unknown>;
  identityTemplate?: string;
  soulMd?: string;
  soulTemplateId?: string;
  enabled?: boolean;
  currentTask?: string;
  gatewayId?: string;
  agentToAgent?: boolean;
}) {
  const existingAgent = await prisma.agent.findFirst({
    where: { id, organizationId },
    select: { identityProfile: true },
  });
  if (!existingAgent) throw new Error('Agent not found');

  const runtimeIdentityProfile = await getRuntimeIdentityProfile(organizationId);
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.displayName !== undefined) {
    updateData.displayName = await ensureVisibleAgentNameAvailable(organizationId, data.displayName, id);
  }
  if (data.description !== undefined) updateData.description = data.description;
  if (data.workspace !== undefined) updateData.workspace = data.workspace;
  if (data.avatar !== undefined) updateData.avatar = data.avatar;
  if (data.heartbeatInterval !== undefined) updateData.heartbeatInterval = data.heartbeatInterval;
  if (data.heartbeatConfig !== undefined) updateData.heartbeatConfig = data.heartbeatConfig;
  updateData.identityProfile = {
    ...objectRecord(existingAgent.identityProfile),
    ...objectRecord(data.identityProfile),
    ...runtimeIdentityProfile,
  };
  if (data.identityTemplate !== undefined) updateData.identityTemplate = data.identityTemplate;
  if (data.soulMd !== undefined) updateData.soulMd = data.soulMd;
  if (data.soulTemplateId !== undefined) updateData.soulTemplateId = data.soulTemplateId;
  if (data.enabled !== undefined) updateData.enabled = data.enabled;
  if (data.currentTask !== undefined) updateData.currentTask = data.currentTask;
  if (data.gatewayId !== undefined) updateData.gatewayId = data.gatewayId;
  if (data.agentToAgent !== undefined) updateData.agentToAgent = data.agentToAgent;

  const agent = await prisma.agent.update({
    where: { id, organizationId },
    data: updateData as any,
    include: {
      _count: { select: { activities: true, tasks: true } },
    },
  });

  return agent;
}
