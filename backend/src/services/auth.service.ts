import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt.js';
import { createHash, randomBytes } from 'crypto';

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function signup(data: {
  email: string;
  password: string;
  name: string;
  orgName: string;
}) {
  // Check email uniqueness
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    throw new Error('Email already in use');
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(data.password, 12);

  // Create user, org, and membership in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        name: data.name,
      },
    });

    const slug = toSlug(data.orgName);
    // Ensure slug uniqueness by appending random suffix if needed
    let finalSlug = slug;
    const existingOrg = await tx.organization.findUnique({ where: { slug } });
    if (existingOrg) {
      finalSlug = `${slug}-${randomBytes(3).toString('hex')}`;
    }

    const organization = await tx.organization.create({
      data: {
        name: data.orgName,
        slug: finalSlug,
      },
    });

    await tx.orgMember.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: 'OWNER',
      },
    });

    // Generate tokens
    const tokenPayload = { userId: user.id, email: user.email };
    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);

    // Store hashed refresh token
    await tx.refreshToken.create({
      data: {
        userId: user.id,
        token: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    return {
      user: { id: user.id, email: user.email, name: user.name },
      organization: { id: organization.id, name: organization.name, slug: organization.slug },
      accessToken,
      refreshToken,
    };
  });

  return result;
}

export async function login(data: { email: string; password: string }) {
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user) {
    throw new Error('Invalid email or password');
  }

  const validPassword = await bcrypt.compare(data.password, user.password);
  if (!validPassword) {
    throw new Error('Invalid email or password');
  }

  // Find their org membership
  const member = await prisma.orgMember.findFirst({
    where: { userId: user.id },
    include: { organization: { select: { id: true, name: true, slug: true } } },
  });
  if (!member) {
    throw new Error('No organization membership found');
  }

  // Generate tokens
  const tokenPayload = { userId: user.id, email: user.email };
  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken(tokenPayload);

  // Store hashed refresh token
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return {
    user: { id: user.id, email: user.email, name: user.name },
    organization: member.organization,
    accessToken,
    refreshToken,
  };
}

export async function refresh(refreshTokenValue: string) {
  // Verify the JWT
  const payload = verifyRefreshToken(refreshTokenValue);

  // Find the stored token
  const hashedToken = hashToken(refreshTokenValue);
  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: hashedToken },
  });
  if (!storedToken) {
    throw new Error('Refresh token not found or already used');
  }

  // Check expiration
  if (storedToken.expiresAt < new Date()) {
    await prisma.refreshToken.delete({ where: { id: storedToken.id } });
    throw new Error('Refresh token expired');
  }

  // Delete old token (rotate)
  await prisma.refreshToken.delete({ where: { id: storedToken.id } });

  // Generate new pair
  const tokenPayload = { userId: payload.userId, email: payload.email };
  const newAccessToken = signAccessToken(tokenPayload);
  const newRefreshToken = signRefreshToken(tokenPayload);

  // Store new refresh token
  await prisma.refreshToken.create({
    data: {
      userId: payload.userId,
      token: hashToken(newRefreshToken),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
}

export async function logout(refreshTokenValue: string) {
  const hashedToken = hashToken(refreshTokenValue);
  await prisma.refreshToken.deleteMany({
    where: { token: hashedToken },
  });
}

export async function getMe(userId: string) {
  const member = await prisma.orgMember.findFirst({
    where: { userId },
    include: {
      user: { select: { id: true, email: true, name: true } },
      organization: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!member) {
    throw new Error('No organization membership found');
  }

  return {
    user: member.user,
    organization: member.organization,
    role: member.role,
  };
}
