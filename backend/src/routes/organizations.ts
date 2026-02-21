import { Router } from 'express';
import { z } from 'zod';
import * as orgService from '../services/org.service.js';
import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const updateOrgSchema = z.object({
  name: z.string().min(1).optional(),
  settings: z.record(z.unknown()).optional(),
});

const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
});

const updateMemberRoleSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
});

const createApiKeySchema = z.object({
  name: z.string().min(1),
});

// GET / — get organization details
router.get('/', async (req, res) => {
  const org = await orgService.getOrganization(req.organizationId!);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  res.json(org);
});

// PATCH / — update organization
router.patch('/', requireRole('OWNER', 'ADMIN'), validate(updateOrgSchema), async (req, res) => {
  const org = await orgService.updateOrganization(req.organizationId!, req.body);
  res.json(org);
});

// GET /members — list members
router.get('/members', async (req, res) => {
  const members = await orgService.getMembers(req.organizationId!);
  res.json(members);
});

// POST /members/invite — invite member
router.post('/members/invite', requireRole('OWNER', 'ADMIN'), validate(inviteMemberSchema), async (req, res) => {
  try {
    const member = await orgService.inviteMember(req.organizationId!, req.body.email, req.body.role);
    res.status(201).json(member);
  } catch (e: any) {
    if (e.message === 'User is already a member of this organization') {
      return res.status(409).json({ error: e.message });
    }
    return res.status(500).json({ error: 'Failed to invite member' });
  }
});

// PATCH /members/:id — update member role
router.patch('/members/:id', requireRole('OWNER'), validate(updateMemberRoleSchema), async (req, res) => {
  try {
    const member = await orgService.updateMemberRole(req.params.id as string, req.organizationId!, req.body.role);
    res.json(member);
  } catch (e: any) {
    return res.status(404).json({ error: e.message });
  }
});

// DELETE /members/:id — remove member
router.delete('/members/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  try {
    await orgService.removeMember(req.params.id as string, req.organizationId!);
    res.status(204).end();
  } catch (e: any) {
    return res.status(404).json({ error: e.message });
  }
});

// GET /api-keys — list API keys
router.get('/api-keys', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const keys = await orgService.getApiKeys(req.organizationId!);
  res.json(keys);
});

// POST /api-keys — create API key
router.post('/api-keys', requireRole('OWNER', 'ADMIN'), validate(createApiKeySchema), async (req, res) => {
  const key = await orgService.createApiKey(req.organizationId!, req.body.name);
  res.status(201).json(key);
});

// DELETE /api-keys/:id — revoke API key
router.delete('/api-keys/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  try {
    await orgService.revokeApiKey(req.params.id as string, req.organizationId!);
    res.status(204).end();
  } catch (e: any) {
    return res.status(404).json({ error: e.message });
  }
});

export default router;
