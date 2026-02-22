import { Code2, Microscope, Server, ArrowRight, Bell } from 'lucide-react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import type { ReactNode } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface UseCase {
  icon: LucideIcon;
  title: string;
  description: string;
  visual: ReactNode;
}

/* ------------------------------------------------------------------ */
/*  Mini visual components                                             */
/* ------------------------------------------------------------------ */

/** Agent avatar with role label and status dot */
function AgentAvatar({
  initials,
  role,
  color,
  statusColor = 'bg-emerald-400',
}: {
  initials: string;
  role: string;
  color: string;
  statusColor?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white ${color}`}
        >
          {initials}
        </div>
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface-900 ${statusColor}`}
        />
      </div>
      <span className="text-[9px] font-medium text-gray-400">{role}</span>
    </div>
  );
}

/** Use case 1: Engineering team copilots — 3 agent avatars with roles */
function TeamVisual() {
  const agents = [
    {
      initials: 'PR',
      role: 'Reviewer',
      color: 'bg-gradient-to-br from-nexus-500 to-nexus-700',
      statusColor: 'bg-emerald-400',
    },
    {
      initials: 'BF',
      role: 'Fixer',
      color: 'bg-gradient-to-br from-violet-500 to-violet-700',
      statusColor: 'bg-emerald-400',
    },
    {
      initials: 'TW',
      role: 'Tester',
      color: 'bg-gradient-to-br from-amber-500 to-amber-700',
      statusColor: 'bg-amber-400',
    },
  ];

  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-white/5 bg-surface-900/80 p-4">
      {/* Agent row */}
      <div className="flex items-start justify-center gap-6">
        {agents.map((agent) => (
          <AgentAvatar key={agent.initials} {...agent} />
        ))}
      </div>

      {/* Activity feed */}
      <div className="mt-4 space-y-1.5">
        <div className="flex items-center gap-2 rounded-md bg-surface-950/60 px-2.5 py-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
          <span className="text-[10px] text-gray-400">
            <span className="font-medium text-gray-300">PR</span> approved
            merge for{' '}
            <span className="font-mono text-nexus-400">#247</span>
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-surface-950/60 px-2.5 py-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-nexus-400" />
          <span className="text-[10px] text-gray-400">
            <span className="font-medium text-gray-300">BF</span> patched
            null-ref in{' '}
            <span className="font-mono text-nexus-400">auth.ts</span>
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-surface-950/60 px-2.5 py-1.5">
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
          <span className="text-[10px] text-gray-400">
            <span className="font-medium text-gray-300">TW</span> running
            integration suite&hellip;
          </span>
        </div>
      </div>
    </div>
  );
}

/** Small arrow connector between pipeline stages */
function PipelineArrow(props: LucideProps) {
  return (
    <ArrowRight
      className="h-3.5 w-3.5 shrink-0 text-nexus-500/50"
      {...props}
    />
  );
}

/** Use case 2: Research agents — pipeline flow visualization */
function ResearchPipelineVisual() {
  const stages = [
    { label: 'Search', color: 'text-nexus-400', bg: 'bg-nexus-500/10' },
    { label: 'Analyze', color: 'text-violet-400', bg: 'bg-violet-500/10' },
    { label: 'Summarize', color: 'text-amber-400', bg: 'bg-amber-500/10' },
    { label: 'Report', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  ];

  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-white/5 bg-surface-900/80 p-4">
      {/* Pipeline stages */}
      <div className="flex items-center justify-center gap-2">
        {stages.map((stage, i) => (
          <div key={stage.label} className="flex items-center gap-2">
            <div
              className={`rounded-md ${stage.bg} px-2.5 py-1.5 text-[10px] font-semibold ${stage.color}`}
            >
              {stage.label}
            </div>
            {i < stages.length - 1 && <PipelineArrow />}
          </div>
        ))}
      </div>

      {/* Sample output */}
      <div className="mt-4 rounded-md border border-white/5 bg-surface-950/60 p-3">
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="text-[9px] font-medium text-emerald-400">
            Report Ready
          </span>
        </div>
        <p className="text-[10px] leading-relaxed text-gray-400">
          Analyzed <span className="text-gray-300">23 sources</span>. Key
          finding: competitor Y launched a new pricing tier, undercutting
          current rates by{' '}
          <span className="font-medium text-amber-400">18%</span>.
        </p>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="rounded bg-nexus-500/10 px-1.5 py-0.5 text-[8px] font-medium text-nexus-400">
            3 attachments
          </span>
          <span className="rounded bg-surface-850 px-1.5 py-0.5 text-[8px] font-medium text-gray-500">
            2 min ago
          </span>
        </div>
      </div>
    </div>
  );
}

