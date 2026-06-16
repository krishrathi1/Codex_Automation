import { create } from 'zustand';
import type { Agent, AgentStats } from '../types';
import { api } from '../lib/api';

interface AgentStore {
  agents: Agent[];
  stats: AgentStats | null;
  selectedAgent: Agent | null;
  loading: boolean;
  error: string | null;
  fetchAgents: () => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchAgent: (id: string) => Promise<void>;
  updateAgent: (agent: Partial<Agent> & { id: string }) => void;
  removeAgent: (id: string) => void;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  stats: null,
  selectedAgent: null,
  loading: false,
  error: null,

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const agents = await api.agents.list();
      set({ agents, loading: false, error: null });
    } catch (error) {
      set({ loading: false, error: errorMessage(error, 'Failed to load agents') });
    }
  },

  fetchStats: async () => {
    try {
      const stats = await api.agents.stats();
      set({ stats, error: null });
    } catch (error) {
      set({ error: errorMessage(error, 'Failed to load agent stats') });
    }
  },

  fetchAgent: async (id: string) => {
    try {
      const agent = await api.agents.get(id);
      set({ selectedAgent: agent, error: null });
    } catch (error) {
      set({ error: errorMessage(error, 'Failed to load agent') });
    }
  },

  updateAgent: (updated) => {
    set((state) => ({
      agents: state.agents.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)),
      selectedAgent: state.selectedAgent?.id === updated.id ? { ...state.selectedAgent, ...updated } : state.selectedAgent,
    }));
  },

  removeAgent: (id) => {
    set((state) => ({
      agents: state.agents.filter((agent) => agent.id !== id),
      selectedAgent: state.selectedAgent?.id === id ? null : state.selectedAgent,
    }));
  },
}));
