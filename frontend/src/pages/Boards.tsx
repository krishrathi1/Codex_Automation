import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { api } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import type { Board, BoardGroup } from '@/types';

const boardTypeStyles: Record<string, { badge: string; label: string }> = {
  goal: { badge: 'text-blue-400 bg-blue-500/10 border-blue-500/20', label: 'Goal' },
  sprint: { badge: 'text-violet-400 bg-violet-500/10 border-violet-500/20', label: 'Sprint' },
  continuous: { badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', label: 'Continuous' },
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
      const created = await api.boards.create(data);
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
    <div>
      <Header title="Boards" subtitle="Organize agents and tasks into focused workstreams" />

      {/* Action bar */}
      <div className="flex justify-end mb-6">
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-nexus-600 hover:bg-nexus-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <span className="text-lg leading-none">+</span>
          Create Board
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-nexus-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : boards.length === 0 ? (
        <div className="rounded-xl border border-white/5 bg-surface-850 p-12 text-center">
          <div className="text-4xl mb-3 text-gray-600">&#9776;</div>
          <h3 className="text-lg font-semibold text-white mb-1">No Boards Yet</h3>
          <p className="text-sm text-gray-500 mb-4">
            Create your first board to start organizing agents and tasks into focused workstreams.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-nexus-600 text-white hover:bg-nexus-500 transition-colors"
          >
            + Create Board
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Grouped boards */}
          {groupedBoards.map(({ group, boards: groupBoards }) => (
            <div key={group.id}>
              <button
                onClick={() => toggleGroup(group.id)}
                className="flex items-center gap-3 mb-4 group w-full text-left"
              >
                <span
                  className={cn(
                    'text-gray-500 transition-transform text-xs',
                    collapsedGroups.has(group.id) ? 'rotate-0' : 'rotate-90'
                  )}
                >
                  &#9654;
                </span>
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider group-hover:text-white transition-colors">
                  {group.name}
                </h3>
                <span className="text-xs text-gray-600 bg-white/5 px-2 py-0.5 rounded-full">
                  {groupBoards.length}
                </span>
              </button>
              {!collapsedGroups.has(group.id) && (
                <div className="grid grid-cols-3 gap-4">
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
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                  Ungrouped
                </h3>
              )}
              <div className="grid grid-cols-3 gap-4">
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
      className="block rounded-xl border border-white/5 bg-surface-850 p-5 transition-all duration-300 hover:scale-[1.02] hover:border-nexus-500/30"
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-semibold text-white text-sm leading-tight pr-2">{board.name}</h3>
        <span
          className={cn(
            'text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider border shrink-0',
            style.badge
          )}
        >
          {style.label}
        </span>
      </div>

      {/* Description */}
      {board.description && (
        <p className="text-xs text-gray-500 mb-3 line-clamp-2">{board.description}</p>
      )}

      {/* Objective */}
      {board.objective && (
        <div className="mb-3 px-2.5 py-1.5 rounded-md bg-nexus-600/10 border border-nexus-500/20">
          <span className="text-xs text-nexus-400 line-clamp-1">{board.objective}</span>
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-600">Tasks:</span>
          <span className="text-xs text-white font-medium">{taskCount}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-600">Agents:</span>
          <span className="text-xs text-white font-medium">{agentCount}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-white/5">
        {board.targetDate ? (
          <span className="text-xs text-gray-500">
            Target: {new Date(board.targetDate).toLocaleDateString()}
          </span>
        ) : (
          <span className="text-xs text-gray-600">No target date</span>
        )}
        <span className="text-xs text-gray-600">{timeAgo(board.createdAt)}</span>
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
