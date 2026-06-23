# Manual Mode + Global Branch/PR Flow — Design

**Date:** 2026-06-23
**Status:** Approved (design), implementing

## Goal

Add a second production-group **mode** called `manual`. In manual mode the agent
does not auto-fix anything — it just watches that group's live logs. The user
picks a log, attaches "what to fix", and the *same* debug→review→commit pipeline
runs on demand. Additionally, **no fix is ever pushed to the base branch
directly anymore** (both modes): every fix lands on a new branch and opens a
merge request (PR).

## Decisions (from brainstorming)

1. **Branch + PR is global** — applies to both AUTOMATIC and MANUAL modes.
2. **Logs are scoped per production group** — each group has a SigNoz service
   name. The manual tab and the existing SigNoz Logs page both filter by it.
3. **Manual fix reuses the existing debug→review→commit pipeline** (keeps the
   review gate); the selected log + user instructions are the pipeline input.

## Data model

- `Board.mode` — new column `String @default("AUTOMATIC")`, values
  `AUTOMATIC | MANUAL`. (Prisma migration.)
- `integrationScope.signozService` — per-group SigNoz service name, stored in the
  existing `successMetrics.integrationScope` JSON (no migration). Normalized in
  `board.service.ts#normalizeIntegrationScope`.
- `ProductionErrorEvent` new nullable fields (migration):
  - `origin String @default("AUTOMATIC")` — `AUTOMATIC | MANUAL`
  - `prBranch String?`, `prUrl String?`, `prNumber Int?`
- `ProductionErrorStatus` new value `AWAITING_MANUAL` (recorded automatic errors
  on a MANUAL board sit here instead of queuing).

## Backend

### github-api.service.ts
- `createBranch(cfg, newBranch, fromBranch)` — read base ref SHA, POST
  `/git/refs` with `refs/heads/<newBranch>`. Idempotent (ignore 422 "exists").
- `createPullRequest(cfg, head, base, title, body)` → POST `/pulls`, returns
  `{ number, htmlUrl }`. If a PR already exists for head, return the existing one.

### production-error-pipeline.service.ts
- **Branch+PR push (global):** `pushApprovedFix` / `pushApprovedFixViaApi` now:
  1. resolve base branch from board scope (default `main`),
  2. `createBranch('nexus-fix/<short-id>', base)`,
  3. push files to the new branch,
  4. `createPullRequest(head=newBranch, base, title, body)`,
  5. persist `prBranch/prUrl/prNumber` on the error event; return PR info.
- **Manual gate:** `ingestProductionErrorEvent` reads `board.mode`. If `MANUAL`,
  create the error event with `status=AWAITING_MANUAL`, **do not** enqueue the
  debug job. (Automatic path unchanged otherwise.)
- **Manual trigger:** new `startManualFix(orgId, boardId, { logBody, logSeverity,
  logTimestamp, traceId, serviceName, instructions }, { io })`. Builds a
  `ProductionErrorEvent` (`origin=MANUAL`) from the log, appends the user's
  instructions to the debug prompt, then runs the standard pipeline (debug →
  review → commit → branch/PR).

### Routes
- `GET /boards/:id/logs?severity=&search=&sinceMs=&limit=` — live SigNoz logs
  filtered by the board's `signozService` (via a new `service` option threaded
  into `queryLogs`).
- `POST /boards/:id/manual-fix` — body `{ instructions, log }` → `startManualFix`.
- `boards.ts PATCH /:id` and `POST /` already forward the body to
  `board.service`; add `mode` + `signozService` (in `integrationScope`) to the
  service signatures.

### signoz-api.service.ts
- `QueryLogsOptions.service?: string` — when set, add
  `service.name = '<service>'` clause in `buildFilterExpression`.

## Frontend

- **types/index.ts:** `Board.mode`, `integrationScope.signozService`,
  `ProductionErrorEvent.{origin,prBranch,prUrl,prNumber}`.
- **api.ts:** `boardLogs(boardId, params)`, `startManualFix(boardId, payload)`.
- **BoardSettings (BoardDetail.tsx):** a Mode toggle (Automatic / Manual) and a
  SigNoz service-name field (saved into `integrationScope.signozService`).
- **BoardDetail.tsx:** when `mode === 'MANUAL'`, show a **Manual** tab/toggle at
  the top. The manual view is a split panel:
  - Left: live logs for this group (polls `GET /boards/:id/logs`).
  - Right: "fix composer" — click a log to attach it, type instructions, Submit
    → `POST /boards/:id/manual-fix`. Shows pipeline status + resulting PR link.
- **Logs.tsx:** add a production-group selector; selecting a group filters the
  live stream by that group's `signozService`.

## Unchanged
Mother chat, the 3-agent workflow internals, the kanban board. Automatic groups
behave as before except the final push now uses branch + PR.

## Branch naming
`nexus-fix/<first 8 chars of errorEvent.id>`; PR base = group's configured branch
(default `main`).
