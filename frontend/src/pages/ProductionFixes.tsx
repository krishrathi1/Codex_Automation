import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, GitCommit, ExternalLink, ChevronDown, AlertTriangle } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { api } from '../lib/api';
import { cn, timeAgo } from '../lib/utils';
import type { ProductionErrorEvent, ProductionErrorStatus } from '../types';

// Pipeline stages in order; each status maps to a stage index.
const STAGES = ['Detected', 'Debug', 'Review', 'Commit', 'Deployed'] as const;

function stageIndex(status: ProductionErrorStatus): number {
  switch (status) {
    case 'RECEIVED':
    case 'TASK_CREATED': return 0;
    case 'DEBUG_QUEUED': return 1;
    case 'REVIEW_QUEUED':
    case 'APPROVED':
    case 'REJECTED': return 2;
    case 'COMMIT_QUEUED': return 3;
    case 'COMPLETED': return 4;
    case 'FAILED': return -1;
    default: return 0;
  }
}

function statusStyle(status: ProductionErrorStatus): { label: string; cls: string } {
  if (status === 'COMPLETED') return { label: 'Fixed & pushed', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' };
  if (status === 'FAILED') return { label: 'Failed', cls: 'text-red-300 bg-red-500/10 border-red-500/20' };
  if (status === 'REJECTED') return { label: 'Fix rejected', cls: 'text-orange-300 bg-orange-500/10 border-orange-500/20' };
  return { label: 'In progress', cls: 'text-sky-300 bg-sky-500/10 border-sky-500/20' };
}

const SOURCE_STYLE: Record<string, string> = {
  vercel: 'text-white bg-white/10 border-white/15',
  signoz: 'text-pink-300 bg-pink-500/10 border-pink-500/20',
  github: 'text-violet-300 bg-violet-500/10 border-violet-500/20',
  website: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
};

function Stepper({ status }: { status: ProductionErrorStatus }) {
  const active = stageIndex(status);
  const failed = status === 'FAILED' || status === 'REJECTED';
  return (
    <div className="flex items-center gap-1.5">
      {STAGES.map((stage, i) => {
        const done = active >= i && !failed;
        const isFailPoint = failed && i === Math.max(0, stageIndex(status === 'REJECTED' ? 'REVIEW_QUEUED' : status));
        return (
          <div key={stage} className="flex items-center gap-1.5">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  done ? 'bg-emerald-400' : isFailPoint ? 'bg-red-400' : 'bg-white/15',
                )}
              />
              <span className={cn('text-[10px]', done ? 'text-gray-300' : 'text-gray-600')}>{stage}</span>
            </div>
            {i < STAGES.length - 1 && <span className={cn('h-px w-4', done ? 'bg-emerald-400/40' : 'bg-white/10')} />}
          </div>
        );
      })}
    </div>
  );
}

