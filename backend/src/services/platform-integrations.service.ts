import { decryptField, encryptField } from '../lib/crypto.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { queryLogs, checkSigNozConnection, type QueryLogsOptions, type SigNozLog } from './signoz-api.service.js';

type JsonRecord = Record<string, unknown>;

export type BitbucketRepositorySummary = {
  uuid: string;
  name: string;
  fullName: string;
  isPrivate: boolean;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  defaultBranch: string;
  ownerUsername: string;
  updatedAt: string | null;
};

export type GithubRepositorySummary = {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  defaultBranch: string;
  ownerLogin: string;
  updatedAt: string | null;
};

export type VercelProjectSummary = {
  id: string;
  name: string;
  framework: string | null;
  accountId: string | null;
  repo: string | null;
  productionUrl: string | null;
  updatedAt: string | null;
};

function objectRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function maskToken(token: string | undefined) {
  if (!token) return null;
  if (token.length <= 10) return '****';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function integrationError(message: string, statusCode = 400) {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = statusCode;
  return error;
}

function looksMaskedToken(token: string) {
  return token.includes('...') || token.includes('…') || token.includes('*');
}

function normalizeAccessToken(provider: 'GitHub' | 'Vercel' | 'SigNoz' | 'Bitbucket', value: string | null | undefined) {
  const token = value?.trim();
  if (!token) return undefined;
  if (looksMaskedToken(token)) {
    throw integrationError(
      `${provider} access token looks like a masked or shortened value. Paste the raw token from ${provider}, not the display text.`
    );
  }
  if (!/^[\x21-\x7E]+$/.test(token)) {
    throw integrationError(`${provider} access token contains unsupported characters. Paste the raw token only.`);
  }
  return token;
}

function integrationSettings(settings: unknown) {
  return objectRecord(objectRecord(settings).integrations);
}

async function readErrorText(response: Response) {
  return response.text().catch(() => response.statusText);
}

function tokenFromSettings(providerSettings: JsonRecord, provider: 'GitHub' | 'Vercel' | 'SigNoz' | 'Bitbucket') {
  const encrypted = stringValue(providerSettings.accessToken);
  if (!encrypted) return undefined;
  // A token saved under a different/old ENCRYPTION_KEY (or legacy format) can't be
  // decrypted. Treat it as "not configured" instead of throwing — a thrown error here
  // would crash callers like the background monitor. The user can re-save in Settings.
  try {
    return normalizeAccessToken(provider, decryptField(encrypted));
  } catch (err) {
    logger.warn({ provider, err: (err as Error).message }, 'Could not read stored access token; treating as not configured. Re-save it in Settings.');
    return undefined;
  }
}

function sanitizeProvider(value: unknown, options?: { includeTeamId?: boolean; includeRepo?: boolean; includeEndpoint?: boolean; includeUsername?: boolean }) {
  const provider = objectRecord(value);
  const token = stringValue(provider.accessToken);
  const endpoint = stringValue(provider.endpoint) || null;
  const configured = options?.includeEndpoint ? Boolean(token && endpoint) : Boolean(token);
  const sanitized: JsonRecord = {
    configured,
    tokenMasked: stringValue(provider.tokenMasked) || (token ? '****' : null),
    updatedAt: stringValue(provider.updatedAt) || null,
  };
  if (options?.includeTeamId) {
    sanitized.teamId = stringValue(provider.teamId) || null;
  }
  if (options?.includeRepo) {
    sanitized.repo = stringValue(provider.repo) || null;
    sanitized.branch = stringValue(provider.branch) || null;
  }
  if (options?.includeEndpoint) {
    sanitized.endpoint = endpoint;
  }
  if (options?.includeUsername) {
    sanitized.username = stringValue(provider.username) || null;
    sanitized.workspace = stringValue(provider.workspace) || null;
  }
  return sanitized;
}

function sanitizeIntegrationSettings(settings: unknown) {
  const integrations = integrationSettings(settings);
  return {
    github: sanitizeProvider(integrations.github),
    vercel: sanitizeProvider(integrations.vercel, { includeTeamId: true }),
    signoz: sanitizeProvider(integrations.signoz, { includeEndpoint: true }),
    bitbucket: sanitizeProvider(integrations.bitbucket, { includeUsername: true }),
  };
}

export async function getIntegrationSettings(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });
  return sanitizeIntegrationSettings(org?.settings);
}

