import type { Agent, AgentStats, Activity, Task, Thread, Message, Session, TokenUsage, MetricSnapshot, AlertRule, AlertEvent, Command, Gateway, GatewayHealth, ModelInfo, ChatHistory, ChatResponse, WorkspaceFile, LlmProvider, UsageCredit, Board, BoardGroup, Approval } from '../types';
import { useAuthStore } from '../stores/auth-store';

const BASE_URL = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { accessToken } = useAuthStore.getState();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  let res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: 'include', // send httpOnly cookies
    headers: { ...headers, ...options?.headers },
  });

  // On 401, try to refresh token via httpOnly cookie and retry once
  if (res.status === 401) {
    const refreshRes = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // refresh token is in httpOnly cookie
    });
    if (refreshRes.ok) {
      const data = await refreshRes.json();
      useAuthStore.getState().setAccessToken(data.accessToken);
      headers['Authorization'] = `Bearer ${data.accessToken}`;
      res = await fetch(`${BASE_URL}${path}`, {
        ...options,
        credentials: 'include',
        headers: { ...headers, ...options?.headers },
      });
    } else {
      useAuthStore.getState().clearAuth();
      window.location.href = '/login';
      throw new Error('Session expired');
    }
  }

  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

// For public endpoints (no auth needed)
async function requestPublic<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // receive httpOnly cookies from login/signup
    ...options,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(data.error || `API error: ${res.status}`);
  }
  return res.json();
}

