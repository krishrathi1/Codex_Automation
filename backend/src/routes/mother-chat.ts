import { Router } from 'express';
import * as motherChatService from '../services/mother-chat.service.js';
import * as claudeCliService from '../services/claude-cli.service.js';

const router = Router();

router.get('/context', async (req, res, next) => {
  try {
    const boardId = typeof req.query.boardId === 'string' ? req.query.boardId : undefined;
    const context = await motherChatService.buildMotherChatContext(req.organizationId!, { boardId });
    res.json(context.context);
  } catch (err) {
    next(err);
  }
});

router.get('/history', async (req, res, next) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const boardId = typeof req.query.boardId === 'string' ? req.query.boardId : undefined;
    const history = await motherChatService.getMotherChatHistory(req.organizationId!, limit, { boardId });
    res.json(history);
  } catch (err) {
    next(err);
  }
});

router.get('/diagnostics', async (_req, res) => {
  const diagnostics = await claudeCliService.getClaudeCliDiagnostics();
  res.json(diagnostics);
});

router.post('/message', async (req, res) => {
  const message = req.body.message as string;
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const result = await motherChatService.sendMotherChatMessage({
      organizationId: req.organizationId!,
      message,
      boardId: typeof req.body.boardId === 'string' ? req.body.boardId : undefined,
      requestId: typeof req.body.requestId === 'string' ? req.body.requestId : undefined,
      io: req.app.get('io'),
    });

    res.json({
      status: result.status,
      result: result.result,
      runId: result.codexSessionId,
      codexSessionId: result.codexSessionId,
      sessionId: result.nexusSessionId,
      runtime: 'claude-cli',
      usage: result.usage,
    });
  } catch (err) {
    const errorMessage = (err as Error).message;
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    res.status(statusCode).json({ error: errorMessage });
  }
});

export default router;
