import { randomBytes, createHmac } from 'crypto';
import { timingSafeEqual } from 'crypto';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

function generateSecret(): string {
  return randomBytes(32).toString('hex');
}

export function verifyWebhookSignature(payload: string, secret: string, signature: string): boolean {
  if (!signature) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return timingSafeEqual(expectedBuf, signatureBuf);
}

export async function listWebhooks(boardId: string, organizationId: string) {
  // Verify board belongs to org
  const board = await prisma.board.findFirst({ where: { id: boardId, organizationId } });
  if (!board) throw new Error('Board not found');

  return prisma.boardWebhook.findMany({
    where: { boardId },
    orderBy: { createdAt: 'desc' },
    include: { agent: { select: { id: true, displayName: true, avatar: true } }, _count: { select: { payloads: true } } },
  });
}

export async function createWebhook(boardId: string, organizationId: string, data: {
  description?: string;
  agentId?: string;
  enabled?: boolean;
}) {
  const board = await prisma.board.findFirst({ where: { id: boardId, organizationId } });
  if (!board) throw new Error('Board not found');

  return prisma.boardWebhook.create({
    data: {
      boardId,
      description: data.description ?? '',
      agentId: data.agentId,
      enabled: data.enabled ?? true,
      secret: generateSecret(),
    },
    include: { agent: { select: { id: true, displayName: true, avatar: true } }, _count: { select: { payloads: true } } },
  });
}

export async function updateWebhook(webhookId: string, boardId: string, organizationId: string, data: {
  description?: string;
  agentId?: string | null;
  enabled?: boolean;
}) {
  // Verify the board (and therefore the webhook) belongs to the caller's org before mutating.
  const board = await prisma.board.findFirst({ where: { id: boardId, organizationId } });
  if (!board) throw new Error('Board not found');

  return prisma.boardWebhook.update({
    where: { id: webhookId, boardId },
    data: {
      ...(data.description !== undefined && { description: data.description }),
      ...(data.agentId !== undefined && { agentId: data.agentId }),
      ...(data.enabled !== undefined && { enabled: data.enabled }),
    },
    include: { agent: { select: { id: true, displayName: true, avatar: true } }, _count: { select: { payloads: true } } },
  });
}

export async function deleteWebhook(webhookId: string, boardId: string, organizationId: string) {
  const board = await prisma.board.findFirst({ where: { id: boardId, organizationId } });
  if (!board) throw new Error('Board not found');

  return prisma.boardWebhook.delete({ where: { id: webhookId, boardId } });
}

export async function handleInbound(boardId: string, webhookId: string, payload: unknown, headers: Record<string, string>, sourceIp: string, contentType: string) {
  const webhook = await prisma.boardWebhook.findFirst({
    where: { id: webhookId, boardId, enabled: true },
  });
  if (!webhook) throw new Error('Webhook not found or disabled');

  // Validate secret if provided in header (constant-time comparison)
  const providedSecret = headers['x-webhook-secret'];
  if (webhook.secret) {
    if (!providedSecret) throw new Error('Webhook secret required');
    const buf1 = Buffer.from(webhook.secret);
    const buf2 = Buffer.from(providedSecret);
    if (buf1.length !== buf2.length || !timingSafeEqual(buf1, buf2)) {
      throw new Error('Invalid webhook secret');
    }
  }

  const stored = await prisma.boardWebhookPayload.create({
    data: {
      webhookId,
      payload: payload as any,
      headers,
      sourceIp,
      contentType,
    },
  });

  logger.info({ webhookId, payloadId: stored.id, boardId }, 'Webhook payload received');
  return stored;
}

export async function listPayloads(webhookId: string, organizationId: string, options?: { limit?: number; offset?: number }) {
  return prisma.boardWebhookPayload.findMany({
    // Scope through webhook -> board -> organization so payloads (which can carry
    // secrets/PII) are never readable across orgs.
    where: { webhookId, webhook: { board: { organizationId } } },
    orderBy: { receivedAt: 'desc' },
    take: options?.limit ?? 20,
    skip: options?.offset ?? 0,
  });
}

export async function getPayload(payloadId: string, organizationId: string) {
  return prisma.boardWebhookPayload.findFirst({
    where: { id: payloadId, webhook: { board: { organizationId } } },
  });
}
