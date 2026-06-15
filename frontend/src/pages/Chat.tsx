import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import type { Agent, AgentStatus, ChatMessage } from '../types';

export function Chat() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const selectedAgentIdRef = useRef<string | null>(null);
  const streamedResponseRequestsRef = useRef<Record<string, boolean>>({});

  type AgentChatSocketEvent = {
    agentId: string;
    type: 'response' | 'activity' | 'tool_call' | 'tool_result' | 'terminal_output' | 'file_read' | 'file_write' | 'status_update' | 'response_end' | 'error';
    content?: string;
    requestId?: string | null;
    sessionId?: string;
    nexusSessionId?: string;
    codexSessionId?: string | null;
    timestamp?: string;
  };

  useEffect(() => {
    api.agents.list().then(data => {
      setAgents(data);
      setLoading(false);
    }).catch(() => setLoading(false));

    // Listen for real-time agent status updates
    const socket = getSocket();
    const handleUpdated = (data: { id: string; status?: AgentStatus }) => {
      if (data.id && data.status) {
        setAgents(prev => prev.map(a => a.id === data.id ? { ...a, status: data.status! } : a));
      }
    };
    const handleHeartbeat = (data: { id: string; status?: AgentStatus }) => {
      if (data.id) {
        setAgents(prev => prev.map(a => a.id === data.id ? { ...a, status: data.status || 'ONLINE' } : a));
      }
    };
    const handleChatEvent = (event: AgentChatSocketEvent) => {
      if (event.agentId !== selectedAgentIdRef.current) return;

      const requestKey = event.requestId || event.nexusSessionId || event.sessionId || `codex-${Date.now()}`;
      const timestamp = event.timestamp || new Date().toISOString();

      if (event.type === 'response' && event.content) {
        const content = event.content;
        streamedResponseRequestsRef.current[requestKey] = true;
        setMessages(prev => {
          const existingIndex = prev.findIndex(message => message.role === 'assistant' && message.requestId === requestKey);
          if (existingIndex >= 0) {
            const next = [...prev];
            const existing = next[existingIndex];
            next[existingIndex] = {
              ...existing,
              content: existing.content ? `${existing.content}\n${content}` : content,
              timestamp,
            };
            return next;
          }

          return [
            ...prev,
            {
              id: `assistant-${requestKey}`,
              role: 'assistant',
              content,
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
            content: `Error: ${event.content || 'Codex CLI request failed'}`,
            timestamp,
            requestId: requestKey,
          },
        ]);
        setSending(false);
        return;
      }

      if (event.type === 'response_end') {
        setSending(false);
      }
    };
    socket.on('agent:updated', handleUpdated);
    socket.on('agent:status', handleUpdated);
    socket.on('agent:heartbeat', handleHeartbeat);
    socket.on('agent:chat:event', handleChatEvent);
    return () => {
      socket.off('agent:updated', handleUpdated);
      socket.off('agent:status', handleUpdated);
      socket.off('agent:heartbeat', handleHeartbeat);
      socket.off('agent:chat:event', handleChatEvent);
    };
  }, []);

  useEffect(() => {
    selectedAgentIdRef.current = selectedAgentId;
    if (selectedAgentId) {
      loadHistory(selectedAgentId);
    }
  }, [selectedAgentId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadHistory(agentId: string) {
    try {
      const data = await api.chat.history(agentId);
      setMessages(data.messages || []);
    } catch {
      setMessages([]);
    }
  }

  async function handleSend() {
    if (!input.trim() || !selectedAgentId || sending) return;

    const agentIdAtSend = selectedAgentId;
    const requestId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    streamedResponseRequestsRef.current[requestId] = false;
    const userMessage: ChatMessage = {
      id: `user-${requestId}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
      requestId,
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setSending(true);

    try {
      const response = await api.chat.send(agentIdAtSend, userMessage.content, requestId);
      const assistantMessage: ChatMessage = {
        id: `assistant-${requestId}`,
        role: 'assistant',
        content: response.result || response.summary || 'No response',
        timestamp: new Date().toISOString(),
        requestId,
      };
      // Only append response if still viewing the same agent
      if (selectedAgentIdRef.current === agentIdAtSend && !streamedResponseRequestsRef.current[requestId]) {
        setMessages(prev => [...prev, assistantMessage]);
      }
    } catch (err) {
      if (selectedAgentIdRef.current === agentIdAtSend && !streamedResponseRequestsRef.current[requestId]) {
        const errorMessage: ChatMessage = {
          id: `error-${requestId}`,
          role: 'assistant',
          content: `Error: ${(err as Error).message}`,
          timestamp: new Date().toISOString(),
          requestId,
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } finally {
      if (selectedAgentIdRef.current === agentIdAtSend) {
        setSending(false);
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const selectedAgent = agents.find(a => a.id === selectedAgentId);
  const filteredAgents = agents.filter(a =>
    a.displayName.toLowerCase().includes(searchFilter.toLowerCase()) ||
    a.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const statusColors: Record<string, string> = {
    ONLINE: 'bg-emerald-500',
    IDLE: 'bg-amber-500',
    OFFLINE: 'bg-gray-500',
    ERROR: 'bg-red-500',
  };

  return (
    <div className="flex h-[calc(100vh-2rem)] -m-6 -mt-6">
      {/* Agent List Sidebar */}
      <div className="w-72 border-r border-white/5 bg-surface-900 flex flex-col">
        <div className="p-4 border-b border-white/5">
          <h2 className="text-sm font-semibold text-white mb-3">Agents</h2>
          <input
            type="text"
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
            placeholder="Search agents..."
            className="w-full px-3 py-1.5 bg-surface-850 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-nexus-500"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-sm text-gray-500">Loading...</div>
          ) : filteredAgents.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">No agents found</div>
          ) : (
            filteredAgents.map(agent => (
              <button
                key={agent.id}
                onClick={() => setSelectedAgentId(agent.id)}
                className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors ${
                  selectedAgentId === agent.id
                    ? 'bg-nexus-600/15 border-r-2 border-nexus-500'
                    : 'hover:bg-white/5'
                }`}
              >
                <div className="relative">
                  <div className="w-9 h-9 rounded-full bg-surface-800 flex items-center justify-center text-lg">
                    {agent.avatar || agent.displayName.charAt(0)}
                  </div>
                  <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface-900 ${statusColors[agent.status] || statusColors.OFFLINE}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-white truncate">{agent.displayName}</p>
                    {agent.agentToAgent && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-nexus-600/15 text-nexus-400 border border-nexus-500/20 font-medium shrink-0">A2A</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate">{agent.status.toLowerCase()}</p>
                </div>
                <div className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium shrink-0" title="Local Codex CLI runtime">CLI</div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {selectedAgent ? (
          <>
            {/* Chat Header */}
            <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-surface-800 flex items-center justify-center text-xl">
                {selectedAgent.avatar || selectedAgent.displayName.charAt(0)}
              </div>
              <div>
                <h2 className="text-white font-semibold">{selectedAgent.displayName}</h2>
                <p className="text-xs text-gray-500">
                  Local Codex CLI runtime
                  {selectedAgent.status === 'ONLINE' && ' \u2022 Online'}
                </p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {messages.length === 0 && !sending && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="text-4xl mb-3">{selectedAgent.avatar || '\u{1F916}'}</div>
                    <p className="text-gray-400">Start a conversation with {selectedAgent.displayName}</p>
                  </div>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${
                    msg.role === 'user'
                      ? 'bg-nexus-600 text-white'
                      : 'bg-surface-800 text-gray-200 border border-white/5'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    {msg.timestamp && (
                      <p className={`text-[10px] mt-1 ${msg.role === 'user' ? 'text-nexus-300' : 'text-gray-600'}`}>
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="bg-surface-800 border border-white/5 rounded-2xl px-4 py-3">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="px-6 py-4 border-t border-white/5">
              <div className="flex gap-3">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message for Codex CLI..."
                  disabled={sending}
                  rows={1}
                  className="flex-1 px-4 py-2.5 bg-surface-850 border border-white/10 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-nexus-500 resize-none disabled:opacity-50"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                  className="px-5 py-2.5 bg-nexus-600 hover:bg-nexus-500 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Send
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-5xl mb-4">{'\u25EC'}</div>
              <h2 className="text-xl font-semibold text-white mb-2">Select an Agent</h2>
              <p className="text-gray-400 text-sm">Choose an agent from the sidebar to start chatting</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
