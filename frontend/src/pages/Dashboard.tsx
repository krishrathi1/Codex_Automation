import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bot, CheckCircle2, Clock3, FolderKanban, MessageSquare, Plus, RefreshCw, Send, Sparkles } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { api } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import type { AgentDesignProposal, AgentDesignProposalAgent, Board, BoardGroup, BitbucketRepositorySummary, GithubRepositorySummary, Task, VercelProjectSummary } from '@/types';

interface ProductionBoard extends Board {
  boardGroup?: { id: string; name: string } | null;
}

const boardTypeStyles: Record<string, { badge: string; label: string }> = {
  goal: { badge: 'border-sky-500/20 bg-sky-500/10 text-sky-300', label: 'Goal' },
  sprint: { badge: 'border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-300', label: 'Sprint' },
  continuous: { badge: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300', label: 'Continuous' },
};

function taskSummary(tasks: Task[]) {
  const active = tasks.filter(task => ['ASSIGNED', 'IN_PROGRESS', 'REVIEW'].includes(task.status)).length;
  const done = tasks.filter(task => task.status === 'DONE').length;
  return { active, done, total: tasks.length };
}

export function Dashboard() {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<ProductionBoard[]>([]);
  const [groups, setGroups] = useState<BoardGroup[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [boardsData, groupsData, tasksData] = await Promise.all([
        api.boards.list(),
        api.boardGroups.list(),
        api.tasks.list(),
      ]);
      setBoards(boardsData as ProductionBoard[]);
      setGroups(groupsData);
      setTasks(tasksData);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData().catch(() => setLoading(false));
  }, []);

  async function handleCreate(data: CreateProductionGroupData) {
    const board = await api.boards.create({
      name: data.name,
      description: data.description,
      objective: data.objective,
      boardType: data.boardType,
      mode: data.mode,
      maxAgents: data.maxAgents,
      boardGroupId: data.boardGroupId || undefined,
      integrationScope: data.integrationScope,
    }) as ProductionBoard;

    // Provision any agents the user designed in the chat, then attach them to the board.
    const failed: string[] = [];
    for (const [index, spec] of (data.agents ?? []).entries()) {
      const displayName = spec.displayName.trim();
      if (!displayName) continue;
      const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'agent';
      try {
        const agent = await api.agents.create({
          name: `${slug}-${index + 1}-${Math.random().toString(36).slice(2, 7)}`,
          displayName,
          description: spec.role?.trim() || displayName,
          soulMd: spec.persona?.trim() || undefined,
          enabled: true,
        }) as { id: string };
        await api.boards.addAgent(board.id, { agentId: agent.id });
      } catch {
        failed.push(displayName);
      }
    }

    setBoards(prev => [board, ...prev]);
    setShowCreate(false);
    if (failed.length > 0) {
      // Board was created; surface which agents couldn't be provisioned.
      window.alert(`Group created, but these agents failed to provision: ${failed.join(', ')}. You can add them from the board.`);
    }
    navigate(`/production/${board.id}`);
  }

  const tasksByBoard = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.boardId) continue;
      map.set(task.boardId, [...(map.get(task.boardId) ?? []), task]);
    }
    return map;
  }, [tasks]);

  const groupedBoards = groups
    .map(group => ({
      group,
      boards: boards.filter(board => board.boardGroupId === group.id),
    }))
    .filter(group => group.boards.length > 0);
  const ungroupedBoards = boards.filter(board => !board.boardGroupId);

  return (
    <div>
      <Header
        title="Production Groups"
        subtitle="Agent workrooms with scoped Mother Chat"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadData()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-surface-850 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-white/5 disabled:opacity-50"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-nexus-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-nexus-500"
            >
              <Plus className="h-4 w-4" />
              New Group
            </button>
          </div>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-nexus-500 border-t-transparent" />
        </div>
      ) : boards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-nexus-500/30 bg-nexus-500/5 p-10 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-nexus-600/20 text-nexus-300">
            <FolderKanban className="h-6 w-6" />
          </div>
          <h3 className="text-lg font-semibold text-white">No production groups</h3>
          <p className="mx-auto mt-1 max-w-lg text-sm text-gray-500">
            Create a group, add sub-agents, then open its Mother Chat.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-nexus-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-nexus-500"
          >
            <Plus className="h-4 w-4" />
            New Group
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {groupedBoards.map(({ group, boards: groupBoards }) => (
            <ProductionSection
              key={group.id}
              title={group.name}
              description={group.description}
              boards={groupBoards}
              tasksByBoard={tasksByBoard}
            />
          ))}

          {ungroupedBoards.length > 0 && (
            <ProductionSection
              title={groupedBoards.length > 0 ? 'Ungrouped' : 'Active Production'}
              boards={ungroupedBoards}
              tasksByBoard={tasksByBoard}
            />
          )}
        </div>
      )}

      {showCreate && (
        <CreateProductionGroupModal
          groups={groups}
          onClose={() => setShowCreate(false)}
          onSubmit={handleCreate}
        />
      )}
    </div>
  );
}

