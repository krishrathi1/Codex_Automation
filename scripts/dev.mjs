#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const backendHealthUrl = process.env.BACKEND_HEALTH_URL || 'http://127.0.0.1:4000/api/health';
const startupTimeoutMs = Number(process.env.BACKEND_STARTUP_TIMEOUT_MS || 30_000);
const defaultCodexCliPath = '/Applications/Codex.app/Contents/Resources/codex';

function isExecutableFile(filePath) {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return false;
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCodexCliPathForDev() {
  const configured = process.env.CODEX_CLI_PATH?.trim();
  if (!configured) return defaultCodexCliPath;
  if (isExecutableFile(configured)) return configured;
  if (isExecutableFile(defaultCodexCliPath)) {
    console.warn(
      `[dev] Ignoring invalid CODEX_CLI_PATH="${configured}". ` +
      `Using ${defaultCodexCliPath}.`
    );
    return defaultCodexCliPath;
  }
  return configured;
}

const env = {
  ...process.env,
  AGENT_RUNTIME: process.env.AGENT_RUNTIME || 'codex-cli',
  CODEX_CLI_PATH: resolveCodexCliPathForDev(),
  CODEX_SANDBOX: process.env.CODEX_SANDBOX || 'workspace-write',
  CODEX_SKIP_GIT_REPO_CHECK: process.env.CODEX_SKIP_GIT_REPO_CHECK || 'true',
};

const children = new Set();
let shuttingDown = false;

function spawnWorkspace(label, workspace) {
  const child = spawn('npm', ['run', 'dev', '-w', workspace], {
    cwd: rootDir,
    env,
    stdio: 'inherit',
  });

  children.add(child);
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown && code !== 0) {
      console.error(`[${label}] exited with ${signal || code}`);
      shutdown(code || 1);
    }
  });

  return child;
}

async function isBackendHealthy() {
  try {
    const response = await fetch(backendHealthUrl);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForBackend(child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (await isBackendHealthy()) return;
    if (child.exitCode !== null) {
      throw new Error('Backend process exited before becoming healthy.');
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Backend did not become healthy at ${backendHealthUrl} within ${startupTimeoutMs}ms.`);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    child.kill('SIGINT');
  }
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (await isBackendHealthy()) {
  console.log(`[dev] Backend already healthy at ${backendHealthUrl}; starting frontend.`);
  spawnWorkspace('frontend', 'frontend');
} else {
  console.log('[dev] Starting backend...');
  const backend = spawnWorkspace('backend', 'backend');
  await waitForBackend(backend);
  console.log(`[dev] Backend healthy at ${backendHealthUrl}; starting frontend.`);
  spawnWorkspace('frontend', 'frontend');
}
