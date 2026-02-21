import { prisma } from '../lib/prisma.js';

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// Board Groups
export async function getAllBoardGroups(organizationId: string) {
  return prisma.boardGroup.findMany({
    where: { organizationId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { boards: true } } },
  });
}

export async function createBoardGroup(organizationId: string, data: { name: string; description?: string }) {
  return prisma.boardGroup.create({
    data: {
      organizationId,
      name: data.name,
      slug: toSlug(data.name),
      description: data.description || '',
    },
    include: { _count: { select: { boards: true } } },
  });
}

export async function updateBoardGroup(id: string, organizationId: string, data: { name?: string; description?: string }) {
  return prisma.boardGroup.update({
    where: { id, organizationId },
    data: {
      ...(data.name !== undefined && { name: data.name, slug: toSlug(data.name) }),
      ...(data.description !== undefined && { description: data.description }),
    },
    include: { _count: { select: { boards: true } } },
  });
}

export async function deleteBoardGroup(id: string, organizationId: string) {
  return prisma.boardGroup.delete({ where: { id, organizationId } });
}

// Boards
export async function getAllBoards(organizationId: string) {
  return prisma.board.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { tasks: true, agents: true, approvals: true } },
      boardGroup: { select: { id: true, name: true } },
    },
  });
}

export async function getBoardById(id: string, organizationId: string) {
  return prisma.board.findFirst({
    where: { id, organizationId },
    include: {
      tasks: {
        orderBy: { updatedAt: 'desc' },
        include: { agent: { select: { id: true, displayName: true, avatar: true } } },
      },
      agents: { select: { id: true, displayName: true, avatar: true, status: true, isBoardLead: true } },
      approvals: { orderBy: { createdAt: 'desc' }, take: 20 },
      boardGroup: true,
      _count: { select: { tasks: true, agents: true, approvals: true } },
    },
  });
}

export async function createBoard(organizationId: string, data: {
  name: string;
  description?: string;
  gatewayId?: string;
  boardGroupId?: string;
  boardType?: string;
  objective?: string;
  targetDate?: string;
  maxAgents?: number;
  requireApprovalForDone?: boolean;
}) {
  return prisma.board.create({
    data: {
      organizationId,
      name: data.name,
      slug: toSlug(data.name),
      description: data.description || '',
      gatewayId: data.gatewayId || null,
      boardGroupId: data.boardGroupId || null,
      boardType: data.boardType || 'goal',
      objective: data.objective || null,
      targetDate: data.targetDate ? new Date(data.targetDate) : null,
      maxAgents: data.maxAgents ?? 3,
      requireApprovalForDone: data.requireApprovalForDone ?? true,
    },
    include: {
      _count: { select: { tasks: true, agents: true, approvals: true } },
      boardGroup: { select: { id: true, name: true } },
    },
  });
}

export async function updateBoard(id: string, organizationId: string, data: {
  name?: string;
  description?: string;
  gatewayId?: string;
  boardGroupId?: string;
  boardType?: string;
  objective?: string;
  targetDate?: string | null;
  maxAgents?: number;
  requireApprovalForDone?: boolean;
}) {
  return prisma.board.update({
    where: { id, organizationId },
    data: {
      ...(data.name !== undefined && { name: data.name, slug: toSlug(data.name) }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.gatewayId !== undefined && { gatewayId: data.gatewayId || null }),
      ...(data.boardGroupId !== undefined && { boardGroupId: data.boardGroupId || null }),
      ...(data.boardType !== undefined && { boardType: data.boardType }),
      ...(data.objective !== undefined && { objective: data.objective }),
      ...(data.targetDate !== undefined && { targetDate: data.targetDate ? new Date(data.targetDate) : null }),
      ...(data.maxAgents !== undefined && { maxAgents: data.maxAgents }),
      ...(data.requireApprovalForDone !== undefined && { requireApprovalForDone: data.requireApprovalForDone }),
    },
    include: {
      _count: { select: { tasks: true, agents: true, approvals: true } },
      boardGroup: { select: { id: true, name: true } },
    },
  });
}

export async function deleteBoard(id: string, organizationId: string) {
  return prisma.board.delete({ where: { id, organizationId } });
}

export async function addAgentToBoard(boardId: string, agentId: string, organizationId: string, isLead?: boolean) {
  // Verify both agent and board belong to the same org
  const [agent, board] = await Promise.all([
    prisma.agent.findFirst({ where: { id: agentId, organizationId } }),
    prisma.board.findFirst({ where: { id: boardId, organizationId } }),
  ]);
  if (!agent) throw new Error('Agent not found');
  if (!board) throw new Error('Board not found');

  return prisma.agent.update({
    where: { id: agentId, organizationId },
    data: { boardId, isBoardLead: isLead ?? false },
  });
}

export async function removeAgentFromBoard(agentId: string, organizationId: string) {
  return prisma.agent.update({
    where: { id: agentId, organizationId },
    data: { boardId: null, isBoardLead: false },
  });
}
