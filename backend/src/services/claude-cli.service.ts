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
const runningCodexAgentRuns = new Set<string>();

type JsonRecord = Record<string, unknown>;

export interface CodexCliUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

// Claude stream-json usage fields
interface ClaudeUsageEvent {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

// Claude stream-json content block
interface ClaudeContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  [key: string]: unknown;
}

// Claude stream-json message
interface ClaudeMessage {
  content?: ClaudeContentBlock[];
  usage?: ClaudeUsageEvent;
  [key: string]: unknown;
}

// The raw JSON events from Claude CLI --output-format stream-json
export interface CodexJsonEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  message?: ClaudeMessage;
  result?: string;
  is_error?: boolean;
  usage?: ClaudeUsageEvent;
  error?: unknown;
  // legacy / pass-through fields for backward compat
  thread_id?: string;
  item?: unknown;
  [key: string]: unknown;
}

export type NexusCodexEventType =
  | 'response'
  | 'activity'
  | 'tool_call'
  | 'tool_result'
  | 'terminal_output'
  | 'file_read'
  | 'file_write'
  | 'status_update'
  | 'response_end'
  | 'error';

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

function objectRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

export function selectedAgentRuntime() {
  return (process.env.AGENT_RUNTIME || 'claude-cli').trim().toLowerCase();
}

export function isCodexCliRuntimeEnabled() {
  return CLAUDE_CLI_RUNTIME_VALUES.has(selectedAgentRuntime());
}

function readBooleanEnv(name: string, fallback = false) {
  const value = process.env[name];
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function readNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function projectRoot() {
  return path.basename(process.cwd()) === 'backend'
    ? path.resolve(process.cwd(), '..')
    : process.cwd();
}

function expandHome(input: string) {
  return input.startsWith('~/') ? path.join(os.homedir(), input.slice(2)) : input;
}

export function resolveCodexCwd(agent?: Pick<PrismaAgent, 'workspace'>) {
  const configured = process.env.CLAUDE_WORKSPACE_ROOT || process.env.CODEX_WORKSPACE_ROOT || agent?.workspace;
  if (!configured?.trim()) return projectRoot();

  const expanded = expandHome(configured.trim());
  return path.isAbsolute(expanded) ? expanded : path.resolve(projectRoot(), expanded);
}

function normalizeSessionId(sessionId: unknown): string | undefined {
  if (typeof sessionId !== 'string') return undefined;
  const trimmed = sessionId.trim();
  if (!trimmed) return undefined;
  // Strip known CLI prefixes before extracting UUID
  const stripped = trimmed.replace(/^(claude:|codex:)/, '');
  return stripped.match(SESSION_ID_PATTERN)?.[0] || stripped;
}

export function getAgentCodexSessionId(agent: Pick<PrismaAgent, 'identityProfile' | 'gatewayAgentId'>) {
  const profile = objectRecord(agent.identityProfile);

  // Priority: claudeCliSessionId > codexCliSessionId (compat) > codexSessionId (compat) > activeWorkflowSessionId > gatewayAgentId
  return (
    normalizeSessionId(profile.claudeCliSessionId) ||
    normalizeSessionId(profile.codexCliSessionId) ||
    normalizeSessionId(profile.codexSessionId) ||
    normalizeSessionId(profile.activeWorkflowSessionId) ||
    normalizeSessionId(
      agent.gatewayAgentId?.startsWith('claude:')
        ? agent.gatewayAgentId.slice('claude:'.length)
        : agent.gatewayAgentId?.startsWith('codex:')
          ? agent.gatewayAgentId.slice('codex:'.length)
          : undefined
    )
  );
}

function getAgentChatThreadId(agent: Pick<PrismaAgent, 'identityProfile'>) {
  const profile = objectRecord(agent.identityProfile);
  return typeof profile.nexusChatThreadId === 'string' ? profile.nexusChatThreadId : undefined;
}

function getCodexSessionIdFromMetadata(metadata: unknown) {
  const data = objectRecord(metadata);
  return (
    normalizeSessionId(data.claudeCliSessionId) ||
    normalizeSessionId(data.codexCliSessionId) ||
    normalizeSessionId(data.codexSessionId) ||
    normalizeSessionId(data.activeWorkflowSessionId) ||
    normalizeSessionId(data.sessionKey) ||
    normalizeSessionId(data.runId)
  );
}

function isConfirmedCodexSessionMetadata(metadata: unknown) {
  const data = objectRecord(metadata);
  return (
    data.claudeSessionConfirmed === true ||
    data.codexSessionConfirmed === true ||
    data.role !== 'user'
  );
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
    const codexSessionId = getCodexSessionIdFromMetadata(message.metadata);
    if (codexSessionId && isConfirmedCodexSessionMetadata(message.metadata)) return codexSessionId;
  }

  return undefined;
}

