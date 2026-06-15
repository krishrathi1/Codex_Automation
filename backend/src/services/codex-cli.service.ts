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

const MACOS_CODEX_APP_COMMAND = '/Applications/Codex.app/Contents/Resources/codex';
const SESSION_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CODEX_CLI_RUNTIME_VALUES = new Set(['codex-cli', 'codex']);
const DEFAULT_OPERATION_TIMEOUT_MS = 15 * 60 * 1000;

type JsonRecord = Record<string, unknown>;

export interface CodexCliUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

interface CodexUsageEvent {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string | string[];
  status?: string;
  path?: string;
  name?: string;
  [key: string]: unknown;
}

export interface CodexJsonEvent {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: CodexUsageEvent;
  error?: unknown;
  message?: string;
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
  return (process.env.AGENT_RUNTIME || 'codex-cli').trim().toLowerCase();
}

export function isCodexCliRuntimeEnabled() {
  return CODEX_CLI_RUNTIME_VALUES.has(selectedAgentRuntime());
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
  const configured = process.env.CODEX_WORKSPACE_ROOT || agent?.workspace;
  if (!configured?.trim()) return projectRoot();

  const expanded = expandHome(configured.trim());
  return path.isAbsolute(expanded) ? expanded : path.resolve(projectRoot(), expanded);
}

function normalizeSessionId(sessionId: unknown): string | undefined {
  if (typeof sessionId !== 'string') return undefined;
  const trimmed = sessionId.trim();
  if (!trimmed) return undefined;
  return trimmed.match(SESSION_ID_PATTERN)?.[0] || trimmed;
}

export function getAgentCodexSessionId(agent: Pick<PrismaAgent, 'identityProfile' | 'gatewayAgentId'>) {
  const profile = objectRecord(agent.identityProfile);
  return normalizeSessionId(profile.codexCliSessionId)
    || normalizeSessionId(profile.codexSessionId)
    || normalizeSessionId(profile.activeWorkflowSessionId)
    || normalizeSessionId(agent.gatewayAgentId?.startsWith('codex:') ? agent.gatewayAgentId.slice('codex:'.length) : undefined);
}

function getAgentChatThreadId(agent: Pick<PrismaAgent, 'identityProfile'>) {
  const profile = objectRecord(agent.identityProfile);
  return typeof profile.nexusChatThreadId === 'string' ? profile.nexusChatThreadId : undefined;
}

function getCodexSessionIdFromMetadata(metadata: unknown) {
  const data = objectRecord(metadata);
  return normalizeSessionId(data.codexCliSessionId)
    || normalizeSessionId(data.codexSessionId)
    || normalizeSessionId(data.activeWorkflowSessionId)
    || normalizeSessionId(data.sessionKey)
    || normalizeSessionId(data.runId);
}