/** Use case 3: DevOps bots — mini status dashboard */
function DevOpsDashboardVisual() {
  const servers = [
    { name: 'api-prod-1', uptime: 99.99, load: 24 },
    { name: 'api-prod-2', uptime: 99.95, load: 61 },
    { name: 'worker-01', uptime: 100, load: 38 },
    { name: 'db-primary', uptime: 99.97, load: 45 },
  ];

  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-white/5 bg-surface-900/80 p-4">
      {/* Server status rows */}
      <div className="space-y-2">
        {servers.map((srv) => (
          <div key={srv.name} className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-gray-300">
              {srv.name}
            </span>
            {/* Uptime bar */}
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-950">
              <div
                className="h-full rounded-full bg-emerald-500/70"
                style={{ width: `${srv.load}%` }}
              />
            </div>
            <span className="w-12 text-right text-[9px] tabular-nums text-emerald-400">
              {srv.uptime}%
            </span>
          </div>
        ))}
      </div>

      {/* Alert notification */}
      <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-2">
        <Bell className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
        <div>
          <p className="text-[10px] font-medium text-amber-300">
            Memory alert on api-prod-2
          </p>
          <p className="mt-0.5 text-[9px] text-gray-500">
            Agent auto-scaled to 4 GB &middot; awaiting approval to restart
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Use case definitions                                               */
/* ------------------------------------------------------------------ */

const useCases: UseCase[] = [
  {
    icon: Code2,
    title: 'Engineering Team Copilots',
    description:
      'Deploy a fleet of coding agents \u2014 PR reviewers, bug fixers, test writers. Organize their work on boards, approve deployments, and track their progress in real-time.',
    visual: <TeamVisual />,
  },
  {
    icon: Microscope,
    title: 'Autonomous Research Agents',
    description:
      'Create research agents that crawl the web, analyze competitors, summarize papers, and report findings. Set up approval gates for critical decisions.',
    visual: <ResearchPipelineVisual />,
  },
  {
    icon: Server,
    title: 'DevOps & Infrastructure Bots',
    description:
      'Agents that monitor server health, deploy code, manage databases, and alert you when things go wrong. Full audit trail and human-in-the-loop controls.',
    visual: <DevOpsDashboardVisual />,
  },
];

/* ------------------------------------------------------------------ */
/*  Section component                                                  */
/* ------------------------------------------------------------------ */

export function IntegrationSection() {
  return (
    <section id="use-cases" className="px-6 py-24">
      <div className="mx-auto max-w-7xl">
        {/* Section heading */}
        <div className="mb-16 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Agentic Workflow Use Cases
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-400">
            Nexus is the mission control for any enterprise AI agent workflow
          </p>
        </div>

        {/* Use case cards */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {useCases.map((useCase) => (
            <div
              key={useCase.title}
              className="group rounded-xl border border-white/5 bg-surface-850 p-6 transition-all duration-300 hover:border-nexus-500/30 hover:bg-surface-850/80"
            >
              {/* Icon + title */}
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-nexus-500/10 text-nexus-400 transition-colors group-hover:bg-nexus-500/20">
                  <useCase.icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">
                    {useCase.title}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-gray-400">
                    {useCase.description}
                  </p>
                </div>
              </div>

              {/* Visual element */}
              {useCase.visual}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
