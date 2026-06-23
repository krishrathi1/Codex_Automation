import { Link, Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useEffect, useState } from 'react';
import { getSocket, connectSocket, disconnectSocket } from '../../lib/socket';
import { useAuthStore } from '../../stores/auth-store';
import { useAgentStore } from '../../stores/agent-store';
import { useActivityStore } from '../../stores/activity-store';
import { useTaskStore } from '../../stores/task-store';
import type { Activity, Agent, AlertEvent, Task } from '../../types';

export function Layout() {
  const { fetchAgents, fetchStats, updateAgent, removeAgent: removeAgentFromStore } = useAgentStore();
  const addActivity = useActivityStore((s) => s.addActivity);
  const { setTask, removeTask } = useTaskStore();
  const { accessToken, isAuthenticated } = useAuthStore();
  const [liveAlerts, setLiveAlerts] = useState<AlertEvent[]>([]);
  const dismissAlert = (id: string) => {
    setLiveAlerts((prev) => prev.filter((alert) => alert.id !== id));
  };

  useEffect(() => {
    fetchAgents();
    fetchStats();

    // Refresh stats periodically
    const interval = setInterval(() => {
      fetchStats();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchAgents, fetchStats]);

  // Connect socket with auth token
  useEffect(() => {
    if (isAuthenticated && accessToken) {
      connectSocket(accessToken);
    }

    return () => {
      disconnectSocket();
    };
  }, [isAuthenticated, accessToken]);

  useEffect(() => {
    const s = getSocket();

    const handleNewAlert = (alert: AlertEvent) => {
      setLiveAlerts((prev) => [alert, ...prev.filter((item) => item.id !== alert.id)].slice(0, 3));
      window.setTimeout(() => dismissAlert(alert.id), 12000);
    };
    // Named handlers so cleanup removes ONLY our listeners. `off(event)` with no
    // handler would wipe listeners other components register on the shared socket.
    const handleAgentStatus = (agent: Agent) => updateAgent(agent);
    const handleAgentHeartbeat = (agent: Agent) => updateAgent(agent);
    const handleActivityNew = (activity: Activity) => addActivity(activity);
    const handleTaskUpdate = (task: Task) => setTask(task);
    const handleTaskDelete = ({ id }: { id: string }) => removeTask(id);
    const handleAgentMessage = () => fetchStats();
    const handleAgentDeleted = ({ id }: { id: string }) => {
      removeAgentFromStore(id);
      fetchStats();
    };

    s.on('agent:status', handleAgentStatus);
    s.on('agent:heartbeat', handleAgentHeartbeat);
    s.on('activity:new', handleActivityNew);
    s.on('task:update', handleTaskUpdate);
    s.on('task:delete', handleTaskDelete);
    s.on('agent:message', handleAgentMessage);
    s.on('agent:deleted', handleAgentDeleted);
    s.on('alert:new', handleNewAlert);

    return () => {
      s.off('agent:status', handleAgentStatus);
      s.off('agent:heartbeat', handleAgentHeartbeat);
      s.off('activity:new', handleActivityNew);
      s.off('task:update', handleTaskUpdate);
      s.off('task:delete', handleTaskDelete);
      s.off('agent:message', handleAgentMessage);
      s.off('agent:deleted', handleAgentDeleted);
      s.off('alert:new', handleNewAlert);
    };
  }, [updateAgent, addActivity, setTask, removeTask, removeAgentFromStore, fetchStats]);

  return (
    <div className="min-h-screen">
      <Sidebar />
      <main className="ml-64 px-8 pb-8">
        <Outlet />
      </main>
      {liveAlerts.length > 0 && (
        <div className="fixed right-6 top-4 z-50 w-[420px] max-w-[calc(100vw-2rem)] space-y-3">
          {liveAlerts.map((alert) => (
            <div
              key={alert.id}
              className="rounded-xl border border-red-500/30 bg-surface-850 p-4 shadow-2xl shadow-black/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-red-400" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-red-200">
                      Live alert
                    </span>
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-gray-400">
                      {alert.severity}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm leading-5 text-gray-200">{alert.message}</p>
                  <Link
                    to="/alerts"
                    className="mt-3 inline-flex text-xs font-medium text-nexus-300 hover:text-nexus-200"
                  >
                    Review alerts
                  </Link>
                </div>
                <button
                  type="button"
                  onClick={() => dismissAlert(alert.id)}
                  className="text-lg leading-none text-gray-500 hover:text-white"
                  aria-label="Dismiss alert"
                >
                  &times;
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
