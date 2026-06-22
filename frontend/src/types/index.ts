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
  agentToAgent: boolean;
  identityProfile?: Record<string, unknown> | null;
  soulTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { activities: number; tasks: number };
  activities?: Activity[];
  tasks?: Task[];
  agentSkills?: AgentSkill[];
  integrations?: AgentIntegration[];
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
  boardId: string | null;
  createdAt: string;
  updatedAt: string;
  agent: {
    id: string;
    name: string;
    displayName: string;
    avatar: string | null;
  } | null;
  fingerprintHash?: string | null;
  tags?: TagAssignment[];
  customFieldValues?: TaskCustomFieldValue[];
  duplicateOf?: { id: string; title: string; status: TaskStatus } | null;
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
  kind?: 'admin_agent' | 'admin_mother' | 'agent_agent' | 'mother_observation' | 'system';
  label?: string;
  messageCount: number;
  lastMessage: string;
  boardId?: string | null;
  boardName?: string | null;
  threadIds?: string[];
  codexSessionIds?: string[];
  sessionIds?: string[];
  activeRunIds?: string[];
  queuedRunIds?: string[];
  failedRunIds?: string[];
  taskIds?: string[];
  recentMessages?: Array<{
    id: string;
    role?: string;
    content: string;
    createdAt: string;
    threadId: string;
    codexSessionId?: string;
    nexusSessionId?: string;
    requestId?: string;
  }>;
  observationLinks?: Array<{
    type: 'task' | 'session' | 'context' | 'run_job';
    id: string;
    label: string;
    status?: string;
  }>;
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
  version?: string;
  uptime?: number;
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
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface PlatformIntegrationSettings {
  github: {
    configured: boolean;
    tokenMasked: string | null;
    repo: string | null;
    branch: string | null;
    updatedAt: string | null;
  };
  vercel: {
    configured: boolean;
    tokenMasked: string | null;
    teamId: string | null;
    updatedAt: string | null;
  };
}

export interface GithubRepositorySummary {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  defaultBranch: string;
  ownerLogin: string;
  updatedAt: string | null;
}

export interface VercelProjectSummary {
  id: string;
  name: string;
  framework: string | null;
  accountId: string | null;
  repo: string | null;
  productionUrl: string | null;
  updatedAt: string | null;
}

export interface ChatHistory {
  sessionKey: string;
  messages: ChatMessage[];
}

export interface ChatResponse {
  status: string;
  result?: string;
  summary?: string;
  runtime?: string;
  sessionId?: string;
  codexSessionId?: string | null;
  usage?: Record<string, unknown> | null;
}

export interface AgentDesignProposalAgent {
  displayName: string;
  role: string;
  persona: string;
}

export interface AgentDesignProposal {
  group: {
    name?: string;
    objective?: string;
    description?: string;
    mode?: 'continuous' | 'sprint' | 'goal';
    maxAgents?: number;
  };
  agents: AgentDesignProposalAgent[];
}

