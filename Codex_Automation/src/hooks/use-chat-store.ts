import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface StreamActivity {
  type: 'tool_use' | 'tool_result' | 'system' | 'unknown';
  tool?: string;
  input?: Record<string, unknown>;
  toolUseId?: string;
  content?: unknown;
  isError?: boolean;
  subtype?: string;
  data?: unknown;
  raw?: unknown;
}

export interface ActivityItem {
  id: string;
  activity: StreamActivity;
  status: 'running' | 'success' | 'error' | 'system';
  command?: string;
  timestamp: number;
}

export interface ChatThread {
  id: string;
  title: string;
  sessionId?: string;
  messages: ChatMessage[];
  activities: ActivityItem[];
  model: string;
  createdAt: number;
}

export interface ConnectionConfig {
  name: string;
  url: string;
}

interface ChatStore {
  threads: ChatThread[];
  activeThreadId: string | null;
  connections: ConnectionConfig[];
  activeConnectionUrl: string;
  selectedModel: string;
  
  // Actions
  createThread: (title?: string) => string;
  deleteThread: (id: string) => void;
  renameThread: (id: string, title: string) => void;
  setActiveThreadId: (id: string | null) => void;
  updateThreadMessages: (threadId: string, messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  updateThreadActivities: (threadId: string, activities: ActivityItem[] | ((prev: ActivityItem[]) => ActivityItem[])) => void;
  updateThreadSessionId: (threadId: string, sessionId: string | undefined) => void;
  clearThreadHistory: (threadId: string) => void;
  
  // Connections
  addConnection: (connection: ConnectionConfig) => void;
  deleteConnection: (url: string) => void;
  setActiveConnectionUrl: (url: string) => void;
  
  // Model selection
  setSelectedModel: (model: string) => void;
}

const DEFAULT_CONNECTIONS: ConnectionConfig[] = [
  { name: 'Local Codex Socket (Port 3003)', url: 'http://localhost:3003' },
  { name: 'Standard Port Gateway', url: '/?XTransformPort=3003' }
];

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      threads: [],
      activeThreadId: null,
      connections: DEFAULT_CONNECTIONS,
      activeConnectionUrl: 'http://localhost:3003',
      selectedModel: 'codex-agent',

      createThread: (title) => {
        const id = Math.random().toString(36).slice(2, 11);
        const newThread: ChatThread = {
          id,
          title: title || `Conversation ${get().threads.length + 1}`,
          messages: [],
          activities: [],
          model: get().selectedModel,
          createdAt: Date.now(),
        };

        set((state) => ({
          threads: [newThread, ...state.threads],
          activeThreadId: id,
        }));

        return id;
      },

      deleteThread: (id) => {
        set((state) => {
          const newThreads = state.threads.filter((t) => t.id !== id);
          let newActiveId = state.activeThreadId;
          if (state.activeThreadId === id) {
            newActiveId = newThreads.length > 0 ? newThreads[0].id : null;
          }
          return {
            threads: newThreads,
            activeThreadId: newActiveId,
          };
        });
      },

      renameThread: (id, title) => {
        set((state) => ({
          threads: state.threads.map((t) => (t.id === id ? { ...t, title } : t)),
        }));
      },

      setActiveThreadId: (id) => {
        set({ activeThreadId: id });
      },

      updateThreadMessages: (threadId, messagesUpdater) => {
        set((state) => ({
          threads: state.threads.map((t) => {
            if (t.id === threadId) {
              const updatedMessages = typeof messagesUpdater === 'function' 
                ? messagesUpdater(t.messages) 
                : messagesUpdater;
              return { ...t, messages: updatedMessages };
            }
            return t;
          }),
        }));
      },

      updateThreadActivities: (threadId, activitiesUpdater) => {
        set((state) => ({
          threads: state.threads.map((t) => {
            if (t.id === threadId) {
              const updatedActivities = typeof activitiesUpdater === 'function' 
                ? activitiesUpdater(t.activities) 
                : activitiesUpdater;
              return { ...t, activities: updatedActivities };
            }
            return t;
          }),
        }));
      },

      updateThreadSessionId: (threadId, sessionId) => {
        set((state) => ({
          threads: state.threads.map((t) =>
            t.id === threadId ? { ...t, sessionId } : t
          ),
        }));
      },

      clearThreadHistory: (threadId) => {
        set((state) => ({
          threads: state.threads.map((t) =>
            t.id === threadId ? { ...t, messages: [], activities: [], sessionId: undefined } : t
          ),
        }));
      },

      addConnection: (connection) => {
        set((state) => {
          if (state.connections.some((c) => c.url === connection.url)) {
            return state; // Duplicate URL
          }
          return {
            connections: [...state.connections, connection],
          };
        });
      },

      deleteConnection: (url) => {
        set((state) => {
          const newConnections = state.connections.filter((c) => c.url !== url);
          let activeUrl = state.activeConnectionUrl;
          if (activeUrl === url) {
            activeUrl = newConnections.length > 0 ? newConnections[0].url : 'http://localhost:3003';
          }
          return {
            connections: newConnections,
            activeConnectionUrl: activeUrl,
          };
        });
      },

      setActiveConnectionUrl: (url) => {
        set({ activeConnectionUrl: url });
      },

      setSelectedModel: (model) => {
        set({ selectedModel: model });
      },
    }),
    {
      name: 'blostem-codex-chat-store-v2',
      partialize: (state) => ({
        threads: state.threads,
        activeThreadId: state.activeThreadId,
        connections: state.connections,
        activeConnectionUrl: state.activeConnectionUrl,
        selectedModel: state.selectedModel,
      }),
    }
  )
);
