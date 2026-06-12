import path from 'path';
import os from 'os';
import {
  Codex,
  type ApprovalMode,
  type ModelReasoningEffort,
  type SandboxMode,
  type ThreadOptions,
  type Usage,
  type WebSearchMode,
} from '@openai/codex-sdk';
import type { Agent as PrismaAgent } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

const CODEX_AGENT_PREFIX = 'codex:';

export function isCodexRuntimeEnabled() {
  return process.env.AGENT_RUNTIME?.toLowerCase() === 'codex';
}

export function isCodexSdkConfigured() {
  return Boolean(process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY);
}

export function isCodexThreadId(agentId?: string | null) {
  return Boolean(agentId?.startsWith(CODEX_AGENT_PREFIX));
}

function encodeCodexThreadId(threadId: string) {
  return `${CODEX_AGENT_PREFIX}${threadId}`;
}

function decodeCodexThreadId(agentId: string) {
  return agentId.startsWith(CODEX_AGENT_PREFIX) ? agentId.slice(CODEX_AGENT_PREFIX.length) : agentId;
}

function projectRoot() {
  return path.basename(process.cwd()) === 'backend'
    ? path.resolve(process.cwd(), '..')
    : process.cwd();
}

function expandHome(input: string) {
  return input.startsWith('~/') ? path.join(os.homedir(), input.slice(2)) : input;
}

function resolveCodexCwd(agent: PrismaAgent) {
  const configured = process.env.CODEX_WORKSPACE_ROOT || agent.workspace;
  if (!configured?.trim()) return projectRoot();

  const expanded = expandHome(configured.trim());
  return path.isAbsolute(expanded) ? expanded : path.resolve(projectRoot(), expanded);
}

function readBooleanEnv(name: string, fallback = false) {
  const value = process.env[name];
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function readEnumEnv<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = process.env[name] as T | undefined;
  return value && allowed.includes(value) ? value : fallback;
}

function readOptionalEnumEnv<T extends string>(name: string, allowed: readonly T[]): T | undefined {
  const value = process.env[name] as T | undefined;
  return value && allowed.includes(value) ? value : undefined;
}

function codexThreadOptions(agent: PrismaAgent): ThreadOptions {
  const model = process.env.CODEX_MODEL?.trim() || undefined;
  const modelReasoningEffort = readOptionalEnumEnv<ModelReasoningEffort>(
    'CODEX_MODEL_REASONING_EFFORT',
    ['minimal', 'low', 'medium', 'high', 'xhigh'],
  );
  const webSearchMode = readOptionalEnumEnv<WebSearchMode>(
    'CODEX_WEB_SEARCH_MODE',
    ['disabled', 'cached', 'live'],
  );

  return {
    ...(model && { model }),
    ...(modelReasoningEffort && { modelReasoningEffort }),
    ...(webSearchMode && { webSearchMode }),
    workingDirectory: resolveCodexCwd(agent),
    skipGitRepoCheck: readBooleanEnv('CODEX_SKIP_GIT_REPO_CHECK', true),
    sandboxMode: readEnumEnv<SandboxMode>(
      'CODEX_SANDBOX_MODE',
      ['read-only', 'workspace-write', 'danger-full-access'],
      'workspace-write',
    ),
    approvalPolicy: readEnumEnv<ApprovalMode>(
      'CODEX_APPROVAL_POLICY',
      ['never', 'on-request', 'on-failure', 'untrusted'],
      'never',
    ),
    networkAccessEnabled: readBooleanEnv('CODEX_NETWORK_ACCESS', false),
  };
}

function withAgentContext(agent: PrismaAgent, message: string) {
  const context = [
    `Agent: ${agent.displayName} (${agent.name})`,
    agent.description ? `Description: ${agent.description}` : '',
    agent.soulMd ? `SOUL.md:\n${agent.soulMd}` : '',
  ].filter(Boolean).join('\n\n');

  return context ? `${context}\n\nUser message:\n${message}` : message;
}

export async function sendCodexAgentMessage(options: {
  agent: PrismaAgent;
  message: string;
}) {
  const apiKey = process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error('Codex SDK is not configured. Set CODEX_API_KEY or OPENAI_API_KEY in backend/.env.');
    (err as Error & { statusCode?: number }).statusCode = 503;
    throw err;
  }

  const codex = new Codex({
    apiKey,
    ...(process.env.OPENAI_BASE_URL && { baseUrl: process.env.OPENAI_BASE_URL }),
    config: {
      sandbox_workspace_write: {
        network_access: readBooleanEnv('CODEX_NETWORK_ACCESS', false),
      },
    },
  });
  const threadOptions = codexThreadOptions(options.agent);
  const existingThreadId = isCodexThreadId(options.agent.gatewayAgentId)
    ? decodeCodexThreadId(options.agent.gatewayAgentId!)
    : null;

  const thread = existingThreadId
    ? codex.resumeThread(existingThreadId, threadOptions)
    : codex.startThread(threadOptions);

  const startedAt = Date.now();
  const turn = await thread.run(withAgentContext(options.agent, options.message));
  const threadId = thread.id ?? existingThreadId;

  if (!existingThreadId && threadId) {
    await prisma.agent.update({
      where: { id: options.agent.id },
      data: {
        gatewayAgentId: encodeCodexThreadId(threadId),
        status: 'IDLE',
      },
    });
  }

  return {
    status: 'finished' as const,
    result: turn.finalResponse || '',
    runId: threadId ?? '',
    durationMs: Date.now() - startedAt,
    model: process.env.CODEX_MODEL?.trim() || 'codex',
    usage: turn.usage,
    codexThreadId: threadId,
  };
}

export async function getCodexAgentMessages(agent: PrismaAgent, _limit: number) {
  if (!isCodexThreadId(agent.gatewayAgentId)) {
    return [];
  }

  // The SDK can resume threads, but it does not expose a history-list API.
  return [];
}

export function usageToTokenCounts(usage: Usage | null) {
  if (!usage) return null;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  };
}
