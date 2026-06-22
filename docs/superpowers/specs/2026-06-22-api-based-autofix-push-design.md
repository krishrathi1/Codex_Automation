# Design: Fully API-based Auto-Fix → Push to GitHub `main`

**Date:** 2026-06-22
**Status:** Approved (pending spec review)

## Goal

Let a user provide a **Vercel token** and a **GitHub token** in the Settings UI, then run an
agent flow that:

1. Reads the logs of the monitored website (Vercel deployment),
2. Detects errors in those logs,
3. Generates a fix, and
4. Commits the fix **directly to the `main` branch** of the GitHub repo via the GitHub API,
   which triggers Vercel's auto-redeploy.

No local repository clone is used anywhere. The repo is read and written entirely through the
GitHub REST API.

## Non-goals

- No persistent local clone (`MUTUAL_FUND_WORKSPACE` is removed).
- No `git` CLI for push/auth.
- No pull-request / review branch — the user explicitly wants direct-to-`main`.
- No new standalone subsystem — this extends the existing production-error pipeline, which is
  already a Debug → Review → Commit agent flow.

## Current state (what exists today)

- `mutual-fund-monitor.service.ts` polls Vercel deployments and GitHub Actions, and on failure
  ingests an error event into the production-error pipeline. It currently embeds plaintext
  `commitInstructions` telling an LLM agent to `git add/commit/push` from a local clone
  (`MUTUAL_FUND_WORKSPACE`).
- `production-error-pipeline.service.ts` runs three Claude-CLI agents (Debug, Review, Commit),
  each with the local clone as its working directory.
- `github-api.service.ts` is **read-only** (GET workflow runs, jobs, issues, latest commit).
- Credentials already resolve from the Settings UI first, with `.env` only as a fallback
  (`platform-integrations.service.ts`).

The push capability is gated and clone-dependent; it never runs without a workspace clone.

## Target architecture

### Configuration
- Tokens (GitHub, Vercel, team id) are entered in the Settings UI — no code change needed; the
  resolution path already prefers UI settings.
- Remove `MUTUAL_FUND_WORKSPACE` from `backend/.env`.
- Keep `MUTUAL_FUND_ORG_ID`, `MUTUAL_FUND_BOARD_ID`, `MUTUAL_FUND_MONITOR_INTERVAL_MS`,
  `MUTUAL_FUND_MONITOR_DISABLED` (these are not tokens; they pin org/board and monitor cadence).

### Flow

1. **Detect (unchanged):** monitor ingests a Vercel/GitHub-Actions error with logs.

2. **Locate files:** backend parses the error logs / stack trace for repository file paths. For
   each path, fetch current content via `GET /repos/{repo}/contents/{path}?ref={branch}`
   (base64-decoded). These contents become the agent's context.
   - If no paths parse out of the logs, allow the agent one extra round to name files it wants;
     fetch those. Capped at **one** extra discovery round to bound scope.

3. **Generate fix (Claude-CLI agent, no repo working directory):** the agent receives the error
   plus the fetched file contents and returns a **structured set of changed files** — each as a
   `path` plus the **full new file content**, emitted as fenced `FILE: <path>` blocks that the
   backend parses deterministically. The agent reasons over provided text; it does not touch a
   filesystem.

4. **Push via GitHub Git Data API (backend, deterministic):** new
   `pushFilesViaApi(cfg, branch, message, files[])`:
   - `GET /git/ref/heads/{branch}` → base commit SHA → base tree SHA
   - `POST /git/blobs` per file (base64 content) → blob SHAs
   - `POST /git/trees` with `base_tree` = **remote** tree SHA + only the changed entries
     (stale-safe; a deletion is a tree entry with `sha: null`)
   - `POST /git/commits` (message, new tree, parent = remote HEAD) → new commit SHA
   - `PATCH /git/refs/heads/{branch}` → move `main` to the new commit (triggers Vercel redeploy)
   - returns `{ commitSha, htmlUrl, filesPushed }`

