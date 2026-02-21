import { prisma } from '../lib/prisma.js';
import type { ActivityType, Prisma } from '@prisma/client';

export async function sendCommand(organizationId: string, data: {
  agentId: string;
  type: string;
  payload?: Record<string, unknown>;
  issuedBy?: string;
}) {
  return prisma.command.create({
    data: {
      organizationId,
      agentId: data.agentId,
      type: data.type,
      payload: (data.payload as Prisma.InputJsonValue) ?? undefined,
      status: 'PENDING',
      issuedBy: data.issuedBy ?? null,
    },
    include: {
      agent: { select: { id: true, name: true, displayName: true, avatar: true } },
    },
  });
}

export async function getCommands(organizationId: string, agentId?: string) {
  const where: Record<string, unknown> = { organizationId };
  if (agentId) where.agentId = agentId;

  return prisma.command.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      agent: { select: { id: true, name: true, displayName: true, avatar: true } },
    },
  });
}

export async function searchActivities(
  organizationId: string,
  query: string,
  params?: { agentId?: string; type?: ActivityType; limit?: number }
) {
  const { agentId, type, limit = 100 } = params ?? {};

  const where: Record<string, unknown> = {
    organizationId,
    message: { contains: query, mode: 'insensitive' },
  };
  if (agentId) where.agentId = agentId;
  if (type) where.type = type;

  const [activities, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { agent: { select: { name: true, displayName: true, avatar: true } } },
    }),
    prisma.activity.count({ where }),
  ]);

  return { activities, total };
}

export async function getAgentConfig(id: string, organizationId: string) {
  return prisma.agent.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      name: true,
      displayName: true,
      workspace: true,
      description: true,
      status: true,
      avatar: true,
      enabled: true,
      soulMd: true,
      heartbeatInterval: true,
      currentTask: true,
      lastHeartbeat: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function updateAgentConfig(
  id: string,
  organizationId: string,
  data: { soulMd?: string; enabled?: boolean; heartbeatInterval?: number }
) {
  return prisma.agent.update({
    where: { id, organizationId },
    data: {
      ...(data.soulMd !== undefined && { soulMd: data.soulMd }),
      ...(data.enabled !== undefined && { enabled: data.enabled }),
      ...(data.heartbeatInterval !== undefined && { heartbeatInterval: data.heartbeatInterval }),
    },
  });
}
