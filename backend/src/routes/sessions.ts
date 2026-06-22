import { Router } from 'express';
import * as sessionService from '../services/session.service.js';

const router = Router();

// GET / — list sessions (query params: agentId, limit)
router.get('/', async (req, res) => {
  const agentId = req.query.agentId as string | undefined;
  const rawLimit = parseInt(req.query.limit as string, 10);
  const limit = !Number.isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : undefined;
  const sessions = await sessionService.getSessions(req.organizationId!, { agentId, limit });
  res.json(sessions);
});

// GET /timeline — timeline data grouped by agent
router.get('/timeline', async (req, res) => {
  const data = await sessionService.getTimelineData(req.organizationId!);
  res.json(data);
});

export default router;
