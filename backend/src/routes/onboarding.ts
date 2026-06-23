import { Router } from 'express';
import * as onboardingService from '../services/onboarding.service.js';

const router = Router({ mergeParams: true });

// All routes under /api/boards/:boardId/onboarding
router.post('/:boardId/onboarding/start', async (req, res) => {
  const session = await onboardingService.startSession(req.params.boardId, req.organizationId!);
  res.status(201).json(session);
});

router.post('/:boardId/onboarding/message', async (req, res) => {
  const { sessionId, content } = req.body;
  const session = await onboardingService.sendMessage(sessionId, content, req.organizationId!);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('onboarding:message', { boardId: req.params.boardId });
  res.json(session);
});

router.get('/:boardId/onboarding', async (req, res) => {
  const session = await onboardingService.getSession(req.params.boardId, req.organizationId!);
  res.json(session);
});

router.post('/:boardId/onboarding/confirm', async (req, res) => {
  const { sessionId } = req.body;
  const session = await onboardingService.confirmOnboarding(sessionId, req.organizationId!);
  res.json(session);
});

export default router;
