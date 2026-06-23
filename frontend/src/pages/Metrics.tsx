import { useEffect, useState, useMemo, useCallback } from 'react';
import { RefreshCw, ArrowUpRight, ArrowDownRight, Minus, Coins, DollarSign, Gauge, CheckCircle2 } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { TokenUsage, MetricSnapshot } from '@/types';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
} from 'recharts';

interface TokenSummary {
  totalTokens: number;
  totalCost: number;
  byAgent: Array<{
    agentId: string;
    agentName: string;
    displayName: string;
    avatar: string | null;
    totalTokens: number;
    totalCost: number;
  }>;
}

interface MetricsSummary {
  byAgent: Array<{
    agentId: string;
    agentName: string;
    displayName: string;
    avatar: string | null;
    avgResponseTime: number;
    p95ResponseTime: number;
    successRate: number;
    totalCalls: number;
  }>;
}

const CHART_COLORS = [
  '#3b8eff', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1',
];

const tooltipStyle = {
  contentStyle: {
    backgroundColor: '#080e1a',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    fontSize: '12px',
    color: '#d1d5db',
  },
  labelStyle: { color: '#9ca3af' },
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

// Percent change of the second half of a series vs the first half (the trend).
function trendPct(series: number[]): number | null {
  if (series.length < 4) return null;
  const mid = Math.floor(series.length / 2);
  const prev = series.slice(0, mid).reduce((s, v) => s + v, 0);
  const curr = series.slice(mid).reduce((s, v) => s + v, 0);
  if (prev === 0) return curr === 0 ? 0 : 100;
  return ((curr - prev) / prev) * 100;
}

export function Metrics() {
  const [tokenUsage, setTokenUsage] = useState<TokenUsage[]>([]);
  const [tokenSummary, setTokenSummary] = useState<TokenSummary | null>(null);
  const [metrics, setMetrics] = useState<MetricSnapshot[]>([]);
  const [metricsSummary, setMetricsSummary] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [usage, tSummary, metricsList, mSummary] = await Promise.all([
        api.tokens.usage({ hours: 24 }),
        api.tokens.summary(),
        api.metrics.list({ limit: 1000 }),
        api.metrics.summary(),
      ]);
      setTokenUsage(usage);
      setTokenSummary(tSummary);
      setMetrics(metricsList);
      setMetricsSummary(mSummary);
    } catch (err) {
      console.error('Failed to fetch metrics data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Unified 24h hourly series powering both the headline sparklines and the charts.
  const hourly = useMemo(() => {
    const now = Date.now();
    const buckets: Array<{
      hour: string; input: number; output: number; tokens: number; cost: number;
      calls: number; successRate: number; avgRt: number;
    }> = [];
    for (let i = 23; i >= 0; i--) {
      const start = now - (i + 1) * 3_600_000;
      const end = now - i * 3_600_000;
      const hourLabel = new Date(end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const tu = tokenUsage.filter((t) => {
        const ts = new Date(t.createdAt).getTime();
        return ts >= start && ts < end;
      });
      const ms = metrics.filter((m) => {
        const ts = new Date(m.createdAt).getTime();
        return ts >= start && ts < end;
      });
      const input = tu.reduce((s, t) => s + t.inputTokens, 0);
      const output = tu.reduce((s, t) => s + t.outputTokens, 0);
      const cost = tu.reduce((s, t) => s + t.cost, 0);
      const calls = ms.length;
      const succ = ms.filter((m) => m.success).length;
      const avgRt = calls > 0 ? Math.round(ms.reduce((s, m) => s + m.responseTimeMs, 0) / calls) : 0;
      buckets.push({
        hour: hourLabel,
        input, output, tokens: input + output, cost,
        calls,
        successRate: calls > 0 ? Math.round((succ / calls) * 1000) / 10 : 0,
        avgRt,
      });
    }
    return buckets;
  }, [tokenUsage, metrics]);

  const stats24h = useMemo(() => {
    const totalTokens24h = hourly.reduce((s, b) => s + b.tokens, 0);
    const totalCost24h = hourly.reduce((s, b) => s + b.cost, 0);
    const callBuckets = hourly.filter((b) => b.calls > 0);
    const avgResponseTime = callBuckets.length
      ? Math.round(callBuckets.reduce((s, b) => s + b.avgRt, 0) / callBuckets.length)
      : 0;
    const totalCalls = hourly.reduce((s, b) => s + b.calls, 0);
    const totalSucc = metrics.filter((m) => m.success).length;
    const successRate = metrics.length ? Math.round((totalSucc / metrics.length) * 1000) / 10 : 0;
    return { totalTokens24h, totalCost24h, avgResponseTime, successRate, totalCalls };
  }, [hourly, metrics]);

  const costByAgent = useMemo(() => {
    if (!tokenSummary) return [];
    return tokenSummary.byAgent
      .map((a) => ({ name: a.displayName, cost: Math.round(a.totalCost * 10000) / 10000 }))
      .sort((a, b) => b.cost - a.cost);
  }, [tokenSummary]);

  const responseTimeByAgent = useMemo(() => {
    if (!metricsSummary) return [];
    return metricsSummary.byAgent.map((a) => ({ name: a.displayName, avg: a.avgResponseTime, p95: a.p95ResponseTime }));
  }, [metricsSummary]);

  const successRateByAgent = useMemo(() => {
    if (!metricsSummary) return [];
    return metricsSummary.byAgent.map((a) => ({ name: a.displayName, rate: a.successRate }));
  }, [metricsSummary]);

  const toolUsage = useMemo(() => {
    const toolMap = new Map<string, number>();
    for (const m of metrics) {
      const tool = m.toolName || 'Unknown';
      toolMap.set(tool, (toolMap.get(tool) || 0) + 1);
    }
    return Array.from(toolMap.entries())
      .map(([name, calls]) => ({ name, calls }))
      .sort((a, b) => b.calls - a.calls);
  }, [metrics]);

  if (loading) {
    return (
      <div>
        <Header title="Metrics & Cost" subtitle="Token usage, performance, and cost analytics" />
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl border border-white/5 bg-surface-850" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-4">
        <Header title="Metrics & Cost" subtitle="Token usage, performance, and cost analytics" />
        <div className="mt-1 flex items-center gap-2">
          <span className="rounded-full border border-white/10 bg-surface-850 px-3 py-1.5 text-xs text-gray-400">Last 24 hours</span>
          <button
            type="button"
            onClick={fetchData}
            disabled={refreshing}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-surface-850 text-gray-400 transition-colors hover:text-white disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Headline stat cards with embedded sparklines + trend */}
      <div className="mt-6 mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          id="tokens" label="Tokens" value={formatNumber(stats24h.totalTokens24h)}
          accent="#3b8eff" icon={Coins} series={hourly.map((b) => b.tokens)}
        />
        <StatCard
          id="cost" label="Cost" value={formatCost(stats24h.totalCost24h)}
          accent="#10b981" icon={DollarSign} series={hourly.map((b) => b.cost)}
        />
        <StatCard
          id="rt" label="Avg response" value={`${stats24h.avgResponseTime}`} unit="ms"
          accent="#f59e0b" icon={Gauge} series={hourly.map((b) => b.avgRt)} lowerIsBetter
        />
        <StatCard
          id="success" label="Success rate" value={`${stats24h.successRate}`} unit="%"
          accent="#8b5cf6" icon={CheckCircle2} series={hourly.map((b) => b.successRate)} flatTrend
          footnote={`${stats24h.totalCalls} calls`}
        />
      </div>

      {/* Token usage + cost breakdown */}
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartPanel title="Token usage over time" accent="#3b8eff">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={hourly}>
              <defs>
                <linearGradient id="gradInput" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b8eff" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#3b8eff" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gradOutput" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#161f30" vertical={false} />
              <XAxis dataKey="hour" tick={{ fill: '#4b5563', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#161f30' }} interval="preserveStartEnd" minTickGap={40} />
              <YAxis tick={{ fill: '#4b5563', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={formatNumber} width={44} />
              <Tooltip {...tooltipStyle} formatter={(value: number, name: string) => [formatNumber(value), name === 'input' ? 'Input' : 'Output']} />
              <Area type="monotone" dataKey="input" stackId="1" stroke="#3b8eff" strokeWidth={2} fill="url(#gradInput)" name="input" />
              <Area type="monotone" dataKey="output" stackId="1" stroke="#10b981" strokeWidth={2} fill="url(#gradOutput)" name="output" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Cost by agent" accent="#10b981">
          {costByAgent.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={costByAgent} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#161f30" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#4b5563', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#161f30' }} tickFormatter={(v) => `$${v}`} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} tickLine={false} axisLine={false} width={110} />
                <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.03)' }} formatter={(value: number) => [`$${value.toFixed(4)}`, 'Cost']} />
                <Bar dataKey="cost" radius={[0, 4, 4, 0]} barSize={18}>
                  {costByAgent.map((_, i) => (<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.85} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart label="No cost data yet" />}
        </ChartPanel>
      </div>

      {/* Performance row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartPanel title="Response time by agent" accent="#3b8eff">
          {responseTimeByAgent.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={responseTimeByAgent}>
                <CartesianGrid strokeDasharray="3 3" stroke="#161f30" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#4b5563', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#161f30' }} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fill: '#4b5563', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}ms`} width={48} />
                <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.03)' }} formatter={(value: number, name: string) => [`${value}ms`, name === 'avg' ? 'Average' : 'P95']} />
                <Bar dataKey="avg" fill="#3b8eff" fillOpacity={0.85} radius={[4, 4, 0, 0]} name="avg" />
                <Bar dataKey="p95" fill="#f59e0b" fillOpacity={0.75} radius={[4, 4, 0, 0]} name="p95" />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart label="No performance data yet" />}
        </ChartPanel>

        <ChartPanel title="Success rate by agent" accent="#10b981">
          {successRateByAgent.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={successRateByAgent}>
                <CartesianGrid strokeDasharray="3 3" stroke="#161f30" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#4b5563', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#161f30' }} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fill: '#4b5563', fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={40} />
                <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.03)' }} formatter={(value: number) => [`${value}%`, 'Success']} />
                <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
                  {successRateByAgent.map((entry, i) => (
                    <Cell key={i} fill={entry.rate >= 95 ? '#10b981' : entry.rate >= 80 ? '#f59e0b' : '#ef4444'} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart label="No success data yet" />}
        </ChartPanel>

        <ChartPanel title="Tool usage" accent="#8b5cf6">
          {toolUsage.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={toolUsage} dataKey="calls" nameKey="name" cx="50%" cy="50%"
                  outerRadius={88} innerRadius={48} paddingAngle={2}
                  label={({ name, percent }) => `${name} ${(((percent as number) ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {toolUsage.map((_, i) => (<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.9} />))}
                </Pie>
                <Tooltip {...tooltipStyle} formatter={(value: number) => [`${value} calls`, 'Usage']} />
                <Legend wrapperStyle={{ fontSize: '11px', color: '#9ca3af' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyChart label="No tool usage data" />}
        </ChartPanel>
      </div>
    </div>
  );
}

function StatCard({
  id, label, value, unit, accent, icon: Icon, series, lowerIsBetter, flatTrend, footnote,
}: {
  id: string;
  label: string;
  value: string;
  unit?: string;
  accent: string;
  icon: typeof Coins;
  series: number[];
  lowerIsBetter?: boolean;
  flatTrend?: boolean;
  footnote?: string;
}) {
  const pct = flatTrend ? null : trendPct(series);
  const up = (pct ?? 0) > 1;
  const down = (pct ?? 0) < -1;
  // For "lower is better" metrics (response time), a rise is bad and vice-versa.
  const good = lowerIsBetter ? down : up;
  const bad = lowerIsBetter ? up : down;
  const sparkData = series.map((v, i) => ({ i, v }));

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-surface-850 p-5">
      {/* faint accent wash */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}66, transparent)` }} />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-500">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${accent}1a`, color: accent }}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wider">{label}</span>
        </div>
        {pct !== null && (
          <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
            good ? 'bg-emerald-500/10 text-emerald-300' : bad ? 'bg-red-500/10 text-red-300' : 'bg-white/5 text-gray-400')}>
            {up ? <ArrowUpRight className="h-3 w-3" /> : down ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            {Math.abs(pct).toFixed(0)}%
          </span>
        )}
      </div>

      <div className="mt-3 flex items-end gap-1">
        <span className="text-3xl font-semibold tabular-nums text-white">{value}</span>
        {unit && <span className="mb-1 text-sm text-gray-500">{unit}</span>}
      </div>
      {footnote && <div className="mt-0.5 text-[11px] text-gray-600">{footnote}</div>}

      <div className="mt-3 h-9">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={sparkData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
                <stop offset="100%" stopColor={accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="v" stroke={accent} strokeWidth={1.5} fill={`url(#spark-${id})`} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ChartPanel({ title, accent, children }: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-surface-850 p-5">
      <div className="mb-4 flex items-center gap-2">
        {accent && <span className="h-2 w-2 rounded-full" style={{ background: accent }} />}
        <h3 className="text-sm font-semibold tracking-wide text-gray-300">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return <div className="flex h-[260px] items-center justify-center text-sm text-gray-600">{label}</div>;
}
