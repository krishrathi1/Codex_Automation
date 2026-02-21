import { prisma } from '../lib/prisma.js';
import type { TaskStatus, Priority } from '@prisma/client';

export async function getAllTasks(organizationId: string) {
  return prisma.task.findMany({
    where: { organizationId },
    orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
    include: { agent: { select: { id: true, name: true, displayName: true, avatar: true } } },
  });
}

export async function createTask(organizationId: string, data: {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  agentId?: string;
}) {
  return prisma.task.create({
    data: {
      organizationId,
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      agentId: data.agentId,
    },
    include: { agent: { select: { id: true, name: true, displayName: true, avatar: true } } },
  });
}

export async function updateTask(
  id: string,
  organizationId: string,
  data: {
    title?: string;
    description?: string;
    status?: TaskStatus;
    priority?: Priority;
    agentId?: string | null;
  }
) {
  return prisma.task.update({
    where: { id, organizationId },
    data,
    include: { agent: { select: { id: true, name: true, displayName: true, avatar: true } } },
  });
}

export async function deleteTask(id: string, organizationId: string) {
  return prisma.task.delete({ where: { id, organizationId } });
}