export function sanitizeOrganizationSettings(settings: unknown) {
  const root = objectRecord(settings);
  const integrations = integrationSettings(root);
  return {
    ...root,
    integrations: {
      ...integrations,
      signoz: sanitizeProvider(integrations.signoz, { includeEndpoint: true }),
      github: sanitizeProvider(integrations.github),
      vercel: sanitizeProvider(integrations.vercel, { includeTeamId: true }),
      bitbucket: sanitizeProvider(integrations.bitbucket, { includeUsername: true }),
    },
  };
}

export async function updateIntegrationSettings(organizationId: string, input: {
  githubAccessToken?: string | null;
  clearGithubAccessToken?: boolean;
  vercelAccessToken?: string | null;
  clearVercelAccessToken?: boolean;
  vercelTeamId?: string | null;
  signozApiKey?: string | null;
  clearSignozApiKey?: boolean;
  signozEndpoint?: string | null;
  bitbucketAppPassword?: string | null;
  clearBitbucketAppPassword?: boolean;
  bitbucketUsername?: string | null;
  bitbucketWorkspace?: string | null;
}) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });
  const settings = objectRecord(org?.settings);
  const integrations = integrationSettings(settings);
  const nextIntegrations: JsonRecord = { ...integrations };
  const now = new Date().toISOString();

  const github = objectRecord(integrations.github);
  const nextGithub: JsonRecord = { ...github };
  const githubAccessToken = normalizeAccessToken('GitHub', input.githubAccessToken);
  if (input.clearGithubAccessToken) {
    delete nextGithub.accessToken;
    delete nextGithub.tokenMasked;
  } else if (githubAccessToken) {
    nextGithub.accessToken = encryptField(githubAccessToken);
    nextGithub.tokenMasked = maskToken(githubAccessToken);
  }
  if (Object.keys(nextGithub).length > 0) {
    nextGithub.updatedAt = now;
    nextIntegrations.github = nextGithub;
  } else {
    nextIntegrations.github = {};
  }

  const vercel = objectRecord(integrations.vercel);
  const nextVercel: JsonRecord = { ...vercel };
  const vercelAccessToken = normalizeAccessToken('Vercel', input.vercelAccessToken);
  if (input.clearVercelAccessToken) {
    delete nextVercel.accessToken;
    delete nextVercel.tokenMasked;
  } else if (vercelAccessToken) {
    nextVercel.accessToken = encryptField(vercelAccessToken);
    nextVercel.tokenMasked = maskToken(vercelAccessToken);
  }
  if (input.vercelTeamId !== undefined) {
    if (input.vercelTeamId?.trim()) {
      nextVercel.teamId = input.vercelTeamId.trim();
    } else {
      delete nextVercel.teamId;
    }
  }
  if (Object.keys(nextVercel).length > 0) {
    nextVercel.updatedAt = now;
    nextIntegrations.vercel = nextVercel;
  } else {
    nextIntegrations.vercel = {};
  }

  const signoz = objectRecord(integrations.signoz);
  const nextSignoz: JsonRecord = { ...signoz };
  const signozApiKey = normalizeAccessToken('SigNoz', input.signozApiKey);
  if (input.clearSignozApiKey) {
    delete nextSignoz.accessToken;
    delete nextSignoz.tokenMasked;
  } else if (signozApiKey) {
    nextSignoz.accessToken = encryptField(signozApiKey);
    nextSignoz.tokenMasked = maskToken(signozApiKey);
  }
  if (input.signozEndpoint !== undefined) {
    const endpoint = input.signozEndpoint?.trim();
    if (endpoint) nextSignoz.endpoint = endpoint;
    else delete nextSignoz.endpoint;
  }
  if (Object.keys(nextSignoz).length > 0) {
    nextSignoz.updatedAt = now;
    nextIntegrations.signoz = nextSignoz;
  } else {
    nextIntegrations.signoz = {};
  }

  const bitbucket = objectRecord(integrations.bitbucket);
  const nextBitbucket: JsonRecord = { ...bitbucket };
  const bitbucketAppPassword = normalizeAccessToken('Bitbucket', input.bitbucketAppPassword);
  if (input.clearBitbucketAppPassword) {
    delete nextBitbucket.accessToken;
    delete nextBitbucket.tokenMasked;
  } else if (bitbucketAppPassword) {
    nextBitbucket.accessToken = encryptField(bitbucketAppPassword);
    nextBitbucket.tokenMasked = maskToken(bitbucketAppPassword);
  }
  if (input.bitbucketUsername !== undefined) {
    const username = input.bitbucketUsername?.trim();
    if (username) nextBitbucket.username = username;
    else delete nextBitbucket.username;
  }
  if (input.bitbucketWorkspace !== undefined) {
    const workspace = input.bitbucketWorkspace?.trim();
    if (workspace) nextBitbucket.workspace = workspace;
    else delete nextBitbucket.workspace;
  }
  if (Object.keys(nextBitbucket).length > 0) {
    nextBitbucket.updatedAt = now;
    nextIntegrations.bitbucket = nextBitbucket;
  } else {
    nextIntegrations.bitbucket = {};
  }

  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data: {
      settings: {
        ...settings,
        integrations: nextIntegrations,
      } as any,
    },
  });

  return sanitizeIntegrationSettings(updated.settings);
}

