import { useAuthStore } from '../stores/auth-store';

type CapturedErrorPayload = {
  source: 'website';
  severity: 'error';
  title: string;
  message: string;
  stack?: string;
  url: string;
  route: string;
  userAgent: string;
  environment: string;
  fingerprint: string;
  payload: Record<string, unknown>;
};

let installed = false;
const recentFingerprints = new Map<string, number>();
const DEDUPE_WINDOW_MS = 30_000;

function hashText(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function messageFromReason(reason: unknown) {
  if (reason instanceof Error) {
    return {
      title: reason.name || 'Unhandled error',
      message: reason.message || String(reason),
      stack: reason.stack,
    };
  }

  if (typeof reason === 'string') {
    return {
      title: 'Unhandled error',
      message: reason,
      stack: undefined,
    };
  }

  return {
    title: 'Unhandled error',
    message: JSON.stringify(reason ?? 'Unknown error'),
    stack: undefined,
  };
}

function shouldSend(fingerprint: string) {
  const now = Date.now();
  const lastSeen = recentFingerprints.get(fingerprint);
  recentFingerprints.set(fingerprint, now);

  for (const [key, seenAt] of recentFingerprints) {
    if (now - seenAt > DEDUPE_WINDOW_MS) recentFingerprints.delete(key);
  }

  return !lastSeen || now - lastSeen > DEDUPE_WINDOW_MS;
}

async function sendCapturedError(payload: CapturedErrorPayload) {
  const { accessToken } = useAuthStore.getState();
  if (!accessToken) return;
  if (!shouldSend(payload.fingerprint)) return;

  await fetch('/api/error-events', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  }).catch(() => {
    // Error capture must never break the user-facing app.
  });
}

function capture(reason: unknown, payload: Record<string, unknown> = {}) {
  const normalized = messageFromReason(reason);
  const url = window.location.href;
  const route = window.location.pathname + window.location.search;
  const fingerprint = hashText([
    normalized.title,
    normalized.message,
    normalized.stack?.split('\n').slice(0, 3).join('\n') || '',
    route,
  ].join('|'));

  void sendCapturedError({
    source: 'website',
    severity: 'error',
    title: normalized.title,
    message: normalized.message,
    stack: normalized.stack,
    url,
    route,
    userAgent: navigator.userAgent,
    environment: import.meta.env.MODE || 'development',
    fingerprint,
    payload,
  });
}

export function installProductionErrorCollector() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', event => {
    capture(event.error || event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      type: 'window.error',
    });
  });

  window.addEventListener('unhandledrejection', event => {
    capture(event.reason, {
      type: 'window.unhandledrejection',
    });
  });
}
