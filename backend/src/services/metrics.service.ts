import { prisma } from '../lib/prisma.js';

export async function getTokenUsage(organizationId: string, params?: { agentId?: string; hours?: number }) {
  const where: Record<string, unknown> = { organizationId };
  if (params?.agentId) where.agentId = params.agentId;
  if (params?.hours) {
    where.createdAt = { gte: new Date(Date.now() - params.hours * 60 * 60 * 1000) };
  }

  return prisma.tokenUsage.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { agent: { select: { name: true, displayName: true, avatar: true } } },
  });
}

export async function getTokenSummary(organizationId: string) {
  const usages = await prisma.tokenUsage.findMany({
    where: { organizationId },
    include: { agent: { select: { id: true, name: true, displayName: true, avatar: true } } },
  });

  const totalTokens = usages.reduce((sum, u) => sum + u.totalTokens, 0);
  const totalCost = usages.reduce((sum, u) => sum + u.cost, 0);

  const agentMap = new Map<string, {
    agentId: string;
    agentName: string;
    displayName: string;
    avatar: string | null;
    totalTokens: number;
    totalCost: number;
  }>();

  for (const u of usages) {
    const existing = agentMap.get(u.agentId);
    if (existing) {
      existing.totalTokens += u.totalTokens;
      existing.totalCost += u.cost;
    } else {
      agentMap.set(u.agentId, {
        agentId: u.agentId,
        agentName: u.agent.name,
        displayName: u.agent.displayName,
        avatar: u.agent.avatar,
        totalTokens: u.totalTokens,
        totalCost: u.cost,
      });
    }
  }

  return {
    totalTokens,
    totalCost,
    byAgent: Array.from(agentMap.values()),
  };
}

export async function getMetrics(organizationId: string, params?: { agentId?: string; limit?: number }) {
  const where: Record<string, unknown> = { organizationId };
  if (params?.agentId) where.agentId = params.agentId;

  return prisma.metricSnapshot.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: params?.limit || 500,
    include: { agent: { select: { name: true, displayName: true, avatar: true } } },
  });
}

export async function getMetricsSummary(organizationId: string) {
  const metrics = await prisma.metricSnapshot.findMany({
    where: { organizationId },
    include: { agent: { select: { id: true, name: true, displayName: true, avatar: true } } },
  });

  const agentMap = new Map<string, {
    agentId: string;
    agentName: string;
    displayName: string;
    avatar: string | null;
    responseTimes: number[];
    successCount: number;
    totalCalls: number;
  }>();

  for (const m of metrics) {
    const existing = agentMap.get(m.agentId);
    if (existing) {
      existing.responseTimes.push(m.responseTimeMs);
      if (m.success) existing.successCount++;
      existing.totalCalls++;
    } else {
      agentMap.set(m.agentId, {
        agentId: m.agentId,
        agentName: m.agent.name,
        displayName: m.agent.displayName,
        avatar: m.agent.avatar,
        responseTimes: [m.responseTimeMs],
        successCount: m.success ? 1 : 0,
        totalCalls: 1,
      });
    }
  }

  const byAgent = Array.from(agentMap.values()).map((a) => {
    const sorted = a.responseTimes.slice().sort((x, y) => x - y);
    const avg = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
    const p95Index = Math.ceil(sorted.length * 0.95) - 1;
    const p95 = sorted[Math.max(0, p95Index)] ?? 0;

    return {
      agentId: a.agentId,
      agentName: a.agentName,
      displayName: a.displayName,
      avatar: a.avatar,
      avgResponseTime: Math.round(avg),
      p95ResponseTime: p95,
      successRate: a.totalCalls > 0 ? Math.round((a.successCount / a.totalCalls) * 10000) / 100 : 0,
      totalCalls: a.totalCalls,
    };
  });

  return { byAgent };
}
