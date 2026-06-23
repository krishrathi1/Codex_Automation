import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ChevronRight, LayoutGrid, CheckSquare, Users, CalendarDays, Target } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { api } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import type { Board, BoardGroup } from '@/types';

const boardTypeStyles: Record<string, { badge: string; label: string; accent: string }> = {
  goal: { badge: 'text-blue-300 bg-blue-500/10 border-blue-500/20', label: 'Goal', accent: '#3b8eff' },
  sprint: { badge: 'text-violet-300 bg-violet-500/10 border-violet-500/20', label: 'Sprint', accent: '#8b5cf6' },
  continuous: { badge: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20', label: 'Continuous', accent: '#10b981' },
};

interface BoardWithGroup extends Board {
  boardGroup?: { id: string; name: string } | null;
}

export function Boards() {
  const [boards, setBoards] = useState<BoardWithGroup[]>([]);
  const [groups, setGroups] = useState<BoardGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [boardsData, groupsData] = await Promise.all([
        api.boards.list(),
        api.boardGroups.list(),
      ]);
      setBoards(boardsData as BoardWithGroup[]);
      setGroups(groupsData);
    } catch (err) {
      console.error('Failed to load boards:', err);
    } finally {
      setLoading(false);
    }
  }

  function toggleGroup(groupId: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  async function handleCreateBoard(data: CreateBoardData) {
    try {
      const created = await api.boards.create({ ...data });
      setBoards(prev => [created as BoardWithGroup, ...prev]);
      setShowCreateModal(false);
    } catch (err) {
      console.error('Failed to create board:', err);
    }
  }

  // Group boards by their board group
  const groupedBoards = groups
    .map(group => ({
      group,
      boards: boards.filter(b => b.boardGroupId === group.id),
    }))
    .filter(g => g.boards.length > 0);

  const ungroupedBoards = boards.filter(b => !b.boardGroupId);

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-4">
        <Header title="Boards" subtitle="Organize agents and tasks into focused workstreams" />
        <button
          onClick={() => setShowCreateModal(true)}
          className="mt-1 inline-flex shrink-0 items-center gap-2 rounded-lg bg-nexus-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-nexus-500"
        >
          <Plus className="h-4 w-4" />
          Create Board
        </button>
      </div>
      <div className="mb-6" />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-nexus-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : boards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-surface-850/50 p-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-nexus-500/10 text-nexus-300">
            <LayoutGrid className="h-6 w-6" />
          </div>
          <h3 className="mb-1 text-base font-semibold text-white">No boards yet</h3>
          <p className="mx-auto mb-5 max-w-sm text-sm text-gray-500">
            Create your first board to organize agents and tasks into focused workstreams.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-nexus-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-nexus-500"
          >
            <Plus className="h-4 w-4" />
            Create Board
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Grouped boards */}
          {groupedBoards.map(({ group, boards: groupBoards }) => (
            <div key={group.id}>
              <button
                onClick={() => toggleGroup(group.id)}
                className="group mb-4 flex w-full items-center gap-2 text-left"
              >
                <ChevronRight
                  className={cn(
                    'h-4 w-4 text-gray-500 transition-transform',
                    collapsedGroups.has(group.id) ? 'rotate-0' : 'rotate-90'
                  )}
                />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 transition-colors group-hover:text-white">
                  {group.name}
                </h3>
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] tabular-nums text-gray-400">
                  {groupBoards.length}
                </span>
                <span className="ml-2 h-px flex-1 bg-white/5" />
              </button>
              {!collapsedGroups.has(group.id) && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {groupBoards.map(board => (
                    <BoardCard key={board.id} board={board} />
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Ungrouped boards */}
          {ungroupedBoards.length > 0 && (
            <div>
              {groupedBoards.length > 0 && (
                <div className="mb-4 flex items-center gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Ungrouped</h3>
                  <span className="ml-1 h-px flex-1 bg-white/5" />
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {ungroupedBoards.map(board => (
                  <BoardCard key={board.id} board={board} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create board modal */}
      {showCreateModal && (
        <CreateBoardModal
          groups={groups}
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateBoard}
        />
      )}
    </div>
  );
}

// ─── Board Card ──────────────────────────────────────

function BoardCard({ board }: { board: BoardWithGroup }) {
  const style = boardTypeStyles[board.boardType] || boardTypeStyles.goal;
  const taskCount = board._count?.tasks ?? 0;
  const agentCount = board._count?.agents ?? 0;

  return (
    <Link
      to={`/boards/${board.id}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-white/5 bg-surface-850 p-4 transition-colors hover:border-white/15 hover:bg-surface-800"
    >
      {/* Type accent rail */}
      <span
        className="absolute inset-y-3 left-0 w-[3px] rounded-full opacity-70 transition-opacity group-hover:opacity-100"
        style={{ background: style.accent }}
      />

      <div className="pl-2.5">
        {/* Title + type */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-semibold text-white">{board.name}</h3>
          <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider', style.badge)}>
            {style.label}
          </span>
        </div>

        {/* Description */}
        <p className="mt-1 line-clamp-2 min-h-[2rem] text-xs leading-5 text-gray-500">
          {board.description || 'No description'}
        </p>

        {/* Objective — inline, no box */}
        {board.objective && (
          <div className="mt-2 flex items-start gap-1.5 text-xs text-nexus-300/90">
            <Target className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-1">{board.objective}</span>
          </div>
        )}

        {/* Single compact meta row */}
        <div className="mt-3 flex items-center gap-3 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1" title="Tasks">
            <CheckSquare className="h-3.5 w-3.5 text-gray-600" />
            <span className="tabular-nums text-gray-300">{taskCount}</span>
          </span>
          <span className="inline-flex items-center gap-1" title="Agents">
            <Users className="h-3.5 w-3.5 text-gray-600" />
            <span className="tabular-nums text-gray-300">{agentCount}</span>
          </span>
          {board.targetDate && (
            <span className="inline-flex items-center gap-1" title="Target date">
              <CalendarDays className="h-3.5 w-3.5 text-gray-600" />
              <span className="tabular-nums">{new Date(board.targetDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            </span>
          )}
          <span className="ml-auto text-gray-600">{timeAgo(board.createdAt)}</span>
        </div>
      </div>
    </Link>
  );
}

// ─── Create Board Modal ──────────────────────────────

interface CreateBoardData {
  name: string;
  description?: string;
  boardType?: string;
  objective?: string;
  targetDate?: string;
  maxAgents?: number;
  requireApprovalForDone?: boolean;
  boardGroupId?: string;
}

function CreateBoardModal({
  groups,
  onClose,
  onSubmit,
}: {
  groups: BoardGroup[];
  onClose: () => void;
  onSubmit: (data: CreateBoardData) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [boardType, setBoardType] = useState('goal');
  const [objective, setObjective] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [maxAgents, setMaxAgents] = useState(3);
  const [requireApprovalForDone, setRequireApprovalForDone] = useState(true);
  const [boardGroupId, setBoardGroupId] = useState('');
  const [saving, setSaving] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      boardType,
      objective: objective.trim() || undefined,
      targetDate: targetDate || undefined,
      maxAgents,
      requireApprovalForDone,
      boardGroupId: boardGroupId || undefined,
    });
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-surface-850 border border-white/10 rounded-2xl w-full max-w-lg p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-white mb-4">Create Board</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-surface-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-nexus-500/50"
              placeholder="Board name..."
              autoFocus
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full bg-surface-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-nexus-500/50 h-16 resize-none"
              placeholder="What is this board for..."
            />
          </div>

          {/* Board Type + Board Group */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Board Type</label>
              <select
                value={boardType}
                onChange={e => setBoardType(e.target.value)}
                className="w-full bg-surface-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-nexus-500/50"
              >
                <option value="goal">Goal</option>
                <option value="sprint">Sprint</option>
                <option value="continuous">Continuous</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Board Group</label>
              <select
                value={boardGroupId}
                onChange={e => setBoardGroupId(e.target.value)}
                className="w-full bg-surface-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-nexus-500/50"
              >
                <option value="">None</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Objective */}
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Objective</label>
            <input
              type="text"
              value={objective}
              onChange={e => setObjective(e.target.value)}
              className="w-full bg-surface-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-nexus-500/50"
              placeholder="What should agents on this board accomplish..."
            />
          </div>

          {/* Target Date + Max Agents */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Target Date</label>
              <input
                type="date"
                value={targetDate}
                onChange={e => setTargetDate(e.target.value)}
                className="w-full bg-surface-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-nexus-500/50"
              />
            </div>

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

          {/* Require Approval Toggle */}
          <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-surface-900 border border-white/10">
            <div>
              <span className="text-sm text-white">Require approval for done</span>
              <p className="text-xs text-gray-500 mt-0.5">Tasks need manual approval before moving to Done</p>
            </div>
            <button
              type="button"
              onClick={() => setRequireApprovalForDone(!requireApprovalForDone)}
              className={cn(
                'relative w-10 h-5 rounded-full transition-colors',
                requireApprovalForDone ? 'bg-nexus-600' : 'bg-white/10'
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                  requireApprovalForDone ? 'translate-x-5' : 'translate-x-0.5'
                )}
              />
            </button>
          </div>

          {/* Actions */}
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
              disabled={saving || !name.trim()}
              className="px-4 py-2 bg-nexus-600 hover:bg-nexus-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create Board'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
