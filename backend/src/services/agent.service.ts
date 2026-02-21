import { prisma } from '../lib/prisma.js';
import type { AgentStatus } from '@prisma/client';
import { getGatewayClient } from '../openclaw/client.js';
import { logger } from '../lib/logger.js';

export async function getAllAgents(organizationId: string) {
  return prisma.agent.findMany({
    where: { organizationId },
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
  const [total, online, idle, offline, error] = await Promise.all([
    prisma.agent.count({ where: { organizationId } }),
    prisma.agent.count({ where: { organizationId, status: 'ONLINE' } }),
    prisma.agent.count({ where: { organizationId, status: 'IDLE' } }),
    prisma.agent.count({ where: { organizationId, status: 'OFFLINE' } }),
    prisma.agent.count({ where: { organizationId, status: 'ERROR' } }),
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
  soulMd?: string;
  enabled?: boolean;
  gatewayId?: string;
}) {
  // Get org slug for gateway agent naming
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
  const gatewayAgentName = org ? `${org.slug}--${data.name}` : data.name;

  // Create in DB first
  const agent = await prisma.agent.create({
    data: {
      organizationId,
      name: data.name,
      displayName: data.displayName,
      description: data.description,
      workspace: data.workspace ?? '',
      avatar: data.avatar ?? null,
      heartbeatInterval: data.heartbeatInterval ?? 30,
      soulMd: data.soulMd ?? null,
      enabled: data.enabled ?? true,
      gatewayId: data.gatewayId ?? null,
    },
    include: {
      _count: { select: { activities: true, tasks: true } },
    },
  });

  // If gateway is specified, create real OpenClaw agent
  if (data.gatewayId) {
    try {
      const client = getGatewayClient(data.gatewayId);
      if (client && client.isConnected()) {
        const result = await client.rpc('agents.create', {
          name: gatewayAgentName,
          workspace: data.workspace || `~/.openclaw/agents/${gatewayAgentName}`,
          emoji: data.avatar || undefined,
        }) as { agentId: string };

        // Update DB with gateway agent ID
        await prisma.agent.update({
          where: { id: agent.id },
          data: { gatewayAgentId: result.agentId },
        });
        (agent as any).gatewayAgentId = result.agentId;

        // Set SOUL.md if provided
        if (data.soulMd) {
          await client.rpc('agents.files.set', {
            agentId: result.agentId,
            name: 'SOUL.md',
            content: data.soulMd,
          });
        }

        logger.info({ gatewayAgentId: result.agentId, agent: agent.name }, 'Created gateway agent');
      }
    } catch (err) {
      logger.warn({ agent: agent.name, err }, 'Failed to create gateway agent');
      // Agent is still created in DB, can sync later
    }
  }

  return agent;
}

export async function deleteAgent(id: string, organizationId: string) {
  // Get agent to check for gateway connection
  const agent = await prisma.agent.findFirst({ where: { id, organizationId } });
  if (!agent) throw new Error('Agent not found');

  // Delete from gateway if connected
  if (agent.gatewayId && agent.gatewayAgentId) {
    try {
      const client = getGatewayClient(agent.gatewayId);
      if (client && client.isConnected()) {
        await client.rpc('agents.delete', { agentId: agent.gatewayAgentId });
        logger.info({ gatewayAgentId: agent.gatewayAgentId }, 'Deleted gateway agent');
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to delete gateway agent');
    }
  }

  return prisma.agent.delete({ where: { id, organizationId } });
}

export async function updateAgent(id: string, organizationId: string, data: {
  name?: string;
  displayName?: string;
  description?: string;
  workspace?: string;
  avatar?: string;
  heartbeatInterval?: number;
  soulMd?: string;
  enabled?: boolean;
  currentTask?: string;
  gatewayId?: string;
}) {
  const agent = await prisma.agent.update({
    where: { id, organizationId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.displayName !== undefined && { displayName: data.displayName }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.workspace !== undefined && { workspace: data.workspace }),
      ...(data.avatar !== undefined && { avatar: data.avatar }),
      ...(data.heartbeatInterval !== undefined && { heartbeatInterval: data.heartbeatInterval }),
      ...(data.soulMd !== undefined && { soulMd: data.soulMd }),
      ...(data.enabled !== undefined && { enabled: data.enabled }),
      ...(data.currentTask !== undefined && { currentTask: data.currentTask }),
      ...(data.gatewayId !== undefined && { gatewayId: data.gatewayId }),
    },
    include: {
      _count: { select: { activities: true, tasks: true } },
    },
  });

  // Sync changes to gateway if connected
  if (agent.gatewayId && agent.gatewayAgentId) {
    try {
      const client = getGatewayClient(agent.gatewayId);
      if (client && client.isConnected()) {
        // Update agent in gateway
        if (data.name || data.workspace || data.avatar) {
          await client.rpc('agents.update', {
            agentId: agent.gatewayAgentId,
            ...(data.name && { name: data.name }),
            ...(data.workspace && { workspace: data.workspace }),
            ...(data.avatar && { avatar: data.avatar }),
          });
        }
        // Update SOUL.md if changed
        if (data.soulMd !== undefined) {
          await client.rpc('agents.files.set', {
            agentId: agent.gatewayAgentId,
            name: 'SOUL.md',
            content: data.soulMd || '',
          });
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to sync gateway agent');
    }
  }

  return agent;
}