function isConfirmedCodexSessionMetadata(metadata: unknown) {
  const data = objectRecord(metadata);
  return data.codexSessionConfirmed === true || data.role !== 'user';
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

function configuredCodexCommand() {
  const cliPath = process.env.CODEX_CLI_PATH?.trim();
  if (cliPath) {
    return {
      envName: 'CODEX_CLI_PATH',
      value: cliPath,
      expandedValue: expandHome(cliPath),
      mustBeFilePath: true,
    };
  }

  const command = process.env.CODEX_COMMAND?.trim();
  if (command) {
    const expandedValue = expandHome(command);
    return {
      envName: 'CODEX_COMMAND',
      value: command,
      expandedValue,
      mustBeFilePath: path.isAbsolute(expandedValue) || expandedValue.includes('/') || expandedValue.includes('\\'),
    };
  }

  return null;
}

function configuredPathMessage(envName: string, command: string, reason: string) {
  return `Configured Codex executable path is invalid: ${envName}=${command}. ${reason}. Expected an executable file, for example ${MACOS_CODEX_APP_COMMAND}.`;
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
    throw configuredPathDiagnostic(envName, command, 'The configured path is a directory, not the Codex executable');
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
      resolve({ ok: false, stdout, stderr: stderr || 'Timed out while probing Codex CLI', code: null });
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
  const configured = configuredCodexCommand();
  if (configured) {
    if (configured.mustBeFilePath) {
      const result = resolveConfiguredExecutablePathResult(configured.envName, configured.expandedValue);
      if (result.ok) return result.command;

      if (isExecutable(MACOS_CODEX_APP_COMMAND)) {
        logger.warn(
          {
            configuredEnv: configured.envName,
            configuredValue: configured.value,
            fallbackCommand: MACOS_CODEX_APP_COMMAND,
            warning: result.warning,
          },
          'Ignoring invalid Codex CLI path and falling back to macOS Codex app executable',
        );
        return MACOS_CODEX_APP_COMMAND;
      }

      throw diagnosticError(result.warning, 503);
    }

    const probe = await runCliProbe(configured.expandedValue, ['--version']);
    if (probe.ok) return configured.expandedValue;

    throw diagnosticError(
      `Configured Codex command is not runnable: ${configured.envName}=${configured.value}. Details: ${(probe.stderr || probe.stdout || 'command probe failed').trim()}. Expected an executable file, for example ${MACOS_CODEX_APP_COMMAND}.`,
      503,
    );
  }

  const pathProbe = await runCliProbe('codex', ['--version']);
  if (pathProbe.ok) return 'codex';

  if (isExecutable(MACOS_CODEX_APP_COMMAND)) return MACOS_CODEX_APP_COMMAND;

  throw diagnosticError(
    `Codex CLI is not installed or is not accessible. Tried "codex" on PATH and ${MACOS_CODEX_APP_COMMAND}.`,
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
  const configured = configuredCodexCommand();
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
    expectedMacosCommand: MACOS_CODEX_APP_COMMAND,
    selectedCommand: installation.command,
    cwd: resolveCodexCwd(agent),
    sandbox: process.env.CODEX_SANDBOX || process.env.CODEX_SANDBOX_MODE || 'workspace-write',
    skipGitRepoCheck: readBooleanEnv('CODEX_SKIP_GIT_REPO_CHECK', true),
    dangerouslyBypassApprovalsAndSandbox: readBooleanEnv('CODEX_DANGEROUSLY_BYPASS', false),
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
  try {
    const command = await resolveCodexCommand();
    const result = await runCliProbe(command, ['login', 'status']);
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
  cwd: string;
  sessionId?: string | null;
  model?: string;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  skipGitRepoCheck?: boolean;
  bypassSandbox?: boolean;
}) {
  const args = ['exec', '--json', '-C', options.cwd];
  if (options.model) args.push('-m', options.model);
  if (options.bypassSandbox) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else if (options.sandbox) {
    args.push('--sandbox', options.sandbox);
  }
  if (options.skipGitRepoCheck) args.push('--skip-git-repo-check');

  const normalizedSessionId = normalizeSessionId(options.sessionId);
  if (normalizedSessionId) {
    args.push('resume', '--all', normalizedSessionId, '-');
  } else {
    args.push('-');
  }
  return args;
}

function buildRuntimeCodexExecArgs(cwd: string, sessionId?: string | null) {
  return buildCodexExecArgs({
    cwd,
    sessionId,
    model: process.env.CODEX_MODEL?.trim() || undefined,
    sandbox: (process.env.CODEX_SANDBOX || process.env.CODEX_SANDBOX_MODE || 'workspace-write') as 'read-only' | 'workspace-write' | 'danger-full-access',
    skipGitRepoCheck: readBooleanEnv('CODEX_SKIP_GIT_REPO_CHECK', true),
    bypassSandbox: readBooleanEnv('CODEX_DANGEROUSLY_BYPASS', false),
  });
}

export function isCodexResumeUnavailableError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /thread\/resume/i.test(message) && /no rollout found/i.test(message);
}

function usageFromEvent(usage?: CodexUsageEvent): CodexCliUsage | null {
  if (!usage) return null;
  return {
    inputTokens: usage.input_tokens ?? 0,
    cachedInputTokens: usage.cached_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    reasoningOutputTokens: usage.reasoning_output_tokens ?? 0,
  };
}

function stringifyCommand(command: string | string[] | undefined) {
  if (Array.isArray(command)) return command.join(' ');
  return command || 'shell';
}

function eventErrorMessage(event: CodexJsonEvent) {
  if (typeof event.message === 'string') return event.message;
  if (typeof event.error === 'string') return event.error;
  if (event.error && typeof event.error === 'object' && 'message' in event.error) {
    const message = (event.error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return JSON.stringify(event.error ?? event);
}

function itemLabel(item: CodexItem | undefined) {
  if (!item) return 'Codex activity';
  if (item.command) return stringifyCommand(item.command);
  if (item.path) return String(item.path);
  if (item.name) return String(item.name);
  if (item.type) return item.type;
  return 'Codex activity';
}

function classifyItemEvent(item: CodexItem | undefined, completed: boolean): NexusCodexEvent {
  const itemType = item?.type || 'unknown';
  if (itemType === 'agent_message' && typeof item?.text === 'string') {
    return { type: 'response', content: item.text, metadata: { item } };
  }
  if (itemType === 'command_execution') {
    return {
      type: completed ? 'tool_result' : 'tool_call',
      content: item?.command ? stringifyCommand(item.command) : `Shell command ${completed ? 'completed' : 'started'}`,
      metadata: { item },
    };
  }
  if (itemType.includes('file') && (itemType.includes('read') || itemType.includes('open'))) {
    return { type: 'file_read', content: itemLabel(item), metadata: { item } };
  }
  if (itemType.includes('file') || itemType.includes('patch') || itemType.includes('diff')) {
    return { type: 'file_write', content: itemLabel(item), metadata: { item } };
  }
  if (itemType.includes('tool') || itemType.includes('mcp')) {
    return {
      type: completed ? 'tool_result' : 'tool_call',
      content: itemLabel(item),
      metadata: { item },
    };
  }
  return {
    type: 'activity',
    content: `${completed ? 'Completed' : 'Started'} ${itemLabel(item)}`,
    metadata: { item },
  };
}

export function applyCodexJsonEvent(event: CodexJsonEvent, state: CodexRunState): NexusCodexEvent[] {
  switch (event.type) {
    case 'thread.started': {
      if (typeof event.thread_id === 'string') {
        state.codexSessionId = event.thread_id;
      }
      return [{
        type: 'status_update',
        content: 'Codex session started',
        metadata: { codexSessionId: state.codexSessionId },
      }];
    }
    case 'turn.started':
      return [{ type: 'status_update', content: 'Codex turn started', metadata: { event } }];
    case 'item.started':
      return [classifyItemEvent(event.item, false)];
    case 'item.completed': {
      const translated = classifyItemEvent(event.item, true);
      if (translated.type === 'response') {
        state.result = translated.content;
      }
      return [translated];
    }
    case 'turn.completed':
      state.usage = usageFromEvent(event.usage);
      return [{ type: 'status_update', content: 'Codex turn completed', metadata: { usage: state.usage } }];
    case 'turn.failed':
    case 'error':
      state.errorMessage = eventErrorMessage(event);
      return [{ type: 'error', content: state.errorMessage, metadata: { event } }];
    default:
      return [{ type: 'activity', content: event.type || 'Codex event', metadata: { event } }];
  }
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
      runtime: 'codex-cli',
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
  logger.warn({ reason, pid: child.pid }, 'Terminating Codex CLI process');
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
    'Use the local Codex CLI session and existing Codex login. Never ask the user for an OpenAI API key.',
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
        agentRuntime: 'codex-cli',
      } as any,
    },
  });

  return thread;
}

