'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { ErrorToast } from '@/components/error-toast';

const TYPES = ['walk-in', 'phone', 'repeat', 'festival', 'parent', 'comparison', 'service-upsell'];
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

export default function AdminScenariosPage() {
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('walk-in');
  const [description, setDescription] = useState('');
  const [difficulty, setDifficulty] = useState('beginner');
  const [steps, setSteps] = useState(['']);
  const [tips, setTips] = useState(['']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await apiFetch('/api/staff-lms/scenarios');
      const data = await res.json();
      setScenarios(data.scenarios || []);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await apiFetch('/api/staff-lms/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, type, description, difficulty,
          checklist: steps.filter(Boolean).map((step) => ({ step, done: false })),
          tips: tips.filter(Boolean),
        }),
      });
      setTitle(''); setType('walk-in'); setDescription(''); setDifficulty('beginner');
      setSteps(['']); setTips(['']); setShowForm(false);
      load();
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function deleteScenario(id: string) {
    if (!confirm('Remove this scenario?')) return;
    try {
      await apiFetch('/api/staff-lms/scenarios', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorToast message={error} onClose={() => setError(null)} />
      <div className="flex items-center justify-between">
        <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-gray-500">
          <ArrowLeft size={16} /> Admin
        </Link>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium">
          <Plus size={16} /> Add Scenario
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-gray-900">New Scenario</h3>
            <button onClick={() => setShowForm(false)} className="text-gray-400"><X size={18} /></button>
          </div>
          <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          <div className="grid grid-cols-2 gap-3">
            <select value={type} onChange={(e) => setType(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm">
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          <div>
            <label className="text-xs font-medium text-gray-600">Checklist Steps</label>
            {steps.map((step, i) => (
              <div key={i} className="flex gap-2 mt-1">
                <input value={step} onChange={(e) => { const arr = [...steps]; arr[i] = e.target.value; setSteps(arr); }} placeholder={`Step ${i + 1}`} className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                <button onClick={() => setSteps(steps.filter((_, idx) => idx !== i))} className="text-gray-400"><X size={16} /></button>
              </div>
            ))}
            <button onClick={() => setSteps([...steps, ''])} className="text-xs text-blue-600 mt-1">+ Add step</button>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Pro Tips</label>
            {tips.map((tip, i) => (
              <div key={i} className="flex gap-2 mt-1">
                <input value={tip} onChange={(e) => { const arr = [...tips]; arr[i] = e.target.value; setTips(arr); }} placeholder={`Tip ${i + 1}`} className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                <button onClick={() => setTips(tips.filter((_, idx) => idx !== i))} className="text-gray-400"><X size={16} /></button>
              </div>
            ))}
            <button onClick={() => setTips([...tips, ''])} className="text-xs text-blue-600 mt-1">+ Add tip</button>
          </div>
          <button onClick={save} disabled={!title || saving} className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium text-sm disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Scenario'}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {scenarios.map((s) => (
          <div key={s.id} className="bg-white rounded-xl p-4 shadow-sm flex items-center justify-between">
            <div>
              <p className="font-medium text-sm text-gray-900">{s.title}</p>
              <p className="text-xs text-gray-500">{s.type} · {s.difficulty} · {(s.checklist as any[])?.length || 0} steps</p>
            </div>
            <button onClick={() => deleteScenario(s.id)} className="text-red-400 p-2"><Trash2 size={16} /></button>
          </div>
        ))}
        {scenarios.length === 0 && <p className="text-center text-gray-400 text-sm py-8">No scenarios yet.</p>}
      </div>
    </div>
  );
}