async function getProviderToken(organizationId: string, provider: 'github' | 'vercel' | 'signoz' | 'bitbucket') {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });
  const providerSettings = objectRecord(integrationSettings(org?.settings)[provider]);
  const providerLabel = provider === 'github' ? 'GitHub' : provider === 'vercel' ? 'Vercel' : provider === 'bitbucket' ? 'Bitbucket' : 'SigNoz';
  const token = tokenFromSettings(providerSettings, providerLabel);
  return {
    token,
    settings: providerSettings,
  };
}

/**
 * Resolve the GitHub + Vercel credentials for a monitor/automation run.
 * Prefers the tokens saved in the Settings UI (encrypted org settings),
 * and falls back to environment variables when a UI token is not set.
 */
export async function getMonitorIntegrationCredentials(organizationId: string) {
  const [github, vercel, signoz, bitbucket] = await Promise.all([
    getProviderToken(organizationId, 'github'),
    getProviderToken(organizationId, 'vercel'),
    getProviderToken(organizationId, 'signoz'),
    getProviderToken(organizationId, 'bitbucket'),
  ]);

  return {
    signoz: {
      endpoint: stringValue(signoz.settings.endpoint) || process.env.SIGNOZ_ENDPOINT || '',
      apiKey: signoz.token || process.env.SIGNOZ_API_KEY || '',
    },
    github: {
      token: github.token || process.env.GITHUB_TOKEN || '',
      repo: stringValue(github.settings.repo) || process.env.GITHUB_REPO || null,
      branch: stringValue(github.settings.branch) || process.env.GITHUB_BRANCH || 'main',
    },
    vercel: {
      token: vercel.token || process.env.VERCEL_TOKEN || '',
      teamId: stringValue(vercel.settings.teamId) || process.env.VERCEL_TEAM_ID || null,
      projectId: process.env.VERCEL_PROJECT_ID || null,
      projectName: process.env.VERCEL_PROJECT_NAME || 'mutual-fund',
    },
    bitbucket: {
      username: stringValue(bitbucket.settings.username) || process.env.BITBUCKET_USERNAME || '',
      token: bitbucket.token || process.env.BITBUCKET_APP_PASSWORD || '',
    },
  };
}

