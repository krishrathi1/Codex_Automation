import { prisma } from '../lib/prisma.js';
import { encryptField, decryptField } from '../lib/crypto.js';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { logger } from '../lib/logger.js';
const tracer = trace.getTracer('nexus-llm');

// Map provider IDs to their platform env var names
const PLATFORM_KEY_ENV: Record<string, string> = {
  codex: 'CODEX_API_KEY',
  openai: 'PLATFORM_OPENAI_API_KEY',
  google: 'PLATFORM_GOOGLE_API_KEY',
  mistral: 'PLATFORM_MISTRAL_API_KEY',
  groq: 'PLATFORM_GROQ_API_KEY',
  openrouter: 'PLATFORM_OPENROUTER_API_KEY',
};

// Cost per token (in dollars) by model prefix — input/output pricing
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o':            { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
  'gpt-4o-mini':       { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  'gpt-4-turbo':       { input: 10 / 1_000_000,  output: 30 / 1_000_000 },
  'gemini-2.0-flash':  { input: 0.1 / 1_000_000, output: 0.4 / 1_000_000 },
  'default':           { input: 1 / 1_000_000,   output: 1 / 1_000_000 },
};

export interface ResolvedKey {
  apiKey: string;
  provider: string;
  mode: 'BYOK' | 'PLATFORM';
}

export async function getProviders(organizationId: string) {
  return prisma.llmProvider.findMany({
    where: { organizationId },
    orderBy: { provider: 'asc' },
  });
}

