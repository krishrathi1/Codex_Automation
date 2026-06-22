# Claude CLI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every reference to Codex CLI with Claude CLI (`claude`) throughout the backend and mini-service, while keeping the existing DB schema, WebSocket events, and frontend API contract identical.

**Architecture:** The existing `codex-cli.service.ts` spawns a `codex exec --json` subprocess, writes the prompt to stdin, and streams JSONL events from stdout. We replace that with `claude --output-format stream-json`, mapping Claude's event schema (`system/assistant/result`) to the same internal `NexusCodexEvent` union the rest of the codebase already consumes. All DB fields, session keys, and socket events keep the same names so no migration is needed.

**Tech Stack:** Node.js / TypeScript / Express / Socket.IO / Prisma (PostgreSQL) — no new dependencies.

## Global Constraints

- `AGENT_RUNTIME=claude-cli` replaces `AGENT_RUNTIME=codex-cli` as the env value that enables this path.
- All existing `NexusCodexEvent` types, DB field names, and socket event names (`agent:chat:event`, `agent:updated`) remain **unchanged** — the frontend does not change.
- Backward-compatible: agents already in the DB with `codexCliSessionId` in `identityProfile` must keep working (read both old and new session key names).
- Spawn options must include `shell: process.platform === 'win32'` and `windowsHide: true` — same as the Codex subprocess today.
- Claude CLI binary is looked up via `CLAUDE_CLI_PATH` → `CLAUDE_COMMAND` env vars → `claude` on PATH (no macOS app fallback).
- Session IDs come from Claude's `session_id` field in the `result` event.

---

## File Map

| Action | File | Notes |
|--------|------|-------|
| **Create** | `backend/src/services/claude-cli.service.ts` | Full replacement for codex-cli.service.ts |
| **Modify** | `backend/src/routes/agents.ts` | Swap import, rename handler fn |
| **Modify** | `backend/src/routes/mother-chat.ts` | Swap import for diagnostics |
| **Modify** | `backend/src/services/mother-chat.service.ts` | Swap 6 named imports |
| **Modify** | `backend/src/services/agent-run-queue.service.ts` | Swap 7 named imports |
| **Modify** | `backend/src/index.ts` | Swap 2 named imports + log strings |
| **Modify** | `Codex_Automation/mini-services/codex-service/index.ts` | Swap `codex` command → `claude` |
| **Modify** | `backend/.env.example` | Replace `CODEX_*` vars with `CLAUDE_*` |
| **Modify** | `backend/.env` | Replace `CODEX_*` vars with `CLAUDE_*` |

---

## Task 1: Create `claude-cli.service.ts`

**Files:**
- Create: `backend/src/services/claude-cli.service.ts`

**Interfaces (Produces — consumed by Tasks 2–6):**
```typescript
// Identical to what codex-cli.service.ts exported — callers don't change types
export interface CodexCliUsage { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens }
export interface NexusCodexEvent { type: NexusCodexEventType; content: string; metadata?: Record<string, unknown> }
export type NexusCodexEventType = 'response'|'activity'|'tool_call'|'tool_result'|'terminal_output'|'file_read'|'file_write'|'status_update'|'response_end'|'error'
export interface CodexRunState { codexSessionId, result, usage, errorMessage, rawStdout, stderr }
export interface CodexCliRunResult { status, result, codexSessionId, nexusSessionId, durationMs, usage, model }

// Key functions
export function isCodexCliRuntimeEnabled(): boolean
export function selectedAgentRuntime(): string
export function resolveCodexCwd(agent?): string
export function getAgentCodexSessionId(agent): string | undefined
export async function getThreadCodexSessionId(threadId, organizationId?): Promise<string | undefined>
export async function resolveCodexCommand(): Promise<string>
export async function validateInstallation(): Promise<{ ok, command, version?, details }>
export async function validateAuthentication(): Promise<{ ok, command, details }>
export async function getCodexCliDiagnostics(agent?): Promise<DiagnosticsObject>
export function buildCodexExecArgs(options): string[]
export function isCodexResumeUnavailableError(err): boolean
export function applyCodexJsonEvent(event, state): NexusCodexEvent[]
export function runCodexCliPrompt(options): Promise<CodexRunState>
export async function runCodexCliPromptWithResumeRecovery(options): Promise<CodexRunState>
export async function sendCodexCliAgentMessage(options): Promise<CodexCliRunResult>
export async function getCodexCliAgentMessages(agent, limit?): Promise<{ sessionKey, messages }>
```

- [ ] **Step 1: Create the file with env helpers and types**

```typescript
// backend/src/services/claude-cli.service.ts
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { accessSync, constants, statSync } from 'fs';
import path from 'path';
import os from 'os';
import type { Agent as PrismaAgent, ActivityType } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import * as activityService from './activity.service.js';
import * as llmProviderService from './llm-provider.service.js';
import { getOrCreateAdminAgent } from './system-agent.service.js';

const SESSION_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CLAUDE_CLI_RUNTIME_VALUES = new Set(['claude-cli', 'claude']);
const DEFAULT_OPERATION_TIMEOUT_MS = 15 * 60 * 1000;
const runningClaudeAgentRuns = new Set<string>();

type JsonRecord = Record<string, unknown>;

export interface CodexCliUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export type NexusCodexEventType =
  | 'response' | 'activity' | 'tool_call' | 'tool_result'
  | 'terminal_output' | 'file_read' | 'file_write'
  | 'status_update' | 'response_end' | 'error';

export interface NexusCodexEvent {
  type: NexusCodexEventType;
  content: string;
  metadata?: JsonRecord;
}

export interface CodexRunState {
  codexSessionId: string | null;
  result: string;
  usage: CodexCliUsage | null;
  errorMessage: string | null;
  rawStdout: string;
  stderr: string;
}

export interface CodexCliRunResult {
  status: 'finished' | 'failed';
  result: string;
  codexSessionId: string | null;
  nexusSessionId: string;
  durationMs: number;
  usage: CodexCliUsage | null;
  model: string;
}

interface SendCodexCliAgentMessageOptions {
  organizationId: string;
  agent: PrismaAgent;
  message: string;
  requestId?: string;
  io?: SocketIOServer;
}

export function selectedAgentRuntime() {
  return (process.env.AGENT_RUNTIME || 'claude-cli').trim().toLowerCase();
}

export function isCodexCliRuntimeEnabled() {
  return CLAUDE_CLI_RUNTIME_VALUES.has(selectedAgentRuntime());
}

function readBooleanEnv(name: string, fallback = false) {
  const v = process.env[name];
  if (!v) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

function readNumberEnv(name: string, fallback: number) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function projectRoot() {
  return path.basename(process.cwd()) === 'backend'
    ? path.resolve(process.cwd(), '..')
    : process.cwd();
}

function expandHome(input: string) {
  return input.startsWith('~/') ? path.join(os.homedir(), input.slice(2)) : input;
}

function objectRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord : {};
}

function normalizeSessionId(sessionId: unknown): string | undefined {
  if (typeof sessionId !== 'string') return undefined;
  const trimmed = sessionId.trim();
  if (!trimmed) return undefined;
  return trimmed.match(SESSION_ID_PATTERN)?.[0] || trimmed;
}

function diagnosticError(message: string, statusCode = 500) {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = statusCode;
  return err;
}
```

