import type { Activity } from '../../types';
import { activityTypeIcons, activityTypeColors, timeAgo } from '../../lib/utils';

export function AgentActivity({ activities }: { activities: Activity[] }) {
  return (
    <div className="rounded-xl border border-white/5 bg-surface-850 p-5">
      <h3 className="text-sm font-semibold text-white mb-4">Recent Activity</h3>
      <div className="space-y-3 max-h-[500px] overflow-y-auto">
        {activities.map((activity) => (
          <div key={activity.id} className="flex items-start gap-3">
            <span className="text-sm mt-0.5">{activityTypeIcons[activity.type]}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] uppercase tracking-wider font-medium ${activityTypeColors[activity.type]}`}>
                  {activity.type.replace('_', ' ')}
                </span>
                <span className="text-[10px] text-gray-600">{timeAgo(activity.createdAt)}</span>
              </div>
              <p className="text-sm text-gray-300 mt-0.5">{activity.message}</p>
            </div>
          </div>
        ))}
        {activities.length === 0 && (
          <p className="text-sm text-gray-600">No recent activity</p>
        )}
      </div>
    </div>
  );
}
