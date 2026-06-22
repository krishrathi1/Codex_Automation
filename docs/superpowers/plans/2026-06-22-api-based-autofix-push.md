# API-based Auto-Fix → Push to GitHub `main` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the production-error pipeline read repo files via the GitHub API, generate a fix as structured `FILE:` blocks, and commit the fix directly to `main` via the GitHub Git Data API — no local clone, no `git` CLI.

**Architecture:** Extend the existing Debug → Review → Commit agent pipeline. The Debug agent receives current file contents (fetched via the GitHub Contents API from paths parsed out of the error logs) and emits the fix as `===FILE: path===` blocks. The backend persists those blocks on the `ProductionErrorEvent`, and at the Commit step pushes them to `main` via blob→tree→commit→ref GitHub API calls. Credentials resolve from the Settings UI (env fallback).

**Tech Stack:** Node 20, TypeScript (ESM, `.js` import specifiers), Express, Prisma, Socket.IO, Vitest. GitHub REST API v3 (`https://api.github.com`).

## Global Constraints

- Module system is ESM: every local import uses a `.js` specifier (e.g. `./github-api.service.js`), even for `.ts` sources. Copy this exactly.
- All GitHub HTTP calls go through the existing `headers(cfg)` helper in `github-api.service.ts` (sets `Accept`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: nexus-ai-dashboard`, and `Authorization: Bearer <token>` when a token exists).
- Push target branch is `main` (value from `cfg.branch`, default `'main'`). Push is **direct to `main`** — accepted risk, no PR.
- Default repo when unset: `'krishrathi1/Mutual-Fund-Co-Pilot-'` (existing `getRepo()` behavior — do not change it).
- Tests run with `npx vitest run <path>` from the `backend/` directory. Tests use real Prisma against the test DB and the shared helpers in `src/test/setup.js`.
- Never log token values. Log status codes and paths only.

---

## File Structure

- `backend/src/services/github-api.service.ts` — **modify**: add `getFileContent`, `getRepoTree`, `pushFilesViaApi` and their types. Stays the single home for all GitHub HTTP.
- `backend/src/services/autofix-parsing.ts` — **create**: two pure, dependency-free helpers — `extractRepoFilePaths(text)` and `parseFileBlocks(text)`. Pure functions kept separate so they are trivially unit-testable and reused by the pipeline.
- `backend/src/services/production-error-pipeline.service.ts` — **modify**: fetch file context for the debug prompt, instruct agents to emit/approve `FILE:` blocks, persist the fix on the event, and push at the commit step.
- `backend/src/services/mutual-fund-monitor.service.ts` — **modify**: remove `buildCommitAgentExtra` and the `workspace`/`commitInstructions` plumbing.
- `backend/.env` — **modify**: remove the `MUTUAL_FUND_WORKSPACE` line.
- Tests: `backend/src/test/github-api.service.test.ts` (create), `backend/src/test/autofix-parsing.test.ts` (create), `backend/src/test/production-error-pipeline.service.test.ts` (modify).

---

## Task 1: GitHub API read/write functions

**Files:**
- Modify: `backend/src/services/github-api.service.ts`
- Test: `backend/src/test/github-api.service.test.ts` (create)

**Interfaces:**
- Consumes: existing `GitHubConfig` (`{ token: string; repo?: string|null; branch?: string|null }`), existing `headers(cfg)` and `getRepo(cfg)`.
- Produces:
  - `getFileContent(cfg: GitHubConfig, filePath: string, ref?: string): Promise<{ content: string; sha: string } | null>`
  - `getRepoTree(cfg: GitHubConfig, ref?: string): Promise<string[]>`
  - `pushFilesViaApi(cfg: GitHubConfig, branch: string, message: string, files: ChangedFile[]): Promise<PushResult>`
  - `interface ChangedFile { path: string; content: string | null }` (content `null` = delete)
  - `interface PushResult { commitSha: string; htmlUrl: string; filesPushed: number }`

- [ ] **Step 1: Write the failing test**

Create `backend/src/test/github-api.service.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFileContent, pushFilesViaApi } from '../services/github-api.service.js';