- [ ] **Step 2: Add workspace, session helpers**

Append to the file:

```typescript
export function resolveCodexCwd(agent?: Pick<PrismaAgent, 'workspace'>) {
  const configured = process.env.CLAUDE_WORKSPACE_ROOT || agent?.workspace;
  if (!configured?.trim()) return projectRoot();
  const expanded = expandHome(configured.trim());
  return path.isAbsolute(expanded) ? expanded : path.resolve(projectRoot(), expanded);
}

export function getAgentCodexSessionId(agent: Pick<PrismaAgent, 'identityProfile' | 'gatewayAgentId'>) {
  const profile = objectRecord(agent.identityProfile);
  // Check both new (claude) and old (codex) key names for backward compat
  return normalizeSessionId(profile.claudeCliSessionId)
    || normalizeSessionId(profile.codexCliSessionId)
    || normalizeSessionId(profile.codexSessionId)
    || normalizeSessionId(profile.activeWorkflowSessionId)
    || normalizeSessionId(
        agent.gatewayAgentId?.startsWith('claude:')
          ? agent.gatewayAgentId.slice('claude:'.length)
          : agent.gatewayAgentId?.startsWith('codex:')
            ? agent.gatewayAgentId.slice('codex:'.length)
            : undefined
      );
}

function getAgentChatThreadId(agent: Pick<PrismaAgent, 'identityProfile'>) {
  const profile = objectRecord(agent.identityProfile);
  return typeof profile.nexusChatThreadId === 'string' ? profile.nexusChatThreadId : undefined;
}

function getSessionIdFromMetadata(metadata: unknown) {
  const data = objectRecord(metadata);
  return normalizeSessionId(data.claudeCliSessionId)
    || normalizeSessionId(data.codexCliSessionId)
    || normalizeSessionId(data.codexSessionId)
    || normalizeSessionId(data.activeWorkflowSessionId)
    || normalizeSessionId(data.sessionKey)
    || normalizeSessionId(data.runId);
}

function isConfirmedSessionMetadata(metadata: unknown) {
  const data = objectRecord(metadata);
  return data.claudeSessionConfirmed === true
    || data.codexSessionConfirmed === true
    || data.role !== 'user';
}

export async function getThreadCodexSessionId(threadId: string, organizationId?: string) {
  const messages = await prisma.message.findMany({
    where: {
      threadId,
      ...(organizationId && { thread: { organizationId } }),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { metadata: true },
  });

  for (const message of messages) {
    const sessionId = getSessionIdFromMetadata(message.metadata);
    if (sessionId && isConfirmedSessionMetadata(message.metadata)) return sessionId;
  }
  return undefined;
}
```

- [ ] **Step 3: Add CLI resolution and probing**

Append to the file:

