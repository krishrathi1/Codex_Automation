export type AgentStatus = 'ONLINE' | 'IDLE' | 'OFFLINE' | 'ERROR';
export type ActivityType = 'HEARTBEAT' | 'TASK_START' | 'TASK_COMPLETE' | 'ERROR' | 'MESSAGE' | 'DELEGATION' | 'ALERT' | 'SYSTEM';
export type TaskStatus = 'BACKLOG' | 'ASSIGNED' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Severity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface Agent {
  id: string;
  name: string;
  displayName: string;
  workspace: string;
  description: string;
  status: AgentStatus;
  lastHeartbeat: string | null;
  heartbeatInterval: number;
  currentTask: string | null;
  avatar: string | null;
  enabled: boolean;
  soulMd: string | null;
  gatewayId: string | null;
  gatewayAgentId: string | null;
  boardId: string | null;
  isBoardLead: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { activities: number; tasks: number };
  activities?: Activity[];
  tasks?: Task[];
  gateway?: Gateway;
}

export interface Activity {
  id: string;
  agentId: string;
  type: ActivityType;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  agent: {
    name: string;
    displayName: string;
    avatar: string | null;
  };
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
  agent: {
    id: string;
    name: string;
    displayName: string;
    avatar: string | null;
  } | null;
}

export interface AgentStats {
  total: number;
  online: number;
  idle: number;
  offline: number;
  error: number;
  recentActivities: number;
  activeTasks: number;
}

// Inter-agent communication
export interface Thread {
  id: string;
  title: string | null;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  threadId: string;
  senderId: string;
  receiverId: string;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  sender: { id: string; name: string; displayName: string; avatar: string | null };
  receiver: { id: string; name: string; displayName: string; avatar: string | null };
}

// Sessions & Timeline
export interface Session {
  id: string;
  agentId: string;
  type: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  status: string;
  summary: string | null;
  tokensUsed: number | null;
  cost: number | null;
  agent?: { id: string; name: string; displayName: string; avatar: string | null };
}

// Cost & Tokens
export interface TokenUsage {
  id: string;
  agentId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
  cost: number;
  createdAt: string;
}

// Performance Metrics
export interface MetricSnapshot {
  id: string;
  agentId: string;
  responseTimeMs: number;
  success: boolean;
  errorMessage: string | null;
  toolName: string | null;
  createdAt: string;
}

// Alerts
export interface AlertRule {
  id: string;
  name: string;
  description: string | null;
  agentId: string | null;
  condition: string;
  threshold: number | null;
  windowMinutes: number;
  enabled: boolean;
  lastTriggered: string | null;
  createdAt: string;
  agent?: { id: string; name: string; displayName: string; avatar: string | null } | null;
  events?: AlertEvent[];
  _count?: { events: number };
}

export interface AlertEvent {
  id: string;
  alertRuleId: string;
  message: string;
  severity: Severity;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  createdAt: string;
  alertRule?: AlertRule;
}

// Human-in-the-loop commands
export interface Command {
  id: string;
  agentId: string;
  type: string;
  payload: Record<string, unknown> | null;
  status: string;
  issuedBy: string | null;
  createdAt: string;
  agent?: { id: string; name: string; displayName: string; avatar: string | null };
}

// Communication graph edge
export interface CommEdge {
  source: string;
  target: string;
  messageCount: number;
  lastMessage: string;
}

// Organization & Auth
export interface Organization {
  id: string;
  name: string;
  slug: string;
  settings?: Record<string, unknown>;
  createdAt: string;
}

export interface OrgMember {
  id: string;
  organizationId: string;
  userId: string;
  user: { id: string; email: string; name: string };
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  createdAt: string;
}

export interface OrgApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

// MCP Servers & Tools
export interface McpServer {
  id: string;
  agentId: string;
  name: string;
  url: string;
  transport: 'SSE' | 'STREAMABLE_HTTP';
  enabled: boolean;
  lastConnected: string | null;
  tools?: McpTool[];
  createdAt: string;
}

export interface McpTool {
  id: string;
  mcpServerId: string;
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown> | null;
  createdAt: string;
}

// Gateways
export type GatewayStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';

export interface Gateway {
  id: string;
  name: string;
  url: string;
  workspaceRoot: string;
  status: GatewayStatus;
  hasToken: boolean;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { agents: number };
}

export interface GatewayHealth {
  status: string;
  connected: boolean;
  details?: Record<string, unknown>;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
}

// Chat
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface ChatHistory {
  sessionKey: string;
  messages: ChatMessage[];
}

export interface ChatResponse {
  status: string;
  result?: string;
  summary?: string;
}

// Workspace Files
export interface WorkspaceFile {
  name: string;
  path: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
  content?: string;
}

// LLM Providers
export type LlmProviderMode = 'BYOK' | 'PLATFORM';

export interface LlmProvider {
  id: string;
  provider: string;
  mode: LlmProviderMode;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UsageCredit {
  id: string;
  balanceCents: number;
  totalSpentCents: number;
  lastTopUpAt: string | null;
}

// Boards
export interface Board {
  id: string;
  name: string;
  slug: string;
  description: string;
  gatewayId: string | null;
  boardGroupId: string | null;
  boardType: string;
  objective: string | null;
  successMetrics: Record<string, unknown> | null;
  targetDate: string | null;
  maxAgents: number;
  requireApprovalForDone: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { tasks: number; agents: number; approvals: number };
  tasks?: Task[];
  agents?: Agent[];
}

export interface BoardGroup {
  id: string;
  name: string;
  slug: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  _count?: { boards: number };
  boards?: Board[];
}

// Approvals
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Approval {
  id: string;
  boardId: string;
  taskId: string | null;
  agentId: string | null;
  actionType: string;
  payload: Record<string, unknown> | null;
  confidence: number | null;
  status: ApprovalStatus;
  resolvedAt: string | null;
  createdAt: string;
  board?: Board;
  task?: Task | null;
  agent?: Agent | null;
}

// Board Memory
export interface BoardMemory {
  id: string;
  boardId: string;
  content: string;
  tags: string[] | null;
  isChat: boolean;
  source: string | null;
  createdAt: string;
}
