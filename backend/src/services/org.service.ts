import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { prisma } from '../lib/prisma.js';
import { generateApiKey } from '../lib/crypto.js';
import type { OrgRole } from '@prisma/client';

export async function getOrganization(orgId: string) {
  return prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      _count: {
        select: { members: true, agents: true },
      },
    },
  });
}

export async function updateOrganization(orgId: string, data: { name?: string; settings?: Record<string, unknown> }) {
  return prisma.organization.update({
    where: { id: orgId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.settings !== undefined && { settings: data.settings as any }),
    },
  });
}

export async function getMembers(orgId: string) {
  return prisma.orgMember.findMany({
    where: { organizationId: orgId },
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function inviteMember(orgId: string, email: string, role: OrgRole) {
  // Check if user exists
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // Create user with random password (they'll need to use forgot password or sign up separately)
    const randomPassword = randomBytes(32).toString('hex');
    const hashedPassword = await bcrypt.hash(randomPassword, 12);
    user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: email.split('@')[0],
      },
    });
  }

  // Check if already a member
  const existingMember = await prisma.orgMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
  });
  if (existingMember) {
    throw new Error('User is already a member of this organization');
  }

  return prisma.orgMember.create({
    data: {
      organizationId: orgId,
      userId: user.id,
      role,
    },
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  });
}

export async function updateMemberRole(memberId: string, orgId: string, role: OrgRole) {
  // Verify member belongs to the caller's organization (prevents IDOR)
  const member = await prisma.orgMember.findFirst({
    where: { id: memberId, organizationId: orgId },
  });
  if (!member) throw new Error('Member not found in this organization');

  return prisma.orgMember.update({
    where: { id: memberId },
    data: { role },
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  });
}

export async function removeMember(memberId: string, orgId: string) {
  // Verify member belongs to the caller's organization (prevents IDOR)
  const member = await prisma.orgMember.findFirst({
    where: { id: memberId, organizationId: orgId },
  });
  if (!member) throw new Error('Member not found in this organization');

  return prisma.orgMember.delete({ where: { id: memberId } });
}

export async function getApiKeys(orgId: string) {
  return prisma.orgApiKey.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createApiKey(orgId: string, name: string) {
  const { key, prefix, hash } = generateApiKey();

  const apiKey = await prisma.orgApiKey.create({
    data: {
      organizationId: orgId,
      name,
      keyHash: hash,
      keyPrefix: prefix,
    },
  });

  // Return the full key only once
  return {
    id: apiKey.id,
    name: apiKey.name,
    key, // full key — only returned at creation time
    prefix: apiKey.keyPrefix,
    createdAt: apiKey.createdAt,
  };
}

export async function revokeApiKey(keyId: string, orgId: string) {
  // Verify API key belongs to the caller's organization (prevents IDOR)
  const key = await prisma.orgApiKey.findFirst({
    where: { id: keyId, organizationId: orgId },
  });
  if (!key) throw new Error('API key not found in this organization');

  return prisma.orgApiKey.delete({ where: { id: keyId } });
}
