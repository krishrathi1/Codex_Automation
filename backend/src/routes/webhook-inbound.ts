import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as webhookService from '../services/webhook.service.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

// PUBLIC endpoint — no auth required, rate-limited
router.post('/:boardId/:webhookId', webhookLimiter, async (req, res) => {
  try {
    const payload = req.body;

    // Cap payload size at 100KB
    const payloadStr = JSON.stringify(payload);
    if (payloadStr && payloadStr.length > 102400) {
      return res.status(413).json({ error: 'Payload too large (max 100KB)' });
    }

    const headers: Record<string, string> = {};
    const allowedHeaders = ['content-type', 'x-webhook-secret', 'user-agent', 'x-forwarded-for', 'x-real-ip'];
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string' && allowedHeaders.includes(key)) headers[key] = value;
    }
    const sourceIp = (req.ip || req.socket.remoteAddress || '') as string;
    const contentType = req.headers['content-type'] || '';

    const boardId = Array.isArray(req.params.boardId) ? req.params.boardId[0] : req.params.boardId;
    const webhookId = Array.isArray(req.params.webhookId) ? req.params.webhookId[0] : req.params.webhookId;

    const stored = await webhookService.handleInbound(
      boardId,
      webhookId,
      payload,
      headers,
      sourceIp,
      contentType
    );

    // Look up board org and scope Socket.IO emit to that org room
    const board = await prisma.board.findUnique({ where: { id: boardId }, select: { organizationId: true } }).catch(() => null);
    const io = req.app.get('io');
    if (io && board) {
      io.to(`org:${board.organizationId}`).emit('webhook:received', {
        boardId,
        webhookId,
        payloadId: stored.id,
      });
    }

    res.json({ received: true, id: stored.id });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('Invalid webhook secret')) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }
    if (message.includes('not found') || message.includes('disabled')) {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
