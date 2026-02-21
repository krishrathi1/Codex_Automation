import { prisma } from '../lib/prisma.js';

const agentSelectFields = {
  id: true,
  name: true,
  displayName: true,
  avatar: true,
  status: true,
} as const;

export async function getAllThreads(organizationId: string) {
  return prisma.thread.findMany({
    where: { organizationId },
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        include: {
          sender: { select: agentSelectFields },
          receiver: { select: agentSelectFields },
        },
      },
    },
  });
}

export async function getThreadById(id: string, organizationId: string) {
  return prisma.thread.findFirst({
    where: { id, organizationId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        include: {
          sender: { select: agentSelectFields },
          receiver: { select: agentSelectFields },
        },
      },
    },
  });
}

export async function getCommGraph(organizationId: string) {
  // Get all agents that have participated in at least one message
  const agents = await prisma.agent.findMany({
    where: {
      organizationId,
      OR: [
        { sentMessages: { some: {} } },
        { receivedMessages: { some: {} } },
      ],
    },
    select: agentSelectFields,
  });

  // Aggregate messages between each pair of agents
  const messages = await prisma.message.groupBy({
    by: ['senderId', 'receiverId'],
    where: {
      thread: { organizationId },
    },
    _count: { id: true },
    _max: { createdAt: true },
  });

  // Build edges: combine both directions (A->B and B->A) into one edge
  const edgeMap = new Map<string, { source: string; target: string; messageCount: number; lastMessage: string }>();

  for (const msg of messages) {
    // Create a canonical key so A->B and B->A merge into one edge
    const [first, second] = [msg.senderId, msg.receiverId].sort();
    const key = `${first}::${second}`;

    const existing = edgeMap.get(key);
    if (existing) {
      existing.messageCount += msg._count.id;
      // Keep the most recent timestamp
      const existingDate = new Date(existing.lastMessage);
      const newDate = msg._max.createdAt!;
      if (newDate > existingDate) {
        existing.lastMessage = newDate.toISOString();
      }
    } else {
      edgeMap.set(key, {
        source: first,
        target: second,
        messageCount: msg._count.id,
        lastMessage: msg._max.createdAt!.toISOString(),
      });
    }
  }

  return {
    nodes: agents,
    edges: Array.from(edgeMap.values()),
  };
}
