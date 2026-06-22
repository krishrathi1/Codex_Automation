import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { ActivityItem } from '../components/activity/ActivityItem';
import { ActivityFilters } from '../components/activity/ActivityFilters';
import { useActivityStore } from '../stores/activity-store';

export function ActivityFeed() {
  const { activities, total, loading, filterAgent, filterType, fetchActivities, clearActivities } = useActivityStore();
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    fetchActivities({
      agentId: filterAgent || undefined,
      type: filterType || undefined,
      limit: 100,
    });
  }, [fetchActivities, filterAgent, filterType]);

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearActivities();
    } finally {
      setClearing(false);
      setConfirming(false);
    }
  };

  return (
    <div>
      <Header title="Activity Feed" subtitle="Real-time stream of agent events and actions" />

      {/* Filters */}
      <div className="rounded-xl border border-white/5 bg-surface-850 p-4 mb-6">
        <ActivityFilters />
      </div>

      {/* Count */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-500">{total} events total</span>
        <div className="flex items-center gap-4">
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">
                Clear {filterAgent || filterType ? 'filtered ' : 'all '}history?
              </span>
              <button
                type="button"
                onClick={handleClear}
                disabled={clearing}
                className="rounded-lg bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                {clearing ? 'Clearing…' : 'Confirm'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={clearing}
                className="rounded-lg px-2.5 py-1 text-xs font-medium text-gray-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={total === 0}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs font-medium text-gray-400 transition-colors hover:border-red-500/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear history
            </button>
          )}
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse-dot" />
            <span className="text-xs text-gray-500">Live updates</span>
          </div>
        </div>
      </div>

      {/* Feed */}
      {loading ? (
        <div className="text-gray-500 text-sm">Loading activity...</div>
      ) : (
        <div className="space-y-3">
          {activities.map((activity) => (
            <ActivityItem key={activity.id} activity={activity} />
          ))}
          {activities.length === 0 && (
            <div className="text-center text-gray-500 py-12">No activities found</div>
          )}
        </div>
      )}
    </div>
  );
}
