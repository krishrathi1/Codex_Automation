# Task 1 Report — claude-cli.service.ts

**Status:** DONE

**Commit:** `77026df`

**Test summary:** `npx tsx --tsconfig backend/tsconfig.json backend/src/services/claude-cli.service.ts` exits `ok` (zero errors, zero TS diagnostics).

## What was done

- Created `backend/src/services/claude-cli.service.ts` (1 152 lines) from scratch, mirroring the full structure of `codex-cli.service.ts`.
- All exported names preserved identically: types (`CodexCliUsage`, `CodexJsonEvent`, `NexusCodexEventType`, `NexusCodexEvent`, `CodexRunState`, `CodexCliRunResult`) and functions (`isCodexCliRuntimeEnabled`, `selectedAgentRuntime`, `resolveCodexCwd`, `getAgentCodexSessionId`, `getThreadCodexSessionId`, `resolveCodexCommand`, `validateInstallation`, `validateAuthentication`, `getCodexCliDiagnostics`, `buildCodexExecArgs`, `isCodexResumeUnavailableError`, `applyCodexJsonEvent`, `runCodexCliPrompt`, `runCodexCliPromptWithResumeRecovery`, `sendCodexCliAgentMessage`, `getCodexCliAgentMessages`).

## Key implementation decisions

| Area | Decision |
|---|---|
| CLI args | `['--output-format', 'stream-json', ...optionalModel, ...optionalResume]`; cwd passed via `spawn()` option, not `--cwd` flag |
| Binary resolution | `CLAUDE_CLI_PATH` → `CLAUDE_COMMAND` → `claude` on PATH (no macOS app bundle fallback) |
| Timeout env | `CLAUDE_OPERATION_TIMEOUT_MS` |
| Model env | `CLAUDE_MODEL` |
| Workspace env | `CLAUDE_WORKSPACE_ROOT` (also reads `CODEX_WORKSPACE_ROOT` for compat) |
| `validateAuthentication` | Runs `claude --version`; success = auth ok (no `login status` subcommand) |
| `selectedAgentRuntime` default | `'claude-cli'` |
| `isCodexCliRuntimeEnabled` | Accepts `claude-cli` or `claude` |
| Stream-json event mapping | `system/init` → `status_update`; `assistant` text blocks → `response`; tool_use blocks → `tool_call`; `user` with tool_result → `tool_result`; `result` (success) → `status_update`; `result` (error / `is_error`) → `error` |
| Claude usage mapping | `input_tokens + cache_creation_input_tokens` → `inputTokens`; `cache_read_input_tokens` → `cachedInputTokens`; `output_tokens` → `outputTokens`; `reasoningOutputTokens: 0` |
| Non-zero exit with result | Treated as success when `state.result` is already populated |
| Session persistence | Writes both `claudeCliSessionId` + `codexCliSessionId` and `claudeSessionConfirmed` + `codexSessionConfirmed` in DB |
| `updateAgentSession` | Sets `claudeCliSessionId`, `codexCliSessionId` (compat), `activeWorkflowSessionId`, `agentRuntime: 'claude-cli'` |
| `getAgentCodexSessionId` | Priority: `claudeCliSessionId` → `codexCliSessionId` → `codexSessionId` → `activeWorkflowSessionId` → gatewayAgentId stripped of `claude:` then `codex:` prefix |
| `getThreadCodexSessionId` | Checks `claudeCliSessionId`, `codexCliSessionId`, `codexSessionId` in metadata |
| Session confirmed | `claudeSessionConfirmed === true` OR `codexSessionConfirmed === true` OR `role !== 'user'` |
| `isCodexResumeUnavailableError` | Matches `session.*not.?found`, `resume.*failed`, `thread\/resume` |
| `ANTHROPIC_API_KEY` | NOT deleted from env (Claude CLI needs it); only `OPENAI_API_KEY`, `CODEX_API_KEY`, `PLATFORM_OPENAI_API_KEY` stripped |

## Concerns

None. The file compiles cleanly and all external API contracts are preserved.
