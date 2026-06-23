import { logger } from '../lib/logger.js';
import type { ChangedFile, PushResult } from './github-api.service.js';

const BITBUCKET_API = 'https://api.bitbucket.org/2.0';

export interface BitbucketConfig {
  /** Auth identity: Atlassian email (API token) or Bitbucket username (app password). */
  username: string;
  /** API token (preferred) or legacy app password. */
  token: string;
  /** "workspace/repo_slug". */
  repo?: string | null;
  branch?: string | null;
}

export interface BitbucketPullRequestResult {
  number: number;
  htmlUrl: string;
}

function headers(cfg: BitbucketConfig): Record<string, string> {
  const basic = Buffer.from(`${cfg.username}:${cfg.token}`).toString('base64');
  return {
    Authorization: `Basic ${basic}`,
    Accept: 'application/json',
    'User-Agent': 'nexus-ai-dashboard',
  };
}

/** Split "workspace/repo_slug" into its parts. */
function parseRepo(cfg: BitbucketConfig): { workspace: string; slug: string } {
  const full = (cfg.repo || '').trim();
  const idx = full.indexOf('/');
  if (idx <= 0 || idx === full.length - 1) {
    throw new Error(`Invalid Bitbucket repo "${full}". Expected "workspace/repo-slug".`);
  }
  return { workspace: full.slice(0, idx), slug: full.slice(idx + 1) };
}

export function isBitbucketConfigured(cfg?: Pick<BitbucketConfig, 'username' | 'token' | 'repo'> | null): boolean {
  return Boolean(cfg?.username && cfg?.token && cfg?.repo);
}

/** Fetch a file's text content at a ref. Returns null when missing. */
export async function getFileContent(
  cfg: BitbucketConfig,
  filePath: string,
  ref?: string,
): Promise<{ content: string } | null> {
  const { workspace, slug } = parseRepo(cfg);
  const branch = ref || cfg.branch || 'main';
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const url = `${BITBUCKET_API}/repositories/${workspace}/${slug}/src/${encodeURIComponent(branch)}/${encodedPath}`;
  const res = await fetch(url, { headers: headers(cfg) });
  if (res.status === 404) return null;
  if (!res.ok) {
    logger.warn({ status: res.status, filePath }, 'Bitbucket getFileContent failed');
    return null;
  }
  // The /src endpoint returns the raw file body.
  const content = await res.text();
  return { content };
}

/** Resolve the tip commit hash of a branch. */
async function getBranchHash(cfg: BitbucketConfig, branch: string): Promise<string | null> {
  const { workspace, slug } = parseRepo(cfg);
  const url = `${BITBUCKET_API}/repositories/${workspace}/${slug}/refs/branches/${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: headers(cfg) });
  if (!res.ok) return null;
  const data = (await res.json()) as { target?: { hash?: string } };
  return data.target?.hash ?? null;
}

/**
 * Create `newBranch` off the tip of `fromBranch`. Idempotent: an existing
 * branch (400/409) is treated as success.
 */
export async function createBranch(
  cfg: BitbucketConfig,
  newBranch: string,
  fromBranch?: string,
): Promise<{ created: boolean; sha: string | null }> {
  const { workspace, slug } = parseRepo(cfg);
  const base = fromBranch || cfg.branch || 'main';
  const baseHash = await getBranchHash(cfg, base);
  if (!baseHash) throw new Error(`Bitbucket base branch "${base}" not found`);

  const res = await fetch(`${BITBUCKET_API}/repositories/${workspace}/${slug}/refs/branches`, {
    method: 'POST',
    headers: { ...headers(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newBranch, target: { hash: baseHash } }),
  });
  if (res.ok) return { created: true, sha: baseHash };
  if (res.status === 400 || res.status === 409) {
    // Already exists — reuse it.
    return { created: false, sha: await getBranchHash(cfg, newBranch) };
  }
  throw new Error(`Bitbucket branch create failed: ${res.status} ${await res.text()}`);
}

/**
 * Commit a set of files to `branch` in one request via the /src endpoint.
 * Files with `content === null` are deleted. Returns the resulting commit.
 */
export async function pushFilesViaApi(
  cfg: BitbucketConfig,
  branch: string,
  message: string,
  files: ChangedFile[],
): Promise<PushResult> {
  if (!cfg.token) throw new Error('Bitbucket token is not configured');
  if (files.length === 0) throw new Error('No files to push');
  const { workspace, slug } = parseRepo(cfg);

  const form = new FormData();
  form.append('message', message);
  form.append('branch', branch);
  for (const file of files) {
    if (file.content === null) {
      // A `files` field naming a path marks it for deletion.
      form.append('files', file.path);
    } else {
      // Any other field name is treated as a path with the field value as content.
      form.append(file.path, file.content);
    }
  }

  const res = await fetch(`${BITBUCKET_API}/repositories/${workspace}/${slug}/src`, {
    method: 'POST',
    headers: headers(cfg), // do NOT set Content-Type; fetch sets the multipart boundary
    body: form,
  });
  if (!res.ok) throw new Error(`Bitbucket commit failed: ${res.status} ${await res.text()}`);

  // The /src endpoint returns 201 with no commit body; read the new branch tip.
  const commitSha = (await getBranchHash(cfg, branch)) || '';
  const htmlUrl = commitSha
    ? `https://bitbucket.org/${workspace}/${slug}/commits/${commitSha}`
    : `https://bitbucket.org/${workspace}/${slug}/branch/${branch}`;
  return { commitSha, htmlUrl, filesPushed: files.length };
}

/**
 * Open a pull request from `head` into `base`. If one already exists for that
 * source branch, return it instead of erroring.
 */
export async function createPullRequest(
  cfg: BitbucketConfig,
  head: string,
  base: string,
  title: string,
  body: string,
): Promise<BitbucketPullRequestResult> {
  const { workspace, slug } = parseRepo(cfg);

  const res = await fetch(`${BITBUCKET_API}/repositories/${workspace}/${slug}/pullrequests`, {
    method: 'POST',
    headers: { ...headers(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      source: { branch: { name: head } },
      destination: { branch: { name: base } },
      summary: { raw: body },
    }),
  });
  if (res.ok) {
    const pr = (await res.json()) as { id: number; links?: { html?: { href?: string } } };
    return { number: pr.id, htmlUrl: pr.links?.html?.href || `https://bitbucket.org/${workspace}/${slug}/pull-requests/${pr.id}` };
  }

  // A duplicate PR for this source branch yields 400/409 — look it up.
  if (res.status === 400 || res.status === 409) {
    const listUrl = `${BITBUCKET_API}/repositories/${workspace}/${slug}/pullrequests?q=${encodeURIComponent(`source.branch.name="${head}" AND state="OPEN"`)}`;
    const listRes = await fetch(listUrl, { headers: headers(cfg) });
    if (listRes.ok) {
      const data = (await listRes.json()) as { values?: Array<{ id: number; links?: { html?: { href?: string } } }> };
      const existing = data.values?.[0];
      if (existing) {
        return { number: existing.id, htmlUrl: existing.links?.html?.href || `https://bitbucket.org/${workspace}/${slug}/pull-requests/${existing.id}` };
      }
    }
  }
  throw new Error(`Bitbucket pull request create failed: ${res.status} ${await res.text()}`);
}
