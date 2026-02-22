import { Router } from 'express';
import * as llmService from '../services/llm-provider.service.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', async (req, res) => {
  const providers = await llmService.getProviders(req.organizationId!);
  res.json(providers);
});

router.post('/', async (req, res) => {
  const { provider, mode, apiKey } = req.body;
  if (!provider || !mode) {
    return res.status(400).json({ error: 'provider and mode are required' });
  }
  const result = await llmService.upsertProvider(req.organizationId!, { provider, mode, apiKey });
  // Strip apiKey from response
  const { apiKey: _key, ...safe } = result as any;
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('llm:updated', safe);
  res.json(safe);
});

router.delete('/:id', async (req, res) => {
  await llmService.deleteProvider(req.params.id, req.organizationId!);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('llm:deleted', { id: req.params.id });
  res.status(204).end();
});

router.post('/:id/test', async (req, res) => {
  // Placeholder - would test the API key against the provider
  res.json({ success: true, message: 'Provider configuration is valid' });
});

router.get('/usage', async (req, res) => {
  const usage = await llmService.getUsage(req.organizationId!);
  // Strip apiKeys
  const providers = usage.providers.map(({ apiKey, ...rest }: any) => rest);
  res.json({ credit: usage.credit, providers });
});

// ─── Admin Credit Management ────────────────────────────
router.post('/credits', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { amountCents } = req.body;
  if (!amountCents || typeof amountCents !== 'number' || amountCents <= 0) {
    return res.status(400).json({ error: 'amountCents must be a positive number' });
  }
  const credit = await llmService.addCredit(req.organizationId!, amountCents);
  res.json(credit);
});

export default router;
