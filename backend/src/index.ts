import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { createServer } from 'http';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { setupWebSocket } from './websocket/index.js';
import { requireAuth } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import orgRoutes from './routes/organizations.js';
import agentRoutes from './routes/agents.js';
import activityRoutes from './routes/activities.js';
import taskRoutes from './routes/tasks.js';
import threadRoutes from './routes/threads.js';
import sessionRoutes from './routes/sessions.js';
import metricsRoutes from './routes/metrics.js';
import alertRoutes from './routes/alerts.js';
import commandRoutes from './routes/commands.js';
import searchRoutes from './routes/search.js';
import configRoutes from './routes/config.js';
import mcpRoutes from './routes/mcp.js';
import remoteRoutes from './routes/remote.js';
import { requireApiKey } from './middleware/api-key-auth.js';
import gatewayRoutes from './routes/gateways.js';
import llmProviderRoutes from './routes/llm-providers.js';
import boardRoutes from './routes/boards.js';
import approvalRoutes from './routes/approvals.js';
import agentApiRoutes from './routes/agent-api.js';
import tagRoutes from './routes/tags.js';
import customFieldRoutes from './routes/custom-fields.js';
import skillRoutes from './routes/skills.js';
import webhookRoutes from './routes/webhooks.js';
import webhookInboundRoutes from './routes/webhook-inbound.js';
import onboardingRoutes from './routes/onboarding.js';
import boardGroupMemoryRoutes from './routes/board-group-memory.js';
import boardMemoryRoutes from './routes/board-memory.js';
import soulTemplateRoutes from './routes/soul-templates.js';
import motherChatRoutes from './routes/mother-chat.js';
import agentDesignerRoutes from './routes/agent-designer.js';
import errorEventRoutes from './routes/error-events.js';
import mutualFundMonitorRoutes from './routes/mutual-fund-monitor.js';
import { connectAllGateways, setSocketIO } from './services/gateway.service.js';
import { startMutualFundMonitor, stopMutualFundMonitor } from './services/mutual-fund-monitor.service.js';
import { getClaudeCliDiagnostics, isCodexCliRuntimeEnabled } from './services/claude-cli.service.js';
import { ensureDevelopmentAdminUser } from './services/dev-admin.service.js';
import { startAgentRunWorker, stopAgentRunWorker } from './services/agent-run-queue.service.js';

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 4000;
const HOST = process.env.BACKEND_HOST || process.env.HOST || '127.0.0.1';
const REQUEST_TIMEOUT_MS = Number(process.env.BACKEND_REQUEST_TIMEOUT_MS || 16 * 60 * 1000);

httpServer.requestTimeout = REQUEST_TIMEOUT_MS;
httpServer.headersTimeout = REQUEST_TIMEOUT_MS + 5_000;
httpServer.keepAliveTimeout = 65_000;

// Trust first proxy (nginx/Cloudflare) — required for correct rate limiting & secure cookies
app.set('trust proxy', 1);

// CORS: env-based origin configuration
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://127.0.0.1:5175'];

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // CSP managed by frontend
  crossOriginEmbedderPolicy: false, // Needed for WebSocket
}));
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Agent-Token', 'X-Api-Key'],
}));

// Cookie parser (for httpOnly refresh token cookies)
app.use(cookieParser());

// Structured HTTP request logging (pino)
app.use(pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => req.url === '/api/health', // skip health checks
  },
}));

// Request size limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Disable X-Powered-By (helmet does this, but explicit for clarity)
app.disable('x-powered-by');

// Health check (public)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes (public)
app.use('/api/auth', authRoutes);

// Protected routes
app.use('/api/agents', requireAuth, agentRoutes);
app.use('/api/activities', requireAuth, activityRoutes);
app.use('/api/tasks', requireAuth, taskRoutes);
app.use('/api/threads', requireAuth, threadRoutes);
app.use('/api/sessions', requireAuth, sessionRoutes);
app.use('/api/tokens', requireAuth, metricsRoutes);    // token routes at /api/tokens
app.use('/api/metrics', requireAuth, metricsRoutes);   // metric routes at /api/metrics
app.use('/api/alerts', requireAuth, alertRoutes);
app.use('/api/commands', requireAuth, commandRoutes);
app.use('/api/activities/search', requireAuth, searchRoutes);
app.use('/api/agents', requireAuth, configRoutes);
app.use('/api/org', requireAuth, orgRoutes);

// MCP routes (nested under agents, needs mergeParams in router)
app.use('/api/agents/:agentId/mcp-servers', requireAuth, mcpRoutes);

// Remote agent routes (API key auth, not JWT)
app.use('/api/remote', requireApiKey, remoteRoutes);

