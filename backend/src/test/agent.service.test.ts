import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestData, createTestUser } from './setup.js';
import { createAgent, updateAgent } from '../services/agent.service.js';

describe('agent service', () => {
  let orgId: string;

  beforeAll(async () => {
    const setup = await createTestUser('agent-service');
    orgId = setup.organization.id;
  });

  afterAll(async () => {
    await cleanupTestData(orgId);
  });

  it('requires unique visible sub-agent names across the organization', async () => {
    const first = await createAgent(orgId, {
      name: 'visible-name-alpha',
      displayName: 'Shared Visible Agent',
      description: 'First visible-name agent',
    });
    const second = await createAgent(orgId, {
      name: 'visible-name-beta',
      displayName: 'Different Visible Agent',
      description: 'Second visible-name agent',
    });

    await expect(createAgent(orgId, {
      name: 'visible-name-gamma',
      displayName: 'shared visible agent',
      description: 'Duplicate visible-name agent',
    })).rejects.toMatchObject({ statusCode: 409 });

    await expect(updateAgent(second.id, orgId, {
      displayName: 'Shared Visible Agent',
    })).rejects.toMatchObject({ statusCode: 409 });

    await expect(updateAgent(first.id, orgId, {
      displayName: 'Shared Visible Agent',
    })).resolves.toMatchObject({ id: first.id, displayName: 'Shared Visible Agent' });
  });
});
