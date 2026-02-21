import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { createServer } from 'http';
import { logger } from './lib/logger.js';
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
import { connectAllGateways, setSocketIO } from './services/gateway.service.js';

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 4000;

// CORS: env-based origin configuration
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'http://localhost:5174'];

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

// WebSocket
const io = setupWebSocket(httpServer);
app.set('io', io);

// Share Socket.io with gateway service for event forwarding
setSocketIO(io);

// Connect to all gateways on startup
connectAllGateways().catch(err => {
  logger.warn({ err }, 'Gateway connection errors on startup');
});

httpServer.listen(PORT, () => {
  logger.info({ port: PORT }, 'Nexus backend running');
});