5. **Record:** commit SHA + URL are saved on the `ProductionErrorEvent` and emitted over the
   socket so the UI reflects the push.

## Components / interfaces

### `github-api.service.ts` (new functions)
- `getFileContent(cfg, path, ref): Promise<{ content: string; sha: string } | null>`
  — GET contents, base64-decode. `null` on 404.
- `getRepoTree(cfg, ref): Promise<Array<{ path: string; type: string }>>`
  — `GET /git/trees/{ref}?recursive=1`, used only for the optional discovery round.
- `pushFilesViaApi(cfg, branch, message, files: Array<{ path: string; content: string | null }>):
  Promise<{ commitSha: string; htmlUrl: string; filesPushed: number }>`
  — the blob → tree → commit → ref sequence above. `content: null` means delete.

Each is a focused function over `fetch` + the existing `headers(cfg)` helper, mirroring the
read-only functions already in the file.

### `production-error-pipeline.service.ts` (changes)
- Remove the `commitInstructions` / workspace git-push path.
- Add: parse file paths from the error event → fetch contents → include in the Debug/Commit
  prompts.
- Narrow the Commit agent's role: it emits corrected file contents in `FILE:` blocks; it no
  longer runs git.
- After the Commit step, the backend parses the agent output and calls `pushFilesViaApi`.
- Persist push result (commit SHA + URL) on the event; emit socket update.

### `mutual-fund-monitor.service.ts` (changes)
- Remove `buildCommitAgentExtra` and the workspace plumbing in `checkVercelErrors` /
  `checkGitHubFailures`. The ingested payload no longer carries `commitInstructions` or
  `workspace`.

### `backend/.env`
- Remove the `MUTUAL_FUND_WORKSPACE` line.

## Data flow

```
Vercel logs ──▶ monitor.ingest ──▶ pipeline
                                     │
                                     ├─ parse log → file paths
                                     ├─ GET contents (GitHub API) ──▶ file context
                                     ├─ Debug/Review/Commit agents ──▶ FILE: blocks
                                     ├─ parse blocks → {path, content}[]
                                     └─ pushFilesViaApi (blob→tree→commit→ref) ──▶ main
                                                                                     │
                                                                                     ▼
                                                                          Vercel auto-redeploy
```

## Error handling

- No GitHub token configured → skip push, log clearly (same gating philosophy as today).
- No file paths located from logs and agent names none → log "could not locate files to fix,"
  skip push.
- Empty change set → no-op, log "nothing to push."
- `422` (invalid tree/commit) → surface in pipeline result, do not retry blindly.
- `409` / ref-update race → one retry after re-reading `heads/{branch}`.
- Agent output with no parseable `FILE:` blocks → treated as "no change set," logged.

## Testing

- **`pushFilesViaApi`** — mocked `fetch`: assert call order (ref → commit → blobs → tree →
  commit → ref), `base_tree` layering, deletion entries (`sha: null`), and the returned shape.
- **Log → file-path extraction** — unit tests over representative Vercel build logs and GitHub
  Actions descriptions; empty/no-match case.
- **`FILE:` block parser** — well-formed multi-file output, malformed/partial output (must yield
  an empty or safe change set, never a corrupt file).
- **`getFileContent`** — base64 decode happy path and 404 → `null`.

## Risks / explicit trade-offs

- **Direct-to-`main`, accepted by the user.** A wrong auto-fix is committed straight to `main`
  and deployed live. Mitigation is out of scope per the user's decision; recorded here so it is
  not lost.
- **Fix quality hinges on steps 2–3:** locating the correct files from logs and the agent
  emitting *complete, correct* file contents (not partial snippets). The `FILE:` block parser
  must refuse partial/ambiguous output rather than push a truncated file.
- Using the **remote** tree as `base_tree` (not local) means concurrent commits between read and
  push could be overwritten for the changed files only; the `409` retry narrows but does not
  fully eliminate this.
