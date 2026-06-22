import { logger } from '../lib/logger.js';

const GITHUB_API = 'https://api.github.com';

function headers(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) h.Authorization = `Bearer ${token}`;
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

function getRepo(): string {
  return process.env.GITHUB_REPO || 'krishrathi1/Mutual-Fund-Co-Pilot-';
}

export async function getFailedWorkflowRuns(limit = 5): Promise<GitHubWorkflowRun[]> {
  const repo = getRepo();
  const url = `${GITHUB_API}/repos/${repo}/actions/runs?status=failure&per_page=${limit}`;
  const res = await fetch(url, { headers: headers() });

  if (!res.ok) {
    logger.warn({ status: res.status, repo }, 'GitHub workflow runs fetch failed');
    return [];
  }
  const data = await res.json() as { workflow_runs: GitHubWorkflowRun[] };
  return data.workflow_runs ?? [];
}

export async function getRunJobs(runId: number): Promise<GitHubJob[]> {
  const repo = getRepo();
  const url = `${GITHUB_API}/repos/${repo}/actions/runs/${runId}/jobs`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) return [];
  const data = await res.json() as { jobs: GitHubJob[] };
  return data.jobs ?? [];
}

export async function getOpenBugIssues(limit = 5): Promise<GitHubIssue[]> {
  const repo = getRepo();
  const url = `${GITHUB_API}/repos/${repo}/issues?state=open&labels=bug&per_page=${limit}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    logger.warn({ status: res.status }, 'GitHub issues fetch failed');
    return [];
  }
  const data = await res.json() as GitHubIssue[];
  return Array.isArray(data) ? data : [];
}

export async function getLatestCommitSha(): Promise<string | null> {
  const repo = getRepo();
  const branch = process.env.GITHUB_BRANCH || 'main';
  const url = `${GITHUB_API}/repos/${repo}/commits/${branch}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) return null;
  const data = await res.json() as { sha: string };
  return data.sha ?? null;
}

export async function buildWorkflowErrorDescription(run: GitHubWorkflowRun): Promise<string> {
  const jobs = await getRunJobs(run.id);
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

export function isGitHubConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
}
