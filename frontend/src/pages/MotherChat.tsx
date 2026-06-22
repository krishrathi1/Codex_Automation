import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  ClipboardCheck,
  Database,
  FolderKanban,
  GitBranch,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Trash2,
  Users,
  Zap,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { cn } from '../lib/utils';
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

type StartA2AAgentDraft = {
  agentId?: string;
  displayName: string;
  role: string;
  work: string;
  avatar: string;
  isLead?: boolean;
};

type A2ARosterAgent = {
  id: string;
  displayName: string;
  status: string;
  currentTask: string | null;
};

type StartA2APayload = {
  goal: string;
  agents: StartA2AAgentDraft[];
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

// Default, pipeline-actionable triggers used when the chat box is empty or only
// holds a status question (which the backend rejects for the fix pipeline).
const DEFAULT_LIVE_WORKFLOW_TRIGGER =
  'Investigate the latest production issue, hand off through diagnosis, code fix, verification, and release audit.';
const DEFAULT_LIVE_BLACKBOARD_TRIGGER =
  'Debate the current production decision, ask each other questions, answer objections, and close with FINAL_DECISION when ready.';

// Mirrors the backend status-query gate so we don't feed a bare status question
// ("what are my agents doing?") into the live workflow / chat fix pipeline.
const STATUS_QUERY_PATTERN =
  /what (are|is|'?s)\b|\bstatus\b|\bdoing\b|\bhappening\b|\bhow (are|is)\b|\bshow me\b|\bsummar|\bupdate me\b/i;

function isStatusQuery(text: string) {
  return STATUS_QUERY_PATTERN.test(text.trim());
}

// Use the typed text only when it describes something actionable; otherwise fall
// back to the actionable default so the button always starts a valid run.
function resolveLiveTrigger(typed: string, fallback: string) {
  const value = typed.trim();
  return value && !isStatusQuery(value) ? value : fallback;
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

function StartA2AModal({
  boardName,
  defaultGoal,
  availableAgents,
  starting,
  onCancel,
  onSubmit,
}: {
  boardName: string;
  defaultGoal: string;
  availableAgents: A2ARosterAgent[];
  starting: boolean;
  onCancel: () => void;
  onSubmit: (payload: StartA2APayload) => void;
}) {
  const [goal, setGoal] = useState(defaultGoal);
  // Participation keyed by agent id; preselect the first two agents in the group.
  const [selected, setSelected] = useState<Record<string, { work: string }>>(() => {
    const initial: Record<string, { work: string }> = {};
    availableAgents.slice(0, 2).forEach(agent => {
      initial[agent.id] = { work: agent.currentTask || '' };
    });
    return initial;
  });
  const [leadId, setLeadId] = useState<string>(() => availableAgents[0]?.id ?? '');

  const selectedIds = Object.keys(selected);
  const canStart = !starting && goal.trim().length > 0 && selectedIds.length >= 2 && Boolean(selected[leadId]);

  // Keep the lead valid — if the lead gets unselected, fall back to the first selected agent.
  useEffect(() => {
    if (!selected[leadId]) {
      const first = Object.keys(selected)[0] ?? '';
      if (first !== leadId) setLeadId(first);
    }
  }, [selected, leadId]);

  function toggleAgent(agent: A2ARosterAgent) {
    setSelected(prev => {
      const next = { ...prev };
      if (next[agent.id]) delete next[agent.id];
      else next[agent.id] = { work: agent.currentTask || '' };
      return next;
    });
  }

  function updateWork(id: string, work: string) {
    setSelected(prev => (prev[id] ? { ...prev, [id]: { work } } : prev));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canStart) return;
    const ordered = [leadId, ...selectedIds.filter(id => id !== leadId)];
    const agents: StartA2AAgentDraft[] = ordered.map((id, index) => {
      const agent = availableAgents.find(a => a.id === id);
      const displayName = agent?.displayName || `Agent ${index + 1}`;
      return {
        agentId: id,
        displayName,
        role: '',
        work: selected[id]?.work.trim() || agent?.currentTask || 'Coordinate on the goal and report blockers.',
        avatar: displayName.charAt(0).toUpperCase() || String(index + 1),
        isLead: id === leadId,
      };
    });
    onSubmit({ goal: goal.trim(), agents });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-2xl rounded-xl border border-white/10 bg-surface-900 shadow-2xl">
        <div className="border-b border-white/5 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300">
              <GitBranch className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Start agent-to-agent work</h2>
              <p className="text-xs text-gray-500">{boardName}</p>
            </div>
          </div>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">Shared Goal</span>
            <textarea
              value={goal}
              onChange={event => setGoal(event.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-white/10 bg-surface-850 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-nexus-500 focus:outline-none"
            />
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Agents in this group — pick who collaborates
              </span>
              <span className="text-[11px] text-gray-500">{selectedIds.length} selected · pick at least 2</span>
            </div>

            {availableAgents.length === 0 ? (
              <p className="rounded-lg border border-white/10 bg-surface-850 px-3 py-4 text-sm text-gray-400">
                This production group has no agents yet. Add agents to the group first, then start A2A.
              </p>
            ) : (
              <div className="space-y-2">
                {availableAgents.map(agent => {
                  const isSelected = Boolean(selected[agent.id]);
                  const isLead = leadId === agent.id;
                  return (
                    <div
                      key={agent.id}
                      className={cn(
                        'rounded-lg border bg-surface-850 p-3 transition-colors',
                        isSelected ? 'border-nexus-500/40' : 'border-white/5',
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleAgent(agent)}
                          className="h-4 w-4 shrink-0 accent-nexus-500"
                        />
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', statusClasses[agent.status] || 'bg-gray-500')} />
                        <span className="flex-1 truncate text-sm font-medium text-white">{agent.displayName}</span>
                        {isSelected && (
                          <label className={cn(
                            'flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-medium',
                            isLead ? 'bg-nexus-500/10 text-nexus-300' : 'text-gray-500',
                          )}>
                            <input
                              type="radio"
                              name="a2a-lead"
                              checked={isLead}
                              onChange={() => setLeadId(agent.id)}
                              className="h-3 w-3 accent-nexus-500"
                            />
                            Lead
                          </label>
                        )}
                      </div>
                      {isSelected && (
                        <textarea
                          value={selected[agent.id].work}
                          onChange={event => updateWork(agent.id, event.target.value)}
                          rows={2}
                          placeholder="Assigned work for this agent"
                          className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-surface-950 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-nexus-500 focus:outline-none"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/5 px-5 py-4">
          <span className="text-[11px] text-gray-600">The lead opens the conversation; everyone else replies to it.</span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={starting}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canStart}
              className="inline-flex items-center gap-2 rounded-lg bg-nexus-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-nexus-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GitBranch className="h-4 w-4" />
              {starting ? 'Starting...' : `Start A2A${selectedIds.length >= 2 ? ` (${selectedIds.length})` : ''}`}
            </button>
          </div>
        </div>
      </form>
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
  const [dispatchingAll, setDispatchingAll] = useState(false);
  const [startingLiveWorkflow, setStartingLiveWorkflow] = useState(false);
  const [startingLiveBlackboard, setStartingLiveBlackboard] = useState(false);
  const [startingA2A, setStartingA2A] = useState(false);
  const [showA2AStarter, setShowA2AStarter] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearingChat, setClearingChat] = useState(false);
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
    const handleBoardA2AStarted = (event: { board?: { id?: string } }) => {
      if (!scopedBoardId || event.board?.id !== scopedBoardId) return;
      loadContext().catch(() => {});
    };
    const handleBoardTaskDispatch = (event: { board?: { id?: string } }) => {
      if (!scopedBoardId || event.board?.id !== scopedBoardId) return;
      loadContext().catch(() => {});
    };
    const handleBoardLiveWorkflow = (event: { board?: { id?: string } }) => {
      if (!scopedBoardId || event.board?.id !== scopedBoardId) return;
      loadContext().catch(() => {});
    };
    const handleBoardLiveBlackboard = (event: { board?: { id?: string }; boardId?: string | null }) => {
      const boardId = event.board?.id ?? event.boardId ?? null;
      if (!scopedBoardId || boardId !== scopedBoardId) return;
      loadContext().catch(() => {});
    };
    const handleAgentRunJobUpdate = (event: { boardId?: string | null }) => {
      if ((event.boardId ?? null) !== (scopedBoardId ?? null)) return;
      loadContext().catch(() => {});
    };

    socket.on('mother-chat:event', handleMotherChatEvent);
    socket.on('board:a2aStarted', handleBoardA2AStarted);
    socket.on('board:taskDispatch', handleBoardTaskDispatch);
    socket.on('board:liveWorkflowStarted', handleBoardLiveWorkflow);
    socket.on('board:liveWorkflowAdvanced', handleBoardLiveWorkflow);
    socket.on('board:liveWorkflowCompleted', handleBoardLiveWorkflow);
    socket.on('board:liveBlackboardStarted', handleBoardLiveBlackboard);
    socket.on('board:liveBlackboardAdvanced', handleBoardLiveBlackboard);
    socket.on('board:liveBlackboardCompleted', handleBoardLiveBlackboard);
    socket.on('blackboard:event', handleBoardLiveBlackboard);
    socket.on('blackboard:conversationCompleted', handleBoardLiveBlackboard);
    socket.on('agent-run-job:update', handleAgentRunJobUpdate);
    return () => {
      socket.off('mother-chat:event', handleMotherChatEvent);
      socket.off('board:a2aStarted', handleBoardA2AStarted);
      socket.off('board:taskDispatch', handleBoardTaskDispatch);
      socket.off('board:liveWorkflowStarted', handleBoardLiveWorkflow);
      socket.off('board:liveWorkflowAdvanced', handleBoardLiveWorkflow);
      socket.off('board:liveWorkflowCompleted', handleBoardLiveWorkflow);
      socket.off('board:liveBlackboardStarted', handleBoardLiveBlackboard);
      socket.off('board:liveBlackboardAdvanced', handleBoardLiveBlackboard);
      socket.off('board:liveBlackboardCompleted', handleBoardLiveBlackboard);
      socket.off('blackboard:event', handleBoardLiveBlackboard);
      socket.off('blackboard:conversationCompleted', handleBoardLiveBlackboard);
      socket.off('agent-run-job:update', handleAgentRunJobUpdate);
    };
  }, [scopedBoardId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || sending || dispatchingAll || startingLiveWorkflow || startingLiveBlackboard) return;

    const requestId = newRequestId();
    streamedResponseRequestsRef.current[requestId] = false;
    const content = input.trim();
    const dispatchCommand = scopedBoardId
      ? content.match(/^\/(?:assign|assign-all|task-all)\s+(.+)/i)
      : null;
    if (dispatchCommand?.[1]) {
      await handleDispatchAll(dispatchCommand[1]);
      return;
    }
    const liveWorkflowCommand = scopedBoardId
      ? content.match(/^\/(?:live|live-workflow|pipeline)\s+(.+)/i)
      : null;
    if (liveWorkflowCommand?.[1]) {
      await handleStartLiveWorkflow(liveWorkflowCommand[1]);
      return;
    }
    const liveBlackboardCommand = scopedBoardId
      ? content.match(/^\/(?:blackboard|live-chat|agent-chat)\s+(.+)/i)
      : null;
    if (liveBlackboardCommand?.[1]) {
      await handleStartLiveBlackboard(liveBlackboardCommand[1]);
      return;
    }

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

  async function handleDispatchAll(queryOverride?: string) {
    if (!scopedBoardId || dispatchingAll) return;
    const query = (queryOverride ?? input).trim();
    if (!query) return;

    const requestId = newRequestId();
    setMessages(prev => [
      ...prev,
      {
        id: `dispatch-user-${requestId}`,
        role: 'user',
        content: `Assign all agents: ${query}`,
        timestamp: new Date().toISOString(),
        requestId,
      },
    ]);
    setInput('');
    setDispatchingAll(true);
    setError(null);

    try {
      const response = await api.boards.dispatchToAgents(scopedBoardId, { query });
      const taskRows = response.tasks.map(task => {
        const agent = response.agents.find(item => item.id === task.agentId);
        return `- ${agent?.displayName || 'Agent'}: ${task.title} (${task.id})`;
      });
      setMessages(prev => [
        ...prev,
        {
          id: `dispatch-assistant-${requestId}`,
          role: 'assistant',
          content: [
            `Assigned the query to ${response.agents.length} agents in ${response.board.name}.`,
            '',
            ...taskRows,
          ].join('\n'),
          timestamp: new Date().toISOString(),
          requestId,
        },
      ]);
      await loadContext();
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          id: `dispatch-error-${requestId}`,
          role: 'assistant',
          content: `Error: ${(err as Error).message}`,
          timestamp: new Date().toISOString(),
          requestId,
        },
      ]);
      setError((err as Error).message);
    } finally {
      setDispatchingAll(false);
    }
  }

  async function handleStartA2A(payload: StartA2APayload) {
    if (!scopedBoardId || startingA2A) return;
    setStartingA2A(true);
    setError(null);

    try {
      await api.boards.startCollaboration(scopedBoardId, payload);
      setShowA2AStarter(false);
      await loadContext();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStartingA2A(false);
    }
  }

  async function handleStartLiveWorkflow(triggerOverride?: string) {
    if (!scopedBoardId || startingLiveWorkflow) return;
    const trigger = (triggerOverride ?? input).trim();
    if (!trigger) return;

    const requestId = newRequestId();
    setMessages(prev => [
      ...prev,
      {
        id: `live-workflow-user-${requestId}`,
        role: 'user',
        content: `Start live workflow: ${trigger}`,
        timestamp: new Date().toISOString(),
        requestId,
      },
    ]);
    setInput('');
    setStartingLiveWorkflow(true);
    setError(null);

    try {
      const response = await api.boards.startLiveWorkflow(scopedBoardId, {
        goal: context?.scope?.board?.objective || 'Run a live agent-to-agent production workflow.',
        trigger,
        priority: 'HIGH',
      });
      setMessages(prev => [
        ...prev,
        {
          id: `live-workflow-assistant-${requestId}`,
          role: 'assistant',
          content: [
            `Started live workflow ${response.workflowId}.`,
            `Chain: ${response.agents.map(agent => agent.displayName).join(' -> ')}`,
            `First queued jobs: ${response.runJobs.length}`,
          ].join('\n'),
          timestamp: new Date().toISOString(),
          requestId,
        },
      ]);
      await loadContext();
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          id: `live-workflow-error-${requestId}`,
          role: 'assistant',
          content: `Error: ${(err as Error).message}`,
          timestamp: new Date().toISOString(),
          requestId,
        },
      ]);
      setError((err as Error).message);
    } finally {
      setStartingLiveWorkflow(false);
    }
  }

  async function handleStartLiveBlackboard(triggerOverride?: string) {
    if (!scopedBoardId || startingLiveBlackboard) return;
    const trigger = (triggerOverride ?? input).trim();
    if (!trigger) return;

    const requestId = newRequestId();
    setMessages(prev => [
      ...prev,
      {
        id: `live-blackboard-user-${requestId}`,
        role: 'user',
        content: `Start live agent chat: ${trigger}`,
        timestamp: new Date().toISOString(),
        requestId,
      },
    ]);
    setInput('');
    setStartingLiveBlackboard(true);
    setError(null);

    try {
      const response = await api.boards.startLiveBlackboard(scopedBoardId, {
        goal: context?.scope?.board?.objective || 'Run live agent-to-agent production chat.',
        trigger,
        priority: 'HIGH',
        maxRounds: 3,
      });
      setMessages(prev => [
        ...prev,
        {
          id: `live-blackboard-assistant-${requestId}`,
          role: 'assistant',
          content: [
            `Started live blackboard ${response.conversationId}.`,
            `Agents: ${response.agents.map(agent => agent.displayName).join(', ')}`,
            `Round 1 queued jobs: ${response.runJobs.length}`,
          ].join('\n'),
          timestamp: new Date().toISOString(),
          requestId,
        },
      ]);
      await loadContext();
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          id: `live-blackboard-error-${requestId}`,
          role: 'assistant',
          content: `Error: ${(err as Error).message}`,
          timestamp: new Date().toISOString(),
          requestId,
        },
      ]);
      setError((err as Error).message);
    } finally {
      setStartingLiveBlackboard(false);
    }
  }

  async function handleClearChat() {
    if (clearingChat) return;
    setClearingChat(true);
    setError(null);
    try {
      await api.motherChat.clearHistory(scopedBoardId);
      setMessages([]);
      streamedResponseRequestsRef.current = {};
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setClearingChat(false);
      setConfirmingClear(false);
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
    : 'Local Claude CLI with Nexus DB context';
  const agentConversations = (context?.messages ?? [])
    .filter(message => message.conversationKind === 'agent_agent' || message.from !== message.to)
    .slice(-6);

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

            <button
              type="button"
              onClick={() => setShowA2AStarter(true)}
              disabled={startingA2A || startingLiveWorkflow || startingLiveBlackboard}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GitBranch className="h-3.5 w-3.5" />
              {startingA2A ? 'Starting A2A...' : 'Start A2A'}
            </button>

            <button
              type="button"
              onClick={() => handleStartLiveWorkflow(resolveLiveTrigger(input, DEFAULT_LIVE_WORKFLOW_TRIGGER))}
              disabled={startingLiveWorkflow || startingLiveBlackboard}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-200 transition-colors hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Zap className="h-3.5 w-3.5" />
              {startingLiveWorkflow ? 'Starting live...' : 'Start live workflow'}
            </button>

            <button
              type="button"
              onClick={() => handleStartLiveBlackboard(resolveLiveTrigger(input, DEFAULT_LIVE_BLACKBOARD_TRIGGER))}
              disabled={startingLiveBlackboard || startingLiveWorkflow}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-200 transition-colors hover:bg-violet-500/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GitBranch className="h-3.5 w-3.5" />
              {startingLiveBlackboard ? 'Starting chat...' : 'Start live chat'}
            </button>

            <Link
              to={`/production/${scopedBoardId}/trace`}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-surface-850 px-3 py-2 text-xs font-semibold text-gray-300 transition-colors hover:bg-white/5"
            >
              <Activity className="h-3.5 w-3.5" />
              Trace live chat
            </Link>

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
                <StatTile label="Live chats" value={context?.counts.activeBlackboardConversations ?? 0} icon={GitBranch} />
                <StatTile label="Events" value={context?.counts.blackboardEvents ?? 0} icon={Activity} />
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
            <div className="flex items-center gap-2">
              {confirmingClear ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Clear this chat?</span>
                  <button
                    type="button"
                    onClick={handleClearChat}
                    disabled={clearingChat}
                    className="rounded-lg bg-red-500/10 px-2.5 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                  >
                    {clearingChat ? 'Clearing…' : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingClear(false)}
                    disabled={clearingChat}
                    className="rounded-lg px-2.5 py-2 text-xs font-medium text-gray-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingClear(true)}
                  disabled={loading || sending || messages.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-surface-850 px-3 py-2 text-sm text-gray-300 transition-colors hover:border-red-500/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Clear chat history"
                >
                  <Trash2 className="h-4 w-4" />
                  Clear chat
                </button>
              )}
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
                <p className="mt-1 text-sm text-gray-500">Mother Chat reads recent Nexus records before each Claude run.</p>
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
              disabled={sending || dispatchingAll || startingLiveBlackboard}
              rows={2}
              placeholder={scopedBoard ? `Ask about ${scopedBoard.name}...` : 'Ask Mother Chat...'}
              className="min-h-[48px] flex-1 resize-none rounded-xl border border-white/10 bg-surface-850 px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-nexus-500 focus:outline-none disabled:opacity-50"
            />
            {scopedBoardId && (
              <button
                onClick={() => handleDispatchAll()}
                disabled={!input.trim() || sending || dispatchingAll || startingLiveBlackboard}
                className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                title="Assign all agents"
              >
                <ClipboardCheck className="h-4 w-4" />
                <span className="hidden sm:inline">{dispatchingAll ? 'Assigning...' : 'Assign all'}</span>
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending || dispatchingAll || startingLiveBlackboard}
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
            <StatTile label="Runs" value={context?.counts.activeRunJobs ?? 0} icon={Activity} />
            <StatTile label="Errors" value={(context?.counts.recentErrors ?? 0) + (context?.counts.failedRunJobs ?? 0)} icon={AlertTriangle} />
            <StatTile label="Live chats" value={context?.counts.activeBlackboardConversations ?? 0} icon={GitBranch} />
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
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Local Claude Runs</h3>
            <div className="space-y-2">
              {(context?.agentRunJobs ?? []).slice(0, 6).map(job => (
                <div key={job.id} className="rounded-lg border border-sky-500/10 bg-sky-500/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm text-white">{job.agent}</p>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                      job.status === 'FAILED'
                        ? 'bg-red-500/10 text-red-300'
                        : job.status === 'RUNNING'
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : 'bg-white/5 text-gray-400'
                    }`}>
                      {job.status}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-400">{job.summary || job.error || job.prompt}</p>
                  <p className="mt-1 truncate text-[10px] text-sky-300/70">
                    {job.codexSessionId ? `claude ${job.codexSessionId}` : `job ${job.id}`}
                  </p>
                </div>
              ))}
              {context && (context.agentRunJobs ?? []).length === 0 && <p className="text-sm text-gray-500">No local Claude runs</p>}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Live Blackboard</h3>
            <div className="space-y-2">
              {(context?.blackboardConversations ?? []).slice(0, 3).map(conversation => (
                <div key={conversation.id} className="rounded-lg border border-violet-500/10 bg-violet-500/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm text-white">{conversation.title}</p>
                    <span className="shrink-0 rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-200">
                      {conversation.currentRound}/{conversation.maxRounds}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-400">{conversation.goal || conversation.completedReason || conversation.status}</p>
                </div>
              ))}
              {(context?.blackboardEvents ?? []).slice(-4).map(event => (
                <div key={event.id} className="rounded-lg border border-white/5 bg-surface-850 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-medium text-violet-200">{event.from}{' -> '}{event.to}</p>
                    <span className="text-[10px] text-gray-600">{new Date(event.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-400">{event.content}</p>
                </div>
              ))}
              {context && (context.blackboardConversations ?? []).length === 0 && <p className="text-sm text-gray-500">No live blackboard conversations</p>}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Agent Conversations</h3>
            <div className="space-y-2">
              {agentConversations.map(message => (
                <div key={message.id} className="rounded-lg border border-emerald-500/10 bg-emerald-500/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm text-white">{message.from}{' -> '}{message.to}</p>
                    <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400">
                      {new Date(message.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-xs leading-5 text-gray-400">{message.content}</p>
                  {message.taskIds && message.taskIds.length > 0 && (
                    <p className="mt-1 text-[10px] text-emerald-300/70">{message.taskIds.length} linked tasks</p>
                  )}
                </div>
              ))}
              {context && agentConversations.length === 0 && <p className="text-sm text-gray-500">No agent conversations</p>}
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

      {showA2AStarter && scopedBoardId && (
        <StartA2AModal
          boardName={scopedBoard?.name || 'Production Group'}
          defaultGoal={scopedBoard?.objective || `Validate ${scopedBoard?.name || 'this production group'} and report readiness.`}
          availableAgents={(context?.agents ?? []).map(agent => ({
            id: agent.id,
            displayName: agent.displayName,
            status: agent.status,
            currentTask: agent.currentTask,
          }))}
          starting={startingA2A}
          onCancel={() => setShowA2AStarter(false)}
          onSubmit={handleStartA2A}
        />
      )}
    </div>
  );
}
