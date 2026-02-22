import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { TaskCustomFieldDefinition, Board } from '../types';

export function CustomFields() {
  const [definitions, setDefinitions] = useState<TaskCustomFieldDefinition[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [attachFieldId, setAttachFieldId] = useState<string | null>(null);
  const [selectedBoards, setSelectedBoards] = useState<string[]>([]);
  const [form, setForm] = useState({ fieldKey: '', label: '', fieldType: 'TEXT', uiVisibility: 'ALWAYS', validationRegex: '', defaultValue: '' });

  useEffect(() => {
    Promise.all([api.customFields.list(), api.boards.list()])
      .then(([defs, boards]) => {
        setDefinitions(defs);
        setBoards(boards);
        setLoading(false);
      }).catch(() => setLoading(false));
  }, []);

  async function handleCreate() {
    const def = await api.customFields.create({
      fieldKey: form.fieldKey || form.label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      label: form.label,
      fieldType: form.fieldType,
      uiVisibility: form.uiVisibility,
      validationRegex: form.validationRegex || undefined,
      defaultValue: form.defaultValue || undefined,
    });
    setDefinitions(prev => [...prev, def]);
    setShowCreate(false);
    setForm({ fieldKey: '', label: '', fieldType: 'TEXT', uiVisibility: 'ALWAYS', validationRegex: '', defaultValue: '' });
  }

  async function handleDelete(id: string) {
    await api.customFields.delete(id);
    setDefinitions(prev => prev.filter(d => d.id !== id));
  }

  async function handleAttach() {
    if (!attachFieldId || selectedBoards.length === 0) return;
    await api.customFields.attach(attachFieldId, selectedBoards);
    setAttachFieldId(null);
    setSelectedBoards([]);
  }

  const fieldTypeLabels: Record<string, string> = {
    TEXT: 'Text', TEXT_LONG: 'Long Text', INTEGER: 'Integer', DECIMAL: 'Decimal',
    BOOLEAN: 'Boolean', DATE: 'Date', DATE_TIME: 'Date & Time', URL: 'URL', JSON: 'JSON',
  };

  if (loading) return <div className="p-6 text-gray-500">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Custom Fields</h1>
          <p className="text-sm text-gray-500 mt-1">Define custom fields for tasks and attach them to boards</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-nexus-600 hover:bg-nexus-500 text-white text-sm font-medium rounded-lg">
          Create Field
        </button>
      </div>

      <div className="space-y-3">
        {definitions.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-surface-850 border border-white/5 rounded-xl">No custom fields defined yet</div>
        ) : definitions.map(def => (
          <div key={def.id} className="bg-surface-850 border border-white/5 rounded-xl p-5 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h3 className="text-white font-medium">{def.label}</h3>
                <span className="px-2 py-0.5 text-xs rounded bg-surface-700 text-gray-400">{fieldTypeLabels[def.fieldType] || def.fieldType}</span>
                <span className="px-2 py-0.5 text-xs rounded bg-surface-700 text-gray-500">{def.uiVisibility.toLowerCase()}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">Key: {def.fieldKey} &middot; {def._count?.boardFields ?? 0} boards &middot; {def._count?.values ?? 0} values</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { setAttachFieldId(def.id); setSelectedBoards([]); }} className="px-3 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 text-gray-300 rounded-lg">Attach to Boards</button>
              <button onClick={() => handleDelete(def.id)} className="px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg">Delete</button>
            </div>
          </div>
        ))}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-surface-900 border border-white/10 rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-4">Create Custom Field</h2>
            <div className="space-y-3">
              <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Field label" className="w-full px-3 py-2 bg-surface-850 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600" />
              <input value={form.fieldKey} onChange={e => setForm(f => ({ ...f, fieldKey: e.target.value }))} placeholder="Field key (auto-generated if empty)" className="w-full px-3 py-2 bg-surface-850 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600" />
              <div className="grid grid-cols-2 gap-3">
                <select value={form.fieldType} onChange={e => setForm(f => ({ ...f, fieldType: e.target.value }))} className="px-3 py-2 bg-surface-850 border border-white/10 rounded-lg text-sm text-white">
                  {Object.entries(fieldTypeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select value={form.uiVisibility} onChange={e => setForm(f => ({ ...f, uiVisibility: e.target.value }))} className="px-3 py-2 bg-surface-850 border border-white/10 rounded-lg text-sm text-white">
                  <option value="ALWAYS">Always Visible</option>
                  <option value="IF_SET">Show If Set</option>
                  <option value="HIDDEN">Hidden</option>
                </select>
              </div>
              <input value={form.defaultValue} onChange={e => setForm(f => ({ ...f, defaultValue: e.target.value }))} placeholder="Default value (optional)" className="w-full px-3 py-2 bg-surface-850 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600" />
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2 bg-surface-800 text-gray-300 text-sm rounded-lg">Cancel</button>
              <button onClick={handleCreate} disabled={!form.label} className="flex-1 py-2 bg-nexus-600 hover:bg-nexus-500 text-white text-sm rounded-lg disabled:opacity-50">Create</button>
            </div>
          </div>
        </div>
      )}

      {attachFieldId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setAttachFieldId(null)}>
          <div className="bg-surface-900 border border-white/10 rounded-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-4">Attach to Boards</h2>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {boards.map(board => (
                <label key={board.id} className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 rounded-lg cursor-pointer">
                  <input type="checkbox" checked={selectedBoards.includes(board.id)} onChange={e => {
                    setSelectedBoards(prev => e.target.checked ? [...prev, board.id] : prev.filter(id => id !== board.id));
                  }} className="rounded" />
                  <span className="text-sm text-white">{board.name}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setAttachFieldId(null)} className="flex-1 py-2 bg-surface-800 text-gray-300 text-sm rounded-lg">Cancel</button>
              <button onClick={handleAttach} disabled={selectedBoards.length === 0} className="flex-1 py-2 bg-nexus-600 hover:bg-nexus-500 text-white text-sm rounded-lg disabled:opacity-50">Attach</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
