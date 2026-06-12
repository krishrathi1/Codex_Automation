import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Header } from '../components/layout/Header';
import { api } from '@/lib/api';
import type { Agent, Command } from '@/types';
import { cn, timeAgo, statusColors } from '@/lib/utils';
import { useAgentStore } from '@/stores/agent-store';

function AgentControlCard({ agent, onCommandSent }: { agent: Agent; onCommandSent: () => void }) {
  const [soulMd, setSoulMd] = useState(agent.soulMd ?? '');
  const [soulOpen, setSoulOpen] = useState(false);
  const [heartbeatInterval, setHeartbeatInterval] = useState(agent.heartbeatInterval);
  const [enabled, setEnabled] = useState(agent.enabled);
  const [injectOpen, setInjectOpen] = useState(false);
  const [injectText, setInjectText] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commands, setCommands] = useState<Command[]>([]);
  const [savingSoul, setSavingSoul] = useState(false);
  const [savingHb, setSavingHb] = useState(false);
  const [sendingCmd, setSendingCmd] = useState<string | null>(null);
  const updateAgent = useAgentStore((s) => s.updateAgent);

  const fetchCommands = useCallback(async () => {
    try {
      const cmds = await api.commands.list(agent.id);
      setCommands(cmds);
    } catch (err) {
      console.error('Failed to fetch commands:', err);
    }
  }, [agent.id]);

  useEffect(() => {
    if (historyOpen) fetchCommands();
  }, [historyOpen, fetchCommands]);

  // Sync local state with prop changes
  useEffect(() => {
    setEnabled(agent.enabled);
    setHeartbeatInterval(agent.heartbeatInterval);
  }, [agent.enabled, agent.heartbeatInterval]);

  const handleToggleEnabled = async () => {
    const newVal = !enabled;
    setEnabled(newVal);
    try {
      await api.agents.updateConfig(agent.id, { enabled: newVal });
      updateAgent({ id: agent.id, enabled: newVal });
    } catch (err) {
      setEnabled(!newVal);
      console.error('Failed to toggle enabled:', err);
    }
  };

  const handleSaveSoul = async () => {
    setSavingSoul(true);
    try {
      await api.agents.updateConfig(agent.id, { soulMd });
      updateAgent({ id: agent.id, soulMd });
    } catch (err) {
      console.error('Failed to save SOUL.md:', err);
    } finally {
      setSavingSoul(false);
    }
  };

  const handleUpdateHeartbeat = async () => {
    setSavingHb(true);
    try {
      await api.agents.updateConfig(agent.id, { heartbeatInterval });
      updateAgent({ id: agent.id, heartbeatInterval });
    } catch (err) {
      console.error('Failed to update heartbeat:', err);
    } finally {
      setSavingHb(false);
    }
  };

  const handleSendCommand = async (type: string, payload?: Record<string, unknown>) => {
    setSendingCmd(type);
    try {
      await api.commands.send({ agentId: agent.id, type, payload });
      onCommandSent();
      if (historyOpen) fetchCommands();
    } catch (err) {
      console.error('Failed to send command:', err);
    } finally {
      setSendingCmd(null);
    }
  };

  const handleInject = async () => {
    if (!injectText.trim()) return;
    await handleSendCommand('INJECT', { message: injectText });
    setInjectText('');
    setInjectOpen(false);
  };

  const statusDotColor = statusColors[agent.status] || 'bg-gray-500';

  return (
    <div className="rounded-xl border border-white/5 bg-surface-850 p-5 flex flex-col gap-4">
      {/* Header: avatar, name, status, toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{agent.avatar}</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">{agent.displayName}</span>
              <div className={cn('w-2 h-2 rounded-full', statusDotColor)} />
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">{agent.status}</span>
            </div>
            {agent.currentTask && (
              <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[250px]">
                {agent.currentTask}
              </p>
            )}
          </div>
        </div>

        {/* Edit link + Toggle switch */}
        <div className="flex items-center gap-2">
          <Link
            to={`/agents/${agent.id}/edit`}
            className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-gray-500 hover:text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
          >
            Edit
          </Link>
          <button
            onClick={handleToggleEnabled}
            className={cn(
              'relative w-11 h-6 rounded-full transition-colors duration-200',
              enabled ? 'bg-emerald-500' : 'bg-gray-600'
            )}
          >
            <div
              className={cn(
                'absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-200',
                enabled ? 'translate-x-5.5' : 'translate-x-0.5'
              )}
            />
          </button>
        </div>
      </div>

      {/* Command buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => handleSendCommand('PAUSE')}
          disabled={sendingCmd === 'PAUSE'}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all disabled:opacity-50"
        >
          {sendingCmd === 'PAUSE' ? 'Sending...' : 'Pause'}
        </button>
        <button
          onClick={() => handleSendCommand('RESUME')}
          disabled={sendingCmd === 'RESUME'}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all disabled:opacity-50"
        >
          {sendingCmd === 'RESUME' ? 'Sending...' : 'Resume'}
        </button>
        <button
          onClick={() => setInjectOpen(!injectOpen)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-nexus-500/15 text-nexus-400 border border-nexus-500/30 hover:bg-nexus-500/25 transition-all"
        >
          Inject Instruction
        </button>
      </div>

      {/* Inject instruction input */}
      {injectOpen && (
        <div className="flex gap-2">
          <input
            type="text"
            value={injectText}
            onChange={(e) => setInjectText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleInject()}
            placeholder="Type instruction to inject..."
            className="flex-1 px-3 py-2 rounded-lg bg-surface-900 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-nexus-500/50"
          />
          <button
            onClick={handleInject}
            disabled={!injectText.trim() || sendingCmd === 'INJECT'}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-nexus-600 text-white hover:bg-nexus-500 transition-all disabled:opacity-50"
          >
            {sendingCmd === 'INJECT' ? '...' : 'Send'}
          </button>
        </div>
      )}

      {/* Heartbeat interval */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 whitespace-nowrap">Heartbeat (min):</span>
        <input
          type="number"
          min={1}
          value={heartbeatInterval}
          onChange={(e) => setHeartbeatInterval(parseInt(e.target.value) || 1)}
          className="w-20 px-2 py-1 rounded-lg bg-surface-900 border border-white/10 text-sm text-white focus:outline-none focus:border-nexus-500/50"
        />
        <button
          onClick={handleUpdateHeartbeat}
          disabled={savingHb || heartbeatInterval === agent.heartbeatInterval}
          className="px-3 py-1 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-all disabled:opacity-40"
        >
          {savingHb ? 'Saving...' : 'Update'}
        </button>
      </div>

      {/* SOUL.md collapsible */}
      <div className="border border-white/5 rounded-lg overflow-hidden">
        <button
          onClick={() => setSoulOpen(!soulOpen)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-all"
        >
          <span>SOUL.md</span>
          <svg
            className={cn('w-4 h-4 transition-transform', soulOpen && 'rotate-180')}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {soulOpen && (
          <div className="px-3 pb-3 space-y-2">
            <textarea
              value={soulMd}
              onChange={(e) => setSoulMd(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 rounded-lg bg-surface-900 border border-white/10 text-sm text-gray-300 font-mono resize-y focus:outline-none focus:border-nexus-500/50"
              placeholder="Agent SOUL.md content..."
            />
            <div className="flex justify-end">
              <button
                onClick={handleSaveSoul}
                disabled={savingSoul}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-nexus-600 text-white hover:bg-nexus-500 transition-all disabled:opacity-50"
              >
                {savingSoul ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Command History collapsible */}
      <div className="border border-white/5 rounded-lg overflow-hidden">
        <button
          onClick={() => setHistoryOpen(!historyOpen)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-all"
        >
          <span>Command History</span>
          <svg
            className={cn('w-4 h-4 transition-transform', historyOpen && 'rotate-180')}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {historyOpen && (
          <div className="px-3 pb-3">
            {commands.length === 0 ? (
              <p className="text-xs text-gray-600 py-2">No commands sent yet</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {commands.map((cmd) => (
                  <div
                    key={cmd.id}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface-900 border border-white/5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded font-medium uppercase',
                          cmd.type === 'PAUSE'
                            ? 'bg-amber-500/15 text-amber-400'
                            : cmd.type === 'RESUME'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-nexus-500/15 text-nexus-400'
                        )}
                      >
                        {cmd.type}
                      </span>
                      {typeof cmd.payload?.message === 'string' && (
                        <span className="text-xs text-gray-500 truncate max-w-[160px]">
                          {cmd.payload.message}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded',
                          cmd.status === 'PENDING'
                            ? 'text-amber-400 bg-amber-500/10'
                            : cmd.status === 'DELIVERED'
                              ? 'text-blue-400 bg-blue-500/10'
                              : 'text-emerald-400 bg-emerald-500/10'
                        )}
                      >
                        {cmd.status}
                      </span>
                      <span className="text-[10px] text-gray-600">{timeAgo(cmd.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function AgentControls() {
  const { agents, fetchAgents } = useAgentStore();
  const [allCommands, setAllCommands] = useState<Command[]>([]);
  const [sendingAll, setSendingAll] = useState<string | null>(null);

  useEffect(() => {
    fetchAgents();
    fetchAllCommands();
  }, [fetchAgents]);

  const fetchAllCommands = async () => {
    try {
      const cmds = await api.commands.list();
      setAllCommands(cmds);
    } catch (err) {
      console.error('Failed to fetch commands:', err);
    }
  };

  const pendingCount = allCommands.filter((c) => c.status === 'PENDING').length;

  const handlePauseAll = async () => {
    setSendingAll('PAUSE');
    try {
      await Promise.all(
        agents.filter((a) => a.enabled).map((a) => api.commands.send({ agentId: a.id, type: 'PAUSE' }))
      );
      fetchAllCommands();
    } catch (err) {
      console.error('Failed to pause all:', err);
    } finally {
      setSendingAll(null);
    }
  };

  const handleResumeAll = async () => {
    setSendingAll('RESUME');
    try {
      await Promise.all(
        agents.filter((a) => a.enabled).map((a) => api.commands.send({ agentId: a.id, type: 'RESUME' }))
      );
      fetchAllCommands();
    } catch (err) {
      console.error('Failed to resume all:', err);
    } finally {
      setSendingAll(null);
    }
  };

  return (
    <div>
      <Header title="Agent Controls" subtitle="Human-in-the-loop command center" />

      {/* Quick Action Bar */}
      <div className="flex items-center gap-4 mb-6 p-4 rounded-xl border border-white/5 bg-surface-850">
        <button
          onClick={handlePauseAll}
          disabled={sendingAll === 'PAUSE'}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all disabled:opacity-50"
        >
          {sendingAll === 'PAUSE' ? 'Pausing...' : 'Pause All'}
        </button>
        <button
          onClick={handleResumeAll}
          disabled={sendingAll === 'RESUME'}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all disabled:opacity-50"
        >
          {sendingAll === 'RESUME' ? 'Resuming...' : 'Resume All'}
        </button>
        <Link
          to="/agents/new"
          className="px-4 py-2 rounded-lg text-sm font-medium bg-nexus-600 text-white hover:bg-nexus-500 transition-all"
        >
          + Create Agent
        </Link>
        <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
          <div className={cn('w-2 h-2 rounded-full', pendingCount > 0 ? 'bg-amber-500 animate-pulse-dot' : 'bg-gray-600')} />
          <span className="text-sm text-gray-400">
            <span className="text-white font-medium">{pendingCount}</span> pending command{pendingCount !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Agent Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {agents.map((agent) => (
          <AgentControlCard
            key={agent.id}
            agent={agent}
            onCommandSent={fetchAllCommands}
          />
        ))}
      </div>

      {agents.length === 0 && (
        <div className="rounded-xl border border-dashed border-nexus-500/30 bg-nexus-500/5 p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-nexus-600/20 flex items-center justify-center text-2xl text-nexus-400 mx-auto mb-3">+</div>
          <h3 className="text-lg font-semibold text-white mb-2">No Agents Yet</h3>
          <p className="text-sm text-gray-400 mb-5">
            Create your first agent to start monitoring and controlling it from here.
          </p>
          <Link
            to="/agents/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-nexus-600 text-white hover:bg-nexus-500 transition-all"
          >
            Create Agent
          </Link>
        </div>
      )}
    </div>
  );
}
