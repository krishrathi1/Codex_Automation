import { Link } from 'react-router-dom';
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
              {agents.length === 0 && (
                <div className="col-span-2 rounded-xl border border-dashed border-nexus-500/30 bg-nexus-500/5 p-12 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-nexus-600/20 flex items-center justify-center text-3xl text-nexus-400 mx-auto mb-4">+</div>
                  <h3 className="text-lg font-semibold text-white mb-2">Create Your First Agent</h3>
                  <p className="text-sm text-gray-400 mb-6 max-w-md mx-auto">
                    Set up an AI agent in under a minute. Give it a name, personality, and let it start working.
                  </p>
                  <Link
                    to="/agents/new"
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold bg-nexus-600 text-white hover:bg-nexus-500 transition-all shadow-lg shadow-nexus-600/20"
                  >
                    Create Agent
                  </Link>
                </div>
              )}
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