function isExecutable(filePath: string) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function configuredClaudeCommand() {
  const cliPath = process.env.CLAUDE_CLI_PATH?.trim();
  if (cliPath) {
    return {
      envName: 'CLAUDE_CLI_PATH',
      value: cliPath,
      expandedValue: expandHome(cliPath),
      mustBeFilePath: true,
    };
  }

  const command = process.env.CLAUDE_COMMAND?.trim();
  if (command) {
    const expandedValue = expandHome(command);
    return {
      envName: 'CLAUDE_COMMAND',
      value: command,
      expandedValue,
      mustBeFilePath: path.isAbsolute(expandedValue) || expandedValue.includes('/') || expandedValue.includes('\\'),
    };
  }

  return null;
}

function configuredPathMessage(envName: string, command: string, reason: string) {
  return `Configured Claude CLI executable path is invalid: ${envName}=${command}. ${reason}. Expected an executable file, for example the "claude" binary on PATH.`;
}

function configuredPathDiagnostic(envName: string, command: string, reason: string) {
  return diagnosticError(configuredPathMessage(envName, command, reason), 503);
}

function resolveConfiguredExecutablePath(envName: string, configuredPath: string) {
  const command = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(projectRoot(), configuredPath);

  let stats;
  try {
    stats = statSync(command);
  } catch {
    throw configuredPathDiagnostic(envName, command, 'The configured path does not exist');
  }

  if (stats.isDirectory()) {
    throw configuredPathDiagnostic(envName, command, 'The configured path is a directory, not the Claude CLI executable');
  }

  if (!stats.isFile()) {
    throw configuredPathDiagnostic(envName, command, 'The configured path is not a regular executable file');
  }

  if (!isExecutable(command)) {
    throw configuredPathDiagnostic(envName, command, 'The configured file is not executable');
  }

  return command;
}

function resolveConfiguredExecutablePathResult(envName: string, configuredPath: string) {
  try {
    return {
      ok: true as const,
      command: resolveConfiguredExecutablePath(envName, configuredPath),
      warning: null,
    };
  } catch (err) {
    return {
      ok: false as const,
      command: null,
      warning: (err as Error).message,
    };
  }
}

function createCliEnv() {
  const env = { ...process.env };
  // Do not strip ANTHROPIC_API_KEY — Claude CLI needs it
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  delete env.PLATFORM_OPENAI_API_KEY;
  return env;
}

function runCliProbe(command: string, args: string[], timeoutMs = 5000): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(command, args, {
      env: createCliEnv(),
      shell: process.platform === 'win32',
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      resolve({ ok: false, stdout, stderr: stderr || 'Timed out while probing Claude CLI', code: null });
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: err.message, code: null });
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr, code });
    });
  });
}

