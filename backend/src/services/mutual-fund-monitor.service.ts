/**
 * Mutual Fund Co-Pilot — Continuous Production Monitor
 *
 * Polls Vercel deployments and GitHub Actions for failures, ingests them
 * into the Nexus production error pipeline, and triggers redeployment after
 * each successful fix commit.
 *
 * Credentials are read from the Settings UI (encrypted org integration
 * settings) first, falling back to environment variables. So the user can
 * configure VERCEL_TOKEN / GITHUB_TOKEN entirely in the UI without editing .env.
 *
 * Environment variables (optional fallbacks / extra config):
 *   VERCEL_PROJECT_ID / VERCEL_PROJECT_NAME — which Vercel project to watch
 *   GITHUB_REPO / GITHUB_BRANCH             — which repo/branch to watch
 *   MUTUAL_FUND_WORKSPACE                   — local clone the agents edit & push
 *   MUTUAL_FUND_ORG_ID / MUTUAL_FUND_BOARD_ID — pin org/board
 *   MUTUAL_FUND_MONITOR_INTERVAL_MS         — poll interval (default 300000)
 *   MUTUAL_FUND_MONITOR_DISABLED            — 'true' to disable
 */

import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { ingestProductionErrorEvent } from './production-error-pipeline.service.js';
import { getMonitorIntegrationCredentials } from './platform-integrations.service.js';
import * as vercel from './vercel-api.service.js';
import * as github from './github-api.service.js';
import * as signoz from './signoz-api.service.js';
import type { Server as SocketIOServer } from 'socket.io';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

interface MonitorState {
  running: boolean;
  timer: NodeJS.Timeout | null;
  lastCheckAt: Date | null;
  lastError: string | null;
  checksTotal: number;
  errorsFound: number;
  fixesTriggered: number;
  vercelProjectId: string | null;
  orgId: string | null;
  credentialsConfigured: boolean;
}

const state: MonitorState = {
  running: false,
  timer: null,
  lastCheckAt: null,
  lastError: null,
  checksTotal: 0,
  errorsFound: 0,
  fixesTriggered: 0,
  vercelProjectId: null,
  orgId: null,
  credentialsConfigured: false,
};

let ioRef: SocketIOServer | undefined;

export function getMonitorStatus() {
  return { ...state, timer: state.timer ? 'active' : null };
}

async function resolveOrgId(): Promise<string | null> {
  const envOrgId = process.env.MUTUAL_FUND_ORG_ID;
  if (envOrgId) return envOrgId;

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  return org?.id ?? null;
}

/**
 * Resolve a valid board for ingesting errors. Prefers MUTUAL_FUND_BOARD_ID when it
 * still exists, otherwise falls back to the org's first board, else undefined
 * (the pipeline then auto-creates its default automation board). This keeps a
 * stale/deleted board ID from silently dropping every detected error.
 */
