import { prisma } from '../lib/prisma.js';
import { afterAll, beforeAll } from 'vitest';

beforeAll(async () => {
  // Verify DB connection
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Helper to clean up test data created during tests.
 * Call in afterEach or afterAll to keep the DB clean.
 */
export async function cleanupTestData(orgId: string) {
  // Delete in order respecting foreign key constraints
  await prisma.approval.deleteMany({ where: { board: { organizationId: orgId } } });
  await prisma.boardMemory.deleteMany({ where: { board: { organizationId: orgId } } });
  await prisma.taskDependency.deleteMany({
    where: { dependentTask: { organizationId: orgId } },
  });
  await prisma.mcpTool.deleteMany({
    where: { mcpServer: { agent: { organizationId: orgId } } },
  });
  await prisma.mcpServer.deleteMany({
    where: { agent: { organizationId: orgId } },
  });
  await prisma.command.deleteMany({ where: { organizationId: orgId } });
  await prisma.alertEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.alertRule.deleteMany({ where: { organizationId: orgId } });
  await prisma.metricSnapshot.deleteMany({ where: { organizationId: orgId } });
  await prisma.tokenUsage.deleteMany({ where: { organizationId: orgId } });
  await prisma.session.deleteMany({ where: { organizationId: orgId } });
  await prisma.message.deleteMany({
    where: { thread: { organizationId: orgId } },
  });
  await prisma.thread.deleteMany({ where: { organizationId: orgId } });
  await prisma.task.deleteMany({ where: { organizationId: orgId } });
  await prisma.activity.deleteMany({ where: { organizationId: orgId } });
  await prisma.agent.deleteMany({ where: { organizationId: orgId } });
  await prisma.board.deleteMany({ where: { organizationId: orgId } });
  await prisma.boardGroup.deleteMany({ where: { organizationId: orgId } });
  await prisma.gateway.deleteMany({ where: { organizationId: orgId } });
  await prisma.llmProvider.deleteMany({ where: { organizationId: orgId } });
  await prisma.usageCredit.deleteMany({ where: { organizationId: orgId } });
  await prisma.orgApiKey.deleteMany({ where: { organizationId: orgId } });
  await prisma.refreshToken.deleteMany({
    where: { user: { memberships: { some: { organizationId: orgId } } } },
  });
  await prisma.orgMember.deleteMany({ where: { organizationId: orgId } });
  // Find users that only belong to this org
  const users = await prisma.user.findMany({
    where: { memberships: { none: {} } },
  });
  if (users.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  }
  await prisma.organization.deleteMany({ where: { id: orgId } });
}

/**
 * Create a test user + org + membership, returns auth tokens and IDs.
 */
export async function createTestUser(suffix = '') {
  const { signup } = await import('../services/auth.service.js');
  const ts = Date.now();
  const result = await signup({
    email: `test${suffix}-${ts}@nexus-test.local`,
    password: 'TestPass123!',
    name: `Test User ${suffix}`,
    orgName: `Test Org ${suffix || ts}`,
  });
  return result;
}
