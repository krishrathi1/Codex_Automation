import { afterEach, describe, expect, it } from 'vitest';
import {
  applyCodexJsonEvent,
  buildCodexExecArgs,
  isCodexResumeUnavailableError,
  resolveCodexCommand,
  type CodexRunState,
} from '../services/claude-cli.service.js';

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

describe('claude-cli service helpers', () => {
  const originalClaudeCliPath = process.env.CLAUDE_CLI_PATH;
  const originalClaudeCommand = process.env.CLAUDE_COMMAND;

  afterEach(() => {
    if (originalClaudeCliPath === undefined) {
      delete process.env.CLAUDE_CLI_PATH;
    } else {
      process.env.CLAUDE_CLI_PATH = originalClaudeCliPath;
    }

    if (originalClaudeCommand === undefined) {
      delete process.env.CLAUDE_COMMAND;
    } else {
      process.env.CLAUDE_COMMAND = originalClaudeCommand;
    }
  });

  it('builds claude exec args with stream-json output format', () => {
    expect(buildCodexExecArgs({})).toEqual([
      '--output-format',
      'stream-json',
      '--verbose',
    ]);
  });

  it('builds resume args using the saved Claude session id', () => {
    expect(buildCodexExecArgs({
      sessionId: '0199a213-81c0-7800-8aa1-bbab2a035a53',
      model: 'claude-opus-4-8',
    })).toEqual([
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      'claude-opus-4-8',
      '--resume',
      '0199a213-81c0-7800-8aa1-bbab2a035a53',
    ]);
  });

  it('captures session ids, agent responses, and usage from Claude JSONL events', () => {
    const state = createState();

    const started = applyCodexJsonEvent({
      type: 'system',
      subtype: 'init',
      session_id: '0199a213-81c0-7800-8aa1-bbab2a035a53',
      model: 'claude-sonnet-4-6',
    }, state);
    expect(state.codexSessionId).toBe('0199a213-81c0-7800-8aa1-bbab2a035a53');
    expect(started[0]).toMatchObject({ type: 'status_update' });

    const response = applyCodexJsonEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Done.' }],
        usage: { input_tokens: 10, cache_read_input_tokens: 4, output_tokens: 3 },
      },
    }, state);
    expect(state.result).toBe('Done.');
    expect(response[0]).toMatchObject({ type: 'response', content: 'Done.' });

    applyCodexJsonEvent({
      type: 'result',
      subtype: 'success',
      session_id: '0199a213-81c0-7800-8aa1-bbab2a035a53',
      result: 'Done.',
      is_error: false,
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 4,
        output_tokens: 3,
      },
    }, state);
    expect(state.usage).toEqual({
      inputTokens: 10,
      cachedInputTokens: 4,
      outputTokens: 3,
      reasoningOutputTokens: 0,
    });
  });

  it('maps tool_use blocks to tool_call events', () => {
    const state = createState();

    const events = applyCodexJsonEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tool_1', name: 'Bash', input: { command: 'npm test' } }],
      },
    }, state);
    expect(events[0]).toMatchObject({ type: 'tool_call', content: 'Bash' });
  });

  it('maps tool_result blocks from user turns', () => {
    const state = createState();

    const events = applyCodexJsonEvent({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: [{ type: 'text', text: 'ok' }] }],
      },
    }, state);
    expect(events[0]).toMatchObject({ type: 'tool_result' });
  });

  it('rejects CLAUDE_CLI_PATH when it points at a directory', async () => {
    process.env.CLAUDE_CLI_PATH = '/Applications/';
    delete process.env.CLAUDE_COMMAND;

    await expect(resolveCodexCommand()).rejects.toThrow(
      /directory|not.*executable|does not exist/i,
    );
  });

  it('detects stale Claude resume sessions as recoverable', () => {
    expect(isCodexResumeUnavailableError(new Error(
      'Claude exited with code 1: session not found for id 019ebb77-b1c9-71c0-b32c-81deb69477c2',
    ))).toBe(true);
    expect(isCodexResumeUnavailableError(new Error(
      'thread/resume failed: no rollout found',
    ))).toBe(true);
    expect(isCodexResumeUnavailableError(new Error('Claude exited with code 1: auth failed'))).toBe(false);
  });
});
