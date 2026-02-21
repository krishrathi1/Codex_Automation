import { PrismaClient, AgentStatus, ActivityType, TaskStatus, Priority, Severity } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';

const prisma = new PrismaClient();

const agents = [
  { name: 'main', displayName: 'Main Bot', workspace: '~/.openclaw/workspace/', description: 'Primary Telegram assistant, delegates to specialist agents', heartbeatInterval: 0, avatar: '🤖', status: AgentStatus.ONLINE, soulMd: '# Main Bot\nYou are the primary assistant. You receive user messages via Telegram and delegate tasks to specialist agents.\n\n## Responsibilities\n- Respond to user queries\n- Delegate tasks to specialist agents\n- Coordinate multi-agent workflows\n- Provide status updates' },
  { name: 'core-engineer', displayName: 'Core Engineer', workspace: '~/agents/core-engineer/', description: 'Backend engineer, analyzes auth and core system code', heartbeatInterval: 30, avatar: '🔧', status: AgentStatus.ONLINE, soulMd: '# Core Engineer\nYou are a backend engineer specializing in authentication and core system code.\n\n## Skills\n- Code analysis and debugging\n- Auth middleware expertise\n- Database optimization\n- Security review' },
  { name: 'external-engineer', displayName: 'External Engineer', workspace: '~/agents/external-engineer/', description: 'Integrations engineer, manages external web systems', heartbeatInterval: 30, avatar: '🌐', status: AgentStatus.IDLE, soulMd: '# External Engineer\nYou are an integrations engineer managing external services and APIs.\n\n## Skills\n- Webhook management\n- Third-party API integration\n- Payment system integration\n- External service monitoring' },
  { name: 'log-monitor', displayName: 'Log Monitor', workspace: '~/agents/log-monitor/', description: 'Read-only observer, monitors via SigNoz and EagleEye', heartbeatInterval: 5, avatar: '📊', status: AgentStatus.ONLINE, soulMd: '# Log Monitor\nYou are a read-only observer that monitors system logs.\n\n## Tools\n- SigNoz log queries\n- EagleEye pattern detection\n- Error rate tracking\n- Anomaly alerting' },
  { name: 'pr-reviewer', displayName: 'PR Reviewer', workspace: '~/agents/pr-reviewer/', description: 'Code reviewer, interfaces with Bitbucket API', heartbeatInterval: 30, avatar: '🔍', status: AgentStatus.IDLE, soulMd: '# PR Reviewer\nYou review pull requests for code quality and correctness.\n\n## Process\n- Check for security issues\n- Verify coding standards\n- Review test coverage\n- Provide constructive feedback' },
  { name: 'server-health', displayName: 'Server Health', workspace: '~/agents/server-health/', description: 'Sysadmin agent, monitors CPU, memory, disk, and services', heartbeatInterval: 5, avatar: '🖥️', status: AgentStatus.ONLINE, soulMd: '# Server Health\nYou monitor server infrastructure health.\n\n## Checks\n- CPU usage and load average\n- Memory utilization\n- Disk space and I/O\n- Service status and uptime\n- Network connectivity' },
  { name: 'project-manager', displayName: 'Project Manager', workspace: '~/agents/project-manager/', description: 'PM agent, manages tickets via Plane', heartbeatInterval: 30, avatar: '📋', status: AgentStatus.ONLINE, soulMd: '# Project Manager\nYou manage project tasks and coordinate the team.\n\n## Responsibilities\n- Track sprint progress\n- Assign tasks to agents\n- Generate daily summaries\n- Escalate blocked items' },
];