export const api = {
  auth: {
    signup: (data: { email: string; password: string; name: string; orgName: string }) =>
      requestPublic('/auth/signup', { method: 'POST', body: JSON.stringify(data) }),
    login: (data: { email: string; password: string }) =>
      requestPublic('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
    refresh: () =>
      requestPublic('/auth/refresh', { method: 'POST' }),
    me: () => request('/auth/me'),
  },
  org: {
    get: () => request('/org'),
    update: (data: Record<string, unknown>) => request('/org', { method: 'PATCH', body: JSON.stringify(data) }),
    members: () => request('/org/members'),
    invite: (email: string, role: string) =>
      request('/org/members/invite', { method: 'POST', body: JSON.stringify({ email, role }) }),
    updateMemberRole: (id: string, role: string) =>
      request(`/org/members/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
    removeMember: (id: string) => request(`/org/members/${id}`, { method: 'DELETE' }),
    apiKeys: () => request('/org/api-keys'),
    createApiKey: (name: string) => request('/org/api-keys', { method: 'POST', body: JSON.stringify({ name }) }),
    revokeApiKey: (id: string) => request(`/org/api-keys/${id}`, { method: 'DELETE' }),
  },
  agents: {
    list: () => request<Agent[]>('/agents'),
    get: (id: string) => request<Agent>(`/agents/${id}`),
    stats: () => request<AgentStats>('/agents/stats'),
    updateConfig: (id: string, data: { soulMd?: string; enabled?: boolean; heartbeatInterval?: number }) =>
      request<Agent>(`/agents/${id}/config`, { method: 'PATCH', body: JSON.stringify(data) }),
    create: (data: Record<string, unknown>) => request('/agents', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Record<string, unknown>) =>
      request(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/agents/${id}`, { method: 'DELETE' }),
  },
  mcp: {
    list: (agentId: string) => request(`/agents/${agentId}/mcp-servers`),
    add: (agentId: string, data: Record<string, unknown>) =>
      request(`/agents/${agentId}/mcp-servers`, { method: 'POST', body: JSON.stringify(data) }),
    update: (agentId: string, serverId: string, data: Record<string, unknown>) =>
      request(`/agents/${agentId}/mcp-servers/${serverId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (agentId: string, serverId: string) =>
      request(`/agents/${agentId}/mcp-servers/${serverId}`, { method: 'DELETE' }),
    refreshTools: (agentId: string, serverId: string) =>
      request(`/agents/${agentId}/mcp-servers/${serverId}/refresh-tools`, { method: 'POST' }),
    tools: (agentId: string, serverId: string) =>
      request(`/agents/${agentId}/mcp-servers/${serverId}/tools`),
  },
  activities: {
    list: (params?: { agentId?: string; type?: string; limit?: number; offset?: number }) => {
      const query = new URLSearchParams();
      if (params?.agentId) query.set('agentId', params.agentId);
      if (params?.type) query.set('type', params.type);
      if (params?.limit) query.set('limit', String(params.limit));
      if (params?.offset) query.set('offset', String(params.offset));
      const qs = query.toString();
      return request<{ activities: Activity[]; total: number }>(`/activities${qs ? `?${qs}` : ''}`);
    },
    search: (query: string, params?: { agentId?: string; type?: string; limit?: number }) => {
      const q = new URLSearchParams({ q: query });
      if (params?.agentId) q.set('agentId', params.agentId);
      if (params?.type) q.set('type', params.type);
      if (params?.limit) q.set('limit', String(params.limit));
      return request<{ activities: Activity[]; total: number }>(`/activities/search?${q.toString()}`);
    },
  },
  tasks: {
    list: () => request<Task[]>('/tasks'),
    create: (data: { title: string; description?: string; priority?: string; agentId?: string }) =>
      request<Task>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Task>) =>
      request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  },
  threads: {
    list: () => request<Thread[]>('/threads'),
    get: (id: string) => request<Thread>(`/threads/${id}`),
    graph: () => request<{ nodes: Array<{ id: string; name: string; displayName: string; avatar: string | null; status: string }>; edges: Array<{ source: string; target: string; messageCount: number; lastMessage: string }> }>('/threads/graph'),
  },
  sessions: {
    list: (params?: { agentId?: string; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.agentId) query.set('agentId', params.agentId);
      if (params?.limit) query.set('limit', String(params.limit));
      const qs = query.toString();
      return request<Session[]>(`/sessions${qs ? `?${qs}` : ''}`);
    },
    timeline: () => request<{ timeline: Array<{ agent: { id: string; name: string; displayName: string; avatar: string | null; status: string }; sessions: Session[] }>; windowStart: string; windowEnd: string }>('/sessions/timeline'),
  },
  tokens: {
    usage: (params?: { agentId?: string; hours?: number }) => {
      const query = new URLSearchParams();
      if (params?.agentId) query.set('agentId', params.agentId);
      if (params?.hours) query.set('hours', String(params.hours));
      const qs = query.toString();
      return request<TokenUsage[]>(`/tokens${qs ? `?${qs}` : ''}`);
    },
    summary: () => request<{ totalTokens: number; totalCost: number; byAgent: Array<{ agentId: string; agentName: string; displayName: string; avatar: string; totalTokens: number; totalCost: number }> }>('/tokens/summary'),
  },
  metrics: {
    list: (params?: { agentId?: string; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.agentId) query.set('agentId', params.agentId);
      if (params?.limit) query.set('limit', String(params.limit));
      const qs = query.toString();
      return request<MetricSnapshot[]>(`/metrics${qs ? `?${qs}` : ''}`);
    },
    summary: () => request<{ byAgent: Array<{ agentId: string; agentName: string; displayName: string; avatar: string; avgResponseTime: number; p95ResponseTime: number; successRate: number; totalCalls: number }> }>('/metrics/summary'),
  },
  alerts: {
    rules: () => request<AlertRule[]>('/alerts/rules'),
    createRule: (data: Partial<AlertRule>) =>
      request<AlertRule>('/alerts/rules', { method: 'POST', body: JSON.stringify(data) }),
    updateRule: (id: string, data: Partial<AlertRule>) =>
      request<AlertRule>(`/alerts/rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    events: (params?: { acknowledged?: boolean; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.acknowledged !== undefined) query.set('acknowledged', String(params.acknowledged));
      if (params?.limit) query.set('limit', String(params.limit));
      const qs = query.toString();
      return request<AlertEvent[]>(`/alerts/events${qs ? `?${qs}` : ''}`);
    },
    acknowledge: (id: string) =>
      request<AlertEvent>(`/alerts/events/${id}/acknowledge`, { method: 'POST' }),
  },
  commands: {
    send: (data: { agentId: string; type: string; payload?: Record<string, unknown> }) =>
      request<Command>('/commands', { method: 'POST', body: JSON.stringify(data) }),
    list: (agentId?: string) => {
      const qs = agentId ? `?agentId=${agentId}` : '';
      return request<Command[]>(`/commands${qs}`);
    },
  },
  gateways: {
    list: () => request<Gateway[]>('/gateways'),
    get: (id: string) => request<Gateway>(`/gateways/${id}`),
    create: (data: { name: string; url: string; token: string; workspaceRoot?: string }) =>
      request<Gateway>('/gateways', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<{ name: string; url: string; token: string; workspaceRoot: string }>) =>
      request<Gateway>(`/gateways/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/gateways/${id}`, { method: 'DELETE' }),
    health: (id: string) => request<GatewayHealth>(`/gateways/${id}/health`),
    models: (id: string) => request<ModelInfo[]>(`/gateways/${id}/models`),
    sessions: (id: string) => request<unknown>(`/gateways/${id}/sessions`),
  },
  chat: {
    history: (agentId: string) => request<ChatHistory>(`/agents/${agentId}/chat/history`),
    send: (agentId: string, message: string) =>
      request<ChatResponse>(`/agents/${agentId}/chat`, { method: 'POST', body: JSON.stringify({ message }) }),
  },
  files: {
    list: (agentId: string) => request<WorkspaceFile[]>(`/agents/${agentId}/files`),
    get: (agentId: string, name: string) => request<WorkspaceFile>(`/agents/${agentId}/files/${encodeURIComponent(name)}`),
    update: (agentId: string, name: string, content: string) =>
      request<WorkspaceFile>(`/agents/${agentId}/files/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify({ content }) }),
  },
  boards: {
    list: () => request<Board[]>('/boards'),
    get: (id: string) => request<Board>(`/boards/${id}`),
    create: (data: Record<string, unknown>) =>
      request<Board>('/boards', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Record<string, unknown>) =>
      request<Board>(`/boards/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/boards/${id}`, { method: 'DELETE' }),
    addAgent: (id: string, data: { agentId: string; isLead?: boolean }) =>
      request<Agent>(`/boards/${id}/agents`, { method: 'POST', body: JSON.stringify(data) }),
    removeAgent: (id: string, agentId: string) =>
      request<void>(`/boards/${id}/agents/${agentId}`, { method: 'DELETE' }),
  },
  boardGroups: {
    list: () => request<BoardGroup[]>('/boards/groups'),
    create: (data: { name: string; description?: string }) =>
      request<BoardGroup>('/boards/groups', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { name?: string; description?: string }) =>
      request<BoardGroup>(`/boards/groups/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/boards/groups/${id}`, { method: 'DELETE' }),
  },
  approvals: {
    list: (params?: { boardId?: string; status?: string; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.boardId) query.set('boardId', params.boardId);
      if (params?.status) query.set('status', params.status);
      if (params?.limit) query.set('limit', String(params.limit));
      const qs = query.toString();
      return request<Approval[]>(`/approvals${qs ? `?${qs}` : ''}`);
    },
    stats: () => request<{ pending: number; approved: number; rejected: number; total: number }>('/approvals/stats'),
    get: (id: string) => request<Approval>(`/approvals/${id}`),
    approve: (id: string) => request<Approval>(`/approvals/${id}/approve`, { method: 'POST' }),
    reject: (id: string) => request<Approval>(`/approvals/${id}/reject`, { method: 'POST' }),
    create: (data: { boardId: string; taskId?: string; agentId?: string; actionType: string; payload?: Record<string, unknown>; confidence?: number }) =>
      request<Approval>('/approvals', { method: 'POST', body: JSON.stringify(data) }),
  },
  agentTokens: {
    generate: (agentId: string) =>
      request<{ token: string }>(`/agents/${agentId}/token`, { method: 'POST' }),
  },
  llmProviders: {
    list: () => request<LlmProvider[]>('/llm-providers'),
    upsert: (data: { provider: string; mode: string; apiKey?: string }) =>
      request<LlmProvider>('/llm-providers', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/llm-providers/${id}`, { method: 'DELETE' }),
    test: (id: string) => request<{ success: boolean; message: string }>(`/llm-providers/${id}/test`, { method: 'POST' }),
    usage: () => request<{ credit: UsageCredit | null; providers: LlmProvider[] }>('/llm-providers/usage'),
  },
};
