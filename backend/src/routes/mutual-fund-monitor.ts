import { Router } from 'express';
import {
  getMonitorStatus,
  triggerManualCheck,
  triggerVercelRedeploy,
} from '../services/mutual-fund-monitor.service.js';

const router = Router();

// GET /api/mutual-fund-monitor/status
router.get('/status', (_req, res) => {
  const status = getMonitorStatus();
  res.json({
    running: status.running,
    lastCheckAt: status.lastCheckAt,
    lastError: status.lastError,
    checksTotal: status.checksTotal,
    errorsFound: status.errorsFound,
    fixesTriggered: status.fixesTriggered,
    orgId: status.orgId,
    vercelProjectId: status.vercelProjectId,
    timer: status.timer,
  });
});

// POST /api/mutual-fund-monitor/check — trigger an immediate check
router.post('/check', async (_req, res) => {
  try {
    const result = await triggerManualCheck();
    res.json({ ok: true, errorsFound: result.errorsFound });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/mutual-fund-monitor/redeploy — force a Vercel redeploy
router.post('/redeploy', async (_req, res) => {
  try {
    const result = await triggerVercelRedeploy();
    res.json({ ok: true, deploymentId: result.deploymentId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
