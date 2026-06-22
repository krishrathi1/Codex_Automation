import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { MarketplaceSkill, SkillPack } from '../types';

export function SkillsMarketplace() {
  const [skills, setSkills] = useState<MarketplaceSkill[]>([]);
  const [packs, setPacks] = useState<SkillPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'skills' | 'packs'>('skills');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedGateway, setSelectedGateway] = useState<string>('');
  const [form, setForm] = useState({ name: '', description: '', category: 'general', risk: 'low', sourceUrl: '' });
  const [packForm, setPackForm] = useState({ name: '', description: '', sourceUrl: '', branch: 'main' });

  useEffect(() => {
    Promise.all([
      api.skills.marketplace(),
      api.skills.packs(),
    ]).then(([s, p]) => {
      setSkills(s);
      setPacks(p);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function handleCreateSkill() {
    const skill = await api.skills.createSkill(form);
    setSkills(prev => [...prev, { ...skill, installedGatewayIds: [] }]);
    setShowCreate(false);
    setForm({ name: '', description: '', category: 'general', risk: 'low', sourceUrl: '' });
  }

  async function handleInstall(skillId: string) {
    if (!selectedGateway) return;
    await api.skills.install(skillId, selectedGateway);
    setSkills(prev => prev.map(s => s.id === skillId ? { ...s, installedGatewayIds: [...s.installedGatewayIds, selectedGateway] } : s));
  }

  async function handleUninstall(skillId: string) {
    if (!selectedGateway) return;
    await api.skills.uninstall(skillId, selectedGateway);
    setSkills(prev => prev.map(s => s.id === skillId ? { ...s, installedGatewayIds: s.installedGatewayIds.filter(g => g !== selectedGateway) } : s));
  }

  async function handleCreatePack() {
    const pack = await api.skills.createPack(packForm);
    setPacks(prev => [...prev, pack]);
    setPackForm({ name: '', description: '', sourceUrl: '', branch: 'main' });
  }

  const riskColors: Record<string, string> = {
    low: 'text-emerald-400 bg-emerald-500/10',
    medium: 'text-amber-400 bg-amber-500/10',
    high: 'text-red-400 bg-red-500/10',
  };

  if (loading) return <div className="p-6 text-gray-500">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Skills Marketplace</h1>
          <p className="text-sm text-gray-500 mt-1">Manage and install skills for your agents</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-nexus-600 hover:bg-nexus-500 text-white text-sm font-medium rounded-lg">
            Add Skill
          </button>
        </div>
      </div>

      <div className="flex gap-1 bg-surface-850 rounded-lg p-1 w-fit">
        <button onClick={() => setTab('skills')} className={`px-4 py-1.5 text-sm rounded-md ${tab === 'skills' ? 'bg-surface-700 text-white' : 'text-gray-400 hover:text-white'}`}>Skills</button>
        <button onClick={() => setTab('packs')} className={`px-4 py-1.5 text-sm rounded-md ${tab === 'packs' ? 'bg-surface-700 text-white' : 'text-gray-400 hover:text-white'}`}>Skill Packs</button>
      </div>

      {tab === 'skills' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {skills.length === 0 ? (
            <div className="col-span-full text-center py-12 text-gray-500">No skills yet. Add your first skill to get started.</div>
          ) : skills.map(skill => {
            const isInstalled = selectedGateway ? skill.installedGatewayIds.includes(selectedGateway) : false;
            return (
              <div key={skill.id} className="bg-surface-850 border border-white/5 rounded-xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-white font-medium">{skill.name}</h3>
                    <span className="text-xs text-gray-500">{skill.category}</span>
                  </div>
                  <span className={`px-2 py-0.5 text-xs rounded-full ${riskColors[skill.risk] || riskColors.low}`}>{skill.risk}</span>
                </div>
                <p className="text-sm text-gray-400 mb-4 line-clamp-2">{skill.description || 'No description'}</p>
                {selectedGateway && (
                  <button
                    onClick={() => isInstalled ? handleUninstall(skill.id) : handleInstall(skill.id)}
                    className={`w-full py-1.5 text-sm rounded-lg ${isInstalled ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-nexus-600/10 text-nexus-400 hover:bg-nexus-600/20'}`}
                  >
                    {isInstalled ? 'Uninstall' : 'Install'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'packs' && (
        <div className="space-y-4">
          <div className="bg-surface-850 border border-white/5 rounded-xl p-5">
            <h3 className="text-white font-medium mb-3">Add Skill Pack</h3>
            <div className="grid grid-cols-2 gap-3">
              <input value={packForm.name} onChange={e => setPackForm(p => ({ ...p, name: e.target.value }))} placeholder="Pack name" className="px-3 py-2 bg-surface-800 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600" />
              <input value={packForm.sourceUrl} onChange={e => setPackForm(p => ({ ...p, sourceUrl: e.target.value }))} placeholder="Repository URL" className="px-3 py-2 bg-surface-800 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600" />
              <input value={packForm.description} onChange={e => setPackForm(p => ({ ...p, description: e.target.value }))} placeholder="Description" className="px-3 py-2 bg-surface-800 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600" />
              <button onClick={handleCreatePack} disabled={!packForm.name || !packForm.sourceUrl} className="px-4 py-2 bg-nexus-600 hover:bg-nexus-500 text-white text-sm rounded-lg disabled:opacity-50">Add Pack</button>
            </div>
          </div>
          {packs.map(pack => (
            <div key={pack.id} className="bg-surface-850 border border-white/5 rounded-xl p-5 flex items-center justify-between">
              <div>
                <h3 className="text-white font-medium">{pack.name}</h3>
                <p className="text-xs text-gray-500">{pack.sourceUrl} ({pack.branch})</p>
                {pack.lastSyncedAt && <p className="text-xs text-gray-600 mt-1">Last synced: {new Date(pack.lastSyncedAt).toLocaleString()}</p>}
              </div>
              <button onClick={() => api.skills.syncPack(pack.id)} className="px-3 py-1.5 bg-surface-700 hover:bg-surface-600 text-sm text-white rounded-lg">Sync</button>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-surface-900 border border-white/10 rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-4">Add Skill</h2>
            <div className="space-y-3">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Skill name" className="w-full px-3 py-2 bg-surface-850 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600" />
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Description" rows={3} className="w-full px-3 py-2 bg-surface-850 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600 resize-none" />
              <div className="grid grid-cols-2 gap-3">
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="px-3 py-2 bg-surface-850 border border-white/10 rounded-lg text-sm text-white">
                  <option value="general">General</option>
                  <option value="coding">Coding</option>
                  <option value="research">Research</option>
                  <option value="writing">Writing</option>
                  <option value="data">Data</option>
                </select>
                <select value={form.risk} onChange={e => setForm(f => ({ ...f, risk: e.target.value }))} className="px-3 py-2 bg-surface-850 border border-white/10 rounded-lg text-sm text-white">
                  <option value="low">Low Risk</option>
                  <option value="medium">Medium Risk</option>
                  <option value="high">High Risk</option>
                </select>
              </div>
              <input value={form.sourceUrl} onChange={e => setForm(f => ({ ...f, sourceUrl: e.target.value }))} placeholder="Source URL (optional)" className="w-full px-3 py-2 bg-surface-850 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600" />
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2 bg-surface-800 text-gray-300 text-sm rounded-lg">Cancel</button>
              <button onClick={handleCreateSkill} disabled={!form.name} className="flex-1 py-2 bg-nexus-600 hover:bg-nexus-500 text-white text-sm rounded-lg disabled:opacity-50">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
