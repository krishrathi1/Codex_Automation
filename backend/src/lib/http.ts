/**
 * fetch() wrapper that enforces a timeout via AbortController so a hung remote
 * (GitHub / Bitbucket / Vercel / any external API) can never stall a request
 * handler or the background monitor indefinitely. Drop-in replacement for fetch:
 * same (url, init) signature plus an optional timeout (default 15s).
 */
export async function fetchWithTimeout(
  input: string | URL | Request,
  init?: RequestInit,
  timeoutMs = 15000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
