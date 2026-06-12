import { useEffect, useState, useMemo } from 'react';
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
  '#3b8eff', // nexus-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
  '#6366f1', // indigo-500
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

export function Metrics() {
  const [tokenUsage, setTokenUsage] = useState<TokenUsage[]>([]);
  const [tokenSummary, setTokenSummary] = useState<TokenSummary | null>(null);
  const [metrics, setMetrics] = useState<MetricSnapshot[]>([]);
  const [metricsSummary, setMetricsSummary] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
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
      }
    }
    fetchData();
  }, []);

  // Compute 24h summary stats
  const stats24h = useMemo(() => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recent = tokenUsage.filter((t) => t.createdAt >= cutoff);
    const totalTokens24h = recent.reduce((sum, t) => sum + t.totalTokens, 0);
    const totalCost24h = recent.reduce((sum, t) => sum + t.cost, 0);

    const recentMetrics = metrics.filter((m) => m.createdAt >= cutoff);
    const avgResponseTime =
      recentMetrics.length > 0
        ? Math.round(recentMetrics.reduce((sum, m) => sum + m.responseTimeMs, 0) / recentMetrics.length)
        : 0;
    const successCount = recentMetrics.filter((m) => m.success).length;
    const successRate = recentMetrics.length > 0 ? Math.round((successCount / recentMetrics.length) * 10000) / 100 : 0;

    return { totalTokens24h, totalCost24h, avgResponseTime, successRate };
  }, [tokenUsage, metrics]);

  // Token usage over time (hourly buckets, last 24h)
  const hourlyTokenData = useMemo(() => {
    const now = Date.now();
    const buckets: Array<{ hour: string; input: number; output: number }> = [];
    for (let i = 23; i >= 0; i--) {
      const start = now - (i + 1) * 60 * 60 * 1000;
      const end = now - i * 60 * 60 * 1000;
      const hourLabel = new Date(end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const inRange = tokenUsage.filter((t) => {
        const ts = new Date(t.createdAt).getTime();
        return ts >= start && ts < end;
      });
      buckets.push({
        hour: hourLabel,
        input: inRange.reduce((sum, t) => sum + t.inputTokens, 0),
        output: inRange.reduce((sum, t) => sum + t.outputTokens, 0),
      });
    }
    return buckets;
  }, [tokenUsage]);

  // Cost breakdown by agent (horizontal bar chart data)
  const costByAgent = useMemo(() => {
    if (!tokenSummary) return [];
    return tokenSummary.byAgent
      .map((a) => ({
        name: a.displayName,
        cost: Math.round(a.totalCost * 10000) / 10000,
      }))
      .sort((a, b) => b.cost - a.cost);
  }, [tokenSummary]);

  // Response time by agent
  const responseTimeByAgent = useMemo(() => {
    if (!metricsSummary) return [];
    return metricsSummary.byAgent.map((a) => ({
      name: a.displayName,
      avg: a.avgResponseTime,
      p95: a.p95ResponseTime,
    }));
  }, [metricsSummary]);

  // Success rate by agent
  const successRateByAgent = useMemo(() => {
    if (!metricsSummary) return [];
    return metricsSummary.byAgent.map((a) => ({
      name: a.displayName,
      rate: a.successRate,
    }));
  }, [metricsSummary]);

  // Tool usage breakdown
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
        <div className="text-gray-500 text-sm mt-8">Loading metrics data...</div>
      </div>
    );
  }

  return (
    <div>
      <Header title="Metrics & Cost" subtitle="Token usage, performance, and cost analytics" />

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <SummaryCard
          label="Total Tokens (24h)"
          value={formatNumber(stats24h.totalTokens24h)}
          color="text-nexus-400"
          bgColor="bg-nexus-500/10 border-nexus-500/20"
        />
        <SummaryCard
          label="Total Cost (24h)"
          value={formatCost(stats24h.totalCost24h)}
          color="text-emerald-400"
          bgColor="bg-emerald-500/10 border-emerald-500/20"
        />
        <SummaryCard
          label="Avg Response Time"
          value={`${stats24h.avgResponseTime}ms`}
          color="text-amber-400"
          bgColor="bg-amber-500/10 border-amber-500/20"
        />
        <SummaryCard
          label="Success Rate"
          value={`${stats24h.successRate}%`}
          color="text-violet-400"
          bgColor="bg-violet-500/10 border-violet-500/20"
        />
      </div>

      {/* Charts Row 1: Token usage over time + Cost breakdown */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Token usage stacked area chart */}
        <ChartPanel title="Token Usage Over Time (24h)">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={hourlyTokenData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis
                dataKey="hour"
                tick={{ fill: '#4b5563', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#1f2937' }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: '#4b5563', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#1f2937' }}
                tickFormatter={formatNumber}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(value: number, name: string) => [formatNumber(value), name === 'input' ? 'Input Tokens' : 'Output Tokens']}
              />
              <Area
                type="monotone"
                dataKey="input"
                stackId="1"
                stroke="#3b8eff"
                fill="#3b8eff"
                fillOpacity={0.3}
                name="input"
              />
              <Area
                type="monotone"
                dataKey="output"
                stackId="1"
                stroke="#10b981"
                fill="#10b981"
                fillOpacity={0.3}
                name="output"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>

        {/* Cost breakdown by agent (horizontal bar chart) */}
        <ChartPanel title="Cost Breakdown by Agent">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={costByAgent} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fill: '#4b5563', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#1f2937' }}
                tickFormatter={(v) => `$${v}`}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fill: '#4b5563', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#1f2937' }}
                width={100}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(value: number) => [`$${value.toFixed(4)}`, 'Cost']}
              />
              <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                {costByAgent.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>

      {/* Charts Row 2: Performance */}
      <div className="grid grid-cols-3 gap-4">
        {/* Response time by agent */}
        <ChartPanel title="Response Time by Agent">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={responseTimeByAgent}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis
                dataKey="name"
                tick={{ fill: '#4b5563', fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: '#1f2937' }}
                angle={-20}
                textAnchor="end"
                height={50}
              />
              <YAxis
                tick={{ fill: '#4b5563', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#1f2937' }}
                tickFormatter={(v) => `${v}ms`}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(value: number, name: string) => [
                  `${value}ms`,
                  name === 'avg' ? 'Average' : 'P95',
                ]}
              />
              <Bar dataKey="avg" fill="#3b8eff" fillOpacity={0.7} radius={[4, 4, 0, 0]} name="avg" />
              <Bar dataKey="p95" fill="#f59e0b" fillOpacity={0.7} radius={[4, 4, 0, 0]} name="p95" />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        {/* Success rate by agent */}
        <ChartPanel title="Success Rate by Agent">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={successRateByAgent}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis
                dataKey="name"
                tick={{ fill: '#4b5563', fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: '#1f2937' }}
                angle={-20}
                textAnchor="end"
                height={50}
              />
              <YAxis
                tick={{ fill: '#4b5563', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#1f2937' }}
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(value: number) => [`${value}%`, 'Success Rate']}
              />
              <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
                {successRateByAgent.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.rate >= 95 ? '#10b981' : entry.rate >= 80 ? '#f59e0b' : '#ef4444'}
                    fillOpacity={0.8}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        {/* Tool usage breakdown */}
        <ChartPanel title="Tool Usage Breakdown">
          {toolUsage.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={toolUsage}
                  dataKey="calls"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={45}
                  paddingAngle={2}
                  label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                  labelLine={{ stroke: '#4b5563' }}
                >
                  {toolUsage.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.85} />
                  ))}
                </Pie>
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value: number) => [`${value} calls`, 'Usage']}
                />
                <Legend
                  wrapperStyle={{ fontSize: '11px', color: '#4b5563' }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-gray-500 text-sm">
              No tool usage data
            </div>
          )}
        </ChartPanel>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
  bgColor,
}: {
  label: string;
  value: string;
  color: string;
  bgColor: string;
}) {
  return (
    <div className={cn('rounded-xl border p-5', bgColor)}>
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">{label}</div>
      <div className={cn('text-2xl font-bold tabular-nums', color)}>{value}</div>
    </div>
  );
}

function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/5 bg-surface-850 p-5">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">{title}</h3>
      {children}
    </div>
  );
}