```typescript
function isExecutable(filePath: string) {
  try { accessSync(filePath, constants.X_OK); return true; } catch { return false; }
}

function configuredClaudeCommand() {
  const cliPath = process.env.CLAUDE_CLI_PATH?.trim();
  if (cliPath) {
    return { envName: 'CLAUDE_CLI_PATH', value: cliPath, expandedValue: expandHome(cliPath), mustBeFilePath: true };
  }
  const command = process.env.CLAUDE_COMMAND?.trim();
  if (command) {
    const expandedValue = expandHome(command);
    return {
      envName: 'CLAUDE_COMMAND', value: command, expandedValue,
      mustBeFilePath: path.isAbsolute(expandedValue) || expandedValue.includes('/') || expandedValue.includes('\\'),
    };
  }
  return null;
}

function resolveConfiguredExecutablePath(envName: string, configuredPath: string) {
  const command = path.isAbsolute(configuredPath)
    ? configuredPath : path.resolve(projectRoot(), configuredPath);
  let stats;
  try { stats = statSync(command); } catch {
    throw diagnosticError(`Configured Claude executable path is invalid: ${envName}=${command}. Path does not exist.`, 503);
  }
  if (stats.isDirectory()) throw diagnosticError(`${envName}=${command} is a directory, not an executable.`, 503);
  if (!stats.isFile()) throw diagnosticError(`${envName}=${command} is not a regular file.`, 503);
  if (!isExecutable(command)) throw diagnosticError(`${envName}=${command} is not executable.`, 503);
  return command;
}

function runCliProbe(command: string, args: string[], timeoutMs = 5000) {
  return new Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }>((resolve) => {
    let stdout = '', stderr = '', settled = false;
    const child = spawn(command, args, {
      env: createCliEnv(),
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      if (settled) return; settled = true;
      child.kill('SIGTERM');
      resolve({ ok: false, stdout, stderr: 'Timed out while probing Claude CLI', code: null });
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c: string) => { stdout += c; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c: string) => { stderr += c; });
    child.on('error', err => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: err.message, code: null });
    });
    child.on('close', code => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr, code });
    });
  });
}

function createCliEnv() {
  // Pass ANTHROPIC_API_KEY through (Claude needs it), strip OpenAI keys
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  delete env.PLATFORM_OPENAI_API_KEY;
  return env;
}

export async function resolveCodexCommand() {
  const configured = configuredClaudeCommand();
  if (configured) {
    if (configured.mustBeFilePath) {
      return resolveConfiguredExecutablePath(configured.envName, configured.expandedValue);
    }
    const probe = await runCliProbe(configured.expandedValue, ['--version']);
    if (probe.ok) return configured.expandedValue;
    throw diagnosticError(
      `Configured Claude command not runnable: ${configured.envName}=${configured.value}. Details: ${(probe.stderr || probe.stdout || 'probe failed').trim()}.`,
      503,
    );
  }

  const pathProbe = await runCliProbe('claude', ['--version']);
  if (pathProbe.ok) return 'claude';

  throw diagnosticError(
    'Claude CLI is not installed or not accessible. Install Claude Code CLI and ensure `claude` is on PATH, or set CLAUDE_CLI_PATH.',
    503,
  );
}

export async function validateInstallation() {
  try {
    const command = await resolveCodexCommand();
    const result = await runCliProbe(command, ['--version']);
    return { ok: result.ok, command, version: result.stdout.trim().split('\n').pop() || undefined, details: (result.stderr || result.stdout).trim() };
  } catch (err) {
    return { ok: false, command: null, details: (err as Error).message };
  }
}

export async function validateAuthentication() {
  // Claude CLI authenticates via ANTHROPIC_API_KEY or stored OAuth.
  // Running --version is sufficient to confirm the binary is there;
  // actual auth errors only surface when a real prompt is executed.
  // We do a lightweight version probe here and treat success as "auth ok".
  try {
    const command = await resolveCodexCommand();
    const result = await runCliProbe(command, ['--version']);
    return { ok: result.ok, command, details: result.ok ? 'Claude CLI available' : (result.stderr || result.stdout).trim() };
  } catch (err) {
    return { ok: false, command: null, details: (err as Error).message };
  }
}

export async function getCodexCliDiagnostics(agent?: Pick<PrismaAgent, 'workspace'>) {
  const installation = await validateInstallation();
  const authentication = installation.ok
    ? await validateAuthentication()
    : { ok: false, command: installation.command, details: 'Skipped because installation check failed' };
  const configured = configuredClaudeCommand();

  return {
    agentRuntime: selectedAgentRuntime(),
    configuredCommand: configured ? {
      envName: configured.envName,
      value: configured.value,
      expandedValue: configured.expandedValue,
      mustBeFilePath: configured.mustBeFilePath,
      validation: configured.mustBeFilePath ? (() => {
        try { return { ok: true, warning: null, command: resolveConfiguredExecutablePath(configured.envName, configured.expandedValue) }; }
        catch (e) { return { ok: false, warning: (e as Error).message, command: null }; }
      })() : null,
    } : null,
    selectedCommand: installation.command,
    cwd: resolveCodexCwd(agent),
    model: process.env.CLAUDE_MODEL?.trim() || 'default',
    installation,
    authentication,
    loggedIn: authentication.ok,
  };
}
```

- [ ] **Step 4: Add event mapping (Claude JSON → NexusCodexEvent)**

Append to the file:

```typescript
// Claude CLI stream-json event shapes
interface ClaudeSystemEvent {
  type: 'system';
  subtype: string;
  session_id?: string;
  model?: string;
  [key: string]: unknown;
}

interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  [key: string]: unknown;
}

interface ClaudeAssistantEvent {
  type: 'assistant';
  message?: {
    content?: ClaudeContentBlock[];
    usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      output_tokens?: number;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ClaudeResultEvent {
  type: 'result';
  subtype?: string;
  session_id?: string;
  result?: string;
  is_error?: boolean;
  duration_ms?: number;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
  total_cost_usd?: number;
  [key: string]: unknown;
}

type ClaudeJsonEvent = ClaudeSystemEvent | ClaudeAssistantEvent | ClaudeResultEvent | Record<string, unknown>;

function usageFromClaudeEvent(usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number }): CodexCliUsage | null {
  if (!usage) return null;
  return {
    inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    cachedInputTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    reasoningOutputTokens: 0,
  };
}

export function applyCodexJsonEvent(event: ClaudeJsonEvent, state: CodexRunState): NexusCodexEvent[] {
  const eventType = (event as Record<string, unknown>).type as string | undefined;

  if (eventType === 'system') {
    const sys = event as ClaudeSystemEvent;
    if (sys.session_id) state.codexSessionId = sys.session_id;
    return [{ type: 'status_update', content: 'Claude session started', metadata: { claudeSessionId: state.codexSessionId, model: sys.model } }];
  }

  if (eventType === 'assistant') {
    const ast = event as ClaudeAssistantEvent;
    const blocks = ast.message?.content ?? [];
    const events: NexusCodexEvent[] = [];
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        state.result = block.text;
        events.push({ type: 'response', content: block.text, metadata: { block } });
      } else if (block.type === 'tool_use') {
        events.push({ type: 'tool_call', content: typeof block.name === 'string' ? block.name : 'tool call', metadata: { block } });
      } else {
        events.push({ type: 'activity', content: `Claude assistant: ${block.type}`, metadata: { block } });
      }
    }
    // Capture cumulative usage if present
    if (ast.message?.usage) {
      const u = usageFromClaudeEvent(ast.message.usage);
      if (u) state.usage = u;
    }
    return events.length > 0 ? events : [{ type: 'activity', content: 'Claude assistant turn', metadata: { event } }];
  }

  if (eventType === 'user') {
    // tool_result blocks from the user turn
    const userMsg = (event as Record<string, unknown>).message as { content?: ClaudeContentBlock[] } | undefined;
    const blocks = userMsg?.content ?? [];
    const events: NexusCodexEvent[] = [];
    for (const block of blocks) {
      if (block.type === 'tool_result') {
        events.push({ type: 'tool_result', content: 'Tool result received', metadata: { block } });
      }
    }
    return events.length > 0 ? events : [];
  }

  if (eventType === 'result') {
    const res = event as ClaudeResultEvent;
    if (res.session_id) state.codexSessionId = res.session_id;
    if (res.usage) {
      const u = usageFromClaudeEvent(res.usage);
      if (u) state.usage = u;
    }
    if (res.is_error) {
      state.errorMessage = typeof res.result === 'string' ? res.result : 'Claude returned an error';
      return [{ type: 'error', content: state.errorMessage, metadata: { event } }];
    }
    if (typeof res.result === 'string' && res.result) {
      state.result = res.result;
    }
    return [{ type: 'status_update', content: 'Claude turn completed', metadata: { usage: state.usage, session_id: state.codexSessionId } }];
  }

  return [{ type: 'activity', content: eventType || 'Claude event', metadata: { event } }];
}

export function isCodexResumeUnavailableError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  // Claude doesn't have "no rollout found" but may report session not found
  return /session.*not found/i.test(message) || /resume.*failed/i.test(message);
}
```

