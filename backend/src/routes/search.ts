import { Router } from 'express';
import * as commandService from '../services/command.service.js';
import type { ActivityType } from '@prisma/client';

const router = Router();

router.get('/', async (req, res) => {
  const { q, agentId, type, limit } = req.query;

  if (!q || typeof q !== 'string') {
    return res.status(400).json({ error: 'Search query "q" is required' });
  }

  const parsedLimit = limit ? parseInt(limit as string, 10) : NaN;
  const result = await commandService.searchActivities(req.organizationId!, q, {
    agentId: agentId as string | undefined,
    type: type as ActivityType | undefined,
    // Guard against NaN/negative/oversized limits (a bad ?limit would otherwise
    // pass NaN to Prisma `take` and 500).
    limit: !Number.isNaN(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : undefined,
  });

  res.json(result);
});

export default router;
