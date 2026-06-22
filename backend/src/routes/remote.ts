import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import * as remoteService from '../services/remote.service.js';

const heartbeatSchema = z.object({
  agentId: z.string(),
  gatewayAgentId: z.string(),
  agentName: z.string().optional(),
  displayName: z.string().optional(),
  status: z.string().optional(),
  message: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const activitySchema = z.object({
  agentId: z.string(),
  type: z.string(),
  message: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

const metricsSchema = z.object({
  agentId: z.string(),
  responseTimeMs: z.number().optional(),
  success: z.boolean().optional(),
  errorMessage: z.string().optional(),
  toolName: z.string().optional(),
  metrics: z.record(z.unknown()).optional(),
});

const router = Router();

// POST /api/remote/heartbeat
router.post('/heartbeat', validate(heartbeatSchema), async (req, res) => {
  try {
    const result = await remoteService.remoteHeartbeat(req.organizationId!, req.body);
    // Emit to org room
    req.app.get('io')?.to(`org:${req.organizationId}`).emit('agent:heartbeat', result.agent);
    if (result.activity) {
      req.app.get('io')?.to(`org:${req.organizationId}`).emit('activity:new', result.activity);
    }
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/remote/activity
router.post('/activity', validate(activitySchema), async (req, res) => {
  try {
    const activity = await remoteService.remoteActivity(req.organizationId!, req.body);
    req.app.get('io')?.to(`org:${req.organizationId}`).emit('activity:new', activity);
    res.json(activity);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/remote/metrics
router.post('/metrics', validate(metricsSchema), async (req, res) => {
  try {
    const result = await remoteService.remoteMetrics(req.organizationId!, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
