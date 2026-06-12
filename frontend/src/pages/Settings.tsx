import { useEffect, useState, useCallback } from 'react';
import { Header } from '@/components/layout/Header';
import { api } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import type { Organization, OrgMember, OrgApiKey } from '@/types';

type Tab = 'organization' | 'members' | 'api-keys';
type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

const roleBadgeStyles: Record<OrgRole, string> = {
  OWNER: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
  ADMIN: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  MEMBER: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  VIEWER: 'text-gray-400 bg-gray-500/10 border-gray-500/30',
};

const ALL_ROLES: OrgRole[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'];
const INVITE_ROLES: OrgRole[] = ['ADMIN', 'MEMBER', 'VIEWER'];

export function Settings() {
  const [activeTab, setActiveTab] = useState<Tab>('organization');
  const { user, orgRole } = useAuthStore();

  const isAdmin = orgRole === 'OWNER' || orgRole === 'ADMIN';
  const isOwner = orgRole === 'OWNER';

  const tabs: { key: Tab; label: string }[] = [
    { key: 'organization', label: 'Organization' },
    { key: 'members', label: 'Members' },
    { key: 'api-keys', label: 'API Keys' },
  ];

  return (
    <div>
      <Header title="Settings" subtitle="Manage your organization, team, and API access" />

      {/* Tab navigation */}
      <div className="flex items-center gap-1 border-b border-white/5 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-colors relative',
              activeTab === tab.key
                ? 'text-white'
                : 'text-gray-500 hover:text-gray-300'
            )}
          >
            {tab.label}
            {activeTab === tab.key && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-nexus-500 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'organization' && <OrganizationTab />}
      {activeTab === 'members' && (
        <MembersTab currentUserId={user?.id ?? ''} isAdmin={isAdmin} isOwner={isOwner} />
      )}
      {activeTab === 'api-keys' && <ApiKeysTab isAdmin={isAdmin} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Organization Tab
// ---------------------------------------------------------------------------

function OrganizationTab() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [orgName, setOrgName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchOrg = useCallback(async () => {
    try {
      const data = await api.org.get() as Organization;
      setOrg(data);
      setOrgName(data.name);
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to load organization details' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrg();
  }, [fetchOrg]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim() || orgName.trim() === org?.name) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await api.org.update({ name: orgName.trim() }) as Organization;
      setOrg(updated);
      setOrgName(updated.name);
      setMessage({ type: 'success', text: 'Organization updated successfully' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to update organization' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-gray-500 text-sm">Loading organization...</div>;
  }

  if (!org) {
    return <div className="text-gray-500 text-sm">Organization not found</div>;
  }

  return (
    <div className="max-w-xl">
      <div className="rounded-xl border border-white/5 bg-surface-850 p-5">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Organization Details
        </h3>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wider">
              Organization Name
            </label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="My Organization"
              className="w-full px-3 py-2 rounded-lg bg-surface-900 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-nexus-500/50"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wider">
              Slug
            </label>
            <div className="px-3 py-2 rounded-lg bg-surface-900 border border-white/5 text-sm text-gray-500">
              {org.slug}
            </div>
            <p className="text-xs text-gray-600 mt-1">The organization slug cannot be changed.</p>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wider">
              Created
            </label>
            <div className="text-sm text-gray-400">
              {new Date(org.createdAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </div>
          </div>

          {message && (
            <div
              className={cn(
                'text-sm px-3 py-2 rounded-lg border',
                message.type === 'success'
                  ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                  : 'text-red-400 bg-red-500/10 border-red-500/30'
              )}
            >
              {message.text}
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving || !orgName.trim() || orgName.trim() === org.name}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                saving || !orgName.trim() || orgName.trim() === org.name
                  ? 'bg-nexus-600/50 text-white/50 cursor-not-allowed'
                  : 'bg-nexus-600 text-white hover:bg-nexus-500'
              )}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members Tab
// ---------------------------------------------------------------------------

function MembersTab({
  currentUserId,
  isAdmin,
  isOwner,
}: {
  currentUserId: string;
  isAdmin: boolean;
  isOwner: boolean;
}) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('MEMBER');
  const [inviting, setInviting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    try {
      const data = await api.org.members() as OrgMember[];
      setMembers(data);
    } catch {
      setMessage({ type: 'error', text: 'Failed to load members' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const clearMessage = () => {
    setTimeout(() => setMessage(null), 4000);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setMessage(null);
    try {
      await api.org.invite(inviteEmail.trim(), inviteRole);
      setMessage({ type: 'success', text: `Invitation sent to ${inviteEmail.trim()}` });
      setInviteEmail('');
      setInviteRole('MEMBER');
      setShowInvite(false);
      clearMessage();
      await fetchMembers();
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Failed to invite member' });
      clearMessage();
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: OrgRole) => {
    setUpdatingRoleId(memberId);
    setMessage(null);
    try {
      await api.org.updateMemberRole(memberId, newRole);
      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m))
      );
      setMessage({ type: 'success', text: 'Role updated successfully' });
      clearMessage();
    } catch {
      setMessage({ type: 'error', text: 'Failed to update role' });
      clearMessage();
    } finally {
      setUpdatingRoleId(null);
    }
  };

  const handleRemove = async (member: OrgMember) => {
    if (!confirm(`Remove ${member.user.name || member.user.email} from the organization?`)) return;
    setRemovingId(member.id);
    setMessage(null);
    try {
      await api.org.removeMember(member.id);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      setMessage({ type: 'success', text: 'Member removed' });
      clearMessage();
    } catch {
      setMessage({ type: 'error', text: 'Failed to remove member' });
      clearMessage();
    } finally {
      setRemovingId(null);
    }
  };

  if (loading) {
    return <div className="text-gray-500 text-sm">Loading members...</div>;
  }

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          Team Members ({members.length})
        </h3>
        {isAdmin && (
          <button
            onClick={() => setShowInvite(!showInvite)}
            className="px-3 py-1.5 bg-nexus-600 hover:bg-nexus-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            <span className="text-sm leading-none">+</span>
            Invite Member
          </button>
        )}
      </div>

      {/* Inline message */}
      {message && (
        <div
          className={cn(
            'text-sm px-3 py-2 rounded-lg border mb-4',
            message.type === 'success'
              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
              : 'text-red-400 bg-red-500/10 border-red-500/30'
          )}
        >
          {message.text}
        </div>
      )}

      {/* Invite form */}
      {showInvite && (
        <div className="rounded-xl border border-white/10 bg-surface-850 p-4 mb-4">
          <form onSubmit={handleInvite} className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wider">
                Email Address
              </label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
                required
                className="w-full px-3 py-2 rounded-lg bg-surface-900 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-nexus-500/50"
              />
            </div>
            <div className="w-36">
              <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wider">
                Role
              </label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                className="w-full px-3 py-2 rounded-lg bg-surface-900 border border-white/10 text-sm text-white focus:outline-none focus:border-nexus-500/50"
              >
                {INVITE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={inviting || !inviteEmail.trim()}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                inviting || !inviteEmail.trim()
                  ? 'bg-nexus-600/50 text-white/50 cursor-not-allowed'
                  : 'bg-nexus-600 text-white hover:bg-nexus-500'
              )}
            >
              {inviting ? 'Sending...' : 'Send Invite'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowInvite(false);
                setInviteEmail('');
                setInviteRole('MEMBER');
              }}
              className="px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      {/* Members list */}
      {members.length === 0 ? (
        <div className="text-center text-gray-500 py-12 text-sm rounded-xl border border-white/5 bg-surface-850">
          No members found
        </div>
      ) : (
        <div className="rounded-xl border border-white/5 bg-surface-850 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider px-5 py-3">
                  Member
                </th>
                <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider px-5 py-3">
                  Role
                </th>
                <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider px-5 py-3">
                  Joined
                </th>
                {isAdmin && (
                  <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider px-5 py-3">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isSelf = member.userId === currentUserId;
                const isMemberOwner = member.role === 'OWNER';
                const canChangeRole = isOwner && !isSelf;
                const canRemove = isAdmin && !isSelf && !isMemberOwner;

                return (
                  <tr key={member.id} className="border-b border-white/5 last:border-b-0">
                    <td className="px-5 py-3.5">
                      <div>
                        <div className="text-sm font-medium text-white flex items-center gap-2">
                          {member.user.name || 'Unnamed'}
                          {isSelf && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium uppercase bg-white/5 text-gray-500 border border-white/10">
                              You
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">{member.user.email}</div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {canChangeRole ? (
                        <select
                          value={member.role}
                          onChange={(e) => handleRoleChange(member.id, e.target.value as OrgRole)}
                          disabled={updatingRoleId === member.id}
                          className={cn(
                            'text-[11px] px-2 py-1 rounded-md font-medium uppercase tracking-wider border bg-surface-900 focus:outline-none focus:border-nexus-500/50 cursor-pointer',
                            updatingRoleId === member.id ? 'opacity-50' : '',
                            roleBadgeStyles[member.role]
                          )}
                        >
                          {ALL_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded font-medium uppercase border inline-block',
                            roleBadgeStyles[member.role]
                          )}
                        >
                          {member.role}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs text-gray-500">{timeAgo(member.createdAt)}</span>
                    </td>
                    {isAdmin && (
                      <td className="px-5 py-3.5 text-right">
                        {canRemove && (
                          <button
                            onClick={() => handleRemove(member)}
                            disabled={removingId === member.id}
                            className={cn(
                              'text-xs px-2.5 py-1 rounded-md font-medium transition-colors border',
                              removingId === member.id
                                ? 'bg-red-500/10 text-red-400/50 border-red-500/20 cursor-not-allowed'
                                : 'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25'
                            )}
                          >
                            {removingId === member.id ? 'Removing...' : 'Remove'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// API Keys Tab
// ---------------------------------------------------------------------------

function ApiKeysTab({ isAdmin }: { isAdmin: boolean }) {
  const [keys, setKeys] = useState<OrgApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      const data = await api.org.apiKeys() as OrgApiKey[];
      setKeys(data);
    } catch {
      setMessage({ type: 'error', text: 'Failed to load API keys' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const clearMessage = () => {
    setTimeout(() => setMessage(null), 4000);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) return;
    setCreating(true);
    setMessage(null);
    try {
      const result = await api.org.createApiKey(keyName.trim()) as { key: string; apiKey: OrgApiKey };
      setNewlyCreatedKey(result.key);
      setKeys((prev) => [result.apiKey, ...prev]);
      setKeyName('');
      setShowCreate(false);
      setMessage({ type: 'success', text: 'API key created. Copy it now -- it will not be shown again.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Failed to create API key' });
      clearMessage();
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (confirmRevokeId !== id) {
      setConfirmRevokeId(id);
      return;
    }
    setRevokingId(id);
    setMessage(null);
    setConfirmRevokeId(null);
    try {
      await api.org.revokeApiKey(id);
      setKeys((prev) => prev.filter((k) => k.id !== id));
      setMessage({ type: 'success', text: 'API key revoked' });
      clearMessage();
    } catch {
      setMessage({ type: 'error', text: 'Failed to revoke API key' });
      clearMessage();
    } finally {
      setRevokingId(null);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text in a temporary input
      const input = document.createElement('input');
      input.value = text;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return <div className="text-gray-500 text-sm">Loading API keys...</div>;
  }

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          API Keys ({keys.length})
        </h3>
        {isAdmin && (
          <button
            onClick={() => {
              setShowCreate(!showCreate);
              setNewlyCreatedKey(null);
            }}
            className="px-3 py-1.5 bg-nexus-600 hover:bg-nexus-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            <span className="text-sm leading-none">+</span>
            Generate Key
          </button>
        )}
      </div>

      {/* Inline message */}
      {message && (
        <div
          className={cn(
            'text-sm px-3 py-2 rounded-lg border mb-4',
            message.type === 'success'
              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
              : 'text-red-400 bg-red-500/10 border-red-500/30'
          )}
        >
          {message.text}
        </div>
      )}

      {/* Newly created key display */}
      {newlyCreatedKey && (
        <div className="rounded-xl border border-nexus-500/30 bg-nexus-500/5 p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-nexus-500 animate-pulse" />
            <span className="text-sm font-medium text-nexus-400">
              New API Key Created
            </span>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            Copy this key now. You will not be able to see it again after leaving this page.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded-lg bg-surface-900 border border-white/10 text-sm text-white font-mono break-all select-all">
              {newlyCreatedKey}
            </code>
            <button
              onClick={() => handleCopy(newlyCreatedKey)}
              className={cn(
                'px-3 py-2 rounded-lg text-xs font-medium transition-colors border whitespace-nowrap',
                copied
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
              )}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => setNewlyCreatedKey(null)}
            className="mt-3 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Create key form */}
      {showCreate && (
        <div className="rounded-xl border border-white/10 bg-surface-850 p-4 mb-4">
          <form onSubmit={handleCreate} className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wider">
                Key Name
              </label>
              <input
                type="text"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="e.g. Production API, CI/CD Pipeline"
                required
                className="w-full px-3 py-2 rounded-lg bg-surface-900 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-nexus-500/50"
              />
            </div>
            <button
              type="submit"
              disabled={creating || !keyName.trim()}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                creating || !keyName.trim()
                  ? 'bg-nexus-600/50 text-white/50 cursor-not-allowed'
                  : 'bg-nexus-600 text-white hover:bg-nexus-500'
              )}
            >
              {creating ? 'Generating...' : 'Generate'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setKeyName('');
              }}
              className="px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      {/* Keys list */}
      {keys.length === 0 ? (
        <div className="text-center text-gray-500 py-12 text-sm rounded-xl border border-white/5 bg-surface-850">
          No API keys have been created yet
        </div>
      ) : (
        <div className="space-y-2">
          {keys.map((apiKey) => (
            <div
              key={apiKey.id}
              className="rounded-xl border border-white/5 bg-surface-850 p-4 flex items-center justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-sm font-medium text-white truncate">
                    {apiKey.name}
                  </span>
                  <code className="text-xs text-gray-500 font-mono bg-surface-900 px-2 py-0.5 rounded border border-white/5">
                    {apiKey.keyPrefix}...
                  </code>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-600">
                  <span>Created {timeAgo(apiKey.createdAt)}</span>
                  <span>
                    Last used:{' '}
                    <span className="text-gray-500">
                      {apiKey.lastUsedAt ? timeAgo(apiKey.lastUsedAt) : 'Never'}
                    </span>
                  </span>
                  {apiKey.expiresAt && (
                    <span>
                      Expires:{' '}
                      <span className="text-gray-500">{timeAgo(apiKey.expiresAt)}</span>
                    </span>
                  )}
                </div>
              </div>

              {isAdmin && (
                <div className="flex-shrink-0">
                  {confirmRevokeId === apiKey.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">Revoke?</span>
                      <button
                        onClick={() => handleRevoke(apiKey.id)}
                        disabled={revokingId === apiKey.id}
                        className={cn(
                          'text-xs px-2.5 py-1 rounded-md font-medium transition-colors border',
                          revokingId === apiKey.id
                            ? 'bg-red-500/10 text-red-400/50 border-red-500/20 cursor-not-allowed'
                            : 'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25'
                        )}
                      >
                        {revokingId === apiKey.id ? 'Revoking...' : 'Confirm'}
                      </button>
                      <button
                        onClick={() => setConfirmRevokeId(null)}
                        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleRevoke(apiKey.id)}
                      className="text-xs px-2.5 py-1 rounded-md font-medium transition-colors border bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
