import type { Activity } from '../../types';
import { activityTypeIcons, activityTypeColors, activityTypeBgColors, timeAgo, stripMarkdown } from '../../lib/utils';

export function ActivityItem({ activity }: { activity: Activity }) {
  return (
    <div className={`flex items-start gap-4 p-4 rounded-xl border animate-slide-in ${activityTypeBgColors[activity.type]}`}>
      {/* Icon */}
      <div className="text-xl mt-0.5 flex-shrink-0">{activityTypeIcons[activity.type]}</div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm">{activity.agent.avatar}</span>
          <span className="text-sm font-semibold text-white">{activity.agent.displayName}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider ${activityTypeColors[activity.type]} bg-white/5`}>
            {activity.type.replace('_', ' ')}
          </span>
        </div>
        <p className="text-sm text-gray-300">{stripMarkdown(activity.message)}</p>
      </div>

      {/* Timestamp */}
      <div className="text-xs text-gray-600 whitespace-nowrap flex-shrink-0 mt-1">
        {timeAgo(activity.createdAt)}
      </div>
    </div>
  );
}
