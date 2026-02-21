import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { ApprovalStatus } from '@prisma/client';

export async function getApprovals(organizationId: string, params?: {
  boardId?: string;
  status?: ApprovalStatus;
  limit?: number;
}) {
  return prisma.approval.findMany({
    where: {
      board: { organizationId },
      ...(params?.boardId && { boardId: params.boardId }),
      ...(params?.status && { status: params.status }),
    },
    orderBy: { createdAt: 'desc' },
    take: params?.limit || 50,
    include: {
      board: { select: { id: true, name: true, slug: true } },
      task: { select: { id: true, title: true, status: true } },
      agent: { select: { id: true, displayName: true, avatar: true } },
    },
  });
}

export async function getApprovalById(id: string, organizationId: string) {
  return prisma.approval.findFirst({
    where: { id, board: { organizationId } },
    include: {
      board: { select: { id: true, name: true, slug: true } },
      task: { select: { id: true, title: true, status: true, description: true } },
      agent: { select: { id: true, displayName: true, avatar: true } },
    },
  });
}

export async function createApproval(organizationId: string, data: {
  boardId: string;
  taskId?: string;
  agentId?: string;
  actionType: string;
  payload?: Record<string, unknown>;
  confidence?: number;
}) {
  // Verify the board belongs to this org
  const board = await prisma.board.findFirst({ where: { id: data.boardId, organizationId } });
  if (!board) throw new Error('Board not found');

  return prisma.approval.create({
    data: {
      boardId: data.boardId,
      taskId: data.taskId || null,
      agentId: data.agentId || null,
      actionType: data.actionType,
      payload: data.payload ? (data.payload as Prisma.InputJsonValue) : Prisma.JsonNull,
      confidence: data.confidence ?? null,
      status: 'PENDING',
    },
    include: {
      board: { select: { id: true, name: true, slug: true } },
      task: { select: { id: true, title: true, status: true } },
      agent: { select: { id: true, displayName: true, avatar: true } },
    },
  });
}

export async function resolveApproval(id: string, organizationId: string, status: 'APPROVED' | 'REJECTED') {
  // Verify org ownership
  const approval = await prisma.approval.findFirst({
    where: { id, board: { organizationId } },
  });
  if (!approval) throw new Error('Approval not found');

  const updated = await prisma.approval.update({
    where: { id },
    data: { status, resolvedAt: new Date() },
    include: {
      board: { select: { id: true, name: true, slug: true } },
      task: { select: { id: true, title: true, status: true } },
      agent: { select: { id: true, displayName: true, avatar: true } },
    },
  });

  // If approved and has a task, move task to DONE
  if (status === 'APPROVED' && updated.taskId && updated.actionType === 'COMPLETE_TASK') {
    await prisma.task.update({
      where: { id: updated.taskId },
      data: { status: 'DONE' },
    });
  }

  return updated;
}

export async function getApprovalStats(organizationId: string) {
  const [pending, approved, rejected] = await Promise.all([
    prisma.approval.count({ where: { board: { organizationId }, status: 'PENDING' } }),
    prisma.approval.count({ where: { board: { organizationId }, status: 'APPROVED' } }),
    prisma.approval.count({ where: { board: { organizationId }, status: 'REJECTED' } }),
  ]);
  return { pending, approved, rejected, total: pending + approved + rejected };
}
