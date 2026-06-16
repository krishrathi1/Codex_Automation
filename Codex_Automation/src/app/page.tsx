'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { renderMarkdown } from '@/lib/markdown';
import { useTheme, type Theme } from '@/components/theme-provider';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Trash2,
  Terminal,
  Menu,
  X,
  KeyRound,
  Loader2,
  MessageSquare,
  Zap,
  Check,
  RefreshCw,
  Settings,
  ChevronDown,
  Plus,
  Edit2,
  Trash,
  Play,
  Copy,
  ChevronRight,
  Database,
  MonitorPlay,
  Search,
  Sparkles,
  Laptop,
  Sun,
  Moon,
  Command,
  Activity,
  Square
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  useChatStore,
  ChatMessage,
  ChatThread,
  ActivityItem,
  StreamActivity
} from '@/hooks/use-chat-store';

// ─── Timeline Grouping Helper ───────────────────────────────
function getGroupedThreads(threads: ChatThread[]) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  const today: typeof threads = [];
  const yesterday: typeof threads = [];
  const previousDays: typeof threads = [];

  threads.forEach((t) => {
    if (t.createdAt >= startOfToday) {
      today.push(t);
    } else if (t.createdAt >= startOfYesterday) {
      yesterday.push(t);
    } else {
      previousDays.push(t);
    }
  });

  return { today, yesterday, previousDays };
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

const statusColors: Record<ConnectionStatus, string> = {
  connecting: 'bg-amber-500 dot-pulse-green',
  connected: 'bg-emerald-500 dot-pulse-green',
  disconnected: 'bg-zinc-400 dark:bg-zinc-500',
  error: 'bg-rose-500 dot-pulse-green',
};

const statusLabels: Record<ConnectionStatus, string> = {
  connecting: 'Connecting...',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Connection Error',
};

// ─── Slash Commands Definition ────────────────────────────────
const SESSION_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SESSION_STORAGE_KEY = 'blostem-codex-session';

function normalizeSessionValue(value: string | undefined) {
  const trimmed = value?.trim() || '';
  if (!trimmed) return '';

  return trimmed.match(SESSION_ID_PATTERN)?.[0] || trimmed;
}

function readStoredSessionId() {
  if (typeof window === 'undefined') return '';

  try {
    return normalizeSessionValue(window.localStorage.getItem(SESSION_STORAGE_KEY) ?? undefined);
  } catch {
    return '';
  }
}

function writeStoredSessionId(sessionId: string) {
  try {
    if (sessionId) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures from private browsing or blocked storage.
  }
}

function isLocalBrowserHost(hostname: string) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}

function resolveConnectionUrl(connectionUrl: string) {
  const configuredUrl = connectionUrl?.trim() || 'http://localhost:3003';
  if (typeof window === 'undefined') return configuredUrl;

  if (isLocalBrowserHost(window.location.hostname) && configuredUrl.includes('XTransformPort=3003')) {
    return `${window.location.protocol}//${window.location.hostname}:3003`;
  }

  return configuredUrl;
}

interface SlashCmd {
  command: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: (utils: {
    handleSend: (val: string) => void;
    clearThreadHistory: (id: string) => void;
    activeThreadId: string | null;
    setSelectedModel: (m: string) => void;
    selectedModel: string;
    setTheme: (t: Theme) => void;
    theme: string | undefined;
    setInputValue: (v: string) => void;
  }) => void;
}

const SLASH_COMMANDS: SlashCmd[] = [
  {
    command: '/clear',
    label: 'Clear Workspace',
    description: 'Reset conversation history and session',
    icon: <Trash2 className="w-3.5 h-3.5 text-rose-400" />,
    action: ({ clearThreadHistory, activeThreadId, setInputValue }) => {
      if (activeThreadId) {
        clearThreadHistory(activeThreadId);
      }
      setInputValue('');
    }
  },
  {
    command: '/test',
    label: 'Run Workspace Tests',
    description: 'Execute build & verify test suites',
    icon: <Play className="w-3.5 h-3.5 text-emerald-400" />,
    action: ({ handleSend, setInputValue }) => {
      handleSend('Run tests in workspace');
      setInputValue('');
    }
  },
  {
    command: '/status',
    label: 'Gateway Diagnostics',
    description: 'Perform system health diagnostics',
    icon: <Activity className="w-3.5 h-3.5 text-cyan-400" />,
    action: ({ handleSend, setInputValue }) => {
      handleSend('Perform system API health diagnostic check');
      setInputValue('');
    }
  },
  {
    command: '/model',
    label: 'Toggle Deep Thinker',
    description: 'Switch standard vs deep thinking mode',
    icon: <Sparkles className="w-3.5 h-3.5 text-violet-400" />,
    action: ({ setSelectedModel, selectedModel, setInputValue }) => {
      setSelectedModel(selectedModel === 'codex-agent' ? 'codex-agent-deep' : 'codex-agent');
      setInputValue('');
    }
  },
  {
    command: '/theme',
    label: 'Toggle Theme',
    description: 'Switch between black & white themes',
    icon: <Sun className="w-3.5 h-3.5 text-amber-400" />,
    action: ({ setTheme, theme, setInputValue }) => {
      setTheme(theme === 'dark' ? 'light' : 'dark');
      setInputValue('');
    }
  }
];

