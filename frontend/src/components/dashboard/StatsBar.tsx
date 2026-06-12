import { useAgentStore } from '../../stores/agent-store';

const statItems = [
  { key: 'total' as const, label: 'Total Agents', color: 'text-white', bg: 'bg-white/5 border-white/10' },
  { key: 'online' as const, label: 'Online', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  { key: 'idle' as const, label: 'Idle', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  { key: 'error' as const, label: 'Errors', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
  { key: 'recentActivities' as const, label: 'Events (1h)', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
  { key: 'activeTasks' as const, label: 'Active Tasks', color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20' },
];

export function StatsBar() {
  const stats = useAgentStore((s) => s.stats);

  if (!stats) return null;

  return (
    <div className="grid grid-cols-6 gap-4">
      {statItems.map((item) => (
        <div key={item.key} className={`rounded-xl border p-4 ${item.bg}`}>
          <div className={`text-3xl font-bold ${item.color}`}>{stats[item.key]}</div>
          <div className="text-xs text-gray-500 mt-1 uppercase tracking-wider">{item.label}</div>
        </div>
      ))}
    </div>
  );
}