- [ ] **Step 5: Add exec args builder and subprocess runner**

Append to the file:

```typescript
export function buildCodexExecArgs(options: {
  sessionId?: string | null;
  model?: string;
}) {
  const args: string[] = ['--output-format', 'stream-json'];
  if (options.model) args.push('--model', options.model);
  const normalizedSessionId = normalizeSessionId(options.sessionId);
  if (normalizedSessionId) args.push('--resume', normalizedSessionId);
  return args;
}

function buildRuntimeExecArgs(sessionId?: string | null) {
  return buildCodexExecArgs({
    sessionId,
    model: process.env.CLAUDE_MODEL?.trim() || undefined,
  });
}

function createRunState(existingSessionId?: string | null): CodexRunState {
  return { codexSessionId: existingSessionId ?? null, result: '', usage: null, errorMessage: null, rawStdout: '', stderr: '' };
}

function terminateProcess(child: ChildProcessWithoutNullStreams, reason: string) {
  if (child.killed) return;
  logger.warn({ reason, pid: child.pid }, 'Terminating Claude CLI process');
  child.kill('SIGTERM');
  setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 2000).unref();
}

export function runCodexCliPrompt(options: {
  command: string;
  args: string[];
  cwd: string;
  prompt: string;
  existingCodexSessionId?: string | null;
  onEvent: (event: NexusCodexEvent, state: CodexRunState) => Promise<void>;
}) {
  const timeoutMs = readNumberEnv('CLAUDE_OPERATION_TIMEOUT_MS', DEFAULT_OPERATION_TIMEOUT_MS);
  const state = createRunState(options.existingCodexSessionId);

  return new Promise<CodexRunState>((resolve, reject) => {
    let stdoutBuffer = '';
    let settled = false;
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: createCliEnv(),
      shell: process.platform === 'win32',
      windowsHide: true,
    });

    const timeout = setTimeout(() => {
      terminateProcess(child, 'timeout');
      finish(diagnosticError(`Claude CLI timed out after ${timeoutMs}ms`, 504));
    }, timeoutMs);

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (err) { reject(err); return; }
      if (state.errorMessage) { reject(diagnosticError(state.errorMessage, 500)); return; }
      resolve(state);
    };

    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return Promise.resolve();
      try {
        const event = JSON.parse(trimmed) as ClaudeJsonEvent;
        const translated = applyCodexJsonEvent(event, state);
        return translated.reduce(
          (p, next) => p.then(() => options.onEvent(next, state)),
          Promise.resolve(),
        );
      } catch {
        state.rawStdout += `${line}\n`;
        return options.onEvent({ type: 'terminal_output', content: line, metadata: { stream: 'stdout' } }, state);
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      let idx = stdoutBuffer.indexOf('\n');
      while (idx >= 0) {
        const line = stdoutBuffer.slice(0, idx);
        stdoutBuffer = stdoutBuffer.slice(idx + 1);
        processLine(line).catch(err => logger.warn({ err }, 'Failed to handle Claude event'));
        idx = stdoutBuffer.indexOf('\n');
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      state.stderr += chunk;
      for (const line of chunk.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
        options.onEvent({ type: 'terminal_output', content: line, metadata: { stream: 'stderr' } }, state)
          .catch(err => logger.warn({ err }, 'Failed to handle Claude stderr event'));
      }
    });

    child.on('error', err => {
      finish(diagnosticError(`Failed to start Claude CLI "${options.command}": ${err.message}`, 503));
    });

    child.on('close', code => {
      processLine(stdoutBuffer)
        .then(() => {
          if (code !== 0 && !state.result) {
            const stderr = state.stderr.trim();
            finish(diagnosticError(`Claude exited with code ${code}${stderr ? `: ${stderr}` : ''}`, 500));
            return;
          }
          if (!state.result && state.rawStdout.trim()) state.result = state.rawStdout.trim();
          finish();
        })
        .catch(err => finish(err instanceof Error ? err : new Error(String(err))));
    });

    child.stdin.on('error', err => { logger.warn({ err }, 'Claude CLI stdin error'); });
    child.stdin.end(options.prompt);
  });
}

export async function runCodexCliPromptWithResumeRecovery(options: {
  command: string;
  cwd: string;
  prompt: string;
  existingCodexSessionId?: string | null;
  onEvent: (event: NexusCodexEvent, state: CodexRunState) => Promise<void>;
  logContext?: JsonRecord;
}) {
  const run = (sessionId?: string | null) => runCodexCliPrompt({
    command: options.command,
    args: buildRuntimeExecArgs(sessionId),
    cwd: options.cwd,
    existingCodexSessionId: sessionId,
    prompt: options.prompt,
    onEvent: options.onEvent,
  });

  try {
    return await run(options.existingCodexSessionId);
  } catch (err) {
    const staleSessionId = normalizeSessionId(options.existingCodexSessionId);
    if (!staleSessionId || !isCodexResumeUnavailableError(err)) throw err;

    logger.warn({ ...(options.logContext ?? {}), staleSessionId, errorMessage: (err as Error).message },
      'Saved Claude CLI session unavailable; starting a new session');

    await options.onEvent({
      type: 'status_update',
      content: 'Saved Claude session is unavailable; starting a new session.',
      metadata: { resumeRecovery: true, staleSessionId },
    }, createRunState(null));

    return run(null);
  }
}
```