export async function getBoardGithubScope(boardId: string | null): Promise<{ repo: string | null; branch: string }> {
  if (!boardId) return { repo: null, branch: 'main' };
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { successMetrics: true },
  });
  const metrics = objectRecord(board?.successMetrics);
  const scope = objectRecord(metrics.integrationScope);
  const githubRepo = objectRecord(scope.githubRepo);
  return {
    repo: stringValue(githubRepo.fullName) || null,
    branch: stringValue(githubRepo.branch) || 'main',
  };
}

export async function getBoardBitbucketScope(boardId: string | null): Promise<{ repo: string | null; branch: string }> {
  if (!boardId) return { repo: null, branch: 'main' };
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { successMetrics: true },
  });
  const metrics = objectRecord(board?.successMetrics);
  const scope = objectRecord(metrics.integrationScope);
  const bitbucketRepo = objectRecord(scope.bitbucketRepo);
  return {
    repo: stringValue(bitbucketRepo.fullName) || null,
    branch: stringValue(bitbucketRepo.branch) || 'main',
  };
}

/** Which provider a board pushes fixes to. Defaults to 'github'. */
export async function getBoardPrimaryProvider(boardId: string | null): Promise<'github' | 'bitbucket'> {
  if (!boardId) return 'github';
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { successMetrics: true },
  });
  const metrics = objectRecord(board?.successMetrics);
  const scope = objectRecord(metrics.integrationScope);
  return stringValue(scope.primaryProvider) === 'bitbucket' ? 'bitbucket' : 'github';
}

export async function checkSignozConnection(organizationId: string): Promise<{ ok: boolean; detail: string }> {
  const creds = await getMonitorIntegrationCredentials(organizationId);
  return checkSigNozConnection(creds.signoz);
}

export async function getSignozLogs(organizationId: string, opts: QueryLogsOptions): Promise<SigNozLog[]> {
  const creds = await getMonitorIntegrationCredentials(organizationId);
  if (!creds.signoz.endpoint || !creds.signoz.apiKey) {
    throw integrationError('SigNoz endpoint and API key are not configured in Settings.');
  }
  return queryLogs(creds.signoz, opts);
}

/** Distinct service.name values seen in recent logs — for the service picker. */
export async function getSignozServices(organizationId: string): Promise<string[]> {
  const logs = await getSignozLogs(organizationId, { sinceMs: 24 * 60 * 60 * 1000, limit: 1000 });
  const set = new Set<string>();
  for (const l of logs) {
    if (l.serviceName) set.add(l.serviceName);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Resolve the per-board SigNoz service name from its integrationScope. */
export async function getBoardSignozService(organizationId: string, boardId: string): Promise<string | null> {
  const board = await prisma.board.findFirst({
    where: { id: boardId, organizationId },
    select: { successMetrics: true },
  });
  const metrics = objectRecord(board?.successMetrics);
  const scope = objectRecord(metrics.integrationScope);
  return stringValue(scope.signozService) || null;
}

/** Live SigNoz logs scoped to a production group's service.name. */
export async function getBoardSignozLogs(
  organizationId: string,
  boardId: string,
  opts: QueryLogsOptions,
): Promise<SigNozLog[]> {
  const service = await getBoardSignozService(organizationId, boardId);
  return getSignozLogs(organizationId, { ...opts, service: service || undefined });
}

export async function listGithubRepositories(organizationId: string): Promise<GithubRepositorySummary[]> {
  const { token } = await getProviderToken(organizationId, 'github');
  if (!token) {
    throw integrationError('GitHub access token is not configured in Settings.');
  }

  const repos: GithubRepositorySummary[] = [];
  let page = 1;
  while (page <= 3) {
    const url = new URL('https://api.github.com/user/repos');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('affiliation', 'owner,collaborator,organization_member');

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'nexus-ai-dashboard',
      },
    });
    if (!response.ok) {
      const details = await response.text().catch(() => response.statusText);
      const error = new Error(`GitHub repository fetch failed: ${response.status} ${details}`);
      (error as Error & { statusCode?: number }).statusCode = response.status === 401 ? 401 : 502;
      throw error;
    }

    const batch = await response.json() as Array<Record<string, unknown>>;
    repos.push(...batch.map(repo => {
      const owner = objectRecord(repo.owner);
      return {
        id: Number(repo.id),
        name: stringValue(repo.name) || '',
        fullName: stringValue(repo.full_name) || '',
        private: Boolean(repo.private),
        htmlUrl: stringValue(repo.html_url) || '',
        cloneUrl: stringValue(repo.clone_url) || '',
        sshUrl: stringValue(repo.ssh_url) || '',
        defaultBranch: stringValue(repo.default_branch) || 'main',
        ownerLogin: stringValue(owner.login) || '',
        updatedAt: stringValue(repo.updated_at) || null,
      };
    }).filter(repo => repo.fullName));

    if (batch.length < 100) break;
    page += 1;
  }

  return repos;
}