const cfg = { token: 't0ken', repo: 'owner/repo', branch: 'main' };

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('getFileContent', () => {
  it('decodes base64 content and returns sha', async () => {
    const fetchMock = vi.fn(() =>
      jsonResponse({ content: Buffer.from('hello world', 'utf8').toString('base64'), encoding: 'base64', sha: 'abc123' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await getFileContent(cfg, 'src/app.ts');
    expect(result).toEqual({ content: 'hello world', sha: 'abc123' });
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://api.github.com/repos/owner/repo/contents/src/app.ts?ref=main');
  });

  it('returns null on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ message: 'Not Found' }, 404)));
    expect(await getFileContent(cfg, 'missing.ts')).toBeNull();
  });
});

describe('pushFilesViaApi', () => {
  it('runs ref -> commit -> blob -> tree -> commit -> ref in order and returns the new commit', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.endsWith('/git/ref/heads/main')) return jsonResponse({ object: { sha: 'BASE_COMMIT' } });
      if (url.endsWith('/git/commits/BASE_COMMIT')) return jsonResponse({ tree: { sha: 'BASE_TREE' } });
      if (url.endsWith('/git/blobs')) return jsonResponse({ sha: 'BLOB1' });
      if (url.endsWith('/git/trees')) return jsonResponse({ sha: 'NEW_TREE' });
      if (url.endsWith('/git/commits')) return jsonResponse({ sha: 'NEW_COMMIT', html_url: 'https://github.com/owner/repo/commit/NEW_COMMIT' });
      if (url.endsWith('/git/refs/heads/main')) return jsonResponse({ object: { sha: 'NEW_COMMIT' } });
      throw new Error('unexpected url ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pushFilesViaApi(cfg, 'main', 'fix: x', [{ path: 'src/app.ts', content: 'patched' }]);

    expect(result).toEqual({ commitSha: 'NEW_COMMIT', htmlUrl: 'https://github.com/owner/repo/commit/NEW_COMMIT', filesPushed: 1 });
    expect(calls.map(c => `${c.method} ${c.url.split('/repos/owner/repo')[1]}`)).toEqual([
      'GET /git/ref/heads/main',
      'GET /git/commits/BASE_COMMIT',
      'POST /git/blobs',
      'POST /git/trees',
      'POST /git/commits',
      'PATCH /git/refs/heads/main',
    ]);
  });

  it('sends base_tree and a deletion entry with sha:null', async () => {
    let treeBody: any = null;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/git/ref/heads/main')) return jsonResponse({ object: { sha: 'BASE_COMMIT' } });
      if (url.endsWith('/git/commits/BASE_COMMIT')) return jsonResponse({ tree: { sha: 'BASE_TREE' } });
      if (url.endsWith('/git/trees')) { treeBody = JSON.parse(String(init?.body)); return jsonResponse({ sha: 'NEW_TREE' }); }
      if (url.endsWith('/git/commits')) return jsonResponse({ sha: 'C', html_url: 'h' });
      if (url.endsWith('/git/refs/heads/main')) return jsonResponse({ object: { sha: 'C' } });
      throw new Error('unexpected ' + url);
    }));

    await pushFilesViaApi(cfg, 'main', 'msg', [{ path: 'gone.ts', content: null }]);
    expect(treeBody.base_tree).toBe('BASE_TREE');
    expect(treeBody.tree).toEqual([{ path: 'gone.ts', mode: '100644', type: 'blob', sha: null }]);
  });

  it('throws when no token', async () => {
    await expect(pushFilesViaApi({ token: '', repo: 'o/r' }, 'main', 'm', [{ path: 'a', content: 'b' }]))
      .rejects.toThrow(/token/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/test/github-api.service.test.ts`
Expected: FAIL — `getFileContent`/`pushFilesViaApi` are not exported.

- [ ] **Step 3: Write the implementation**

Append to `backend/src/services/github-api.service.ts` (after the existing `isGitHubConfigured` function), and remember to keep the existing `import { logger }`:

```typescript
export interface ChangedFile {
  path: string;
  content: string | null; // null => delete the file
}

export interface PushResult {
  commitSha: string;
  htmlUrl: string;
  filesPushed: number;
}

export async function getFileContent(
  cfg: GitHubConfig,
  filePath: string,
  ref?: string,
): Promise<{ content: string; sha: string } | null> {
  const repo = getRepo(cfg);
  const branch = ref || cfg.branch || 'main';
  // Encode each path segment but keep the slashes.
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: headers(cfg) });
  if (res.status === 404) return null;
  if (!res.ok) {
    logger.warn({ status: res.status, filePath }, 'GitHub getFileContent failed');
    return null;
  }
  const data = await res.json() as { content?: string; encoding?: string; sha: string };
  if (!data.content) return null;
  const content = Buffer.from(data.content, (data.encoding as BufferEncoding) || 'base64').toString('utf8');
  return { content, sha: data.sha };
}

export async function getRepoTree(cfg: GitHubConfig, ref?: string): Promise<string[]> {
  const repo = getRepo(cfg);
  const branch = ref || cfg.branch || 'main';
  const url = `${GITHUB_API}/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const res = await fetch(url, { headers: headers(cfg) });
  if (!res.ok) {
    logger.warn({ status: res.status }, 'GitHub getRepoTree failed');
    return [];
  }
  const data = await res.json() as { tree?: Array<{ path: string; type: string }> };
  return (data.tree ?? []).filter(t => t.type === 'blob').map(t => t.path);
}

export async function pushFilesViaApi(
  cfg: GitHubConfig,
  branch: string,
  message: string,
  files: ChangedFile[],
): Promise<PushResult> {
  if (!cfg.token) throw new Error('GitHub token is not configured');
  if (files.length === 0) throw new Error('No files to push');
  const repo = getRepo(cfg);

  const api = (path: string, init?: RequestInit) =>
    fetch(`${GITHUB_API}/repos/${repo}${path}`, {
      ...init,
      headers: {
        ...headers(cfg),
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });

  const refRes = await api(`/git/ref/heads/${branch}`);
  if (!refRes.ok) throw new Error(`GitHub ref lookup failed: ${refRes.status} ${await refRes.text()}`);
  const baseCommitSha = ((await refRes.json()) as { object: { sha: string } }).object.sha;

  const baseCommitRes = await api(`/git/commits/${baseCommitSha}`);
  if (!baseCommitRes.ok) throw new Error(`GitHub base commit lookup failed: ${baseCommitRes.status}`);
  const baseTreeSha = ((await baseCommitRes.json()) as { tree: { sha: string } }).tree.sha;

  const treeEntries: Array<Record<string, unknown>> = [];
  for (const file of files) {
    if (file.content === null) {
      treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const blobRes = await api('/git/blobs', {
      method: 'POST',
      body: JSON.stringify({ content: Buffer.from(file.content, 'utf8').toString('base64'), encoding: 'base64' }),
    });
    if (!blobRes.ok) throw new Error(`GitHub blob create failed for ${file.path}: ${blobRes.status}`);
    const blobSha = ((await blobRes.json()) as { sha: string }).sha;
    treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blobSha });
  }

  const treeRes = await api('/git/trees', {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });
  if (!treeRes.ok) throw new Error(`GitHub tree create failed: ${treeRes.status} ${await treeRes.text()}`);
  const newTreeSha = ((await treeRes.json()) as { sha: string }).sha;

  const newCommitRes = await api('/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTreeSha, parents: [baseCommitSha] }),
  });
  if (!newCommitRes.ok) throw new Error(`GitHub commit create failed: ${newCommitRes.status}`);
  const newCommit = (await newCommitRes.json()) as { sha: string; html_url: string };

  const updateRes = await api(`/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha, force: false }),
  });
  if (!updateRes.ok) throw new Error(`GitHub ref update failed: ${updateRes.status} ${await updateRes.text()}`);

  return { commitSha: newCommit.sha, htmlUrl: newCommit.html_url ?? '', filesPushed: files.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/test/github-api.service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/github-api.service.ts backend/src/test/github-api.service.test.ts
git commit -m "feat(github): add API-based file read and push (blob/tree/commit/ref)"
```

---

## Task 2: Pure parsing helpers (file-path extraction + FILE blocks)

**Files:**
- Create: `backend/src/services/autofix-parsing.ts`
- Test: `backend/src/test/autofix-parsing.test.ts` (create)

**Interfaces:**
- Produces:
  - `extractRepoFilePaths(text: string): string[]` — repo-relative source paths parsed from log/stack text, deduped, `node_modules`/absolute paths excluded.
  - `parseFileBlocks(text: string): Array<{ path: string; content: string | null }>` — parses `===FILE: <path>===\n<content>\n===END FILE===` and `===DELETE: <path>===` markers. Malformed/unterminated blocks are skipped.

- [ ] **Step 1: Write the failing test**

Create `backend/src/test/autofix-parsing.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { extractRepoFilePaths, parseFileBlocks } from '../services/autofix-parsing.js';

describe('extractRepoFilePaths', () => {
  it('pulls source paths out of a stack trace and dedupes', () => {
    const stack = [
      'TypeError: Cannot read properties of undefined',
      '    at Dashboard (src/pages/Dashboard.tsx:42:13)',
      '    at render (src/pages/Dashboard.tsx:10:1)',
      '    at app/api/route.ts:5',
    ].join('\n');
    expect(extractRepoFilePaths(stack)).toEqual(['src/pages/Dashboard.tsx', 'app/api/route.ts']);
  });

  it('ignores node_modules and unknown extensions', () => {
    const text = 'at node_modules/react/index.js:1 and README.unknownext and src/x.ts:2';
    expect(extractRepoFilePaths(text)).toEqual(['src/x.ts']);
  });

  it('returns empty array when no paths', () => {
    expect(extractRepoFilePaths('no files here')).toEqual([]);
  });
});

describe('parseFileBlocks', () => {
  it('parses multiple FILE blocks with full content', () => {
    const out = [
      'Here is the fix.',
      '===FILE: src/a.ts===',
      'export const a = 1;',
      'export const b = 2;',
      '===END FILE===',
      '===FILE: src/b.ts===',
      'export const c = 3;',
      '===END FILE===',
    ].join('\n');
    expect(parseFileBlocks(out)).toEqual([
      { path: 'src/a.ts', content: 'export const a = 1;\nexport const b = 2;' },
      { path: 'src/b.ts', content: 'export const c = 3;' },
    ]);
  });

  it('parses a DELETE marker as null content', () => {
    expect(parseFileBlocks('===DELETE: src/old.ts===')).toEqual([{ path: 'src/old.ts', content: null }]);
  });

  it('skips an unterminated block and returns the valid ones', () => {
    const out = '===FILE: src/a.ts===\nok\n===END FILE===\n===FILE: src/b.ts===\nno end marker';
    expect(parseFileBlocks(out)).toEqual([{ path: 'src/a.ts', content: 'ok' }]);
  });

  it('returns empty array when there are no blocks', () => {
    expect(parseFileBlocks('just prose, no markers')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/test/autofix-parsing.test.ts`
Expected: FAIL — module `autofix-parsing.js` not found.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/autofix-parsing.ts`:

```typescript
const SOURCE_EXT = 'tsx?|jsx?|mjs|cjs|json|css|scss|sass|less|html|vue|svelte|py|go|rs|java|rb|php|ya?ml|md|sql';
const FILE_PATH_RE = new RegExp(`([\\w./-]+\\.(?:${SOURCE_EXT}))`, 'g');

/**
 * Extract repo-relative source file paths from free-form error/log text.
 * Strips trailing :line:col, drops node_modules and absolute paths, dedupes
 * while preserving first-seen order.
 */
export function extractRepoFilePaths(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(FILE_PATH_RE)) {
    let p = match[1];
    // strip a leading "./"
    p = p.replace(/^\.\//, '');
    if (!p || p.includes('node_modules') || p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)) continue;
    if (p.startsWith('..')) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

const FILE_BLOCK_RE = /===FILE:\s*(.+?)\s*===\r?\n([\s\S]*?)\r?\n===END FILE===/g;
const DELETE_RE = /===DELETE:\s*(.+?)\s*===/g;

/**
 * Parse a fix payload made of ===FILE: path=== / ===END FILE=== blocks and
 * ===DELETE: path=== markers. Unterminated or malformed blocks are skipped so
 * a truncated agent response can never produce a corrupt file.
 */
export function parseFileBlocks(text: string): Array<{ path: string; content: string | null }> {
  if (!text) return [];
  const result: Array<{ path: string; content: string | null }> = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(FILE_BLOCK_RE)) {
    const path = m[1].trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push({ path, content: m[2] });
  }
  for (const m of text.matchAll(DELETE_RE)) {
    const path = m[1].trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push({ path, content: null });
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/test/autofix-parsing.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/autofix-parsing.ts backend/src/test/autofix-parsing.test.ts
git commit -m "feat(autofix): add file-path extraction and FILE-block parsing helpers"
```

---

## Task 3: Fetch file context into the Debug prompt

**Files:**
- Modify: `backend/src/services/production-error-pipeline.service.ts`
- Test: covered by Task 5's pipeline integration test (this task has no standalone behavioral test; it is verified by the build and by Task 5).

**Interfaces:**
- Consumes: `getFileContent` (Task 1), `extractRepoFilePaths` (Task 2), `getMonitorIntegrationCredentials(organizationId)` from `platform-integrations.service.js` (returns `{ github: { token, repo, branch }, vercel: {...} }`).
- Produces: a private helper `fetchErrorFileContext(organizationId, errorEvent): Promise<string>` returning a prompt-ready string of fetched files (empty string when none), and a modified `composeDebugPrompt(errorEvent, attempt, reviewOutput, fileContext)`.

- [ ] **Step 1: Add imports**

At the top of `backend/src/services/production-error-pipeline.service.ts`, add to the existing import block:

```typescript
import { getMonitorIntegrationCredentials } from './platform-integrations.service.js';
import { getFileContent } from './github-api.service.js';
import { extractRepoFilePaths, parseFileBlocks } from './autofix-parsing.js';
```

- [ ] **Step 2: Add the `fetchErrorFileContext` helper**

Add above `composeDebugPrompt`:

```typescript
const MAX_CONTEXT_FILES = 8;

/**
 * Parse likely file paths out of the captured error and fetch their current
 * contents from GitHub so the Debug agent can reason over real source instead
 * of a local clone. Returns a prompt-ready string ('' when nothing is found).
 */
async function fetchErrorFileContext(organizationId: string, errorEvent: ProductionErrorEvent): Promise<string> {
  const creds = await getMonitorIntegrationCredentials(organizationId).catch(() => null);
  const github = creds?.github;
  if (!github?.token) return '';

  const haystack = [errorEvent.message, errorEvent.stack, errorEvent.title].filter(Boolean).join('\n');
  const paths = extractRepoFilePaths(haystack).slice(0, MAX_CONTEXT_FILES);
  if (paths.length === 0) return '';

  const sections: string[] = [];
  for (const p of paths) {
    const file = await getFileContent(github, p, github.branch || 'main').catch(() => null);
    if (file) sections.push(`===FILE: ${p}===\n${file.content}\n===END FILE===`);
  }
  if (sections.length === 0) return '';

  return [
    '',
    'CURRENT REPOSITORY FILES (fetched from GitHub — these are the live contents):',
    ...sections,
  ].join('\n');
}
```

- [ ] **Step 3: Update `composeDebugPrompt` to take and emit file context + output contract**

Replace the existing `composeDebugPrompt` function with:

```typescript
function composeDebugPrompt(errorEvent: ProductionErrorEvent, attempt = 0, reviewOutput?: string, fileContext = '') {
  return [
    'PIPELINE ROLE: debug',
    `PRODUCTION_ERROR_EVENT_ID: ${errorEvent.id}`,
    `REWORK_ATTEMPT: ${attempt}`,
    '',
    'A production website/integration error was captured by Nexus.',
    'You do NOT have a local checkout. Use ONLY the repository file contents provided below.',
    'Do not run git, do not access the filesystem, do not ask for API keys.',
    'Determine the fix, then output every changed file IN FULL using this exact format:',
    '===FILE: relative/path/from/repo/root.ext===',
    '<the complete new file contents>',
    '===END FILE===',
    'To delete a file, emit: ===DELETE: relative/path===',
    'Only emit files you actually changed. Emit complete files, never partial snippets.',
    'After the blocks, add a short audit note: root cause, confidence, and remaining risk.',
    reviewOutput ? `Previous review feedback:\n${reviewOutput}` : '',
    fileContext,
    '',
    'Captured error:',
    JSON.stringify({
      id: errorEvent.id,
      source: errorEvent.source,
      severity: errorEvent.severity,
      title: errorEvent.title,
      message: errorEvent.message,
      stack: errorEvent.stack,
      url: errorEvent.url,
      route: errorEvent.route,
      environment: errorEvent.environment,
      fingerprint: errorEvent.fingerprint,
      payload: errorEvent.payload,
    }, null, 2),
  ].filter(Boolean).join('\n');
}
```

- [ ] **Step 4: Pass file context when first composing the debug prompt**

In `ingestProductionErrorEvent`, find where `debugRunJob` is enqueued (the `enqueuePipelineJob({... prompt: composeDebugPrompt(errorEvent), role: 'debug' ...})` call). Replace the prompt line so the context is fetched first. Immediately before the `const debugRunJob = await enqueuePipelineJob({` call, add:

```typescript
  const debugFileContext = await fetchErrorFileContext(organizationId, errorEvent);
```

Then change the enqueue call's prompt field from:

```typescript
    prompt: composeDebugPrompt(errorEvent),
```

to:

```typescript
    prompt: composeDebugPrompt(errorEvent, 0, undefined, debugFileContext),
```

- [ ] **Step 5: Build to verify types**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors. (Behavioral verification happens in Task 5.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/production-error-pipeline.service.ts
git commit -m "feat(pipeline): fetch GitHub file context into the debug prompt"
```

---

## Task 4: Persist the proposed fix on the event at Debug → Review

**Files:**
- Modify: `backend/src/services/production-error-pipeline.service.ts`
- Test: covered by Task 5.

**Interfaces:**
- Consumes: `parseFileBlocks` (Task 2).
- Produces: when a debug job completes, the parsed `FILE:` blocks are stored on the event under `payload.proposedFix` (an array of `{ path, content }`) so the commit step can push them deterministically.

- [ ] **Step 1: Persist parsed blocks in `queueReviewJob`**

`queueReviewJob(errorEvent, job, debugOutput)` is called at the debug→review transition and already has the debug output. Inside it, before the `enqueuePipelineJob(... role: 'review' ...)` call, add:

```typescript
  const proposedFix = parseFileBlocks(debugOutput);
  if (proposedFix.length > 0) {
    const mergedPayload = { ...objectRecord(errorEvent.payload), proposedFix };
    await prisma.productionErrorEvent.update({
      where: { id: errorEvent.id },
      data: { payload: mergedPayload as any },
    }).catch(err => logger.warn({ err, id: errorEvent.id }, 'Failed to persist proposedFix'));
  }
```

- [ ] **Step 2: Build to verify types**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/production-error-pipeline.service.ts
git commit -m "feat(pipeline): persist proposed fix FILE-blocks on the error event"
```

---

## Task 5: Push the fix to `main` at the Commit step

**Files:**
- Modify: `backend/src/services/production-error-pipeline.service.ts`
- Modify: `backend/src/test/production-error-pipeline.service.test.ts`

**Interfaces:**
- Consumes: `pushFilesViaApi`, `ChangedFile` (Task 1); `getMonitorIntegrationCredentials`; `parseFileBlocks` and `payload.proposedFix` (Task 4).
- Produces: when a commit job completes, the backend pushes the proposed fix to `main` via the GitHub API, then records `{ commitSha, htmlUrl }` under `payload.push` on the event and emits it. The push source of truth is `payload.proposedFix`, falling back to parsing the commit agent's own output.

- [ ] **Step 1: Update the commit prompt to drop git instructions**

Replace the existing `composeCommitPrompt` function with:

```typescript
function composeCommitPrompt(errorEvent: ProductionErrorEvent, reviewOutput: string) {
  const proposed = parseFileBlocks(JSON.stringify(objectRecord(errorEvent.payload).proposedFix ?? ''));
  return [
    'PIPELINE ROLE: commit',
    `PRODUCTION_ERROR_EVENT_ID: ${errorEvent.id}`,
    '',
    'The Review Agent approved this fix. The Nexus backend will push the change to GitHub via API.',
    'Do NOT run git. Re-emit the FINAL, complete set of changed files using the exact format:',
    '===FILE: relative/path===',
    '<complete file contents>',
    '===END FILE===',
    'Use ===DELETE: relative/path=== for deletions. Then give a one-line commit title prefixed "COMMIT TITLE:".',
    proposed.length > 0 ? `\nFiles approved in the debug step: ${proposed.map(f => f.path).join(', ')}` : '',
    '',
    'Captured error:',
    JSON.stringify({
      id: errorEvent.id,
      title: errorEvent.title,
      message: errorEvent.message,
      fingerprint: errorEvent.fingerprint,
    }, null, 2),
    '',
    'Review Agent output:',
    reviewOutput,
  ].filter(Boolean).join('\n');
}
```

- [ ] **Step 2: Add a `pushApprovedFix` helper**

Add this function above `advanceProductionErrorPipelineAfterJob`:

```typescript
const COMMIT_TITLE_RE = /COMMIT TITLE:\s*(.+)/i;

/**
 * Push the approved fix to the target branch via the GitHub API. Prefers the
 * persisted payload.proposedFix; falls back to parsing the commit agent's
 * output. Returns the push result or null when nothing could be pushed.
 */
async function pushApprovedFix(
  errorEvent: ProductionErrorEvent,
  commitOutput: string,
): Promise<{ commitSha: string; htmlUrl: string } | null> {
  const creds = await getMonitorIntegrationCredentials(errorEvent.organizationId).catch(() => null);
  const github = creds?.github;
  if (!github?.token) {
    logger.info({ id: errorEvent.id }, '[pipeline] No GitHub token configured; skipping push');
    return null;
  }

  const fromCommit = parseFileBlocks(commitOutput);
  const persisted = objectRecord(errorEvent.payload).proposedFix;
  const fromPayload = Array.isArray(persisted)
    ? (persisted as Array<{ path?: unknown; content?: unknown }>)
        .filter(f => typeof f.path === 'string')
        .map(f => ({ path: f.path as string, content: (f.content ?? null) as string | null }))
    : [];

  const files = fromCommit.length > 0 ? fromCommit : fromPayload;
  if (files.length === 0) {
    logger.warn({ id: errorEvent.id }, '[pipeline] No file changes to push');
    return null;
  }

  const branch = github.branch || 'main';
  const title = (commitOutput.match(COMMIT_TITLE_RE)?.[1] ?? `fix: auto-fix for ${errorEvent.title}`).trim().slice(0, 100);
  const message = `${title}\n\nNexus production auto-fix for error ${errorEvent.id}.`;

  const result = await pushFilesViaApi(github, branch, message, files);
  logger.info({ id: errorEvent.id, commitSha: result.commitSha, files: result.filesPushed }, '[pipeline] Pushed fix to GitHub');
  return { commitSha: result.commitSha, htmlUrl: result.htmlUrl };
}
```

Add `pushFilesViaApi` to the existing `import { getFileContent } from './github-api.service.js';` line so it reads:

```typescript
import { getFileContent, pushFilesViaApi } from './github-api.service.js';
```

- [ ] **Step 3: Call the push in the commit branch of `advanceProductionErrorPipelineAfterJob`**

In `advanceProductionErrorPipelineAfterJob`, find the `} else if (context.pipelineRole === 'commit') {` branch. Replace its body with:

```typescript
  } else if (context.pipelineRole === 'commit') {
    const push = await pushApprovedFix(errorEvent, output).catch(err => {
      logger.error({ err, id: errorEvent.id }, '[pipeline] Push to GitHub failed');
      return null;
    });
    await prisma.productionErrorEvent.update({
      where: { id: errorEvent.id },
      data: {
        status: push ? 'COMPLETED' : 'FAILED',
        resolvedAt: push ? new Date() : null,
        payload: { ...objectRecord(errorEvent.payload), push } as any,
      },
    });
    if (push && errorEvent.taskId) {
      await prisma.task.update({
        where: { id: errorEvent.taskId },
        data: { status: 'DONE' },
      }).catch(() => {});
    }
  }
```

- [ ] **Step 4: Write the failing integration test**

In `backend/src/test/production-error-pipeline.service.test.ts`, update the fake `claude` binary so the **debug** and **commit** roles emit `FILE:` blocks. Replace the `const text = role === 'review' ? ... : ...;` assignment (lines ~43-47) with:

```javascript
    const fileBlock = '===FILE: src/pages/Dashboard.tsx===\\nexport const Dashboard = () => null;\\n===END FILE===';
    const text = role === 'review'
      ? 'APPROVED: yes\\\\nReview evidence checked and fix path approved.'
      : role === 'commit'
        ? 'COMMIT TITLE: fix: guard undefined stats\\n' + fileBlock
        : 'Debug fix prepared.\\n' + fileBlock;
```

Then add a new test after the existing one (inside the same `describe`). It stubs `fetch` so both the file-context fetch and the push succeed, and asserts the event reaches `COMPLETED` with a recorded commit SHA:

```typescript
  it('pushes the approved fix to GitHub and records the commit', async () => {
    const { upsertOrganizationIntegrationSettings } = await import('../services/platform-integrations.service.js');
    await upsertOrganizationIntegrationSettings(orgId, { githubAccessToken: 'ghp_test_token' });

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const json = (b: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(b), text: () => Promise.resolve(JSON.stringify(b)) } as Response);
      if (url.includes('/contents/')) return json({ content: Buffer.from('old', 'utf8').toString('base64'), encoding: 'base64', sha: 's' });
      if (url.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'BASE' } });
      if (url.endsWith('/git/commits/BASE')) return json({ tree: { sha: 'BASETREE' } });
      if (url.endsWith('/git/blobs')) return json({ sha: 'BLOB' });
      if (url.endsWith('/git/trees')) return json({ sha: 'TREE' });
      if (url.endsWith('/git/commits')) return json({ sha: 'NEWSHA', html_url: 'https://github.com/o/r/commit/NEWSHA' });
      if (url.endsWith('/git/refs/heads/main')) return json({ object: { sha: 'NEWSHA' } });
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const ingestion = await ingestProductionErrorEvent(orgId, {
        source: 'website', severity: 'critical', title: 'Crash',
        message: 'TypeError at src/pages/Dashboard.tsx:42', stack: 'at src/pages/Dashboard.tsx:42:13',
        url: 'http://localhost/dashboard', route: '/dashboard', environment: 'test',
      });
      await processNextAgentRunJobForTest({ organizationId: orgId }); // debug
      await processNextAgentRunJobForTest({ organizationId: orgId }); // review
      await processNextAgentRunJobForTest({ organizationId: orgId }); // commit

      const event = await prisma.productionErrorEvent.findUniqueOrThrow({ where: { id: ingestion.errorEvent.id } });
      expect(event.status).toBe('COMPLETED');
      expect((event.payload as any).push.commitSha).toBe('NEWSHA');
    } finally {
      vi.unstubAllGlobals();
    }
  });
```

Add `vi` to the test's vitest import: change `import { afterAll, beforeAll, describe, expect, it } from 'vitest';` to `import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';`.

> Note: confirm `upsertOrganizationIntegrationSettings` is the exported setter name in `platform-integrations.service.ts` (it accepts `{ githubAccessToken }`). If the export differs, use the actual setter the service exposes; the goal is only to store a GitHub token for `orgId` so `getMonitorIntegrationCredentials` returns `github.token`.

- [ ] **Step 5: Run the test to verify it fails, then passes after the implementation above**

Run: `cd backend && npx vitest run src/test/production-error-pipeline.service.test.ts`
Expected: the new test PASSES and the original Debug→Review→Commit test still PASSES (it now also exercises the push, with the stubbed fetch covering the GitHub calls — ensure the original test either also stubs fetch or that the org for it has no token so the push is skipped and status is still set; if the original test starts failing because `push` is null → status `FAILED`, give that test its own GitHub token + fetch stub the same way, or assert `COMPLETED` only in the new test). Adjust the original test to stub fetch identically if needed.

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/production-error-pipeline.service.ts backend/src/test/production-error-pipeline.service.test.ts
git commit -m "feat(pipeline): push approved fix to main via GitHub API at commit step"
```

---

## Task 6: Remove local-clone plumbing and `.env` workspace

**Files:**
- Modify: `backend/src/services/mutual-fund-monitor.service.ts`
- Modify: `backend/.env`

**Interfaces:**
- No new exports. Removes `buildCommitAgentExtra` and the `workspace`/`commitInstructions` payload fields. The pipeline no longer reads `commitInstructions` (Task 5 pushes from `payload.proposedFix`), so dropping them is safe.

- [ ] **Step 1: Remove `buildCommitAgentExtra` and its usages**

In `backend/src/services/mutual-fund-monitor.service.ts`:
- Delete the entire `buildCommitAgentExtra(...)` function (the block starting `function buildCommitAgentExtra(`).
- In `checkVercelErrors`, delete the lines:
  ```typescript
  const workspace = process.env.MUTUAL_FUND_WORKSPACE || '';
  ...
  const commitExtra = workspace ? buildCommitAgentExtra(workspace, githubCfg.token, repo, branch) : '';
  ```
  and remove `workspace` and `commitInstructions: commitExtra` from the `payload` object passed to `ingestProductionErrorEvent`.
- In `checkGitHubFailures`, do the same: delete the `workspace`/`commitExtra` locals and remove `workspace` and `commitInstructions: commitExtra` from the `payload`.
- Keep `repo` and `branch` locals (still used for the payload's `repo`/`branch` fields).

- [ ] **Step 2: Update the header comment**

In the top file comment of `mutual-fund-monitor.service.ts`, delete the line documenting `MUTUAL_FUND_WORKSPACE` (the `*   MUTUAL_FUND_WORKSPACE  — local clone the agents edit & push` line), since it no longer applies.

- [ ] **Step 3: Remove the `.env` line**

In `backend/.env`, delete the line:
```
MUTUAL_FUND_WORKSPACE=C:\Users\KRISH\Desktop\mutual-fund-workspace
```
Leave `MUTUAL_FUND_ORG_ID`, `MUTUAL_FUND_BOARD_ID`, `MUTUAL_FUND_MONITOR_INTERVAL_MS`, and `MUTUAL_FUND_MONITOR_DISABLED` in place.

- [ ] **Step 4: Build and test**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: no type errors (no remaining references to `buildCommitAgentExtra`), all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/mutual-fund-monitor.service.ts backend/.env
git commit -m "refactor(monitor): drop local-clone workspace plumbing; API push only"
```

---

## Self-Review Notes (author)

- **Spec coverage:** Config (token via UI, remove workspace) → Task 6 + existing UI; GitHub API read → Task 1 (`getFileContent`/`getRepoTree`); API push → Task 1 (`pushFilesViaApi`); locate files → Task 2/3; structured fix → Task 2 (`parseFileBlocks`) + Task 3/5 prompts; backend push wired into commit step → Task 5; record commit on event + socket → Task 5; error handling (no token / no files / push failure) → Task 5; tests → Tasks 1, 2, 5.
- **Discovery cap:** `MAX_CONTEXT_FILES = 8`; the optional "agent names more files" extra round from the spec is intentionally deferred (YAGNI) — files come from log/stack parsing only. `getRepoTree` is added now for that future round but unused by the pipeline in v1. This is the one place the plan is narrower than the spec; flagged here rather than silently dropped.
- **Direct-to-`main`:** retained as accepted risk; push uses `force:false` so it fails rather than clobbers on a non-fast-forward.
- **Type consistency:** `ChangedFile`/`PushResult` defined in Task 1 and consumed by Task 5; `parseFileBlocks` return shape (`{path, content:string|null}`) matches `ChangedFile`; `proposedFix` payload shape matches what `pushApprovedFix` reads.
