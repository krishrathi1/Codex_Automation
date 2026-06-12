import { useAgentStore } from '../../stores/agent-store';
import { useActivityStore } from '../../stores/activity-store';
import { cn } from '../../lib/utils';
import type { ActivityType } from '../../types';

const activityTypes: Array<{ value: ActivityType | null; label: string }> = [
  { value: null, label: 'All' },
  { value: 'HEARTBEAT', label: 'Heartbeat' },
  { value: 'TASK_START', label: 'Task Start' },
  { value: 'TASK_COMPLETE', label: 'Completed' },
  { value: 'ERROR', label: 'Errors' },
  { value: 'ALERT', label: 'Alerts' },
  { value: 'DELEGATION', label: 'Delegation' },
  { value: 'MESSAGE', label: 'Messages' },
];

export function ActivityFilters() {
  const agents = useAgentStore((s) => s.agents);
  const { filterAgent, filterType, setFilterAgent, setFilterType, fetchActivities } = useActivityStore();

  const applyFilters = (agentId: string | null, type: ActivityType | null) => {
    setFilterAgent(agentId);
    setFilterType(type);
    fetchActivities({
      agentId: agentId || undefined,
      type: type || undefined,
      limit: 100,
    });
  };

  return (
    <div className="space-y-3">
      {/* Agent filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 uppercase tracking-wider w-14">Agent:</span>
        <button
          onClick={() => applyFilters(null, filterType)}
          className={cn(
            'px-3 py-1 rounded-lg text-xs font-medium transition-colors',
            !filterAgent ? 'bg-nexus-600/20 text-nexus-400 border border-nexus-500/30' : 'text-gray-400 hover:text-white hover:bg-white/5'
          )}
        >
          All
        </button>
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => applyFilters(agent.id, filterType)}
            className={cn(
              'px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5',
              filterAgent === agent.id ? 'bg-nexus-600/20 text-nexus-400 border border-nexus-500/30' : 'text-gray-400 hover:text-white hover:bg-white/5'
            )}
          >
            <span className="text-sm">{agent.avatar}</span>
            {agent.displayName}
          </button>
        ))}
      </div>

      {/* Type filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 uppercase tracking-wider w-14">Type:</span>
        {activityTypes.map((type) => (
          <button
            key={type.value || 'all'}
            onClick={() => applyFilters(filterAgent, type.value)}
            className={cn(
              'px-3 py-1 rounded-lg text-xs font-medium transition-colors',
              filterType === type.value ? 'bg-nexus-600/20 text-nexus-400 border border-nexus-500/30' : 'text-gray-400 hover:text-white hover:bg-white/5'
            )}
          >
            {type.label}
          </button>
        ))}
      </div>
    </div>
  );
}
