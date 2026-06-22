import { Request, Response, NextFunction } from 'express';
import { hashApiKey } from '../lib/crypto.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const rawHeader = req.headers['x-api-key'];
  const apiKey = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!apiKey) {
    logger.warn({ ip: req.ip, path: req.path }, 'API key required but missing');
    return res.status(401).json({ error: 'API key required' });
  }

  try {
    const keyHash = hashApiKey(apiKey);
    const orgKey = await prisma.orgApiKey.findUnique({ where: { keyHash } });
    if (!orgKey) {
      logger.warn({ ip: req.ip, path: req.path }, 'Invalid API key presented');
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // Check revoked
    if (orgKey.revokedAt) {
      logger.warn({ keyId: orgKey.id }, 'Revoked API key used');
      return res.status(401).json({ error: 'API key revoked' });
    }

    // Check expiry
    if (orgKey.expiresAt && orgKey.expiresAt < new Date()) {
      logger.warn({ keyId: orgKey.id }, 'Expired API key used');
      return res.status(401).json({ error: 'API key expired' });
    }

    // Update lastUsedAt
    await prisma.orgApiKey.update({ where: { id: orgKey.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

    req.organizationId = orgKey.organizationId;
    next();
  } catch (err) {
    logger.warn({ err, ip: req.ip, path: req.path }, 'API key authentication failure');
    return res.status(401).json({ error: 'Authentication failed' });
  }
}
