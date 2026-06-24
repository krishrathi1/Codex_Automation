import { logger } from '../lib/logger.js';
import { fetchWithTimeout } from '../lib/http.js';

const GITHUB_API = 'https://api.github.com';

export interface GitHubConfig {
  token: string;
  repo?: string | null;
  branch?: string | null;
}

function headers(cfg: GitHubConfig): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'nexus-ai-dashboard',
  };
  if (cfg.token) h.Authorization = `Bearer ${cfg.token}`;
  return h;
}

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  head_sha: string;
  head_commit: { message: string } | null;
  created_at: string;
  updated_at: string;
}

export interface GitHubJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  steps: Array<{ name: string; conclusion: string | null; number: number }>;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  labels: Array<{ name: string }>;
  created_at: string;
  state: string;
}

function getRepo(cfg: GitHubConfig): string {
  if (!cfg.repo) throw new Error('GitHub repo not configured. Set it in Settings → Integrations → GitHub repo.');
  return cfg.repo;
}

export async function getFailedWorkflowRuns(cfg: GitHubConfig, limit = 5): Promise<GitHubWorkflowRun[]> {
  const repo = getRepo(cfg);
  const url = `${GITHUB_API}/repos/${repo}/actions/runs?status=failure&per_page=${limit}`;
  const res = await fetchWithTimeout(url, { headers: headers(cfg) });

  if (!res.ok) {
    logger.warn({ status: res.status, repo }, 'GitHub workflow runs fetch failed');
    return [];
  }
  const data = await res.json() as { workflow_runs: GitHubWorkflowRun[] };
  return data.workflow_runs ?? [];
}

export async function getRunJobs(cfg: GitHubConfig, runId: number): Promise<GitHubJob[]> {
  const repo = getRepo(cfg);
  const url = `${GITHUB_API}/repos/${repo}/actions/runs/${runId}/jobs`;
  const res = await fetchWithTimeout(url, { headers: headers(cfg) });
  if (!res.ok) return [];
  const data = await res.json() as { jobs: GitHubJob[] };
  return data.jobs ?? [];
}

export async function getOpenBugIssues(cfg: GitHubConfig, limit = 5): Promise<GitHubIssue[]> {
  const repo = getRepo(cfg);
  const url = `${GITHUB_API}/repos/${repo}/issues?state=open&labels=bug&per_page=${limit}`;
  const res = await fetchWithTimeout(url, { headers: headers(cfg) });
  if (!res.ok) {
    logger.warn({ status: res.status }, 'GitHub issues fetch failed');
    return [];
  }
  const data = await res.json() as GitHubIssue[];
  return Array.isArray(data) ? data : [];
}

export async function getLatestCommitSha(cfg: GitHubConfig): Promise<string | null> {
  const repo = getRepo(cfg);
  const branch = cfg.branch || 'main';
  const url = `${GITHUB_API}/repos/${repo}/commits/${branch}`;
  const res = await fetchWithTimeout(url, { headers: headers(cfg) });
  if (!res.ok) return null;
  const data = await res.json() as { sha: string };
  return data.sha ?? null;
}

export async function buildWorkflowErrorDescription(cfg: GitHubConfig, run: GitHubWorkflowRun): Promise<string> {
  const jobs = await getRunJobs(cfg, run.id);
  const failedJobs = jobs.filter(j => j.conclusion === 'failure');

  const parts: string[] = [
    `GitHub Actions workflow "${run.name}" failed`,
    `Commit: ${run.head_commit?.message ?? run.head_sha}`,
    `Run URL: ${run.html_url}`,
  ];

  for (const job of failedJobs) {
    parts.push(`\nFailed job: ${job.name}`);
    const failedSteps = job.steps.filter(s => s.conclusion === 'failure');
    for (const step of failedSteps) {
      parts.push(`  - Step ${step.number}: ${step.name}`);
    }
  }

  return parts.join('\n');
}

export function isGitHubConfigured(cfg?: Pick<GitHubConfig, 'token' | 'repo'> | null): boolean {
  return Boolean(cfg?.token && cfg?.repo);
}

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
  const res = await fetchWithTimeout(url, { headers: headers(cfg) });
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
  const res = await fetchWithTimeout(url, { headers: headers(cfg) });
  if (!res.ok) {
    logger.warn({ status: res.status }, 'GitHub getRepoTree failed');
    return [];
  }
  const data = await res.json() as { tree?: Array<{ path: string; type: string }> };
  return (data.tree ?? []).filter(t => t.type === 'blob').map(t => t.path);
}

/**
 * Create a new branch `newBranch` pointing at the tip of `fromBranch`.
 * Idempotent: if the branch already exists (422), it is left as-is.
 */
export async function createBranch(
  cfg: GitHubConfig,
  newBranch: string,
  fromBranch?: string,
): Promise<{ created: boolean; sha: string | null }> {
  if (!cfg.token) throw new Error('GitHub token is not configured');
  const repo = getRepo(cfg);
  const base = fromBranch || cfg.branch || 'main';

  const refRes = await fetchWithTimeout(`${GITHUB_API}/repos/${repo}/git/ref/heads/${encodeURIComponent(base)}`, {
    headers: headers(cfg),
  });
  if (!refRes.ok) throw new Error(`GitHub base ref lookup failed: ${refRes.status} ${await refRes.text()}`);
  const baseSha = ((await refRes.json()) as { object: { sha: string } }).object.sha;

  const createRes = await fetchWithTimeout(`${GITHUB_API}/repos/${repo}/git/refs`, {
    method: 'POST',
    headers: { ...headers(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: baseSha }),
  });
  if (createRes.status === 422) {
    // Branch already exists — fine, reuse it.
    return { created: false, sha: baseSha };
  }
  if (!createRes.ok) throw new Error(`GitHub branch create failed: ${createRes.status} ${await createRes.text()}`);
  return { created: true, sha: baseSha };
}

export interface PullRequestResult {
  number: number;
  htmlUrl: string;
}

/**
 * Open a pull request from `head` into `base`. If an open PR for that head
 * already exists, return it instead of erroring.
 */
export async function createPullRequest(
  cfg: GitHubConfig,
  head: string,
  base: string,
  title: string,
  body: string,
): Promise<PullRequestResult> {
  if (!cfg.token) throw new Error('GitHub token is not configured');
  const repo = getRepo(cfg);

  const createRes = await fetchWithTimeout(`${GITHUB_API}/repos/${repo}/pulls`, {
    method: 'POST',
    headers: { ...headers(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, head, base, body }),
  });
  if (createRes.ok) {
    const pr = (await createRes.json()) as { number: number; html_url: string };
    return { number: pr.number, htmlUrl: pr.html_url };
  }

  // 422 commonly means a PR for this head already exists — look it up.
  if (createRes.status === 422) {
    const owner = repo.split('/')[0];
    const listRes = await fetchWithTimeout(
      `${GITHUB_API}/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}`,
      { headers: headers(cfg) },
    );
    if (listRes.ok) {
      const prs = (await listRes.json()) as Array<{ number: number; html_url: string }>;
      if (prs.length > 0) return { number: prs[0].number, htmlUrl: prs[0].html_url };
    }
  }
  throw new Error(`GitHub pull request create failed: ${createRes.status} ${await createRes.text()}`);
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
    fetchWithTimeout(`${GITHUB_API}/repos/${repo}${path}`, {
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