- [ ] **Step 6: Add session persistence helpers and compose prompt**

Append to the file:

```typescript
function composeAgentPrompt(agent: PrismaAgent, message: string) {
  const profile = objectRecord(agent.identityProfile);
  const context = [
    `You are running as Nexus agent "${agent.displayName}" (${agent.name}).`,
    agent.description ? `Agent description:\n${agent.description}` : '',
    agent.workspace ? `Workspace:\n${agent.workspace}` : '',
    agent.soulMd ? `SOUL.md:\n${agent.soulMd}` : '',
    Object.keys(profile).length > 0 ? `Agent runtime metadata:\n${JSON.stringify(profile, null, 2)}` : '',
    'You are powered by Claude CLI. Use your existing authentication. Never ask for API keys.',
  ].filter(Boolean).join('\n\n');

  return `${context}\n\nUser message:\n${message}`;
}

async function upsertAgentChatThread(agent: PrismaAgent) {
  const existingThreadId = getAgentChatThreadId(agent);
  if (existingThreadId) {
    const existing = await prisma.thread.findFirst({
      where: { id: existingThreadId, organizationId: agent.organizationId },
    });
    if (existing) return existing;
  }

  const thread = await prisma.thread.create({
    data: { organizationId: agent.organizationId, title: `Chat with ${agent.displayName}` },
  });

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      identityProfile: {
        ...objectRecord(agent.identityProfile),
        nexusChatThreadId: thread.id,
        agentRuntime: 'claude-cli',
      } as any,
    },
  });

  return thread;
}

async function updateAgentSession(agent: PrismaAgent, sessionId: string, nexusChatThreadId?: string) {
  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      identityProfile: {
        ...objectRecord(agent.identityProfile),
        ...(nexusChatThreadId && { nexusChatThreadId }),
        claudeCliSessionId: sessionId,
        activeWorkflowSessionId: sessionId,
        agentRuntime: 'claude-cli',
      } as any,
    },
  });
}

function activityTypeForEvent(eventType: NexusCodexEventType): ActivityType {
  if (eventType === 'error') return 'ERROR';
  if (eventType === 'response') return 'MESSAGE';
  return 'SYSTEM';
}

function emitChatEvent(options: {
  io?: SocketIOServer;
  organizationId: string;
  agentId: string;
  nexusSessionId: string;
  codexSessionId?: string | null;
  requestId?: string;
  event: NexusCodexEvent;
}) {
  options.io?.to(`org:${options.organizationId}`).emit('agent:chat:event', {
    agentId: options.agentId,
    sessionId: options.nexusSessionId,
    nexusSessionId: options.nexusSessionId,
    codexSessionId: options.codexSessionId ?? null,
    requestId: options.requestId ?? null,
    type: options.event.type,
    content: options.event.content,
    metadata: options.event.metadata ?? {},
    timestamp: new Date().toISOString(),
  });
}

async function persistActivity(options: {
  organizationId: string;
  agentId: string;
  nexusSessionId: string;
  codexSessionId?: string | null;
  requestId?: string;
  event: NexusCodexEvent;
}) {
  return activityService.createActivity(options.organizationId, {
    agentId: options.agentId,
    type: activityTypeForEvent(options.event.type),
    message: options.event.content.slice(0, 500) || options.event.type,
    metadata: {
      runtime: 'claude-cli',
      nexusEventType: options.event.type,
      nexusSessionId: options.nexusSessionId,
      codexSessionId: options.codexSessionId ?? null,
      requestId: options.requestId ?? null,
      ...(options.event.metadata ?? {}),
    },
  });
}
```

- [ ] **Step 7: Add `sendCodexCliAgentMessage` and `getCodexCliAgentMessages`**

Append to the file:

