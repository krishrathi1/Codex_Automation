import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const children = new Set();
let shuttingDown = false;

function pipeWithPrefix(stream, target, logStream, label) {
  let buffer = '';

  stream.on('data', (chunk) => {
    const text = chunk.toString();
    logStream.write(text);
    buffer += text;

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      target.write(`[${label}] ${line}\n`);
    }
  });

  stream.on('end', () => {
    if (buffer) {
      target.write(`[${label}] ${buffer}\n`);
    }
  });
}

function startProcess({ label, command, args, cwd, logPath }) {
  mkdirSync(dirname(logPath), { recursive: true });
  const logStream = createWriteStream(logPath, { flags: 'w' });
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    shell: process.platform === 'win32',
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: false,
  });

  children.add(child);
  pipeWithPrefix(child.stdout, process.stdout, logStream, label);
  pipeWithPrefix(child.stderr, process.stderr, logStream, label);

  child.on('error', (error) => {
    console.error(`[${label}] failed to start: ${error.message}`);
    shutdown(1);
  });

  child.on('close', (code, signal) => {
    children.delete(child);
    logStream.end();

    if (shuttingDown) return;

    const detail = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[${label}] exited with ${detail}`);
    shutdown(code ?? 1);
  });

  return child;
}

async function isHttpOk(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    child.kill();
  }

  setTimeout(() => process.exit(exitCode), 500);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const nextLogPath = join(rootDir, 'dev.log');
const codexLogPath = join(rootDir, 'mini-services', 'codex-service', 'codex-service.log');

if (await isHttpOk('http://127.0.0.1:3003/health')) {
  console.log('[codex] service already running on http://127.0.0.1:3003');
} else {
  startProcess({
    label: 'codex',
    command: 'npx',
    args: ['tsx', 'watch', 'index.ts'],
    cwd: join(rootDir, 'mini-services', 'codex-service'),
    logPath: codexLogPath,
  });
}

if (await isHttpOk('http://127.0.0.1:3000')) {
  console.log('[next] dev server already running on http://127.0.0.1:3000');
} else {
  startProcess({
    label: 'next',
    command: 'npx',
    args: ['next', 'dev', '-p', '3000'],
    cwd: rootDir,
    logPath: nextLogPath,
  });
}
