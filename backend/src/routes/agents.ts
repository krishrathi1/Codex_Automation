import { Router } from 'express';
import { randomUUID } from 'crypto';
import * as agentService from '../services/agent.service.js';
import * as activityService from '../services/activity.service.js';
import { prisma } from '../lib/prisma.js';
import { getGatewayClient } from '../openclaw/client.js';
import type { AgentStatus } from '@prisma/client';

const router = Router();

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
  }

  req.app.get('io')?.to(`org:${req.organizationId}`).emit('agent:heartbeat', agent);
  res.json(agent);
});

router.delete('/:id', async (req, res) => {
  await agentService.deleteAgent(req.params.id, req.organizationId!);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('agent:deleted', { id: req.params.id });
  res.status(204).end();
});

// ─── Chat Endpoints ─────────────────────────────────────

router.post('/:id/chat', async (req, res) => {
  try {
    const agent = await prisma.agent.findFirst({
      where: { id: req.params.id, organizationId: req.organizationId! },
    });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (!agent.gatewayId || !agent.gatewayAgentId) {
      return res.status(400).json({ error: 'Agent not connected to a gateway' });
    }

    const client = getGatewayClient(agent.gatewayId);
    if (!client || !client.isConnected()) {
      return res.status(503).json({ error: 'Gateway not connected' });
    }

    // Session key format: agent:{gatewayAgentId}:nexus (required by OpenClaw gateway)
    const sessionKey = `agent:${agent.gatewayAgentId}:nexus`;

    const result = await client.rpc('agent', {
      message: req.body.message,
      agentId: agent.gatewayAgentId,
      sessionKey,
      idempotencyKey: randomUUID(),
      label: `Nexus chat with ${agent.displayName}`,
    });

    // Record activity
    await activityService.createActivity(req.organizationId!, {
      agentId: agent.id,
      type: 'MESSAGE',
      message: `Chat message sent to ${agent.displayName}`,
      metadata: { sessionKey },
    });

    res.json(result);
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
    if (!agent.gatewayId || !agent.gatewayAgentId) {
      return res.json({ sessionKey: '', messages: [] });
    }

    const client = getGatewayClient(agent.gatewayId);
    if (!client || !client.isConnected()) {
      return res.json({ sessionKey: '', messages: [] });
    }

    // Session key format: agent:{gatewayAgentId}:nexus (required by OpenClaw gateway)
    const sessionKey = `agent:${agent.gatewayAgentId}:nexus`;

    const result = await client.rpc('chat.history', {
      sessionKey,
      limit: Number(req.query.limit) || 50,
    });

    res.json(result);
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
    if (!agent.gatewayId || !agent.gatewayAgentId) {
      return res.json([]);
    }

    const client = getGatewayClient(agent.gatewayId);
    if (!client || !client.isConnected()) {
      return res.json([]);
    }

    const result = await client.rpc('agents.files.list', { agentId: agent.gatewayAgentId }) as { files: unknown[] };
    res.json(result.files);
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
    if (!agent.gatewayId || !agent.gatewayAgentId) {
      return res.status(400).json({ error: 'Agent not connected to gateway' });
    }

    const client = getGatewayClient(agent.gatewayId);
    if (!client || !client.isConnected()) {
      return res.status(503).json({ error: 'Gateway not connected' });
    }

    const result = await client.rpc('agents.files.get', {
      agentId: agent.gatewayAgentId,
      name: decodeURIComponent(req.params.name),
    }) as { file: unknown };
    res.json(result.file);
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
    if (!agent.gatewayId || !agent.gatewayAgentId) {
      return res.status(400).json({ error: 'Agent not connected to gateway' });
    }

    const client = getGatewayClient(agent.gatewayId);
    if (!client || !client.isConnected()) {
      return res.status(503).json({ error: 'Gateway not connected' });
    }

    const result = await client.rpc('agents.files.set', {
      agentId: agent.gatewayAgentId,
      name: decodeURIComponent(req.params.name),
      content: req.body.content,
    }) as { file: unknown };
    res.json(result.file);
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
    if (!sourceAgent.gatewayId || !sourceAgent.gatewayAgentId) {
      return res.status(400).json({ error: 'Source agent not connected to a gateway' });
    }

    // Get target agent (must be in same org)
    const targetAgent = await prisma.agent.findFirst({
      where: { id: targetAgentId, organizationId: req.organizationId! },
    });
    if (!targetAgent) return res.status(404).json({ error: 'Target agent not found in this organization' });
    if (!targetAgent.gatewayAgentId) {
      return res.status(400).json({ error: 'Target agent not connected to a gateway' });
    }

    // Both agents must be on the same gateway for agent-to-agent comms
    if (sourceAgent.gatewayId !== targetAgent.gatewayId) {
      return res.status(400).json({ error: 'Agents must be on the same gateway for direct messaging' });
    }

    const client = getGatewayClient(sourceAgent.gatewayId);
    if (!client || !client.isConnected()) {
      return res.status(503).json({ error: 'Gateway not connected' });
    }

    // Send message to target agent. Session key must match target agentId (gateway validates this).
    const sessionKey = `agent:${targetAgent.gatewayAgentId}:a2a-from-${sourceAgent.gatewayAgentId}`;
    const result = await client.rpc('agent', {
      message: `[Message from agent "${sourceAgent.displayName}" to agent "${targetAgent.displayName}"]\n\n${message}`,
      agentId: targetAgent.gatewayAgentId,
      sessionKey,
      idempotencyKey: randomUUID(),
      label: `Agent-to-agent: ${sourceAgent.displayName} → ${targetAgent.displayName}`,
    });

    // Find or create a thread for this agent pair
    const [first, second] = [sourceAgent.id, targetAgent.id].sort();
    let thread = await prisma.thread.findFirst({
      where: {
        organizationId: req.organizationId!,
        messages: {
          some: {
            OR: [
              { senderId: first, receiverId: second },
              { senderId: second, receiverId: first },
            ],
          },
        },
      },
    });

    if (!thread) {
      thread = await prisma.thread.create({
        data: {
          organizationId: req.organizationId!,
          title: `${sourceAgent.displayName} ↔ ${targetAgent.displayName}`,
        },
      });
    }

    // Create Message record for Communications page
    const agentSelect = { id: true, name: true, displayName: true, avatar: true };
    const dbMessage = await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: sourceAgent.id,
        receiverId: targetAgent.id,
        content: message,
        metadata: { gatewayRunId: (result as any)?.runId },
      },
      include: {
        sender: { select: agentSelect },
        receiver: { select: agentSelect },
      },
    });

    // Update thread timestamp
    await prisma.thread.update({
      where: { id: thread.id },
      data: { updatedAt: new Date() },
    });

    // Record activity for both agents
    const activityMsg = `${sourceAgent.displayName} sent message to ${targetAgent.displayName}`;
    await activityService.createActivity(req.organizationId!, {
      agentId: sourceAgent.id,
      type: 'MESSAGE',
      message: activityMsg,
      metadata: { targetAgentId: targetAgent.id, direction: 'outbound', threadId: thread.id },
    });
    await activityService.createActivity(req.organizationId!, {
      agentId: targetAgent.id,
      type: 'MESSAGE',
      message: `Received message from ${sourceAgent.displayName}`,
      metadata: { sourceAgentId: sourceAgent.id, direction: 'inbound', threadId: thread.id },
    });

    // Emit real-time events for monitoring
    const io = req.app.get('io');
    const room = `org:${req.organizationId}`;

    // Emit for Communications page (thread + message)
    io?.to(room).emit('thread:message', {
      threadId: thread.id,
      message: dbMessage,
    });

    // Emit for general activity monitoring
    io?.to(room).emit('agent:message', {
      sourceAgent: { id: sourceAgent.id, name: sourceAgent.displayName },
      targetAgent: { id: targetAgent.id, name: targetAgent.displayName },
      message,
      threadId: thread.id,
      timestamp: new Date().toISOString(),
    });

    res.json(result);
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

export default router;