export interface MotherChatContext {
  generatedAt: string;
  scope?: {
    type: 'organization' | 'board';
    board: {
      id: string;
      name: string;
      slug: string;
      description: string;
      objective: string | null;
      boardType: string;
    } | null;
  };
  counts: {
    agents: number;
    runningSessions: number;
    activeTasks: number;
    recentMessages: number;
    recentActivities: number;
    recentErrors: number;
    pendingApprovals: number;
    tokensInWindow: number;
    activeRunJobs?: number;
    queuedRunJobs?: number;
    runningRunJobs?: number;
    failedRunJobs?: number;
    productionErrors?: number;
    activeProductionErrors?: number;
    blackboardConversations?: number;
    activeBlackboardConversations?: number;
    blackboardEvents?: number;
  };
  agents: Array<{
    id: string;
    name: string;
    displayName: string;
    status: AgentStatus;
    enabled: boolean;
    currentTask: string | null;
    lastHeartbeat: string | null;
    boardId: string | null;
    codexSessionId: string | null;
    updatedAt: string;
  }>;
  sessions: Array<{
    id: string;
    agent: string;
    type: string;
    status: string;
    summary: string | null;
    startedAt: string;
    endedAt: string | null;
    durationMs: number | null;
    tokensUsed: number | null;
  }>;
  messages: Array<{
    id: string;
    threadId?: string;
    from: string;
    to: string;
    content: string;
    conversationKind?: string | null;
    boardId?: string | null;
    taskIds?: string[];
    createdAt: string;
  }>;
  activities: Array<{
    id: string;
    agent: string;
    type: ActivityType;
    message: string;
    createdAt: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: TaskStatus;
    priority: Priority;
    agent: string;
    board: string | null;
    updatedAt: string;
  }>;
  agentRunJobs?: Array<{
    id: string;
    status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
    agent: string;
    agentId: string;
    board: string | null;
    boardId: string | null;
    task: string | null;
    taskId: string | null;
	    prompt: string;
	    summary: string | null;
	    output?: string | null;
	    error: string | null;
	    codexSessionId: string | null;
	    nexusSessionId: string | null;
	    workflowId?: string | null;
	    workflowStepNumber?: number | null;
	    workflowTotalSteps?: number | null;
	    workflowFinalStep?: boolean;
	    attempt: number;
    queuedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
    updatedAt: string;
  }>;
  productionErrors?: Array<{
    id: string;
    source: string;
    severity: string;
    title: string;
    message: string;
    status: 'RECEIVED' | 'TASK_CREATED' | 'DEBUG_QUEUED' | 'REVIEW_QUEUED' | 'APPROVED' | 'REJECTED' | 'COMMIT_QUEUED' | 'COMPLETED' | 'FAILED';
    fingerprint: string;
    board: string | null;
    boardId: string | null;
    task: string | null;
    taskId: string | null;
    taskStatus: TaskStatus | null;
    debugRunJobId: string | null;
    reviewRunJobId: string | null;
    commitRunJobId: string | null;
    resolvedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  blackboardConversations?: Array<{
    id: string;
    boardId: string;
    threadId: string | null;
    title: string;
    goal: string | null;
    status: string;
    currentRound: number;
    maxRounds: number;
    completedReason: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  blackboardEvents?: Array<{
    id: string;
    type: string;
    from: string;
    to: string;
    senderAgentId: string | null;
    receiverAgentId: string | null;
    runJobId: string | null;
    taskId: string | null;
    content: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
  tokenUsage: Array<{
    id: string;
    agent: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
    createdAt: string;
  }>;
  errors: Array<{
    source: string;
    agent: string;
    message: string;
    createdAt: string;
  }>;
  approvals: Array<{
    id: string;
    status: ApprovalStatus;
    actionType: string;
    agent: string | null;
    task: string | null;
    board: string;
    createdAt: string;
  }>;
}

export interface LiveBlackboardTraceJob {
  id: string;
  agentId: string;
  agentName: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  round: number | null;
  prompt: string;
  reconstructedPrompt: string | null;
  output: string | null;
  summary: string | null;
  error: string | null;
  codexSessionId: string | null;
  nexusSessionId: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

export interface LiveBlackboardTrace {
  generatedAt: string;
  board: {
    id: string;
    name: string;
    slug: string;
    objective: string | null;
    maxAgents: number;
  };
  agents: Array<{
    id: string;
    displayName: string;
    description: string;
    status: AgentStatus;
    isBoardLead: boolean;
  }>;
  conversations: Array<{
    id: string;
    title: string;
    goal: string | null;
    status: string;
    currentRound: number;
    maxRounds: number;
    maxObservedRound: number;
    completedReason: string | null;
    createdAt: string;
    updatedAt: string;
    events: Array<{
      id: string;
      type: string;
      from: string;
      to: string;
      senderAgentId: string | null;
      receiverAgentId: string | null;
      runJobId: string | null;
      taskId: string | null;
      content: string;
      metadata: Record<string, unknown>;
      createdAt: string;
      round: number | null;
      linkedJob: LiveBlackboardTraceJob | null;
    }>;
    jobs: LiveBlackboardTraceJob[];
  }>;
}

export interface MotherChatDiagnostics {
  agentRuntime: string;
  configuredCommand: {
    envName: string;
    value: string;
    expandedValue: string;
    mustBeFilePath: boolean;
  } | null;
  expectedMacosCommand: string;
  selectedCommand: string | null;
  cwd: string;
  sandbox: string;
  skipGitRepoCheck: boolean;
  dangerouslyBypassApprovalsAndSandbox: boolean;
  installation: {
    ok: boolean;
    command: string | null;
    version?: string;
    details: string;
  };
  authentication: {
    ok: boolean;
    command: string | null;
    details: string;
  };
  loggedIn: boolean;
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
  requireReviewBeforeDone: boolean;
  blockStatusChangesWithPendingApproval: boolean;
  onlyLeadCanChangeStatus: boolean;
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

// ─── Tags ────────────────────────────────────────────

export interface Tag {
  id: string;
  name: string;
  slug: string;
  color: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { assignments: number };
}

export interface TagAssignment {
  id: string;
  taskId: string;
  tagId: string;
  tag: Tag;
  createdAt: string;
}

// ─── Task Fingerprints ──────────────────────────────

export interface TaskFingerprint {
  id: string;
  boardId: string;
  fingerprintHash: string;
  taskId: string;
  createdAt: string;
}

// ─── Custom Fields ──────────────────────────────────

export type CustomFieldType = 'TEXT' | 'TEXT_LONG' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN' | 'DATE' | 'DATE_TIME' | 'URL' | 'JSON';
export type CustomFieldVisibility = 'ALWAYS' | 'IF_SET' | 'HIDDEN';

export interface TaskCustomFieldDefinition {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: CustomFieldType;
  uiVisibility: CustomFieldVisibility;
  validationRegex: string | null;
  defaultValue: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { boardFields: number; values: number };
}

export interface BoardTaskCustomField {
  id: string;
  boardId: string;
  definitionId: string;
  definition: TaskCustomFieldDefinition;
  createdAt: string;
}

export interface TaskCustomFieldValue {
  id: string;
  taskId: string;
  definitionId: string;
  definition: TaskCustomFieldDefinition;
  value: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Skills Marketplace ─────────────────────────────

export interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  risk: string;
  sourceUrl: string | null;
  metadata: Record<string, unknown> | null;
  installedGatewayIds: string[];
  isInstalled?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SkillPack {
  id: string;
  name: string;
  description: string;
  sourceUrl: string;
  branch: string;
  metadata: Record<string, unknown> | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayInstalledSkill {
  id: string;
  gatewayId: string;
  skillId: string;
  createdAt: string;
}

export interface AgentSkill {
  id: string;
  agentId: string;
  skillId: string;
  customName: string | null;
  customDescription: string | null;
  customConfig: Record<string, unknown> | null;
  enabled: boolean;
  skill: MarketplaceSkill;
  createdAt: string;
  updatedAt: string;
}

// ─── Agent Integrations ─────────────────────────────

export type ChannelType = 'TELEGRAM' | 'SLACK' | 'GOOGLE_CHAT';

export interface AgentIntegration {
  id: string;
  agentId: string;
  channel: ChannelType;
  enabled: boolean;
  botToken: string | null;
  appToken: string | null;
  serviceAccount: Record<string, unknown> | null;
  webhookUrl: string | null;
  dmPolicy: string;
  groupPolicy: string;
  status: string;
  lastError: string | null;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Board Webhooks ─────────────────────────────────

export interface BoardWebhook {
  id: string;
  boardId: string;
  agentId: string | null;
  description: string;
  secret: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  agent?: { id: string; displayName: string; avatar: string | null } | null;
  _count?: { payloads: number };
}

export interface BoardWebhookPayload {
  id: string;
  webhookId: string;
  payload: unknown;
  headers: Record<string, string> | null;
  sourceIp: string | null;
  contentType: string | null;
  receivedAt: string;
}

// ─── Board Onboarding ───────────────────────────────

export type OnboardingStatus = 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';

export interface BoardOnboardingSession {
  id: string;
  boardId: string;
  sessionKey: string;
  status: OnboardingStatus;
  messages: Array<{ role: string; content: string; timestamp: string }>;
  draftGoal: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Board Group Memory ─────────────────────────────

export interface BoardGroupMemory {
  id: string;
  boardGroupId: string;
  content: string;
  tags: string[] | null;
  isChat: boolean;
  source: string | null;
  createdAt: string;
}

// ─── Organization Invites ───────────────────────────

export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

export interface OrgInvite {
  id: string;
  organizationId: string;
  invitedEmail: string;
  token: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  status: InviteStatus;
  allBoardsRead: boolean;
  allBoardsWrite: boolean;
  createdByUserId: string | null;
  acceptedByUserId: string | null;
  acceptedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  boardAccess?: OrgInviteBoardAccess[];
}

export interface OrgInviteBoardAccess {
  id: string;
  inviteId: string;
  boardId: string;
  canRead: boolean;
  canWrite: boolean;
}

// ─── Soul Templates ─────────────────────────────────

export interface SoulTemplate {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}
