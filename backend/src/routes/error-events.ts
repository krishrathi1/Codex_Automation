import { Router } from 'express';
import * as productionErrorPipeline from '../services/production-error-pipeline.service.js';

const router = Router();

router.get('/', async (req, res) => {
  const rawLimit = Number(req.query.limit);
  const limit = !Number.isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : undefined;
  const boardId = typeof req.query.boardId === 'string' ? req.query.boardId : undefined;
  const events = await productionErrorPipeline.listProductionErrorEvents(req.organizationId!, { boardId, limit });
  res.json(events);
});

router.get('/:id', async (req, res) => {
  const event = await productionErrorPipeline.getProductionErrorEvent(req.organizationId!, req.params.id);
  if (!event) return res.status(404).json({ error: 'Production error event not found' });
  res.json(event);
});

router.post('/', async (req, res) => {
  try {
    const result = await productionErrorPipeline.ingestProductionErrorEvent(req.organizationId!, req.body, {
      io: req.app.get('io'),
    });
    res.status(201).json(result);
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    res.status(statusCode).json({ error: (err as Error).message });
  }
});

export default router;