export async function resolveCodexCommand() {
  const configured = configuredClaudeCommand();
  if (configured) {
    if (configured.mustBeFilePath) {
      const result = resolveConfiguredExecutablePathResult(configured.envName, configured.expandedValue);
      if (result.ok) return result.command;

      throw diagnosticError(result.warning, 503);
    }

    const probe = await runCliProbe(configured.expandedValue, ['--version']);
    if (probe.ok) return configured.expandedValue;

    throw diagnosticError(
      `Configured Claude CLI command is not runnable: ${configured.envName}=${configured.value}. Details: ${(probe.stderr || probe.stdout || 'command probe failed').trim()}. Expected an executable "claude" binary.`,
      503,
    );
  }

  const pathProbe = await runCliProbe('claude', ['--version']);
  if (pathProbe.ok) return 'claude';

  throw diagnosticError(
    'Claude CLI is not installed or is not accessible. Install it and ensure "claude" is on PATH.',
    503,
  );
}

export async function getCodexCliDiagnostics(agent?: Pick<PrismaAgent, 'workspace'>) {
  const installation = await validateInstallation();
  const authentication = installation.ok ? await validateAuthentication() : {
    ok: false,
    command: installation.command,
    details: 'Skipped because installation check failed',
  };
  const configured = configuredClaudeCommand();
  const configuredPathValidation = configured?.mustBeFilePath
    ? resolveConfiguredExecutablePathResult(configured.envName, configured.expandedValue)
    : null;

  return {
    agentRuntime: selectedAgentRuntime(),
    configuredCommand: configured ? {
      envName: configured.envName,
      value: configured.value,
      expandedValue: configured.expandedValue,
      mustBeFilePath: configured.mustBeFilePath,
      validation: configuredPathValidation ? {
        ok: configuredPathValidation.ok,
        warning: configuredPathValidation.warning,
      } : null,
    } : null,
    selectedCommand: installation.command,
    cwd: resolveCodexCwd(agent),
    model: process.env.CLAUDE_MODEL?.trim() || 'claude-cli-default',
    installation,
    authentication,
    loggedIn: authentication.ok,
  };
}

function diagnosticError(message: string, statusCode = 500) {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = statusCode;
  return err;
}

export async function validateInstallation() {
  try {
    const command = await resolveCodexCommand();
    const result = await runCliProbe(command, ['--version']);
    return {
      ok: result.ok,
      command,
      version: result.stdout.trim().split('\n').pop() || undefined,
      details: (result.stderr || result.stdout).trim(),
    };
  } catch (err) {
    return {
      ok: false,
      command: null,
      details: (err as Error).message,
    };
  }
}

export async function validateAuthentication() {
  // Claude authenticates via ANTHROPIC_API_KEY or stored OAuth.
  // There is no "login status" subcommand; a successful --version probe means auth is configured.
  try {
    const command = await resolveCodexCommand();
    const result = await runCliProbe(command, ['--version']);
    return {
      ok: result.ok,
      command,
      details: (result.stdout || result.stderr).trim(),
    };
  } catch (err) {
    return {
      ok: false,
      command: null,
      details: (err as Error).message,
    };
  }
}

export function buildCodexExecArgs(options: {
  cwd?: string;
  sessionId?: string | null;
  model?: string;
}) {
  const args: string[] = ['--output-format', 'stream-json'];
  if (options.model) args.push('--model', options.model);
  const sid = normalizeSessionId(options.sessionId);
  if (sid) args.push('--resume', sid);
  return args;
}

function buildRuntimeClaudeExecArgs(sessionId?: string | null) {
  return buildCodexExecArgs({
    sessionId,
    model: process.env.CLAUDE_MODEL?.trim() || undefined,
  });
}

export function isCodexResumeUnavailableError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /session.*not.?found/i.test(message) ||
    /resume.*failed/i.test(message) ||
    /thread\/resume/i.test(message)
  );
}

function usageFromClaudeEvent(usage?: ClaudeUsageEvent): CodexCliUsage | null {
  if (!usage) return null;
  const inputTokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  return {
    inputTokens,
    cachedInputTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    reasoningOutputTokens: 0,
  };
}

