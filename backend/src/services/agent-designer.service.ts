import { logger } from '../lib/logger.js';
import {
  resolveClaudeCwd,
  runClaudeCliPromptWithResumeRecovery,
  validateAuthentication,
  validateInstallation,
} from './claude-cli.service.js';

export interface DesignerMessage {
  role: 'user' | 'assistant';
  content: string;
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

export interface DesignAgentsResult {
  reply: string;
  proposal?: AgentDesignProposal;
}

const SYSTEM_INSTRUCTIONS = `You are the Agent Designer for Nexus. A user is creating a new "production group"
(a workroom that contains AI sub-agents). Your job is to help them decide WHICH sub-agents to create.

Rules:
- Ask exactly ONE short clarifying question per turn until you understand the goal, the systems involved
  (e.g. GitHub repo, Vercel site, database), and what each agent should do.
- Keep replies concise and friendly. Do not write essays.
- IMPORTANT: the moment you output the json block, the production group AND its agents are created
  automatically and the conversation ends. So only emit it once you genuinely have enough detail, and
  include EVERY agent the group needs in that single block — you cannot add more afterwards.
- Only once you have enough to propose a concrete roster, output a SINGLE fenced json block (\`\`\`json ... \`\`\`)
  immediately AFTER a one-sentence summary. Do not output the json block before you are ready.
- The json block MUST match this shape exactly:
  {
    "group": { "name": string, "objective": string, "description": string,
               "mode": "continuous" | "sprint" | "goal", "maxAgents": number },
    "agents": [ { "displayName": string, "role": string, "persona": string } ]
  }
- "persona" is the agent's soul / system prompt: 2-5 sentences describing who it is, what it does, its tone,
  and its boundaries. "role" is a short label (e.g. "Deployment monitor").
- Propose between 1 and the group's maxAgents agents. Prefer fewer, well-scoped agents.
- After emitting the json block, stop. Do not ask more questions in that turn.`;

function buildPrompt(messages: DesignerMessage[]): string {
  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Designer'}: ${m.content}`)
    .join('\n\n');
  return `${SYSTEM_INSTRUCTIONS}\n\n--- Conversation so far ---\n${transcript}\n\n--- Your next turn (Designer) ---`;
}

/**
 * Extract a fenced ```json proposal block from the model output.
 * Returns the parsed proposal (if valid) plus the reply text with the block removed.
 */
export function parseDesignerOutput(raw: string): DesignAgentsResult {
  const text = raw?.trim() ?? '';
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (!fenceMatch) {
    return { reply: text || 'No response' };
  }

  const reply = text.replace(fenceMatch[0], '').trim();
  try {
    const parsed = JSON.parse(fenceMatch[1].trim()) as AgentDesignProposal;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.agents)) {
      return { reply: text };
    }
    // Normalize: drop malformed agent entries.
    const agents = parsed.agents
      .filter((a) => a && typeof a.displayName === 'string' && a.displayName.trim())
      .map((a) => ({
        displayName: String(a.displayName).trim(),
        role: typeof a.role === 'string' ? a.role.trim() : '',
        persona: typeof a.persona === 'string' ? a.persona.trim() : '',
      }));
    return {
      reply: reply || 'Here is a proposed set of agents — review and edit them on the right, then click Create.',
      proposal: { group: parsed.group ?? {}, agents },
    };
  } catch (err) {
    logger.warn({ err }, 'Agent Designer: failed to parse proposal json block');
    return { reply: text };
  }
}

export async function designAgents(options: {
  organizationId: string;
  messages: DesignerMessage[];
}): Promise<DesignAgentsResult> {
  const messages = (options.messages ?? []).filter(
    (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim(),
  );
  if (messages.length === 0) {
    const err = new Error('messages is required') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  const installation = await validateInstallation();
  if (!installation.ok || !installation.command) {
    const err = new Error(`Claude CLI installation check failed: ${installation.details}`) as Error & { statusCode?: number };
    err.statusCode = 503;
    throw err;
  }

  const authentication = await validateAuthentication();
  if (!authentication.ok) {
    const err = new Error(
      `Claude CLI authentication check failed. Run "claude login" locally. Details: ${authentication.details}`,
    ) as Error & { statusCode?: number };
    err.statusCode = 503;
    throw err;
  }

  const cwd = resolveClaudeCwd();
  logger.info({ organizationId: options.organizationId, turns: messages.length }, 'Starting Agent Designer Claude CLI run');

  const state = await runClaudeCliPromptWithResumeRecovery({
    command: installation.command,
    cwd,
    prompt: buildPrompt(messages),
    onEvent: async () => {},
    logContext: { feature: 'agent-designer', organizationId: options.organizationId },
  });

  return parseDesignerOutput(state.result || '');
}
