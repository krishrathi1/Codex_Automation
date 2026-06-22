import { logger } from '../lib/logger.js';

const VERCEL_API = 'https://api.vercel.com';

export interface VercelConfig {
  token: string;
  teamId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
}

function headers(cfg: VercelConfig): Record<string, string> {
  if (!cfg.token) throw new Error('Vercel token is not configured (set it in Settings or VERCEL_TOKEN)');
  return {
    Authorization: `Bearer ${cfg.token}`,
    'Content-Type': 'application/json',
  };
}

function teamQuery(cfg: VercelConfig): string {
  return cfg.teamId ? `&teamId=${encodeURIComponent(cfg.teamId)}` : '';
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

export async function listProjects(cfg: VercelConfig): Promise<VercelProject[]> {
  const url = `${VERCEL_API}/v9/projects?limit=100${teamQuery(cfg)}`;
  const res = await fetch(url, { headers: headers(cfg) });
  if (!res.ok) {
    throw new Error(`Vercel projects list failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json() as { projects: VercelProject[] };
  return data.projects ?? [];
}

export async function resolveProjectId(cfg: VercelConfig): Promise<string> {
  if (cfg.projectId) return cfg.projectId;

  const wanted = (cfg.projectName || 'mutual-fund').toLowerCase();

  // 1) Exact name lookup.
  const url = `${VERCEL_API}/v9/projects/${encodeURIComponent(cfg.projectName || 'mutual-fund')}?${teamQuery(cfg).slice(1)}`;
  const res = await fetch(url, { headers: headers(cfg) });
  if (res.ok) {
    const project = await res.json() as VercelProject;
    return project.id;
  }

  // 2) Fuzzy fallback: list all projects and match by name containment.
  // Survives a slightly-off configured name (e.g. "mutual-fund" vs "mutual-fund-co-pilot").
  const projects = await listProjects(cfg);
  const match = projects.find(p => {
    const name = p.name.toLowerCase();
    return name === wanted || name.includes(wanted) || wanted.includes(name);
  });
  if (match) {
    logger.info({ projectName: match.name, projectId: match.id }, 'Vercel project resolved via fuzzy match');
    return match.id;
  }

  throw new Error(`Vercel project not found for "${cfg.projectName}". Available: ${projects.map(p => p.name).join(', ') || 'none'}`);
}

export async function getRecentDeployments(cfg: VercelConfig, projectId: string, limit = 5): Promise<VercelDeployment[]> {
  const url = `${VERCEL_API}/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=${limit}${teamQuery(cfg)}`;
  const res = await fetch(url, { headers: headers(cfg) });
  if (!res.ok) {
    throw new Error(`Vercel deployments fetch failed: ${res.status}`);
  }
  const data = await res.json() as { deployments: VercelDeployment[] };
  return data.deployments ?? [];
}

export async function getDeploymentErrorLogs(cfg: VercelConfig, deploymentId: string): Promise<string> {
  const url = `${VERCEL_API}/v2/deployments/${encodeURIComponent(deploymentId)}/events?type=error${teamQuery(cfg)}`;
  const res = await fetch(url, { headers: headers(cfg) });
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

export async function getDeploymentBuildLogs(cfg: VercelConfig, deploymentId: string): Promise<string> {
  const url = `${VERCEL_API}/v2/deployments/${encodeURIComponent(deploymentId)}/events?type=stdout${teamQuery(cfg)}`;
  const res = await fetch(url, { headers: headers(cfg) });
  if (!res.ok) return '';
  const events = await res.json() as VercelLogEvent[];
  const errorLines = events
    .map(e => e.payload?.text ?? '')
    .filter(line => /error|failed|cannot find|module not found|syntax/i.test(line));
  return errorLines.join('\n').slice(0, 4000);
}

export async function triggerRedeploy(cfg: VercelConfig, projectId: string, latestDeploymentId: string): Promise<string> {
  const body: Record<string, unknown> = {
    deploymentId: latestDeploymentId,
    name: cfg.projectName || 'mutual-fund',
    target: 'production',
  };
  if (cfg.teamId) body.teamId = cfg.teamId;

  const url = `${VERCEL_API}/v13/deployments`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(cfg),
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

export async function getLatestErrorDeployment(cfg: VercelConfig, projectId: string): Promise<VercelDeployment | null> {
  const deployments = await getRecentDeployments(cfg, projectId, 10);
  return deployments.find(d => d.state === 'ERROR') ?? null;
}

export function isVercelConfigured(cfg?: Pick<VercelConfig, 'token'> | null): boolean {
  return Boolean(cfg?.token);
}
