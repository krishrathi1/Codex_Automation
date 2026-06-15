import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { cleanupTestData, createTestUser } from './setup.js';
import { buildMotherChatContext } from '../services/mother-chat.service.js';
import { dispatchBoardTaskToAgents, startBoardAgentCollaboration } from '../services/board-collaboration.service.js';
import { processNextAgentRunJobForTest } from '../services/agent-run-queue.service.js';

describe('agent run queue service', () => {
  const originalCodexCommand = process.env.CODEX_COMMAND;
  const originalCodexCliPath = process.env.CODEX_CLI_PATH;
  const originalOperationTimeout = process.env.CODEX_OPERATION_TIMEOUT_MS;
  let orgId: string;
  let tempDir = '';

  beforeAll(async () => {
    const setup = await createTestUser('agent-run-queue');
    orgId = setup.organization.id;

    tempDir = mkdtempSync(path.join(os.tmpdir(), 'nexus-fake-codex-'));
    const fakeCodex = path.join(tempDir, 'codex');
    writeFileSync(fakeCodex, `#!/usr/bin/env node
const args = process.argv.slice(2);

if (args.includes('--version')) {
  console.log('codex-cli 0.0.0-test');
  process.exit(0);
}

if (args[0] === 'login' && args[1] === 'status') {
  console.log('Logged in as local test user');
  process.exit(0);
}

if (args[0] === 'exec') {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    console.log(JSON.stringify({ type: 'thread.started', thread_id: '0199a213-81c0-7800-8aa1-bbab2a035a53' }));
    console.log(JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'Mock agent report: context=' + (input.includes('NEXUS CONTEXT PACKET') ? 'present' : 'missing')
      }
    }));
    console.log(JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 12, cached_input_tokens: 4, output_tokens: 7, reasoning_output_tokens: 1 }
    }));
  });
} else {
  console.error('Unexpected fake Codex args: ' + args.join(' '));
  process.exit(2);
}
`);
    chmodSync(fakeCodex, 0o755);

    process.env.CODEX_COMMAND = fakeCodex;
    delete process.env.CODEX_CLI_PATH;
    process.env.CODEX_OPERATION_TIMEOUT_MS = '5000';
  });

  afterAll(async () => {
    if (originalCodexCommand === undefined) {
      delete process.env.CODEX_COMMAND;
    } else {
      process.env.CODEX_COMMAND = originalCodexCommand;
    }

    if (originalCodexCliPath === undefined) {
      delete process.env.CODEX_CLI_PATH;
    } else {
      process.env.CODEX_CLI_PATH = originalCodexCliPath;
    }

    if (originalOperationTimeout === undefined) {
      delete process.env.CODEX_OPERATION_TIMEOUT_MS;
    } else {
      process.env.CODEX_OPERATION_TIMEOUT_MS = originalOperationTimeout;
    }

    await cleanupTestData(orgId);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('processes a queued local Codex job and exposes the result to Mother Chat context', async () => {
    const board = await prisma.board.create({
      data: {
        organizationId: orgId,
        name: 'Worker Queue Production',
        slug: `worker-queue-production-${Date.now()}`,
        description: 'Worker queue test room',
        objective: 'Prove queued local Codex jobs flow into Mother Chat',
      },
    });

    await startBoardAgentCollaboration(orgId, board.id, {
      goal: 'Prepare worker queue test room',
      agents: [
        {
          displayName: 'Queue Backend Agent',
          role: 'Backend operations',
          work: 'Wait for queued dispatch.',
          isLead: true,
        },
        {
          displayName: 'Queue Review Agent',
          role: 'Review',
          work: 'Wait for queued dispatch.',
        },
      ],
    });

    const query = 'Use the local worker queue and report one concise readiness finding.';
    const dispatch = await dispatchBoardTaskToAgents(orgId, board.id, { query });
    expect(dispatch.runJobs).toHaveLength(2);
    expect(dispatch.runJobs.every(job => job.status === 'QUEUED')).toBe(true);

    const processedJobId = await processNextAgentRunJobForTest({ organizationId: orgId });
    expect(processedJobId).toBeTruthy();

    const processedJob = await prisma.agentRunJob.findUniqueOrThrow({
      where: { id: processedJobId! },
    });
    expect(processedJob.status).toBe('COMPLETED');
    expect(processedJob.output).toContain('context=present');
    expect(processedJob.codexSessionId).toBe('0199a213-81c0-7800-8aa1-bbab2a035a53');
    expect(processedJob.durationMs).toBeGreaterThanOrEqual(0);

    const processedTask = await prisma.task.findUniqueOrThrow({
      where: { id: processedJob.taskId! },
    });
    expect(processedTask.status).toBe('REVIEW');

    const { context, contextText } = await buildMotherChatContext(orgId, { boardId: board.id });
    expect(context.counts.activeRunJobs).toBe(1);
    expect((context.counts.queuedRunJobs ?? 0) + (context.counts.runningRunJobs ?? 0)).toBe(1);
    expect(context.agentRunJobs?.some(job => job.id === processedJob.id && job.status === 'COMPLETED')).toBe(true);
    expect(context.agentRunJobs?.some(job => job.status === 'QUEUED' || job.status === 'RUNNING')).toBe(true);
    expect(context.messages.map(message => message.content).join('\n')).toContain('Mock agent report');
    expect(contextText).toContain('Agent run queue');
    expect(contextText).toContain('status=COMPLETED');
  });
});