export async function upsertProvider(organizationId: string, data: {
  provider: string;
  mode: 'BYOK' | 'PLATFORM';
  apiKey?: string;
}) {
  return tracer.startActiveSpan('llm.upsertProvider', async (span) => {
    try {
      span.setAttribute('org.id', organizationId);
      span.setAttribute('llm.provider', data.provider);
      span.setAttribute('llm.mode', data.mode);
      // Encrypt API key before storing
      const encryptedKey = data.apiKey ? encryptField(data.apiKey) : null;

      const provider = await prisma.llmProvider.upsert({
        where: { organizationId_provider: { organizationId, provider: data.provider } },
        update: {
          mode: data.mode,
          ...(data.apiKey !== undefined && { apiKey: encryptedKey }),
          isActive: true,
        },
        create: {
          organizationId,
          provider: data.provider,
          mode: data.mode,
          apiKey: encryptedKey,
          isActive: true,
        },
      });
      logger.info({ orgId: organizationId, provider: data.provider, mode: data.mode }, 'LLM provider upserted');
      return provider;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}

export async function deleteProvider(id: string, organizationId: string) {
  return tracer.startActiveSpan('llm.deleteProvider', async (span) => {
    try {
      span.setAttribute('llm.providerId', id);
      span.setAttribute('org.id', organizationId);
      const result = await prisma.llmProvider.delete({ where: { id, organizationId } });
      logger.info({ providerId: id, orgId: organizationId }, 'LLM provider deleted');
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}

export async function getUsage(organizationId: string) {
  const [credit, providers] = await Promise.all([
    prisma.usageCredit.findUnique({ where: { organizationId } }),
    prisma.llmProvider.findMany({ where: { organizationId }, orderBy: { provider: 'asc' } }),
  ]);
  return { credit, providers };
}

export async function ensureCredit(organizationId: string) {
  return prisma.usageCredit.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId, balanceCents: 0, totalSpentCents: 0 },
  });
}

/**
 * Resolve the API key for an organization's LLM provider.
 * - BYOK: decrypt and return the org's stored key
 * - PLATFORM: return the platform key from env vars
 * - No provider configured: return null (backward compat)
 */
export async function resolveApiKey(
  organizationId: string,
  provider?: string,
): Promise<ResolvedKey | null> {
  return tracer.startActiveSpan('llm.resolveApiKey', async (span): Promise<ResolvedKey | null> => {
    try {
      span.setAttribute('org.id', organizationId);
      if (provider) span.setAttribute('llm.provider', provider);

      const where: Record<string, unknown> = { organizationId, isActive: true };
      if (provider) where.provider = provider;

      const llmProvider = await prisma.llmProvider.findFirst({
        where,
        orderBy: { updatedAt: 'desc' },
      });

      if (!llmProvider) {
        span.setAttribute('llm.resolved', false);
        return null;
      }

      span.setAttribute('llm.resolved', true);
      span.setAttribute('llm.mode', llmProvider.mode);
      span.setAttribute('llm.provider', llmProvider.provider);

      if (llmProvider.mode === 'BYOK') {
        if (!llmProvider.apiKey) {
          logger.warn({ orgId: organizationId, provider: llmProvider.provider }, 'BYOK provider has no API key');
          return null;
        }
        return {
          apiKey: decryptField(llmProvider.apiKey),
          provider: llmProvider.provider,
          mode: 'BYOK',
        };
      }

      // PLATFORM mode — use platform operator's key from env vars
      const envVar = PLATFORM_KEY_ENV[llmProvider.provider];
      const platformKey = envVar ? process.env[envVar] : undefined;
      if (!platformKey) {
        logger.warn({ provider: llmProvider.provider }, 'No platform API key configured for provider');
        return null;
      }

      return {
        apiKey: platformKey,
        provider: llmProvider.provider,
        mode: 'PLATFORM',
      };
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Calculate cost in dollars for a given model and token counts.
 */
export function calculateTokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  let bestMatch = 'default';
  for (const prefix of Object.keys(MODEL_PRICING)) {
    if (prefix !== 'default' && model.startsWith(prefix) && prefix.length > bestMatch.length) {
      bestMatch = prefix;
    }
  }
  const pricing = MODEL_PRICING[bestMatch];
  return inputTokens * pricing.input + outputTokens * pricing.output;
}

/**
 * Check if an org has sufficient platform credits. Throws 402 if not.
 */
export async function checkCreditSufficient(organizationId: string): Promise<number> {
  const credit = await prisma.usageCredit.findUnique({ where: { organizationId } });
  if (!credit || credit.balanceCents <= 0) {
    const err = new Error('Insufficient platform credits') as Error & { statusCode?: number };
    err.statusCode = 402;
    throw err;
  }
  return credit.balanceCents;
}

/**
 * Deduct usage cost from an org's credit balance.
 */
export async function deductCredit(organizationId: string, costCents: number) {
  return tracer.startActiveSpan('llm.deductCredit', async (span) => {
    try {
      span.setAttribute('org.id', organizationId);
      span.setAttribute('cost.cents', costCents);

      const updated = await prisma.usageCredit.update({
        where: { organizationId },
        data: {
          balanceCents: { decrement: costCents },
          totalSpentCents: { increment: costCents },
        },
      });

      logger.info({ orgId: organizationId, costCents, newBalance: updated.balanceCents }, 'Credit deducted');
      return updated;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Add credits to an org's balance (admin top-up).
 */
export async function addCredit(organizationId: string, amountCents: number) {
  return tracer.startActiveSpan('llm.addCredit', async (span) => {
    try {
      span.setAttribute('org.id', organizationId);
      span.setAttribute('amount.cents', amountCents);

      const updated = await prisma.usageCredit.upsert({
        where: { organizationId },
        update: {
          balanceCents: { increment: amountCents },
          lastTopUpAt: new Date(),
        },
        create: {
          organizationId,
          balanceCents: amountCents,
          totalSpentCents: 0,
          lastTopUpAt: new Date(),
        },
      });

      logger.info({ orgId: organizationId, amountCents, newBalance: updated.balanceCents }, 'Credit added');
      return updated;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Record token usage and optionally deduct platform credits.
 */
export async function recordTokenUsage(params: {
  organizationId: string;
  agentId: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  mode: 'BYOK' | 'PLATFORM';
}) {
  const totalTokens = params.inputTokens + params.outputTokens;
  const costDollars = calculateTokenCost(params.model, params.inputTokens, params.outputTokens);
  const costCents = Math.ceil(costDollars * 100);

  await prisma.tokenUsage.create({
    data: {
      organizationId: params.organizationId,
      agentId: params.agentId,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      totalTokens,
      model: params.model,
      cost: costDollars,
    },
  });

  if (params.mode === 'PLATFORM' && costCents > 0) {
    await deductCredit(params.organizationId, costCents);
  }
}