const sampleActivities = [
  { agentName: 'log-monitor', type: ActivityType.HEARTBEAT, message: 'Heartbeat check — all systems nominal', minutesAgo: 2 },
  { agentName: 'server-health', type: ActivityType.HEARTBEAT, message: 'Server health check complete — CPU 23%, Memory 61%, Disk 45%', minutesAgo: 3 },
  { agentName: 'core-engineer', type: ActivityType.TASK_COMPLETE, message: 'Completed analysis of auth middleware refactor', minutesAgo: 8 },
  { agentName: 'main', type: ActivityType.DELEGATION, message: 'Delegated log investigation to log-monitor', minutesAgo: 12 },
  { agentName: 'log-monitor', type: ActivityType.ALERT, message: 'Elevated error rate detected in payment service — 12 errors in last 5 minutes', minutesAgo: 15 },
  { agentName: 'project-manager', type: ActivityType.HEARTBEAT, message: 'Checked Plane board — 3 tickets in progress, 1 blocked', minutesAgo: 18 },
  { agentName: 'pr-reviewer', type: ActivityType.TASK_START, message: 'Reviewing PR #247: Add rate limiting to API endpoints', minutesAgo: 22 },
  { agentName: 'server-health', type: ActivityType.HEARTBEAT, message: 'Server health check complete — CPU 31%, Memory 58%, Disk 45%', minutesAgo: 25 },
  { agentName: 'external-engineer', type: ActivityType.TASK_COMPLETE, message: 'Updated webhook integration for Stripe payment notifications', minutesAgo: 30 },
  { agentName: 'core-engineer', type: ActivityType.HEARTBEAT, message: 'Heartbeat — scanning for new assignments', minutesAgo: 32 },
  { agentName: 'main', type: ActivityType.MESSAGE, message: 'Responded to user query about deployment status', minutesAgo: 35 },
  { agentName: 'log-monitor', type: ActivityType.HEARTBEAT, message: 'Heartbeat check — 2 warnings in auth service logs', minutesAgo: 37 },
  { agentName: 'project-manager', type: ActivityType.DELEGATION, message: 'Assigned bug ticket BLS-142 to core-engineer', minutesAgo: 40 },
  { agentName: 'server-health', type: ActivityType.ALERT, message: 'Disk usage approaching threshold — 78% on /data volume', minutesAgo: 45 },
  { agentName: 'pr-reviewer', type: ActivityType.TASK_COMPLETE, message: 'PR #245 approved — authentication flow improvements', minutesAgo: 50 },
  { agentName: 'core-engineer', type: ActivityType.TASK_START, message: 'Starting work on BLS-142: Fix session expiry race condition', minutesAgo: 55 },
  { agentName: 'log-monitor', type: ActivityType.ERROR, message: 'Connection to SigNoz temporarily lost — retrying in 30s', minutesAgo: 62 },
  { agentName: 'main', type: ActivityType.DELEGATION, message: 'Delegated server check to server-health after user report', minutesAgo: 70 },
  { agentName: 'external-engineer', type: ActivityType.HEARTBEAT, message: 'Heartbeat — monitoring external API health', minutesAgo: 75 },
  { agentName: 'project-manager', type: ActivityType.SYSTEM, message: 'Daily standup summary generated — 5 tasks completed, 2 blocked', minutesAgo: 90 },
];

const sampleTasks = [
  { title: 'Fix session expiry race condition', description: 'BLS-142: Sessions are expiring prematurely under concurrent load', status: TaskStatus.IN_PROGRESS, priority: Priority.HIGH, agentName: 'core-engineer' },
  { title: 'Review PR #247: Rate limiting', description: 'Add rate limiting to public API endpoints', status: TaskStatus.IN_PROGRESS, priority: Priority.MEDIUM, agentName: 'pr-reviewer' },
  { title: 'Investigate elevated error rate', description: 'Payment service showing 12 errors in last 5 minutes', status: TaskStatus.ASSIGNED, priority: Priority.CRITICAL, agentName: 'log-monitor' },
  { title: 'Update Stripe webhook integration', description: 'Add support for new payment intent events', status: TaskStatus.DONE, priority: Priority.MEDIUM, agentName: 'external-engineer' },
  { title: 'Disk cleanup on /data volume', description: 'Usage at 78%, need to archive old logs', status: TaskStatus.ASSIGNED, priority: Priority.HIGH, agentName: 'server-health' },
  { title: 'Refactor auth middleware', description: 'Consolidate JWT validation across services', status: TaskStatus.REVIEW, priority: Priority.MEDIUM, agentName: 'core-engineer' },
  { title: 'Add monitoring for Redis cluster', description: 'Set up alerts for Redis memory and connection pool', status: TaskStatus.BACKLOG, priority: Priority.LOW, agentName: null },
  { title: 'Update API documentation', description: 'Document new endpoints added in sprint 14', status: TaskStatus.BACKLOG, priority: Priority.LOW, agentName: null },
  { title: 'Implement SSO for admin dashboard', description: 'Add SAML-based SSO for enterprise clients', status: TaskStatus.BACKLOG, priority: Priority.MEDIUM, agentName: null },
  { title: 'Performance audit on search API', description: 'Response times degraded 20% since last deploy', status: TaskStatus.ASSIGNED, priority: Priority.HIGH, agentName: 'core-engineer' },
];

