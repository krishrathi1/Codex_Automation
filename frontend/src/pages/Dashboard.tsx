import { useAgentStore } from '../stores/agent-store';
import { Header } from '../components/layout/Header';
import { StatsBar } from '../components/dashboard/StatsBar';
import { AgentCard } from '../components/dashboard/AgentCard';
import { SystemHealth } from '../components/dashboard/SystemHealth';

export function Dashboard() {
  const { agents, loading } = useAgentStore();

  return (
    <div>
      <Header title="Dashboard" subtitle="Real-time overview of your agent squad" />

      {/* Stats */}
      <StatsBar />

      {/* Main content */}
      <div className="mt-6 grid grid-cols-3 gap-6">
        {/* Agent cards */}
        <div className="col-span-2">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Agents</h3>
          {loading ? (
            <div className="text-gray-500 text-sm">Loading agents...</div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Live Feed</h3>
          <SystemHealth />
        </div>
      </div>
    </div>
  );
}
