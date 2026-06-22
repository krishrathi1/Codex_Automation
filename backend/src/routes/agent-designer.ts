import { Router } from 'express';
import * as agentDesignerService from '../services/agent-designer.service.js';

const router = Router();

// POST /message — drive the pre-creation agent design conversation.
// Body: { messages: { role: 'user' | 'assistant'; content: string }[] }
// Returns: { reply: string, proposal?: AgentDesignProposal }
router.post('/message', async (req, res) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const result = await agentDesignerService.designAgents({
      organizationId: req.organizationId!,
      messages,
    });
    res.json(result);
  } catch (err) {
    const errorMessage = (err as Error).message;
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    res.status(statusCode).json({ error: errorMessage });
  }
});

export default router;
