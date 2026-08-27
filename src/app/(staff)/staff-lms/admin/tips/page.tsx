'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, X } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { ErrorToast } from '@/components/error-toast';

interface Tip {
  id: string;
  content: string;
  category: string;
  scheduledFor: string | null;
  isActive: boolean;
  createdAt: string;
}

const categoryColors: Record<string, string> = {
  general: 'bg-gray-100 text-gray-600',
  product: 'bg-blue-100 text-blue-700',
  objection: 'bg-orange-100 text-orange-700',
  closing: 'bg-green-100 text-green-700',
  motivation: 'bg-purple-100 text-purple-700',
};

export default function AdminTipsPage() {
  const [tips, setTips] = useState<Tip[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('general');
  const [scheduledFor, setScheduledFor] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchTips = async () => {
    try {
      const res = await apiFetch('/api/staff-lms/daily-tips?all=true');
      setTips(await res.json());
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => { fetchTips(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      await apiFetch('/api/staff-lms/daily-tips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.trim(),
          category,
          scheduledFor: scheduledFor || null,
        }),
      });
      setContent('');
      setCategory('general');
      setScheduledFor('');
      setShowForm(false);
      fetchTips();
    } catch (e: any) {
      setError(e.message);
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this tip?')) return;
    try {
      await apiFetch('/api/staff-lms/daily-tips', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      fetchTips();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <ErrorToast message={error} onClose={() => setError(null)} />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft size={20} />
          </Link>
          <h2 className="text-xl font-bold text-gray-900">Daily Tips</h2>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1 bg-blue-600 text-white px-3 py-2 rounded-xl text-sm font-medium"
        >
          {showForm ? <X size={16} /> : <Plus size={16} />}
          {showForm ? 'Cancel' : 'Add Tip'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          <textarea
            placeholder="Tip content..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            required
          />
          <div className="flex gap-3">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="general">General</option>
              <option value="product">Product</option>
              <option value="objection">Objection</option>
              <option value="closing">Closing</option>
              <option value="motivation">Motivation</option>
            </select>
            <input
              type="date"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-50"
          >
            {submitting ? 'Adding...' : 'Add Tip'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-center text-gray-400 text-sm py-8">Loading...</p>
      ) : tips.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-8">No tips yet</p>
      ) : (
        <div className="space-y-3">
          {tips.map((t) => (
            <div key={t.id} className="bg-white rounded-2xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryColors[t.category] || categoryColors.general}`}>
                      {t.category}
                    </span>
                    {t.scheduledFor && (
                      <span className="text-xs text-gray-400">
                        {new Date(t.scheduledFor).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-700">{t.content}</p>
                </div>
                <button onClick={() => handleDelete(t.id)} className="text-gray-300 hover:text-red-500 p-1">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
