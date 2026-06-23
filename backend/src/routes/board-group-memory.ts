import { Router } from 'express';
import * as memoryService from '../services/board-group-memory.service.js';

const router = Router({ mergeParams: true });

// Routes under /api/board-groups/:groupId/memory
router.post('/:groupId/memory', async (req, res) => {
  try {
    const memory = await memoryService.addMemory(req.params.groupId, req.organizationId!, req.body);
    req.app.get('io')?.to(`org:${req.organizationId}`).emit('memory:added', { boardGroupId: req.params.groupId, id: memory.id });
    res.status(201).json(memory);
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    res.status(statusCode).json({ error: (err as Error).message });
  }
});

router.get('/:groupId/memory', async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  const since = req.query.since ? new Date(req.query.since as string) : undefined;
  const memories = await memoryService.listMemory(req.params.groupId, req.organizationId!, { limit, offset, since });
  res.json(memories);
});

router.delete('/:groupId/memory/:id', async (req, res) => {
  await memoryService.deleteMemory(req.params.id, req.params.groupId, req.organizationId!);
  res.status(204).end();
});

export default router;
