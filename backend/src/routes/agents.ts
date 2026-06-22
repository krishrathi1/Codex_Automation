import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import * as agentService from '../services/agent.service.js';
import * as agentSkillService from '../services/agent-skill.service.js';
import * as integrationService from '../services/integration.service.js';
import * as activityService from '../services/activity.service.js';
import * as llmProviderService from '../services/llm-provider.service.js';
import * as claudeCliService from '../services/claude-cli.service.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import type { Agent as PrismaAgent, AgentStatus, ChannelType } from '@prisma/client';

const router = Router();

async function handleClaudeCliChat(req: Request, res: Response, agent: PrismaAgent) {
  const message = req.body.message as string;
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const result = await claudeCliService.sendClaudeCliAgentMessage({
      organizationId: req.organizationId!,
      agent,
      message,
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
}

router.get('/', async (req, res) => {
  const agents = await agentService.getAllAgents(req.organizationId!);
  res.json(agents);
});

router.get('/stats', async (req, res) => {
  const stats = await agentService.getAgentStats(req.organizationId!);
  res.json(stats);
});

router.get('/:id', async (req, res) => {
  const agent = await agentService.getAgentById(req.params.id, req.organizationId!);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(agent);
});

router.post('/', async (req, res) => {
  const agent = await agentService.createAgent(req.organizationId!, req.body);
  // Bulk-assign skills if provided
  if (req.body.skillIds && Array.isArray(req.body.skillIds) && req.body.skillIds.length > 0) {
    await agentSkillService.bulkAssignSkills(agent.id, req.body.skillIds, req.organizationId!);
  }
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('agent:created', agent);
  res.status(201).json(agent);
});

router.patch('/:id', async (req, res) => {
  const agent = await agentService.updateAgent(req.params.id, req.organizationId!, req.body);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('agent:updated', agent);
  res.json(agent);
});

router.patch('/:id/status', async (req, res) => {
  const { status, currentTask } = req.body as { status: AgentStatus; currentTask?: string };
  const agent = await agentService.updateAgentStatus(req.params.id, req.organizationId!, status, currentTask);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('agent:status', agent);
  res.json(agent);
});

// ─── Agent-to-Agent toggle ──────────────────────────────
router.patch('/:id/a2a', async (req, res) => {
  const { enabled } = req.body as { enabled: boolean };
  const agent = await agentService.updateAgent(req.params.id, req.organizationId!, { agentToAgent: enabled } as any);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('agent:updated', agent);
  res.json(agent);
});

// ─── Heartbeat Throttling ────────────────────────────────
// Prevent DB bloat and CPU waste from frequent heartbeats
const heartbeatActivityThrottle = new Map<string, number>(); // agentId -> last activity write time
const heartbeatRateLimit = new Map<string, number>();         // agentId -> last heartbeat time
const HEARTBEAT_ACTIVITY_INTERVAL_MS = 5 * 60 * 1000; // Only log activity every 5 min
const HEARTBEAT_RATE_LIMIT_MS = 5 * 1000;              // Reject heartbeats faster than 5s apart

router.post('/:id/heartbeat', async (req, res) => {
  const agentId = req.params.id;
  const now = Date.now();

  // Rate limit: reject if heartbeat came in within 5 seconds
  const lastPing = heartbeatRateLimit.get(agentId);
  if (lastPing && now - lastPing < HEARTBEAT_RATE_LIMIT_MS) {
    return res.status(429).json({ error: 'Too many heartbeats', retryAfterMs: HEARTBEAT_RATE_LIMIT_MS - (now - lastPing) });
  }
  heartbeatRateLimit.set(agentId, now);

  const agent = await agentService.recordHeartbeat(agentId, req.organizationId!);

  // Throttle activity creation: only write to DB every 5 minutes per agent
  const lastActivity = heartbeatActivityThrottle.get(agentId);
  if (!lastActivity || now - lastActivity >= HEARTBEAT_ACTIVITY_INTERVAL_MS) {
    heartbeatActivityThrottle.set(agentId, now);
    await activityService.createActivity(req.organizationId!, {
      agentId: agent.id,
      type: 'HEARTBEAT',
      message: req.body.message || `Heartbeat from ${agent.displayName}`,
      metadata: req.body.metadata,
    });

    // Create a timeline Session record for heartbeats (throttled same as activity)
    prisma.session.create({
      data: {
        organizationId: req.organizationId!,
        agentId: agent.id,
        type: 'HEARTBEAT',
        status: 'COMPLETED',
        startedAt: new Date(),
        endedAt: new Date(),
        durationMs: 0,
        summary: req.body.message || `Heartbeat from ${agent.displayName}`,
      },
    }).catch(err => logger.warn({ err, agentId: agent.id }, 'Failed to create heartbeat session'));
  }

  req.app.get('io')?.to(`org:${req.organizationId}`).emit('agent:heartbeat', agent);
  res.json(agent);
});

router.delete('/:id', async (req, res) => {
  await agentService.deleteAgent(req.params.id, req.organizationId!);
  heartbeatActivityThrottle.delete(req.params.id);
  heartbeatRateLimit.delete(req.params.id);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('agent:deleted', { id: req.params.id });
  res.status(204).end();
});

// ─── Agent Skills ───────────────────────────────────────

router.get('/:id/skills', async (req, res) => {
  const skills = await agentSkillService.listAgentSkills(req.params.id, req.organizationId!);
  res.json(skills);
});

router.post('/:id/skills', async (req, res) => {
  const { skillId, skillIds } = req.body;
  if (skillIds && Array.isArray(skillIds)) {
    const result = await agentSkillService.bulkAssignSkills(req.params.id, skillIds, req.organizationId!);
    return res.json(result);
  }
  if (!skillId) return res.status(400).json({ error: 'skillId is required' });
  const result = await agentSkillService.assignSkill(req.params.id, skillId, req.organizationId!);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('agent:updated', { id: req.params.id });
  res.status(201).json(result);
});

router.patch('/:id/skills/:skillId', async (req, res) => {
  const result = await agentSkillService.updateAgentSkill(
    req.params.id,
    req.params.skillId,
    req.organizationId!,
    req.body
  );
  res.json(result);
});

router.delete('/:id/skills/:skillId', async (req, res) => {
  await agentSkillService.removeSkill(req.params.id, req.params.skillId, req.organizationId!);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('agent:updated', { id: req.params.id });
  res.status(204).end();
});

// ─── Chat Endpoints ─────────────────────────────────────

router.post('/:id/chat', async (req, res) => {
  try {
    const agent = await prisma.agent.findFirst({
      where: { id: req.params.id, organizationId: req.organizationId! },
    });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    if (
      claudeCliService.isCodexCliRuntimeEnabled() ||
      Boolean(claudeCliService.getAgentClaudeSessionId(agent))
    ) {
      return handleClaudeCliChat(req, res, agent);
    }

    return res.status(400).json({ error: 'Agent chat requires the local Claude CLI runtime (set AGENT_RUNTIME=claude-cli).' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/:id/chat/history', async (req, res) => {
  try {
    const agent = await prisma.agent.findFirst({
      where: { id: req.params.id, organizationId: req.organizationId! },
    });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (claudeCliService.isCodexCliRuntimeEnabled() || claudeCliService.getAgentClaudeSessionId(agent)) {
      try {
        const history = await claudeCliService.getClaudeCliAgentMessages(agent, Number(req.query.limit) || 50);
        return res.json(history);
      } catch {
        return res.json({ sessionKey: claudeCliService.getAgentClaudeSessionId(agent) || '', messages: [] });
      }
    }
    return res.json({ sessionKey: '', messages: [] });
  } catch (err) {
    res.json({ sessionKey: '', messages: [] });
  }
});

// ─── Workspace File Endpoints ───────────────────────────

router.get('/:id/files', async (req, res) => {
  try {
    const agent = await prisma.agent.findFirst({
      where: { id: req.params.id, organizationId: req.organizationId! },
    });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    return res.json([]);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/:id/files/:name', async (req, res) => {
  try {
    const agent = await prisma.agent.findFirst({
      where: { id: req.params.id, organizationId: req.organizationId! },
    });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    return res.status(400).json({ error: 'Agent workspace files are no longer served via the gateway.' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.put('/:id/files/:name', async (req, res) => {
  try {
    const agent = await prisma.agent.findFirst({
      where: { id: req.params.id, organizationId: req.organizationId! },
    });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    return res.status(400).json({ error: 'Agent workspace files are no longer served via the gateway.' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Agent-to-Agent Messaging ─────────────────────────

router.post('/:id/message', async (req, res) => {
  try {
    const { targetAgentId, message } = req.body;
    if (!targetAgentId || !message) {
      return res.status(400).json({ error: 'targetAgentId and message are required' });
    }

    // Get source agent
    const sourceAgent = await prisma.agent.findFirst({
      where: { id: req.params.id, organizationId: req.organizationId! },
    });
    if (!sourceAgent) return res.status(404).json({ error: 'Source agent not found' });
    return res.status(400).json({ error: 'Agent-to-agent gateway messaging is no longer supported. Use Mother Chat / live workflows instead.' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Agent Token Endpoint ──────────────────────────────

router.post('/:id/token', async (req, res) => {
  try {
    const agent = await prisma.agent.findFirst({
      where: { id: req.params.id, organizationId: req.organizationId! },
    });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    // Dynamic import to avoid circular dependency
    const { generateAgentToken } = await import('./agent-api.js');
    const token = await generateAgentToken(agent.id);
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Agent Integrations (Telegram, Slack, Google Chat) ──

router.get('/:id/integrations', async (req, res) => {
  try {
    const result = await integrationService.listIntegrations(req.params.id, req.organizationId!);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

router.get('/:id/integrations/:channel', async (req, res) => {
  try {
    const channel = req.params.channel.toUpperCase() as ChannelType;
    const result = await integrationService.getIntegration(req.params.id, channel, req.organizationId!);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

router.put('/:id/integrations/:channel', async (req, res) => {
  try {
    const channel = req.params.channel.toUpperCase() as ChannelType;
    const result = await integrationService.upsertIntegration(
      req.params.id,
      channel,
      req.organizationId!,
      req.body,
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.patch('/:id/integrations/:channel', async (req, res) => {
  try {
    const channel = req.params.channel.toUpperCase() as ChannelType;
    const { enabled } = req.body;
    const result = await integrationService.toggleIntegration(
      req.params.id,
      channel,
      req.organizationId!,
      enabled,
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/:id/integrations/:channel', async (req, res) => {
  try {
    const channel = req.params.channel.toUpperCase() as ChannelType;
    await integrationService.deleteIntegration(req.params.id, channel, req.organizationId!);
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
