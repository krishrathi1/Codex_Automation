import { prisma } from '../lib/prisma.js';

export const ADMIN_AGENT_NAME = '__admin__';

export async function getOrCreateAdminAgent(organizationId: string) {
  const existing = await prisma.agent.findUnique({
    where: { organizationId_name: { organizationId, name: ADMIN_AGENT_NAME } },
  });
  if (existing) return existing;

  return prisma.agent.create({
    data: {
      organizationId,
      name: ADMIN_AGENT_NAME,
      displayName: 'Admin',
      description: 'Nexus administrator actor for human-to-agent conversations.',
      workspace: '',
      status: 'IDLE',
      enabled: false,
      agentToAgent: false,
      avatar: 'A',
      identityProfile: {
        systemRole: 'admin',
        actorType: 'human-admin',
      },
    },
  });
}
