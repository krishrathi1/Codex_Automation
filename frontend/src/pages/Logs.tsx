import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import type { SigNozLog, Board } from '../types';

const SEVERITY_FILTERS = ['ALL', 'ERROR', 'WARN', 'INFO'] as const;
type SeverityFilter = (typeof SEVERITY_FILTERS)[number];

const WINDOWS: { label: string; ms: number }[] = [
  { label: '15m', ms: 15 * 60 * 1000 },
  { label: '1h', ms: 60 * 60 * 1000 },
  { label: '6h', ms: 6 * 60 * 60 * 1000 },
  { label: '24h', ms: 24 * 60 * 60 * 1000 },
];

function severityClasses(severity: string): string {
  const s = severity.toUpperCase();
  if (s.includes('ERROR') || s.includes('FATAL') || s.includes('CRIT')) return 'text-red-300 bg-red-500/10 border-red-500/20';
  if (s.includes('WARN')) return 'text-amber-300 bg-amber-500/10 border-amber-500/20';
  if (s.includes('DEBUG') || s.includes('TRACE')) return 'text-gray-400 bg-white/5 border-white/10';
  return 'text-sky-300 bg-sky-500/10 border-sky-500/20';
}

export function Logs() {
  const [logs, setLogs] = useState<SigNozLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severity, setSeverity] = useState<SeverityFilter>('ERROR');
  const [search, setSearch] = useState('');
  const [windowMs, setWindowMs] = useState(WINDOWS[1].ms);
  const [boards, setBoards] = useState<Board[]>([]);
  const [boardId, setBoardId] = useState(''); // '' = all org logs
  // Monotonic request id so a slow earlier fetch can't overwrite a newer one.
  const reqRef = useRef(0);

  useEffect(() => {
    api.boards.list().then(setBoards).catch(() => setBoards([]));
  }, []);

  const load = useCallback(async () => {
    const myReq = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const params: { severity?: string; search?: string; sinceMs: number; limit: number } = {
        sinceMs: windowMs,
        limit: 200,
      };
      if (severity !== 'ALL') params.severity = severity;
      if (search.trim()) params.search = search.trim();
      const result = boardId
        ? await api.boards.logs(boardId, params)
        : await api.org.signozLogs(params);
      if (reqRef.current !== myReq) return; // a newer request superseded this one
      setLogs(result.logs);
    } catch (err) {
      if (reqRef.current !== myReq) return;
      setError(err instanceof Error ? err.message : 'Failed to load logs');
      setLogs([]);
    } finally {
      if (reqRef.current === myReq) setLoading(false);
    }
  }, [severity, search, windowMs, boardId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <Header title="Logs" subtitle="Production website logs from SigNoz" />

      {/* Controls */}
      <div className="mb-6 rounded-xl border border-white/5 bg-surface-850 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={boardId}
            onChange={e => setBoardId(e.target.value)}
            className="rounded-lg border border-white/10 bg-surface-900 px-2.5 py-1 text-xs font-medium text-gray-300 outline-none focus:border-nexus-500"
            title="Scope logs to a production group"
          >
            <option value="">All services</option>
            {boards.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            {SEVERITY_FILTERS.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setSeverity(s)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                  severity === s ? 'border-nexus-500/50 bg-nexus-500/10 text-nexus-200' : 'border-white/10 text-gray-400 hover:bg-white/5',
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {WINDOWS.map(w => (
              <button
                key={w.label}
                type="button"
                onClick={() => setWindowMs(w.ms)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                  windowMs === w.ms ? 'border-nexus-500/50 bg-nexus-500/10 text-nexus-200' : 'border-white/10 text-gray-400 hover:bg-white/5',
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') load(); }}
            placeholder="Search log body..."
            className="min-w-[200px] flex-1 rounded-lg border border-white/10 bg-surface-900 px-3 py-1.5 text-sm text-white outline-none placeholder:text-gray-600 focus:border-nexus-500"
          />
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-surface-900 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
          <span className="ml-1 text-red-300/70">— configure SigNoz under Settings → Integrations.</span>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Loading logs...</div>
      ) : logs.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-500">No logs found for this filter.</div>
      ) : (
        <div className="space-y-2">
          {logs.map((log, i) => (
            <div key={`${log.timestamp}-${i}`} className="rounded-lg border border-white/5 bg-surface-850 p-3">
              <div className="flex items-center gap-2">
                <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase', severityClasses(log.severity))}>
                  {log.severity}
                </span>
                {log.serviceName && <span className="text-xs text-gray-400">{log.serviceName}</span>}
                <span className="ml-auto text-[10px] text-gray-600">{new Date(log.timestamp).toLocaleString()}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-gray-200">{log.body}</p>
              {log.traceId && <p className="mt-1 text-[10px] text-gray-600">trace: {log.traceId}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