async function updateAgentCodexSession(agent: PrismaAgent, codexSessionId: string, nexusChatThreadId?: string) {
  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      identityProfile: {
        ...objectRecord(agent.identityProfile),
        ...(nexusChatThreadId && { nexusChatThreadId }),
        codexCliSessionId: codexSessionId,
        activeWorkflowSessionId: codexSessionId,
        agentRuntime: 'codex-cli',
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
  const timeoutMs = readNumberEnv('CODEX_OPERATION_TIMEOUT_MS', DEFAULT_OPERATION_TIMEOUT_MS);
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
      finish(diagnosticError(`Operation timed out: codex exec after ${timeoutMs}ms`, 504));
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
        processLine(line).catch(err => logger.warn({ err }, 'Failed to handle Codex stdout event'));
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
        }, state).catch(err => logger.warn({ err }, 'Failed to handle Codex stderr event'));
      }
    });

    child.on('error', err => {
      finish(diagnosticError(`Failed to start Codex CLI command "${options.command}": ${err.message}`, 503));
    });

    child.on('close', code => {
      processLine(stdoutBuffer)
        .then(() => {
          if (code !== 0) {
            const stderr = state.stderr.trim();
            finish(diagnosticError(`Codex exited with code ${code}${stderr ? `: ${stderr}` : ''}`, 500));
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
      logger.warn({ err }, 'Codex CLI stdin error');
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
    args: buildRuntimeCodexExecArgs(options.cwd, sessionId),
    cwd: options.cwd,
    existingCodexSessionId: sessionId,
    prompt: options.prompt,
    onEvent: options.onEvent,
  });

  try {
    return await run(options.existingCodexSessionId);
  } catch (err) {
    const staleCodexSessionId = normalizeSessionId(options.existingCodexSessionId);
    if (!staleCodexSessionId || !isCodexResumeUnavailableError(err)) {
      throw err;
    }

    logger.warn({
      ...(options.logContext ?? {}),
      staleCodexSessionId,
      errorMessage: (err as Error).message,
    }, 'Saved Codex CLI session is unavailable locally; starting a new Codex session');

    await options.onEvent({
      type: 'status_update',
      content: 'Saved Codex session is unavailable locally; starting a new Codex session.',
      metadata: {
        resumeRecovery: true,
        staleCodexSessionId,
      },
    }, createCodexRunState(null));

    return run(null);
  }
}

export async function sendCodexCliAgentMessage(options: SendCodexCliAgentMessageOptions): Promise<CodexCliRunResult> {
  if (!options.message.trim()) {
    throw diagnosticError('message is required', 400);
  }

  const installation = await validateInstallation();
  if (!installation.ok || !installation.command) {
    throw diagnosticError(`Codex CLI installation check failed: ${installation.details}`, 503);
  }

  const authentication = await validateAuthentication();
  if (!authentication.ok) {
    throw diagnosticError(`Codex CLI authentication check failed. Run "codex login" locally. Details: ${authentication.details}`, 503);
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
      summary: `Codex CLI chat: ${options.message.slice(0, 120)}`,
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
        runtime: 'codex-cli',
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
  }, 'Starting Codex CLI agent chat');

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
        }).catch(err => logger.warn({ err }, 'Failed to persist Codex CLI activity'));
      },
    });

    const responseText = state.result || 'No response';
    const durationMs = Date.now() - startedAt;
    if (state.codexSessionId) {
      await updateAgentCodexSession(options.agent, state.codexSessionId, thread.id);
    }

    await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: options.agent.id,
        receiverId: adminAgent.id,
        content: responseText,
        metadata: {
          role: 'assistant',
          runtime: 'codex-cli',
          conversationKind: 'admin_agent',
          edgeSemantic: 'agent_to_admin',
          nexusSessionId: chatSession.id,
          codexSessionId: state.codexSessionId,
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
        summary: `Codex CLI chat: ${options.message.slice(0, 120)}`,
        ...(state.usage && { tokensUsed: state.usage.inputTokens + state.usage.outputTokens }),
      },
    });
    await prisma.metricSnapshot.create({
      data: {
        organizationId: options.organizationId,
        agentId: options.agent.id,
        responseTimeMs: durationMs,
        success: true,
        toolName: 'codex-cli-chat',
      },
    });

    if (state.usage) {
      await llmProviderService.recordTokenUsage({
        organizationId: options.organizationId,
        agentId: options.agent.id,
        inputTokens: state.usage.inputTokens,
        outputTokens: state.usage.outputTokens,
        model: process.env.CODEX_MODEL?.trim() || 'codex-cli',
        mode: 'BYOK',
      }).catch(err => logger.warn({ err }, 'Failed to record Codex CLI token usage'));
    }

    const responseEndEvent: NexusCodexEvent = {
      type: 'response_end',
      content: 'Codex response complete',
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
      model: process.env.CODEX_MODEL?.trim() || 'codex-cli',
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
        summary: `Codex CLI chat failed: ${errorMessage.slice(0, 120)}`,
      },
    }).catch(() => {});
    await prisma.metricSnapshot.create({
      data: {
        organizationId: options.organizationId,
        agentId: options.agent.id,
        responseTimeMs: durationMs,
        success: false,
        errorMessage,
        toolName: 'codex-cli-chat',
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
