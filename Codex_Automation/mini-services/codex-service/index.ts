/**
 * Claude Automation - Lightweight Socket.IO Service
 *
 * This service provides Socket.IO chat functionality.
 * When the `claude` CLI is available, it will use the full Claude integration.
 * Otherwise, it provides a mock mode for UI demonstration.
 */

import express from 'express';
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serviceDir = path.dirname(fileURLToPath(import.meta.url));
const defaultWorkspaceDir = path.resolve(serviceDir, '..', '..');

const config = {
  port: 3003,
  apiKey: process.env.API_KEY || '',
  claudeCommand: process.env.CLAUDE_COMMAND || 'claude',
  claudeModel: process.env.CLAUDE_MODEL || undefined,
  maxPromptLength: 50_000,
  operationTimeoutMs: parseInt(process.env.OPERATION_TIMEOUT_MS || '900000', 10),
};

function getWorkspaceCwd(): string {
  return process.env.CLAUDE_CWD || defaultWorkspaceDir;
}

// ─── Check if Claude CLI is available ────────────────────────────
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

let claudeAvailable = false;

function checkClaudeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(config.claudeCommand, ['--version'], {
      shell: process.platform === 'win32',
      windowsHide: true,
      timeout: 5000,
    });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

// ─── Types ───────────────────────────────────────────────────────
interface StreamActivity {
  type: 'tool_use' | 'tool_result' | 'system' | 'unknown';
  tool?: string;
  input?: Record<string, unknown>;
  toolUseId?: string;
  content?: unknown;
  isError?: boolean;
  subtype?: string;
  data?: unknown;
  raw?: unknown;
}

type ClaudeStreamEvent =
  | { type: 'text'; content: string }
  | { type: 'activity'; activity: StreamActivity };

// ─── Claude Service (full integration) ───────────────────────────
interface InstructionResult {
  result: string;
  sessionId: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
  } | null;
}

interface ClaudeUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

interface ClaudeItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string | string[];
  status?: string;
  [key: string]: unknown;
}

interface ClaudeJsonEvent {
  type?: string;
  thread_id?: string;
  session_id?: string;
  item?: ClaudeItem;
  usage?: ClaudeUsage;
  error?: unknown;
  message?: unknown;
  is_error?: boolean;
  [key: string]: unknown;
}

interface RunState {
  sessionId: string | null;
  result: string;
  usage: InstructionResult['usage'];
  errorMessage: string | null;
  rawStdout: string;
  stderr: string;
}

const CANCELLED_MESSAGE = 'Request cancelled by user';
const SESSION_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const UI_MODEL_ALIASES = new Set(['system-operator']);

function normalizeSessionId(sessionId: string | undefined): string | undefined {
  const trimmed = sessionId?.trim() || '';
  if (!trimmed) return undefined;

  return trimmed.match(SESSION_ID_PATTERN)?.[0] || trimmed;
}

function composePrompt(prompt: string): string {
  const systemPrompt = process.env.SYSTEM_PROMPT || '';
  if (!systemPrompt) return prompt;
  return `${systemPrompt}\n\n---\n\nUser request:\n${prompt}`;
}

function resolveClaudeModel(model: string | undefined): string | undefined {
  const normalizedModel = model?.trim();
  if (!normalizedModel || UI_MODEL_ALIASES.has(normalizedModel)) return undefined;
  return normalizedModel;
}

function buildClaudeArgs(model: string | undefined, sessionId: string | undefined): string[] {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const effectiveModel = model || config.claudeModel;
  const args: string[] = ['--output-format', 'stream-json'];
  if (effectiveModel) {
    args.push('--model', effectiveModel);
  }
  if (normalizedSessionId) {
    args.push('--resume', normalizedSessionId);
  }
  return args;
}

function usageFromEvent(usage: ClaudeUsage | undefined): InstructionResult['usage'] {
  if (!usage) return null;
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    totalCost: 0,
  };
}

function stringifyCommand(command: string | string[] | undefined): string {
  if (Array.isArray(command)) return command.join(' ');
  return command || 'claude';
}

function emitActivity(onEvent: ((event: ClaudeStreamEvent) => void) | undefined, activity: StreamActivity): void {
  onEvent?.({ type: 'activity', activity });
}

