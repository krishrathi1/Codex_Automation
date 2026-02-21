import { prisma } from '../lib/prisma.js';
import type { ActivityType } from '@prisma/client';

export async function getActivities(organizationId: string, options: {
  agentId?: string;
  type?: ActivityType;
  limit?: number;
  offset?: number;
  since?: Date;
}) {
  const { agentId, type, limit = 50, offset = 0, since } = options;

  const where: Record<string, unknown> = { organizationId };
  if (agentId) where.agentId = agentId;
  if (type) where.type = type;
  if (since) where.createdAt = { gte: since };

  const [activities, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: { agent: { select: { name: true, displayName: true, avatar: true } } },
    }),
    prisma.activity.count({ where }),
  ]);

  return { activities, total, limit, offset };
}

export async function createActivity(organizationId: string, data: {
  agentId: string;
  type: ActivityType;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.activity.create({
    data: {
      agentId: data.agentId,
      organizationId,
      type: data.type,
      message: data.message,
      metadata: data.metadata as any,
    },
    include: { agent: { select: { name: true, displayName: true, avatar: true } } },
  });
}
