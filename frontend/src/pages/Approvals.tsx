import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { api } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import type { Approval, Board, ApprovalStatus } from '@/types';

// ─── Status Styling ──────────────────────────────────

const statusConfig: Record<ApprovalStatus, { color: string; bg: string; border: string; label: string }> = {
  PENDING: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', label: 'Pending' },
  APPROVED: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', label: 'Approved' },
  REJECTED: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'Rejected' },
};

interface ApprovalStats {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

// ─── Main Component ──────────────────────────────────

export function Approvals() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [stats, setStats] = useState<ApprovalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | 'ALL'>('ALL');
  const [boardFilter, setBoardFilter] = useState<string>('ALL');

  const fetchData = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (statusFilter !== 'ALL') params.status = statusFilter;
      if (boardFilter !== 'ALL') params.boardId = boardFilter;

      const [approvalsData, statsData, boardsData] = await Promise.all([
        api.approvals.list(params),
        api.approvals.stats(),
        api.boards.list(),
      ]);
      setApprovals(approvalsData);
      setStats(statsData);
      setBoards(boardsData);
    } catch (err) {
      console.error('Failed to fetch approvals:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, boardFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleApprove = async (id: string) => {
    try {
      const updated = await api.approvals.approve(id);
      setApprovals((prev) => prev.map((a) => (a.id === id ? updated : a)));
      // Refresh stats after action
      const newStats = await api.approvals.stats();
      setStats(newStats);
    } catch (err) {
      console.error('Failed to approve:', err);
    }
  };

  const handleReject = async (id: string) => {
    try {
      const updated = await api.approvals.reject(id);
      setApprovals((prev) => prev.map((a) => (a.id === id ? updated : a)));
      const newStats = await api.approvals.stats();
      setStats(newStats);
    } catch (err) {
      console.error('Failed to reject:', err);
    }
  };

  if (loading) {
    return (
      <div>
        <Header title="Approvals" subtitle="Review and approve agent actions" />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-nexus-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header title="Approvals" subtitle="Review and approve agent actions" />

      {/* Stats Bar */}
      {stats && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <StatCard label="Total" count={stats.total} color="text-gray-300" bg="bg-white/5" border="border-white/10" />
          <StatCard
            label="Pending"
            count={stats.pending}
            color="text-amber-400"
            bg="bg-amber-500/10"
            border="border-amber-500/20"
            pulse={stats.pending > 0}
          />
          <StatCard label="Approved" count={stats.approved} color="text-emerald-400" bg="bg-emerald-500/10" border="border-emerald-500/20" />
          <StatCard label="Rejected" count={stats.rejected} color="text-red-400" bg="bg-red-500/10" border="border-red-500/20" />
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex items-center gap-3 mb-6">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mr-2">Filters</h3>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ApprovalStatus | 'ALL')}
          className="text-xs bg-surface-900 border border-white/10 text-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-nexus-500/50"
        >
          <option value="ALL">All Statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>

        {/* Board filter */}
        <select
          value={boardFilter}
          onChange={(e) => setBoardFilter(e.target.value)}
          className="text-xs bg-surface-900 border border-white/10 text-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-nexus-500/50"
        >
          <option value="ALL">All Boards</option>
          {boards.map((board) => (
            <option key={board.id} value={board.id}>
              {board.name}
            </option>
          ))}
        </select>

        {/* Pending count badge */}
        {stats && stats.pending > 0 && (
          <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse-dot" />
            <span className="text-amber-400 text-xs font-medium">
              {stats.pending} pending review{stats.pending !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Approval List */}
      {approvals.length === 0 ? (
        <div className="rounded-xl border border-white/5 bg-surface-850 p-12 text-center">
          <div className="text-4xl mb-3 text-gray-600">&#10003;</div>
          <h3 className="text-lg font-semibold text-white mb-1">No Approvals</h3>
          <p className="text-sm text-gray-500">
            {statusFilter !== 'ALL'
              ? `No ${statusFilter.toLowerCase()} approvals found.`
              : 'There are no approvals to review right now. Approvals will appear here when agents request human review.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────

function StatCard({
  label,
  count,
  color,
  bg,
  border,
  pulse,
}: {
  label: string;
  count: number;
  color: string;
  bg: string;
  border: string;
  pulse?: boolean;
}) {
  return (
    <div className={cn('rounded-xl border p-4', bg, border)}>
      <div className="flex items-center gap-2 mb-1">
        {pulse && <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse-dot" />}
        <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">{label}</span>
      </div>
      <span className={cn('text-2xl font-bold', color)}>{count}</span>
    </div>
  );
}

// ─── Approval Card ───────────────────────────────────

function ApprovalCard({
  approval,
  onApprove,
  onReject,
}: {
  approval: Approval;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [payloadExpanded, setPayloadExpanded] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | null>(null);

  const style = statusConfig[approval.status];
  const isPending = approval.status === 'PENDING';

  const handleActionClick = (action: 'approve' | 'reject') => {
    if (confirmAction === action) {
      // Second click: execute
      if (action === 'approve') onApprove(approval.id);
      else onReject(approval.id);
      setConfirmAction(null);
    } else {
      // First click: confirm
      setConfirmAction(action);
    }
  };

  // Reset confirm state when clicking outside
  const handleCardClick = () => {
    if (confirmAction) setConfirmAction(null);
  };

  return (
    <div
      className={cn(
        'rounded-xl border p-5 transition-colors',
        isPending ? 'border-white/10 bg-surface-850' : 'border-white/5 bg-surface-900'
      )}
      onClick={handleCardClick}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left content */}
        <div className="flex-1 min-w-0">
          {/* Top row: status badge + action type + timestamp */}
          <div className="flex items-center gap-2.5 mb-3">
            {/* Status badge */}
            <span
              className={cn(
                'px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border',
                style.bg,
                style.border,
                style.color
              )}
            >
              {style.label}
            </span>

            {/* Action type */}
            <span className="text-xs font-mono text-gray-300 bg-white/5 px-2 py-0.5 rounded border border-white/5">
              {approval.actionType}
            </span>

            {/* Timestamp */}
            <span className="text-xs text-gray-600 ml-auto shrink-0">{timeAgo(approval.createdAt)}</span>
          </div>

          {/* Board link */}
          {approval.board && (
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Board:</span>
              <Link
                to={`/boards/${approval.boardId}`}
                className="text-xs text-nexus-400 hover:text-nexus-300 font-medium transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                {approval.board.name}
              </Link>
            </div>
          )}

          {/* Task title */}
          {approval.task && (
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Task:</span>
              <span className="text-sm text-white font-medium truncate">{approval.task.title}</span>
            </div>
          )}

          {/* Agent info */}
          {approval.agent && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Agent:</span>
              {approval.agent.avatar ? (
                <img
                  src={approval.agent.avatar}
                  alt={approval.agent.displayName}
                  className="w-5 h-5 rounded-full border border-white/10"
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-nexus-600/30 border border-nexus-500/20 flex items-center justify-center">
                  <span className="text-[10px] text-nexus-400 font-semibold">
                    {approval.agent.displayName.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <span className="text-xs text-gray-300 font-medium">{approval.agent.displayName}</span>
            </div>
          )}

          {/* Confidence score */}
          {approval.confidence !== null && approval.confidence !== undefined && (
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-gray-500 uppercase tracking-wider">Confidence:</span>
                <span className="text-xs text-white font-medium">{Math.round(approval.confidence * 100)}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', {
                    'bg-emerald-500': approval.confidence >= 0.8,
                    'bg-amber-500': approval.confidence >= 0.5 && approval.confidence < 0.8,
                    'bg-red-500': approval.confidence < 0.5,
                  })}
                  style={{ width: `${Math.round(approval.confidence * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Payload preview */}
          {approval.payload && (
            <div className="mt-3">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPayloadExpanded(!payloadExpanded);
                }}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                <span
                  className={cn(
                    'transition-transform text-[10px]',
                    payloadExpanded ? 'rotate-90' : 'rotate-0'
                  )}
                >
                  &#9654;
                </span>
                <span className="uppercase tracking-wider font-medium">Payload</span>
              </button>
              {payloadExpanded && (
                <pre className="mt-2 p-3 rounded-lg bg-surface-900 border border-white/5 text-xs text-gray-400 font-mono overflow-x-auto max-h-48 overflow-y-auto">
                  {JSON.stringify(approval.payload, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* Resolved timestamp */}
          {approval.resolvedAt && (
            <div className="mt-2 text-xs text-gray-600">
              Resolved {timeAgo(approval.resolvedAt)}
            </div>
          )}
        </div>

        {/* Right: Action buttons for pending items */}
        {isPending && (
          <div className="flex flex-col gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => handleActionClick('approve')}
              className={cn(
                'px-4 py-2 rounded-lg text-xs font-medium transition-all border',
                confirmAction === 'approve'
                  ? 'bg-emerald-500 text-white border-emerald-400 shadow-lg shadow-emerald-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
              )}
            >
              {confirmAction === 'approve' ? 'Are you sure?' : 'Approve'}
            </button>
            <button
              onClick={() => handleActionClick('reject')}
              className={cn(
                'px-4 py-2 rounded-lg text-xs font-medium transition-all border',
                confirmAction === 'reject'
                  ? 'bg-red-500 text-white border-red-400 shadow-lg shadow-red-500/20'
                  : 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20'
              )}
            >
              {confirmAction === 'reject' ? 'Are you sure?' : 'Reject'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
