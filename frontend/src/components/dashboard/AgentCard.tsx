import { Link } from 'react-router-dom';
import type { Agent } from '../../types';
import { statusColors, statusTextColors, timeAgo, cn } from '../../lib/utils';

export function AgentCard({ agent }: { agent: Agent }) {
  const isOnline = agent.status === 'ONLINE';

  return (
    <Link
      to={`/agents/${agent.id}`}
      className={cn(
        'block rounded-xl border p-5 transition-all duration-300 hover:scale-[1.02] hover:border-nexus-500/30',
        'bg-surface-850 border-white/5',
        isOnline && 'border-emerald-500/15'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{agent.avatar}</span>
          <div>
            <h3 className="font-semibold text-white text-sm">{agent.displayName}</h3>
            <span className="text-xs text-gray-500 font-mono">{agent.name}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn('w-2.5 h-2.5 rounded-full', statusColors[agent.status], isOnline && 'animate-pulse-dot')} />
          <span className={cn('text-xs font-medium', statusTextColors[agent.status])}>{agent.status}</span>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-gray-500 mb-4 line-clamp-2">{agent.description}</p>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-white/5">
        <div className="text-xs text-gray-600">
          {agent.heartbeatInterval > 0 ? (
            <>
              <span className="text-gray-500">Heartbeat:</span> every {agent.heartbeatInterval}m
            </>
          ) : (
            <span className="text-gray-500">Always on</span>
          )}
        </div>
        <div className="text-xs text-gray-600">
          {agent.lastHeartbeat ? timeAgo(agent.lastHeartbeat) : '—'}
        </div>
      </div>

      {/* Current task */}
      {agent.currentTask && (
        <div className="mt-3 px-2.5 py-1.5 rounded-md bg-nexus-600/10 border border-nexus-500/20">
          <span className="text-xs text-nexus-400">{agent.currentTask}</span>
        </div>
      )}
    </Link>
  );
}