const sampleThreads = [
  {
    title: 'Payment Error Investigation',
    messages: [
      { from: 'main', to: 'log-monitor', content: 'Users are reporting payment failures. Can you check the logs for the last 30 minutes?', minutesAgo: 45 },
      { from: 'log-monitor', to: 'main', content: 'Found 12 errors in payment service. Stack traces point to a timeout in the Stripe webhook handler. Forwarding details to external-engineer.', minutesAgo: 43 },
      { from: 'log-monitor', to: 'external-engineer', content: 'Payment webhook handler is timing out. Error: "ETIMEDOUT connecting to api.stripe.com". Seeing this across multiple requests since 14:22 UTC.', minutesAgo: 42 },
      { from: 'external-engineer', to: 'log-monitor', content: 'Investigating. This looks like a DNS resolution issue. The Stripe API endpoint is resolving correctly from my end but the webhook retry queue is backed up. I\'ll increase the timeout and add a circuit breaker.', minutesAgo: 38 },
      { from: 'external-engineer', to: 'main', content: 'Issue identified: webhook handler timeout due to DNS resolution delays. I\'ve implemented a fix with connection pooling and circuit breaker. Payment processing should normalize within 5 minutes.', minutesAgo: 30 },
      { from: 'main', to: 'external-engineer', content: 'Great work. Users are confirming payments are going through again. Please update the ticket on Plane.', minutesAgo: 25 },
    ],
  },
  {
    title: 'BLS-142 Bug Assignment',
    messages: [
      { from: 'project-manager', to: 'core-engineer', content: 'New critical bug: BLS-142 — Session expiry race condition. Users are getting logged out randomly during active sessions. Can you take this?', minutesAgo: 60 },
      { from: 'core-engineer', to: 'project-manager', content: 'Accepted. I\'ll start investigating the session middleware. Initial hypothesis: the Redis TTL and JWT expiry are out of sync under concurrent requests.', minutesAgo: 55 },
      { from: 'core-engineer', to: 'project-manager', content: 'Confirmed: found the race condition. When two requests arrive simultaneously, the session refresh can fail if the old session is deleted before the new one is written. Working on a fix with atomic Redis operations.', minutesAgo: 35 },
      { from: 'project-manager', to: 'core-engineer', content: 'Good find. This is blocking 3 other tickets. How long for the fix?', minutesAgo: 33 },
      { from: 'core-engineer', to: 'project-manager', content: 'Fix is ready. I\'ll submit a PR in 10 minutes. The solution uses WATCH/MULTI/EXEC for atomic session updates.', minutesAgo: 20 },
      { from: 'core-engineer', to: 'pr-reviewer', content: 'PR #248 ready for review: Fix session expiry race condition (BLS-142). Uses atomic Redis transactions. Please prioritize — this is blocking 3 other tickets.', minutesAgo: 15 },
      { from: 'pr-reviewer', to: 'core-engineer', content: 'Looking at it now. Initial impression looks good — the atomic approach is the right call. Will have full review done in 15 minutes.', minutesAgo: 12 },
    ],
  },
  {
    title: 'Server Health Alert',
    messages: [
      { from: 'server-health', to: 'main', content: 'Alert: Disk usage on /data volume has reached 78%. Recommended action: archive old log files and increase volume size.', minutesAgo: 50 },
      { from: 'main', to: 'project-manager', content: 'Server health flagged disk usage at 78%. Can you create a task for this?', minutesAgo: 48 },
      { from: 'project-manager', to: 'server-health', content: 'Created task: "Disk cleanup on /data volume". Assigned to you. Priority: HIGH. Please handle log rotation and report back.', minutesAgo: 46 },
      { from: 'server-health', to: 'project-manager', content: 'Starting cleanup. Found 12GB of rotated logs older than 30 days. Archiving to S3 and removing local copies.', minutesAgo: 40 },
    ],
  },
  {
    title: 'Daily Standup Coordination',
    messages: [
      { from: 'project-manager', to: 'core-engineer', content: 'Daily standup: What did you accomplish yesterday and what\'s planned for today?', minutesAgo: 120 },
      { from: 'core-engineer', to: 'project-manager', content: 'Yesterday: Completed auth middleware analysis, identified 3 optimization points. Today: Working on BLS-142 session race condition fix.', minutesAgo: 118 },
      { from: 'project-manager', to: 'external-engineer', content: 'Daily standup: Status update?', minutesAgo: 120 },
      { from: 'external-engineer', to: 'project-manager', content: 'Yesterday: Updated Stripe webhook integration, added retry logic. Today: Monitoring payment flow stability, will work on API documentation if stable.', minutesAgo: 115 },
      { from: 'project-manager', to: 'main', content: 'Standup summary: 2/5 sprint tasks completed. core-engineer on critical bug fix, external-engineer monitoring payments. No blockers besides BLS-142.', minutesAgo: 110 },
    ],
  },
];

