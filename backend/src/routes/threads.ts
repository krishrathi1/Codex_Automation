import { Router } from 'express';
import * as threadService from '../services/thread.service.js';

const router = Router();

router.get('/', async (req, res) => {
  const threads = await threadService.getAllThreads(req.organizationId!);
  res.json(threads);
});

router.get('/graph', async (req, res) => {
  const boardId = typeof req.query.boardId === 'string' ? req.query.boardId : undefined;
  const graph = await threadService.getCommGraph(req.organizationId!, { boardId });
  res.json(graph);
});

router.get('/:id', async (req, res) => {
  const thread = await threadService.getThreadById(req.params.id, req.organizationId!);
  if (!thread) return res.status(404).json({ error: 'Thread not found' });
  res.json(thread);
});

export default router;