function terminateProcessTree(child: ChildProcessWithoutNullStreams, reason: string): void {
  if (child.killed) return;
  console.log(`[claude] terminating process: ${reason}`);

  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      shell: false,
    });
    killer.on('error', (err) => {
      console.error(`[claude] taskkill failed: ${err.message}`);
      child.kill();
    });
    return;
  }

  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 2000).unref();
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(CANCELLED_MESSAGE));
      return;
    }

    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error(CANCELLED_MESSAGE));
    };

    signal?.addEventListener('abort', abort, { once: true });
  });
}

function getResponseStreamDelayMs(): number {
  const configuredDelay = Number(process.env.RESPONSE_STREAM_DELAY_MS ?? 18);
  if (!Number.isFinite(configuredDelay) || configuredDelay < 0) return 18;
  return configuredDelay;
}

function splitTextIntoWordChunks(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

async function streamResponseText(socket: Socket, text: string, signal?: AbortSignal): Promise<void> {
  const delayMs = getResponseStreamDelayMs();
  const chunks = splitTextIntoWordChunks(text);

  for (const chunk of chunks) {
    if (signal?.aborted) throw new Error(CANCELLED_MESSAGE);
    socket.emit('response', { type: 'text', content: chunk });
    if (delayMs > 0) {
      await delay(delayMs, signal);
    }
  }
}

function eventErrorMessage(event: ClaudeJsonEvent): string {
  if (typeof event.message === 'string') return event.message;
  if (typeof event.error === 'string') return event.error;
  if (event.error && typeof event.error === 'object' && 'message' in event.error) {
    const message = (event.error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return JSON.stringify(event.error ?? event);
}

function handleClaudeEvent(
  event: ClaudeJsonEvent,
  state: RunState,
  onEvent?: (event: ClaudeStreamEvent) => void,
): void {
  switch (event.type) {
    case 'system': {
      if (typeof event.session_id === 'string') {
        state.sessionId = event.session_id;
      }
      emitActivity(onEvent, {
        type: 'system',
        subtype: 'claude.system',
        data: { sessionId: state.sessionId },
      });
      break;
    }
    case 'assistant': {
      const msg = event.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
      if (msg?.content && Array.isArray(msg.content)) {
        const text = msg.content
          .filter(block => block.type === 'text' && block.text)
          .map(block => block.text!)
          .join('');
        if (text) {
          state.result = text;
          onEvent?.({ type: 'text', content: text });
        }
      }
      break;
    }
    case 'result': {
      if (event.is_error) {
        state.errorMessage = eventErrorMessage(event);
        emitActivity(onEvent, {
          type: 'system',
          subtype: 'claude.result.error',
          data: event,
        });
      } else {
        if (typeof event.session_id === 'string') {
          state.sessionId = event.session_id;
        }
        state.usage = usageFromEvent(event.usage);
        emitActivity(onEvent, {
          type: 'system',
          subtype: 'claude.result',
          data: { sessionId: state.sessionId, usage: state.usage },
        });
      }
      break;
    }
    case 'error': {
      state.errorMessage = eventErrorMessage(event);
      emitActivity(onEvent, {
        type: 'system',
        subtype: 'claude.error',
        data: event,
      });
      break;
    }
    default: {
      emitActivity(onEvent, {
        type: 'unknown',
        raw: event,
      });
    }
  }
}

async function runClaude(
  prompt: string,
  options: { model?: string; sessionId?: string; signal?: AbortSignal; onEvent?: (event: ClaudeStreamEvent) => void } = {},
): Promise<InstructionResult> {
  if (options.signal?.aborted) {
    throw new Error(CANCELLED_MESSAGE);
  }

  const startTime = Date.now();
  const normalizedSessionId = normalizeSessionId(options.sessionId);
  const requestedModel = resolveClaudeModel(options.model);
  const cwd = getWorkspaceCwd();
  const args = buildClaudeArgs(requestedModel, normalizedSessionId);
  const state: RunState = {
    sessionId: normalizedSessionId || null,
    result: '',
    usage: null,
    errorMessage: null,
    rawStdout: '',
    stderr: '',
  };

  console.log(`[claude] spawning ${config.claudeCommand}: model=${requestedModel || config.claudeModel || 'config-default'}, sessionId=${normalizedSessionId || 'new'}, cwd=${cwd}`);

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutBuffer = '';
    let timeout: ReturnType<typeof setTimeout>;
    let handleAbort = () => {};

    const child = spawn(config.claudeCommand, args, {
      cwd,
      env: process.env,
      shell: process.platform === 'win32',
      windowsHide: true,
    });

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', handleAbort);
      if (err) { reject(err); return; }
      if (state.errorMessage) { reject(new Error(state.errorMessage)); return; }
      const fallbackResult = state.rawStdout.trim();
      const elapsed = Date.now() - startTime;
      console.log(`[claude] complete: elapsed=${elapsed}ms, sessionId=${state.sessionId || 'none'}`);
      resolve({
        result: state.result || fallbackResult,
        sessionId: state.sessionId,
        usage: state.usage,
      });
    };

    handleAbort = () => {
      terminateProcessTree(child, 'cancelled');
      finish(new Error(CANCELLED_MESSAGE));
    };

    options.signal?.addEventListener('abort', handleAbort, { once: true });

    timeout = setTimeout(() => {
      const message = `Operation timed out: claude after ${config.operationTimeoutMs}ms`;
      console.error(`[claude] TIMEOUT: ${message}`);
      terminateProcessTree(child, 'timeout');
      finish(new Error(message));
    }, config.operationTimeoutMs);

    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const event = JSON.parse(trimmed) as ClaudeJsonEvent;
        handleClaudeEvent(event, state, options.onEvent);
      } catch {
        state.rawStdout += `${line}\n`;
        console.log(`[claude:stdout] ${line}`);
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        processLine(line);
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      state.stderr += chunk;
      const trimmed = chunk.trim();
      if (trimmed) console.error(`[claude:stderr] ${trimmed}`);
    });

    child.on('error', (err) => {
      finish(new Error(`Failed to start Claude command "${config.claudeCommand}": ${err.message}`));
    });

    child.on('close', (code) => {
      processLine(stdoutBuffer);
      if (code !== 0) {
        const stderr = state.stderr.trim();
        finish(new Error(`Claude exited with code ${code}${stderr ? `: ${stderr}` : ''}`));
        return;
      }
      finish();
    });

    child.stdin.on('error', (err) => {
      console.error(`[claude] stdin error: ${err.message}`);
    });
    child.stdin.end(composePrompt(prompt));
  });
}