async function resolveBoardId(orgId: string): Promise<string | undefined> {
  const envBoardId = process.env.MUTUAL_FUND_BOARD_ID?.trim();
  if (envBoardId) {
    const exists = await prisma.board.findFirst({ where: { id: envBoardId, organizationId: orgId }, select: { id: true } });
    if (exists) return envBoardId;
    logger.warn({ envBoardId }, '[mutual-fund-monitor] Configured MUTUAL_FUND_BOARD_ID not found; falling back to first board');
  }
  const first = await prisma.board.findFirst({ where: { organizationId: orgId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  return first?.id;
}

async function resolveVercelProjectId(cfg: vercel.VercelConfig): Promise<string | null> {
  if (!vercel.isVercelConfigured(cfg)) return null;
  try {
    if (!state.vercelProjectId) {
      state.vercelProjectId = await vercel.resolveProjectId(cfg);
    }
    return state.vercelProjectId;
  } catch (err) {
    logger.warn({ err }, '[mutual-fund-monitor] Could not resolve Vercel project ID');
    return null;
  }
}

function buildCommitAgentExtra(workspace: string, repo: string, branch: string): string {
  return [
    '',
    '--- COMMIT & DEPLOY INSTRUCTIONS ---',
    `Workspace: ${workspace}`,
    `Repo:      ${repo}`,
    `Branch:    ${branch}`,
    '',
    'After applying the fix:',
    '1. Stage all changes:  git add -A',
    '2. Commit:             git commit -m "fix: auto-fix from Nexus production monitor"',
    '3. Push to GitHub:     git push origin ' + branch,
    '',
    'The Vercel deployment is connected to GitHub and will auto-redeploy on push.',
    'If git push fails due to auth, use HTTPS with the configured GitHub token:',
    '  git remote set-url origin https://$GITHUB_TOKEN@github.com/${repo}.git',
    '--- END DEPLOY INSTRUCTIONS ---',
  ].join('\n');
}

async function checkVercelErrors(
  orgId: string,
  boardId: string | undefined,
  cfg: vercel.VercelConfig,
  githubCfg: github.GitHubConfig,
  projectId: string,
): Promise<number> {
  let found = 0;

  let errorDeploy: vercel.VercelDeployment | null = null;
  try {
    errorDeploy = await vercel.getLatestErrorDeployment(cfg, projectId);
  } catch (err) {
    logger.warn({ err }, '[mutual-fund-monitor] Vercel deployment check failed');
    return 0;
  }

  if (!errorDeploy) return 0;

  const deployUrl = `https://${errorDeploy.url}`;
  const buildLogs = await vercel.getDeploymentBuildLogs(cfg, errorDeploy.uid).catch(() => '');
  const errorLogs = await vercel.getDeploymentErrorLogs(cfg, errorDeploy.uid).catch(() => '');

  // Use detailed logs when available; otherwise fall back to deployment metadata so an
  // ERROR deployment is never silently dropped just because the events API returned nothing.
  const detailedLogs = [buildLogs, errorLogs].filter(Boolean).join('\n').trim();
  const combinedLogs = detailedLogs || [
    `Vercel deployment ${errorDeploy.uid} for project "${errorDeploy.name}" is in ERROR state.`,
    errorDeploy.errorMessage ? `Vercel error: ${errorDeploy.errorMessage}` : '',
    `Deployment URL: ${deployUrl}`,
    'No detailed build logs were available from the Vercel events API. Reproduce the build locally',
    'in the workspace (run the build script from package.json) to find and fix the failure.',
  ].filter(Boolean).join('\n');

  const workspace = process.env.MUTUAL_FUND_WORKSPACE || '';
  const repo = githubCfg.repo || 'krishrathi1/Mutual-Fund-Co-Pilot-';
  const branch = githubCfg.branch || 'main';
  const commitExtra = workspace ? buildCommitAgentExtra(workspace, repo, branch) : '';

  try {
    await ingestProductionErrorEvent(orgId, {
      boardId,
      source: 'vercel',
      severity: 'critical',
      title: `Vercel deployment failed — ${errorDeploy.name}`,
      message: `Vercel deployment ${errorDeploy.uid} entered ERROR state.\n\n${combinedLogs}`,
      stack: combinedLogs.slice(0, 2000),
      url: deployUrl,
      route: '/deployment',
      environment: 'production',
      fingerprint: `vercel-deploy-error-${errorDeploy.uid}`,
      payload: {
        deploymentId: errorDeploy.uid,
        deploymentUrl: deployUrl,
        workspace,
        repo,
        branch,
        commitInstructions: commitExtra,
      },
    }, { io: ioRef });

    found++;
    logger.info({ deploymentId: errorDeploy.uid }, '[mutual-fund-monitor] Vercel error ingested into production pipeline');
  } catch (err: unknown) {
    const msg = (err as Error).message ?? String(err);
    if (msg.includes('already exists') || msg.includes('Unique constraint')) {
      logger.debug({ deploymentId: errorDeploy.uid }, '[mutual-fund-monitor] Vercel error already in pipeline');
    } else {
      logger.error({ err }, '[mutual-fund-monitor] Failed to ingest Vercel error');
    }
  }

  return found;
}

async function checkGitHubFailures(orgId: string, boardId: string | undefined, cfg: github.GitHubConfig): Promise<number> {
  if (!github.isGitHubConfigured(cfg)) return 0;

  let runs: github.GitHubWorkflowRun[] = [];
  try {
    runs = await github.getFailedWorkflowRuns(cfg, 5);
  } catch (err) {
    logger.warn({ err }, '[mutual-fund-monitor] GitHub workflow check failed');
    return 0;
  }

  let found = 0;
  const workspace = process.env.MUTUAL_FUND_WORKSPACE || '';
  const repo = cfg.repo || 'krishrathi1/Mutual-Fund-Co-Pilot-';
  const branch = cfg.branch || 'main';
  const commitExtra = workspace ? buildCommitAgentExtra(workspace, repo, branch) : '';

  for (const run of runs) {
    // Only ingest runs from the last 24 hours
    const runAge = Date.now() - new Date(run.created_at).getTime();
    if (runAge > 24 * 60 * 60 * 1000) continue;

    const description = await github.buildWorkflowErrorDescription(cfg, run).catch(() => `Workflow "${run.name}" failed`);

    try {
      await ingestProductionErrorEvent(orgId, {
        boardId,
        source: 'github-actions',
        severity: 'high',
        title: `GitHub Actions failed — ${run.name}`,
        message: description,
        stack: description,
        url: run.html_url,
        route: '/ci',
        environment: 'ci',
        fingerprint: `github-run-${run.id}`,
        payload: {
          runId: run.id,
          runUrl: run.html_url,
          headSha: run.head_sha,
          workspace,
          repo,
          branch,
          commitInstructions: commitExtra,
        },
      }, { io: ioRef });

      found++;
      logger.info({ runId: run.id, workflow: run.name }, '[mutual-fund-monitor] GitHub failure ingested');
    } catch (err: unknown) {
      const msg = (err as Error).message ?? String(err);
      if (msg.includes('already exists') || msg.includes('Unique constraint')) {
        logger.debug({ runId: run.id }, '[mutual-fund-monitor] GitHub run already in pipeline');
      } else {
        logger.error({ err, runId: run.id }, '[mutual-fund-monitor] Failed to ingest GitHub failure');
      }
    }
  }

  return found;
}

async function checkSigNozErrors(
  orgId: string,
  boardId: string | undefined,
  cfg: signoz.SigNozConfig,
): Promise<number> {
  let logs: signoz.SigNozLog[] = [];
  try {
    logs = await signoz.queryLogs(cfg, { severities: ['ERROR', 'FATAL'], sinceMs: 15 * 60 * 1000, limit: 20 });
  } catch (err) {
    logger.warn({ err }, '[mutual-fund-monitor] SigNoz query failed');
    return 0;
  }

  let found = 0;
  for (const log of logs) {
    const service = log.serviceName ? ` — ${log.serviceName}` : '';
    const title = `Production log error${service}: ${log.body.slice(0, 120)}`;
    try {
      await ingestProductionErrorEvent(orgId, {
        boardId,
        source: 'signoz',
        severity: log.severity === 'FATAL' ? 'critical' : 'error',
        title,
        message: log.body,
        environment: 'production',
        payload: {
          signozTimestamp: log.timestamp,
          serviceName: log.serviceName,
          traceId: log.traceId,
          attributes: log.attributes,
        },
      }, { io: ioRef });
      found++;
    } catch (err) {
      // 409 = the same error is already in-flight (fingerprint dedup) — expected.
      const statusCode = (err as Error & { statusCode?: number }).statusCode;
      if (statusCode !== 409) {
        logger.error({ err }, '[mutual-fund-monitor] SigNoz error ingest failed');
      }
    }
  }
  return found;
}

async function runCheck(): Promise<void> {
  state.checksTotal++;
  state.lastCheckAt = new Date();
  state.lastError = null;

  logger.info({ check: state.checksTotal }, '[mutual-fund-monitor] Running production check');

  const orgId = state.orgId ?? await resolveOrgId();
  if (!orgId) {
    state.lastError = 'No Nexus organization found. Set MUTUAL_FUND_ORG_ID.';
    logger.warn('[mutual-fund-monitor] ' + state.lastError);
    return;
  }
  state.orgId = orgId;

  // Resolve credentials from the Settings UI (encrypted org settings), env fallback.
  // Never let a credential-resolution error crash the monitor (and the server).
  let creds;
  try {
    creds = await getMonitorIntegrationCredentials(orgId);
  } catch (err) {
    state.lastError = `Failed to resolve integration credentials: ${(err as Error).message}`;
    logger.error({ err }, '[mutual-fund-monitor] ' + state.lastError);
    return;
  }
  const vercelConfigured = vercel.isVercelConfigured(creds.vercel);
  const githubConfigured = github.isGitHubConfigured(creds.github);
  const signozConfigured = signoz.isSigNozConfigured(creds.signoz);
  state.credentialsConfigured = vercelConfigured || githubConfigured || signozConfigured;

  if (!state.credentialsConfigured) {
    state.lastError = 'No Vercel/GitHub/SigNoz credentials configured. Add them in Settings → Integrations.';
    logger.info('[mutual-fund-monitor] ' + state.lastError);
    return;
  }

  const boardId = await resolveBoardId(orgId);

  let errorsThisCheck = 0;

  // Check Vercel
  if (vercelConfigured) {
    const projectId = await resolveVercelProjectId(creds.vercel);
    if (projectId) {
      const vercelErrors = await checkVercelErrors(orgId, boardId, creds.vercel, creds.github, projectId).catch(err => {
        logger.error({ err }, '[mutual-fund-monitor] Vercel check threw');
        return 0;
      });
      errorsThisCheck += vercelErrors;
    }
  }

  // Check GitHub
  if (githubConfigured) {
    const githubErrors = await checkGitHubFailures(orgId, boardId, creds.github).catch(err => {
      logger.error({ err }, '[mutual-fund-monitor] GitHub check threw');
      return 0;
    });
    errorsThisCheck += githubErrors;
  }

  // Check SigNoz production logs
  if (signozConfigured) {
    const signozErrors = await checkSigNozErrors(orgId, boardId, creds.signoz).catch(err => {
      logger.error({ err }, '[mutual-fund-monitor] SigNoz check threw');
      return 0;
    });
    errorsThisCheck += signozErrors;
  }

  if (errorsThisCheck > 0) {
    state.errorsFound += errorsThisCheck;
    state.fixesTriggered += errorsThisCheck;
    logger.info({ errorsThisCheck }, '[mutual-fund-monitor] Errors queued for auto-fix');
  } else {
    logger.info('[mutual-fund-monitor] No new errors found');
  }
}

export function startMutualFundMonitor(io?: SocketIOServer): void {
  if (process.env.MUTUAL_FUND_MONITOR_DISABLED === 'true') {
    logger.info('[mutual-fund-monitor] Disabled via MUTUAL_FUND_MONITOR_DISABLED=true');
    return;
  }

  if (state.running) {
    logger.warn('[mutual-fund-monitor] Already running, ignoring duplicate start');
    return;
  }

  ioRef = io;
  const intervalMs = Number(process.env.MUTUAL_FUND_MONITOR_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  state.running = true;

  // Always start the loop. Credentials are resolved per-check from the Settings
  // UI, so the monitor activates the moment the user saves tokens — no restart.
  logger.info({ intervalMs }, '[mutual-fund-monitor] Starting Mutual Fund Co-Pilot production monitor (credentials resolved per-check from Settings)');

  const safeRunCheck = () => runCheck().catch(err => {
    state.lastError = (err as Error).message;
    logger.error({ err }, '[mutual-fund-monitor] runCheck failed (monitor stays alive)');
  });
  void safeRunCheck();
  state.timer = setInterval(() => void safeRunCheck(), intervalMs);
}

export function stopMutualFundMonitor(): void {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  state.running = false;
  logger.info('[mutual-fund-monitor] Stopped');
}

export async function triggerManualCheck(): Promise<{ errorsFound: number }> {
  const before = state.errorsFound;
  await runCheck();
  return { errorsFound: state.errorsFound - before };
}

export async function triggerVercelRedeploy(): Promise<{ deploymentId: string }> {
  const orgId = state.orgId ?? await resolveOrgId();
  if (!orgId) throw new Error('No Nexus organization found');
  const creds = await getMonitorIntegrationCredentials(orgId);
  if (!vercel.isVercelConfigured(creds.vercel)) {
    throw new Error('Vercel token not configured. Add it in Settings → Integrations.');
  }

  const projectId = await resolveVercelProjectId(creds.vercel);
  if (!projectId) throw new Error('Vercel project ID unavailable');

  const deployments = await vercel.getRecentDeployments(creds.vercel, projectId, 3);
  const latest = deployments[0];
  if (!latest) throw new Error('No deployments found for this project');

  const newDeployId = await vercel.triggerRedeploy(creds.vercel, projectId, latest.uid);
  return { deploymentId: newDeployId };
}