function generateSessions(agentId: string, organizationId: string, agentName: string) {
  const sessions: Array<{ agentId: string; organizationId: string; type: string; startedAt: Date; endedAt: Date; durationMs: number; status: string; summary: string; tokensUsed: number; cost: number }> = [];
  const now = Date.now();
  const sessionTypes: Record<string, Array<{ type: string; summary: string; dur: [number, number] }>> = {
    'main': [{ type: 'MESSAGE', summary: 'Responded to user query', dur: [2000, 8000] }, { type: 'DELEGATION', summary: 'Delegated task to specialist', dur: [1000, 3000] }],
    'core-engineer': [{ type: 'TASK', summary: 'Code analysis and debugging', dur: [30000, 180000] }, { type: 'HEARTBEAT', summary: 'Heartbeat check', dur: [3000, 8000] }],
    'external-engineer': [{ type: 'TASK', summary: 'External API integration work', dur: [20000, 120000] }, { type: 'HEARTBEAT', summary: 'Heartbeat check', dur: [3000, 8000] }],
    'log-monitor': [{ type: 'MONITORING', summary: 'Log scan and analysis', dur: [5000, 15000] }, { type: 'HEARTBEAT', summary: 'Heartbeat check', dur: [2000, 5000] }],
    'pr-reviewer': [{ type: 'REVIEW', summary: 'Pull request review', dur: [60000, 300000] }, { type: 'HEARTBEAT', summary: 'Heartbeat check', dur: [3000, 8000] }],
    'server-health': [{ type: 'MONITORING', summary: 'Infrastructure health check', dur: [5000, 20000] }, { type: 'HEARTBEAT', summary: 'Heartbeat check', dur: [2000, 5000] }],
    'project-manager': [{ type: 'TASK', summary: 'Sprint management and coordination', dur: [10000, 60000] }, { type: 'HEARTBEAT', summary: 'Heartbeat check', dur: [3000, 8000] }],
  };
  const types = sessionTypes[agentName] || [{ type: 'HEARTBEAT', summary: 'Heartbeat', dur: [3000, 8000] as [number, number] }];
  const count = 15 + Math.floor(Math.random() * 15);
  for (let i = 0; i < count; i++) {
    const t = types[Math.floor(Math.random() * types.length)];
    const offset = Math.floor(Math.random() * 4 * 60 * 60 * 1000);
    const dur = t.dur[0] + Math.floor(Math.random() * (t.dur[1] - t.dur[0]));
    const start = new Date(now - offset);
    const tokens = 100 + Math.floor(Math.random() * 2000);
    sessions.push({ agentId, organizationId, type: t.type, startedAt: start, endedAt: new Date(start.getTime() + dur), durationMs: dur, status: Math.random() > 0.05 ? 'COMPLETED' : 'FAILED', summary: t.summary, tokensUsed: tokens, cost: tokens * 0.000001 });
  }
  return sessions;
}