export function applyCodexJsonEvent(event: CodexJsonEvent, state: CodexRunState): NexusCodexEvent[] {
  const eventType = event.type;

  // --- Claude stream-json events ---

  // {"type":"system","subtype":"init","session_id":"...","model":"..."}
  if (eventType === 'system' && event.subtype === 'init') {
    const claudeSessionId = typeof event.session_id === 'string' ? event.session_id : null;
    if (claudeSessionId) state.codexSessionId = claudeSessionId;
    return [{
      type: 'status_update',
      content: 'Claude session started',
      metadata: {
        claudeSessionId,
        model: event.model ?? null,
      },
    }];
  }

  // {"type":"assistant","message":{"content":[...],"usage":{...}}}
  if (eventType === 'assistant' && event.message) {
    const blocks: ClaudeContentBlock[] = Array.isArray(event.message.content)
      ? event.message.content
      : [];
    const nexusEvents: NexusCodexEvent[] = [];

    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        state.result = block.text;
        nexusEvents.push({ type: 'response', content: block.text });
      } else if (block.type === 'tool_use') {
        const toolName = typeof block.name === 'string' ? block.name : 'tool';
        nexusEvents.push({ type: 'tool_call', content: toolName });
      }
    }

    return nexusEvents;
  }

  // {"type":"user","message":{"content":[{"type":"tool_result",...}]}}
  if (eventType === 'user' && event.message) {
    return [{ type: 'tool_result', content: 'Tool result received' }];
  }

  // {"type":"result","subtype":"success","session_id":"...","result":"...","usage":{...}}
  if (eventType === 'result' && !event.is_error) {
    const claudeSessionId = typeof event.session_id === 'string' ? event.session_id : null;
    if (claudeSessionId) state.codexSessionId = claudeSessionId;
    if (event.usage) state.usage = usageFromClaudeEvent(event.usage);
    if (typeof event.result === 'string' && event.result.trim()) {
      state.result = event.result.trim();
    }
    return [{
      type: 'status_update',
      content: 'Claude turn completed',
      metadata: { usage: state.usage },
    }];
  }

  // {"type":"result","is_error":true,"result":"error message"}
  if (eventType === 'result' && event.is_error) {
    const errorMsg = typeof event.result === 'string'
      ? event.result
      : (typeof event.error === 'string' ? event.error : 'Claude CLI error');
    state.errorMessage = errorMsg;
    return [{ type: 'error', content: errorMsg, metadata: { event } }];
  }

  // Generic error event
  if (eventType === 'error') {
    const msg = typeof event.result === 'string'
      ? event.result
      : (typeof event.error === 'string' ? event.error : JSON.stringify(event.error ?? event));
    state.errorMessage = msg;
    return [{ type: 'error', content: msg, metadata: { event } }];
  }

  // Unknown / informational event
  return [{ type: 'activity', content: eventType || 'Claude event', metadata: { event } }];
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
  const message = options.event.content.slice(0, 500) || options.event.type;
  return activityService.createActivity(options.organizationId, {
    agentId: options.agentId,
    type: activityTypeForEvent(options.event.type),
    message,
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

function terminateProcessTree(child: ChildProcessWithoutNullStreams, reason: string) {
  if (child.killed) return;
  logger.warn({ reason, pid: child.pid }, 'Terminating Claude CLI process');
  child.kill('SIGTERM');
  setTimeout(() => {
    if (!child.killed) child.kill('SIGKILL');
  }, 2000).unref();
}

function composeAgentPrompt(agent: PrismaAgent, message: string) {
  const profile = objectRecord(agent.identityProfile);
  const context = [
    `You are running as Nexus agent "${agent.displayName}" (${agent.name}).`,
    agent.description ? `Agent description:\n${agent.description}` : '',
    agent.workspace ? `Workspace:\n${agent.workspace}` : '',
    agent.soulMd ? `SOUL.md:\n${agent.soulMd}` : '',
    Object.keys(profile).length > 0 ? `Agent runtime metadata:\n${JSON.stringify(profile, null, 2)}` : '',
    'You are running as a Claude CLI agent. Use local tools and capabilities available to Claude.',
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
    data: {
      organizationId: agent.organizationId,
      title: `Chat with ${agent.displayName}`,
    },
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

async function updateAgentSession(agent: PrismaAgent, claudeSessionId: string, nexusChatThreadId?: string) {
  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      identityProfile: {
        ...objectRecord(agent.identityProfile),
        ...(nexusChatThreadId && { nexusChatThreadId }),
        // Write both keys for forward and backward compat
        claudeCliSessionId: claudeSessionId,
        codexCliSessionId: claudeSessionId,
        activeWorkflowSessionId: claudeSessionId,
        agentRuntime: 'claude-cli',
      } as any,
    },
  });
}

function createCodexRunState(existingCodexSessionId?: string | null): CodexRunState {
  return {
    codexSessionId: existingCodexSessionId ?? null,
    result: '',
    usage: null,
    errorMessage: null,
    rawStdout: '',
    stderr: '',
  };
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
  const state = createCodexRunState(options.existingCodexSessionId);

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
      terminateProcessTree(child, 'timeout');
      finish(diagnosticError(`Operation timed out: claude after ${timeoutMs}ms`, 504));
    }, timeoutMs);

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (err) {
        reject(err);
        return;
      }
      if (state.errorMessage) {
        reject(diagnosticError(state.errorMessage, 500));
        return;
      }
      resolve(state);
    };

    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return Promise.resolve();
      try {
        const event = JSON.parse(trimmed) as CodexJsonEvent;
        const translated = applyCodexJsonEvent(event, state);
        return translated.reduce(
          (promise, nextEvent) => promise.then(() => options.onEvent(nextEvent, state)),
          Promise.resolve(),
        );
      } catch {
        state.rawStdout += `${line}\n`;
        return options.onEvent({
          type: 'terminal_output',
          content: line,
          metadata: { stream: 'stdout' },
        }, state);
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        processLine(line).catch(err => logger.warn({ err }, 'Failed to handle Claude CLI stdout event'));
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      state.stderr += chunk;
      const lines = chunk.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      for (const line of lines) {
        options.onEvent({
          type: 'terminal_output',
          content: line,
          metadata: { stream: 'stderr' },
        }, state).catch(err => logger.warn({ err }, 'Failed to handle Claude CLI stderr event'));
      }
    });

    child.on('error', err => {
      finish(diagnosticError(`Failed to start Claude CLI command "${options.command}": ${err.message}`, 503));
    });

    child.on('close', code => {
      processLine(stdoutBuffer)
        .then(() => {
          if (code !== 0) {
            // If we already got a result event before the process exited non-zero, treat as success
            if (state.result) {
              finish();
              return;
            }
            const stderr = state.stderr.trim();
            finish(diagnosticError(`Claude CLI exited with code ${code}${stderr ? `: ${stderr}` : ''}`, 500));
            return;
          }
          if (!state.result && state.rawStdout.trim()) {
            state.result = state.rawStdout.trim();
          }
          finish();
        })
        .catch(err => finish(err instanceof Error ? err : new Error(String(err))));
    });

    child.stdin.on('error', err => {
      logger.warn({ err }, 'Claude CLI stdin error');
    });
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
    args: buildRuntimeClaudeExecArgs(sessionId),
    cwd: options.cwd,
    existingCodexSessionId: sessionId,
    prompt: options.prompt,
    onEvent: options.onEvent,
  });

  try {
    return await run(options.existingCodexSessionId);
  } catch (err) {
    const staleSessionId = normalizeSessionId(options.existingCodexSessionId);
    if (!staleSessionId || !isCodexResumeUnavailableError(err)) {
      throw err;
    }

    logger.warn({
      ...(options.logContext ?? {}),
      staleCodexSessionId: staleSessionId,
      errorMessage: (err as Error).message,
    }, 'Saved Claude CLI session is unavailable; starting a new Claude session');

    await options.onEvent({
      type: 'status_update',
      content: 'Saved Claude session is unavailable; starting a new Claude session.',
      metadata: {
        resumeRecovery: true,
        staleCodexSessionId: staleSessionId,
      },
    }, createCodexRunState(null));

    return run(null);
  }
}

