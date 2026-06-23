import { prisma } from '../lib/prisma.js';

// Ensure the board belongs to the caller's org before any memory access.
async function assertBoardInOrg(boardId: string, organizationId: string) {
  const board = await prisma.board.findFirst({ where: { id: boardId, organizationId }, select: { id: true } });
  if (!board) {
    const err = new Error('Board not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
}

export async function addMemory(boardId: string, organizationId: string, data: {
  content: string;
  tags?: string[];
  isChat?: boolean;
  source?: string;
}) {
  await assertBoardInOrg(boardId, organizationId);
  return prisma.boardMemory.create({
    data: {
      boardId,
      content: data.content,
      tags: data.tags ?? [],
      isChat: data.isChat ?? false,
      source: data.source,
    },
  });
}

export async function listMemory(boardId: string, organizationId: string, options?: {
  limit?: number;
  offset?: number;
  since?: Date;
  isChat?: boolean;
}) {
  return prisma.boardMemory.findMany({
    where: {
      boardId,
      board: { organizationId },
      ...(options?.since && { createdAt: { gte: options.since } }),
      ...(options?.isChat !== undefined && { isChat: options.isChat }),
    },
    orderBy: { createdAt: 'desc' },
    take: options?.limit ?? 50,
    skip: options?.offset ?? 0,
  });
}

export async function deleteMemory(id: string, boardId: string, organizationId: string) {
  // deleteMany with the org-scoped board relation: a cross-org id affects 0 rows.
  return prisma.boardMemory.deleteMany({ where: { id, boardId, board: { organizationId } } });
}
