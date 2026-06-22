import { Router } from 'express';
import * as platformIntegrations from '../services/platform-integrations.service.js';

const router = Router();

// GET /api/signoz/logs?severity=ERROR,WARN&search=&sinceMs=&limit=
router.get('/logs', async (req, res) => {
  try {
    const severityParam = typeof req.query.severity === 'string' ? req.query.severity : '';
    const severities = severityParam
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const sinceMs = req.query.sinceMs ? Number(req.query.sinceMs) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const logs = await platformIntegrations.getSignozLogs(req.organizationId!, {
      severities: severities.length ? severities : undefined,
      search,
      sinceMs: Number.isFinite(sinceMs) ? sinceMs : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    res.json({ logs });
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    res.status(statusCode).json({ error: (err as Error).message });
  }
});

export default router;
