import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { cleanupTestData, createTestUser, writeFakeClaudeCli } from './setup.js';
import { processNextAgentRunJobForTest } from '../services/agent-run-queue.service.js';
import { buildMotherChatContext } from '../services/mother-chat.service.js';
import { ingestProductionErrorEvent } from '../services/production-error-pipeline.service.js';

describe('production error pipeline service', () => {
  const originalClaudeCommand = process.env.CLAUDE_COMMAND;
  const originalClaudeCliPath = process.env.CLAUDE_CLI_PATH;
  const originalOperationTimeout = process.env.CLAUDE_OPERATION_TIMEOUT_MS;
  const originalMaxReworks = process.env.PRODUCTION_ERROR_PIPELINE_MAX_REWORKS;
  let orgId: string;
  let tempDir = '';

  beforeAll(async () => {
    const setup = await createTestUser('production-error-pipeline');
    orgId = setup.organization.id;

    tempDir = mkdtempSync(path.join(os.tmpdir(), 'nexus-fake-claude-pipeline-'));
    const fakeClaude = writeFakeClaudeCli(tempDir, `const args = process.argv.slice(2);

if (args.includes('--version')) {
  console.log('claude 1.0.0-test');
  process.exit(0);
}

if (args.includes('--output-format') && args.includes('stream-json')) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    const role = input.includes('PIPELINE ROLE: review')
      ? 'review'
      : input.includes('PIPELINE ROLE: commit')
        ? 'commit'
        : 'debug';
    const text = role === 'review'
      ? 'APPROVED: yes\\\\nReview evidence checked and fix path approved.'
      : role === 'commit'
        ? 'Commit handoff prepared with branch and PR summary.'
        : 'Debug fix prepared and validation command selected.';
    console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: '0199a214-81c0-7800-8aa1-bbab2a035a53', model: 'claude-test' }));
    console.log(JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text }],
        usage: { input_tokens: 10, cache_read_input_tokens: 1, output_tokens: 5 }
      }
    }));
    console.log(JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: '0199a214-81c0-7800-8aa1-bbab2a035a53',
      is_error: false,
      usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 1, output_tokens: 5 }
    }));
  });
} else {
  console.error('Unexpected fake Claude args: ' + args.join(' '));
  process.exit(2);
}
`);

    process.env.CLAUDE_COMMAND = fakeClaude;
    delete process.env.CLAUDE_CLI_PATH;
    process.env.CLAUDE_OPERATION_TIMEOUT_MS = '5000';
    process.env.PRODUCTION_ERROR_PIPELINE_MAX_REWORKS = '1';
  });

  afterAll(async () => {
    if (originalClaudeCommand === undefined) {
      delete process.env.CLAUDE_COMMAND;
    } else {
      process.env.CLAUDE_COMMAND = originalClaudeCommand;
    }

    if (originalClaudeCliPath === undefined) {
      delete process.env.CLAUDE_CLI_PATH;
    } else {
      process.env.CLAUDE_CLI_PATH = originalClaudeCliPath;
    }

    if (originalOperationTimeout === undefined) {
      delete process.env.CLAUDE_OPERATION_TIMEOUT_MS;
    } else {
      process.env.CLAUDE_OPERATION_TIMEOUT_MS = originalOperationTimeout;
    }

    if (originalMaxReworks === undefined) {
      delete process.env.PRODUCTION_ERROR_PIPELINE_MAX_REWORKS;
    } else {
      process.env.PRODUCTION_ERROR_PIPELINE_MAX_REWORKS = originalMaxReworks;
    }

    await cleanupTestData(orgId);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('captures a website error and advances Debug -> Review -> Commit into Mother Chat context', async () => {
    const ingestion = await ingestProductionErrorEvent(orgId, {
      source: 'website',
      severity: 'critical',
      title: 'Dashboard render crash',
      message: 'Cannot read properties of undefined (reading stats)',
      stack: 'TypeError: Cannot read properties of undefined\\n    at Dashboard.tsx:42:13',
      url: 'http://localhost:5174/dashboard',
      route: '/dashboard',
      environment: 'test',
      payload: { browser: 'vitest' },
    });

    expect(ingestion.errorEvent.status).toBe('DEBUG_QUEUED');
    expect(ingestion.task.status).toBe('ASSIGNED');
    expect(ingestion.runJobs.debugRunJob.status).toBe('QUEUED');

    const debugJobId = await processNextAgentRunJobForTest({ organizationId: orgId });
    expect(debugJobId).toBe(ingestion.runJobs.debugRunJob.id);

    let event = await prisma.productionErrorEvent.findUniqueOrThrow({
      where: { id: ingestion.errorEvent.id },
    });
    expect(event.status).toBe('REVIEW_QUEUED');
    expect(event.reviewRunJobId).toBeTruthy();

    const reviewJobId = await processNextAgentRunJobForTest({ organizationId: orgId });
    expect(reviewJobId).toBe(event.reviewRunJobId);

    event = await prisma.productionErrorEvent.findUniqueOrThrow({
      where: { id: ingestion.errorEvent.id },
    });
    expect(event.status).toBe('COMMIT_QUEUED');
    expect(event.commitRunJobId).toBeTruthy();

    const commitJobId = await processNextAgentRunJobForTest({ organizationId: orgId });
    expect(commitJobId).toBe(event.commitRunJobId);

    event = await prisma.productionErrorEvent.findUniqueOrThrow({
      where: { id: ingestion.errorEvent.id },
    });
    expect(event.status).toBe('COMPLETED');
    expect(event.resolvedAt).toBeTruthy();

    const task = await prisma.task.findUniqueOrThrow({ where: { id: ingestion.task.id } });
    expect(task.status).toBe('DONE');

    const { context, contextText } = await buildMotherChatContext(orgId, { boardId: ingestion.board.id });
    expect(context.counts.productionErrors).toBe(1);
    expect(context.productionErrors?.[0]?.id).toBe(event.id);
    expect(context.productionErrors?.[0]?.debugRunJobId).toBe(debugJobId);
    expect(context.productionErrors?.[0]?.reviewRunJobId).toBe(reviewJobId);
    expect(context.productionErrors?.[0]?.commitRunJobId).toBe(commitJobId);
    expect(contextText).toContain('Production error pipeline');
    expect(contextText).toContain('status=COMPLETED');
  });
});