function generateTokenUsage(agentId: string, organizationId: string) {
  const usages = [];
  const now = Date.now();
  for (let h = 0; h < 24; h++) {
    const inp = 200 + Math.floor(Math.random() * 1500);
    const out = 100 + Math.floor(Math.random() * 800);
    usages.push({ agentId, organizationId, inputTokens: inp, outputTokens: out, totalTokens: inp + out, model: 'gemini-2.0-flash', cost: (inp + out) * 0.000001, createdAt: new Date(now - h * 60 * 60 * 1000) });
  }
  return usages;
}

function generateMetrics(agentId: string, organizationId: string) {
  const metrics = [];
  const now = Date.now();
  const tools = ['sessions_send', 'plane-query', 'sigNoz-query', 'bitbucket-api', 'shell-exec', 'file-read', 'file-write'];
  for (let i = 0; i < 50; i++) {
    const ok = Math.random() > 0.08;
    metrics.push({ agentId, organizationId, responseTimeMs: 200 + Math.floor(Math.random() * 3000), success: ok, errorMessage: ok ? null : 'Timeout: operation exceeded 5000ms', toolName: tools[Math.floor(Math.random() * tools.length)], createdAt: new Date(now - i * 5 * 60 * 1000) });
  }
  return metrics;
}

async function main() {
  console.log('Seeding database...');

  // Clear all data
  await prisma.command.deleteMany();
  await prisma.alertEvent.deleteMany();
  await prisma.alertRule.deleteMany();
  await prisma.metricSnapshot.deleteMany();
  await prisma.tokenUsage.deleteMany();
  await prisma.session.deleteMany();
  await prisma.message.deleteMany();
  await prisma.thread.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.task.deleteMany();
  await prisma.mcpTool.deleteMany();
  await prisma.mcpServer.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.orgApiKey.deleteMany();
  await prisma.orgMember.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  // Create default organization
  const org = await prisma.organization.create({
    data: {
      name: 'OpenClaw',
      slug: 'openclaw',
      settings: { timezone: 'UTC' },
    },
  });
  console.log(`Created organization: ${org.name}`);

  // Create admin user
  const hashedPassword = await bcrypt.hash('admin123', 10);
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@nexus.local',
      password: hashedPassword,
      name: 'Admin',
    },
  });

  // Create org membership (OWNER)
  await prisma.orgMember.create({
    data: {
      organizationId: org.id,
      userId: adminUser.id,
      role: 'OWNER',
    },
  });
  console.log('Created admin user (admin@nexus.local / admin123) as OWNER');

  // Create a sample API key for the org
  const apiKey = `nxk_${randomBytes(32).toString('hex')}`;
  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  await prisma.orgApiKey.create({
    data: {
      organizationId: org.id,
      name: 'Default API Key',
      keyHash,
      keyPrefix: apiKey.substring(0, 12),
    },
  });
  console.log(`Created API key: ${apiKey}`);

  // Create agents (all belong to the org)
  const agentMap = new Map<string, string>();
  for (const agent of agents) {
    const created = await prisma.agent.create({
      data: {
        ...agent,
        organizationId: org.id,
        lastHeartbeat: new Date(Date.now() - Math.random() * 30 * 60 * 1000),
      },
    });
    agentMap.set(agent.name, created.id);
  }
  console.log(`Created ${agentMap.size} agents`);

  // Create activities
  for (const a of sampleActivities) {
    await prisma.activity.create({
      data: {
        organizationId: org.id,
        agentId: agentMap.get(a.agentName)!,
        type: a.type,
        message: a.message,
        createdAt: new Date(Date.now() - a.minutesAgo * 60 * 1000),
      },
    });
  }
  console.log(`Created ${sampleActivities.length} activities`);

  // Create tasks
  for (const t of sampleTasks) {
    await prisma.task.create({
      data: {
        organizationId: org.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        agentId: t.agentName ? agentMap.get(t.agentName) ?? null : null,
      },
    });
  }
  console.log(`Created ${sampleTasks.length} tasks`);

  // Create threads with messages
  for (const thread of sampleThreads) {
    const created = await prisma.thread.create({
      data: { organizationId: org.id, title: thread.title },
    });
    for (const msg of thread.messages) {
      await prisma.message.create({
        data: {
          threadId: created.id,
          senderId: agentMap.get(msg.from)!,
          receiverId: agentMap.get(msg.to)!,
          content: msg.content,
          createdAt: new Date(Date.now() - msg.minutesAgo * 60 * 1000),
        },
      });
    }
  }
  console.log(`Created ${sampleThreads.length} threads with messages`);

  // Create sessions
  let sc = 0;
  for (const [name, id] of agentMap) {
    const s = generateSessions(id, org.id, name);
    for (const x of s) await prisma.session.create({ data: x });
    sc += s.length;
  }
  console.log(`Created ${sc} sessions`);

  // Create token usage
  let tc = 0;
  for (const [, id] of agentMap) {
    const u = generateTokenUsage(id, org.id);
    for (const x of u) await prisma.tokenUsage.create({ data: x });
    tc += u.length;
  }
  console.log(`Created ${tc} token usage records`);

  // Create metrics
  let mc = 0;
  for (const [, id] of agentMap) {
    const m = generateMetrics(id, org.id);
    for (const x of m) await prisma.metricSnapshot.create({ data: x });
    mc += m.length;
  }
  console.log(`Created ${mc} metric snapshots`);

  // Create alert rules
  const alertRules = [
    { organizationId: org.id, name: 'Heartbeat Missed', description: 'Alert when an agent misses expected heartbeat', condition: 'heartbeat_missed', threshold: 1, windowMinutes: 10, enabled: true },
    { organizationId: org.id, name: 'High Error Rate', description: 'Alert when error rate exceeds threshold', condition: 'error_rate', threshold: 3, windowMinutes: 5, enabled: true },
    { organizationId: org.id, name: 'Agent Offline', description: 'Alert when an agent goes offline', condition: 'agent_offline', threshold: 1, windowMinutes: 1, enabled: true },
    { organizationId: org.id, name: 'High Response Time', description: 'Alert when P95 response time exceeds 3s', condition: 'response_time_p95', threshold: 3000, windowMinutes: 15, enabled: true },
    { organizationId: org.id, name: 'Disk Usage Critical', description: 'Alert when disk usage exceeds 85%', condition: 'disk_usage', threshold: 85, windowMinutes: 5, enabled: true, agentId: agentMap.get('server-health') },
    { organizationId: org.id, name: 'Token Budget Exceeded', description: 'Alert when daily token usage exceeds budget', condition: 'token_budget', threshold: 100000, windowMinutes: 1440, enabled: false },
  ];
  for (const r of alertRules) {
    await prisma.alertRule.create({ data: r });
  }
  console.log(`Created ${alertRules.length} alert rules`);

  // Create alert events
  const rules = await prisma.alertRule.findMany();
  const alertEvents = [
    { ruleIdx: 0, message: 'core-engineer missed heartbeat — last seen 12 minutes ago', severity: Severity.WARNING, minutesAgo: 45, acknowledged: true },
    { ruleIdx: 1, message: 'log-monitor detected 5 errors in 3 minutes from payment service', severity: Severity.CRITICAL, minutesAgo: 30, acknowledged: false },
    { ruleIdx: 2, message: 'external-engineer went offline unexpectedly', severity: Severity.WARNING, minutesAgo: 90, acknowledged: true },
    { ruleIdx: 3, message: 'P95 response time at 4.2s for core-engineer (threshold: 3s)', severity: Severity.WARNING, minutesAgo: 20, acknowledged: false },
    { ruleIdx: 4, message: 'Disk usage at 78% on /data volume — approaching 85% threshold', severity: Severity.INFO, minutesAgo: 50, acknowledged: false },
  ];
  for (const e of alertEvents) {
    await prisma.alertEvent.create({
      data: {
        organizationId: org.id,
        alertRuleId: rules[e.ruleIdx].id,
        message: e.message,
        severity: e.severity,
        acknowledged: e.acknowledged,
        acknowledgedAt: e.acknowledged ? new Date(Date.now() - (e.minutesAgo - 5) * 60 * 1000) : null,
        createdAt: new Date(Date.now() - e.minutesAgo * 60 * 1000),
      },
    });
  }
  console.log(`Created ${alertEvents.length} alert events`);

  console.log('\nSeeding complete!');
  console.log('Login: admin@nexus.local / admin123');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
