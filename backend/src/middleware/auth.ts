import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import type { OrgRole } from '@prisma/client';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });

  try {
    const payload = verifyAccessToken(header.slice(7));
    const member = await prisma.orgMember.findFirst({
      where: { userId: payload.userId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, email: true, name: true, emailVerified: true } } },
    });
    if (!member) return res.status(403).json({ error: 'No organization membership' });

    if (!member.user.emailVerified) {
      logger.warn({ userId: payload.userId }, 'Authentication rejected: email not verified');
      return res.status(403).json({ error: 'Email not verified' });
    }

    req.user = { id: member.user.id, email: member.user.email, name: member.user.name };
    req.organizationId = member.organizationId;
    req.orgRole = member.role;
    next();
  } catch (err) {
    logger.warn({ err, ip: req.ip, path: req.path }, 'Authentication failure');
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles: OrgRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.orgRole || !roles.includes(req.orgRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
