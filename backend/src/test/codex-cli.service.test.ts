import { afterEach, describe, expect, it } from 'vitest';
import {
  applyCodexJsonEvent,
  buildCodexExecArgs,
  isCodexResumeUnavailableError,
  resolveCodexCommand,
  type CodexRunState,
} from '../services/codex-cli.service.js';

function createState(): CodexRunState {
  return {
    codexSessionId: null,
    result: '',
    usage: null,
    errorMessage: null,
    rawStdout: '',
    stderr: '',
  };
}

describe('codex-cli service helpers', () => {
  const originalCodexCliPath = process.env.CODEX_CLI_PATH;
  const originalCodexCommand = process.env.CODEX_COMMAND;

  afterEach(() => {
    if (originalCodexCliPath === undefined) {
      delete process.env.CODEX_CLI_PATH;
    } else {
      process.env.CODEX_CLI_PATH = originalCodexCliPath;
    }

    if (originalCodexCommand === undefined) {
      delete process.env.CODEX_COMMAND;
    } else {
      process.env.CODEX_COMMAND = originalCodexCommand;
    }
  });

  it('builds new codex exec JSONL args with workspace and sandbox settings', () => {
    expect(buildCodexExecArgs({
      cwd: '/repo',
      sandbox: 'workspace-write',
      skipGitRepoCheck: true,
    })).toEqual([
      'exec',
      '--json',
      '-C',
      '/repo',
      '--sandbox',
      'workspace-write',
      '--skip-git-repo-check',
      '-',
    ]);
  });

  it('builds resume args using the saved Codex session id', () => {
    expect(buildCodexExecArgs({
      cwd: '/repo',
      sessionId: '0199a213-81c0-7800-8aa1-bbab2a035a53',
      model: 'gpt-5.4',
      sandbox: 'read-only',
    })).toEqual([
      'exec',
      '--json',
      '-C',
      '/repo',
      '-m',
      'gpt-5.4',
      '--sandbox',
      'read-only',
      'resume',
      '--all',
      '0199a213-81c0-7800-8aa1-bbab2a035a53',
      '-',
    ]);
  });

  it('captures thread ids, agent responses, and usage from JSONL events', () => {
    const state = createState();

    const started = applyCodexJsonEvent({
      type: 'thread.started',
      thread_id: '0199a213-81c0-7800-8aa1-bbab2a035a53',
    }, state);
    expect(state.codexSessionId).toBe('0199a213-81c0-7800-8aa1-bbab2a035a53');
    expect(started[0]).toMatchObject({ type: 'status_update' });

    const response = applyCodexJsonEvent({
      type: 'item.completed',
      item: { id: 'item_1', type: 'agent_message', text: 'Done.' },
    }, state);
    expect(state.result).toBe('Done.');
    expect(response[0]).toMatchObject({ type: 'response', content: 'Done.' });

    applyCodexJsonEvent({
      type: 'turn.completed',
      usage: {
        input_tokens: 10,
        cached_input_tokens: 4,
        output_tokens: 3,
        reasoning_output_tokens: 2,
      },
    }, state);
    expect(state.usage).toEqual({
      inputTokens: 10,
      cachedInputTokens: 4,
      outputTokens: 3,
      reasoningOutputTokens: 2,
    });
  });

  it('maps command executions to tool events', () => {
    const state = createState();

    const started = applyCodexJsonEvent({
      type: 'item.started',
      item: { id: 'item_cmd', type: 'command_execution', command: 'npm test', status: 'in_progress' },
    }, state);
    expect(started[0]).toMatchObject({
      type: 'tool_call',
      content: 'npm test',
    });

    const completed = applyCodexJsonEvent({
      type: 'item.completed',
      item: { id: 'item_cmd', type: 'command_execution', command: 'npm test', status: 'completed' },
    }, state);
    expect(completed[0]).toMatchObject({
      type: 'tool_result',
      content: 'npm test',
    });
  });

  it('rejects CODEX_CLI_PATH when it points at a directory', async () => {
    process.env.CODEX_CLI_PATH = '/Applications/';
    delete process.env.CODEX_COMMAND;

    await expect(resolveCodexCommand()).rejects.toThrow(
      'The configured path is a directory, not the Codex executable',
    );
    await expect(resolveCodexCommand()).rejects.toThrow(
      '/Applications/Codex.app/Contents/Resources/codex',
    );
  });

  it('detects stale Codex resume sessions as recoverable', () => {
    expect(isCodexResumeUnavailableError(new Error(
      'Codex exited with code 1: Error: thread/resume: thread/resume failed: no rollout found for thread id 019ebb77-b1c9-71c0-b32c-81deb69477c2 (code -32600)',
    ))).toBe(true);
    expect(isCodexResumeUnavailableError(new Error('Codex exited with code 1: auth failed'))).toBe(false);
  });
});