// ─── Express + Socket.IO Setup ───────────────────────────────────
const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  path: '/socket.io',
  cors: { origin: '*' },
  maxHttpBufferSize: 1e6,
  connectTimeout: 10_000,
  pingTimeout: config.operationTimeoutMs + 30_000,
  pingInterval: 25_000,
});

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100kb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', claudeAvailable });
});

// REST API: POST /api/instruction
app.post('/api/instruction', async (req, res) => {
  const { prompt, model, sessionId } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'Missing or invalid "prompt" field' });
    return;
  }
  if (prompt.length > config.maxPromptLength) {
    res.status(400).json({ error: `Prompt exceeds maximum length of ${config.maxPromptLength} characters` });
    return;
  }

  if (!claudeAvailable) {
    res.status(503).json({ error: 'Claude CLI is not available. Please install and configure the Claude CLI.' });
    return;
  }

  try {
    const result = await runClaude(prompt, { model, sessionId: normalizeSessionId(sessionId) });
    res.json(result);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to execute instruction: ${errorMessage}` });
  }
});

// ─── Socket.IO Chat Handler ──────────────────────────────────────
const MAX_CONCURRENT_PER_SOCKET = 1;

io.on('connection', (socket: Socket) => {
  let sessionId: string | undefined;
  let activeRequests = 0;
  let activeAbortController: AbortController | null = null;

  console.log(`[socket] connected: ${socket.id}`);

  socket.on('disconnect', (reason) => {
    console.log(`[socket] disconnected: ${socket.id} (reason: ${reason})`);
    activeAbortController?.abort();
  });

  socket.on('cancel', () => {
    if (!activeAbortController || activeAbortController.signal.aborted) {
      socket.emit('cancelled', { cancelled: false, reason: 'No active request' });
      return;
    }

    console.log(`[socket] cancel requested: ${socket.id}`);
    activeAbortController.abort();
    socket.emit('cancelled', { cancelled: true });
  });

  socket.on('create_session', async (data: { clientThreadId?: string; model?: string } = {}) => {
    if (activeRequests >= MAX_CONCURRENT_PER_SOCKET) {
      socket.emit('session_create_error', {
        clientThreadId: data.clientThreadId,
        message: 'A Claude request is already in progress. Try again after it finishes.',
      });
      return;
    }

    if (!claudeAvailable) {
      const mockSessionId = `mock-${Date.now().toString(36)}`;
      sessionId = mockSessionId;
      socket.emit('session_created', { clientThreadId: data.clientThreadId, sessionId: mockSessionId });
      return;
    }

    const abortController = new AbortController();
    activeAbortController = abortController;
    activeRequests++;

    try {
      const result = await runClaude('Initialize a new Claude session for this chat. Do not inspect files, run commands, or edit anything. Reply only: READY.', {
        model: data.model,
        signal: abortController.signal,
      });

      if (result.sessionId) {
        sessionId = normalizeSessionId(result.sessionId);
        socket.emit('session_created', { clientThreadId: data.clientThreadId, sessionId });
      } else {
        socket.emit('session_create_error', {
          clientThreadId: data.clientThreadId,
          message: 'Claude did not return a session id.',
        });
      }
    } catch (err) {
      if (abortController.signal.aborted) {
        socket.emit('session_create_error', {
          clientThreadId: data.clientThreadId,
          message: CANCELLED_MESSAGE,
        });
      } else {
        const errorMessage = err instanceof Error ? err.message : String(err);
        socket.emit('session_create_error', {
          clientThreadId: data.clientThreadId,
          message: `Failed to create Claude session: ${errorMessage}`,
        });
      }
    } finally {
      if (activeAbortController === abortController) {
        activeAbortController = null;
      }
      activeRequests--;
    }
  });

  socket.on('message', async (data: { prompt: string; sessionId?: string; model?: string }) => {
    const promptPreview = data?.prompt?.slice(0, 120) || '<empty>';
    console.log(`[socket] message from ${socket.id}: "${promptPreview}"`);

    if (activeRequests >= MAX_CONCURRENT_PER_SOCKET) {
      socket.emit('error', { message: 'A request is already in progress. Wait for it to finish.' });
      return;
    }

    const prompt = data?.prompt;
    if (!prompt || typeof prompt !== 'string') {
      socket.emit('error', { message: 'Missing or invalid "prompt" field' });
      return;
    }

    if (prompt.length > config.maxPromptLength) {
      socket.emit('error', { message: `Prompt exceeds maximum length of ${config.maxPromptLength} characters` });
      return;
    }

    const activeSessionId = normalizeSessionId(data.sessionId) || sessionId;
    const abortController = new AbortController();
    activeAbortController = abortController;
    activeRequests++;

    if (claudeAvailable) {
      // ─── Full Claude CLI Integration ──────────────────────────
      try {
        let responseText = '';

        const onEvent = (event: ClaudeStreamEvent) => {
          if (event.type === 'text') {
            responseText += event.content;
            return;
          }
          socket.emit('activity', event.activity);
        };

        const result = await runClaude(prompt, {
          model: data.model,
          sessionId: activeSessionId,
          signal: abortController.signal,
          onEvent,
        });
        if (result.sessionId) {
          sessionId = normalizeSessionId(result.sessionId);
        }

        await streamResponseText(socket, responseText || result.result, abortController.signal);
        socket.emit('response_end', { sessionId, done: true });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (abortController.signal.aborted) {
          socket.emit('activity', {
            type: 'system',
            subtype: 'claude.turn.cancelled',
            data: { reason: CANCELLED_MESSAGE },
          });
          socket.emit('response_end', { sessionId, done: true, cancelled: true });
        } else {
          socket.emit('error', { message: `Failed to process message: ${errorMessage}` });
        }
      } finally {
        if (activeAbortController === abortController) {
          activeAbortController = null;
        }
        activeRequests--;
      }
    } else {
      // ─── Mock Mode (no Claude CLI) ────────────────────────────
      const mockSessionId = `mock-${Date.now().toString(36)}`;
      sessionId = mockSessionId;

      socket.emit('activity', {
        type: 'system',
        subtype: 'claude.thread.started',
        data: { threadId: mockSessionId },
      });

      try {
        await delay(500, abortController.signal);
        const toolUseId = `cmd-${Date.now()}`;
        socket.emit('activity', {
          type: 'tool_use',
          tool: 'shell',
          toolUseId,
          input: { command: `echo "Processing: ${prompt.slice(0, 50)}..."` },
        });

        await delay(800, abortController.signal);

        socket.emit('activity', {
          type: 'tool_result',
          toolUseId,
          content: { status: 'completed' },
          isError: false,
        });

        const responseText = generateMockResponse(prompt);
        await streamResponseText(socket, responseText, abortController.signal);

        socket.emit('activity', {
          type: 'system',
          subtype: 'claude.turn.completed',
          data: { usage: { inputTokens: prompt.length, outputTokens: responseText.length } },
        });

        socket.emit('response_end', { sessionId: mockSessionId, done: true });
      } catch (err) {
        if (abortController.signal.aborted) {
          socket.emit('activity', {
            type: 'system',
            subtype: 'claude.turn.cancelled',
            data: { reason: CANCELLED_MESSAGE },
          });
          socket.emit('response_end', { sessionId: mockSessionId, done: true, cancelled: true });
        } else {
          const errorMessage = err instanceof Error ? err.message : String(err);
          socket.emit('error', { message: `Failed to process message: ${errorMessage}` });
        }
      } finally {
        if (activeAbortController === abortController) {
          activeAbortController = null;
        }
        activeRequests--;
      }
    }
  });
});

// ─── Mock Response Generator ─────────────────────────────────────
function generateMockResponse(prompt: string): string {
  const lower = prompt.toLowerCase();

  if (lower.includes('log') || lower.includes('search') || lower.includes('txid') || lower.includes('transaction')) {
    return `I'll help you search for that transaction. Here's what I found:\n\n- **Transaction Status**: The search has been initiated\n- **Log Files**: Scanning PM2 logs across all instances\n- **Service**: blostem-external-Prod\n\n**Note**: This is a demo response. To enable real Claude CLI integration, please ensure the \`claude\` command is available in your environment and configure the following environment variables:\n\n\`\`\`bash\nCLAUDE_COMMAND=claude\nCLAUDE_MODEL=<your-model>\nCLAUDE_CWD=/path/to/workspace\n\`\`\`\n\nWould you like me to search a specific date range or instance?`;
  }

  if (lower.includes('error') || lower.includes('failed') || lower.includes('issue')) {
    return `Let me analyze the error patterns for you.\n\n**Analysis Summary:**\n- Checking error logs across all PM2 instances\n- Looking for correlation with recent deployments\n- Scanning for bank API timeout patterns\n\n**Note**: This is a demo response. Connect the Claude CLI for real-time analysis.\n\n\`\`\`bash\n# Example command for real analysis:\nzgrep -l "error" /home/ubuntu/.pm2/logs/blostem-external-Prod-error-*.log\n\`\`\``;
  }

  if (lower.includes('command') || lower.includes('run') || lower.includes('execute')) {
    return `I can help execute system commands. Here's a summary of available operations:\n\n1. **Log Search** - Search PM2 logs for transaction IDs\n2. **Error Analysis** - Analyze error patterns across services\n3. **Service Status** - Check PM2 process status\n\n\`\`\`bash\n# Example: Check PM2 status\npm2 list\n\`\`\`\n\n**Note**: Enable Claude CLI for full command execution capabilities.`;
  }

  return `I understand your request: "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"\n\nI'm currently running in **demo mode** because the Claude CLI is not available in this environment. To enable full functionality:\n\n1. Install the Claude CLI\n2. Set the \`CLAUDE_COMMAND\` environment variable\n3. Configure your model and workspace directory\n\n\`\`\`bash\n# Environment configuration\nCLAUDE_COMMAND=claude\nCLAUDE_MODEL=claude-opus-4-5\nCLAUDE_CWD=/your/workspace\n\`\`\`\n\nOnce configured, I'll be able to:\n- Execute real shell commands\n- Search and analyze logs\n- Perform multi-step operations\n- Track session state across interactions`;
}

// ─── Start Server ────────────────────────────────────────────────
const PORT = 3003;

async function start() {
  claudeAvailable = await checkClaudeAvailable();

  httpServer.listen(PORT, () => {
    console.log(`Claude Service running on port ${PORT}`);
    console.log(`REST API:    POST /api/instruction`);
    console.log(`Socket.IO:   ws://localhost:${PORT}`);
    console.log(`Auth:        ${config.apiKey ? 'enabled (x-api-key)' : 'DISABLED'}`);
    console.log(`Claude CLI:  ${claudeAvailable ? 'AVAILABLE' : 'NOT FOUND (running in demo mode)'}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`\n${signal} received — shutting down gracefully`);
  io.disconnectSockets(true);
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('[process] Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[process] Uncaught exception:', err.message);
});
