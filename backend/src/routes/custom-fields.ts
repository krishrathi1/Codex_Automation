import { Router } from 'express';
import * as customFieldService from '../services/custom-field.service.js';

const router = Router();

router.get('/', async (req, res) => {
  const defs = await customFieldService.listDefinitions(req.organizationId!);
  res.json(defs);
});

router.post('/', async (req, res) => {
  const def = await customFieldService.createDefinition(req.organizationId!, req.body);
  res.status(201).json(def);
});

router.patch('/:id', async (req, res) => {
  const def = await customFieldService.updateDefinition(req.params.id, req.organizationId!, req.body);
  res.json(def);
});

router.delete('/:id', async (req, res) => {
  await customFieldService.deleteDefinition(req.params.id, req.organizationId!);
  res.status(204).end();
});

router.post('/:id/attach', async (req, res) => {
  const { boardIds } = req.body;
  const results = await customFieldService.attachToBoard(req.params.id, req.organizationId!, boardIds);
  res.json(results);
});

router.get('/boards/:boardId', async (req, res) => {
  const fields = await customFieldService.getBoardFields(req.params.boardId, req.organizationId!);
  res.json(fields);
});

// Task custom field values
router.post('/values', async (req, res) => {
  try {
    const { taskId, definitionId, value } = req.body;
    const result = await customFieldService.setFieldValue(taskId, definitionId, value, req.organizationId!);
    res.json(result);
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    res.status(statusCode).json({ error: (err as Error).message });
  }
});

router.get('/values/:taskId', async (req, res) => {
  const values = await customFieldService.getTaskFieldValues(req.params.taskId, req.organizationId!);
  res.json(values);
});

export default router;