/** Best-effort discovery of the workspaces an authenticated user belongs to. */
async function discoverBitbucketWorkspaces(authHeaders: Record<string, string>): Promise<string[]> {
  try {
    const res = await fetch('https://api.bitbucket.org/2.0/workspaces?pagelen=50', { headers: authHeaders });
    if (!res.ok) return [];
    const data = await res.json() as Record<string, unknown>;
    const values = Array.isArray(data.values) ? data.values as Array<Record<string, unknown>> : [];
    return values.map(w => stringValue(w.slug)).filter((s): s is string => Boolean(s));
  } catch {
    return [];
  }
}

export async function listBitbucketRepositories(organizationId: string): Promise<BitbucketRepositorySummary[]> {
  const { token, settings } = await getProviderToken(organizationId, 'bitbucket');
  const username = stringValue(settings.username);
  if (!token || !username) {
    throw integrationError('Bitbucket identity (username or email) and app password / API token are not configured in Settings.');
  }

  // Auth identity is whatever the user stored: a Bitbucket username (legacy app
  // passwords) or an Atlassian account email (scoped API tokens).
  const basicAuth = Buffer.from(`${username}:${token}`).toString('base64');
  const authHeaders = {
    Authorization: `Basic ${basicAuth}`,
    Accept: 'application/json',
    'User-Agent': 'nexus-ai-dashboard',
  };

  // Atlassian deprecated the global /2.0/repositories endpoint (CHANGE-2770), so
  // we must scope the listing to a workspace. Prefer the workspace saved in
  // Settings; otherwise try to auto-discover the user's workspaces.
  const configuredWorkspace = stringValue(settings.workspace);
  const workspaces = configuredWorkspace
    ? [configuredWorkspace]
    : await discoverBitbucketWorkspaces(authHeaders);
  if (workspaces.length === 0) {
    throw integrationError(
      'Set your Bitbucket workspace in Settings — it is the part after bitbucket.org/ in your repo URL (e.g. bitbucket.org/<workspace>/<repo>). Auto-discovery failed with the current token scopes.',
    );
  }

  const repos: BitbucketRepositorySummary[] = [];
  for (const ws of workspaces) {
    let nextUrl: string | null = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(ws)}?pagelen=50&sort=-updated_on`;
    while (nextUrl && repos.length < 150) {
      const response = await fetch(nextUrl, { headers: authHeaders });
      if (!response.ok) {
        const details = await response.text().catch(() => response.statusText);
        const error = new Error(`Bitbucket repository fetch failed: ${response.status} ${details}`);
        (error as Error & { statusCode?: number }).statusCode = response.status === 401 || response.status === 403 ? response.status : 502;
        throw error;
      }

      const data = await response.json() as Record<string, unknown>;
      const values = Array.isArray(data.values) ? data.values as Array<Record<string, unknown>> : [];

      repos.push(...values.map(repo => {
        const owner = objectRecord(objectRecord(repo.owner));
        const links = objectRecord(repo.links);
        const cloneLinks = Array.isArray(links.clone) ? links.clone as Array<Record<string, unknown>> : [];
        const httpsClone = cloneLinks.find(l => stringValue(l.name) === 'https');
        const sshClone = cloneLinks.find(l => stringValue(l.name) === 'ssh');
        const htmlLink = objectRecord(links.html);
        const mainbranch = objectRecord(repo.mainbranch);
        return {
          uuid: stringValue(repo.uuid) || '',
          name: stringValue(repo.name) || '',
          fullName: stringValue(repo.full_name) || '',
          isPrivate: Boolean(repo.is_private),
          htmlUrl: stringValue(htmlLink.href) || '',
          cloneUrl: stringValue(httpsClone?.href) || '',
          sshUrl: stringValue(sshClone?.href) || '',
          defaultBranch: stringValue(mainbranch.name) || 'main',
          ownerUsername: stringValue(owner.nickname) || stringValue(owner.display_name) || ws,
          updatedAt: stringValue(repo.updated_on) || null,
        };
      }).filter(r => r.fullName));

      nextUrl = typeof data.next === 'string' ? data.next : null;
    }
  }

  return repos;
}

export async function listVercelProjects(organizationId: string): Promise<VercelProjectSummary[]> {
  const { token, settings } = await getProviderToken(organizationId, 'vercel');
  if (!token) {
    throw integrationError('Vercel access token is not configured in Settings.');
  }

  async function fetchProjects(requestedTeamId?: string | null) {
    const url = new URL('https://api.vercel.com/v9/projects');
    url.searchParams.set('limit', '100');
    if (requestedTeamId) url.searchParams.set('teamId', requestedTeamId);

    return fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'nexus-ai-dashboard',
      },
    });
  }

  const teamId = stringValue(settings.teamId);
  let response = await fetchProjects(teamId);
  let details = response.ok ? '' : await readErrorText(response);

  // If the stored team scope is invalid for this token, fall back to the token's default scope
  // so Nexus can still list accessible projects instead of hard failing the integration.
  if (!response.ok && teamId && response.status === 403 && /not authorized/i.test(details)) {
    response = await fetchProjects();
    details = response.ok ? '' : await readErrorText(response);
  }

  if (!response.ok) {
    const error = new Error(`Vercel project fetch failed: ${response.status} ${details}`);
    (error as Error & { statusCode?: number }).statusCode = response.status === 401 || response.status === 403 ? response.status : 502;
    throw error;
  }

  const data = await response.json() as Record<string, unknown>;
  const projects = Array.isArray(data.projects) ? data.projects as Array<Record<string, unknown>> : [];
  return projects.map(project => {
    const link = objectRecord(project.link);
    const targets = objectRecord(project.targets);
    const production = objectRecord(targets.production);
    const aliases = Array.isArray(production.alias) ? production.alias : [];
    const repoName = [stringValue(link.org), stringValue(link.repo)].filter(Boolean).join('/');
    return {
      id: stringValue(project.id) || stringValue(project.name) || '',
      name: stringValue(project.name) || '',
      framework: stringValue(project.framework) || null,
      accountId: stringValue(project.accountId) || null,
      repo: repoName || null,
      productionUrl: stringValue(aliases[0]) || null,
      updatedAt: typeof project.updatedAt === 'number'
        ? new Date(project.updatedAt).toISOString()
        : stringValue(project.updatedAt) || null,
    };
  }).filter(project => project.id && project.name);
}
