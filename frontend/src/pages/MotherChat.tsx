import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Database,
  FolderKanban,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Users,
  Zap,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import type { ChatMessage, MotherChatContext } from '../types';

type MotherChatSocketEvent = {
  type: 'response' | 'activity' | 'tool_call' | 'tool_result' | 'terminal_output' | 'file_read' | 'file_write' | 'status_update' | 'response_end' | 'error';
  content?: string;
  requestId?: string | null;
  sessionId?: string;
  nexusSessionId?: string;
  codexSessionId?: string | null;
  boardId?: string | null;
  timestamp?: string;
};

const statusClasses: Record<string, string> = {
  ONLINE: 'bg-emerald-500',
  IDLE: 'bg-amber-500',
  OFFLINE: 'bg-gray-500',
  ERROR: 'bg-red-500',
};

function newRequestId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `mother-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatTime(value?: string | null) {
  if (!value) return 'None';
  return new Date(value).toLocaleString();
}

function StatTile({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Activity }) {
  return (
    <div className="rounded-lg border border-white/5 bg-surface-850 px-3 py-3">
      <div className="flex items-center gap-2 text-gray-500">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

export function MotherChat() {
  const { boardId } = useParams<{ boardId?: string }>();
  const scopedBoardId = boardId || undefined;
  const [context, setContext] = useState<MotherChatContext | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('what are my agents doing?');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamedResponseRequestsRef = useRef<Record<string, boolean>>({});

  async function loadContext() {
    const data = await api.motherChat.context(scopedBoardId);
    setContext(data);
  }

  async function loadInitialData() {
    setLoading(true);
    setError(null);
    try {
      const [contextData, history] = await Promise.all([
        api.motherChat.context(scopedBoardId),
        api.motherChat.history(scopedBoardId),
      ]);
      setContext(contextData);
      setMessages(history.messages || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInitialData();

    const socket = getSocket();
    const handleMotherChatEvent = (event: MotherChatSocketEvent) => {
      if ((event.boardId ?? null) !== (scopedBoardId ?? null)) return;

      const requestKey = event.requestId || event.nexusSessionId || event.sessionId || `mother-${Date.now()}`;
      const timestamp = event.timestamp || new Date().toISOString();

      if (event.type === 'response' && event.content) {
        streamedResponseRequestsRef.current[requestKey] = true;
        setMessages(prev => {
          const existingIndex = prev.findIndex(message => message.role === 'assistant' && message.requestId === requestKey);
          if (existingIndex >= 0) {
            const next = [...prev];
            const existing = next[existingIndex];
            next[existingIndex] = {
              ...existing,
              content: existing.content ? `${existing.content}\n${event.content}` : event.content || '',
              timestamp,
            };
            return next;
          }

          return [
            ...prev,
            {
              id: `assistant-${requestKey}`,
              role: 'assistant',
              content: event.content || '',
              timestamp,
              requestId: requestKey,
            },
          ];
        });
        setSending(false);
        return;
      }

      if (event.type === 'error') {
        streamedResponseRequestsRef.current[requestKey] = true;
        setMessages(prev => [
          ...prev,
          {
            id: `error-${requestKey}`,
            role: 'assistant',
            content: `Error: ${event.content || 'Mother Chat request failed'}`,
            timestamp,
            requestId: requestKey,
          },
        ]);
        setSending(false);
        return;
      }

      if (event.type === 'response_end') {
        setSending(false);
        loadContext().catch(() => {});
      }
    };

    socket.on('mother-chat:event', handleMotherChatEvent);
    return () => {
      socket.off('mother-chat:event', handleMotherChatEvent);
    };
  }, [scopedBoardId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || sending) return;

    const requestId = newRequestId();
    streamedResponseRequestsRef.current[requestId] = false;
    const content = input.trim();
    setMessages(prev => [
      ...prev,
      {
        id: `user-${requestId}`,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
        requestId,
      },
    ]);
    setInput('');
    setSending(true);
    setError(null);

    try {
      const response = await api.motherChat.send(content, requestId, scopedBoardId);
      if (!streamedResponseRequestsRef.current[requestId]) {
        setMessages(prev => [
          ...prev,
          {
            id: `assistant-${requestId}`,
            role: 'assistant',
            content: response.result || response.summary || 'No response',
            timestamp: new Date().toISOString(),
            requestId,
          },
        ]);
      }
      await loadContext();
    } catch (err) {
      if (!streamedResponseRequestsRef.current[requestId]) {
        setMessages(prev => [
          ...prev,
          {
            id: `error-${requestId}`,
            role: 'assistant',
            content: `Error: ${(err as Error).message}`,
            timestamp: new Date().toISOString(),
            requestId,
          },
        ]);
      }
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  const scopedBoard = context?.scope?.board;
  const pageTitle = scopedBoard ? `${scopedBoard.name} Mother Chat` : 'Mother Chat';
  const pageSubtitle = scopedBoard
    ? scopedBoard.objective || scopedBoard.description || 'Production group context'
    : 'Local Codex CLI with Nexus DB context';

  return (
    <div className="flex h-screen -mx-8 bg-surface-950">
      {scopedBoardId && (
        <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-r border-white/5 bg-surface-900 lg:block">
          <div className="border-b border-white/5 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-nexus-600/20 text-nexus-300">
                <FolderKanban className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{scopedBoard?.name || 'Production Group'}</p>
                <p className="text-xs text-gray-500">{context?.counts.agents ?? 0} sub-agents</p>
              </div>
            </div>
          </div>

          <div className="space-y-5 p-5">
            <div className="grid grid-cols-2 gap-2">
              <Link
                to={`/agents/new?boardId=${encodeURIComponent(scopedBoardId)}&returnTo=${encodeURIComponent(`/production/${scopedBoardId}`)}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-nexus-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-nexus-500"
              >
                <Plus className="h-3.5 w-3.5" />
                Sub-agent
              </Link>
              <Link
                to={`/boards/${scopedBoardId}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-white/5"
              >
                <Settings className="h-3.5 w-3.5" />
                Manage
              </Link>
            </div>

            <section>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <Users className="h-3.5 w-3.5" />
                Sub-agents
              </div>
              <div className="space-y-2">
                {(context?.agents ?? []).map(agent => (
                  <Link
                    key={agent.id}
                    to={`/agents/${agent.id}`}
                    className="block rounded-lg border border-white/5 bg-surface-850 px-3 py-2 transition-colors hover:border-nexus-500/30"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{agent.displayName}</p>
                        <p className="truncate text-xs text-gray-500">{agent.currentTask || 'No current task'}</p>
                      </div>
                      <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusClasses[agent.status] || statusClasses.OFFLINE}`} title={agent.status} />
                    </div>
                  </Link>
                ))}
                {context && context.agents.length === 0 && (
                  <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-gray-500">
                    No sub-agents yet.
                  </div>
                )}
              </div>
            </section>

            <section>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Workload</div>
              <div className="grid grid-cols-2 gap-2">
                <StatTile label="Tasks" value={context?.counts.activeTasks ?? 0} icon={CheckCircle2} />
                <StatTile label="Errors" value={context?.counts.recentErrors ?? 0} icon={AlertTriangle} />
              </div>
            </section>
          </div>
        </aside>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-white/5 px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-nexus-600/20 text-nexus-300">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-white">{pageTitle}</h1>
                <p className="text-xs text-gray-500">{pageSubtitle}</p>
              </div>
            </div>
            <button
              onClick={loadInitialData}
              disabled={loading || sending}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-surface-850 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="border-b border-red-500/20 bg-red-500/10 px-6 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">Loading...</div>
          ) : messages.length === 0 && !sending ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-850 text-nexus-300">
                  <Database className="h-6 w-6" />
                </div>
                <h2 className="text-base font-semibold text-white">Ask about agent operations</h2>
                <p className="mt-1 text-sm text-gray-500">Mother Chat reads recent Nexus records before each Codex run.</p>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl space-y-4">
              {messages.map((message, index) => (
                <div key={message.id || index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[78%] rounded-xl px-4 py-3 ${
                    message.role === 'user'
                      ? 'bg-nexus-600 text-white'
                      : 'border border-white/5 bg-surface-850 text-gray-200'
                  }`}>
                    <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
                    {message.timestamp && (
                      <p className={`mt-2 text-[10px] ${message.role === 'user' ? 'text-nexus-200' : 'text-gray-600'}`}>
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-xl border border-white/5 bg-surface-850 px-4 py-3">
                    <div className="flex gap-1">
                      <div className="h-2 w-2 animate-bounce rounded-full bg-gray-500" style={{ animationDelay: '0ms' }} />
                      <div className="h-2 w-2 animate-bounce rounded-full bg-gray-500" style={{ animationDelay: '150ms' }} />
                      <div className="h-2 w-2 animate-bounce rounded-full bg-gray-500" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="border-t border-white/5 px-6 py-4">
          <div className="mx-auto flex max-w-4xl gap-3">
            <textarea
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              rows={2}
              placeholder={scopedBoard ? `Ask about ${scopedBoard.name}...` : 'Ask Mother Chat...'}
              className="min-h-[48px] flex-1 resize-none rounded-xl border border-white/10 bg-surface-850 px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-nexus-500 focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-nexus-600 text-white transition-colors hover:bg-nexus-500 disabled:cursor-not-allowed disabled:opacity-50"
              title="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </main>

      <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-white/5 bg-surface-900 xl:block">
        <div className="border-b border-white/5 px-5 py-4">
          <h2 className="text-sm font-semibold text-white">{scopedBoard ? 'Production Snapshot' : 'Context Snapshot'}</h2>
          <p className="mt-1 text-xs text-gray-500">{context ? formatTime(context.generatedAt) : 'Not loaded'}</p>
        </div>

        <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Agents" value={context?.counts.agents ?? 0} icon={Bot} />
            <StatTile label="Sessions" value={context?.counts.runningSessions ?? 0} icon={Clock3} />
            <StatTile label="Tasks" value={context?.counts.activeTasks ?? 0} icon={CheckCircle2} />
            <StatTile label="Errors" value={context?.counts.recentErrors ?? 0} icon={AlertTriangle} />
            <StatTile label="Approvals" value={context?.counts.pendingApprovals ?? 0} icon={Activity} />
            <StatTile label="Tokens" value={context?.counts.tokensInWindow ?? 0} icon={Zap} />
          </div>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Agents</h3>
            <div className="space-y-2">
              {(context?.agents ?? []).slice(0, 8).map(agent => (
                <div key={agent.id} className="rounded-lg border border-white/5 bg-surface-850 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{agent.displayName}</p>
                      <p className="truncate text-xs text-gray-500">{agent.currentTask || 'No current task'}</p>
                    </div>
                    <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusClasses[agent.status] || statusClasses.OFFLINE}`} title={agent.status} />
                  </div>
                </div>
              ))}
              {context && context.agents.length === 0 && <p className="text-sm text-gray-500">No agents</p>}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Recent Work</h3>
            <div className="space-y-2">
              {(context?.sessions ?? []).slice(0, 6).map(session => (
                <div key={session.id} className="rounded-lg border border-white/5 bg-surface-850 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm text-white">{session.agent}</p>
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400">{session.status}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-gray-500">{session.summary || session.type}</p>
                </div>
              ))}
              {context && context.sessions.length === 0 && <p className="text-sm text-gray-500">No recent sessions</p>}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Errors</h3>
            <div className="space-y-2">
              {(context?.errors ?? []).slice(0, 5).map((item, index) => (
                <div key={`${item.source}-${index}`} className="rounded-lg border border-red-500/10 bg-red-500/5 px-3 py-2">
                  <p className="truncate text-sm text-red-200">{item.agent}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-red-300/70">{item.message}</p>
                </div>
              ))}
              {context && context.errors.length === 0 && <p className="text-sm text-gray-500">No recent errors</p>}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
