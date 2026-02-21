import { Router } from 'express';
import * as taskService from '../services/task.service.js';

const router = Router();

router.get('/', async (req, res) => {
  const tasks = await taskService.getAllTasks(req.organizationId!);
  res.json(tasks);
});

router.post('/', async (req, res) => {
  const task = await taskService.createTask(req.organizationId!, req.body);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('task:update', task);
  res.status(201).json(task);
});

router.patch('/:id', async (req, res) => {
  const task = await taskService.updateTask(req.params.id, req.organizationId!, req.body);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('task:update', task);
  res.json(task);
});

router.delete('/:id', async (req, res) => {
  await taskService.deleteTask(req.params.id, req.organizationId!);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('task:delete', { id: req.params.id });
  res.status(204).end();
});

export default router;