function FixFiles({ event }: { event: ProductionErrorEvent }) {
  const files = event.payload?.proposedFix ?? [];
  if (files.length === 0) {
    return <p className="text-xs text-gray-600">No proposed file changes captured yet.</p>;
  }
  return (
    <div className="space-y-2">
      {files.map((f) => (
        <div key={f.path} className="rounded-lg border border-white/5 bg-surface-900 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-white/5 bg-white/[0.02]">
            <span className="font-mono text-[11px] text-gray-300 truncate">{f.path}</span>
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded', f.content === null ? 'text-red-300 bg-red-500/10' : 'text-emerald-300 bg-emerald-500/10')}>
              {f.content === null ? 'delete' : 'modified'}
            </span>
          </div>
          {f.content !== null && (
            <pre className="max-h-56 overflow-auto px-3 py-2 text-[11px] leading-5 font-mono text-gray-400 whitespace-pre-wrap">
              {f.content.length > 4000 ? `${f.content.slice(0, 4000)}\n… (truncated)` : f.content}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

export function ProductionFixes() {
  const [events, setEvents] = useState<ProductionErrorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'fixed' | 'failed'>('all');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setEvents(await api.errorEvents.list({ limit: 100 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load production fixes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const completed = events.filter(e => e.status === 'COMPLETED').length;
    const failed = events.filter(e => e.status === 'FAILED' || e.status === 'REJECTED').length;
    const active = events.length - completed - failed;
    return { total: events.length, completed, failed, active };
  }, [events]);

  const visible = useMemo(() => {
    if (filter === 'all') return events;
    if (filter === 'fixed') return events.filter(e => e.status === 'COMPLETED');
    if (filter === 'failed') return events.filter(e => e.status === 'FAILED' || e.status === 'REJECTED');
    return events.filter(e => e.status !== 'COMPLETED' && e.status !== 'FAILED' && e.status !== 'REJECTED');
  }, [events, filter]);

  return (
    <div>
      <Header title="Production Fixes" subtitle="Errors detected in production, auto-fixed and shipped to GitHub" />

      {/* Summary */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          { key: 'all', label: 'Total', value: stats.total, accent: 'text-white' },
          { key: 'active', label: 'In progress', value: stats.active, accent: 'text-sky-300' },
          { key: 'fixed', label: 'Fixed & pushed', value: stats.completed, accent: 'text-emerald-300' },
          { key: 'failed', label: 'Failed', value: stats.failed, accent: 'text-red-300' },
        ] as const).map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setFilter(s.key as typeof filter)}
            className={cn(
              'rounded-xl border bg-surface-850 px-4 py-3 text-left transition-colors',
              filter === s.key ? 'border-nexus-500/40' : 'border-white/5 hover:border-white/15',
            )}
          >
            <div className="text-[11px] uppercase tracking-wide text-gray-500">{s.label}</div>
            <div className={cn('mt-1 text-2xl font-semibold', s.accent)}>{s.value}</div>
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs text-gray-600">{visible.length} event{visible.length !== 1 ? 's' : ''}</span>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-surface-850 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-white/5 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Loading production fixes…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 py-16 text-center">
          <AlertTriangle className="mx-auto mb-3 h-6 w-6 text-gray-600" />
          <p className="text-sm text-gray-500">No production errors in this view.</p>
          <p className="mt-1 text-xs text-gray-600">Configure Vercel / GitHub / SigNoz in Settings to start the auto-fix pipeline.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((e) => {
            const s = statusStyle(e.status);
            const expanded = expandedId === e.id;
            const commitUrl = e.payload?.commitUrl;
            return (
              <div key={e.id} className="rounded-xl border border-white/5 bg-surface-850 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : e.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
                >
                  <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-gray-500 transition-transform', expanded && 'rotate-180')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase', SOURCE_STYLE[e.source] ?? 'text-gray-300 bg-white/5 border-white/10')}>{e.source}</span>
                      <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', s.cls)}>{s.label}</span>
                      {e.board && <span className="text-[10px] text-gray-600">{e.board.name}</span>}
                      <span className="ml-auto text-[10px] text-gray-600">{timeAgo(e.createdAt)}</span>
                    </div>
                    <p className="mt-1.5 truncate text-sm font-medium text-white">{e.title}</p>
                    <div className="mt-2"><Stepper status={e.status} /></div>
                  </div>
                </button>

                {expanded && (
                  <div className="border-t border-white/5 px-4 py-4 space-y-4">
                    {commitUrl && (
                      <a
                        href={commitUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/15"
                      >
                        <GitCommit className="h-3.5 w-3.5" />
                        View commit {e.payload?.commitSha ? `${String(e.payload.commitSha).slice(0, 7)}` : ''}
                        {typeof e.payload?.filesPushed === 'number' ? ` · ${e.payload.filesPushed} file(s)` : ''}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}

                    <div>
                      <div className="mb-1.5 text-[11px] uppercase tracking-wide text-gray-500">Error</div>
                      <pre className="max-h-40 overflow-auto rounded-lg border border-white/5 bg-surface-900 px-3 py-2 text-[11px] leading-5 font-mono text-gray-400 whitespace-pre-wrap">
                        {(e.stack || e.message || '').slice(0, 3000)}
                      </pre>
                    </div>

                    <div>
                      <div className="mb-1.5 text-[11px] uppercase tracking-wide text-gray-500">Proposed fix</div>
                      <FixFiles event={e} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