// ─── Component ───────────────────────────────────────────────────
export default function CodexChatPage() {
  const { resolvedTheme, setTheme } = useTheme();
  const theme = resolvedTheme ?? 'dark';

  // Store selectors
  const threads = useChatStore((state) => state.threads);
  const activeThreadId = useChatStore((state) => state.activeThreadId);
  const activeConnectionUrl = useChatStore((state) => state.activeConnectionUrl);
  const selectedModel = useChatStore((state) => state.selectedModel);

  const createThread = useChatStore((state) => state.createThread);
  const deleteThread = useChatStore((state) => state.deleteThread);
  const renameThread = useChatStore((state) => state.renameThread);
  const setActiveThreadId = useChatStore((state) => state.setActiveThreadId);
  const updateThreadMessages = useChatStore((state) => state.updateThreadMessages);
  const updateThreadActivities = useChatStore((state) => state.updateThreadActivities);
  const updateThreadSessionId = useChatStore((state) => state.updateThreadSessionId);
  const clearThreadHistory = useChatStore((state) => state.clearThreadHistory);
  const setActiveConnectionUrl = useChatStore((state) => state.setActiveConnectionUrl);
  const setSelectedModel = useChatStore((state) => state.setSelectedModel);

  // Local state
  const socketRef = useRef<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [pendingAssistantId, setPendingAssistantId] = useState<string | null>(null);
  const pendingAssistantRef = useRef<string | null>(null);

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activityPanelOpen, setActivityPanelOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState('');
  const [expandedActivities, setExpandedActivities] = useState<Record<string, boolean>>({});
  const [sessionDraft, setSessionDraft] = useState<{ threadId: string; value: string } | null>(null);
  const [initializingSessions, setInitializingSessions] = useState<Record<string, boolean>>({});

  // Command palette autocomplete state
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false);
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);

  // Log search/filter state
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logFilterLevel, setLogFilterLevel] = useState<'all' | 'commands' | 'system' | 'errors'>('all');

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activityListRef = useRef<HTMLDivElement>(null);
  const autoSessionRequestsRef = useRef<Record<string, boolean>>({});

  const genId = () => Math.random().toString(36).slice(2, 11);
  const activeThread = threads.find((t) => t.id === activeThreadId) || null;
  const displayedSessionDraft = sessionDraft?.threadId === activeThreadId ? sessionDraft.value : activeThread?.sessionId ?? '';
  const isInitializingActiveSession = Boolean(activeThreadId && initializingSessions[activeThreadId] && !activeThread?.sessionId);
  const showSlashMenu = inputValue.startsWith('/') && !slashMenuDismissed;

  // Restore a saved active chat, or create the first workspace on a fresh UI start.
  useEffect(() => {
    if (threads.length > 0 && !activeThreadId) {
      setActiveThreadId(threads[0].id);
      return;
    }

    if (threads.length === 0 && !activeThreadId) {
      createThread('First Codex Workspace');
    }
  }, [threads, activeThreadId, createThread, setActiveThreadId]);

  // Keep ref of activeThreadId to bypass stale callback closures
  const activeThreadIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeThreadId || activeThread?.sessionId) return;

    const storedSessionId = readStoredSessionId();
    if (!storedSessionId) return;

    updateThreadSessionId(activeThreadId, storedSessionId);
  }, [activeThreadId, activeThread?.sessionId, updateThreadSessionId]);

  // ─── Auto-detect slash menu toggle ─────────────────────────
  // ─── Responsive viewport detection ──────────────────────────
  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth <= 1024;
      setIsMobile(mobile);
      if (mobile) {
        setSidebarOpen(false);
        setActivityPanelOpen(false);
      }
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ─── Socket.IO connection ──────────────────────────────────
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      isLocalBrowserHost(window.location.hostname) &&
      activeConnectionUrl.includes('XTransformPort=3003')
    ) {
      setActiveConnectionUrl(`${window.location.protocol}//${window.location.hostname}:3003`);
    }
  }, [activeConnectionUrl, setActiveConnectionUrl]);

  useEffect(() => {
    if (!activeConnectionUrl) return;

    const connectingTimer = window.setTimeout(() => setConnectionStatus('connecting'), 0);
    const socketUrl = resolveConnectionUrl(activeConnectionUrl);

    const socket = io(socketUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 50,
      reconnectionDelay: 2000,
      timeout: 10000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      window.clearTimeout(connectingTimer);
      setConnectionStatus('connected');
    });

    socket.on('disconnect', () => {
      setConnectionStatus('disconnected');
      autoSessionRequestsRef.current = {};
      setInitializingSessions({});
    });

    socket.on('connect_error', () => {
      if (typeof window !== 'undefined' && isLocalBrowserHost(window.location.hostname)) {
        const localUrl = `${window.location.protocol}//${window.location.hostname}:3003`;
        if (activeConnectionUrl !== localUrl) {
          setActiveConnectionUrl(localUrl);
          return;
        }
      }

      setConnectionStatus('error');
    });

    socket.on('activity', (activity: StreamActivity) => {
      const id = genId();
      const toolUseId = activity?.toolUseId;
      const currentThreadId = activeThreadIdRef.current;
      if (!currentThreadId) return;

      const activitySessionId =
        activity?.subtype === 'codex.thread.started' &&
        activity.data &&
        typeof (activity.data as { threadId?: unknown }).threadId === 'string'
          ? normalizeSessionValue((activity.data as { threadId: string }).threadId)
          : '';

      if (activitySessionId) {
        updateThreadSessionId(currentThreadId, activitySessionId);
        writeStoredSessionId(activitySessionId);
      }

      if (activity?.type === 'tool_result' && toolUseId) {
        updateThreadActivities(currentThreadId, (prev) => {
          const existingIndex = prev.findIndex(
            (a) => a.activity.toolUseId === toolUseId && a.activity.type === 'tool_use'
          );
          if (existingIndex !== -1) {
            return prev.map((a, idx) =>
              idx === existingIndex
                ? {
                    ...a,
                    status: activity.isError ? 'error' : 'success',
                    activity,
                  }
                : a
            );
          }
          return prev;
        });
        return;
      }

      let status: ActivityItem['status'] = 'system';
      let command: string | undefined;

      if (activity?.type === 'tool_use') {
        status = 'running';
        command = (activity.input as { command?: string })?.command;
      } else if (activity?.isError || activity?.subtype?.includes('failed')) {
        status = 'error';
      }

      const item: ActivityItem = { id, activity, status, command, timestamp: Date.now() };
      updateThreadActivities(currentThreadId, (prev) => [item, ...prev]);
    });

    socket.on('response', (data: { type: string; content: string }) => {
      const newText = data?.content || '';
      const currentThreadId = activeThreadIdRef.current;
      if (!currentThreadId) return;

      const currentPending = pendingAssistantRef.current;
      if (!currentPending) {
        const id = genId();
        pendingAssistantRef.current = id;
        setPendingAssistantId(id);
        updateThreadMessages(currentThreadId, (prev) => [
          ...prev,
          {
            id,
            role: 'assistant',
            content: newText,
            timestamp: Date.now(),
          },
        ]);
      } else {
        updateThreadMessages(currentThreadId, (prev) =>
          prev.map((m) => {
            if (m.id === currentPending) {
              return { ...m, content: m.content + newText };
            }
            return m;
          })
        );
      }
    });

    socket.on('response_end', (data: { sessionId?: string; done: boolean }) => {
      const currentThreadId = activeThreadIdRef.current;
      const sessionId = normalizeSessionValue(data?.sessionId);
      if (currentThreadId && sessionId) {
        updateThreadSessionId(currentThreadId, sessionId);
        writeStoredSessionId(sessionId);
      }
      pendingAssistantRef.current = null;
      setPendingAssistantId(null);
      setIsSending(false);
    });

    socket.on('session_created', (data: { clientThreadId?: string; sessionId?: string }) => {
      const targetThreadId = data?.clientThreadId || activeThreadIdRef.current;
      const sessionId = normalizeSessionValue(data?.sessionId);
      if (!targetThreadId || !sessionId) return;

      updateThreadSessionId(targetThreadId, sessionId);
      setInitializingSessions((prev) => {
        const next = { ...prev };
        delete next[targetThreadId];
        return next;
      });

      if (targetThreadId === activeThreadIdRef.current) {
        setSessionDraft(null);
        writeStoredSessionId(sessionId);
      }
    });

    socket.on('session_create_error', (data: { clientThreadId?: string; message?: string }) => {
      const targetThreadId = data?.clientThreadId || activeThreadIdRef.current;
      if (targetThreadId) {
        setInitializingSessions((prev) => {
          const next = { ...prev };
          delete next[targetThreadId];
          return next;
        });
      }

      const currentThreadId = activeThreadIdRef.current;
      if (currentThreadId && (!targetThreadId || targetThreadId === currentThreadId)) {
        updateThreadMessages(currentThreadId, (prev) => [
          ...prev,
          {
            id: genId(),
            role: 'assistant',
            content: data?.message || 'Failed to create Codex session.',
            timestamp: Date.now(),
          },
        ]);
      }
    });

    socket.on('cancelled', (data: { cancelled: boolean; reason?: string }) => {
      if (!data?.cancelled) return;
      setIsSending(false);
    });

    socket.on('error', (data: { message: string }) => {
      const id = genId();
      const currentThreadId = activeThreadIdRef.current;
      if (currentThreadId) {
        updateThreadMessages(currentThreadId, (prev) => [
          ...prev,
          {
            id,
            role: 'assistant',
            content: data?.message || 'Request failed',
            timestamp: Date.now(),
          },
        ]);
      }
      setConnectionStatus('connected');
      pendingAssistantRef.current = null;
      setPendingAssistantId(null);
      setIsSending(false);
    });

    return () => {
      window.clearTimeout(connectingTimer);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [activeConnectionUrl, setActiveConnectionUrl, updateThreadActivities, updateThreadMessages, updateThreadSessionId]);

  useEffect(() => {
    if (connectionStatus !== 'connected' || !activeThreadId || !socketRef.current?.connected) return;

    const latestActiveThread = useChatStore
      .getState()
      .threads.find((thread) => thread.id === activeThreadId);
    if (!latestActiveThread || latestActiveThread.sessionId || initializingSessions[activeThreadId]) return;

    const storedSessionId = readStoredSessionId();
    if (storedSessionId) {
      updateThreadSessionId(activeThreadId, storedSessionId);
      return;
    }

    if (autoSessionRequestsRef.current[activeThreadId]) return;

    autoSessionRequestsRef.current[activeThreadId] = true;
    setInitializingSessions((prev) => ({ ...prev, [activeThreadId]: true }));
    socketRef.current.emit('create_session', {
      clientThreadId: activeThreadId,
      model: selectedModel,
    });
  }, [
    activeThreadId,
    activeThread?.sessionId,
    connectionStatus,
    initializingSessions,
    selectedModel,
    updateThreadSessionId,
  ]);

  // ─── Send message ──────────────────────────────────────────
  const handleSend = useCallback(
    (textToOverride?: string) => {
      const prompt = (textToOverride || inputValue).trim();
      if (!prompt || isSending || !socketRef.current?.connected) return;

      const latestState = useChatStore.getState();
      let targetThreadId = latestState.activeThreadId;
      if (!targetThreadId) {
        targetThreadId = createThread('First Codex Workspace');
      }
      const latestActiveThread = useChatStore.getState().threads.find((thread) => thread.id === targetThreadId);
      let latestSessionId = normalizeSessionValue(latestActiveThread?.sessionId);

      if (!targetThreadId) return;

      if (!latestSessionId) {
        latestSessionId = readStoredSessionId();
        if (latestSessionId) {
          updateThreadSessionId(targetThreadId, latestSessionId);
        }
      }

      const userMsgId = genId();
      updateThreadMessages(targetThreadId, (prev) => [
        ...prev,
        {
          id: userMsgId,
          role: 'user',
          content: prompt,
          timestamp: Date.now(),
        },
      ]);

      if (!textToOverride) {
        setInputValue('');
      }
      setIsSending(true);
      setPendingAssistantId(null);

      socketRef.current.emit('message', {
        prompt,
        sessionId: latestSessionId || undefined,
        model: selectedModel,
      });
    },
    [createThread, inputValue, isSending, selectedModel, updateThreadMessages, updateThreadSessionId]
  );

  // ─── Toggle activity detail inline ─────────────────────────
  const handleCancelTask = useCallback(() => {
    if (!isSending) return;
    socketRef.current?.emit('cancel');
    setIsSending(false);
  }, [isSending]);

  const toggleActivity = (id: string) => {
    setExpandedActivities((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // ─── Get filtered commands for autocomplete ─────────────────
  const getFilteredSlashCommands = () => {
    return SLASH_COMMANDS.filter((c) =>
      c.command.toLowerCase().includes(inputValue.toLowerCase())
    );
  };

  const filteredSlash = getFilteredSlashCommands();

  // ─── Helper for inline tool styling ────────────────────────
  const getToolMetadata = (activity: StreamActivity) => {
    const toolName = activity?.tool || 'system';
    switch (toolName) {
      case 'run_command':
        return {
          icon: <Terminal className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 animate-pulse" />,
          label: 'Shell Command',
          color: 'border-l-sky-500 bg-sky-50 text-sky-950 dark:bg-sky-950/20 dark:text-sky-200 border-zinc-200 dark:border-zinc-900',
        };
      case 'write_to_file':
      case 'replace_file_content':
      case 'multi_replace_file_content':
        return {
          icon: <Database className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />,
          label: 'Write/Modify File',
          color: 'border-l-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-200 border-zinc-200 dark:border-zinc-900',
        };
      case 'read_file':
      case 'view_file':
      case 'list_dir':
        return {
          icon: <Search className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />,
          label: 'Inspect Files',
          color: 'border-l-indigo-500 bg-indigo-50 text-indigo-950 dark:bg-indigo-950/20 dark:text-indigo-200 border-zinc-200 dark:border-zinc-900',
        };
      default:
        return {
          icon: <Zap className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />,
          label: 'System Action',
          color: 'border-l-zinc-500 bg-zinc-50 text-zinc-900 dark:bg-zinc-950/25 dark:text-zinc-300 border-zinc-200 dark:border-zinc-900',
        };
    }
  };

  const getActivityText = (item: ActivityItem): string => {
    const { activity } = item;
    const type = activity?.type || 'activity';
    const label = activity?.subtype || activity?.tool || type;

    if (activity?.type === 'tool_use') {
      return `[exec] Invoked tool: ${label} with args: ${JSON.stringify(activity.input || {})}`;
    }
    if (activity?.type === 'tool_result') {
      const outputPreview =
        typeof activity.content === 'string'
          ? activity.content
          : JSON.stringify(activity.content || '');
      return `[result] Tool finished. Output: ${outputPreview.slice(0, 1000)}${
        outputPreview.length > 1000 ? '...[truncated]' : ''
      }`;
    }

    return `[system] ${label} - data: ${JSON.stringify(activity.data || {})}`;
  };

  const startRenameThread = (id: string, currentTitle: string) => {
    setEditingThreadId(id);
    setEditingTitleValue(currentTitle);
  };

  const saveRenameThread = (id: string) => {
    if (editingTitleValue.trim()) {
      renameThread(id, editingTitleValue.trim());
    }
    setEditingThreadId(null);
  };

  const handleSaveSessionId = () => {
    if (!activeThreadId) return;
    const trimmed = normalizeSessionValue(displayedSessionDraft);
    updateThreadSessionId(activeThreadId, trimmed || undefined);
    writeStoredSessionId(trimmed);
    setSessionDraft(null);
  };

  const handleSessionDraftChange = (value: string) => {
    if (!activeThreadId) return;
    setSessionDraft({ threadId: activeThreadId, value });

    const trimmed = normalizeSessionValue(value);
    updateThreadSessionId(activeThreadId, trimmed || undefined);
    writeStoredSessionId(trimmed);
  };

  const handleClearSessionId = () => {
    if (!activeThreadId) return;
    updateThreadSessionId(activeThreadId, undefined);
    writeStoredSessionId('');
    setSessionDraft({ threadId: activeThreadId, value: '' });
  };

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
    setSelectedSlashIndex(0);
    setSlashMenuDismissed(false);
  }, []);

  // Reconnect socket
  const handleReconnect = useCallback(() => {
    setConnectionStatus('connecting');
    socketRef.current?.disconnect();
    socketRef.current?.connect();
  }, []);

  // Keyboard navigation for composer
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // If slash autocomplete popup is active
      if (showSlashMenu && filteredSlash.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedSlashIndex((prev) => (prev + 1) % filteredSlash.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedSlashIndex((prev) => (prev - 1 + filteredSlash.length) % filteredSlash.length);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const cmd = filteredSlash[selectedSlashIndex];
          cmd.action({
            handleSend,
            clearThreadHistory,
            activeThreadId,
            setSelectedModel,
            selectedModel,
            setTheme,
            theme,
            setInputValue
          });
          setSlashMenuDismissed(true);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setSlashMenuDismissed(true);
          return;
        }
      }

      // Default composer send message trigger
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [showSlashMenu, filteredSlash, selectedSlashIndex, handleSend, clearThreadHistory, activeThreadId, setSelectedModel, selectedModel, setTheme, theme]
  );

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const handleCopyCode = useCallback((code: string, index: number) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    });
  }, []);

  const renderMessageContent = (message: ChatMessage, index: number) => {
    if (message.role === 'user') {
      return <span className="whitespace-pre-wrap">{message.content}</span>;
    }

    const html = renderMarkdown(message.content);

    return (
      <div
        className="prose-codex max-w-none text-zinc-805 dark:text-zinc-100"
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.classList.contains('copy-code-btn') || target.closest('.copy-code-btn')) {
            const btn = target.classList.contains('copy-code-btn') ? target : target.closest('.copy-code-btn')!;
            const codeIndex = parseInt(btn.getAttribute('data-code-index') || '0', 10);
            const regex = /```(\w*)\n([\s\S]*?)(?:```|$)/g;
            let match;
            let currentIndex = 0;
            while ((match = regex.exec(message.content)) !== null) {
              if (currentIndex === codeIndex) {
                handleCopyCode(match[2].replace(/\n$/, ''), index * 100 + codeIndex);
                break;
              }
              currentIndex++;
            }
          }
        }}
      />
    );
  };

  const getFilteredActivities = () => {
    if (!activeThread) return [];
    return activeThread.activities
      .filter((item) => {
        if (logFilterLevel === 'commands' && item.status !== 'running' && item.status !== 'success' && item.status !== 'error') return false;
        if (logFilterLevel === 'errors' && item.status !== 'error') return false;
        if (logFilterLevel === 'system' && item.status !== 'system') return false;

        if (logSearchQuery.trim()) {
          const text = getActivityText(item).toLowerCase();
          return text.includes(logSearchQuery.toLowerCase());
        }
        return true;
      })
      .reverse();
  };

  const groupedThreads = getGroupedThreads(threads);

  const getTimelineFeed = () => {
    if (!activeThread) return [];

    type FeedItem =
      | { type: 'message'; timestamp: number; data: ChatMessage }
      | { type: 'activity'; timestamp: number; data: ActivityItem };

    const items: FeedItem[] = [];

    activeThread.messages.forEach((m) => {
      items.push({ type: 'message', timestamp: m.timestamp, data: m });
    });

    activeThread.activities.forEach((a) => {
      if (a.activity.type === 'tool_use' || a.activity.type === 'tool_result') {
        items.push({ type: 'activity', timestamp: a.timestamp, data: a });
      }
    });

    return items.sort((a, b) => a.timestamp - b.timestamp);
  };

  const timelineFeed = getTimelineFeed();

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="codex-root h-screen w-screen flex text-zinc-900 dark:text-zinc-100 overflow-hidden font-sans antialiased transition-colors duration-300 relative"
      >
        {/* ─── Sidebar (Left) ──────────────────────────────────── */}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 26 }}
              className={cn(
                'codex-sidebar h-full flex flex-col backdrop-blur-md text-zinc-700 dark:text-zinc-300 border-r z-20 relative shrink-0',
                isMobile && 'absolute left-0 top-0 bottom-0 shadow-2xl shadow-black/80'
              )}
            >
              {/* Sidebar Header */}
              <div className="p-4 border-b border-zinc-200 dark:border-zinc-850 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-white border border-zinc-250 dark:bg-zinc-900 dark:border-zinc-750 flex items-center justify-center shadow-md shadow-zinc-200/40 dark:shadow-black/60 shrink-0">
                    <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400 animate-pulse" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 truncate tracking-tight">Codex Sandbox</h1>
                    <span className="text-[9px] font-bold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-900/60 px-1 py-0.2 rounded tracking-wider uppercase">V1.3.0</span>
                  </div>
                </div>
              </div>

              {/* New Chat Button */}
              <div className="p-3">
                <button
                  onClick={() => {
                    const newId = createThread();
                    setEditingThreadId(newId);
                    setEditingTitleValue(`Workspace ${threads.length + 1}`);
                  }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-white hover:bg-zinc-100 dark:bg-[#191a1d] dark:hover:bg-[#202126] border border-zinc-200 dark:border-[#2c2d33] hover:border-zinc-350 dark:hover:border-[#3a3b42] text-zinc-800 dark:text-zinc-100 text-xs font-bold rounded-lg shadow-sm transition-all duration-200 group active:scale-98"
                >
                  <Plus className="w-4 h-4 text-zinc-550 dark:text-zinc-400 group-hover:text-zinc-850 dark:group-hover:text-zinc-200 transition-colors" />
                  <span>New Conversation</span>
                </button>
              </div>

              {/* Sidebar Nav */}
              <div className="flex-1 overflow-y-auto px-2 space-y-4 py-2">
                {/* Today */}
                {groupedThreads.today.length > 0 && (
                  <div className="space-y-0.5">
                    <div className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-2.5 py-1">Today</div>
                    {groupedThreads.today.map((t) => (
                      <div
                        key={t.id}
                        className={cn(
                          'group relative flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs border transition-all duration-200',
                          t.id === activeThreadId
                            ? 'bg-zinc-200/50 border-zinc-300/60 text-zinc-900 font-semibold dark:bg-[#1d1e22] dark:border-[#33343a] dark:text-zinc-50 shadow-sm shadow-zinc-200/20 dark:shadow-none'
                            : 'border-transparent text-zinc-650 hover:text-zinc-900 hover:bg-zinc-200/30 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-[#18191d]'
                        )}
                      >
                        <button
                          onClick={() => setActiveThreadId(t.id)}
                          className="flex-1 text-left min-w-0 pr-10 outline-none"
                        >
                          {editingThreadId === t.id ? (
                            <input
                              autoFocus
                              value={editingTitleValue}
                              onChange={(e) => setEditingTitleValue(e.target.value)}
                              onBlur={() => saveRenameThread(t.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveRenameThread(t.id);
                                if (e.key === 'Escape') setEditingThreadId(null);
                              }}
                              className="w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-850 rounded px-1 text-xs text-zinc-900 dark:text-zinc-100 outline-none"
                            />
                          ) : (
                            <div className="truncate flex items-center gap-2">
                              <MessageSquare className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />
                              <span className="truncate">{t.title}</span>
                            </div>
                          )}
                        </button>
                        {editingThreadId !== t.id && (
                          <div className="absolute right-2 opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                            <button
                              onClick={() => startRenameThread(t.id, t.title)}
                              className="p-1 text-zinc-500 hover:text-zinc-850 dark:text-zinc-400 dark:hover:text-zinc-200"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => deleteThread(t.id)}
                              className="p-1 text-zinc-505 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-450"
                            >
                              <Trash className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Yesterday */}
                {groupedThreads.yesterday.length > 0 && (
                  <div className="space-y-0.5">
                    <div className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-2.5 py-1">Yesterday</div>
                    {groupedThreads.yesterday.map((t) => (
                      <div
                        key={t.id}
                        className={cn(
                          'group relative flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs border transition-all duration-200',
                          t.id === activeThreadId
                            ? 'bg-zinc-200/50 border-zinc-300/60 text-zinc-900 font-semibold dark:bg-[#1d1e22] dark:border-[#33343a] dark:text-zinc-50 shadow-sm shadow-zinc-200/20'
                            : 'border-transparent text-zinc-650 hover:text-zinc-900 hover:bg-zinc-200/30 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-[#18191d]'
                        )}
                      >
                        <button
                          onClick={() => setActiveThreadId(t.id)}
                          className="flex-1 text-left min-w-0 pr-10"
                        >
                          {editingThreadId === t.id ? (
                            <input
                              autoFocus
                              value={editingTitleValue}
                              onChange={(e) => setEditingTitleValue(e.target.value)}
                              onBlur={() => saveRenameThread(t.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveRenameThread(t.id);
                                if (e.key === 'Escape') setEditingThreadId(null);
                              }}
                              className="w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-850 rounded px-1 text-xs text-zinc-900 dark:text-zinc-100 outline-none"
                            />
                          ) : (
                            <div className="truncate flex items-center gap-2">
                              <MessageSquare className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />
                              <span className="truncate">{t.title}</span>
                            </div>
                          )}
                        </button>
                        {editingThreadId !== t.id && (
                          <div className="absolute right-2 opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                            <button
                              onClick={() => startRenameThread(t.id, t.title)}
                              className="p-1 text-zinc-505 hover:text-zinc-850 dark:text-zinc-400 dark:hover:text-zinc-200"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => deleteThread(t.id)}
                              className="p-1 text-zinc-505 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-450"
                            >
                              <Trash className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Sidebar Footer */}
              <div className="p-3 border-t border-zinc-200 dark:border-[#27272f] space-y-2.5">
                {/* Gateway config indicator */}
                <div className="rounded-lg bg-zinc-100/50 border border-zinc-200 dark:bg-[#141518] dark:border-[#2c2d33] p-2 space-y-1 text-[10px]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 truncate">
                      <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusColors[connectionStatus])} />
                      <span className="text-zinc-550 dark:text-zinc-400 font-semibold truncate">{statusLabels[connectionStatus]}</span>
                    </div>
                    {connectionStatus === 'error' && (
                      <button
                        onClick={handleReconnect}
                        className="text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-0.5"
                      >
                        <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                        <span>Retry</span>
                      </button>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="w-full rounded-lg bg-zinc-100/50 border border-zinc-200 dark:bg-[#141518] dark:border-[#2c2d33] p-2 text-[10px] text-left hover:bg-zinc-100 dark:hover:bg-[#1b1c20] transition-colors"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <KeyRound className="w-3 h-3 text-violet-600 dark:text-violet-400 shrink-0" />
                    <span className="text-zinc-450 dark:text-zinc-500 font-bold uppercase tracking-wider shrink-0">Session</span>
                    <span className="font-mono text-zinc-650 dark:text-zinc-350 truncate">
                      {isInitializingActiveSession ? 'Creating session...' : activeThread?.sessionId ? activeThread.sessionId.slice(0, 12) : 'New session'}
                    </span>
                  </div>
                </button>

                {/* System Dialog Trigger & Clear controls */}
                <div className="flex gap-1">
                  <button
                    onClick={() => activeThreadId && clearThreadHistory(activeThreadId)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] font-semibold text-zinc-500 hover:text-rose-600 hover:bg-rose-50 border border-zinc-200 hover:border-rose-200 dark:text-zinc-400 dark:hover:text-rose-300 dark:hover:bg-rose-950/20 dark:border-[#2c2d33] dark:hover:border-rose-900/50 transition-colors"
                    title="Clear current workspace chat"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Reset</span>
                  </button>
                  <button
                    onClick={() => setActivityPanelOpen(!activityPanelOpen)}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] font-semibold border transition-colors',
                      activityPanelOpen
                        ? 'text-violet-655 bg-violet-50 border-violet-200 dark:text-violet-400 dark:bg-violet-950/30 dark:border-violet-900/60'
                        : 'text-zinc-500 border-zinc-200 hover:text-zinc-805 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-[#1b1c20] dark:border-[#2c2d33]'
                    )}
                    title="Toggle development log"
                  >
                    <Terminal className="w-3 h-3" />
                    <span>Console</span>
                  </button>
                </div>

                {/* Settings Modal Trigger */}
                <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                  <DialogTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-2 w-full rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-zinc-550 hover:bg-zinc-200/50 dark:hover:bg-[#18191d] hover:text-zinc-800 dark:hover:text-zinc-100 transition-colors"
                    >
                      <div className="w-5.5 h-5.5 rounded bg-zinc-100 border border-zinc-200 dark:bg-[#191a1d] dark:border-[#2c2d33] flex items-center justify-center shrink-0 shadow-sm">
                        <Settings className="w-3 h-3 text-zinc-505" />
                      </div>
                      <span className="flex-1 truncate">Config Panel</span>
                      <ChevronDown className="w-3 h-3 text-zinc-450" />
                    </button>
                  </DialogTrigger>
                  <DialogContent className="bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-850 max-w-md">
                    <DialogHeader>
                      <DialogTitle className="text-zinc-900 dark:text-zinc-50 flex items-center gap-2 font-bold">
                        <Settings className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                        <span>Sandbox Configuration</span>
                      </DialogTitle>
                      <DialogDescription className="text-zinc-550 dark:text-zinc-400 text-xs">
                        Configure local socket endpoints and model resources.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-zinc-450 dark:text-zinc-500 uppercase tracking-wider">Model Node allocation</label>
                        <select
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value)}
                          className="w-full rounded-md border border-zinc-250 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 text-xs text-zinc-800 dark:text-zinc-100 outline-none"
                        >
                          <option value="codex-agent">Codex Standard (Balanced)</option>
                          <option value="codex-agent-deep">Codex Deep Thinker (Thorough)</option>
                          <option value="system-operator">Shell Operator (Direct shell access)</option>
                        </select>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-zinc-200 dark:border-zinc-900">
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-[10px] font-bold text-zinc-450 dark:text-zinc-500 uppercase tracking-wider">Active Codex Session</label>
                          <Badge className="bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 text-[9px] py-0">
                            {activeThread?.sessionId ? activeThread.sessionId.slice(0, 8) : 'New'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="relative min-w-0 flex-1">
                            <KeyRound className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
                            <input
                              value={displayedSessionDraft}
                              onChange={(event) => handleSessionDraftChange(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  handleSaveSessionId();
                                }
                              }}
                              placeholder="Paste Codex session id"
                              spellCheck={false}
                              className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 pl-7 pr-2 py-1.5 text-xs font-mono text-zinc-850 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 outline-none focus:border-violet-300 dark:focus:border-violet-800"
                            />
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={handleSaveSessionId}
                                disabled={!activeThreadId}
                                className="h-8 w-8 rounded-md bg-zinc-900 text-white dark:bg-violet-600 dark:hover:bg-violet-500 flex items-center justify-center hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 text-[10px]">Attach session</TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="text-zinc-450 dark:text-zinc-500 truncate">
                            {activeThread?.sessionId ? 'Saved for this chat. Next message resumes it.' : 'Used when the next message resumes Codex.'}
                          </span>
                          <button
                            type="button"
                            onClick={handleClearSessionId}
                            disabled={!activeThread?.sessionId && !displayedSessionDraft}
                            className="text-rose-600 dark:text-rose-400 hover:underline disabled:text-zinc-400 dark:disabled:text-zinc-700 disabled:no-underline"
                          >
                            Clear
                          </button>
                        </div>
                      </div>

                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* ─── Main Panel (Center) ─────────────────────────────── */}
        <main className="codex-main flex-1 flex flex-col min-w-0 h-full relative z-10">
          {/* Header */}
          <header className="codex-topbar h-14 px-4 border-b flex items-center justify-between shrink-0 transition-colors duration-300">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-205 dark:hover:bg-zinc-900"
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                <Menu className="h-4.5 w-4.5" />
              </Button>
              <div className="flex items-center gap-2">
                <Laptop className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                  <span className="opacity-80">Workspace:</span>
                  <span className="text-zinc-905 dark:text-zinc-50 font-bold bg-zinc-100 dark:bg-[#191a1d] border border-zinc-200 dark:border-[#2c2d33] px-2 py-0.5 rounded">{activeThread?.title}</span>
                </div>
              </div>
            </div>

            {/* Theme switches */}
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-900 transition-colors"
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  >
                    {theme === 'dark' ? (
                      <Sun className="h-4.5 w-4.5 text-amber-500 animate-spin-slow" />
                    ) : (
                      <Moon className="h-4.5 w-4.5 text-indigo-600" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 text-[10px]">
                  {theme === 'dark' ? 'Switch Light mode' : 'Switch Cyber dark'}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'h-8 w-8 transition-colors',
                      activityPanelOpen
                        ? 'text-violet-650 bg-violet-50 border border-violet-200 dark:text-violet-400 dark:bg-violet-950/35 dark:border-violet-900/50'
                        : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-900'
                    )}
                    onClick={() => setActivityPanelOpen(!activityPanelOpen)}
                  >
                    <Terminal className="h-4.5 w-4.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 text-[10px]">Execution Log Panel</TooltipContent>
              </Tooltip>
            </div>
          </header>

          {/* Message view container */}
          <div className="codex-message-viewport flex-1 overflow-y-auto relative z-10" id="messages-viewport">
            {!activeThread || activeThread.messages.length === 0 ? (
              // Empty chat state
              <div className="flex-1 h-full flex flex-col items-center justify-center relative">
                <div className="flex flex-col items-center gap-5 max-w-lg text-center px-6 relative z-10">
                  <div className="relative">
                    <div className="w-14 h-14 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl flex items-center justify-center shadow-lg shadow-zinc-200/50 dark:shadow-black/40 relative group overflow-hidden">
                      <Sparkles className="w-6 h-6 text-violet-600 dark:text-violet-400 animate-pulse relative z-10" />
                      <div className="absolute inset-0 bg-gradient-to-tr from-violet-500/10 to-cyan-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-white dark:border-zinc-950 flex items-center justify-center shadow">
                      <div className="w-1 h-1 bg-zinc-950 rounded-full" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-1.5 justify-center">
                      <span>How can I help?</span>
                    </h2>
                  </div>
                </div>
              </div>
            ) : (
              // Timeline Feed
              <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6 relative z-10">
                <AnimatePresence initial={false}>
                  {timelineFeed.map((item, idx) => {
                    if (item.type === 'message') {
                      const msg = item.data as ChatMessage;
                      const isUser = msg.role === 'user';

                      return (
                        <motion.div
                          key={msg.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ type: 'spring', stiffness: 140, damping: 17 }}
                          className={cn(
                            'flex gap-4',
                            isUser ? 'justify-end' : 'justify-start'
                          )}
                        >
                          {!isUser && (
                            <div className="w-8 h-8 rounded-lg bg-zinc-900 dark:bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-md shrink-0">
                              <Sparkles className="w-4 h-4 text-violet-450" />
                            </div>
                          )}

                          <div className={cn('max-w-[85%] sm:max-w-[80%]')}>
                            <div
                              className={cn(
                                'px-4 py-3 text-sm leading-relaxed border shadow-sm',
                                isUser
                                  ? 'bg-zinc-900 border-zinc-800 text-white rounded-2xl rounded-tr-sm dark:bg-[#2f3033] dark:border-[#3b3c40] dark:text-zinc-50'
                                  : 'bg-zinc-50 border-zinc-200 text-zinc-850 rounded-2xl rounded-tl-sm dark:bg-[#1f2023] dark:border-[#33343a] dark:text-zinc-100'
                              )}
                            >
                              {renderMessageContent(msg, idx)}
                            </div>
                            <div
                              className={cn(
                                'text-[9px] text-zinc-400 dark:text-zinc-400 mt-1 px-1 font-mono',
                                isUser ? 'text-right' : 'text-left'
                              )}
                            >
                              {new Date(msg.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </div>

                          {isUser && (
                            <div className="w-8 h-8 rounded-lg bg-white dark:bg-[#242529] border border-zinc-200 dark:border-[#3a3b40] flex items-center justify-center shrink-0 shadow-sm shadow-zinc-200/50 dark:shadow-none">
                              <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-200 font-mono">DEV</span>
                            </div>
                          )}
                        </motion.div>
                      );
                    } else {
                      // Render Steppers
                      const activityItem = item.data as ActivityItem;
                      const isError = activityItem.status === 'error';
                      const meta = getToolMetadata(activityItem.activity);
                      const isExpanded = !!expandedActivities[activityItem.id];

                      return (
                        <motion.div
                          key={activityItem.id}
                          initial={{ opacity: 0, scale: 0.98 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="pl-12 stepper-item py-1"
                        >
                          <div
                            onClick={() => toggleActivity(activityItem.id)}
                            className={cn(
                              'flex items-center justify-between border-l-2 p-2 rounded-md cursor-pointer select-none transition-all duration-200 text-xs font-mono border shadow-sm',
                              isError
                                ? 'border-l-rose-500 bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/20 dark:text-rose-350 dark:border-rose-900/30'
                                : meta.color
                            )}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {activityItem.status === 'running' ? (
                                <Loader2 className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 animate-spin shrink-0" />
                              ) : isError ? (
                                <X className="w-3.5 h-3.5 text-rose-600 dark:text-rose-500 shrink-0" />
                              ) : (
                                meta.icon
                              )}
                              <span className="font-semibold">{meta.label}:</span>
                              <span className="truncate max-w-[200px] sm:max-w-[320px] text-zinc-500 dark:text-zinc-400 font-normal">
                                {activityItem.command || activityItem.activity.tool || 'System action'}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0 text-zinc-450 dark:text-zinc-500">
                              <span className="text-[9px]">
                                {new Date(activityItem.timestamp).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                })}
                              </span>
                              <ChevronRight
                                className={cn('w-3.5 h-3.5 transition-transform duration-200', isExpanded && 'rotate-90')}
                              />
                            </div>
                          </div>

                          {/* Expandable output shell */}
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="mt-1.5 bg-zinc-950 border border-zinc-850 rounded-lg overflow-hidden shadow-inner text-zinc-300"
                              >
                                <div className="flex items-center justify-between px-3 py-1 bg-zinc-900/80 border-b border-zinc-850/80 text-[9px] text-zinc-550 font-mono">
                                  <span>Stdout Console</span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const text = getActivityText(activityItem);
                                      navigator.clipboard.writeText(text);
                                    }}
                                    className="hover:text-zinc-350 flex items-center gap-1"
                                  >
                                    <Copy className="w-2.5 h-2.5" />
                                    <span>Copy</span>
                                  </button>
                                </div>
                                <pre className="p-3 text-[10.5px] font-mono leading-relaxed text-zinc-300 overflow-x-auto max-h-48 whitespace-pre-wrap">
                                  {getActivityText(activityItem)}
                                </pre>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    }
                  })}
                </AnimatePresence>

                {/* Stream loading indicator */}
                {isSending && !pendingAssistantId && (
                  <div className="flex gap-4 animate-in fade-in-0 duration-200">
                    <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-805 flex items-center justify-center shadow-md shrink-0">
                      <Sparkles className="w-4 h-4 text-violet-400 animate-pulse" />
                    </div>
                    <div className="bg-zinc-50 dark:bg-[#1f2023] border border-zinc-200 dark:border-[#33343a] rounded-2xl rounded-tl-sm px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                        <div className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                        <div className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-500 rounded-full animate-bounce" />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Composer Command Center */}
          <div className="codex-composer border-t px-4 py-3.5 shrink-0 transition-colors duration-300 relative z-25">
            <div className="max-w-3xl mx-auto space-y-2 relative">
              {/* Keyboard Navigable Slash commands suggestion popover */}
              <AnimatePresence>
                {showSlashMenu && filteredSlash.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.98 }}
                    className="absolute bottom-full left-0 mb-2 w-72 rounded-xl slash-palette border overflow-hidden z-30"
                  >
                    <div className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-900 text-[10px] text-zinc-500 dark:text-zinc-400 font-mono border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Command className="w-3.5 h-3.5" />
                        <span>Command Palette</span>
                      </span>
                      <span>Enter ↵</span>
                    </div>
                    <div className="p-1 max-h-48 overflow-y-auto space-y-0.5">
                      {filteredSlash.map((cmd, index) => (
                        <button
                          key={cmd.command}
                          onClick={() => {
                            cmd.action({
                              handleSend,
                              clearThreadHistory,
                              activeThreadId,
                              setSelectedModel,
                              selectedModel,
                              setTheme,
                              theme,
                              setInputValue
                            });
                            setSlashMenuDismissed(true);
                          }}
                          className={cn(
                            'w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left text-xs transition-colors outline-none',
                            index === selectedSlashIndex
                              ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-750 dark:text-violet-300 border border-violet-200/50 dark:border-violet-900/60'
                              : 'text-zinc-650 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 border border-transparent'
                          )}
                        >
                          <div className="shrink-0 mt-0.5">{cmd.icon}</div>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold flex items-center justify-between">
                              <span>{cmd.label}</span>
                              <span className="text-[10px] font-mono opacity-80">{cmd.command}</span>
                            </div>
                            <p className="text-[9.5px] opacity-75 truncate">{cmd.description}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Input Box */}
              <div
                className={cn(
                  'codex-input-box flex items-end gap-2 rounded-xl border px-4 py-2.5 transition-all duration-200 shadow-sm relative overflow-hidden',
                  'focus-within:shadow-md focus-within:shadow-zinc-200/50 dark:focus-within:shadow-black/40'
                )}
              >
                <textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isInitializingActiveSession ? 'Preparing Codex session...' : 'Ask Codex (or type / to command)...'}
                  disabled={isSending || isInitializingActiveSession || connectionStatus !== 'connected'}
                  rows={1}
                  className="flex-1 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-450 dark:placeholder:text-zinc-400 resize-none outline-none max-h-40 min-h-[22px] leading-relaxed relative z-10"
                />

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={isSending ? handleCancelTask : () => handleSend()}
                      disabled={!isSending && (!inputValue.trim() || isInitializingActiveSession || connectionStatus !== 'connected')}
                      className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200 relative z-10',
                        isSending
                          ? 'bg-rose-600 text-white hover:bg-rose-500 active:scale-95 shadow-md shadow-rose-950/30'
                          : inputValue.trim() && connectionStatus === 'connected'
                          ? 'bg-zinc-900 text-white hover:bg-zinc-850 dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500 active:scale-95 shadow-md shadow-violet-950/40'
                           : 'bg-zinc-100 text-zinc-400 dark:bg-[#2a2b30] dark:text-zinc-500 cursor-not-allowed'
                      )}
                    >
                      {isSending ? (
                        <Square className="w-3.5 h-3.5 fill-current" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 text-[10px]">
                        {isSending ? 'Cancel task' : isInitializingActiveSession ? 'Preparing Codex session' : 'Send Execution Directive'}
                  </TooltipContent>
                </Tooltip>
              </div>

            </div>
          </div>
        </main>

        {/* ─── Execution Log Panel (Right Sidebar) ─────────────── */}
        <AnimatePresence initial={false}>
          {activityPanelOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 360, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 26 }}
              className={cn(
                'h-full flex flex-col bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-850 z-20 relative shrink-0',
                isMobile && 'absolute right-0 top-0 bottom-0 shadow-2xl shadow-black/80'
              )}
            >
              {/* Header */}
              <div className="h-14 px-4 border-b border-zinc-200 dark:border-zinc-850 flex items-center justify-between shrink-0 bg-white dark:bg-zinc-950">
                <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-350 font-semibold">
                  <Terminal className="w-4 h-4 text-violet-600 dark:text-violet-400 animate-pulse" />
                  <h3 className="text-xs font-bold uppercase tracking-wider">Console Monitor</h3>
                  {activeThread && activeThread.activities.length > 0 && (
                    <Badge className="text-[9px] h-4.5 bg-zinc-100 border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 px-1">{activeThread.activities.length}</Badge>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-zinc-455 hover:text-zinc-755 dark:text-zinc-500 dark:hover:text-zinc-305 hover:bg-zinc-105 dark:hover:bg-zinc-900"
                  onClick={() => setActivityPanelOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Search and Filters */}
              <div className="p-3 border-b border-zinc-200 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-950/60 space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-zinc-400 dark:text-zinc-550" />
                  <input
                    placeholder="Search outputs..."
                    value={logSearchQuery}
                    onChange={(e) => setLogSearchQuery(e.target.value)}
                    className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-8 py-1.5 text-xs text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-650 outline-none focus:border-zinc-300 dark:focus:border-zinc-750"
                  />
                  {logSearchQuery && (
                    <button
                      onClick={() => setLogSearchQuery('')}
                      className="absolute right-2 top-2.5 text-zinc-400 dark:text-zinc-550 hover:text-zinc-700 dark:hover:text-zinc-350"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Filter Tabs */}
                <div className="flex gap-1">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'commands', label: 'Shell' },
                    { id: 'system', label: 'Sys' },
                    { id: 'errors', label: 'Errors' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setLogFilterLevel(tab.id as typeof logFilterLevel)}
                      className={cn(
                        'flex-1 text-[10px] font-semibold py-1 rounded border transition-colors',
                        logFilterLevel === tab.id
                          ? 'bg-zinc-205 border-zinc-300 text-zinc-800 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-200'
                          : 'text-zinc-450 border-transparent hover:text-zinc-855 hover:bg-zinc-100 dark:text-zinc-500 dark:hover:text-zinc-350 dark:hover:bg-zinc-900/30'
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Log Stream Terminal */}
              <div
                ref={activityListRef}
                className="flex-1 overflow-y-auto p-3 bg-zinc-955 font-mono text-[10px] space-y-1.5 scrollbar-thin scrollbar-thumb-zinc-850"
              >
                {getFilteredActivities().length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center gap-2.5 py-12 text-zinc-600">
                    <MonitorPlay className="w-8 h-8 opacity-30" />
                    <p className="text-[10px] uppercase tracking-wider font-semibold">No Console Logs</p>
                    <p className="text-[10px] text-zinc-650 max-w-[200px] leading-relaxed">
                      Execution commands and standard output streams will route here.
                    </p>
                  </div>
                ) : (
                  getFilteredActivities().map((item) => {
                    const text = getActivityText(item);
                    const isError = item.status === 'error';
                    const isRunning = item.status === 'running';
                    const isSuccess = item.status === 'success';

                    return (
                      <div
                        key={item.id}
                        className={cn(
                          'px-2 py-1.5 rounded transition-colors log-line flex flex-col gap-1',
                          isError && 'bg-rose-955/15 border-l-2 border-rose-500/60',
                          isRunning && 'bg-amber-955/15 border-l-2 border-amber-500/60',
                          isSuccess && 'bg-emerald-955/15 border-l-2 border-emerald-500/60'
                        )}
                      >
                        <div className="flex items-center justify-between text-[9px] text-zinc-505">
                          <span className="font-semibold text-zinc-400">
                            {item.activity.tool || 'system_event'}
                          </span>
                          <span>
                            {new Date(item.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </span>
                        </div>
                        <div
                          className={cn(
                            'break-all whitespace-pre-wrap leading-relaxed',
                            isError ? 'text-rose-450 dark:text-rose-400' : isRunning ? 'text-amber-450 dark:text-amber-400' : 'text-zinc-350 dark:text-zinc-300'
                          )}
                        >
                          {text}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* ─── Mobile Overlays ────────────────────────────────── */}
        {isMobile && sidebarOpen && (
          <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setSidebarOpen(false)} />
        )}
        {isMobile && activityPanelOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-40"
            onClick={() => setActivityPanelOpen(false)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
