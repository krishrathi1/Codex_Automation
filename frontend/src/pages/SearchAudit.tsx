import { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from '../components/layout/Header';
import { api } from '@/lib/api';
import type { Activity } from '@/types';
import { cn, timeAgo, activityTypeColors, activityTypeBgColors, activityTypeIcons } from '@/lib/utils';
import { useAgentStore } from '@/stores/agent-store';
import type { ActivityType } from '@/types';

const ACTIVITY_TYPES: ActivityType[] = [
  'HEARTBEAT', 'TASK_START', 'TASK_COMPLETE', 'ERROR',
  'MESSAGE', 'DELEGATION', 'ALERT', 'SYSTEM',
];

const badgePillColors: Record<ActivityType, string> = {
  HEARTBEAT: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  TASK_START: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  TASK_COMPLETE: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  ERROR: 'bg-red-500/15 text-red-400 border-red-500/30',
  MESSAGE: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  DELEGATION: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  ALERT: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  SYSTEM: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <span key={i} className="font-bold text-white bg-nexus-500/30 px-0.5 rounded">
        {part}
      </span>
    ) : (
      part
    )
  );
}

export function SearchAudit() {
  const { agents, fetchAgents } = useAgentStore();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filterAgent, setFilterAgent] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<ActivityType | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Debounce search query
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
      setOffset(0);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [filterAgent, filterType]);

  // Fetch results
  const fetchResults = useCallback(async () => {
    setLoading(true);
    try {
      if (debouncedQuery.trim()) {
        const result = await api.activities.search(debouncedQuery, {
          agentId: filterAgent || undefined,
          type: filterType || undefined,
          limit: limit + offset,
        });
        setActivities(result.activities);
        setTotal(result.total);
      } else {
        const result = await api.activities.list({
          agentId: filterAgent || undefined,
          type: filterType || undefined,
          limit,
          offset,
        });
        setActivities((prev) => (offset === 0 ? result.activities : [...prev, ...result.activities]));
        setTotal(result.total);
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, filterAgent, filterType, offset]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  const handleExport = () => {
    const data = JSON.stringify(activities, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus-audit-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleLoadMore = () => {
    if (debouncedQuery.trim()) {
      // For search, we already loaded up to limit+offset, just increase
      setOffset((prev) => prev + limit);
    } else {
      setOffset((prev) => prev + limit);
    }
  };

  return (
    <div>
      <Header title="Search & Audit Log" subtitle="Search across all agent activity and events" />

      {/* Search Bar */}
      <div className="relative mb-4">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search across all agent activity..."
          className="w-full pl-12 pr-4 py-4 rounded-xl bg-surface-850 border border-white/10 text-white text-lg placeholder-gray-500 focus:outline-none focus:border-nexus-500/50 focus:ring-1 focus:ring-nexus-500/30 transition-all"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-500 hover:text-gray-300"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Filters Row */}
      <div className="rounded-xl border border-white/5 bg-surface-850 p-4 mb-6 space-y-3">
        {/* Agent filter */}
        <div>
          <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-2">Agent</div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilterAgent(null)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                !filterAgent
                  ? 'bg-nexus-600/20 text-nexus-400 border-nexus-500/30'
                  : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
              )}
            >
              All Agents
            </button>
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => setFilterAgent(filterAgent === agent.id ? null : agent.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                  filterAgent === agent.id
                    ? 'bg-nexus-600/20 text-nexus-400 border-nexus-500/30'
                    : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
                )}
              >
                <span>{agent.avatar}</span>
                {agent.displayName}
              </button>
            ))}
          </div>
        </div>

        {/* Type filter */}
        <div>
          <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-2">Activity Type</div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilterType(null)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                !filterType
                  ? 'bg-nexus-600/20 text-nexus-400 border-nexus-500/30'
                  : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
              )}
            >
              All Types
            </button>
            {ACTIVITY_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(filterType === type ? null : type)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                  filterType === type
                    ? badgePillColors[type]
                    : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
                )}
              >
                <span>{activityTypeIcons[type]}</span>
                {type.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-500">
          {total} result{total !== 1 ? 's' : ''} found
          {debouncedQuery && (
            <span className="text-gray-600"> for &quot;{debouncedQuery}&quot;</span>
          )}
        </span>
        <button
          onClick={handleExport}
          disabled={activities.length === 0}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export JSON
        </button>
      </div>

      {/* Results list */}
      {loading && activities.length === 0 ? (
        <div className="text-gray-500 text-sm py-12 text-center">Searching...</div>
      ) : (
        <div className="space-y-2">
          {activities.map((activity) => (
            <div
              key={activity.id}
              className={cn(
                'flex items-start gap-4 p-4 rounded-xl border transition-all',
                activityTypeBgColors[activity.type]
              )}
            >
              {/* Icon */}
              <div className="text-xl mt-0.5 flex-shrink-0">
                {activityTypeIcons[activity.type]}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm">{activity.agent.avatar}</span>
                  <span className="text-sm font-semibold text-white">
                    {activity.agent.displayName}
                  </span>
                  <span
                    className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider bg-white/5',
                      activityTypeColors[activity.type]
                    )}
                  >
                    {activity.type.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-sm text-gray-300">
                  {highlightText(activity.message, debouncedQuery)}
                </p>
              </div>

              {/* Timestamp */}
              <div className="text-xs text-gray-600 whitespace-nowrap flex-shrink-0 mt-1">
                {timeAgo(activity.createdAt)}
              </div>
            </div>
          ))}
          {activities.length === 0 && !loading && (
            <div className="text-center text-gray-500 py-12">
              {debouncedQuery ? 'No results match your search' : 'No activities found'}
            </div>
          )}
        </div>
      )}

      {/* Load more */}
      {activities.length < total && (
        <div className="flex justify-center mt-6">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="px-6 py-2.5 rounded-lg text-sm font-medium bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-all disabled:opacity-40"
          >
            {loading ? 'Loading...' : `Load more (${activities.length} of ${total})`}
          </button>
        </div>
      )}
    </div>
  );
}
