import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { cleanupTestData, createTestUser, writeFakeClaudeCli } from './setup.js';
import { buildMotherChatContext } from '../services/mother-chat.service.js';
import { dispatchBoardTaskToAgents, startBoardAgentCollaboration, startLiveBlackboardConversation } from '../services/board-collaboration.service.js';
import { processNextAgentRunJobForTest } from '../services/agent-run-queue.service.js';
import { getLiveBlackboardJobContext } from '../services/blackboard.service.js';

describe('agent run queue service', () => {
  const originalClaudeCommand = process.env.CLAUDE_COMMAND;
  const originalClaudeCliPath = process.env.CLAUDE_CLI_PATH;
  const originalOperationTimeout = process.env.CLAUDE_OPERATION_TIMEOUT_MS;
  let orgId: string;
  let tempDir = '';

  beforeAll(async () => {
    const setup = await createTestUser('agent-run-queue');
    orgId = setup.organization.id;

    tempDir = mkdtempSync(path.join(os.tmpdir(), 'nexus-fake-claude-'));
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
    console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: '0199a213-81c0-7800-8aa1-bbab2a035a53', model: 'claude-test' }));
    console.log(JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Mock agent report: context=' + (input.includes('NEXUS CONTEXT PACKET') ? 'present' : 'missing') }],
        usage: { input_tokens: 12, cache_read_input_tokens: 4, output_tokens: 7 }
      }
    }));
    console.log(JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: '0199a213-81c0-7800-8aa1-bbab2a035a53',
      is_error: false,
      usage: { input_tokens: 12, cache_creation_input_tokens: 0, cache_read_input_tokens: 4, output_tokens: 7 }
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

    await cleanupTestData(orgId);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('processes a queued local Claude job and exposes the result to Mother Chat context', async () => {
    const board = await prisma.board.create({
      data: {
        organizationId: orgId,
        name: 'Worker Queue Production',
        slug: `worker-queue-production-${Date.now()}`,
        description: 'Worker queue test room',
        objective: 'Prove queued local Claude jobs flow into Mother Chat',
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

  it('queues live blackboard turns and exposes agent-to-agent events to Mother Chat context', async () => {
    await prisma.agentRunJob.deleteMany({ where: { organizationId: orgId, status: 'QUEUED' } });

    const board = await prisma.board.create({
      data: {
        organizationId: orgId,
        name: 'Live Blackboard Production',
        slug: `live-blackboard-production-${Date.now()}`,
        description: 'Live blackboard test room',
        objective: 'Prove short-turn agents can talk through a shared blackboard',
        maxAgents: 4,
      },
    });

    const live = await startLiveBlackboardConversation(orgId, board.id, {
      goal: 'Reach a production decision through live agent discussion.',
      trigger: 'Each agent should state its position, answer peer objections, and move toward a final decision.',
      maxRounds: 2,
      agents: [
        {
          displayName: 'Intake Agent',
          role: 'Requirement intake',
          work: 'State the user requirement and ask one clarifying question.',
          isLead: true,
        },
        {
          displayName: 'Planner Agent',
          role: 'Planning',
          work: 'Answer intake and propose the smallest implementation plan.',
        },
        {
          displayName: 'Reviewer Agent',
          role: 'Review',
          work: 'Challenge the plan and name the risk.',
        },
        {
          displayName: 'Closer Agent',
          role: 'Decision closer',
          work: 'Track tradeoffs and prepare final decision language.',
        },
        {
          displayName: 'Overflow Agent',
          role: 'Should be capped out',
          work: 'This agent should not be included.',
        },
      ],
    });

    expect(live.agents).toHaveLength(4);
    expect(live.runJobs).toHaveLength(4);
    expect(live.runJobs.every(job => job.status === 'QUEUED')).toBe(true);

    for (let i = 0; i < 4; i += 1) {
      await processNextAgentRunJobForTest({ organizationId: orgId });
    }

    const events = await prisma.blackboardEvent.findMany({
      where: {
        organizationId: orgId,
        boardId: board.id,
        conversationId: live.conversationId,
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.some(event => event.type === 'admin_task')).toBe(true);
    expect(events.filter(event => event.type === 'agent_message')).toHaveLength(4);
    expect(events.map(event => event.content).join('\n')).toContain('Mock agent report');

    const conversation = await prisma.boardConversation.findUniqueOrThrow({
      where: { id: live.conversationId },
    });
    expect(conversation.status).toBe('RUNNING');
    expect(conversation.currentRound).toBe(1);

    const allConversationJobs = await prisma.agentRunJob.findMany({
      where: {
        organizationId: orgId,
        boardId: board.id,
        threadId: live.thread.id,
      },
    });
    const liveConversationJobs = allConversationJobs.filter(job => (
      getLiveBlackboardJobContext(job.contextPacket)?.conversationId === live.conversationId
    ));
    expect(liveConversationJobs).toHaveLength(8);
    expect(liveConversationJobs.filter(job => job.status === 'QUEUED')).toHaveLength(4);

    const { context, contextText } = await buildMotherChatContext(orgId, { boardId: board.id });
    expect(context.counts.activeBlackboardConversations).toBe(1);
    expect(context.counts.blackboardEvents).toBeGreaterThanOrEqual(5);
    expect(context.blackboardConversations?.some(item => item.id === live.conversationId)).toBe(true);
    expect(context.blackboardEvents?.some(event => event.type === 'agent_message')).toBe(true);
    expect(contextText).toContain('Live blackboard conversations');
    expect(contextText).toContain('Live blackboard events');
  });
});