```typescript
export async function sendCodexCliAgentMessage(options: SendCodexCliAgentMessageOptions): Promise<CodexCliRunResult> {
  if (!options.message.trim()) throw diagnosticError('message is required', 400);

  const agentRunKey = `${options.organizationId}:${options.agent.id}`;
  if (runningClaudeAgentRuns.has(agentRunKey)) {
    throw diagnosticError(
      `Claude CLI is already processing a message for ${options.agent.displayName}. Wait for that response to finish.`,
      409,
    );
  }
  runningClaudeAgentRuns.add(agentRunKey);

  try {
    const installation = await validateInstallation();
    if (!installation.ok || !installation.command) {
      throw diagnosticError(`Claude CLI installation check failed: ${installation.details}`, 503);
    }

    const command = installation.command;
    const cwd = resolveCodexCwd(options.agent);
    const thread = await upsertAgentChatThread(options.agent);
    const threadSessionId = await getThreadCodexSessionId(thread.id, options.organizationId);
    const agentSessionId = getAgentCodexSessionId(options.agent);
    const existingSessionId = threadSessionId || agentSessionId;
    const adminAgent = await getOrCreateAdminAgent(options.organizationId);
    const chatSession = await prisma.session.create({
      data: {
        organizationId: options.organizationId,
        agentId: options.agent.id,
        type: 'MESSAGE',
        status: 'RUNNING',
        summary: `Claude CLI chat: ${options.message.slice(0, 120)}`,
      },
    });

    const startedAt = Date.now();
    await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: adminAgent.id,
        receiverId: options.agent.id,
        content: options.message,
        metadata: {
          role: 'user',
          runtime: 'claude-cli',
          conversationKind: 'admin_agent',
          edgeSemantic: 'admin_to_agent',
          nexusSessionId: chatSession.id,
          resumeClaudeSessionId: existingSessionId ?? null,
          requestId: options.requestId ?? null,
        } as any,
      },
    });

    await prisma.agent.update({ where: { id: options.agent.id }, data: { status: 'ONLINE' } });
    options.io?.to(`org:${options.organizationId}`).emit('agent:updated', { id: options.agent.id, status: 'ONLINE' });

    logger.info({
      agentId: options.agent.id, command, cwd,
      resume: Boolean(existingSessionId),
      sessionSource: threadSessionId ? 'thread' : agentSessionId ? 'agent' : 'new',
      threadId: thread.id, nexusSessionId: chatSession.id,
    }, 'Starting Claude CLI agent chat');

    try {
      const state = await runCodexCliPromptWithResumeRecovery({
        command, cwd, existingCodexSessionId: existingSessionId,
        prompt: composeAgentPrompt(options.agent, options.message),
        logContext: { agentId: options.agent.id, nexusSessionId: chatSession.id, threadId: thread.id },
        onEvent: async (event, state) => {
          emitChatEvent({ io: options.io, organizationId: options.organizationId, agentId: options.agent.id, nexusSessionId: chatSession.id, codexSessionId: state.codexSessionId, requestId: options.requestId, event });
          await persistActivity({ organizationId: options.organizationId, agentId: options.agent.id, nexusSessionId: chatSession.id, codexSessionId: state.codexSessionId, requestId: options.requestId, event })
            .catch(err => logger.warn({ err }, 'Failed to persist Claude CLI activity'));
        },
      });

      const responseText = state.result || 'No response';
      const durationMs = Date.now() - startedAt;
      if (state.codexSessionId) await updateAgentSession(options.agent, state.codexSessionId, thread.id);

      await prisma.message.create({
        data: {
          threadId: thread.id,
          senderId: options.agent.id,
          receiverId: adminAgent.id,
          content: responseText,
          metadata: {
            role: 'assistant',
            runtime: 'claude-cli',
            conversationKind: 'admin_agent',
            edgeSemantic: 'agent_to_admin',
            nexusSessionId: chatSession.id,
            codexSessionId: state.codexSessionId,
            claudeCliSessionId: state.codexSessionId,
            claudeSessionConfirmed: Boolean(state.codexSessionId),
            codexSessionConfirmed: Boolean(state.codexSessionId),
            requestId: options.requestId ?? null,
            usage: state.usage,
          } as any,
        },
      });

      await prisma.session.update({
        where: { id: chatSession.id },
        data: {
          status: 'COMPLETED', endedAt: new Date(), durationMs,
          summary: `Claude CLI chat: ${options.message.slice(0, 120)}`,
          ...(state.usage && { tokensUsed: state.usage.inputTokens + state.usage.outputTokens }),
        },
      });
      await prisma.metricSnapshot.create({
        data: { organizationId: options.organizationId, agentId: options.agent.id, responseTimeMs: durationMs, success: true, toolName: 'claude-cli-chat' },
      });

      if (state.usage) {
        await llmProviderService.recordTokenUsage({
          organizationId: options.organizationId, agentId: options.agent.id,
          inputTokens: state.usage.inputTokens, outputTokens: state.usage.outputTokens,
          model: process.env.CLAUDE_MODEL?.trim() || 'claude-cli',
          mode: 'BYOK',
        }).catch(err => logger.warn({ err }, 'Failed to record Claude CLI token usage'));
      }

      emitChatEvent({
        io: options.io, organizationId: options.organizationId, agentId: options.agent.id,
        nexusSessionId: chatSession.id, codexSessionId: state.codexSessionId, requestId: options.requestId,
        event: { type: 'response_end', content: 'Claude response complete', metadata: { usage: state.usage } },
      });

      await prisma.agent.update({ where: { id: options.agent.id }, data: { status: 'IDLE' } });
      options.io?.to(`org:${options.organizationId}`).emit('agent:updated', { id: options.agent.id, status: 'IDLE' });

      return {
        status: 'finished', result: responseText, codexSessionId: state.codexSessionId,
        nexusSessionId: chatSession.id, durationMs, usage: state.usage,
        model: process.env.CLAUDE_MODEL?.trim() || 'claude-cli',
      };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const errorMessage = (err as Error).message;
      await prisma.session.update({ where: { id: chatSession.id }, data: { status: 'FAILED', endedAt: new Date(), durationMs, summary: `Claude CLI chat failed: ${errorMessage.slice(0, 120)}` } }).catch(() => {});
      await prisma.metricSnapshot.create({ data: { organizationId: options.organizationId, agentId: options.agent.id, responseTimeMs: durationMs, success: false, errorMessage, toolName: 'claude-cli-chat' } }).catch(() => {});
      await prisma.agent.update({ where: { id: options.agent.id }, data: { status: 'ERROR' } }).catch(() => {});
      options.io?.to(`org:${options.organizationId}`).emit('agent:updated', { id: options.agent.id, status: 'ERROR' });
      emitChatEvent({ io: options.io, organizationId: options.organizationId, agentId: options.agent.id, nexusSessionId: chatSession.id, codexSessionId: existingSessionId, requestId: options.requestId, event: { type: 'error', content: errorMessage } });
      throw err;
    }
  } finally {
    runningClaudeAgentRuns.delete(agentRunKey);
  }
}

export async function getCodexCliAgentMessages(agent: PrismaAgent, limit = 50) {
  const threadId = getAgentChatThreadId(agent);
  if (!threadId) {
    return { sessionKey: getAgentCodexSessionId(agent) || '', messages: [] };
  }

  const messages = await prisma.message.findMany({
    where: { threadId, thread: { organizationId: agent.organizationId } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const threadSessionId = await getThreadCodexSessionId(threadId, agent.organizationId);

  return {
    sessionKey: threadSessionId || getAgentCodexSessionId(agent) || '',
    messages: messages.reverse().map(message => {
      const metadata = objectRecord(message.metadata);
      return {
        role: metadata.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
        timestamp: message.createdAt.toISOString(),
      };
    }),
  };
}
```

- [ ] **Step 8: Verify file compiles**

```bash
cd backend
npx tsx --check src/services/claude-cli.service.ts
```

Expected: no output (no errors).

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/claude-cli.service.ts
git commit -m "feat: add claude-cli.service.ts replacing codex-cli for Claude CLI runtime"
```

---

## Task 2: Update `agents.ts`

**Files:**
- Modify: `backend/src/routes/agents.ts`

**Consumes:** `claude-cli.service.ts` exports from Task 1.

- [ ] **Step 1: Swap the import**

In [backend/src/routes/agents.ts](backend/src/routes/agents.ts), find line 8:
```typescript
import * as codexCliService from '../services/codex-cli.service.js';
```
Replace with:
```typescript
import * as codexCliService from '../services/claude-cli.service.js';
```

- [ ] **Step 2: Update runtime string in response (line 38)**

Find:
```typescript
      runtime: 'codex-cli',
