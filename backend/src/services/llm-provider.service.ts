import { prisma } from '../lib/prisma.js';
import { encryptField } from '../lib/crypto.js';

export async function getProviders(organizationId: string) {
  return prisma.llmProvider.findMany({
    where: { organizationId },
    orderBy: { provider: 'asc' },
  });
}

export async function upsertProvider(organizationId: string, data: {
  provider: string;
  mode: 'BYOK' | 'PLATFORM';
  apiKey?: string;
}) {
  // Encrypt API key before storing
  const encryptedKey = data.apiKey ? encryptField(data.apiKey) : null;

  return prisma.llmProvider.upsert({
    where: { organizationId_provider: { organizationId, provider: data.provider } },
    update: {
      mode: data.mode,
      ...(data.apiKey !== undefined && { apiKey: encryptedKey }),
      isActive: true,
    },
    create: {
      organizationId,
      provider: data.provider,
      mode: data.mode,
      apiKey: encryptedKey,
      isActive: true,
    },
  });
}

export async function deleteProvider(id: string, organizationId: string) {
  return prisma.llmProvider.delete({ where: { id, organizationId } });
}

export async function getUsage(organizationId: string) {
  const [credit, providers] = await Promise.all([
    prisma.usageCredit.findUnique({ where: { organizationId } }),
    prisma.llmProvider.findMany({ where: { organizationId }, orderBy: { provider: 'asc' } }),
  ]);
  return { credit, providers };
}

export async function ensureCredit(organizationId: string) {
  return prisma.usageCredit.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId, balanceCents: 0, totalSpentCents: 0 },
  });
}
