import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { SoulTemplate } from '../types';

export function SoulTemplates() {
  const [templates, setTemplates] = useState<SoulTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<SoulTemplate | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', category: 'general', description: '', content: '' });

  useEffect(() => {
    api.soulTemplates.list().then(data => {
      setTemplates(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function handleSearch() {
    if (!search.trim()) {
      const data = await api.soulTemplates.list();
      setTemplates(data);
      return;
    }
    const data = await api.soulTemplates.search(search);
    setTemplates(data);
  }

  async function handleCreate() {
    const template = await api.soulTemplates.create(form);
    setTemplates(prev => [...prev, template]);
    setShowCreate(false);
    setForm({ name: '', category: 'general', description: '', content: '' });
  }

  async function handleDelete(id: string) {
    setDeleteError(null);
    try {
      await api.soulTemplates.delete(id);
      setTemplates(prev => prev.filter(t => t.id !== id));
      if (selectedTemplate?.id === id) setSelectedTemplate(null);
    } catch (err) {
      setDeleteError((err as Error).message);
    }
  }

  const categories = [...new Set(templates.map(t => t.category))].sort();

  if (loading) return <div className="p-6 text-gray-500">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Soul Templates</h1>
          <p className="text-sm text-gray-500 mt-1">Predefined personas and instructions for agents</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-nexus-600 hover:bg-nexus-500 text-white text-sm font-medium rounded-lg">
          Create Template
        </button>
      </div>

      <div className="flex gap-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Search templates..."
          className="flex-1 px-4 py-2 bg-surface-850 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600"
        />
        <button onClick={handleSearch} className="px-4 py-2 bg-surface-800 text-gray-300 text-sm rounded-lg hover:bg-surface-700">Search</button>
      </div>

      <div className="flex gap-6">
        <div className="w-80 space-y-2 flex-shrink-0">
          {categories.map(cat => (
            <div key={cat}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 px-2">{cat}</p>
              {templates.filter(t => t.category === cat).map(template => (
                <button
                  key={template.id}
                  onClick={() => setSelectedTemplate(template)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    selectedTemplate?.id === template.id ? 'bg-nexus-600/15 text-nexus-400' : 'text-gray-300 hover:bg-white/5'
                  }`}
                >
                  <p className="font-medium truncate">{template.name}</p>
                  {template.description && <p className="text-xs text-gray-500 truncate mt-0.5">{template.description}</p>}
                </button>
              ))}
            </div>
          ))}
          {templates.length === 0 && <p className="text-sm text-gray-500 px-2">No templates yet</p>}
        </div>

        <div className="flex-1">
          {selectedTemplate ? (
            <div className="bg-surface-850 border border-white/5 rounded-xl p-6">
              {deleteError && (
                <div className="mb-4 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{deleteError}</div>
              )}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">{selectedTemplate.name}</h2>
                  <p className="text-sm text-gray-500">{selectedTemplate.category} &middot; {selectedTemplate.slug}</p>
                </div>
                <button onClick={() => handleDelete(selectedTemplate.id)} className="px-3 py-1 text-xs text-red-400 hover:bg-red-500/10 rounded">Delete</button>
              </div>
              {selectedTemplate.description && <p className="text-sm text-gray-400 mb-4">{selectedTemplate.description}</p>}
              <pre className="bg-surface-900 rounded-lg p-4 text-sm text-gray-300 overflow-auto max-h-96 whitespace-pre-wrap">{selectedTemplate.content}</pre>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-gray-500">
              Select a template to preview
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-surface-900 border border-white/10 rounded-xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-4">Create Soul Template</h2>
            <div className="space-y-3">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Template name" className="w-full px-3 py-2 bg-surface-850 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600" />
              <div className="grid grid-cols-2 gap-3">
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="px-3 py-2 bg-surface-850 border border-white/10 rounded-lg text-sm text-white">
                  <option value="general">General</option>
                  <option value="coding">Coding</option>
                  <option value="research">Research</option>
                  <option value="support">Support</option>
                  <option value="creative">Creative</option>
                </select>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description" className="px-3 py-2 bg-surface-850 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600" />
              </div>
              <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} placeholder="Template content (SOUL.md format)..." rows={10} className="w-full px-3 py-2 bg-surface-850 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600 resize-none font-mono" />
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2 bg-surface-800 text-gray-300 text-sm rounded-lg">Cancel</button>
              <button onClick={handleCreate} disabled={!form.name || !form.content} className="flex-1 py-2 bg-nexus-600 hover:bg-nexus-500 text-white text-sm rounded-lg disabled:opacity-50">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