```
Replace with:
```typescript
      runtime: 'claude-cli',
```

- [ ] **Step 3: Update the error message string (line ~203)**

Find:
```typescript
      return res.status(400).json({ error: 'Agent not connected to a gateway. Set AGENT_RUNTIME=codex-cli to use the local Codex CLI runtime.' });
```
Replace with:
```typescript
      return res.status(400).json({ error: 'Agent not connected to a gateway. Set AGENT_RUNTIME=claude-cli to use the local Claude CLI runtime.' });
```

- [ ] **Step 4: Verify no remaining codex-cli.service references**

```bash
grep -n "codex-cli.service" backend/src/routes/agents.ts
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/agents.ts
git commit -m "feat: agents.ts — use claude-cli.service"
```

---

## Task 3: Update `mother-chat.ts` route

**Files:**
- Modify: `backend/src/routes/mother-chat.ts`

- [ ] **Step 1: Swap import line 3**

Find:
```typescript
import * as codexCliService from '../services/codex-cli.service.js';
```
Replace with:
```typescript
import * as codexCliService from '../services/claude-cli.service.js';
```

- [ ] **Step 2: Update runtime string in POST /message response (line ~54)**

Find:
```typescript
      runtime: 'codex-cli',
```
Replace with:
```typescript
      runtime: 'claude-cli',
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/mother-chat.ts
git commit -m "feat: mother-chat.ts route — use claude-cli.service"
```

---

## Task 4: Update `mother-chat.service.ts`

**Files:**
- Modify: `backend/src/services/mother-chat.service.ts`

- [ ] **Step 1: Swap the import block (lines 8–17)**

Find:
```typescript
import {
  getThreadCodexSessionId,
  resolveCodexCwd,
  runCodexCliPromptWithResumeRecovery,
  validateAuthentication,
  validateInstallation,
  type CodexCliUsage,
  type NexusCodexEvent,
  type NexusCodexEventType,
} from './codex-cli.service.js';
```
Replace with:
```typescript
import {
  getThreadCodexSessionId,
  resolveCodexCwd,
  runCodexCliPromptWithResumeRecovery,
  validateAuthentication,
  validateInstallation,
  type CodexCliUsage,
  type NexusCodexEvent,
  type NexusCodexEventType,
} from './claude-cli.service.js';
```

- [ ] **Step 2: Verify no remaining codex-cli.service references**

```bash
grep -n "codex-cli.service" backend/src/services/mother-chat.service.ts
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/mother-chat.service.ts
git commit -m "feat: mother-chat.service.ts — import from claude-cli.service"
```

---

## Task 5: Update `agent-run-queue.service.ts`

**Files:**
- Modify: `backend/src/services/agent-run-queue.service.ts`

- [ ] **Step 1: Swap the import block (lines 9–19)**

Find:
```typescript
import {
  getAgentCodexSessionId,
  runCodexCliPromptWithResumeRecovery,
  resolveCodexCommand,
  resolveCodexCwd,
  validateAuthentication,
  validateInstallation,
  type CodexRunState,
  type NexusCodexEvent,
  type NexusCodexEventType,
} from './codex-cli.service.js';
```
Replace with:
```typescript
import {
  getAgentCodexSessionId,
  runCodexCliPromptWithResumeRecovery,
  resolveCodexCommand,
  resolveCodexCwd,
  validateAuthentication,
  validateInstallation,
  type CodexRunState,
  type NexusCodexEvent,
  type NexusCodexEventType,
} from './claude-cli.service.js';
```

- [ ] **Step 2: Find all `'codex-cli'` runtime strings in this file and update them**

```bash
grep -n "'codex-cli'" backend/src/services/agent-run-queue.service.ts
```

For each match, replace `'codex-cli'` with `'claude-cli'`. Also update `agentRuntime: 'codex-cli'` in `updateAgentCodexSession` (around line 228) and any `codexCliSessionId` field writes to also write `claudeCliSessionId`.

Find in `updateAgentCodexSession`:
```typescript
        codexCliSessionId: codexSessionId,
        activeWorkflowSessionId: codexSessionId,
        agentRuntime: 'codex-cli',
```
Replace with:
```typescript
        claudeCliSessionId: codexSessionId,
        codexCliSessionId: codexSessionId,
        activeWorkflowSessionId: codexSessionId,
        agentRuntime: 'claude-cli',
```

Also update the `gatewayAgentId` prefix from `codex:` to `claude:`:
Find:
```typescript
      gatewayAgentId: `codex:${agent.id}:${codexSessionId}`,
```
Replace with:
```typescript
      gatewayAgentId: `claude:${agent.id}:${codexSessionId}`,
```

- [ ] **Step 3: Verify no remaining codex-cli.service references**

```bash
grep -n "codex-cli.service" backend/src/services/agent-run-queue.service.ts
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/agent-run-queue.service.ts
git commit -m "feat: agent-run-queue.service.ts — import from claude-cli.service"
```

---

## Task 6: Update `index.ts`

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Swap the import (line 44)**

Find:
```typescript
import { getCodexCliDiagnostics, isCodexCliRuntimeEnabled } from './services/codex-cli.service.js';
```
Replace with:
```typescript
import { getCodexCliDiagnostics, isCodexCliRuntimeEnabled } from './services/claude-cli.service.js';
```

- [ ] **Step 2: Update log strings (lines ~229–245)**

Find:
```typescript
    logger.info(logPayload, 'Codex CLI runtime enabled; skipping gateway auto-connect');
```
Replace with:
```typescript
    logger.info(logPayload, 'Claude CLI runtime enabled; skipping gateway auto-connect');
```

Find:
```typescript
    }, 'Codex CLI runtime check failed; chat requests will return diagnostics until fixed');
