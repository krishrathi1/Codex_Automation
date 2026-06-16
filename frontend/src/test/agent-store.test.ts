import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAgentStore } from '../stores/agent-store';

vi.mock('../lib/api', () => ({
  api: {
    agents: {
      list: vi.fn(),
      stats: vi.fn(),
      get: vi.fn(),
    },
  },
}));

function resetAgentStore() {
  useAgentStore.setState({
    agents: [],
    stats: null,
    selectedAgent: null,
    loading: false,
    error: null,
  });
}

describe('Agent Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAgentStore();
  });

  it('handles agent list failures without rejecting', async () => {
    vi.mocked(api.agents.list).mockRejectedValue(new Error('Backend unavailable'));

    await expect(useAgentStore.getState().fetchAgents()).resolves.toBeUndefined();

    const state = useAgentStore.getState();
    expect(state.loading).toBe(false);
    expect(state.agents).toEqual([]);
    expect(state.error).toBe('Backend unavailable');
  });
});
