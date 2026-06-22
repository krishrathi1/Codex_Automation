import type { Agent, AgentStats, Activity, Task, Thread, Message, Session, TokenUsage, MetricSnapshot, AlertRule, AlertEvent, Command, ChatHistory, ChatResponse, MotherChatContext, MotherChatDiagnostics, WorkspaceFile, Board, BoardGroup, Approval, Tag, TagAssignment, TaskCustomFieldDefinition, BoardTaskCustomField, TaskCustomFieldValue, MarketplaceSkill, SkillPack, AgentSkill, AgentIntegration, BoardWebhook, BoardWebhookPayload, BoardOnboardingSession, BoardGroupMemory, OrgInvite, SoulTemplate, CommEdge, LiveBlackboardTrace, PlatformIntegrationSettings, GithubRepositorySummary, VercelProjectSummary, SigNozLog, AgentDesignProposal } from '../types';
import { useAuthStore } from '../stores/auth-store';
import { AUTH_DISABLED } from './auth-mode';

const BASE_URL = '/api';

// Mutex to prevent concurrent token refresh calls
let refreshPromise: Promise<boolean> | null = null;

async function readApiError(res: Response) {
  const fallback = `API error: ${res.status} ${res.statusText}`;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => null) as { error?: unknown; message?: unknown; details?: unknown } | null;
    const message = typeof data?.error === 'string'
      ? data.error
      : typeof data?.message === 'string'
        ? data.message
        : typeof data?.details === 'string'
          ? data.details
          : null;
    return message || fallback;
  }

  const text = await res.text().catch(() => '');
  return text.trim() || fallback;
}

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
    if (!refreshPromise) {
      const authPath = AUTH_DISABLED ? '/auth/dev-login' : '/auth/refresh';
      refreshPromise = fetch(`${BASE_URL}${authPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      }).then(async (refreshRes) => {
        if (refreshRes.ok) {
          const data = await refreshRes.json();
          useAuthStore.getState().setAccessToken(data.accessToken);
          return true;
        }
        if (!AUTH_DISABLED) {
          useAuthStore.getState().clearAuth();
        }
        return false;
      }).finally(() => {
        refreshPromise = null;
      });
    }

    const refreshed = await refreshPromise;
    if (refreshed) {
      const { accessToken } = useAuthStore.getState();
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(`${BASE_URL}${path}`, {
        ...options,
        credentials: 'include',
        headers: { ...headers, ...options?.headers },
      });
    } else {
      throw new Error(AUTH_DISABLED ? 'Backend unavailable' : 'Session expired');
    }
  }

  if (!res.ok) throw new Error(await readApiError(res));
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
    throw new Error(await readApiError(res));
  }
  return res.json();
}

export const api = {
  auth: {
    signup: (data: { email: string; password: string; name: string; orgName: string }) =>
      requestPublic<{ user: { id: string; email: string; name: string }; requiresVerification: boolean }>('/auth/signup', { method: 'POST', body: JSON.stringify(data) }),
    login: (data: { email: string; password: string }) =>
      requestPublic('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
    verifyEmail: (token: string) =>
      requestPublic<{ message: string }>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),
    resendVerification: (email: string) =>
      requestPublic<{ message: string }>('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) }),
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
	    integrationSettings: () => request<PlatformIntegrationSettings>('/org/integrations/settings'),
	    updateIntegrationSettings: (data: {
	      githubAccessToken?: string | null;
	      clearGithubAccessToken?: boolean;
		      githubRepo?: string | null;
		      githubBranch?: string | null;
	      vercelAccessToken?: string | null;
	      clearVercelAccessToken?: boolean;
	      vercelTeamId?: string | null;
      signozApiKey?: string | null;
      clearSignozApiKey?: boolean;
      signozEndpoint?: string | null;
	    }) => request<PlatformIntegrationSettings>('/org/integrations/settings', { method: 'PUT', body: JSON.stringify(data) }),
	    githubRepos: () => request<GithubRepositorySummary[]>('/org/integrations/github/repos'),
	    vercelProjects: () => request<VercelProjectSummary[]>('/org/integrations/vercel/projects'),
    signozCheck: () => request<{ ok: boolean; detail: string }>('/org/integrations/signoz/check'),
    signozLogs: (params?: { severity?: string; search?: string; sinceMs?: number; limit?: number }) => {
      const q = new URLSearchParams();
      if (params?.severity) q.set('severity', params.severity);
      if (params?.search) q.set('search', params.search);
      if (params?.sinceMs) q.set('sinceMs', String(params.sinceMs));
      if (params?.limit) q.set('limit', String(params.limit));
      const qs = q.toString();
      return request<{ logs: SigNozLog[] }>(`/signoz/logs${qs ? `?${qs}` : ''}`);
    },
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
    toggleA2a: (id: string, enabled: boolean) =>
      request<Agent>(`/agents/${id}/a2a`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
    listSkills: (id: string) => request<AgentSkill[]>(`/agents/${id}/skills`),
    assignSkills: (id: string, skillIds: string[]) =>
      request<AgentSkill[]>(`/agents/${id}/skills`, { method: 'POST', body: JSON.stringify({ skillIds }) }),
    updateSkill: (id: string, skillId: string, data: Record<string, unknown>) =>
      request<AgentSkill>(`/agents/${id}/skills/${skillId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    removeSkill: (id: string, skillId: string) =>
      request<void>(`/agents/${id}/skills/${skillId}`, { method: 'DELETE' }),
    // Integrations
    listIntegrations: (id: string) =>
      request<AgentIntegration[]>(`/agents/${id}/integrations`),
    getIntegration: (id: string, channel: string) =>
      request<AgentIntegration>(`/agents/${id}/integrations/${channel}`),
    upsertIntegration: (id: string, channel: string, data: Record<string, unknown>) =>
      request<AgentIntegration>(`/agents/${id}/integrations/${channel}`, { method: 'PUT', body: JSON.stringify(data) }),
    toggleIntegration: (id: string, channel: string, enabled: boolean) =>
      request<AgentIntegration>(`/agents/${id}/integrations/${channel}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
    deleteIntegration: (id: string, channel: string) =>
      request<void>(`/agents/${id}/integrations/${channel}`, { method: 'DELETE' }),
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
    clear: (params?: { agentId?: string; type?: string }) => {
      const query = new URLSearchParams();
      if (params?.agentId) query.set('agentId', params.agentId);
      if (params?.type) query.set('type', params.type);
      const qs = query.toString();
      return request<{ count: number }>(`/activities${qs ? `?${qs}` : ''}`, { method: 'DELETE' });
    },
  },
  tasks: {
    list: () => request<Task[]>('/tasks'),
    create: (data: { title: string; description?: string; status?: string; priority?: string; agentId?: string; boardId?: string }) =>
      request<Task>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Task>) =>
      request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  },
  threads: {
    list: () => request<Thread[]>('/threads'),
    get: (id: string) => request<Thread>(`/threads/${id}`),
    graph: (params?: { boardId?: string }) => {
      const query = new URLSearchParams();
      if (params?.boardId) query.set('boardId', params.boardId);
      const qs = query.toString();
      return request<{ nodes: Array<{ id: string; name: string; displayName: string; avatar: string | null; status: string; kind?: string; boardId?: string | null; boardName?: string | null; currentTask?: string | null; codexSessionId?: string; activeRunIds?: string[]; taskIds?: string[] }>; edges: CommEdge[] }>(`/threads/graph${qs ? `?${qs}` : ''}`);
    },
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
  chat: {
    history: (agentId: string) => request<ChatHistory>(`/agents/${agentId}/chat/history`),
    send: (agentId: string, message: string, requestId?: string) =>
      request<ChatResponse>(`/agents/${agentId}/chat`, { method: 'POST', body: JSON.stringify({ message, requestId }) }),
  },
  motherChat: {
    context: (boardId?: string) => {
      const qs = boardId ? `?boardId=${encodeURIComponent(boardId)}` : '';
      return request<MotherChatContext>(`/mother-chat/context${qs}`);
    },
    diagnostics: () => request<MotherChatDiagnostics>('/mother-chat/diagnostics'),
    history: (boardId?: string) => {
      const qs = boardId ? `?boardId=${encodeURIComponent(boardId)}` : '';
      return request<ChatHistory>(`/mother-chat/history${qs}`);
    },
    send: (message: string, requestId?: string, boardId?: string) =>
      request<ChatResponse>('/mother-chat/message', { method: 'POST', body: JSON.stringify({ message, requestId, boardId }) }),
    clearHistory: (boardId?: string) => {
      const qs = boardId ? `?boardId=${encodeURIComponent(boardId)}` : '';
      return request<{ cleared: number }>(`/mother-chat/history${qs}`, { method: 'DELETE' });
    },
  },
  agentDesigner: {
    message: (messages: { role: 'user' | 'assistant'; content: string }[]) =>
      request<{ reply: string; proposal?: AgentDesignProposal }>(
        '/agent-designer/message',
        { method: 'POST', body: JSON.stringify({ messages }) },
      ),
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
    delete: (id: string, options?: { deleteScopedData?: boolean }) => {
      const qs = options?.deleteScopedData ? '?deleteScopedData=true' : '';
      return request<void>(`/boards/${id}${qs}`, { method: 'DELETE' });
    },
    startCollaboration: (id: string, data: {
      goal?: string;
      agents?: Array<{
        agentId?: string;
        name?: string;
        displayName?: string;
        role?: string;
        work?: string;
        avatar?: string;
        isLead?: boolean;
      }>;
    }) =>
      request<{ board: Board; goal: string; agents: Agent[]; tasks: Task[]; thread: Thread; messages: Message[] }>(
        `/boards/${id}/collaboration/start`,
        { method: 'POST', body: JSON.stringify(data) },
      ),
    dispatchToAgents: (id: string, data: { query: string; priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }) =>
      request<{ board: Board; query: string; agents: Agent[]; tasks: Task[]; thread: Thread; messages: Message[] }>(
        `/boards/${id}/collaboration/dispatch`,
        { method: 'POST', body: JSON.stringify(data) },
      ),
    startLiveWorkflow: (id: string, data: {
      goal?: string;
      trigger: string;
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    }) =>
      request<{ board: Board; workflowId: string; goal: string; trigger: string; agents: Agent[]; tasks: Task[]; thread: Thread; messages: Message[]; runJobs: unknown[] }>(
        `/boards/${id}/collaboration/live-workflow/start`,
        { method: 'POST', body: JSON.stringify(data) },
      ),
    startLiveBlackboard: (id: string, data: {
      goal?: string;
      trigger: string;
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      maxRounds?: number;
    }) =>
      request<{ board: Board; conversationId: string; goal: string; trigger: string; agents: Agent[]; tasks: Task[]; thread: Thread; messages: Message[]; runJobs: unknown[] }>(
        `/boards/${id}/collaboration/live-blackboard/start`,
        { method: 'POST', body: JSON.stringify(data) },
      ),
    liveBlackboardTrace: (id: string, conversationId?: string) => {
      const qs = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : '';
      return request<LiveBlackboardTrace>(`/boards/${id}/live-blackboard/trace${qs}`);
    },
	    addAgent: (id: string, data: { agentId: string; isLead?: boolean; integrationAccess?: Record<string, unknown> }) =>
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
  // ─── Mission Control Features ──────────────────────
  tags: {
    list: () => request<Tag[]>('/tags'),
    create: (data: { name: string; color?: string; description?: string }) =>
      request<Tag>('/tags', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { name?: string; color?: string; description?: string }) =>
      request<Tag>(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/tags/${id}`, { method: 'DELETE' }),
    assign: (taskId: string, tagIds: string[]) =>
      request<TagAssignment[]>('/tags/assign', { method: 'POST', body: JSON.stringify({ taskId, tagIds }) }),
  },
  customFields: {
    list: () => request<TaskCustomFieldDefinition[]>('/custom-fields'),
    create: (data: { fieldKey: string; label: string; fieldType?: string; uiVisibility?: string; validationRegex?: string; defaultValue?: string }) =>
      request<TaskCustomFieldDefinition>('/custom-fields', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Record<string, unknown>) =>
      request<TaskCustomFieldDefinition>(`/custom-fields/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/custom-fields/${id}`, { method: 'DELETE' }),
    attach: (id: string, boardIds: string[]) =>
      request<BoardTaskCustomField[]>(`/custom-fields/${id}/attach`, { method: 'POST', body: JSON.stringify({ boardIds }) }),
    boardFields: (boardId: string) => request<BoardTaskCustomField[]>(`/custom-fields/boards/${boardId}`),
    setValue: (taskId: string, definitionId: string, value: string) =>
      request<TaskCustomFieldValue>('/custom-fields/values', { method: 'POST', body: JSON.stringify({ taskId, definitionId, value }) }),
    getValues: (taskId: string) => request<TaskCustomFieldValue[]>(`/custom-fields/values/${taskId}`),
  },
  skills: {
    marketplace: (gatewayId?: string) => request<MarketplaceSkill[]>(`/skills/marketplace${gatewayId ? `?gatewayId=${gatewayId}` : ''}`),
    createSkill: (data: { name: string; description?: string; category?: string; risk?: string; sourceUrl?: string }) =>
      request<MarketplaceSkill>('/skills/marketplace', { method: 'POST', body: JSON.stringify(data) }),
    install: (skillId: string, gatewayId: string) =>
      request('/skills/marketplace/' + skillId + '/install', { method: 'POST', body: JSON.stringify({ gatewayId }) }),
    uninstall: (skillId: string, gatewayId: string) =>
      request('/skills/marketplace/' + skillId + '/uninstall', { method: 'POST', body: JSON.stringify({ gatewayId }) }),
    packs: () => request<SkillPack[]>('/skills/packs'),
    createPack: (data: { name: string; description?: string; sourceUrl: string; branch?: string }) =>
      request<SkillPack>('/skills/packs', { method: 'POST', body: JSON.stringify(data) }),
    syncPack: (packId: string) =>
      request('/skills/packs/' + packId + '/sync', { method: 'POST' }),
  },
  webhooks: {
    list: (boardId: string) => request<BoardWebhook[]>(`/boards/${boardId}/webhooks`),
    create: (boardId: string, data: { description?: string; agentId?: string; enabled?: boolean }) =>
      request<BoardWebhook>(`/boards/${boardId}/webhooks`, { method: 'POST', body: JSON.stringify(data) }),
    update: (boardId: string, webhookId: string, data: { description?: string; agentId?: string | null; enabled?: boolean }) =>
      request<BoardWebhook>(`/boards/${boardId}/webhooks/${webhookId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (boardId: string, webhookId: string) =>
      request<void>(`/boards/${boardId}/webhooks/${webhookId}`, { method: 'DELETE' }),
    payloads: (boardId: string, webhookId: string, limit?: number) =>
      request<BoardWebhookPayload[]>(`/boards/${boardId}/webhooks/${webhookId}/payloads${limit ? `?limit=${limit}` : ''}`),
    payload: (boardId: string, webhookId: string, payloadId: string) =>
      request<BoardWebhookPayload>(`/boards/${boardId}/webhooks/${webhookId}/payloads/${payloadId}`),
  },
  onboarding: {
    start: (boardId: string) =>
      request<BoardOnboardingSession>(`/boards/${boardId}/onboarding/start`, { method: 'POST' }),
    message: (boardId: string, sessionId: string, content: string) =>
      request<BoardOnboardingSession>(`/boards/${boardId}/onboarding/message`, { method: 'POST', body: JSON.stringify({ sessionId, content }) }),
    get: (boardId: string) => request<BoardOnboardingSession | null>(`/boards/${boardId}/onboarding`),
    confirm: (boardId: string, sessionId: string) =>
      request<BoardOnboardingSession>(`/boards/${boardId}/onboarding/confirm`, { method: 'POST', body: JSON.stringify({ sessionId }) }),
  },
  boardGroupMemory: {
    list: (groupId: string, limit?: number) =>
      request<BoardGroupMemory[]>(`/board-groups/${groupId}/memory${limit ? `?limit=${limit}` : ''}`),
    add: (groupId: string, data: { content: string; tags?: string[]; isChat?: boolean; source?: string }) =>
      request<BoardGroupMemory>(`/board-groups/${groupId}/memory`, { method: 'POST', body: JSON.stringify(data) }),
    delete: (groupId: string, memoryId: string) =>
      request<void>(`/board-groups/${groupId}/memory/${memoryId}`, { method: 'DELETE' }),
  },
  soulTemplates: {
    list: (category?: string) => request<SoulTemplate[]>(`/soul-templates${category ? `?category=${category}` : ''}`),
    get: (id: string) => request<SoulTemplate>(`/soul-templates/${id}`),
    create: (data: { name: string; category?: string; description?: string; content: string }) =>
      request<SoulTemplate>('/soul-templates', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Record<string, unknown>) =>
      request<SoulTemplate>(`/soul-templates/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/soul-templates/${id}`, { method: 'DELETE' }),
    search: (q: string) => request<SoulTemplate[]>(`/soul-templates/search?q=${encodeURIComponent(q)}`),
  },
  invites: {
    list: () => request<OrgInvite[]>('/org/invites'),
    create: (data: { invitedEmail: string; role?: string; allBoardsRead?: boolean; allBoardsWrite?: boolean }) =>
      request<OrgInvite>('/org/invites', { method: 'POST', body: JSON.stringify(data) }),
    revoke: (id: string) => request<void>(`/org/invites/${id}`, { method: 'DELETE' }),
    accept: (token: string) => request('/org/invites/' + token + '/accept', { method: 'POST' }),
  },
};
