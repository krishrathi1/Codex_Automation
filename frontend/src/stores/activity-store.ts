import { create } from 'zustand';
import type { Activity, ActivityType } from '../types';
import { api } from '../lib/api';

interface ActivityStore {
  activities: Activity[];
  total: number;
  loading: boolean;
  filterAgent: string | null;
  filterType: ActivityType | null;
  fetchActivities: (params?: { agentId?: string; type?: string; limit?: number }) => Promise<void>;
  clearActivities: () => Promise<void>;
  addActivity: (activity: Activity) => void;
  setFilterAgent: (agentId: string | null) => void;
  setFilterType: (type: ActivityType | null) => void;
}

export const useActivityStore = create<ActivityStore>((set, get) => ({
  activities: [],
  total: 0,
  loading: false,
  filterAgent: null,
  filterType: null,

  fetchActivities: async (params) => {
    set({ loading: true });
    const result = await api.activities.list({ limit: 100, ...params });
    set({ activities: result.activities, total: result.total, loading: false });
  },

  clearActivities: async () => {
    const { filterAgent, filterType } = get();
    set({ loading: true });
    await api.activities.clear({
      agentId: filterAgent || undefined,
      type: filterType || undefined,
    });
    set({ activities: [], total: 0, loading: false });
  },

  addActivity: (activity) => {
    set((state) => ({
      activities: [activity, ...state.activities].slice(0, 200),
      total: state.total + 1,
    }));
  },

  setFilterAgent: (agentId) => set({ filterAgent: agentId }),
  setFilterType: (type) => set({ filterType: type }),
}));
