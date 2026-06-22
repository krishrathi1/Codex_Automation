import bcrypt from 'bcryptjs';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { populateOrgDefaults } from './org-defaults.service.js';

const DEFAULT_ADMIN_EMAIL = 'admin@nexus.local';
const DEFAULT_ADMIN_PASSWORD = 'admin123';
const DEFAULT_ADMIN_NAME = 'Admin';
const DEFAULT_ORG_NAME = 'Nexus Local';

export function getDevelopmentAdminCredentials() {
  return {
    email: process.env.DEV_ADMIN_EMAIL?.trim().toLowerCase() || DEFAULT_ADMIN_EMAIL,
    password: process.env.DEV_ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD,
    name: process.env.DEV_ADMIN_NAME?.trim() || DEFAULT_ADMIN_NAME,
  };
}

export function isDevelopmentAdminBootstrapEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.DISABLE_DEV_ADMIN_BOOTSTRAP !== 'true';
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function resolveAdminOrganization() {
  const orgName = process.env.DEV_ADMIN_ORG_NAME?.trim() || DEFAULT_ORG_NAME;
  const orgSlug = toSlug(orgName) || 'nexus-local';

  const existingNamedOrg = await prisma.organization.findUnique({
    where: { slug: orgSlug },
  });
  if (existingNamedOrg) return existingNamedOrg;

  const existingOrg = await prisma.organization.findFirst({
    orderBy: { createdAt: 'asc' },
  });
  if (existingOrg) return existingOrg;

  return prisma.organization.create({
    data: {
      name: orgName,
      slug: orgSlug,
      settings: {
        timezone: 'UTC',
        activeAgentRuntime: 'claude-cli',
        workflowSessionPolicy: 'single-session-for-agents-and-workflows',
      },
    },
  });
}

export async function ensureDevelopmentAdminUser() {
  if (!isDevelopmentAdminBootstrapEnabled()) return;

  const { email, password, name } = getDevelopmentAdminCredentials();

  let user = await prisma.user.findUnique({ where: { email } });
  const passwordMatches = user ? await bcrypt.compare(password, user.password) : false;

  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash(password, 12),
        name,
        emailVerified: true,
      },
    });
  } else if (!passwordMatches || !user.emailVerified || user.name !== name) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        name,
        emailVerified: true,
        ...(!passwordMatches ? { password: await bcrypt.hash(password, 12) } : {}),
      },
    });
  }

  await prisma.emailVerification.deleteMany({ where: { userId: user.id } });

  const existingMembership = await prisma.orgMember.findFirst({
    where: { userId: user.id },
    include: { organization: true },
    orderBy: { createdAt: 'asc' },
  });
  const organization = existingMembership?.organization ?? await resolveAdminOrganization();

  await prisma.orgMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: user.id,
      },
    },
    update: {
      role: 'OWNER',
      allBoardsRead: true,
      allBoardsWrite: true,
    },
    create: {
      organizationId: organization.id,
      userId: user.id,
      role: 'OWNER',
      allBoardsRead: true,
      allBoardsWrite: true,
    },
  });

  await populateOrgDefaults(organization.id);

  logger.info(
    {
      email,
      userId: user.id,
      orgId: organization.id,
      orgName: organization.name,
      passwordReset: !passwordMatches,
    },
    'Development admin user ready'
  );
}
