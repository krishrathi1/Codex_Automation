import { prisma } from '../lib/prisma.js';
import { connectGateway, disconnectGateway, getGatewayClient } from '../openclaw/client.js';
import { validateExternalUrl } from '../lib/url-validator.js';
import { encryptField, decryptField } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import type { GatewayStatus } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';

// Socket.io instance for forwarding gateway events to UI
let socketIO: SocketIOServer | null = null;
export function setSocketIO(io: SocketIOServer) { socketIO = io; }

export async function getAllGateways(organizationId: string) {
  return prisma.gateway.findMany({
    where: { organizationId },
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { agents: true } },
    },
  });
}

export async function getGatewayById(id: string, organizationId: string) {
  return prisma.gateway.findFirst({
    where: { id, organizationId },
    include: {
      _count: { select: { agents: true } },
    },
  });
}

export async function createGateway(organizationId: string, data: {
  name: string;
  url: string;
  token: string;
  workspaceRoot?: string;
}) {
  // SSRF protection: validate the gateway URL
  validateExternalUrl(data.url, 'Gateway URL');

  // Encrypt token before storing
  const encryptedToken = encryptField(data.token);

  const gateway = await prisma.gateway.create({
    data: {
      organizationId,
      name: data.name,
      url: data.url,
      token: encryptedToken,
      workspaceRoot: data.workspaceRoot ?? '',
    },
    include: {
      _count: { select: { agents: true } },
    },
  });

  // Try to connect immediately (use plaintext token for connection)
  try {
    await connectGateway(gateway.id, data.url, data.token);
    await prisma.gateway.update({
      where: { id: gateway.id },
      data: { status: 'ONLINE', lastCheckedAt: new Date() },
    });
    gateway.status = 'ONLINE' as GatewayStatus;
    subscribeGatewayEvents(gateway.id, organizationId);
  } catch {
    await prisma.gateway.update({
      where: { id: gateway.id },
      data: { status: 'OFFLINE', lastCheckedAt: new Date() },
    });
    gateway.status = 'OFFLINE' as GatewayStatus;
  }

  return gateway;
}

export async function updateGateway(id: string, organizationId: string, data: {
  name?: string;
  url?: string;
  token?: string;
  workspaceRoot?: string;
}) {
  // SSRF protection: validate the gateway URL if being updated
  if (data.url) validateExternalUrl(data.url, 'Gateway URL');

  const gateway = await prisma.gateway.update({
    where: { id, organizationId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.url !== undefined && { url: data.url }),
      ...(data.token !== undefined && { token: encryptField(data.token) }),
      ...(data.workspaceRoot !== undefined && { workspaceRoot: data.workspaceRoot }),
    },
    include: {
      _count: { select: { agents: true } },
    },
  });

  // Reconnect if URL or token changed
  if (data.url || data.token) {
    try {
      await connectGateway(id, gateway.url, decryptField(gateway.token));
      await prisma.gateway.update({
        where: { id },
        data: { status: 'ONLINE', lastCheckedAt: new Date() },
      });
    } catch {
      await prisma.gateway.update({
        where: { id },
        data: { status: 'OFFLINE', lastCheckedAt: new Date() },
      });
    }
  }

  return gateway;
}

export async function deleteGateway(id: string, organizationId: string) {
  disconnectGateway(id);
  return prisma.gateway.delete({ where: { id, organizationId } });
}

export async function checkGatewayHealth(id: string, organizationId: string) {
  const gateway = await prisma.gateway.findFirst({ where: { id, organizationId } });
  if (!gateway) throw new Error('Gateway not found');

  let client = getGatewayClient(id);
  if (!client || !client.isConnected()) {
    try {
      client = await connectGateway(id, gateway.url, decryptField(gateway.token));
    } catch {
      await prisma.gateway.update({ where: { id }, data: { status: 'OFFLINE', lastCheckedAt: new Date() } });
      return { status: 'OFFLINE', connected: false };
    }
  }

  try {
    const health = await client.rpc('health', { probe: true });
    await prisma.gateway.update({ where: { id }, data: { status: 'ONLINE', lastCheckedAt: new Date() } });
    return { status: 'ONLINE', connected: true, details: health };
  } catch {
    await prisma.gateway.update({ where: { id }, data: { status: 'OFFLINE', lastCheckedAt: new Date() } });
    return { status: 'OFFLINE', connected: false };
  }
}

export async function getGatewayModels(id: string, organizationId: string) {
  const gateway = await prisma.gateway.findFirst({ where: { id, organizationId } });
  if (!gateway) throw new Error('Gateway not found');

  const client = getGatewayClient(id);
  if (!client || !client.isConnected()) {
    throw new Error('Gateway not connected');
  }

  const result = await client.rpc('models.list', {}) as { models: Array<{ id: string; name: string; provider: string; contextWindow?: number; reasoning?: boolean }> };
  return result.models;
}

export async function getGatewaySessions(id: string, organizationId: string) {
  const gateway = await prisma.gateway.findFirst({ where: { id, organizationId } });
  if (!gateway) throw new Error('Gateway not found');

  const client = getGatewayClient(id);
  if (!client || !client.isConnected()) {
    throw new Error('Gateway not connected');
  }

  const result = await client.rpc('sessions.list', {});
  return result;
}

// Subscribe to gateway events and forward to Socket.io for real-time monitoring
function subscribeGatewayEvents(gatewayId: string, organizationId: string) {
  const client = getGatewayClient(gatewayId);
  if (!client) return;

  client.onEvent((event, payload) => {
    if (!socketIO) return;
    const room = `org:${organizationId}`;

    // Forward relevant agent events to the UI
    switch (event) {
      case 'agent.activity':
      case 'agent.message':
      case 'agent.status':
      case 'session.start':
      case 'session.end':
      case 'session.message':
        socketIO.to(room).emit(`gateway:${event}`, {
          gatewayId,
          event,
          payload,
          timestamp: new Date().toISOString(),
        });
        break;
    }
  });
}

// Connect all gateways on startup
export async function connectAllGateways() {
  const gateways = await prisma.gateway.findMany();
  for (const gw of gateways) {
    try {
      await connectGateway(gw.id, gw.url, decryptField(gw.token));
      await prisma.gateway.update({
        where: { id: gw.id },
        data: { status: 'ONLINE', lastCheckedAt: new Date() },
      });
      subscribeGatewayEvents(gw.id, gw.organizationId);
      logger.info({ gateway: gw.name, url: gw.url }, 'Gateway connected');
    } catch (err) {
      await prisma.gateway.update({
        where: { id: gw.id },
        data: { status: 'OFFLINE', lastCheckedAt: new Date() },
      });
      logger.warn({ gateway: gw.name, err }, 'Failed to connect gateway');
    }
  }
}
