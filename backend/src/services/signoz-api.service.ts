import { logger } from '../lib/logger.js';

/**
 * Minimal SigNoz query-API client. Reads logs from a SigNoz instance (self-hosted
 * query-service or SigNoz Cloud) via the v5 query_range API. Used both for the
 * Nexus Logs viewer and as a production-error source for the auto-fix pipeline.
 *
 * Auth: SIGNOZ-API-KEY header (key from SigNoz Settings -> Service Accounts).
 */

export interface SigNozConfig {
  endpoint: string; // base URL, e.g. http://localhost:8080 or https://<region>.signoz.cloud
  apiKey: string;
}

export interface SigNozLog {
  timestamp: string; // ISO-8601
  severity: string; // normalized upper-case, e.g. ERROR/WARN/INFO
  body: string;
  serviceName: string | null;
  traceId: string | null;
  attributes: Record<string, unknown>;
}

export interface QueryLogsOptions {
  severities?: string[]; // severity_text values to match (OR-ed). Empty => all.
  search?: string; // substring match on the log body
  sinceMs?: number; // look-back window in ms (default 15m)
  limit?: number; // max rows (default 100)
}

export function isSigNozConfigured(cfg?: Pick<SigNozConfig, 'endpoint' | 'apiKey'> | null): boolean {
  return Boolean(cfg?.endpoint && cfg?.apiKey);
}

function baseUrl(cfg: SigNozConfig) {
  const raw = cfg.endpoint.trim();
  // Be forgiving: users often paste a full URL with a path/query (e.g. a
  // dashboard or password-reset link). The query API lives at the origin.
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

function headers(cfg: SigNozConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'SIGNOZ-API-KEY': cfg.apiKey,
  };
}

// SigNoz filter expressions are single-quoted; escape embedded quotes.
function quote(value: string) {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function buildFilterExpression(opts: QueryLogsOptions): string {
  const clauses: string[] = [];
  if (opts.severities?.length) {
    clauses.push('(' + opts.severities.map(s => `severity_text = ${quote(s)}`).join(' OR ') + ')');
  }
  if (opts.search?.trim()) {
    clauses.push(`body CONTAINS ${quote(opts.search.trim())}`);
  }
  return clauses.join(' AND ');
}

function toIso(value: unknown): string {
  if (value == null) return new Date(0).toISOString();
  if (typeof value === 'string') {
    const ms = Number(value);
    if (Number.isFinite(ms)) return toIso(ms);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
  }
  if (typeof value === 'number') {
    // Normalize ns / us / ms / s to ms.
    let ms = value;
    if (value > 1e18) ms = value / 1e6; // nanoseconds
    else if (value > 1e15) ms = value / 1e3; // microseconds
    else if (value < 1e12) ms = value * 1e3; // seconds
    return new Date(ms).toISOString();
  }
  return new Date(0).toISOString();
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toLog(row: unknown): SigNozLog | null {
  const r = objectRecord(row);
  if (Object.keys(r).length === 0) return null;
  // Different SigNoz versions nest the log fields under `data`; fall back to row.
  const data = objectRecord(r.data && typeof r.data === 'object' ? r.data : r);
  const attributes = {
    ...objectRecord(data.attributes_string),
    ...objectRecord(data.resources_string),
    ...objectRecord(data.attributes),
    ...objectRecord(r.attributes),
  };
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      if (data[k] != null) return data[k];
      if (r[k] != null) return r[k];
      if (attributes[k] != null) return attributes[k];
    }
    return undefined;
  };
  const body = String(pick('body') ?? '');
  const severity = String(pick('severity_text', 'severity', 'level') ?? 'INFO').toUpperCase() || 'INFO';
  const serviceName = pick('service.name', 'serviceName');
  const traceId = pick('trace_id', 'traceId', 'traceID');
  return {
    timestamp: toIso(pick('timestamp', 'timestamp_nano', 'time')),
    severity,
    body,
    serviceName: serviceName != null ? String(serviceName) : null,
    traceId: traceId != null ? String(traceId) : null,
    attributes,
  };
}

// SigNoz responses vary by version; pull the log rows from the known shapes.
function extractRows(json: unknown): unknown[] {
  const j = objectRecord(json);
  const data = objectRecord(j.data);
  const candidates =
    (Array.isArray(j.result) && j.result) ||
    (Array.isArray((data.results as unknown[]) ) && (data.results as Record<string, unknown>[])?.[0]?.rows) ||
    (Array.isArray((data.result as unknown[])) && (data.result as Record<string, unknown>[])?.[0]?.list) ||
    objectRecord(objectRecord(objectRecord(data.newResult).data).result?.[0 as never]).list ||
    [];
  return Array.isArray(candidates) ? candidates : [];
}

export async function queryLogs(cfg: SigNozConfig, opts: QueryLogsOptions = {}): Promise<SigNozLog[]> {
  if (!isSigNozConfigured(cfg)) return [];
  const end = Date.now();
  const start = end - (opts.sinceMs ?? 15 * 60 * 1000);
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  const expression = buildFilterExpression(opts);

  const requestBody = {
    start,
    end,
    requestType: 'raw',
    variables: {},
    compositeQuery: {
      queries: [
        {
          type: 'builder_query',
          spec: {
            name: 'A',
            signal: 'logs',
            ...(expression ? { filter: { expression } } : {}),
            order: [
              { key: { name: 'timestamp' }, direction: 'desc' },
              { key: { name: 'id' }, direction: 'desc' },
            ],
            offset: 0,
            limit,
          },
        },
      ],
    },
  };

  let res: Response;
  try {
    res = await fetch(`${baseUrl(cfg)}/api/v5/query_range`, {
      method: 'POST',
      headers: headers(cfg),
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    logger.warn({ err }, '[signoz] query_range request failed');
    return [];
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    logger.warn({ status: res.status, detail: detail.slice(0, 300) }, '[signoz] query_range non-OK');
    return [];
  }
  const json = await res.json().catch(() => null);
  return extractRows(json).map(toLog).filter((l): l is SigNozLog => Boolean(l)).slice(0, limit);
}

/** Lightweight connectivity check used by the Settings "Check" button. */
export async function checkSigNozConnection(cfg: SigNozConfig): Promise<{ ok: boolean; detail: string }> {
  if (!isSigNozConfigured(cfg)) return { ok: false, detail: 'Endpoint and API key are required.' };
  try {
    const res = await fetch(`${baseUrl(cfg)}/api/v5/query_range`, {
      method: 'POST',
      headers: headers(cfg),
      body: JSON.stringify({
        start: Date.now() - 5 * 60 * 1000,
        end: Date.now(),
        requestType: 'raw',
        variables: {},
        compositeQuery: { queries: [{ type: 'builder_query', spec: { name: 'A', signal: 'logs', offset: 0, limit: 1 } }] },
      }),
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      return { ok: true, detail: 'Connected to SigNoz.' };
    }
    if (res.ok) {
      // Reachable host but the query API did not answer with JSON — almost always
      // a wrong endpoint (e.g. a dashboard/login URL instead of the base host).
      return {
        ok: false,
        detail: 'Reached the host but not the SigNoz query API. Use the base URL only, e.g. https://<tenant>.<region>.signoz.cloud (no path).',
      };
    }
    const detail = await res.text().catch(() => res.statusText);
    return { ok: false, detail: `SigNoz returned ${res.status}: ${detail.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, detail: `Could not reach SigNoz: ${(err as Error).message}` };
  }
}
