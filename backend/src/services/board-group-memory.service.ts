import { prisma } from '../lib/prisma.js';

// Ensure the board group belongs to the caller's org before any memory access.
async function assertGroupInOrg(boardGroupId: string, organizationId: string) {
  const group = await prisma.boardGroup.findFirst({ where: { id: boardGroupId, organizationId }, select: { id: true } });
  if (!group) {
    const err = new Error('Board group not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
}

export async function addMemory(boardGroupId: string, organizationId: string, data: {
  content: string;
  tags?: string[];
  isChat?: boolean;
  source?: string;
}) {
  await assertGroupInOrg(boardGroupId, organizationId);
  return prisma.boardGroupMemory.create({
    data: {
      boardGroupId,
      content: data.content,
      tags: data.tags ?? [],
      isChat: data.isChat ?? false,
      source: data.source,
    },
  });
}

export async function listMemory(boardGroupId: string, organizationId: string, options?: { limit?: number; offset?: number; since?: Date }) {
  return prisma.boardGroupMemory.findMany({
    where: {
      boardGroupId,
      boardGroup: { organizationId },
      ...(options?.since && { createdAt: { gte: options.since } }),
    },
    orderBy: { createdAt: 'desc' },
    take: options?.limit ?? 50,
    skip: options?.offset ?? 0,
  });
}

export async function deleteMemory(id: string, boardGroupId: string, organizationId: string) {
  // deleteMany scoped through the org-owned group: a cross-org id affects 0 rows.
  return prisma.boardGroupMemory.deleteMany({ where: { id, boardGroupId, boardGroup: { organizationId } } });
}

export async function addFromBoard(boardId: string, organizationId: string, data: {
  content: string;
  tags?: string[];
  isChat?: boolean;
  source?: string;
}) {
  const board = await prisma.board.findFirst({
    where: { id: boardId, organizationId },
    select: { boardGroupId: true },
  });
  if (!board?.boardGroupId) throw new Error('Board is not part of a group');

  return addMemory(board.boardGroupId, organizationId, data);
}

export async function listForBoard(boardId: string, organizationId: string, options?: { limit?: number; since?: Date }) {
  const board = await prisma.board.findFirst({
    where: { id: boardId, organizationId },
    select: { boardGroupId: true },
  });
  if (!board?.boardGroupId) return [];

  return listMemory(board.boardGroupId, organizationId, options);
}
