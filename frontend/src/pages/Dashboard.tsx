import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bot, CheckCircle2, Clock3, FolderKanban, MessageSquare, Plus, RefreshCw } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { api } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import type { Board, BoardGroup, GithubRepositorySummary, Task, VercelProjectSummary } from '@/types';

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
      maxAgents: data.maxAgents,
      boardGroupId: data.boardGroupId || undefined,
      integrationScope: data.integrationScope,
    }) as ProductionBoard;
    setBoards(prev => [board, ...prev]);
    setShowCreate(false);
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
  maxAgents: number;
  boardGroupId?: string;
  integrationScope?: {
    githubRepo?: GithubRepositorySummary;
    vercelProject?: VercelProjectSummary;
  };
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
  const [objective, setObjective] = useState('');
  const [description, setDescription] = useState('');
  const [boardType, setBoardType] = useState('continuous');
  const [maxAgents, setMaxAgents] = useState(5);
  const [boardGroupId, setBoardGroupId] = useState('');
  const [repos, setRepos] = useState<GithubRepositorySummary[]>([]);
  const [projects, setProjects] = useState<VercelProjectSummary[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [githubResourcesError, setGithubResourcesError] = useState<string | null>(null);
  const [vercelResourcesError, setVercelResourcesError] = useState<string | null>(null);
  const [githubRepoFullName, setGithubRepoFullName] = useState('');
  const [vercelProjectId, setVercelProjectId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        if (repoResult.status === 'fulfilled') {
          setRepos(repoResult.value as GithubRepositorySummary[]);
        }
        if (projectResult.status === 'fulfilled') {
          setProjects(projectResult.value as VercelProjectSummary[]);
        }
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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        objective: objective.trim() || undefined,
        description: description.trim() || undefined,
        boardType,
        maxAgents,
        boardGroupId: boardGroupId || undefined,
        integrationScope: {
          ...(githubRepoFullName && { githubRepo: repos.find(repo => repo.fullName === githubRepoFullName) }),
          ...(vercelProjectId && { vercelProject: projects.find(project => project.id === vercelProjectId) }),
        },
      });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-xl rounded-lg border border-white/10 bg-surface-850 p-6 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">New Production Group</h3>
            <p className="mt-1 text-sm text-gray-500">Create a workroom for sub-agents and Mother Chat.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-500 transition-colors hover:bg-white/5 hover:text-white">
            x
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">Name</label>
            <input
              value={name}
              onChange={event => setName(event.target.value)}
              autoFocus
              className="w-full rounded-lg border border-white/10 bg-surface-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nexus-500"
              placeholder="Release control room"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">Objective</label>
            <input
              value={objective}
              onChange={event => setObjective(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-surface-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nexus-500"
              placeholder="Keep production release healthy"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">Description</label>
            <textarea
              value={description}
              onChange={event => setDescription(event.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-white/10 bg-surface-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nexus-500"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">Mode</label>
              <select
                value={boardType}
                onChange={event => setBoardType(event.target.value)}
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
                onChange={event => setMaxAgents(Number(event.target.value) || 1)}
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
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors hover:text-white">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || saving}
              className="inline-flex items-center gap-2 rounded-lg bg-nexus-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-nexus-500 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
