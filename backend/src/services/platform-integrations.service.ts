import { decryptField, encryptField } from '../lib/crypto.js';
import { prisma } from '../lib/prisma.js';

type JsonRecord = Record<string, unknown>;

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

function normalizeAccessToken(provider: 'GitHub' | 'Vercel', value: string | null | undefined) {
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

function tokenFromSettings(providerSettings: JsonRecord, provider: 'GitHub' | 'Vercel') {
  const encrypted = stringValue(providerSettings.accessToken);
  if (!encrypted) return undefined;
  return normalizeAccessToken(provider, decryptField(encrypted));
}

function sanitizeProvider(value: unknown, options?: { includeTeamId?: boolean }) {
  const provider = objectRecord(value);
  const token = stringValue(provider.accessToken);
  const sanitized = {
    configured: Boolean(token),
    tokenMasked: stringValue(provider.tokenMasked) || (token ? '****' : null),
    updatedAt: stringValue(provider.updatedAt) || null,
  };
  return options?.includeTeamId
    ? { ...sanitized, teamId: stringValue(provider.teamId) || null }
    : sanitized;
}

function sanitizeIntegrationSettings(settings: unknown) {
  const integrations = integrationSettings(settings);
  return {
    github: sanitizeProvider(integrations.github),
    vercel: sanitizeProvider(integrations.vercel, { includeTeamId: true }),
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
      github: sanitizeProvider(integrations.github),
      vercel: sanitizeProvider(integrations.vercel, { includeTeamId: true }),
    },
  };
}

export async function updateIntegrationSettings(organizationId: string, input: {
  githubAccessToken?: string | null;
  clearGithubAccessToken?: boolean;
  vercelAccessToken?: string | null;
  clearVercelAccessToken?: boolean;
  vercelTeamId?: string | null;
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
  const githubAccessToken = normalizeAccessToken('GitHub', input.githubAccessToken);
  if (input.clearGithubAccessToken) {
    nextIntegrations.github = {};
  } else if (githubAccessToken) {
    nextIntegrations.github = {
      ...github,
      accessToken: encryptField(githubAccessToken),
      tokenMasked: maskToken(githubAccessToken),
      updatedAt: now,
    };
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

async function getProviderToken(organizationId: string, provider: 'github' | 'vercel') {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });
  const providerSettings = objectRecord(integrationSettings(org?.settings)[provider]);
  const token = tokenFromSettings(providerSettings, provider === 'github' ? 'GitHub' : 'Vercel');
  return {
    token,
    settings: providerSettings,
  };
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

export async function listVercelProjects(organizationId: string): Promise<VercelProjectSummary[]> {
  const { token, settings } = await getProviderToken(organizationId, 'vercel');
  if (!token) {
    throw integrationError('Vercel access token is not configured in Settings.');
  }

  const url = new URL('https://api.vercel.com/v9/projects');
  url.searchParams.set('limit', '100');
  const teamId = stringValue(settings.teamId);
  if (teamId) url.searchParams.set('teamId', teamId);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'nexus-ai-dashboard',
    },
  });
  if (!response.ok) {
    const details = await response.text().catch(() => response.statusText);
    const error = new Error(`Vercel project fetch failed: ${response.status} ${details}`);
    (error as Error & { statusCode?: number }).statusCode = response.status === 401 ? 401 : 502;
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
