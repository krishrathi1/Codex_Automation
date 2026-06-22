import { logger } from '../lib/logger.js';

const VERCEL_API = 'https://api.vercel.com';

function headers(): Record<string, string> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error('VERCEL_TOKEN is not configured');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function teamQuery(): string {
  const teamId = process.env.VERCEL_TEAM_ID;
  return teamId ? `&teamId=${encodeURIComponent(teamId)}` : '';
}

export interface VercelDeployment {
  uid: string;
  name: string;
  url: string;
  state: 'BUILDING' | 'ERROR' | 'INITIALIZING' | 'QUEUED' | 'READY' | 'CANCELED';
  readyState: string;
  createdAt: number;
  meta?: Record<string, string>;
  errorMessage?: string;
}

export interface VercelLogEvent {
  type: string;
  payload: {
    text?: string;
    statusCode?: number;
    path?: string;
    method?: string;
    deploymentId?: string;
    id?: string;
  };
  date?: number;
}

export interface VercelProject {
  id: string;
  name: string;
}

export async function resolveProjectId(): Promise<string> {
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (projectId) return projectId;

  const projectName = process.env.VERCEL_PROJECT_NAME || 'mutual-fund';
  const url = `${VERCEL_API}/v9/projects/${encodeURIComponent(projectName)}?${teamQuery().slice(1)}`;

  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(`Vercel project lookup failed: ${res.status} ${await res.text()}`);
  }
  const project = await res.json() as VercelProject;
  return project.id;
}

export async function getRecentDeployments(projectId: string, limit = 5): Promise<VercelDeployment[]> {
  const url = `${VERCEL_API}/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=${limit}${teamQuery()}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(`Vercel deployments fetch failed: ${res.status}`);
  }
  const data = await res.json() as { deployments: VercelDeployment[] };
  return data.deployments ?? [];
}

export async function getDeploymentErrorLogs(deploymentId: string): Promise<string> {
  const url = `${VERCEL_API}/v2/deployments/${encodeURIComponent(deploymentId)}/events?type=error${teamQuery()}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    logger.warn({ deploymentId, status: res.status }, 'Could not fetch Vercel deployment events');
    return '';
  }
  const events = await res.json() as VercelLogEvent[];
  return events
    .map(e => e.payload?.text ?? '')
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);
}

export async function getDeploymentBuildLogs(deploymentId: string): Promise<string> {
  const url = `${VERCEL_API}/v2/deployments/${encodeURIComponent(deploymentId)}/events?type=stdout${teamQuery()}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) return '';
  const events = await res.json() as VercelLogEvent[];
  const errorLines = events
    .map(e => e.payload?.text ?? '')
    .filter(line => /error|failed|cannot find|module not found|syntax/i.test(line));
  return errorLines.join('\n').slice(0, 4000);
}

export async function triggerRedeploy(projectId: string, latestDeploymentId: string): Promise<string> {
  const teamId = process.env.VERCEL_TEAM_ID;
  const body: Record<string, unknown> = {
    deploymentId: latestDeploymentId,
    name: process.env.VERCEL_PROJECT_NAME || 'mutual-fund',
    target: 'production',
  };
  if (teamId) body.teamId = teamId;

  const url = `${VERCEL_API}/v13/deployments`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel redeploy failed: ${res.status} — ${text}`);
  }
  const data = await res.json() as { id: string; url: string };
  logger.info({ deploymentId: data.id, url: data.url }, 'Vercel redeploy triggered');
  return data.id;
}

export async function getLatestErrorDeployment(projectId: string): Promise<VercelDeployment | null> {
  const deployments = await getRecentDeployments(projectId, 10);
  return deployments.find(d => d.state === 'ERROR') ?? null;
}

export function isVercelConfigured(): boolean {
  return Boolean(process.env.VERCEL_TOKEN && (process.env.VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_NAME));
}
