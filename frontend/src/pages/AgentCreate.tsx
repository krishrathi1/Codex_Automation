import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, Link, useSearchParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Agent, Board, Gateway, GithubRepositorySummary, McpServer, McpTool, SoulTemplate, MarketplaceSkill, AgentSkill, AgentIntegration, ChannelType, VercelProjectSummary } from '@/types';

interface McpServerWithTools extends McpServer {
  tools?: McpTool[];
  _loadingTools?: boolean;
  _expanded?: boolean;
}

const VERCEL_MCP_URL = 'https://mcp.vercel.com';

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boardIntegrationScope(board: Board | null) {
  return objectRecord(objectRecord(board?.successMetrics).integrationScope);
}

// ── Emoji Picker ─────────────────────────────────────────
const EMOJI_OPTIONS = [
  { emoji: '\u{1F916}', label: 'Robot' },
  { emoji: '\u{1F9E0}', label: 'Brain' },
  { emoji: '\u{26A1}',  label: 'Zap' },
  { emoji: '\u{1F680}', label: 'Rocket' },
  { emoji: '\u{1F50D}', label: 'Search' },
  { emoji: '\u{1F4BB}', label: 'Laptop' },
  { emoji: '\u{1F6E0}\uFE0F', label: 'Tools' },
  { emoji: '\u{2699}\uFE0F',  label: 'Gear' },
  { emoji: '\u{1F4CA}', label: 'Chart' },
  { emoji: '\u{1F3AF}', label: 'Target' },
  { emoji: '\u{1F4DD}', label: 'Memo' },
  { emoji: '\u{1F50E}', label: 'Magnify' },
  { emoji: '\u{1F9D1}\u200D\u{1F4BB}', label: 'Dev' },
  { emoji: '\u{1F4E1}', label: 'Satellite' },
  { emoji: '\u{1F9EA}', label: 'Test Tube' },
  { emoji: '\u{1F525}', label: 'Fire' },
  { emoji: '\u{1F30D}', label: 'Globe' },
  { emoji: '\u{1F512}', label: 'Lock' },
  { emoji: '\u{1F4A1}', label: 'Idea' },
  { emoji: '\u{1F4E6}', label: 'Package' },
  { emoji: '\u{1F332}', label: 'Tree' },
  { emoji: '\u{2B50}',  label: 'Star' },
  { emoji: '\u{1F40D}', label: 'Snake' },
  { emoji: '\u{1F431}', label: 'Cat' },
];

function EmojiPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-900 border text-sm transition-all',
          open ? 'border-nexus-500/50' : 'border-white/10 hover:border-white/20'
        )}
      >
        <span className="text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-lg bg-surface-850">
          {value || <span className="text-gray-600 text-base">?</span>}
        </span>
        <span className="text-gray-400 text-xs">{value ? 'Change avatar' : 'Pick an avatar'}</span>
        <svg className={cn('w-3.5 h-3.5 text-gray-500 ml-auto transition-transform', open && 'rotate-180')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1.5 left-0 w-full rounded-lg bg-surface-900 border border-white/10 shadow-xl shadow-black/40 p-2">
          <div className="grid grid-cols-6 gap-1">
            {EMOJI_OPTIONS.map(({ emoji, label }) => (
              <button
                key={label}
                type="button"
                onClick={() => { onChange(emoji); setOpen(false); }}
                title={label}
                className={cn(
                  'w-full aspect-square rounded-lg flex items-center justify-center text-xl hover:bg-white/10 transition-colors',
                  value === emoji ? 'bg-nexus-600/20 ring-1 ring-nexus-500/40' : ''
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
          {value && (
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className="w-full mt-1.5 px-2 py-1.5 rounded text-[11px] text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all text-center"
            >
              Remove avatar
            </button>
          )}
        </div>
      )}
    </div>
  );
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
  const [searchParams] = useSearchParams();
  const isEditMode = Boolean(id);
  const boardId = searchParams.get('boardId');
  const returnTo = searchParams.get('returnTo');
  const createLabel = boardId && !isEditMode ? 'Create Sub-agent' : 'Create Agent';
  const cancelPath = returnTo || '/controls';

  // Form state
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [avatar, setAvatar] = useState('');
  const [heartbeatInterval, setHeartbeatInterval] = useState(30);
  const [enabled, setEnabled] = useState(true);
  const [agentToAgent, setAgentToAgent] = useState(true);
  const [soulMd, setSoulMd] = useState('');
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [gatewayId, setGatewayId] = useState('');
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [currentBoardId, setCurrentBoardId] = useState(boardId || '');
  const [board, setBoard] = useState<Board | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);

  // Advanced settings
  const [showAdvanced, setShowAdvanced] = useState(isEditMode);
  const [gatewayInfo, setGatewayInfo] = useState<{ hasDefaultConfig: boolean; gatewayCount: number } | null>(null);

  // MCP state
  const [mcpServers, setMcpServers] = useState<McpServerWithTools[]>([]);
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpUrl, setNewMcpUrl] = useState('');
  const [newMcpTransport, setNewMcpTransport] = useState<'SSE' | 'STREAMABLE_HTTP'>('SSE');
  const [addingMcp, setAddingMcp] = useState(false);
  const [refreshingServer, setRefreshingServer] = useState<string | null>(null);
  const [deletingServer, setDeletingServer] = useState<string | null>(null);
  const [addingVercelMcp, setAddingVercelMcp] = useState(false);

  // Repository and deployment access state
  const [repos, setRepos] = useState<GithubRepositorySummary[]>([]);
  const [projects, setProjects] = useState<VercelProjectSummary[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [githubResourcesError, setGithubResourcesError] = useState<string | null>(null);
  const [vercelResourcesError, setVercelResourcesError] = useState<string | null>(null);
  const [githubAccessEnabled, setGithubAccessEnabled] = useState(true);
  const [vercelAccessEnabled, setVercelAccessEnabled] = useState(true);
  const [vercelMcpEnabled, setVercelMcpEnabled] = useState(false);
  const [githubRepoFullName, setGithubRepoFullName] = useState('');
  const [vercelProjectId, setVercelProjectId] = useState('');

  // Soul template state
  const [soulTemplates, setSoulTemplates] = useState<SoulTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  // Skills state
  const [availableSkills, setAvailableSkills] = useState<MarketplaceSkill[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [agentSkills, setAgentSkills] = useState<AgentSkill[]>([]);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [skillCustomizations, setSkillCustomizations] = useState<Record<string, { customName: string; customDescription: string }>>({});

  // Integration state
  const [integrations, setIntegrations] = useState<Record<ChannelType, Partial<AgentIntegration>>>({
    TELEGRAM: {},
    SLACK: {},
    GOOGLE_CHAT: {},
  });
  const [expandedChannel, setExpandedChannel] = useState<ChannelType | null>(null);
  const [savingIntegration, setSavingIntegration] = useState<ChannelType | null>(null);

  // General state
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load gateways, gateway defaults, and agent setup data
  useEffect(() => {
    api.gateways.list().then(setGateways).catch(() => {});
    api.gateways.defaults().then(setGatewayInfo).catch(() => {});
    api.soulTemplates.list().then(setSoulTemplates).catch(() => {});
    api.skills.marketplace().then(setAvailableSkills).catch(() => {});
    api.boards.list().then(setBoards).catch(() => {});
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
        setAgentToAgent(agent.agentToAgent ?? false);
        setSoulMd(agent.soulMd || '');
        setGatewayId(agent.gatewayId || '');
        setCurrentBoardId(agent.boardId || boardId || '');
        setSelectedTemplateId(agent.soulTemplateId || '');
        setNameManuallyEdited(true);
        const integrationAccess = objectRecord(agent.identityProfile?.integrationAccess);
        const github = objectRecord(integrationAccess.github);
        const vercel = objectRecord(integrationAccess.vercel);
        const mcp = objectRecord(integrationAccess.mcp);
        setGithubAccessEnabled(github.enabled !== false);
        setVercelAccessEnabled(vercel.enabled !== false);
        setVercelMcpEnabled(mcp.vercel === true);
        const githubRepo = objectRecord(github.repo);
        const vercelProject = objectRecord(vercel.project);
        if (typeof githubRepo.fullName === 'string') setGithubRepoFullName(githubRepo.fullName);
        if (typeof vercelProject.id === 'string') setVercelProjectId(vercelProject.id);

        // Load agent skills
        if (agent.agentSkills) {
          setAgentSkills(agent.agentSkills);
          setSelectedSkillIds(new Set(agent.agentSkills.map((s: AgentSkill) => s.skillId)));
          const customizations: Record<string, { customName: string; customDescription: string }> = {};
          agent.agentSkills.forEach((s: AgentSkill) => {
            if (s.customName || s.customDescription) {
              customizations[s.skillId] = {
                customName: s.customName || '',
                customDescription: s.customDescription || '',
              };
            }
          });
          setSkillCustomizations(customizations);
        }

        // Load integrations
        if (agent.integrations) {
          const intMap: Record<ChannelType, Partial<AgentIntegration>> = { TELEGRAM: {}, SLACK: {}, GOOGLE_CHAT: {} };
          agent.integrations.forEach((i: AgentIntegration) => {
            intMap[i.channel] = i;
          });
          setIntegrations(intMap);
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!currentBoardId) return;
    api.boards.get(currentBoardId)
      .then((data) => {
        setBoard(data);
        const scope = boardIntegrationScope(data);
        const githubRepo = objectRecord(scope.githubRepo);
        const vercelProject = objectRecord(scope.vercelProject);
        if (!githubRepoFullName && typeof githubRepo.fullName === 'string') setGithubRepoFullName(githubRepo.fullName);
        if (!vercelProjectId && typeof vercelProject.id === 'string') setVercelProjectId(vercelProject.id);
      })
      .catch(() => {});
  }, [currentBoardId]);

  useEffect(() => {
    let cancelled = false;
    async function loadResources() {
      setResourcesLoading(true);
      setGithubResourcesError(null);
      setVercelResourcesError(null);
      try {
        const settings = await api.org.integrationSettings();
        const [repoResult, projectResult] = await Promise.allSettled([
          settings.github.configured
            ? api.org.githubRepos()
            : Promise.resolve([] as GithubRepositorySummary[]),
          settings.vercel.configured
            ? api.org.vercelProjects()
            : Promise.resolve([] as VercelProjectSummary[]),
        ]);
        if (cancelled) return;
        if (repoResult.status === 'fulfilled') setRepos(repoResult.value as GithubRepositorySummary[]);
        if (projectResult.status === 'fulfilled') setProjects(projectResult.value as VercelProjectSummary[]);
        if (repoResult.status === 'rejected') {
          setGithubResourcesError(repoResult.reason instanceof Error ? repoResult.reason.message : 'Failed to load GitHub repositories');
        }
        if (projectResult.status === 'rejected') {
          setVercelResourcesError(projectResult.reason instanceof Error ? projectResult.reason.message : 'Failed to load Vercel projects');
        }
      } finally {
        if (!cancelled) setResourcesLoading(false);
      }
    }
    loadResources();
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Soul template selection
  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (templateId) {
      const template = soulTemplates.find(t => t.id === templateId);
      if (template) {
        setSoulMd(template.content);
      }
    }
  };

  // Save integration
  const handleSaveIntegration = async (channel: ChannelType) => {
    if (!id) return;
    setSavingIntegration(channel);
    try {
      const data = integrations[channel];
      const result = await api.agents.upsertIntegration(id, channel, data as Record<string, unknown>);
      setIntegrations(prev => ({ ...prev, [channel]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save integration');
    } finally {
      setSavingIntegration(null);
    }
  };

  const handleDeleteIntegration = async (channel: ChannelType) => {
    if (!id) return;
    try {
      await api.agents.deleteIntegration(id, channel);
      setIntegrations(prev => ({ ...prev, [channel]: {} }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove integration');
    }
  };

  const handleToggleIntegration = async (channel: ChannelType, enabled: boolean) => {
    if (!id) return;
    try {
      const result = await api.agents.toggleIntegration(id, channel, enabled);
      setIntegrations(prev => ({ ...prev, [channel]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle integration');
    }
  };

  const updateIntegrationField = (channel: ChannelType, field: string, value: unknown) => {
    setIntegrations(prev => ({
      ...prev,
      [channel]: { ...prev[channel], [field]: value },
    }));
  };

  const buildIntegrationAccess = (overrides?: { vercelMcp?: boolean }) => {
    const selectedRepo = repos.find(repo => repo.fullName === githubRepoFullName);
    const selectedProject = projects.find(project => project.id === vercelProjectId);
    const scope = boardIntegrationScope(board);
    const boardRepo = objectRecord(scope.githubRepo);
    const boardProject = objectRecord(scope.vercelProject);
    return {
      github: {
        enabled: githubAccessEnabled && Boolean(selectedRepo || boardRepo.fullName),
        repo: selectedRepo || (boardRepo.fullName ? boardRepo : null),
      },
      vercel: {
        enabled: vercelAccessEnabled && Boolean(selectedProject || boardProject.id),
        project: selectedProject || (boardProject.id ? boardProject : null),
      },
      mcp: {
        vercel: overrides?.vercelMcp ?? vercelMcpEnabled,
      },
    };
  };

  const ensureVercelMcpServer = async (agentId: string) => {
    const servers = await api.mcp.list(agentId) as McpServer[];
    if (servers.some(server => server.url === VERCEL_MCP_URL)) return;
    await api.mcp.add(agentId, {
      name: 'Vercel',
      url: VERCEL_MCP_URL,
      transport: 'STREAMABLE_HTTP',
    });
  };

  // Skill toggle
  const handleSkillToggle = (skillId: string) => {
    setSelectedSkillIds(prev => {
      const next = new Set(prev);
      if (next.has(skillId)) {
        next.delete(skillId);
        if (editingSkillId === skillId) setEditingSkillId(null);
      } else {
        next.add(skillId);
      }
      return next;
    });
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
      // Only send gatewayId if user explicitly selected one (not auto-provisioned)
      const shouldSendGateway = gatewayId && !(gatewayInfo?.hasDefaultConfig && gatewayInfo.gatewayCount <= 1 && !showAdvanced);
      const data: Record<string, unknown> = {
        name: name.trim(),
        displayName: displayName.trim(),
        description: description.trim(),
        workspace: workspace.trim() || undefined,
        avatar: avatar.trim() || undefined,
        heartbeatInterval,
        enabled,
        agentToAgent,
	        soulMd: soulMd.trim() || undefined,
	        soulTemplateId: selectedTemplateId || null,
	        gatewayId: shouldSendGateway ? gatewayId : undefined,
	        identityProfile: {
	          integrationAccess: buildIntegrationAccess(),
	        },
	      };
      const skillIdsArray = Array.from(selectedSkillIds);

	      if (isEditMode && id) {
	        await api.agents.update(id, data);
	        if (vercelMcpEnabled) {
	          await ensureVercelMcpServer(id);
	        }

	        // Sync skills: compute diff
        const currentSkillIds = new Set(agentSkills.map(s => s.skillId));
        // Remove deselected
        for (const sid of currentSkillIds) {
          if (!selectedSkillIds.has(sid)) {
            await api.agents.removeSkill(id, sid);
          }
        }
        // Add newly selected
        const toAdd = skillIdsArray.filter(sid => !currentSkillIds.has(sid));
        if (toAdd.length > 0) {
          await api.agents.assignSkills(id, toAdd);
        }
        // Update customizations
        for (const sid of selectedSkillIds) {
          const custom = skillCustomizations[sid];
          if (custom && (custom.customName || custom.customDescription)) {
            await api.agents.updateSkill(id, sid, {
              customName: custom.customName || null,
              customDescription: custom.customDescription || null,
            });
          }
        }

        navigate(`/agents/${id}`);
      } else {
        data.skillIds = skillIdsArray;
	        const created = (await api.agents.create(data)) as Agent;
	        const targetBoardId = currentBoardId || boardId;
	        if (targetBoardId) {
	          await api.boards.addAgent(targetBoardId, { agentId: created.id, integrationAccess: buildIntegrationAccess() });
	        }

        // Update customizations for newly created agent
        for (const sid of selectedSkillIds) {
          const custom = skillCustomizations[sid];
          if (custom && (custom.customName || custom.customDescription)) {
            await api.agents.updateSkill(created.id, sid, {
              customName: custom.customName || null,
              customDescription: custom.customDescription || null,
            });
          }
        }

        // Save integrations configured during creation
	        for (const channel of ['TELEGRAM', 'SLACK', 'GOOGLE_CHAT'] as ChannelType[]) {
          const integ = integrations[channel];
          const hasCredentials = integ.botToken || integ.appToken || integ.serviceAccount || integ.webhookUrl;
          if (hasCredentials) {
            await api.agents.upsertIntegration(created.id, channel, integ as Record<string, unknown>);
	          }
	        }

	        if (vercelMcpEnabled) {
	          await ensureVercelMcpServer(created.id);
	        }

	        navigate(returnTo || `/agents/${created.id}`);
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

  const handleConnectVercelMcp = async () => {
    if (!id) return;
    const existing = mcpServers.find(server => server.url === VERCEL_MCP_URL);
    if (existing) {
      setVercelMcpEnabled(true);
      await api.agents.update(id, { identityProfile: { integrationAccess: buildIntegrationAccess({ vercelMcp: true }) } });
      return;
    }
    setAddingVercelMcp(true);
    try {
      await api.mcp.add(id, {
        name: 'Vercel',
        url: VERCEL_MCP_URL,
        transport: 'STREAMABLE_HTTP',
      });
      setVercelMcpEnabled(true);
      await api.agents.update(id, { identityProfile: { integrationAccess: buildIntegrationAccess({ vercelMcp: true }) } });
      await fetchMcpServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Vercel MCP');
    } finally {
      setAddingVercelMcp(false);
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
          <span className="text-gray-400">{isEditMode ? 'Edit Agent' : createLabel}</span>
        </div>
        <h2 className="text-2xl font-bold text-white">
          {isEditMode ? 'Edit Agent' : createLabel}
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          {isEditMode
            ? 'Modify agent configuration, personality, and MCP server connections'
            : boardId
              ? 'Configure a new agent for this production group'
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
            {/* About Your Agent — Primary Fields */}
            <div className="rounded-xl border border-white/5 bg-surface-850 p-5">
              <h3 className="text-sm font-semibold text-white mb-4">About Your Agent</h3>
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

                {/* Avatar Emoji Picker */}
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Avatar
                  </label>
                  <EmojiPicker value={avatar} onChange={setAvatar} />
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

                {/* Production Group (board) — only when creating, not editing */}
                {!isEditMode && (
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">
                      Production Group
                      {boardId && <span className="text-gray-600 font-normal"> (preselected)</span>}
                    </label>
                    <select
                      value={currentBoardId}
                      onChange={(e) => setCurrentBoardId(e.target.value)}
                      disabled={Boolean(boardId)}
                      className="w-full px-3 py-2 rounded-lg bg-surface-900 border border-white/10 text-sm text-white focus:outline-none focus:border-nexus-500/50 disabled:opacity-50"
                    >
                      <option value="">No production group (standalone agent)</option>
                      {boards.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-gray-600">
                      Attach this agent to a production group so it appears on that board.
                    </p>
                  </div>
                )}

                {/* Agent-to-Agent Toggle */}
	                <div className="col-span-2">
	                  <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-surface-900 border border-white/10">
                    <div>
                      <p className="text-sm font-medium text-white">Agent-to-Agent (A2A)</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Allow this agent to discover and communicate with other A2A-enabled agents
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAgentToAgent(!agentToAgent)}
                      className={cn(
                        'relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ml-4',
                        agentToAgent ? 'bg-nexus-500' : 'bg-gray-600'
                      )}
                    >
                      <div
                        className={cn(
                          'absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-200',
                          agentToAgent ? 'translate-x-5.5' : 'translate-x-0.5'
                        )}
                      />
                    </button>
	                  </div>
	                </div>

	                {/* Repository and deployment access */}
	                <div className="col-span-2 rounded-lg border border-white/10 bg-surface-900 p-4">
	                  <div className="mb-3 flex items-center justify-between gap-3">
	                    <div>
	                      <p className="text-sm font-medium text-white">Repository and website access</p>
	                      {board && <p className="mt-0.5 text-xs text-gray-500">{board.name}</p>}
	                    </div>
	                    {resourcesLoading && <span className="text-[11px] text-gray-600">Loading...</span>}
	                  </div>
	                  <div className="grid gap-3 md:grid-cols-2">
	                    <div>
	                      <div className="mb-1 flex items-center justify-between gap-2">
	                        <label className="block text-xs font-medium text-gray-400">GitHub repository</label>
	                        <button
	                          type="button"
	                          onClick={() => setGithubAccessEnabled(!githubAccessEnabled)}
	                          className={cn(
	                            'relative h-5 w-9 rounded-full transition-colors',
	                            githubAccessEnabled ? 'bg-nexus-500' : 'bg-gray-600'
	                          )}
	                        >
	                          <div className={cn(
	                            'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
	                            githubAccessEnabled ? 'translate-x-4.5' : 'translate-x-0.5'
	                          )} />
	                        </button>
	                      </div>
	                      <select
	                        value={githubRepoFullName}
	                        onChange={(e) => setGithubRepoFullName(e.target.value)}
	                        disabled={!githubAccessEnabled}
	                        className="w-full rounded-lg border border-white/10 bg-surface-850 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nexus-500/50 disabled:opacity-50"
	                      >
	                        <option value="">No repository</option>
	                        {repos.map(repo => (
	                          <option key={repo.id} value={repo.fullName}>
	                            {repo.fullName}{repo.private ? ' (private)' : ''}
	                          </option>
	                        ))}
	                      </select>
	                      {githubResourcesError && (
	                        <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
	                          {githubResourcesError}{' '}
	                          <Link to="/settings" className="text-amber-100 underline">Settings</Link>
	                        </p>
	                      )}
	                    </div>
	                    <div>
	                      <div className="mb-1 flex items-center justify-between gap-2">
	                        <label className="block text-xs font-medium text-gray-400">Vercel website</label>
	                        <button
	                          type="button"
	                          onClick={() => setVercelAccessEnabled(!vercelAccessEnabled)}
	                          className={cn(
	                            'relative h-5 w-9 rounded-full transition-colors',
	                            vercelAccessEnabled ? 'bg-nexus-500' : 'bg-gray-600'
	                          )}
	                        >
	                          <div className={cn(
	                            'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
	                            vercelAccessEnabled ? 'translate-x-4.5' : 'translate-x-0.5'
	                          )} />
	                        </button>
	                      </div>
	                      <select
	                        value={vercelProjectId}
	                        onChange={(e) => setVercelProjectId(e.target.value)}
	                        disabled={!vercelAccessEnabled}
	                        className="w-full rounded-lg border border-white/10 bg-surface-850 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nexus-500/50 disabled:opacity-50"
	                      >
	                        <option value="">No website</option>
	                        {projects.map(project => (
	                          <option key={project.id} value={project.id}>
	                            {project.name}{project.productionUrl ? ` (${project.productionUrl})` : ''}
	                          </option>
	                        ))}
	                      </select>
	                      {vercelResourcesError && (
	                        <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
	                          {vercelResourcesError}{' '}
	                          <Link to="/settings" className="text-amber-100 underline">Settings</Link>
	                        </p>
	                      )}
	                    </div>
	                  </div>
	                  <div className="mt-3 flex items-center justify-between rounded-lg border border-white/5 bg-surface-850 px-3 py-2">
	                    <div>
	                      <p className="text-xs font-medium text-gray-300">Vercel MCP</p>
	                      <p className="text-[11px] text-gray-600">{VERCEL_MCP_URL}</p>
	                    </div>
	                    <button
	                      type="button"
	                      onClick={() => setVercelMcpEnabled(!vercelMcpEnabled)}
	                      className={cn(
	                        'relative h-5 w-9 rounded-full transition-colors',
	                        vercelMcpEnabled ? 'bg-emerald-500' : 'bg-gray-600'
	                      )}
	                    >
	                      <div className={cn(
	                        'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
	                        vercelMcpEnabled ? 'translate-x-4.5' : 'translate-x-0.5'
	                      )} />
	                    </button>
	                  </div>
	                </div>
	              </div>

              {/* Gateway warning — only when no auto-provisioning and no gateways */}
              {gatewayInfo && !gatewayInfo.hasDefaultConfig && gatewayInfo.gatewayCount === 0 && (
                <div className="mt-4 px-3 py-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 text-amber-400 text-xs">
                  No agent connection available. Contact your admin or{' '}
                  <Link to="/gateways" className="underline hover:text-amber-300">configure a gateway</Link>.
                </div>
              )}
            </div>

            {/* Advanced Settings — Collapsible */}
            <div className="rounded-xl border border-white/5 bg-surface-850">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-gray-400 hover:text-gray-200 transition-all"
              >
                <span>Advanced Settings</span>
                <svg
                  className={cn('w-4 h-4 transition-transform', showAdvanced && 'rotate-180')}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showAdvanced && (
                <div className="px-5 pb-5 pt-0 grid grid-cols-2 gap-4 border-t border-white/5">
                  {/* Internal ID (slug) */}
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">
                      Internal ID{' '}
                      <span className="text-gray-600 font-normal">(auto-generated)</span>
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

                  {/* Connection Gateway — hidden when auto-provisioned with 0-1 gateways */}
                  {!(gatewayInfo?.hasDefaultConfig && gatewayInfo.gatewayCount <= 1) && (
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">
                        Connection Gateway
                      </label>
                      <select
                        value={gatewayId}
                        onChange={(e) => setGatewayId(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-surface-900 border border-white/10 text-sm text-white focus:outline-none focus:border-nexus-500/50"
                      >
                        <option value="">Auto (default)</option>
                        {gateways.map((gw) => (
                          <option key={gw.id} value={gw.id}>
                            {gw.name} {gw.status === 'ONLINE' ? '' : `(${gw.status.toLowerCase()})`}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Health Check Frequency */}
                  <div className="col-span-1">
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">
                      Health Check Frequency <span className="text-gray-600 font-normal">(minutes)</span>
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
              )}
            </div>

            {/* Skills Selection */}
            <div className="rounded-xl border border-white/5 bg-surface-850 p-5">
              <h3 className="text-sm font-semibold text-white mb-1">Skills</h3>
              <p className="text-xs text-gray-500 mb-3">
                Select skills from the marketplace to equip this agent
              </p>
              {availableSkills.length === 0 ? (
                <p className="text-xs text-gray-600 py-4 text-center">
                  No skills available.{' '}
                  <Link to="/skills" className="text-nexus-400 hover:underline">Add some in the marketplace</Link>
                </p>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {availableSkills.map((skill) => {
                    const isSelected = selectedSkillIds.has(skill.id);
                    const isEditing = editingSkillId === skill.id;
                    const riskColor = skill.risk === 'low' ? 'text-emerald-400 bg-emerald-500/10' :
                      skill.risk === 'medium' ? 'text-amber-400 bg-amber-500/10' :
                      'text-red-400 bg-red-500/10';
                    return (
                      <div key={skill.id} className={cn(
                        'rounded-lg border px-3 py-2.5 transition-all',
                        isSelected
                          ? 'border-nexus-500/30 bg-nexus-500/5'
                          : 'border-white/5 bg-surface-900 hover:border-white/10'
                      )}>
                        <div className="flex items-center gap-3 cursor-pointer" onClick={() => handleSkillToggle(skill.id)}>
                          <div className={cn(
                            'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                            isSelected ? 'bg-nexus-500 border-nexus-500' : 'border-white/20'
                          )}>
                            {isSelected && (
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-white">{skill.name}</span>
                              <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium uppercase', riskColor)}>{skill.risk}</span>
                              <span className="text-[10px] text-gray-600">{skill.category}</span>
                            </div>
                            <p className="text-xs text-gray-500 truncate">{skill.description || 'No description'}</p>
                          </div>
                          {isSelected && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setEditingSkillId(isEditing ? null : skill.id); }}
                              className="px-2 py-1 rounded text-[11px] font-medium bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-all"
                            >
                              {isEditing ? 'Done' : 'Customize'}
                            </button>
                          )}
                        </div>
                        {isSelected && isEditing && (
                          <div className="mt-2 pt-2 border-t border-white/5 space-y-2">
                            <div>
                              <label className="block text-[11px] text-gray-500 mb-1">Custom Name (override)</label>
                              <input
                                type="text"
                                value={skillCustomizations[skill.id]?.customName || ''}
                                onChange={(e) => setSkillCustomizations(prev => ({
                                  ...prev,
                                  [skill.id]: { customName: e.target.value, customDescription: prev[skill.id]?.customDescription || '' }
                                }))}
                                placeholder={skill.name}
                                className="w-full px-2.5 py-1.5 rounded bg-surface-850 border border-white/10 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-nexus-500/50"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-gray-500 mb-1">Custom Description (override)</label>
                              <textarea
                                value={skillCustomizations[skill.id]?.customDescription || ''}
                                onChange={(e) => setSkillCustomizations(prev => ({
                                  ...prev,
                                  [skill.id]: { customName: prev[skill.id]?.customName || '', customDescription: e.target.value }
                                }))}
                                rows={2}
                                placeholder={skill.description || 'Enter custom description'}
                                className="w-full px-2.5 py-1.5 rounded bg-surface-850 border border-white/10 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-nexus-500/50 resize-y"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {selectedSkillIds.size > 0 && (
                <p className="text-[11px] text-gray-500 mt-2">{selectedSkillIds.size} skill{selectedSkillIds.size !== 1 ? 's' : ''} selected</p>
              )}
            </div>

            {/* Platform Integrations */}
            <div className="rounded-xl border border-white/5 bg-surface-850 p-5">
                <h3 className="text-sm font-semibold text-white mb-1">Platform Integrations</h3>
                <p className="text-xs text-gray-500 mb-3">
                  Connect this agent to Telegram, Slack, or Google Chat
                </p>
                <div className="space-y-3">
                  {/* Telegram */}
                  {(() => {
                    const channels: { key: ChannelType; label: string; color: string; borderColor: string; bgColor: string }[] = [
                      { key: 'TELEGRAM', label: 'Telegram', color: 'text-sky-400', borderColor: 'border-sky-500/30', bgColor: 'bg-sky-500/10' },
                      { key: 'SLACK', label: 'Slack', color: 'text-purple-400', borderColor: 'border-purple-500/30', bgColor: 'bg-purple-500/10' },
                      { key: 'GOOGLE_CHAT', label: 'Google Chat', color: 'text-emerald-400', borderColor: 'border-emerald-500/30', bgColor: 'bg-emerald-500/10' },
                    ];
                    return channels.map(({ key, label, color, borderColor, bgColor }) => {
                      const integration = integrations[key];
                      const isConfigured = Boolean(integration?.id);
                      const isExpanded = expandedChannel === key;
                      return (
                        <div key={key} className={cn('rounded-lg border transition-all', isConfigured ? borderColor : 'border-white/5', isConfigured ? bgColor.replace('/10', '/5') : 'bg-surface-900')}>
                          {/* Channel header */}
                          <div
                            className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                            onClick={() => setExpandedChannel(isExpanded ? null : key)}
                          >
                            <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold', bgColor, color)}>
                              {label.charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-white">{label}</span>
                                {isConfigured && (
                                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium',
                                    integration.enabled ? 'text-emerald-400 bg-emerald-500/10' : 'text-gray-500 bg-gray-500/10'
                                  )}>
                                    {integration.enabled ? 'Enabled' : 'Disabled'}
                                  </span>
                                )}
                                {isConfigured && integration.status && (
                                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium',
                                    integration.status === 'connected' ? 'text-emerald-400 bg-emerald-500/10' :
                                    integration.status === 'error' ? 'text-red-400 bg-red-500/10' :
                                    'text-gray-500 bg-gray-500/10'
                                  )}>
                                    {integration.status}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-gray-500">
                                {!isConfigured ? 'Not configured' : integration.lastError ? integration.lastError : 'Click to configure'}
                              </p>
                            </div>
                            {isConfigured && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); isEditMode && id ? handleToggleIntegration(key, !integration.enabled) : updateIntegrationField(key, 'enabled', !integration.enabled); }}
                                className={cn(
                                  'relative w-9 h-5 rounded-full transition-colors duration-200 shrink-0',
                                  integration.enabled ? 'bg-emerald-500' : 'bg-gray-600'
                                )}
                              >
                                <div className={cn(
                                  'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200',
                                  integration.enabled ? 'translate-x-4.5' : 'translate-x-0.5'
                                )} />
                              </button>
                            )}
                            <svg className={cn('w-4 h-4 text-gray-500 transition-transform shrink-0', isExpanded && 'rotate-180')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>

                          {/* Expanded config form */}
                          {isExpanded && (
                            <div className="px-4 pb-4 pt-1 border-t border-white/5 space-y-3">
                              {/* Telegram fields */}
                              {key === 'TELEGRAM' && (
                                <>
                                  <div>
                                    <label className="block text-[11px] text-gray-400 mb-1">Bot Token <span className="text-gray-600">(from @BotFather)</span></label>
                                    <input
                                      type="password"
                                      value={integration.botToken || ''}
                                      onChange={(e) => updateIntegrationField(key, 'botToken', e.target.value)}
                                      placeholder="123456:ABC-DEF..."
                                      className="w-full px-2.5 py-1.5 rounded bg-surface-850 border border-white/10 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-sky-500/50"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[11px] text-gray-400 mb-1">Webhook URL <span className="text-gray-600">(optional, uses polling if empty)</span></label>
                                    <input
                                      type="text"
                                      value={integration.webhookUrl || ''}
                                      onChange={(e) => updateIntegrationField(key, 'webhookUrl', e.target.value)}
                                      placeholder="https://your-domain.com/telegram"
                                      className="w-full px-2.5 py-1.5 rounded bg-surface-850 border border-white/10 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-sky-500/50"
                                    />
                                  </div>
                                </>
                              )}

                              {/* Slack fields */}
                              {key === 'SLACK' && (
                                <>
                                  <div>
                                    <label className="block text-[11px] text-gray-400 mb-1">Bot Token <span className="text-gray-600">(xoxb-...)</span></label>
                                    <input
                                      type="password"
                                      value={integration.botToken || ''}
                                      onChange={(e) => updateIntegrationField(key, 'botToken', e.target.value)}
                                      placeholder="xoxb-..."
                                      className="w-full px-2.5 py-1.5 rounded bg-surface-850 border border-white/10 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[11px] text-gray-400 mb-1">App Token <span className="text-gray-600">(xapp-... for Socket Mode)</span></label>
                                    <input
                                      type="password"
                                      value={integration.appToken || ''}
                                      onChange={(e) => updateIntegrationField(key, 'appToken', e.target.value)}
                                      placeholder="xapp-..."
                                      className="w-full px-2.5 py-1.5 rounded bg-surface-850 border border-white/10 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
                                    />
                                  </div>
                                </>
                              )}

                              {/* Google Chat fields */}
                              {key === 'GOOGLE_CHAT' && (
                                <>
                                  <div>
                                    <label className="block text-[11px] text-gray-400 mb-1">Service Account JSON</label>
                                    <textarea
                                      value={integration.serviceAccount ? JSON.stringify(integration.serviceAccount, null, 2) : ''}
                                      onChange={(e) => {
                                        try {
                                          const parsed = JSON.parse(e.target.value);
                                          updateIntegrationField(key, 'serviceAccount', parsed);
                                        } catch {
                                          // Allow typing incomplete JSON
                                          updateIntegrationField(key, 'serviceAccount', e.target.value as any);
                                        }
                                      }}
                                      rows={4}
                                      placeholder='{"type": "service_account", "project_id": "...", ...}'
                                      className="w-full px-2.5 py-1.5 rounded bg-surface-850 border border-white/10 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 font-mono resize-y"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[11px] text-gray-400 mb-1">Webhook URL <span className="text-gray-600">(public HTTPS endpoint)</span></label>
                                    <input
                                      type="text"
                                      value={integration.webhookUrl || ''}
                                      onChange={(e) => updateIntegrationField(key, 'webhookUrl', e.target.value)}
                                      placeholder="https://your-domain.com/googlechat"
                                      className="w-full px-2.5 py-1.5 rounded bg-surface-850 border border-white/10 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/50"
                                    />
                                  </div>
                                </>
                              )}

                              {/* Common: DM & Group Policy */}
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-[11px] text-gray-400 mb-1">DM Policy</label>
                                  <select
                                    value={integration.dmPolicy || 'open'}
                                    onChange={(e) => updateIntegrationField(key, 'dmPolicy', e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded bg-surface-850 border border-white/10 text-xs text-white focus:outline-none"
                                  >
                                    <option value="open">Open</option>
                                    <option value="pairing">Pairing</option>
                                    <option value="allowlist">Allowlist</option>
                                    <option value="disabled">Disabled</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[11px] text-gray-400 mb-1">Group Policy</label>
                                  <select
                                    value={integration.groupPolicy || 'open'}
                                    onChange={(e) => updateIntegrationField(key, 'groupPolicy', e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded bg-surface-850 border border-white/10 text-xs text-white focus:outline-none"
                                  >
                                    <option value="open">Open</option>
                                    <option value="allowlist">Allowlist</option>
                                    <option value="disabled">Disabled</option>
                                  </select>
                                </div>
                              </div>

                              {/* Action buttons */}
                              {isEditMode && id ? (
                                <div className="flex items-center gap-2 pt-1">
                                  <button
                                    type="button"
                                    onClick={() => handleSaveIntegration(key)}
                                    disabled={savingIntegration === key}
                                    className={cn('px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-colors disabled:opacity-50',
                                      key === 'TELEGRAM' ? 'bg-sky-600 hover:bg-sky-500' :
                                      key === 'SLACK' ? 'bg-purple-600 hover:bg-purple-500' :
                                      'bg-emerald-600 hover:bg-emerald-500'
                                    )}
                                  >
                                    {savingIntegration === key ? 'Saving...' : isConfigured ? 'Update' : 'Connect'}
                                  </button>
                                  {isConfigured && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteIntegration(key)}
                                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <p className="text-[10px] text-gray-500 pt-1">
                                  Integration will be saved when you create the agent.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
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
              {/* Soul Template Picker */}
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Start from Template <span className="text-gray-600 font-normal">(optional)</span>
                </label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => handleTemplateSelect(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-surface-900 border border-white/10 text-sm text-white focus:outline-none focus:border-nexus-500/50"
                >
                  <option value="">Blank — start from scratch</option>
                  {soulTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.category})
                    </option>
                  ))}
                </select>
                {selectedTemplateId && (
                  <p className="text-[11px] text-gray-500 mt-1">
                    Template content loaded. Customize it below.
                  </p>
                )}
              </div>
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
                    : createLabel}
              </button>
              <Link
                to={cancelPath}
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

	                <button
	                  type="button"
	                  onClick={handleConnectVercelMcp}
	                  disabled={addingVercelMcp}
	                  className="mb-4 w-full rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/15 disabled:opacity-50"
	                >
	                  {addingVercelMcp ? 'Connecting Vercel MCP...' : 'Connect Vercel MCP'}
	                </button>

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
