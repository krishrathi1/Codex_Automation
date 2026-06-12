import { useActivityStore } from '../../stores/activity-store';
import { activityTypeIcons, activityTypeColors, timeAgo } from '../../lib/utils';
import { useEffect } from 'react';

export function SystemHealth() {
  const { activities, fetchActivities } = useActivityStore();

  useEffect(() => {
    fetchActivities({ limit: 8 });
  }, [fetchActivities]);

  return (
    <div className="rounded-xl border border-white/5 bg-surface-850 p-5">
      <h3 className="text-sm font-semibold text-white mb-4">Recent Activity</h3>
      <div className="space-y-3">
        {activities.slice(0, 8).map((activity) => (
          <div key={activity.id} className="flex items-start gap-3 animate-slide-in">
            <span className="text-sm mt-0.5">{activityTypeIcons[activity.type]}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-300">{activity.agent.displayName}</span>
                <span className={`text-[10px] uppercase tracking-wider font-medium ${activityTypeColors[activity.type]}`}>
                  {activity.type.replace('_', ' ')}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{activity.message}</p>
            </div>
            <span className="text-[10px] text-gray-600 whitespace-nowrap">{timeAgo(activity.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
