import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useEffect } from 'react';
import { getSocket, connectSocket, disconnectSocket } from '../../lib/socket';
import { useAuthStore } from '../../stores/auth-store';
import { useAgentStore } from '../../stores/agent-store';
import { useActivityStore } from '../../stores/activity-store';
import { useTaskStore } from '../../stores/task-store';
import type { Activity, Agent, Task } from '../../types';

export function Layout() {
  const { fetchAgents, fetchStats, updateAgent } = useAgentStore();
  const addActivity = useActivityStore((s) => s.addActivity);
  const { setTask, removeTask } = useTaskStore();
  const { accessToken, isAuthenticated } = useAuthStore();

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

    s.on('agent:status', (agent: Agent) => {
      updateAgent(agent);
    });

    s.on('agent:heartbeat', (agent: Agent) => {
      updateAgent(agent);
    });

    s.on('activity:new', (activity: Activity) => {
      addActivity(activity);
    });

    s.on('task:update', (task: Task) => {
      setTask(task);
    });

    s.on('task:delete', ({ id }: { id: string }) => {
      removeTask(id);
    });

    // Agent-to-agent messaging events (real-time monitoring across the app)
    s.on('agent:message', () => {
      // Trigger a stats refresh so dashboard counters update
      fetchStats();
    });

    return () => {
      s.off('agent:status');
      s.off('agent:heartbeat');
      s.off('activity:new');
      s.off('task:update');
      s.off('task:delete');
      s.off('agent:message');
    };
  }, [updateAgent, addActivity, setTask, removeTask]);

  return (
    <div className="min-h-screen">
      <Sidebar />
      <main className="ml-64 px-8 pb-8">
        <Outlet />
      </main>
    </div>
  );
}
