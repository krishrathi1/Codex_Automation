/**
 * Mutual Fund Co-Pilot — Continuous Production Monitor
 *
 * Polls Vercel deployments and GitHub Actions for failures, ingests them
 * into the Nexus production error pipeline, and triggers redeployment after
 * each successful fix commit.
 *
 * Environment variables:
 *   VERCEL_TOKEN              — Vercel personal access token
 *   VERCEL_PROJECT_ID         — Vercel project ID (preferred)
 *   VERCEL_PROJECT_NAME       — Fallback if project ID unknown (default: mutual-fund)
 *   VERCEL_TEAM_ID            — Vercel team ID (optional, for team accounts)
 *   GITHUB_TOKEN              — GitHub personal access token
 *   GITHUB_REPO               — owner/repo (default: krishrathi1/Mutual-Fund-Co-Pilot-)
 *   GITHUB_BRANCH             — Branch to monitor (default: main)
 *   MUTUAL_FUND_WORKSPACE     — Absolute path to local clone of the repo
 *   MUTUAL_FUND_ORG_ID        — Nexus organization ID to use for this monitor
 *   MUTUAL_FUND_BOARD_ID      — (optional) Pin errors to a specific board
 *   MUTUAL_FUND_MONITOR_INTERVAL_MS — Poll interval in ms (default: 300000 = 5 min)
 *   MUTUAL_FUND_MONITOR_DISABLED    — Set to 'true' to disable
 */

import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { ingestProductionErrorEvent } from './production-error-pipeline.service.js';
import * as vercel from './vercel-api.service.js';
import * as github from './github-api.service.js';
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

async function resolveVercelProjectId(): Promise<string | null> {
  if (!vercel.isVercelConfigured()) return null;
  try {
    if (!state.vercelProjectId) {
      state.vercelProjectId = await vercel.resolveProjectId();
    }
    return state.vercelProjectId;
  } catch (err) {
    logger.warn({ err }, '[mutual-fund-monitor] Could not resolve Vercel project ID');
    return null;
  }
}

function buildCommitAgentExtra(workspace: string): string {
  const repo = process.env.GITHUB_REPO || 'krishrathi1/Mutual-Fund-Co-Pilot-';
  const branch = process.env.GITHUB_BRANCH || 'main';
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
    'If git push fails due to auth, use HTTPS with the GITHUB_TOKEN:',
    `  git remote set-url origin https://${process.env.GITHUB_TOKEN || '$GITHUB_TOKEN'}@github.com/${repo}.git`,
    '--- END DEPLOY INSTRUCTIONS ---',
  ].join('\n');
}

async function checkVercelErrors(orgId: string, projectId: string): Promise<number> {
  let found = 0;

  let errorDeploy: vercel.VercelDeployment | null = null;
  try {
    errorDeploy = await vercel.getLatestErrorDeployment(projectId);
  } catch (err) {
    logger.warn({ err }, '[mutual-fund-monitor] Vercel deployment check failed');
    return 0;
  }

  if (!errorDeploy) return 0;

  const deployUrl = `https://${errorDeploy.url}`;
  const buildLogs = await vercel.getDeploymentBuildLogs(errorDeploy.uid).catch(() => '');
  const errorLogs = await vercel.getDeploymentErrorLogs(errorDeploy.uid).catch(() => '');

  const combinedLogs = [buildLogs, errorLogs].filter(Boolean).join('\n').trim();
  if (!combinedLogs) {
    logger.info({ deploymentId: errorDeploy.uid }, '[mutual-fund-monitor] Vercel ERROR deployment has no extractable logs, skipping');
    return 0;
  }

  const workspace = process.env.MUTUAL_FUND_WORKSPACE || '';
  const commitExtra = workspace ? buildCommitAgentExtra(workspace) : '';

  try {
    await ingestProductionErrorEvent(orgId, {
      boardId: process.env.MUTUAL_FUND_BOARD_ID,
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
        repo: process.env.GITHUB_REPO || 'krishrathi1/Mutual-Fund-Co-Pilot-',
        branch: process.env.GITHUB_BRANCH || 'main',
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

async function checkGitHubFailures(orgId: string): Promise<number> {
  if (!github.isGitHubConfigured()) return 0;

  let runs: github.GitHubWorkflowRun[] = [];
  try {
    runs = await github.getFailedWorkflowRuns(5);
  } catch (err) {
    logger.warn({ err }, '[mutual-fund-monitor] GitHub workflow check failed');
    return 0;
  }

  let found = 0;
  const workspace = process.env.MUTUAL_FUND_WORKSPACE || '';
  const commitExtra = workspace ? buildCommitAgentExtra(workspace) : '';

  for (const run of runs) {
    // Only ingest runs from the last 24 hours
    const runAge = Date.now() - new Date(run.created_at).getTime();
    if (runAge > 24 * 60 * 60 * 1000) continue;

    const description = await github.buildWorkflowErrorDescription(run).catch(() => `Workflow "${run.name}" failed`);

    try {
      await ingestProductionErrorEvent(orgId, {
        boardId: process.env.MUTUAL_FUND_BOARD_ID,
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
          repo: process.env.GITHUB_REPO || 'krishrathi1/Mutual-Fund-Co-Pilot-',
          branch: process.env.GITHUB_BRANCH || 'main',
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

  let errorsThisCheck = 0;

  // Check Vercel
  const projectId = await resolveVercelProjectId();
  if (projectId) {
    const vercelErrors = await checkVercelErrors(orgId, projectId).catch(err => {
      logger.error({ err }, '[mutual-fund-monitor] Vercel check threw');
      return 0;
    });
    errorsThisCheck += vercelErrors;
  } else if (!vercel.isVercelConfigured()) {
    logger.debug('[mutual-fund-monitor] Vercel not configured, skipping Vercel check');
  }

  // Check GitHub
  const githubErrors = await checkGitHubFailures(orgId).catch(err => {
    logger.error({ err }, '[mutual-fund-monitor] GitHub check threw');
    return 0;
  });
  errorsThisCheck += githubErrors;

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

  if (!vercel.isVercelConfigured() && !github.isGitHubConfigured()) {
    logger.info('[mutual-fund-monitor] Neither VERCEL_TOKEN nor GITHUB_TOKEN+GITHUB_REPO configured — monitor inactive');
    return;
  }

  ioRef = io;
  const intervalMs = Number(process.env.MUTUAL_FUND_MONITOR_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  state.running = true;

  logger.info({ intervalMs, vercel: vercel.isVercelConfigured(), github: github.isGitHubConfigured() },
    '[mutual-fund-monitor] Starting Mutual Fund Co-Pilot production monitor');

  // Run immediately on start, then on schedule
  void runCheck();
  state.timer = setInterval(() => void runCheck(), intervalMs);
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
  const projectId = await resolveVercelProjectId();
  if (!projectId) throw new Error('Vercel not configured or project ID unavailable');

  const deployments = await vercel.getRecentDeployments(projectId, 3);
  const latest = deployments[0];
  if (!latest) throw new Error('No deployments found for this project');

  const newDeployId = await vercel.triggerRedeploy(projectId, latest.uid);
  return { deploymentId: newDeployId };
}