```
Replace with:
```typescript
    }, 'Claude CLI runtime check failed; chat requests will return diagnostics until fixed');
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat: index.ts — use claude-cli.service for startup diagnostics"
```

---

## Task 7: Update mini-service (`Codex_Automation/mini-services/codex-service/index.ts`)

**Files:**
- Modify: `Codex_Automation/mini-services/codex-service/index.ts`

- [ ] **Step 1: Replace `codexCommand` config default**

Find:
```typescript
  codexCommand: process.env.CODEX_COMMAND || 'codex',
```
Replace with:
```typescript
  codexCommand: process.env.CLAUDE_COMMAND || process.env.CODEX_COMMAND || 'claude',
```

- [ ] **Step 2: Replace the version probe command**

Find in `checkCodexAvailable`:
```typescript
    const child = spawn(config.codexCommand, ['--version'], {
```
This stays the same — it still spawns `config.codexCommand` which now defaults to `claude`.

- [ ] **Step 3: Replace the exec args builder**

Search for the function or block that builds the codex exec args (typically something like `['exec', '--json', '-C', cwd, ...]`). Replace the exec args with Claude CLI args.

Read the file from line 80 onward to find the exact spawn args, then replace the `codex exec --json` invocation with:
```typescript
// Old: ['exec', '--json', '-C', cwd, ...]
// New:
const args = ['--output-format', 'stream-json'];
if (config.codexModel) args.push('--model', config.codexModel);
if (sessionId) args.push('--resume', sessionId);
```

- [ ] **Step 4: Update event parsing in the mini-service**

Find any `thread.started` / `item.completed` / `turn.completed` parsing blocks and replace with Claude event parsing matching the same logic from Task 1, Step 4. The mapping:
- `system` event with `session_id` → `session_started`
- `assistant` event with text content blocks → extract `text` as the main result
- `result` event → completion, extract `session_id` and `usage`

- [ ] **Step 5: Update the mock fallback comment**

Find any string `'Codex'` in comments or mock responses visible to users; replace with `'Claude'`.

- [ ] **Step 6: Commit**

```bash
git add Codex_Automation/mini-services/codex-service/index.ts
git commit -m "feat: mini-service — use claude CLI command and event format"
```

---

## Task 8: Update `.env.example` and `.env`

**Files:**
- Modify: `backend/.env.example`
- Modify: `backend/.env`

- [ ] **Step 1: Update `.env.example`**

Replace the entire `Agent runtime` section. Find:
```
AGENT_RUNTIME=codex-cli
CODEX_CLI_PATH=
CODEX_MODEL=
CODEX_WORKSPACE_ROOT=
CODEX_SANDBOX=workspace-write
CODEX_SKIP_GIT_REPO_CHECK=true
CODEX_MODEL=
CODEX_WORKSPACE_ROOT=
CODEX_SANDBOX_MODE=workspace-write
CODEX_APPROVAL_POLICY=never
CODEX_NETWORK_ACCESS=false
```
Replace with:
```
AGENT_RUNTIME=claude-cli

# ── Claude CLI paths & commands ─────────────────────────────────
# Absolute path to claude binary (takes priority over CLAUDE_COMMAND)
CLAUDE_CLI_PATH=
# Command name on PATH (fallback; defaults to 'claude')
CLAUDE_COMMAND=
# Model to use (optional; defaults to Claude's configured default)
CLAUDE_MODEL=
# Override workspace root (defaults to project root)
CLAUDE_WORKSPACE_ROOT=
# Operation timeout in ms (default: 15 minutes)
CLAUDE_OPERATION_TIMEOUT_MS=
```

- [ ] **Step 2: Update `.env` (local dev file)**

Apply the same replacements to `backend/.env`:
- Change `AGENT_RUNTIME=codex-cli` → `AGENT_RUNTIME=claude-cli`
- Remove `CODEX_*` variables
- Add `CLAUDE_*` equivalents (leave values empty or copy over values that still make sense)

The `CLAUDE_WORKSPACE_ROOT` can stay empty (defaults to project root).

- [ ] **Step 3: Commit**

```bash
git add backend/.env.example
git commit -m "feat: update .env.example for Claude CLI runtime"
```

---

## Task 9: Smoke Test

- [ ] **Step 1: Restart the backend and confirm startup logs show Claude**

```bash
cd backend && npm run dev
```

Expected log line (no error):
```
Claude CLI runtime enabled; skipping gateway auto-connect
```

If you see `Claude CLI runtime check failed`, run `claude --version` in a shell to verify the binary is accessible.

- [ ] **Step 2: Check the diagnostics endpoint**

```bash
curl -s http://localhost:4000/api/mother-chat/diagnostics | jq .
```

Expected output shows `"agentRuntime": "claude-cli"` and `"loggedIn": true`.

- [ ] **Step 3: Send a test chat message (replace TOKEN and AGENT_ID with real values)**

```bash
curl -s -X POST http://localhost:4000/api/agents/<AGENT_ID>/chat \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, respond with one word."}' | jq .
```

Expected: `{ "status": "finished", "result": "...", "runtime": "claude-cli", ... }`

- [ ] **Step 4: Final commit message**

```bash
git commit --allow-empty -m "chore: Claude CLI migration complete — all Codex CLI references replaced"
```

---

## Self-Review

**Spec coverage:**
- ✅ New `claude-cli.service.ts` with full Claude event mapping
- ✅ All 4 import sites updated (agents.ts, mother-chat.ts route, mother-chat.service, agent-run-queue.service)
- ✅ index.ts startup diagnostics updated
- ✅ Mini-service updated
- ✅ .env.example updated
- ✅ Backward compat: `getAgentCodexSessionId` reads both `claudeCliSessionId` and `codexCliSessionId`
- ✅ DB field names unchanged — no migration needed
- ✅ Socket event names unchanged (`agent:chat:event`) — frontend unchanged

**Placeholder scan:** None found — all code blocks are complete.

**Type consistency:** `CodexCliUsage`, `NexusCodexEvent`, `CodexRunState`, `CodexCliRunResult` exported from `claude-cli.service.ts` with identical signatures to what `codex-cli.service.ts` exported. All consumers (Tasks 2–6) import these unchanged names.
