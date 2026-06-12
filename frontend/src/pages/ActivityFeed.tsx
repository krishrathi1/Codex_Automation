import { useEffect } from 'react';
import { Header } from '../components/layout/Header';
import { ActivityItem } from '../components/activity/ActivityItem';
import { ActivityFilters } from '../components/activity/ActivityFilters';
import { useActivityStore } from '../stores/activity-store';

export function ActivityFeed() {
  const { activities, total, loading, filterAgent, filterType, fetchActivities } = useActivityStore();

  useEffect(() => {
    fetchActivities({
      agentId: filterAgent || undefined,
      type: filterType || undefined,
      limit: 100,
    });
  }, [fetchActivities, filterAgent, filterType]);

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
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse-dot" />
          <span className="text-xs text-gray-500">Live updates</span>
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
