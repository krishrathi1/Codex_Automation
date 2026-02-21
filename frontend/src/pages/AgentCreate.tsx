import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Agent, Gateway, McpServer, McpTool } from '@/types';

interface McpServerWithTools extends McpServer {
  tools?: McpTool[];
  _loadingTools?: boolean;
  _expanded?: boolean;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function AgentCreate() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = Boolean(id);

  // Form state
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [avatar, setAvatar] = useState('');
  const [heartbeatInterval, setHeartbeatInterval] = useState(30);
  const [enabled, setEnabled] = useState(true);
  const [soulMd, setSoulMd] = useState('');
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [gatewayId, setGatewayId] = useState('');
  const [gateways, setGateways] = useState<Gateway[]>([]);

  // MCP state
  const [mcpServers, setMcpServers] = useState<McpServerWithTools[]>([]);
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpUrl, setNewMcpUrl] = useState('');
  const [newMcpTransport, setNewMcpTransport] = useState<'SSE' | 'STREAMABLE_HTTP'>('SSE');
  const [addingMcp, setAddingMcp] = useState(false);
  const [refreshingServer, setRefreshingServer] = useState<string | null>(null);
  const [deletingServer, setDeletingServer] = useState<string | null>(null);

  // General state
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load gateways
  useEffect(() => {
    api.gateways.list().then(setGateways).catch(() => {});
  }, []);

  // Load agent data in edit mode
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.agents
      .get(id)
      .then((agent: Agent) => {
        setName(agent.name);
        setDisplayName(agent.displayName);
        setDescription(agent.description || '');
        setWorkspace(agent.workspace || '');
        setAvatar(agent.avatar || '');
        setHeartbeatInterval(agent.heartbeatInterval);
        setEnabled(agent.enabled);
        setSoulMd(agent.soulMd || '');
        setGatewayId(agent.gatewayId || '');
        setNameManuallyEdited(true);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  // Load MCP servers in edit mode
  const fetchMcpServers = useCallback(async () => {
    if (!id) return;
    try {
      const servers = (await api.mcp.list(id)) as McpServer[];
      setMcpServers(servers.map((s) => ({ ...s, _loadingTools: false, _expanded: false })));
    } catch (err) {
      console.error('Failed to fetch MCP servers:', err);
    }
  }, [id]);

  useEffect(() => {
    fetchMcpServers();
  }, [fetchMcpServers]);

  // Auto-generate name from displayName
  const handleDisplayNameChange = (value: string) => {
    setDisplayName(value);
    if (!nameManuallyEdited) {
      setName(toSlug(value));
    }
  };

  const handleNameChange = (value: string) => {
    setNameManuallyEdited(true);
    setName(toSlug(value));
  };

  // Form submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !displayName.trim()) {
      setError('Name and Display Name are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const data = {
        name: name.trim(),
        displayName: displayName.trim(),
        description: description.trim(),
        workspace: workspace.trim() || undefined,
        avatar: avatar.trim() || undefined,
        heartbeatInterval,
        enabled,
        soulMd: soulMd.trim() || undefined,
        gatewayId: gatewayId || undefined,
      };
      if (isEditMode && id) {
        await api.agents.update(id, data);
        navigate(`/agents/${id}`);
      } else {
        const created = (await api.agents.create(data)) as Agent;
        navigate(`/agents/${created.id}`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save agent');
    } finally {
      setSaving(false);
    }
  };

  // Delete agent
  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await api.agents.delete(id);
      navigate('/controls');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete agent');
      setDeleting(false);
    }
  };

  // MCP server operations
  const handleAddMcpServer = async () => {
    if (!id || !newMcpName.trim() || !newMcpUrl.trim()) return;
    setAddingMcp(true);
    try {
      await api.mcp.add(id, {
        name: newMcpName.trim(),
        url: newMcpUrl.trim(),
        transport: newMcpTransport,
      });
      setNewMcpName('');
      setNewMcpUrl('');
      setNewMcpTransport('SSE');
      setShowAddMcp(false);
      await fetchMcpServers();
    } catch (err) {
      console.error('Failed to add MCP server:', err);
    } finally {
      setAddingMcp(false);
    }
  };

  const handleRefreshTools = async (serverId: string) => {
    if (!id) return;
    setRefreshingServer(serverId);
    try {
      await api.mcp.refreshTools(id, serverId);
      const tools = (await api.mcp.tools(id, serverId)) as McpTool[];
      setMcpServers((prev) =>
        prev.map((s) => (s.id === serverId ? { ...s, tools, _expanded: true } : s))
      );
    } catch (err) {
      console.error('Failed to refresh tools:', err);
    } finally {
      setRefreshingServer(null);
    }
  };

  const handleToggleMcpEnabled = async (serverId: string, currentEnabled: boolean) => {
    if (!id) return;
    try {
      await api.mcp.update(id, serverId, { enabled: !currentEnabled });
      setMcpServers((prev) =>
        prev.map((s) => (s.id === serverId ? { ...s, enabled: !currentEnabled } : s))
      );
    } catch (err) {
      console.error('Failed to toggle MCP server:', err);
    }
  };

  const handleDeleteMcpServer = async (serverId: string) => {
    if (!id) return;
    setDeletingServer(serverId);
    try {
      await api.mcp.remove(id, serverId);
      setMcpServers((prev) => prev.filter((s) => s.id !== serverId));
    } catch (err) {
      console.error('Failed to delete MCP server:', err);
    } finally {
      setDeletingServer(null);
    }
  };

  const handleToggleExpand = async (serverId: string) => {
    const server = mcpServers.find((s) => s.id === serverId);
    if (!server) return;
    // If expanding and no tools loaded yet, load them
    if (!server._expanded && !server.tools && id) {
      setMcpServers((prev) =>
        prev.map((s) => (s.id === serverId ? { ...s, _loadingTools: true } : s))
      );
      try {
        const tools = (await api.mcp.tools(id, serverId)) as McpTool[];
        setMcpServers((prev) =>
          prev.map((s) =>
            s.id === serverId ? { ...s, tools, _loadingTools: false, _expanded: true } : s
          )
        );
      } catch (err) {
        console.error('Failed to load tools:', err);
        setMcpServers((prev) =>
          prev.map((s) => (s.id === serverId ? { ...s, _loadingTools: false, _expanded: true } : s))
        );
      }
    } else {
      setMcpServers((prev) =>
        prev.map((s) => (s.id === serverId ? { ...s, _expanded: !s._expanded } : s))
      );
    }
  };

  if (loading) {
    return (
      <div>
        <Header title={isEditMode ? 'Edit Agent' : 'Create Agent'} subtitle="Loading..." />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-nexus-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header with breadcrumb */}
      <header className="py-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <Link to="/controls" className="hover:text-gray-300 transition-colors">
            Agent Controls
          </Link>
          <span>/</span>
          <span className="text-gray-400">{isEditMode ? 'Edit Agent' : 'Create Agent'}</span>
        </div>
        <h2 className="text-2xl font-bold text-white">
          {isEditMode ? 'Edit Agent' : 'Create Agent'}
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          {isEditMode
            ? 'Modify agent configuration, personality, and MCP server connections'
            : 'Configure a new AI agent with personality, workspace, and tool connections'}
        </p>
      </header>

      {/* Error banner */}
      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 ml-4">
            Dismiss
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="flex gap-6">
          {/* Left column: Form + SOUL.md */}
          <div className={cn('flex flex-col gap-6', isEditMode ? 'w-2/3' : 'w-full max-w-3xl')}>
            {/* Agent Form Card */}
            <div className="rounded-xl border border-white/5 bg-surface-850 p-5">
              <h3 className="text-sm font-semibold text-white mb-4">Agent Details</h3>
              <div className="grid grid-cols-2 gap-4">
                {/* Display Name */}
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => handleDisplayNameChange(e.target.value)}
                    placeholder="My Agent"
                    className="w-full px-3 py-2 rounded-lg bg-surface-900 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-nexus-500/50"
                    required
                  />
                </div>

                {/* Name (slug) */}
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Name{' '}
                    <span className="text-gray-600 font-normal">(identifier, lowercase + hyphens)</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="my-agent"
                    className="w-full px-3 py-2 rounded-lg bg-surface-900 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-nexus-500/50 font-mono"
                    required
                  />
                </div>

                {/* Description */}
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What does this agent do?"
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg bg-surface-900 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-nexus-500/50 resize-y"
                  />
                </div>

                {/* Workspace */}
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Workspace <span className="text-gray-600 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={workspace}
                    onChange={(e) => setWorkspace(e.target.value)}
                    placeholder="/home/ubuntu/project"
                    className="w-full px-3 py-2 rounded-lg bg-surface-900 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-nexus-500/50 font-mono"
                  />
                </div>

                {/* Gateway */}
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Gateway <span className="text-gray-600 font-normal">(OpenClaw instance)</span>
                  </label>
                  <select
                    value={gatewayId}
                    onChange={(e) => setGatewayId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-surface-900 border border-white/10 text-sm text-white focus:outline-none focus:border-nexus-500/50"
                  >
                    <option value="">No gateway</option>
                    {gateways.map((gw) => (
                      <option key={gw.id} value={gw.id}>
                        {gw.name} {gw.status === 'ONLINE' ? '' : `(${gw.status.toLowerCase()})`}
                      </option>
                    ))}
                  </select>
                  {gateways.length === 0 && (
                    <p className="text-[11px] text-gray-600 mt-1">
                      No gateways configured.{' '}
                      <Link to="/gateways" className="text-nexus-400 hover:text-nexus-300">
                        Add one
                      </Link>
                    </p>
                  )}
                </div>

                {/* Avatar */}
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Avatar <span className="text-gray-600 font-normal">(emoji)</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      value={avatar}
                      onChange={(e) => setAvatar(e.target.value)}
                      placeholder="e.g. robot face emoji"
                      maxLength={4}
                      className="w-24 px-3 py-2 rounded-lg bg-surface-900 border border-white/10 text-sm text-white text-center placeholder-gray-500 focus:outline-none focus:border-nexus-500/50 text-lg"
                    />
                    {avatar && <span className="text-2xl">{avatar}</span>}
                  </div>
                </div>

                {/* Heartbeat Interval */}
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Heartbeat Interval <span className="text-gray-600 font-normal">(minutes)</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={heartbeatInterval}
                    onChange={(e) => setHeartbeatInterval(parseInt(e.target.value) || 1)}
                    className="w-32 px-3 py-2 rounded-lg bg-surface-900 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-nexus-500/50"
                  />
                </div>

                {/* Enabled toggle */}
                <div className="col-span-1 flex items-end pb-1">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <button
                      type="button"
                      onClick={() => setEnabled(!enabled)}
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
                    <span className="text-xs font-medium text-gray-400">
                      {enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* SOUL.md Editor */}
            <div className="rounded-xl border border-white/5 bg-surface-850 p-5">
              <h3 className="text-sm font-semibold text-white mb-1">
                SOUL.md
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                Agent personality and instructions
              </p>
              <textarea
                value={soulMd}
                onChange={(e) => setSoulMd(e.target.value)}
                rows={14}
                placeholder="# Agent Personality&#10;&#10;Define who this agent is, how it behaves, and what instructions it should follow..."
                className="w-full px-4 py-3 rounded-lg bg-surface-900 border border-white/10 text-sm text-gray-300 font-mono resize-y focus:outline-none focus:border-nexus-500/50 leading-relaxed"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2.5 rounded-lg text-sm font-medium bg-nexus-600 text-white hover:bg-nexus-500 transition-all disabled:opacity-50"
              >
                {saving
                  ? 'Saving...'
                  : isEditMode
                    ? 'Save Changes'
                    : 'Create Agent'}
              </button>
              <Link
                to="/controls"
                className="px-6 py-2.5 rounded-lg text-sm font-medium bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-all"
              >
                Cancel
              </Link>
              {isEditMode && (
                <>
                  <div className="flex-1" />
                  {showDeleteConfirm ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-red-400">Are you sure?</span>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={deleting}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-all disabled:opacity-50"
                      >
                        {deleting ? 'Deleting...' : 'Yes, Delete'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(false)}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-all"
                    >
                      Delete Agent
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right column: MCP Servers (edit mode only) */}
          {isEditMode && id && (
            <div className="w-1/3 flex flex-col gap-4">
              <div className="rounded-xl border border-white/5 bg-surface-850 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-white">MCP Servers</h3>
                  <button
                    type="button"
                    onClick={() => setShowAddMcp(!showAddMcp)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-nexus-600 text-white hover:bg-nexus-500 transition-all"
                  >
                    {showAddMcp ? 'Cancel' : '+ Add Server'}
                  </button>
                </div>

                {/* Add MCP server inline form */}
                {showAddMcp && (
                  <div className="mb-4 p-3 rounded-lg bg-surface-900 border border-white/10 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Name</label>
                      <input
                        type="text"
                        value={newMcpName}
                        onChange={(e) => setNewMcpName(e.target.value)}
                        placeholder="my-mcp-server"
                        className="w-full px-3 py-2 rounded-lg bg-surface-850 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-nexus-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">URL</label>
                      <input
                        type="text"
                        value={newMcpUrl}
                        onChange={(e) => setNewMcpUrl(e.target.value)}
                        placeholder="http://localhost:3001/sse"
                        className="w-full px-3 py-2 rounded-lg bg-surface-850 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-nexus-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">
                        Transport
                      </label>
                      <select
                        value={newMcpTransport}
                        onChange={(e) =>
                          setNewMcpTransport(e.target.value as 'SSE' | 'STREAMABLE_HTTP')
                        }
                        className="w-full px-3 py-2 rounded-lg bg-surface-850 border border-white/10 text-sm text-white focus:outline-none focus:border-nexus-500/50"
                      >
                        <option value="SSE">SSE</option>
                        <option value="STREAMABLE_HTTP">Streamable HTTP</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddMcpServer}
                      disabled={addingMcp || !newMcpName.trim() || !newMcpUrl.trim()}
                      className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-nexus-600 text-white hover:bg-nexus-500 transition-all disabled:opacity-50"
                    >
                      {addingMcp ? 'Adding...' : 'Add Server'}
                    </button>
                  </div>
                )}

                {/* MCP server list */}
                {mcpServers.length === 0 && !showAddMcp && (
                  <p className="text-xs text-gray-600 py-4 text-center">
                    No MCP servers connected
                  </p>
                )}

                <div className="space-y-3">
                  {mcpServers.map((server) => (
                    <div
                      key={server.id}
                      className="rounded-lg border border-white/5 bg-surface-900 overflow-hidden"
                    >
                      {/* Server header */}
                      <div className="px-3 py-3 flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-white truncate">
                              {server.name}
                            </span>
                            <span
                              className={cn(
                                'text-[10px] px-1.5 py-0.5 rounded font-medium uppercase shrink-0',
                                server.transport === 'SSE'
                                  ? 'bg-blue-500/15 text-blue-400'
                                  : 'bg-purple-500/15 text-purple-400'
                              )}
                            >
                              {server.transport}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 truncate">{server.url}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* Enabled toggle */}
                          <button
                            type="button"
                            onClick={() => handleToggleMcpEnabled(server.id, server.enabled)}
                            className={cn(
                              'relative w-8 h-4.5 rounded-full transition-colors duration-200',
                              server.enabled ? 'bg-emerald-500' : 'bg-gray-600'
                            )}
                          >
                            <div
                              className={cn(
                                'absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform duration-200',
                                server.enabled ? 'translate-x-4' : 'translate-x-0.5'
                              )}
                            />
                          </button>
                        </div>
                      </div>

                      {/* Server actions */}
                      <div className="px-3 pb-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleRefreshTools(server.id)}
                          disabled={refreshingServer === server.id}
                          className="px-2.5 py-1 rounded text-[11px] font-medium bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-all disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {refreshingServer === server.id ? (
                            <>
                              <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                              Refreshing...
                            </>
                          ) : (
                            'Refresh Tools'
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleExpand(server.id)}
                          className="px-2.5 py-1 rounded text-[11px] font-medium bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-all flex items-center gap-1"
                        >
                          Tools
                          <svg
                            className={cn(
                              'w-3 h-3 transition-transform',
                              server._expanded && 'rotate-180'
                            )}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </svg>
                        </button>
                        <div className="flex-1" />
                        <button
                          type="button"
                          onClick={() => handleDeleteMcpServer(server.id)}
                          disabled={deletingServer === server.id}
                          className="px-2.5 py-1 rounded text-[11px] font-medium bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all disabled:opacity-50"
                        >
                          {deletingServer === server.id ? '...' : 'Delete'}
                        </button>
                      </div>

                      {/* Expanded tool list */}
                      {server._expanded && (
                        <div className="border-t border-white/5 px-3 py-2">
                          {server._loadingTools ? (
                            <div className="flex items-center justify-center py-3">
                              <div className="w-4 h-4 border border-gray-500 border-t-transparent rounded-full animate-spin" />
                            </div>
                          ) : server.tools && server.tools.length > 0 ? (
                            <div className="space-y-1.5">
                              {server.tools.map((tool) => (
                                <div
                                  key={tool.id}
                                  className="px-2.5 py-2 rounded bg-surface-850 border border-white/5"
                                >
                                  <p className="text-xs font-medium text-white font-mono">
                                    {tool.name}
                                  </p>
                                  {tool.description && (
                                    <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">
                                      {tool.description}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-gray-600 py-2 text-center">
                              No tools discovered. Try refreshing.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