function ProductionSection({
  title,
  description,
  boards,
  tasksByBoard,
}: {
  title: string;
  description?: string;
  boards: ProductionBoard[];
  tasksByBoard: Map<string, Task[]>;
}) {
  const agentCount = boards.reduce((sum, board) => sum + (board._count?.agents ?? 0), 0);
  const activeTaskCount = boards.reduce((sum, board) => sum + taskSummary(tasksByBoard.get(board.id) ?? []).active, 0);

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">{title}</h3>
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-gray-500">{boards.length}</span>
          </div>
          {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
        </div>
        <div className="hidden items-center gap-3 text-xs text-gray-500 sm:flex">
          <span>{agentCount} agents</span>
          <span>{activeTaskCount} active tasks</span>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-3 lg:grid-cols-2">
        {boards.map(board => (
          <ProductionGroupCard
            key={board.id}
            board={board}
            tasks={tasksByBoard.get(board.id) ?? []}
          />
        ))}
      </div>
    </section>
  );
}

function ProductionGroupCard({ board, tasks }: { board: ProductionBoard; tasks: Task[] }) {
  const style = boardTypeStyles[board.boardType] || boardTypeStyles.goal;
  const summary = taskSummary(tasks);
  const progress = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0;
  const agentCount = board._count?.agents ?? 0;
  const integrationScope = ((board.successMetrics as Record<string, unknown> | null | undefined)?.integrationScope ?? {}) as Record<string, any>;
  const githubRepo = integrationScope.githubRepo?.fullName as string | undefined;
  const vercelProject = integrationScope.vercelProject?.name as string | undefined;

  return (
    <div className="rounded-lg border border-white/5 bg-surface-850 p-5 transition-colors hover:border-nexus-500/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-base font-semibold text-white">{board.name}</h4>
          <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-gray-500">
            {board.objective || board.description || 'No objective set'}
          </p>
        </div>
        <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider', style.badge)}>
          {style.label}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Metric icon={Bot} label="Agents" value={agentCount} />
        <Metric icon={Clock3} label="Active" value={summary.active} />
        <Metric icon={CheckCircle2} label="Done" value={summary.done} />
      </div>

      {(githubRepo || vercelProject) && (
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-gray-400">
          {githubRepo && <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1">{githubRepo}</span>}
          {vercelProject && <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1">{vercelProject}</span>}
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-gray-500">Progress</span>
          <span className="font-medium text-gray-300">{progress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
          <div className="h-full rounded-full bg-nexus-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-white/5 pt-4">
        <span className="text-xs text-gray-600">{timeAgo(board.updatedAt || board.createdAt)}</span>
        <div className="flex items-center gap-2">
          <Link
            to={`/boards/${board.id}`}
            className="rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-white/5"
          >
            Manage
          </Link>
          <Link
            to={`/production/${board.id}`}
            className="inline-flex items-center gap-2 rounded-lg bg-nexus-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-nexus-500"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Mother Chat
          </Link>
        </div>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Bot; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/5 bg-surface-900 px-3 py-2">
      <div className="flex items-center gap-1.5 text-gray-500">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

interface CreateProductionGroupData {
  name: string;
  description?: string;
  objective?: string;
  boardType: string;
  mode: 'AUTOMATIC' | 'MANUAL';
  maxAgents: number;
  boardGroupId?: string;
  integrationScope?: {
    githubRepo?: GithubRepositorySummary;
    vercelProject?: VercelProjectSummary;
    bitbucketRepo?: BitbucketRepositorySummary;
    signozService?: string;
    primaryProvider?: 'github' | 'bitbucket';
  };
  agents?: AgentDesignProposalAgent[];
}

function CreateProductionGroupModal({
  groups,
  onClose,
  onSubmit,
}: {
  groups: BoardGroup[];
  onClose: () => void;
  onSubmit: (data: CreateProductionGroupData) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [objective, setObjective] = useState('');
  const [objectiveManuallyEdited, setObjectiveManuallyEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [descriptionManuallyEdited, setDescriptionManuallyEdited] = useState(false);
  const [boardType, setBoardType] = useState('continuous');
  const [boardTypeManuallyEdited, setBoardTypeManuallyEdited] = useState(false);
  const [mode, setMode] = useState<'AUTOMATIC' | 'MANUAL'>('AUTOMATIC');
  const [maxAgents, setMaxAgents] = useState(5);
  const [maxAgentsManuallyEdited, setMaxAgentsManuallyEdited] = useState(false);
  const [boardGroupId, setBoardGroupId] = useState('');
  const [repos, setRepos] = useState<GithubRepositorySummary[]>([]);
  const [projects, setProjects] = useState<VercelProjectSummary[]>([]);
  const [bitbucketRepos, setBitbucketRepos] = useState<BitbucketRepositorySummary[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [githubResourcesError, setGithubResourcesError] = useState<string | null>(null);
  const [vercelResourcesError, setVercelResourcesError] = useState<string | null>(null);
  const [bitbucketResourcesError, setBitbucketResourcesError] = useState<string | null>(null);
  const [githubRepoFullName, setGithubRepoFullName] = useState('');
  const [vercelProjectId, setVercelProjectId] = useState('');
  const [bitbucketRepoFullName, setBitbucketRepoFullName] = useState('');
  const [primaryProvider, setPrimaryProvider] = useState<'github' | 'bitbucket'>('github');
  const [signozService, setSignozService] = useState('');
  const [signozServices, setSignozServices] = useState<string[]>([]);

  // Agent Designer chat state (ephemeral — lives only while the modal is open).
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([
    {
      role: 'assistant',
      content:
        "Hi! Tell me what this production group should do and what kind of agents you imagine. I'll ask a few questions, then propose a set of agents you can review and edit.",
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [proposedAgents, setProposedAgents] = useState<AgentDesignProposalAgent[]>([]);
  const [finalizing, setFinalizing] = useState(false);

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatBusy || finalizing) return;
    const nextMessages = [...chatMessages, { role: 'user' as const, content: text }];
    setChatMessages(nextMessages);
    setChatInput('');
    setChatBusy(true);
    setChatError(null);
    try {
      const res = await api.agentDesigner.message(nextMessages);
      setChatMessages(prev => [...prev, { role: 'assistant', content: res.reply }]);

      const proposal = res.proposal;
      if (proposal) {
        const g = proposal.group ?? {};
        // Mirror the proposal into the form — but never overwrite a field the user edited.
        if (g.name && !nameManuallyEdited) setName(g.name);
        if (g.objective && !objectiveManuallyEdited) setObjective(g.objective);
        if (g.description && !descriptionManuallyEdited) setDescription(g.description);
        if (g.mode && !boardTypeManuallyEdited) setBoardType(g.mode);
        if (typeof g.maxAgents === 'number' && Number.isFinite(g.maxAgents) && !maxAgentsManuallyEdited) {
          setMaxAgents(Math.min(50, Math.max(1, Math.round(g.maxAgents))));
        }
        if (proposal.agents.length > 0) setProposedAgents(proposal.agents);

        // The chatbot creates the group directly once it has a complete proposal.
        if (g.name && proposal.agents.length > 0) {
          await finalizeFromProposal(proposal);
        }
      }
    } catch (err) {
      setChatError((err as Error).message);
    } finally {
      setChatBusy(false);
    }
  }

  async function finalizeFromProposal(proposal: AgentDesignProposal) {
    if (finalizing) return;
    setFinalizing(true);
    const g = proposal.group ?? {};
    // User-edited fields win over the Agent Designer's suggestions.
    const resolvedName = ((nameManuallyEdited && name.trim()) ? name : (g.name ?? name)).trim();
    const resolvedObjective = (objectiveManuallyEdited ? objective : (g.objective ?? objective)).trim();
    const resolvedDescription = (descriptionManuallyEdited ? description : (g.description ?? description)).trim();
    const resolvedMode = boardTypeManuallyEdited ? boardType : (g.mode ?? boardType);
    const resolvedMaxAgents = maxAgentsManuallyEdited
      ? maxAgents
      : (typeof g.maxAgents === 'number' ? Math.min(50, Math.max(1, Math.round(g.maxAgents))) : maxAgents);
    const agents = proposal.agents
      .map(a => ({ displayName: a.displayName.trim(), role: a.role.trim(), persona: a.persona.trim() }))
      .filter(a => a.displayName);
    setChatMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        content: `Creating "${resolvedName}" with ${agents.length} agent${agents.length === 1 ? '' : 's'} now — opening the group…`,
      },
    ]);
    try {
      await onSubmit({
        name: resolvedName,
        objective: resolvedObjective || undefined,
        description: resolvedDescription || undefined,
        boardType: resolvedMode,
        mode,
        maxAgents: resolvedMaxAgents,
        boardGroupId: boardGroupId || undefined,
        integrationScope: {
          primaryProvider,
          ...(githubRepoFullName && { githubRepo: repos.find(repo => repo.fullName === githubRepoFullName) }),
          ...(vercelProjectId && { vercelProject: projects.find(project => project.id === vercelProjectId) }),
          ...(bitbucketRepoFullName && { bitbucketRepo: bitbucketRepos.find(repo => repo.fullName === bitbucketRepoFullName) }),
          ...(signozService.trim() && { signozService: signozService.trim() }),
        },
        agents,
      });
      // onSubmit closes the modal and navigates to the new board on success.
    } catch (err) {
      setFinalizing(false);
      setChatError((err as Error).message);
      setChatMessages(prev => [
        ...prev,
        { role: 'assistant', content: `I couldn't create the group: ${(err as Error).message}. Want to try again?` },
      ]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadResources() {
      setResourcesLoading(true);
      setGithubResourcesError(null);
      setVercelResourcesError(null);
      setBitbucketResourcesError(null);
      try {
        const settings = await api.org.integrationSettings();
        const [repoResult, projectResult, bitbucketResult, signozResult] = await Promise.allSettled([
          settings.github.configured
            ? api.org.githubRepos()
            : Promise.resolve([] as GithubRepositorySummary[]),
          settings.vercel.configured
            ? api.org.vercelProjects()
            : Promise.resolve([] as VercelProjectSummary[]),
          settings.bitbucket.configured
            ? api.org.bitbucketRepos()
            : Promise.resolve([] as BitbucketRepositorySummary[]),
          settings.signoz.configured
            ? api.org.signozServices()
            : Promise.resolve([] as string[]),
        ]);
        if (cancelled) return;
        if (signozResult.status === 'fulfilled') {
          setSignozServices(signozResult.value as string[]);
        }
        if (repoResult.status === 'fulfilled') {
          setRepos(repoResult.value as GithubRepositorySummary[]);
        }
        if (projectResult.status === 'fulfilled') {
          setProjects(projectResult.value as VercelProjectSummary[]);
        }
        if (bitbucketResult.status === 'fulfilled') {
          setBitbucketRepos(bitbucketResult.value as BitbucketRepositorySummary[]);
        }
        if (repoResult.status === 'rejected') {
          setGithubResourcesError(repoResult.reason instanceof Error ? repoResult.reason.message : 'Failed to load GitHub repositories');
        }
        if (projectResult.status === 'rejected') {
          setVercelResourcesError(projectResult.reason instanceof Error ? projectResult.reason.message : 'Failed to load Vercel projects');
        }
        if (bitbucketResult.status === 'rejected') {
          setBitbucketResourcesError(bitbucketResult.reason instanceof Error ? bitbucketResult.reason.message : 'Failed to load Bitbucket repositories');
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-white/10 bg-surface-850 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <h3 className="text-lg font-semibold text-white">New Production Group</h3>
            <p className="mt-1 text-sm text-gray-500">Describe what you want on the left — design the agents, then review and create.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-500 transition-colors hover:bg-white/5 hover:text-white">
            x
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
          {/* Left: Agent Designer chat */}
          <div className="flex min-h-0 flex-col border-b border-white/10 md:border-b-0 md:border-r">
            <div className="flex items-center gap-2 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <Sparkles className="h-4 w-4 text-nexus-400" />
              Agent Designer
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-4">
              {chatMessages.map((msg, i) => (
                <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
                      msg.role === 'user'
                        ? 'bg-nexus-600 text-white'
                        : 'border border-white/10 bg-surface-900 text-gray-200',
                    )}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {chatBusy && (
                <div className="flex justify-start">
                  <div className="rounded-lg border border-white/10 bg-surface-900 px-3 py-2 text-sm text-gray-500">
                    Thinking…
                  </div>
                </div>
              )}
              {chatError && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {chatError}
                </div>
              )}
            </div>
            <div className="border-t border-white/10 p-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={chatInput}
                  onChange={event => setChatInput(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void sendChat();
                    }
                  }}
                  rows={2}
                  placeholder="e.g. Watch my Vercel deploys and auto-fix build failures"
                  className="min-h-[42px] flex-1 resize-none rounded-lg border border-white/10 bg-surface-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nexus-500"
                />
                <button
                  type="button"
                  onClick={() => void sendChat()}
                  disabled={!chatInput.trim() || chatBusy}
                  className="inline-flex h-[42px] items-center justify-center rounded-lg bg-nexus-600 px-3 text-white transition-colors hover:bg-nexus-500 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Right: group form + proposed agents */}
          <form onSubmit={event => event.preventDefault()} className="min-h-0 space-y-4 overflow-y-auto p-6">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">Name</label>
            <input
              value={name}
              onChange={event => { setName(event.target.value); setNameManuallyEdited(true); }}
              className="w-full rounded-lg border border-white/10 bg-surface-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nexus-500"
              placeholder="Type a name, or let the Agent Designer choose"
            />
            <p className="mt-1 text-[11px] text-gray-600">You can set your own name — it overrides the Agent Designer's suggestion.</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">Objective</label>
            <input
              value={objective}
              onChange={event => { setObjective(event.target.value); setObjectiveManuallyEdited(true); }}
              className="w-full rounded-lg border border-white/10 bg-surface-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nexus-500"
              placeholder="Set from your chat, or type your own"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">Description</label>
            <textarea
              value={description}
              onChange={event => { setDescription(event.target.value); setDescriptionManuallyEdited(true); }}
              rows={3}
              className="w-full resize-none rounded-lg border border-white/10 bg-surface-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nexus-500"
              placeholder="Set from your chat, or type your own"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">Mode</label>
              <select
                value={mode}
                onChange={event => setMode(event.target.value === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC')}
                className="w-full rounded-lg border border-white/10 bg-surface-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nexus-500"
              >
                <option value="AUTOMATIC">Automatic</option>
                <option value="MANUAL">Manual</option>
              </select>
              <p className="mt-1 text-[11px] text-gray-600">
                {mode === 'MANUAL' ? 'You watch logs and trigger fixes.' : 'Auto-fixes every captured error.'}
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">Type</label>
              <select
                value={boardType}
                onChange={event => { setBoardType(event.target.value); setBoardTypeManuallyEdited(true); }}
                className="w-full rounded-lg border border-white/10 bg-surface-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nexus-500"
              >
                <option value="continuous">Continuous</option>
                <option value="sprint">Sprint</option>
                <option value="goal">Goal</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">Max Agents</label>
              <input
                type="number"
                value={maxAgents}
                onChange={event => { setMaxAgents(Math.min(50, Math.max(1, parseInt(event.target.value) || 1))); setMaxAgentsManuallyEdited(true); }}
                min={1}
                max={50}
                className="w-full rounded-lg border border-white/10 bg-surface-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nexus-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">Collection</label>
              <select
                value={boardGroupId}
                onChange={event => setBoardGroupId(event.target.value)}
                className="w-full rounded-lg border border-white/10 bg-surface-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nexus-500"
              >
                <option value="">None</option>
                {groups.map(group => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-lg border border-white/5 bg-surface-900 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Connected resources</label>
              {resourcesLoading && <span className="text-[11px] text-gray-600">Loading...</span>}
            </div>
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-gray-400">Primary provider (where fixes are pushed)</label>
              <div className="grid grid-cols-2 gap-2">
                {(['github', 'bitbucket'] as const).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPrimaryProvider(p)}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-center text-sm font-medium transition-colors',
                      primaryProvider === p
                        ? 'border-nexus-500/60 bg-nexus-600/15 text-white'
                        : 'border-white/10 bg-surface-850 text-gray-400 hover:bg-white/5',
                    )}
                  >
                    {p === 'github' ? 'GitHub' : 'Bitbucket'}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">GitHub repository</label>
                <select
                  value={githubRepoFullName}
                  onChange={event => setGithubRepoFullName(event.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-surface-850 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nexus-500"
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
                <label className="mb-1 block text-xs font-medium text-gray-400">Vercel website</label>
                <select
                  value={vercelProjectId}
                  onChange={event => setVercelProjectId(event.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-surface-850 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nexus-500"
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
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">Bitbucket repository</label>
                <select
                  value={bitbucketRepoFullName}
                  onChange={event => setBitbucketRepoFullName(event.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-surface-850 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nexus-500"
                >
                  <option value="">No repository</option>
                  {bitbucketRepos.map(repo => (
                    <option key={repo.fullName} value={repo.fullName}>
                      {repo.fullName}{repo.isPrivate ? ' (private)' : ''}
                    </option>
                  ))}
                </select>
                {bitbucketResourcesError && (
                  <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    {bitbucketResourcesError}{' '}
                    <Link to="/settings" className="text-amber-100 underline">Settings</Link>
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">SigNoz service (for logs)</label>
                <input
                  value={signozService}
                  onChange={event => setSignozService(event.target.value)}
                  list="signoz-services-create"
                  placeholder={signozServices.length ? 'Pick the service for this repo…' : 'e.g. blostem-core-web'}
                  className="w-full rounded-lg border border-white/10 bg-surface-850 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-nexus-500"
                />
                <datalist id="signoz-services-create">
                  {signozServices.map(s => <option key={s} value={s} />)}
                </datalist>
                <p className="mt-1 text-[11px] text-gray-600">
                  {signozServices.length
                    ? `Pick the service whose logs belong to this repo (${signozServices.length} found).`
                    : "Scopes this group's live logs (used by the Manual tab)."}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-white/5 bg-surface-900 p-4">
            <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Proposed agents{proposedAgents.length > 0 ? ` (${proposedAgents.length})` : ''}
            </label>
            {proposedAgents.length === 0 ? (
              <p className="text-xs text-gray-600">
                Chat with the Agent Designer on the left — once it has enough detail it will design these agents and
                create the group automatically.
              </p>
            ) : (
              <div className="space-y-3">
                {proposedAgents.map((agent, index) => (
                  <div key={index} className="rounded-lg border border-white/10 bg-surface-850 p-3">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 shrink-0 text-nexus-400" />
                      <span className="text-sm font-medium text-white">{agent.displayName || 'Unnamed agent'}</span>
                    </div>
                    {agent.role && <p className="mt-1 text-xs text-nexus-300">{agent.role}</p>}
                    {agent.persona && <p className="mt-1.5 text-xs leading-relaxed text-gray-400">{agent.persona}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <p className="text-xs text-gray-600">
              {finalizing
                ? 'Creating the group…'
                : 'The Agent Designer creates this group once it has enough detail.'}
            </p>
            <button type="button" onClick={onClose} disabled={finalizing} className="rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors hover:text-white disabled:opacity-50">
              Cancel
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}
