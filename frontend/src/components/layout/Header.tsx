import type { ReactNode } from 'react';
import { useAgentStore } from '../../stores/agent-store';

export function Header({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  const stats = useAgentStore((s) => s.stats);

  return (
    <header className="flex items-center justify-between py-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-4">
      {action}
      {stats && (
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse-dot" />
            <span className="text-emerald-400 font-medium">{stats.online} Online</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-amber-400 font-medium">{stats.idle} Idle</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
            <span className="text-gray-400"><span className="text-white font-medium">{stats.activeTasks}</span> Active Tasks</span>
          </div>
        </div>
      )}
      </div>
    </header>
  );
}
