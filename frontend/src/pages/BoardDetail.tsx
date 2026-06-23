import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { AlertTriangle, Trash2, Plus, X, Inbox } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Board, Task, TaskStatus, Agent, SigNozLog, GithubRepositorySummary, BitbucketRepositorySummary } from '@/types';

const COLUMNS: TaskStatus[] = ['BACKLOG', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW', 'DONE'];

// Neutral panels — the status color lives in the dot + header accent line, not a
// full tinted rectangle (which read as heavy/chunky, especially when empty).
const columnConfig: Record<TaskStatus, { label: string; dot: string; accent: string }> = {
  BACKLOG: { label: 'Backlog', dot: 'bg-gray-400', accent: '#9ca3af' },
  ASSIGNED: { label: 'Assigned', dot: 'bg-blue-400', accent: '#3b8eff' },
  IN_PROGRESS: { label: 'In Progress', dot: 'bg-violet-400', accent: '#8b5cf6' },
  REVIEW: { label: 'Review', dot: 'bg-amber-400', accent: '#f59e0b' },
  DONE: { label: 'Done', dot: 'bg-emerald-400', accent: '#10b981' },
};

const priorityBadge: Record<string, string> = {
  LOW: 'text-gray-400 bg-gray-500/10',
  MEDIUM: 'text-blue-400 bg-blue-500/10',
  HIGH: 'text-amber-400 bg-amber-500/10',
  CRITICAL: 'text-red-400 bg-red-500/10',
};

const boardTypeBadge: Record<string, { className: string; label: string }> = {
  goal: { className: 'text-blue-400 bg-blue-500/10 border-blue-500/20', label: 'Goal' },
  sprint: { className: 'text-violet-400 bg-violet-500/10 border-violet-500/20', label: 'Sprint' },
  continuous: { className: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', label: 'Continuous' },
};

interface BoardAgent {
  id: string;
  displayName: string;
  avatar: string | null;
  status: string;
  isBoardLead: boolean;
}

export function BoardDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<BoardAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [view, setView] = useState<'board' | 'manual'>('board');
  const [showAddTask, setShowAddTask] = useState<TaskStatus | null>(null);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);

  const loadBoard = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.boards.get(id);
      setBoard(data);
      setTasks(data.tasks || []);
      setAgents((data.agents || []) as BoardAgent[]);
    } catch (err) {
      console.error('Failed to load board:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const tasksByStatus = useCallback(
    (status: TaskStatus) => tasks.filter(t => t.status === status),
    [tasks]
  );

  async function handleDragEnd(result: DropResult) {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId as TaskStatus;
    const taskId = result.draggableId;
    if (newStatus === result.source.droppableId) return;

    // Optimistic update
    setTasks(prev =>
      prev.map(t => (t.id === taskId ? { ...t, status: newStatus } : t))
    );

    try {
      await api.tasks.update(taskId, { status: newStatus } as Partial<Task>);
    } catch {
      // Revert on failure
      loadBoard();
    }
  }

  async function handleAddTask(status: TaskStatus, title: string, priority: string) {
    try {
      const task = await api.tasks.create({
        title,
        priority,
        status,
        boardId: id,
        agentId: undefined,
      });
      setTasks(prev => [...prev, { ...task, status }]);
      setShowAddTask(null);
    } catch (err) {
      console.error('Failed to create task:', err);
    }
  }

  async function handleDeleteTask(taskId: string) {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    try {
      await api.tasks.delete(taskId);
    } catch {
      loadBoard();
    }
  }

  async function handleAddAgent(agentId: string, isLead: boolean) {
    if (!id) return;
    try {
      const agent = await api.boards.addAgent(id, { agentId, isLead });
      setAgents(prev => [...prev, agent as unknown as BoardAgent]);
      setShowAddAgent(false);
    } catch (err) {
      console.error('Failed to add agent:', err);
    }
  }

  async function handleRemoveAgent(agentId: string) {
    if (!id) return;
    setAgents(prev => prev.filter(a => a.id !== agentId));
    try {
      await api.boards.removeAgent(id, agentId);
    } catch {
      loadBoard();
    }
  }

  async function handleUpdateBoard(data: Record<string, unknown>) {
    if (!id) return;
    try {
      const updated = await api.boards.update(id, data);
      setBoard(updated);
    } catch (err) {
      console.error('Failed to update board:', err);
    }
  }

  async function handleDeleteBoard() {
    if (!id) return;
    await api.boards.delete(id, { deleteScopedData: true });
    navigate('/dashboard');
  }

  async function loadAllAgents() {
    try {
      const data = await api.agents.list();
      setAllAgents(data);
    } catch {
      // ignore
    }
  }

  if (loading) {
    return (
      <div>
        <Header title="Board" subtitle="Loading..." />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-nexus-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!board) {
    return (
      <div>
        <Header title="Board" subtitle="Not found" />
        <div className="rounded-xl border border-white/5 bg-surface-850 p-12 text-center">
          <h3 className="text-lg font-semibold text-white mb-1">Board Not Found</h3>
          <p className="text-sm text-gray-500 mb-4">This board may have been deleted.</p>
          <Link
            to="/boards"
            className="px-4 py-2 rounded-lg text-sm font-medium bg-nexus-600 text-white hover:bg-nexus-500 transition-colors"
          >
            Back to Boards
          </Link>
        </div>
      </div>
    );
  }

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter(t => t.status === 'DONE').length;
  const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const btStyle = boardTypeBadge[board.boardType] || boardTypeBadge.goal;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 pt-6 mb-2">
        <Link to="/boards" className="hover:text-white transition-colors">Boards</Link>
        <span>/</span>
        <span className="text-white">{board.name}</span>
      </div>

      {/* Board header card */}
      <div className="rounded-xl border border-white/5 bg-surface-850 p-5 mb-6">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-xl font-bold text-white">{board.name}</h2>
              <span
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider border',
                  btStyle.className
                )}
              >
                {btStyle.label}
              </span>
            </div>
            {board.objective && (
              <p className="text-sm text-nexus-400 mt-1">{board.objective}</p>
            )}
            {board.description && (
              <p className="text-xs text-gray-500 mt-1">{board.description}</p>
            )}
          </div>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 transition-colors"
          >
            {showSettings ? 'Close Settings' : 'Settings'}
          </button>
        </div>

        {/* Progress + stats row */}
        <div className="flex items-center gap-6">
          {/* Progress bar */}
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">Progress</span>
              <span className="text-xs text-white font-medium">{progressPct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full bg-nexus-500 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4">
            <div className="text-center px-3">
              <div className="text-lg font-bold text-white">{totalTasks}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Tasks</div>
            </div>
            <div className="text-center px-3">
              <div className="text-lg font-bold text-emerald-400">{doneTasks}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Done</div>
            </div>
            <div className="text-center px-3">
              <div className="text-lg font-bold text-white">{agents.length}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Agents</div>
            </div>
            {board.targetDate && (
              <div className="text-center px-3">
                <div className="text-sm font-medium text-white">
                  {new Date(board.targetDate).toLocaleDateString()}
                </div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">Target</div>
              </div>
            )}
          </div>
        </div>

        {/* Agent avatars bar */}
        {agents.length > 0 && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-white/5">
            <span className="text-xs text-gray-500 mr-1">Agents:</span>
            {agents.map(agent => (
              <div
                key={agent.id}
                className="relative group"
              >
                <div
                  className={cn(
                    'w-8 h-8 rounded-full bg-surface-900 border border-white/10 flex items-center justify-center text-sm',
                    agent.isBoardLead && 'ring-2 ring-nexus-500/50'
                  )}
                >
                  {agent.avatar || agent.displayName.charAt(0)}
                </div>
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded bg-surface-900 border border-white/10 text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
                  {agent.displayName}
                  {agent.isBoardLead && ' (Lead)'}
                </div>
              </div>
            ))}
            <button
              onClick={() => { setShowAddAgent(true); loadAllAgents(); }}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-white/10 bg-white/5 text-gray-500 transition-colors hover:border-white/20 hover:text-white"
              title="Add agent"
            >
              <Plus className="h-4 w-4" />
            </button>
            <Link
              to={`/agents/new?boardId=${encodeURIComponent(board.id)}&returnTo=${encodeURIComponent(`/production/${board.id}`)}`}
              className="ml-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-white/5"
            >
              Create sub-agent
            </Link>
          </div>
        )}
        {agents.length === 0 && (
          <div className="mt-4 flex items-center gap-3 border-t border-white/5 pt-4">
            <button
              onClick={() => { setShowAddAgent(true); loadAllAgents(); }}
              className="text-xs text-gray-500 hover:text-nexus-400 transition-colors"
            >
              + Add agents to this board
            </button>
            <Link
              to={`/agents/new?boardId=${encodeURIComponent(board.id)}&returnTo=${encodeURIComponent(`/production/${board.id}`)}`}
              className="text-xs text-gray-500 transition-colors hover:text-nexus-400"
            >
              Create sub-agent
            </Link>
          </div>
        )}
      </div>

      {/* Settings sidebar */}
      {showSettings && (
        <BoardSettings
          board={board}
          agents={agents}
          onUpdate={handleUpdateBoard}
          onRemoveAgent={handleRemoveAgent}
          onDelete={handleDeleteBoard}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Tabs (Manual mode only) */}
      {board.mode === 'MANUAL' && (
        <div className="mb-4 flex items-center gap-1 border-b border-white/5">
          {(['board', 'manual'] as const).map(t => (
            <button
              key={t}
              onClick={() => setView(t)}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                view === t
                  ? 'border-nexus-500 text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              )}
            >
              {t === 'board' ? 'Board' : 'Manual'}
            </button>
          ))}
        </div>
      )}

      {/* Manual log-watch + fix composer */}
      {board.mode === 'MANUAL' && view === 'manual' && (
        <ManualTab board={board} />
      )}

      {/* Kanban board */}
      {!(board.mode === 'MANUAL' && view === 'manual') && (
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {COLUMNS.map(status => {
            const col = columnConfig[status];
            const statusTasks = tasksByStatus(status);

            return (
              <div key={status} className="flex flex-col rounded-xl border border-white/5 bg-surface-900/40">
                {/* Column header with a thin status accent line */}
                <div className="border-b border-white/5 px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={cn('h-2 w-2 rounded-full', col.dot)} />
                      <span className="text-[13px] font-semibold text-gray-200">{col.label}</span>
                      <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[11px] tabular-nums text-gray-400">
                        {statusTasks.length}
                      </span>
                    </div>
                    <button
                      onClick={() => setShowAddTask(status)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-white/5 hover:text-white"
                      title="Add task"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-2 h-0.5 rounded-full" style={{ background: `${col.accent}55` }} />
                </div>

                {/* Droppable area */}
                <Droppable droppableId={status}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={cn(
                        'flex-1 rounded-b-xl p-2 transition-colors',
                        statusTasks.length === 0 ? 'min-h-[120px]' : 'min-h-[60px]',
                        snapshot.isDraggingOver && 'bg-white/[0.03]'
                      )}
                    >
                      {statusTasks.length === 0 && !snapshot.isDraggingOver && (
                        <button
                          onClick={() => setShowAddTask(status)}
                          className="flex h-[104px] w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/5 text-gray-600 transition-colors hover:border-white/15 hover:text-gray-400"
                        >
                          <Inbox className="h-4 w-4" />
                          <span className="text-[11px]">No tasks</span>
                        </button>
                      )}
                      {statusTasks.map((task, index) => (
                        <Draggable key={task.id} draggableId={task.id} index={index}>
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              className={cn(
                                'rounded-lg border p-3 mb-2 transition-all',
                                dragSnapshot.isDragging
                                  ? 'bg-surface-700 border-nexus-500/40 shadow-lg shadow-nexus-500/10 rotate-2'
                                  : 'bg-surface-850 border-white/5 hover:border-white/10'
                              )}
                            >
                              {/* Priority + delete */}
                              <div className="flex items-center justify-between mb-2">
                                <span
                                  className={cn(
                                    'text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider',
                                    priorityBadge[task.priority] || priorityBadge.MEDIUM
                                  )}
                                >
                                  {task.priority}
                                </span>
                                <button
                                  onClick={e => { e.stopPropagation(); handleDeleteTask(task.id); }}
                                  className="text-gray-600 transition-colors hover:text-red-400"
                                  title="Delete task"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>

                              {/* Title */}
                              <h4 className="text-sm font-medium text-white mb-1">{task.title}</h4>

                              {/* Description */}
                              {task.description && (
                                <p className="text-xs text-gray-500 mb-2 line-clamp-2">{task.description}</p>
                              )}

                              {/* Agent avatar */}
                              <div className="flex items-center justify-between pt-2 border-t border-white/5">
                                {task.agent ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs">{task.agent.avatar}</span>
                                    <span className="text-xs text-gray-400">{task.agent.displayName}</span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-gray-600">Unassigned</span>
                                )}
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>
      )}

      {/* Add task inline modal */}
      {showAddTask && (
        <AddTaskInline
          status={showAddTask}
          boardAgents={agents}
          onClose={() => setShowAddTask(null)}
          onSubmit={handleAddTask}
        />
      )}

      {/* Add agent modal */}
      {showAddAgent && (
        <AddAgentModal
          allAgents={allAgents}
          boardAgents={agents}
          onClose={() => setShowAddAgent(false)}
          onSubmit={handleAddAgent}
        />
      )}
    </div>
  );
}

// ─── Manual Tab: live logs + fix composer ────────────

const SEVERITY_COLOR: Record<string, string> = {
  ERROR: 'text-red-400 bg-red-500/10',
  WARN: 'text-amber-400 bg-amber-500/10',
  WARNING: 'text-amber-400 bg-amber-500/10',
  INFO: 'text-blue-400 bg-blue-500/10',
  DEBUG: 'text-gray-400 bg-gray-500/10',
};

function ManualTab({ board }: { board: Board }) {
  const service = board.successMetrics?.integrationScope?.signozService;
  const [logs, setLogs] = useState<SigNozLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SigNozLog | null>(null);
  const [instructions, setInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; text: string; prUrl?: string | null } | null>(null);

  const loadLogs = useCallback(async () => {
    try {
      const res = await api.boards.logs(board.id, { sinceMs: 60 * 60 * 1000, limit: 200 });
      setLogs(res.logs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [board.id]);

  useEffect(() => {
    loadLogs();
    const t = setInterval(loadLogs, 10000);
    return () => clearInterval(t);
  }, [loadLogs]);

  async function handleSubmit() {
    if (!instructions.trim()) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await api.boards.startManualFix(board.id, {
        instructions: instructions.trim(),
        log: selected
          ? {
              body: selected.body,
              severity: selected.severity,
              timestamp: selected.timestamp,
              traceId: selected.traceId,
              serviceName: selected.serviceName,
            }
          : undefined,
      });
      const prUrl = res.errorEvent?.prUrl ?? null;
      setResult({
        type: 'success',
        text: `Fix queued (event ${res.errorEvent.id.slice(0, 8)}). The agent will open a pull request.`,
        prUrl,
      });
      setInstructions('');
      setSelected(null);
    } catch (err) {
      setResult({ type: 'error', text: err instanceof Error ? err.message : 'Failed to start fix' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Left: live logs */}
      <div className="rounded-xl border border-white/5 bg-surface-850 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white">Live logs</h3>
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" title="auto-refreshing" />
          </div>
          <span className="text-xs text-gray-500">{service ? service : 'no service set'}</span>
        </div>

        {!service && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">
            Set a SigNoz service name in Settings to scope this group's logs.
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300">{error}</div>
        )}
        {loading && logs.length === 0 && <div className="py-8 text-center text-xs text-gray-500">Loading logs…</div>}
        {!loading && logs.length === 0 && !error && (
          <div className="py-8 text-center text-xs text-gray-500">No logs in the last hour.</div>
        )}

        <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
          {logs.map((log, i) => {
            const sev = (log.severity || '').toUpperCase();
            const isSel = selected === log;
            return (
              <button
                key={`${log.timestamp}-${i}`}
                onClick={() => setSelected(log)}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                  isSel ? 'border-nexus-500/60 bg-nexus-600/10' : 'border-white/5 bg-surface-900 hover:bg-white/5'
                )}
              >
                <div className="mb-1 flex items-center gap-1.5 flex-wrap">
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', SEVERITY_COLOR[sev] || 'text-gray-400 bg-gray-500/10')}>
                    {sev || 'log'}
                  </span>
                  {log.serviceName && (
                    <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-300">{log.serviceName}</span>
                  )}
                  <span className="ml-auto text-[10px] tabular-nums text-gray-500">
                    {new Date(log.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  {Object.keys(log.attributes ?? {}).length > 0 && (
                    <span className="text-[9px] text-gray-600">{Object.keys(log.attributes).length} attrs</span>
                  )}
                </div>
                <div className="line-clamp-2 font-mono text-xs text-gray-300">{log.body}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: log detail + fix composer */}
      <div className="flex max-h-[80vh] flex-col gap-3 overflow-y-auto">

        {/* Log detail panel */}
        {selected ? (
          <div className="rounded-xl border border-nexus-500/30 bg-surface-850 p-4">
            {/* Header row */}
            <div className="mb-3 flex items-center gap-2">
              <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', SEVERITY_COLOR[(selected.severity || '').toUpperCase()] || 'text-gray-400 bg-gray-500/10')}>
                {(selected.severity || 'LOG').toUpperCase()}
              </span>
              {selected.serviceName && (
                <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">
                  {selected.serviceName}
                </span>
              )}
              <span className="ml-auto text-[10px] tabular-nums text-gray-500">
                {new Date(selected.timestamp).toLocaleString(undefined, {
                  year: 'numeric', month: 'short', day: '2-digit',
                  hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3,
                })}
              </span>
              <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-white" title="deselect">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Trace ID */}
            {selected.traceId && (
              <div className="mb-3 flex items-center gap-2 rounded-lg bg-surface-900 px-3 py-2">
                <span className="text-[10px] uppercase tracking-wider text-gray-500">Trace ID</span>
                <span className="ml-auto font-mono text-[11px] text-gray-300">{selected.traceId}</span>
              </div>
            )}

            {/* Full log body */}
            <div className="mb-3">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">Message</div>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-surface-900 p-3 font-mono text-xs text-gray-200">
                {selected.body}
              </pre>
            </div>

            {/* All attributes */}
            {Object.keys(selected.attributes ?? {}).length > 0 && (
              <div>
                <div className="mb-2 text-[10px] uppercase tracking-wider text-gray-500">Attributes</div>
                <div className="rounded-lg border border-white/5 bg-surface-900 divide-y divide-white/5">
                  {Object.entries(selected.attributes).map(([k, v]) => (
                    <div key={k} className="flex items-start gap-3 px-3 py-1.5">
                      <span className="w-[45%] shrink-0 font-mono text-[11px] text-gray-500 break-all">{k}</span>
                      <span className="font-mono text-[11px] text-gray-200 break-all">
                        {v === null ? <span className="text-gray-600">null</span>
                          : typeof v === 'object' ? JSON.stringify(v)
                          : String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 bg-surface-850 p-6 text-center text-xs text-gray-500">
            Click a log on the left to see its full details.
          </div>
        )}

        {/* Fix composer */}
        <div className="rounded-xl border border-white/5 bg-surface-850 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Fix this</h3>
          <label className="mb-1 block text-xs uppercase tracking-wider text-gray-400">What should the agent fix?</label>
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            rows={4}
            placeholder="Describe the fix. The agent has access to this group's repo and will open a pull request."
            className="w-full resize-y rounded-lg border border-white/10 bg-surface-900 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-nexus-500/50 focus:outline-none"
          />
          <button
            onClick={handleSubmit}
            disabled={submitting || !instructions.trim()}
            className="mt-3 w-full rounded-lg bg-nexus-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-nexus-500 disabled:opacity-50"
          >
            {submitting ? 'Starting fix…' : 'Send to agent'}
          </button>
          {result && (
            <div className={cn('mt-3 rounded-lg border p-3 text-xs', result.type === 'success' ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300' : 'border-red-500/20 bg-red-500/5 text-red-300')}>
              {result.text}
              {result.prUrl && (
                <> <a href={result.prUrl} target="_blank" rel="noreferrer" className="underline hover:text-white">View pull request</a></>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Add Task Inline Modal ───────────────────────────

function AddTaskInline({
  status,
  boardAgents,
  onClose,
  onSubmit,
}: {
  status: TaskStatus;
  boardAgents: { id: string; displayName: string; avatar: string | null }[];
  onClose: () => void;
  onSubmit: (status: TaskStatus, title: string, priority: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('MEDIUM');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit(status, title.trim(), priority);
  }

  const colLabel = columnConfig[status].label;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-surface-850 border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-white mb-4">
          Add Task to {colLabel}
        </h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full bg-surface-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-nexus-500/50"
              placeholder="Task title..."
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Priority</label>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value)}
              className="w-full bg-surface-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-nexus-500/50"
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="px-4 py-2 bg-nexus-600 hover:bg-nexus-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              Add Task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Add Agent Modal ─────────────────────────────────

function AddAgentModal({
  allAgents,
  boardAgents,
  onClose,
  onSubmit,
}: {
  allAgents: Agent[];
  boardAgents: { id: string }[];
  onClose: () => void;
  onSubmit: (agentId: string, isLead: boolean) => void;
}) {
  const [selectedAgent, setSelectedAgent] = useState('');
  const [isLead, setIsLead] = useState(false);

  const boardAgentIds = new Set(boardAgents.map(a => a.id));
  const availableAgents = allAgents.filter(a => !boardAgentIds.has(a.id));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedAgent) return;
    onSubmit(selectedAgent, isLead);
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-surface-850 border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-white mb-4">Add Agent to Board</h3>

        {availableAgents.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-gray-500 mb-4">All agents are already assigned to this board.</p>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Agent</label>
              <select
                value={selectedAgent}
                onChange={e => setSelectedAgent(e.target.value)}
                className="w-full bg-surface-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-nexus-500/50"
              >
                <option value="">Select an agent...</option>
                {availableAgents.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.avatar} {a.displayName}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-surface-900 border border-white/10">
              <div>
                <span className="text-sm text-white">Board Lead</span>
                <p className="text-xs text-gray-500 mt-0.5">This agent can delegate tasks to other board members</p>
              </div>
              <button
                type="button"
                onClick={() => setIsLead(!isLead)}
                className={cn(
                  'relative w-10 h-5 rounded-full transition-colors',
                  isLead ? 'bg-nexus-600' : 'bg-white/10'
                )}
              >
                <span
                  className={cn(
                    'absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                    isLead ? 'translate-x-5' : 'translate-x-0'
                  )}
                />
              </button>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!selectedAgent}
                className="px-4 py-2 bg-nexus-600 hover:bg-nexus-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                Add Agent
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Board Settings Panel ────────────────────────────

function BoardSettings({
  board,
  agents,
  onUpdate,
  onRemoveAgent,
  onDelete,
  onClose,
}: {
  board: Board;
  agents: { id: string; displayName: string; avatar: string | null; isBoardLead: boolean }[];
  onUpdate: (data: Record<string, unknown>) => void;
  onRemoveAgent: (agentId: string) => void;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [objective, setObjective] = useState(board.objective || '');
  const [targetDate, setTargetDate] = useState(
    board.targetDate ? new Date(board.targetDate).toISOString().split('T')[0] : ''
  );
  const [maxAgents, setMaxAgents] = useState(board.maxAgents);
  const [requireApproval, setRequireApproval] = useState(board.requireApprovalForDone);
  const [mode, setMode] = useState<'AUTOMATIC' | 'MANUAL'>(board.mode === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC');
  const [primaryProvider, setPrimaryProvider] = useState<'github' | 'bitbucket'>(
    board.successMetrics?.integrationScope?.primaryProvider === 'bitbucket' ? 'bitbucket' : 'github'
  );
  const [signozService, setSignozService] = useState(
    board.successMetrics?.integrationScope?.signozService || ''
  );
  const [signozServices, setSignozServices] = useState<string[]>([]);
  const [githubRepos, setGithubRepos] = useState<GithubRepositorySummary[]>([]);
  const [bbRepoList, setBbRepoList] = useState<BitbucketRepositorySummary[]>([]);
  const [showGhPicker, setShowGhPicker] = useState(false);
  const [ghPickerQ, setGhPickerQ] = useState('');
  const [showBbPicker, setShowBbPicker] = useState(false);
  const [bbPickerQ, setBbPickerQ] = useState('');
  useEffect(() => {
    api.org.signozServices().then(setSignozServices).catch(() => setSignozServices([]));
    api.org.githubRepos().then(setGithubRepos).catch(() => setGithubRepos([]));
    api.org.bitbucketRepos().then(setBbRepoList).catch(() => setBbRepoList([]));
  }, []);
  const [ghRepo, setGhRepo] = useState(
    board.successMetrics?.integrationScope?.githubRepo?.fullName || ''
  );
  const [ghBranch, setGhBranch] = useState(
    board.successMetrics?.integrationScope?.githubRepo?.branch || ''
  );
  const [bbRepo, setBbRepo] = useState(
    board.successMetrics?.integrationScope?.bitbucketRepo?.fullName || ''
  );
  const [bbBranch, setBbBranch] = useState(
    board.successMetrics?.integrationScope?.bitbucketRepo?.branch || ''
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    const githubRepoFullName = ghRepo.trim();
    const bitbucketRepoFullName = bbRepo.trim();
    const signozServiceName = signozService.trim();
    await onUpdate({
      mode,
      objective: objective.trim() || null,
      targetDate: targetDate || null,
      maxAgents,
      requireApprovalForDone: requireApproval,
      integrationScope: {
        primaryProvider,
        ...(githubRepoFullName && {
          githubRepo: { fullName: githubRepoFullName, branch: ghBranch.trim() || 'main' },
        }),
        ...(bitbucketRepoFullName && {
          bitbucketRepo: { fullName: bitbucketRepoFullName, branch: bbBranch.trim() || 'main' },
        }),
        ...(signozServiceName && { signozService: signozServiceName }),
      },
    });
    setSaving(false);
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete production group');
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/5 bg-surface-850 p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">Board Settings</h3>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-white transition-colors text-sm"
        >
          &#10005;
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Objective */}
        <div className="col-span-2">
          <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Objective</label>
          <input
            type="text"
            value={objective}
            onChange={e => setObjective(e.target.value)}
            className="w-full bg-surface-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-nexus-500/50"
            placeholder="Board objective..."
          />
        </div>

        {/* Target Date */}
        <div>
          <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Target Date</label>
          <input
            type="date"
            value={targetDate}
            onChange={e => setTargetDate(e.target.value)}
            className="w-full bg-surface-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-nexus-500/50"
          />
        </div>

        {/* Max Agents */}
        <div>
          <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Max Agents</label>
          <input
            type="number"
            value={maxAgents}
            onChange={e => setMaxAgents(parseInt(e.target.value) || 1)}
            min={1}
            max={50}
            className="w-full bg-surface-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-nexus-500/50"
          />
        </div>
      </div>

      {/* Require approval toggle */}
      <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-surface-900 border border-white/10 mb-4">
        <div>
          <span className="text-sm text-white">Require approval for done</span>
          <p className="text-xs text-gray-500 mt-0.5">Tasks need manual approval before moving to Done</p>
        </div>
        <button
          type="button"
          onClick={() => setRequireApproval(!requireApproval)}
          className={cn(
            'relative w-10 h-5 rounded-full transition-colors',
            requireApproval ? 'bg-nexus-600' : 'bg-white/10'
          )}
        >
          <span
            className={cn(
              'absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
              requireApproval ? 'translate-x-5' : 'translate-x-0'
            )}
          />
        </button>
      </div>

      {/* Mode: automatic pipeline vs manual log-watch */}
      <div className="mb-4 rounded-lg border border-white/5 bg-surface-900 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-semibold text-white">Mode</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(['AUTOMATIC', 'MANUAL'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'rounded-lg border px-3 py-2 text-left transition-colors',
                mode === m
                  ? 'border-nexus-500/60 bg-nexus-600/15 text-white'
                  : 'border-white/10 bg-surface-850 text-gray-400 hover:bg-white/5'
              )}
            >
              <div className="text-sm font-medium capitalize">{m.toLowerCase()}</div>
              <div className="text-[11px] text-gray-500">
                {m === 'AUTOMATIC'
                  ? 'Auto-fix every captured error'
                  : 'Watch logs; you trigger fixes'}
              </div>
            </button>
          ))}
        </div>
        <label className="mt-3 mb-1 block text-xs text-gray-400 uppercase tracking-wider">SigNoz service name</label>
        <input
          value={signozService}
          onChange={e => setSignozService(e.target.value)}
          list="signoz-services-board"
          placeholder={signozServices.length ? 'Pick the service for this repo…' : 'e.g. blostem-core-web'}
          className="w-full bg-surface-850 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-nexus-500/50"
        />
        <datalist id="signoz-services-board">
          {signozServices.map(s => <option key={s} value={s} />)}
        </datalist>
        <p className="mt-2 text-xs text-gray-500">
          {signozServices.length
            ? `Pick the service whose logs belong to this repo (${signozServices.length} found). The Manual tab and Logs page filter by this service.name.`
            : <>Scopes this group's live logs (the Manual tab and the Logs page filter by this <code>service.name</code>).</>}
        </p>
      </div>

      {/* Primary source provider — where fixes are pushed */}
      <div className="mb-4 rounded-lg border border-white/5 bg-surface-900 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-semibold text-white">Primary source provider</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(['github', 'bitbucket'] as const).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPrimaryProvider(p)}
              className={cn(
                'rounded-lg border px-3 py-2 text-center text-sm font-medium capitalize transition-colors',
                primaryProvider === p
                  ? 'border-nexus-500/60 bg-nexus-600/15 text-white'
                  : 'border-white/10 bg-surface-850 text-gray-400 hover:bg-white/5'
              )}
            >
              {p === 'github' ? 'GitHub' : 'Bitbucket'}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Fixes are committed and a pull request is opened on the <strong>{primaryProvider === 'bitbucket' ? 'Bitbucket' : 'GitHub'}</strong> repo below.
        </p>
      </div>

      {/* GitHub repository for this production group */}
      <div className="mb-4 rounded-lg border border-white/5 bg-surface-900 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-semibold text-white">GitHub</span>
          <span className="text-[10px] rounded px-1.5 py-0.5 bg-white/5 text-gray-400 border border-white/10 font-medium uppercase tracking-wider">repo</span>
        </div>
        <label className="mb-1 block text-xs text-gray-400 uppercase tracking-wider">Repository</label>
        <div className="relative">
          <input
            value={ghRepo}
            onChange={e => setGhRepo(e.target.value)}
            placeholder="owner/repo (e.g. krishrathi1/my-app)"
            className="w-full bg-surface-850 border border-white/10 rounded-lg px-3 py-2 pr-24 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-nexus-500/50"
          />
          {githubRepos.length > 0 && (
            <button
              type="button"
              onClick={() => { setShowGhPicker(v => !v); setGhPickerQ(''); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-nexus-400 hover:text-nexus-300 px-2 py-1 rounded border border-nexus-500/30 bg-nexus-600/10 transition-colors"
            >
              Browse {githubRepos.length}
            </button>
          )}
          {showGhPicker && (
            <div className="absolute z-50 left-0 right-0 top-full mt-1 rounded-lg border border-white/10 bg-[#141418] shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: '260px' }}>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
                <input
                  autoFocus
                  value={ghPickerQ}
                  onChange={e => setGhPickerQ(e.target.value)}
                  placeholder="Search GitHub repos…"
                  className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 focus:outline-none"
                />
                <button type="button" onClick={() => setShowGhPicker(false)} className="text-gray-500 hover:text-white text-xs">✕</button>
              </div>
              <div className="overflow-y-auto">
                {githubRepos
                  .filter(r => r.fullName.toLowerCase().includes(ghPickerQ.toLowerCase()))
                  .map(r => (
                    <button
                      key={r.fullName}
                      type="button"
                      onClick={() => { setGhRepo(r.fullName); if (!ghBranch) setGhBranch(r.defaultBranch); setShowGhPicker(false); }}
                      className="w-full text-left px-3 py-2 hover:bg-white/5 flex items-center gap-3 transition-colors"
                    >
                      <span className="text-gray-500 text-xs w-3 flex-shrink-0">{r.private ? '🔒' : '◉'}</span>
                      <div className="min-w-0">
                        <div className="text-sm text-white truncate">{r.name}</div>
                        <div className="text-xs text-gray-500 truncate">{r.fullName}</div>
                      </div>
                      <span className="ml-auto text-[10px] text-gray-600 flex-shrink-0">{r.defaultBranch}</span>
                    </button>
                  ))
                }
                {githubRepos.filter(r => r.fullName.toLowerCase().includes(ghPickerQ.toLowerCase())).length === 0 && (
                  <p className="px-3 py-4 text-xs text-gray-500 text-center">No repos match</p>
                )}
              </div>
            </div>
          )}
        </div>
        <label className="mt-3 mb-1 block text-xs text-gray-400 uppercase tracking-wider">Branch</label>
        <input
          value={ghBranch}
          onChange={e => setGhBranch(e.target.value)}
          placeholder="main"
          className="w-full bg-surface-850 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-nexus-500/50"
        />
        <p className="mt-2 text-xs text-gray-500">
          {githubRepos.length > 0
            ? `Choose from your ${githubRepos.length} GitHub repos or type manually. Branch auto-fills from the repo's default.`
            : 'The GitHub repo this production group pushes auto-fixes to. Access token is set in Settings → Integrations.'}
        </p>
      </div>

      {/* Bitbucket repository for this production group */}
      <div className="mb-4 rounded-lg border border-white/5 bg-surface-900 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-semibold text-white">Bitbucket</span>
          <span className="text-[10px] rounded px-1.5 py-0.5 bg-[#0052CC]/20 text-[#579DFF] border border-[#0052CC]/30 font-medium uppercase tracking-wider">repo</span>
        </div>
        <label className="mb-1 block text-xs text-gray-400 uppercase tracking-wider">Repository</label>
        <div className="relative">
          <input
            value={bbRepo}
            onChange={e => setBbRepo(e.target.value)}
            placeholder="workspace/repo-slug"
            className="w-full bg-surface-850 border border-white/10 rounded-lg px-3 py-2 pr-24 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-nexus-500/50"
          />
          {bbRepoList.length > 0 && (
            <button
              type="button"
              onClick={() => { setShowBbPicker(v => !v); setBbPickerQ(''); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[#579DFF] hover:text-[#85baff] px-2 py-1 rounded border border-[#0052CC]/40 bg-[#0052CC]/10 transition-colors"
            >
              Browse {bbRepoList.length}
            </button>
          )}
          {showBbPicker && (
            <div className="absolute z-50 left-0 right-0 top-full mt-1 rounded-lg border border-white/10 bg-[#141418] shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: '260px' }}>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
                <input
                  autoFocus
                  value={bbPickerQ}
                  onChange={e => setBbPickerQ(e.target.value)}
                  placeholder="Search Bitbucket repos…"
                  className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 focus:outline-none"
                />
                <button type="button" onClick={() => setShowBbPicker(false)} className="text-gray-500 hover:text-white text-xs">✕</button>
              </div>
              <div className="overflow-y-auto">
                {bbRepoList
                  .filter(r => r.fullName.toLowerCase().includes(bbPickerQ.toLowerCase()))
                  .map(r => (
                    <button
                      key={r.fullName}
                      type="button"
                      onClick={() => { setBbRepo(r.fullName); if (!bbBranch) setBbBranch(r.defaultBranch); setShowBbPicker(false); }}
                      className="w-full text-left px-3 py-2 hover:bg-white/5 flex items-center gap-3 transition-colors"
                    >
                      <span className="text-gray-500 text-xs w-3 flex-shrink-0">{r.isPrivate ? '🔒' : '◉'}</span>
                      <div className="min-w-0">
                        <div className="text-sm text-white truncate">{r.name}</div>
                        <div className="text-xs text-gray-500 truncate">{r.fullName}</div>
                      </div>
                      <span className="ml-auto text-[10px] text-gray-600 flex-shrink-0">{r.defaultBranch}</span>
                    </button>
                  ))
                }
                {bbRepoList.filter(r => r.fullName.toLowerCase().includes(bbPickerQ.toLowerCase())).length === 0 && (
                  <p className="px-3 py-4 text-xs text-gray-500 text-center">No repos match</p>
                )}
              </div>
            </div>
          )}
        </div>
        <label className="mt-3 mb-1 block text-xs text-gray-400 uppercase tracking-wider">Branch</label>
        <input
          value={bbBranch}
          onChange={e => setBbBranch(e.target.value)}
          placeholder="main"
          className="w-full bg-surface-850 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-nexus-500/50"
        />
        <p className="mt-2 text-xs text-gray-500">
          {bbRepoList.length > 0
            ? `Choose from your ${bbRepoList.length} Bitbucket repos or type manually. Branch auto-fills from the repo's default.`
            : 'The Bitbucket repo this production group monitors and pushes fixes to. Connection credentials are set in Settings → Integrations.'}
        </p>
      </div>

      {/* Assigned agents */}
      {agents.length > 0 && (
        <div className="mb-4">
          <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">Assigned Agents</label>
          <div className="space-y-2">
            {agents.map(agent => (
              <div
                key={agent.id}
                className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-900 border border-white/10"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{agent.avatar || agent.displayName.charAt(0)}</span>
                  <span className="text-sm text-white">{agent.displayName}</span>
                  {agent.isBoardLead && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-nexus-600/20 text-nexus-400 font-medium uppercase tracking-wider">
                      Lead
                    </span>
                  )}
                </div>
                <button
                  onClick={() => onRemoveAgent(agent.id)}
                  className="text-gray-600 hover:text-red-400 transition-colors text-xs"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 rounded-lg text-sm font-medium bg-nexus-600 text-white hover:bg-nexus-500 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div className="mt-5 border-t border-red-500/20 pt-4">
        <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-300" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-red-100">Delete production group</div>
              <p className="mt-1 text-xs leading-5 text-red-200/75">
                This removes the group, its scoped tasks, live workflow state, and {agents.length} sub-agent{agents.length === 1 ? '' : 's'} from Nexus.
              </p>
              {confirmDelete && (
                <p className="mt-2 text-xs font-medium text-red-200">
                  Click delete again to confirm. This cannot be undone.
                </p>
              )}
              {deleteError && (
                <p className="mt-2 text-xs text-red-200">{deleteError}</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50',
                confirmDelete
                  ? 'border-red-400/40 bg-red-500/20 text-red-100 hover:bg-red-500/30'
                  : 'border-red-500/25 text-red-200 hover:bg-red-500/15'
              )}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? 'Deleting...' : confirmDelete ? 'Confirm delete' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