export async function sendCodexCliAgentMessage(options: SendCodexCliAgentMessageOptions): Promise<CodexCliRunResult> {
  if (!options.message.trim()) {
    throw diagnosticError('message is required', 400);
  }

  const agentRunKey = `${options.organizationId}:${options.agent.id}`;
  if (runningCodexAgentRuns.has(agentRunKey)) {
    throw diagnosticError(
      `Claude CLI is already processing a message for ${options.agent.displayName}. Wait for that response to finish before sending another message.`,
      409,
    );
  }
  runningCodexAgentRuns.add(agentRunKey);

  try {
    const installation = await validateInstallation();
    if (!installation.ok || !installation.command) {
      throw diagnosticError(`Claude CLI installation check failed: ${installation.details}`, 503);
    }

    const authentication = await validateAuthentication();
    if (!authentication.ok) {
      throw diagnosticError(`Claude CLI authentication check failed. Ensure ANTHROPIC_API_KEY is set or run "claude" to log in. Details: ${authentication.details}`, 503);
    }

    const command = installation.command;
    const cwd = resolveCodexCwd(options.agent);
    const thread = await upsertAgentChatThread(options.agent);
    const threadCodexSessionId = await getThreadCodexSessionId(thread.id, options.organizationId);
    const agentCodexSessionId = getAgentCodexSessionId(options.agent);
    const existingCodexSessionId = threadCodexSessionId || agentCodexSessionId;
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
          resumeCodexSessionId: existingCodexSessionId ?? null,
          requestId: options.requestId ?? null,
        } as any,
      },
    });

    await prisma.agent.update({ where: { id: options.agent.id }, data: { status: 'ONLINE' } });
    options.io?.to(`org:${options.organizationId}`).emit('agent:updated', { id: options.agent.id, status: 'ONLINE' });

    logger.info({
      agentId: options.agent.id,
      command,
      cwd,
      resume: Boolean(existingCodexSessionId),
      sessionSource: threadCodexSessionId ? 'thread' : agentCodexSessionId ? 'agent' : 'new',
      threadId: thread.id,
      nexusSessionId: chatSession.id,
    }, 'Starting Claude CLI agent chat');

    try {
      const state = await runCodexCliPromptWithResumeRecovery({
        command,
        cwd,
        existingCodexSessionId,
        prompt: composeAgentPrompt(options.agent, options.message),
        logContext: {
          agentId: options.agent.id,
          nexusSessionId: chatSession.id,
          threadId: thread.id,
        },
        onEvent: async (event, state) => {
          emitChatEvent({
            io: options.io,
            organizationId: options.organizationId,
            agentId: options.agent.id,
            nexusSessionId: chatSession.id,
            codexSessionId: state.codexSessionId,
            requestId: options.requestId,
            event,
          });
          await persistActivity({
            organizationId: options.organizationId,
            agentId: options.agent.id,
            nexusSessionId: chatSession.id,
            codexSessionId: state.codexSessionId,
            requestId: options.requestId,
            event,
          }).catch(err => logger.warn({ err }, 'Failed to persist Claude CLI activity'));
        },
      });

      const responseText = state.result || 'No response';
      const durationMs = Date.now() - startedAt;
      const resolvedModel = process.env.CLAUDE_MODEL?.trim() || 'claude-cli';

      if (state.codexSessionId) {
        await updateAgentSession(options.agent, state.codexSessionId, thread.id);
      }

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
            // Write both session ID keys for forward/backward compat
            claudeCliSessionId: state.codexSessionId,
            codexSessionId: state.codexSessionId,
            // Write both confirmed flags for compat
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
          status: 'COMPLETED',
          endedAt: new Date(),
          durationMs,
          summary: `Claude CLI chat: ${options.message.slice(0, 120)}`,
          ...(state.usage && { tokensUsed: state.usage.inputTokens + state.usage.outputTokens }),
        },
      });
      await prisma.metricSnapshot.create({
        data: {
          organizationId: options.organizationId,
          agentId: options.agent.id,
          responseTimeMs: durationMs,
          success: true,
          toolName: 'claude-cli-chat',
        },
      });

      if (state.usage) {
        await llmProviderService.recordTokenUsage({
          organizationId: options.organizationId,
          agentId: options.agent.id,
          inputTokens: state.usage.inputTokens,
          outputTokens: state.usage.outputTokens,
          model: resolvedModel,
          mode: 'BYOK',
        }).catch(err => logger.warn({ err }, 'Failed to record Claude CLI token usage'));
      }

      const responseEndEvent: NexusCodexEvent = {
        type: 'response_end',
        content: 'Claude response complete',
        metadata: { usage: state.usage },
      };
      emitChatEvent({
        io: options.io,
        organizationId: options.organizationId,
        agentId: options.agent.id,
        nexusSessionId: chatSession.id,
        codexSessionId: state.codexSessionId,
        requestId: options.requestId,
        event: responseEndEvent,
      });

      await prisma.agent.update({ where: { id: options.agent.id }, data: { status: 'IDLE' } });
      options.io?.to(`org:${options.organizationId}`).emit('agent:updated', { id: options.agent.id, status: 'IDLE' });

      return {
        status: 'finished',
        result: responseText,
        codexSessionId: state.codexSessionId,
        nexusSessionId: chatSession.id,
        durationMs,
        usage: state.usage,
        model: resolvedModel,
      };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const errorMessage = (err as Error).message;
      await prisma.session.update({
        where: { id: chatSession.id },
        data: {
          status: 'FAILED',
          endedAt: new Date(),
          durationMs,
          summary: `Claude CLI chat failed: ${errorMessage.slice(0, 120)}`,
        },
      }).catch(() => {});
      await prisma.metricSnapshot.create({
        data: {
          organizationId: options.organizationId,
          agentId: options.agent.id,
          responseTimeMs: durationMs,
          success: false,
          errorMessage,
          toolName: 'claude-cli-chat',
        },
      }).catch(() => {});
      await prisma.agent.update({ where: { id: options.agent.id }, data: { status: 'ERROR' } }).catch(() => {});
      options.io?.to(`org:${options.organizationId}`).emit('agent:updated', { id: options.agent.id, status: 'ERROR' });

      const errorEvent: NexusCodexEvent = { type: 'error', content: errorMessage };
      emitChatEvent({
        io: options.io,
        organizationId: options.organizationId,
        agentId: options.agent.id,
        nexusSessionId: chatSession.id,
        codexSessionId: existingCodexSessionId,
        requestId: options.requestId,
        event: errorEvent,
      });
      throw err;
    }
  } finally {
    runningCodexAgentRuns.delete(agentRunKey);
  }
}

export async function getCodexCliAgentMessages(agent: PrismaAgent, limit = 50) {
  const threadId = getAgentChatThreadId(agent);
  if (!threadId) {
    return {
      sessionKey: getAgentCodexSessionId(agent) || '',
      messages: [],
    };
  }

  const messages = await prisma.message.findMany({
    where: {
      threadId,
      thread: { organizationId: agent.organizationId },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const threadCodexSessionId = await getThreadCodexSessionId(threadId, agent.organizationId);

  return {
    sessionKey: threadCodexSessionId || getAgentCodexSessionId(agent) || '',
    messages: messages.reverse().map(message => {
      const metadata = objectRecord(message.metadata);
      const role = metadata.role === 'assistant' ? 'assistant' : 'user';
      return {
        role,
        content: message.content,
        timestamp: message.createdAt.toISOString(),
      };
    }),
  };
}
