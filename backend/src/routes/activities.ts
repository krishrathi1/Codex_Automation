import { Router } from 'express';
import * as activityService from '../services/activity.service.js';
import type { ActivityType } from '@prisma/client';

function capPositiveInt(value: number, max: number): number | undefined {
  return !Number.isNaN(value) && value > 0 ? Math.min(value, max) : undefined;
}

function parseDateSafe(value: string): Date | undefined {
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) ? d : undefined;
}

const router = Router();

router.get('/', async (req, res) => {
  const { agentId, type, limit, offset, since } = req.query;
  const result = await activityService.getActivities(req.organizationId!, {
    agentId: agentId as string | undefined,
    type: type as ActivityType | undefined,
    limit: limit ? capPositiveInt(parseInt(limit as string, 10), 200) : undefined,
    offset: offset ? capPositiveInt(parseInt(offset as string, 10), 1000) : undefined,
    since: since ? parseDateSafe(since as string) : undefined,
  });
  res.json(result);
});

router.delete('/', async (req, res) => {
  const { agentId, type } = req.query;
  const result = await activityService.clearActivities(req.organizationId!, {
    agentId: agentId as string | undefined,
    type: type as ActivityType | undefined,
  });
  res.json(result);
});

export default router;
