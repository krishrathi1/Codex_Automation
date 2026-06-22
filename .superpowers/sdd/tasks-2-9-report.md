# Tasks 2–9 Migration Report

**Status: DONE_WITH_CONCERNS**

**Date:** 2026-06-22

---

## Commits (in order)

| Short Hash | Message |
|-----------|---------|
| `248fe47` | feat: agents.ts — use claude-cli.service |
| `67cf374` | feat: mother-chat route — use claude-cli.service |
| `3d1612c` | feat: mother-chat.service — import from claude-cli.service |
| `b474571` | feat: agent-run-queue.service — use claude-cli.service and claude runtime strings |
| `3573c89` | feat: index.ts — use claude-cli.service for startup diagnostics |
| `f907a12` | feat: mini-service — use claude CLI command and event format |
| `8da9321` | feat: update env files for Claude CLI runtime |
| `eb22ef4` | chore: remove codex-cli.service.ts — replaced by claude-cli.service.ts |
| `9d6479a` | feat: migrate remaining codex-cli.service imports to claude-cli.service |
| `e357111` | fix: mother-chat.service — update remaining CODEX_MODEL references to CLAUDE_MODEL |

---

## Changes by Task

### Task 2 — `backend/src/routes/agents.ts`
- Import updated to `claude-cli.service.js`
- `runtime: 'codex-cli'` → `runtime: 'claude-cli'`
- Error message updated to reference `AGENT_RUNTIME=claude-cli` and "Claude CLI runtime"

### Task 3 — `backend/src/routes/mother-chat.ts`
- Import updated to `claude-cli.service.js`
- `runtime: 'codex-cli'` → `runtime: 'claude-cli'`

### Task 4 — `backend/src/services/mother-chat.service.ts`
- Import updated to `claude-cli.service.js`
- All `agentRuntime: 'codex-cli'` → `agentRuntime: 'claude-cli'`
- `CODEX_MODEL` → `CLAUDE_MODEL || CODEX_MODEL` (backward compat)
- `CODEX_WORKSPACE_ROOT` → `CLAUDE_WORKSPACE_ROOT || CODEX_WORKSPACE_ROOT` (backward compat)

### Task 5 — `backend/src/services/agent-run-queue.service.ts`
- Import updated to `claude-cli.service.js`
- `updateAgentCodexSession`: added `claudeCliSessionId`, `agentRuntime: 'claude-cli'`, `gatewayAgentId: claude:...`
- All `runtime: 'codex-cli'` → `runtime: 'claude-cli'` (8 occurrences)
- All `agentRuntime: 'codex-cli'` → `agentRuntime: 'claude-cli'`
- Tags array `'codex-cli'` → `'claude-cli'`
- `CODEX_MODEL` → `CLAUDE_MODEL || CODEX_MODEL || 'claude-cli'`
- Error messages updated: "Codex CLI" → "Claude CLI", "codex login" → "claude login"
- User-visible messages: "Codex run" → "Claude run", "local Codex run" → "local Claude run"

### Task 6 — `backend/src/index.ts`
- Import updated to `claude-cli.service.js`
- Two log strings updated from "Codex CLI" to "Claude CLI"

### Task 7 — `Codex_Automation/mini-services/codex-service/index.ts`
- `codexCommand` default: `CLAUDE_COMMAND || CODEX_COMMAND || 'claude'`
- `buildCodexArgs` replaced: old Codex exec args → Claude `--output-format stream-json [--model M] [--resume S]`
- `handleCodexEvent` fully replaced: old Codex event types (`thread.started`, `item.started`, `item.completed`, `turn.completed`) → Claude event types (`system`, `assistant`, `result`, `error`)
- User-visible strings updated throughout (demo mode messages, error messages, startup logs)

### Task 8 — `backend/.env.example` and `backend/.env`
- `.env.example`: Replaced `AGENT_RUNTIME=codex-cli` + all `CODEX_*` lines with `AGENT_RUNTIME=claude-cli` + `CLAUDE_*` vars; committed
- `.env`: Updated `AGENT_RUNTIME=codex-cli` → `claude-cli`, removed `CODEX_*` vars, added `CLAUDE_*` vars; NOT committed (contains secrets)

### Task 9 — Delete `codex-cli.service.ts`
- File removed with `git rm` and committed

### Extra — Additional files discovered during verification
- `backend/src/services/agent.service.ts`: import updated to `claude-cli.service.js`
- `backend/src/services/gateway.service.ts`: import updated to `claude-cli.service.js`
- `backend/src/services/production-error-pipeline.service.ts`: `agentRuntime`, workspace, tags updated
- `backend/src/test/codex-cli.service.test.ts`: import updated to `claude-cli.service.js`
- `backend/src/test/mother-chat.service.test.ts`: import updated to `claude-cli.service.js`

---

## Remaining grep matches after cleanup

### `codex-cli.service` string (import paths only)
None. Only remaining match is a `describe(...)` string in the test file — not an import.

### `CODEX_` env var references
All remaining `CODEX_*` references are either:
1. **Backward-compat fallbacks** in service code (e.g., `CLAUDE_MODEL || CODEX_MODEL` — intentional, safe to remove later)
2. **Test files** that test `resolveCodexCommand` behavior with `CODEX_CLI_PATH` — these env var names are stale since `claude-cli.service.ts` now uses `CLAUDE_CLI_PATH`, not `CODEX_CLI_PATH`

---

## Concerns

1. **Test files reference stale env vars** (`CODEX_CLI_PATH`): `backend/src/test/codex-cli.service.test.ts`, `backend/src/test/agent-run-queue.service.test.ts`, and `backend/src/test/production-error-pipeline.service.test.ts` set/delete `process.env.CODEX_CLI_PATH` to test `resolveCodexCommand`. Since `claude-cli.service.ts` reads `CLAUDE_CLI_PATH` not `CODEX_CLI_PATH`, these specific test cases will now fail (or test the wrong code path). The test files themselves import from `claude-cli.service.js` correctly, but the env var being tested is wrong.

2. **Mini-service `handleCodexEvent`**: The old Codex event format (`thread.started`, `item.completed`, etc.) has been replaced with Claude's streaming JSON format (`system`, `assistant`, `result`). The `CodexItem`, `CodexSandbox`, and related types in the mini-service are now dead code. They can be cleaned up in a follow-up refactor.

3. **`backend/.env` not committed** — updated in place only, as instructed.
