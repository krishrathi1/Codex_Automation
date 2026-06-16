import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, Bot, Clock3, GitBranch, MessageSquareText, RefreshCw, TerminalSquare } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import type { LiveBlackboardTrace, LiveBlackboardTraceJob } from '../types';

function formatTime(value?: string | null) {
  if (!value) return 'None';
  return new Date(value).toLocaleString();
}

function statusClass(status: string) {
  if (status === 'COMPLETED') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200';
  if (status === 'RUNNING') return 'border-sky-500/20 bg-sky-500/10 text-sky-200';
  if (status === 'FAILED') return 'border-red-500/20 bg-red-500/10 text-red-200';
  if (status === 'QUEUED') return 'border-amber-500/20 bg-amber-500/10 text-amber-200';
  return 'border-white/10 bg-white/5 text-gray-300';
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-semibold ${statusClass(status)}`}>
      {status}
    </span>
  );
}

function TraceJobPanel({ job }: { job: LiveBlackboardTraceJob }) {
  const [openPrompt, setOpenPrompt] = useState(false);
  const [openOutput, setOpenOutput] = useState(true);

  return (
    <div className="rounded-lg border border-white/5 bg-surface-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-nexus-300" />
            <p className="truncate text-sm font-semibold text-white">{job.agentName}</p>
            <StatusPill status={job.status} />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Round {job.round ?? 'unknown'} · queued {formatTime(job.queuedAt)} · duration {job.durationMs ?? 0}ms
          </p>
        </div>
        <p className="max-w-[260px] truncate text-[11px] text-gray-500">
          {job.codexSessionId ? `Codex ${job.codexSessionId}` : job.id}
        </p>
      </div>

      <div className="space-y-3 p-4">
        <button
          type="button"
          onClick={() => setOpenPrompt(value => !value)}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/5"
        >
          <TerminalSquare className="h-3.5 w-3.5" />
          {openPrompt ? 'Hide agent prompt' : 'Show agent prompt'}
        </button>
        {openPrompt && (
          <pre className="max-h-[360px] overflow-auto rounded-lg border border-white/5 bg-surface-950 p-3 text-xs leading-5 text-gray-300">
            {job.reconstructedPrompt || job.prompt}
          </pre>
        )}

        <button
          type="button"
          onClick={() => setOpenOutput(value => !value)}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/5"
        >
          <MessageSquareText className="h-3.5 w-3.5" />
          {openOutput ? 'Hide response' : 'Show response'}
        </button>
        {openOutput && (
          <div className="rounded-lg border border-white/5 bg-surface-950 p-3">
            <p className="whitespace-pre-wrap text-sm leading-6 text-gray-200">
              {job.output || job.error || job.summary || 'No response yet.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function LiveBlackboardTracePage() {
  const { boardId } = useParams<{ boardId: string }>();
  const [trace, setTrace] = useState<LiveBlackboardTrace | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadTrace(conversationId = selectedConversationId ?? undefined) {
    if (!boardId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.boards.liveBlackboardTrace(boardId, conversationId);
      setTrace(data);
      if (!conversationId && data.conversations[0]) {
        setSelectedConversationId(data.conversations[0].id);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTrace().catch(() => {});
  }, [boardId]);

  useEffect(() => {
    const socket = getSocket();
    const refresh = (event: { boardId?: string | null; board?: { id?: string } }) => {
      const eventBoardId = event.board?.id ?? event.boardId ?? null;
      if (!boardId || eventBoardId !== boardId) return;
      loadTrace(selectedConversationId ?? undefined).catch(() => {});
    };

    socket.on('blackboard:event', refresh);
    socket.on('board:liveBlackboardStarted', refresh);
    socket.on('board:liveBlackboardAdvanced', refresh);
    socket.on('board:liveBlackboardCompleted', refresh);
    socket.on('agent-run-job:update', refresh);
    return () => {
      socket.off('blackboard:event', refresh);
      socket.off('board:liveBlackboardStarted', refresh);
      socket.off('board:liveBlackboardAdvanced', refresh);
      socket.off('board:liveBlackboardCompleted', refresh);
      socket.off('agent-run-job:update', refresh);
    };
  }, [boardId, selectedConversationId]);

  const selectedConversation = useMemo(() => {
    if (!trace) return null;
    return trace.conversations.find(conversation => conversation.id === selectedConversationId) ?? trace.conversations[0] ?? null;
  }, [trace, selectedConversationId]);

  const jobsByRound = useMemo(() => {
    const rows = new Map<number, LiveBlackboardTraceJob[]>();
    for (const job of selectedConversation?.jobs ?? []) {
      const round = job.round ?? 0;
      rows.set(round, [...(rows.get(round) ?? []), job]);
    }
    return [...rows.entries()].sort(([a], [b]) => a - b);
  }, [selectedConversation]);

  return (
    <div className="min-h-screen bg-surface-950 px-6 py-6 text-gray-200">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              to={boardId ? `/production/${boardId}` : '/dashboard'}
              className="mb-3 inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Mother Chat
            </Link>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-violet-500/10 text-violet-200">
                <GitBranch className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-white">{trace?.board.name || 'Live Blackboard Trace'}</h1>
                <p className="text-sm text-gray-500">{trace?.board.objective || 'Agent-to-agent short-turn trace'}</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => loadTrace(selectedConversationId ?? undefined)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-surface-850 px-3 py-2 text-sm text-gray-300 hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {loading && !trace ? (
          <div className="rounded-lg border border-white/5 bg-surface-900 px-4 py-10 text-center text-sm text-gray-500">
            Loading trace...
          </div>
        ) : trace && selectedConversation ? (
          <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="space-y-4">
              <section className="rounded-lg border border-white/5 bg-surface-900 p-4">
                <h2 className="text-sm font-semibold text-white">Conversations</h2>
                <div className="mt-3 space-y-2">
                  {trace.conversations.map(conversation => (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => {
                        setSelectedConversationId(conversation.id);
                        loadTrace(conversation.id).catch(() => {});
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                        selectedConversation.id === conversation.id
                          ? 'border-violet-500/40 bg-violet-500/10'
                          : 'border-white/5 bg-surface-950 hover:border-white/10'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-white">{conversation.title}</p>
                        <StatusPill status={conversation.status} />
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        Round {conversation.currentRound}/{conversation.maxRounds} · {conversation.events.length} events
                      </p>
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-white/5 bg-surface-900 p-4">
                <h2 className="text-sm font-semibold text-white">Agents</h2>
                <div className="mt-3 space-y-2">
                  {trace.agents.map(agent => (
                    <div key={agent.id} className="rounded-lg border border-white/5 bg-surface-950 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-white">{agent.displayName}</p>
                        <StatusPill status={agent.status} />
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-gray-500">{agent.description || 'No role'}</p>
                    </div>
                  ))}
                </div>
              </section>
            </aside>

            <main className="space-y-6">
              <section className="rounded-lg border border-white/5 bg-surface-900 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold text-white">{selectedConversation.title}</h2>
                      <StatusPill status={selectedConversation.status} />
                    </div>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">{selectedConversation.goal || 'No goal recorded.'}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg border border-white/5 bg-surface-950 px-3 py-2">
                      <p className="text-lg font-semibold text-white">{selectedConversation.events.length}</p>
                      <p className="text-[10px] uppercase tracking-wide text-gray-500">Events</p>
                    </div>
                    <div className="rounded-lg border border-white/5 bg-surface-950 px-3 py-2">
                      <p className="text-lg font-semibold text-white">{selectedConversation.jobs.length}</p>
                      <p className="text-[10px] uppercase tracking-wide text-gray-500">Jobs</p>
                    </div>
                    <div className="rounded-lg border border-white/5 bg-surface-950 px-3 py-2">
                      <p className="text-lg font-semibold text-white">{selectedConversation.currentRound}/{selectedConversation.maxRounds}</p>
                      <p className="text-[10px] uppercase tracking-wide text-gray-500">Rounds</p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-white/5 bg-surface-900 p-5">
                <div className="mb-4 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-violet-300" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Step Timeline</h2>
                </div>
                <div className="space-y-3">
                  {selectedConversation.events.map((event, index) => (
                    <div key={event.id} className="grid gap-3 rounded-lg border border-white/5 bg-surface-950 p-3 md:grid-cols-[72px_minmax(0,1fr)]">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="flex h-7 w-7 items-center justify-center rounded bg-violet-500/10 text-violet-200">{index + 1}</span>
                        <span>{event.round ? `R${event.round}` : event.type}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-white">{event.from} <span className="text-gray-500">to</span> {event.to}</p>
                          {event.linkedJob && <StatusPill status={event.linkedJob.status} />}
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-300">{event.content}</p>
                        <p className="mt-2 flex items-center gap-1 text-[11px] text-gray-600">
                          <Clock3 className="h-3 w-3" />
                          {formatTime(event.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {jobsByRound.map(([round, jobs]) => (
                <section key={round} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-violet-300" />
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Round {round}</h2>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    {jobs.map(job => <TraceJobPanel key={job.id} job={job} />)}
                  </div>
                </section>
              ))}
            </main>
          </div>
        ) : (
          <div className="rounded-lg border border-white/5 bg-surface-900 px-4 py-10 text-center text-sm text-gray-500">
            No live blackboard trace is available for this group yet.
          </div>
        )}
      </div>
    </div>
  );
}
