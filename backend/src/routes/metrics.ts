import { Router } from 'express';
import * as metricsService from '../services/metrics.service.js';

const router = Router();

// This router is mounted at both /api/tokens and /api/metrics.
// We use req.baseUrl to determine which resource is being requested.

// GET / — list (tokens or metrics depending on mount point)
router.get('/', async (req, res) => {
  if (req.baseUrl.endsWith('/tokens')) {
    const agentId = req.query.agentId as string | undefined;
    const hours = req.query.hours ? Number(req.query.hours) : undefined;
    const usage = await metricsService.getTokenUsage(req.organizationId!, { agentId, hours });
    res.json(usage);
  } else {
    const agentId = req.query.agentId as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const metrics = await metricsService.getMetrics(req.organizationId!, { agentId, limit });
    res.json(metrics);
  }
});

// GET /summary — summary (tokens or metrics depending on mount point)
router.get('/summary', async (req, res) => {
  if (req.baseUrl.endsWith('/tokens')) {
    const summary = await metricsService.getTokenSummary(req.organizationId!);
    res.json(summary);
  } else {
    const summary = await metricsService.getMetricsSummary(req.organizationId!);
    res.json(summary);
  }
});

export default router;