// Gateway routes
app.use('/api/gateways', requireAuth, gatewayRoutes);

// LLM Provider routes
app.use('/api/llm-providers', requireAuth, llmProviderRoutes);

// Board routes (boards + board groups)
app.use('/api/boards', requireAuth, boardRoutes);

// Approval routes
app.use('/api/approvals', requireAuth, approvalRoutes);

// Agent self-auth API (agents authenticate with X-Agent-Token, no JWT needed)
app.use('/api/agent-api', agentApiRoutes);

// Mission Control features
app.use('/api/tags', requireAuth, tagRoutes);
app.use('/api/custom-fields', requireAuth, customFieldRoutes);
app.use('/api/skills', requireAuth, skillRoutes);
app.use('/api/boards', requireAuth, webhookRoutes);
app.use('/api/v1/webhooks', webhookInboundRoutes);  // PUBLIC - no auth
app.use('/api/boards', requireAuth, onboardingRoutes);
app.use('/api/board-groups', requireAuth, boardGroupMemoryRoutes);
app.use('/api/boards', requireAuth, boardMemoryRoutes);
app.use('/api/soul-templates', requireAuth, soulTemplateRoutes);
app.use('/api/mother-chat', requireAuth, motherChatRoutes);
app.use('/api/agent-designer', requireAuth, agentDesignerRoutes);
app.use('/api/error-events', requireAuth, errorEventRoutes);
app.use('/api/v1/error-events', requireApiKey, errorEventRoutes);
app.use('/api/mutual-fund-monitor', requireAuth, mutualFundMonitorRoutes);

// Global error handler for unhandled async errors in routes
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (typeof err?.statusCode === 'number') {
    return res.status(err.statusCode).json({ error: err.message || 'Request failed' });
  }
  // Prisma unique constraint violation
  if (err?.code === 'P2002') {
    return res.status(409).json({ error: `Unique constraint failed on: ${err.meta?.target?.join(', ') || 'unknown field'}` });
  }
  // Prisma foreign key constraint violation
  if (err?.code === 'P2003') {
    return res.status(400).json({ error: `Foreign key constraint violated: ${err.meta?.field_name || 'unknown'}` });
  }
  // Prisma record not found
  if (err?.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found' });
  }
  logger.error({ err }, 'Unhandled route error');
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// WebSocket
const io = setupWebSocket(httpServer);
app.set('io', io);

// Share Socket.io with gateway service for event forwarding
setSocketIO(io);

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down Nexus backend');

  stopAgentRunWorker();
  stopMutualFundMonitor();
  io.close();

  await new Promise<void>((resolve) => {
    httpServer.close((err) => {
      if (err) logger.warn({ err }, 'HTTP server close returned an error during shutdown');
      resolve();
    });
  });
  await prisma.$disconnect().catch(err => logger.warn({ err }, 'Failed to disconnect Prisma during shutdown'));
  process.exit(0);
}

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  logger.error({ err }, 'Nexus backend HTTP server error');
  process.exit(1);
});

async function start() {
  await ensureDevelopmentAdminUser();

  // Reset any agents stuck as ONLINE from a previous crash (no agent can be
  // actively processing when the server just started)
  await prisma.agent.updateMany({
    where: { status: 'ONLINE' },
    data: { status: 'IDLE' },
  }).then(({ count }) => {
    if (count > 0) logger.info({ count }, 'Reset stuck ONLINE agents to IDLE on startup');
  });

  // Connect to all gateways on startup unless local Claude CLI is the selected runtime.
  if (isCodexCliRuntimeEnabled()) {
    const diagnostics = await getClaudeCliDiagnostics();
    const logPayload = {
      selectedCommand: diagnostics.selectedCommand,
      configuredCommand: diagnostics.configuredCommand,
      installationOk: diagnostics.installation.ok,
      authenticationOk: diagnostics.authentication.ok,
      authDetails: diagnostics.authentication.details,
    };
    if (diagnostics.installation.ok && diagnostics.authentication.ok) {
      logger.info(logPayload, 'Claude CLI runtime enabled; skipping gateway auto-connect');
    } else {
      logger.warn({
        ...logPayload,
        installationDetails: diagnostics.installation.details,
      }, 'Claude CLI runtime check failed; chat requests will return diagnostics until fixed');
    }
  } else {
    connectAllGateways().catch(err => {
      logger.warn({ err }, 'Gateway connection errors on startup');
    });
  }

  httpServer.listen(Number(PORT), HOST, () => {
    logger.info({ host: HOST, port: PORT }, 'Nexus backend running');
  });
  startAgentRunWorker(io);
  startMutualFundMonitor(io);
}

start().catch((err) => {
  logger.error({ err }, 'Nexus backend failed to start');
  process.exit(1);
});
