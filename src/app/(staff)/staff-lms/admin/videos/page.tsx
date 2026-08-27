'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { extractYoutubeId } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import { ErrorToast } from '@/components/error-toast';

export default function AdminVideosPage() {
  const [categories, setCategories] = useState<any[]>([]);
  const [videos, setVideos] = useState<any[]>([]);
  const [showCatForm, setShowCatForm] = useState(false);
  const [showVideoForm, setShowVideoForm] = useState<string | null>(null);
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [vidTitle, setVidTitle] = useState('');
  const [vidDesc, setVidDesc] = useState('');
  const [vidUrl, setVidUrl] = useState('');
  const [vidDuration, setVidDuration] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await apiFetch('/api/staff-lms/videos');
      const data = await res.json();
      setCategories(data.categories || []);
      setVideos(data.videos || []);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveCategory() {
    setSaving(true);
    try {
      await apiFetch('/api/staff-lms/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'category', name: catName, description: catDesc }),
      });
      setCatName(''); setCatDesc(''); setShowCatForm(false);
      load();
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function saveVideo() {
    setSaving(true);
    try {
      await apiFetch('/api/staff-lms/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: vidTitle, description: vidDesc, youtube_url: vidUrl,
          category_id: showVideoForm, duration_minutes: vidDuration ? parseInt(vidDuration) : null,
        }),
      });
      setVidTitle(''); setVidDesc(''); setVidUrl(''); setVidDuration(''); setShowVideoForm(null);
      load();
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function deleteItem(id: string, type: string) {
    if (!confirm('Delete this?')) return;
    try {
      await apiFetch('/api/staff-lms/videos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, type }),
      });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const ytPreview = vidUrl ? extractYoutubeId(vidUrl) : null;

  return (
    <div className="space-y-4">
      <ErrorToast message={error} onClose={() => setError(null)} />
      <div className="flex items-center justify-between">
        <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-gray-500">
          <ArrowLeft size={16} /> Admin
        </Link>
        <button onClick={() => setShowCatForm(true)} className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium">
          <Plus size={16} /> Add Category
        </button>
      </div>

      {showCatForm && (
        <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-gray-900">New Category</h3>
            <button onClick={() => setShowCatForm(false)} className="text-gray-400"><X size={18} /></button>
          </div>
          <input placeholder="Category Name" value={catName} onChange={(e) => setCatName(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          <input placeholder="Description" value={catDesc} onChange={(e) => setCatDesc(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          <button onClick={saveCategory} disabled={!catName || saving} className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50">Save</button>
        </div>
      )}

      {showVideoForm && (
        <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-gray-900">New Video</h3>
            <button onClick={() => setShowVideoForm(null)} className="text-gray-400"><X size={18} /></button>
          </div>
          <input placeholder="Video Title" value={vidTitle} onChange={(e) => setVidTitle(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          <input placeholder="Description" value={vidDesc} onChange={(e) => setVidDesc(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          <input placeholder="YouTube URL" value={vidUrl} onChange={(e) => setVidUrl(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          {ytPreview && (
            <img src={`https://img.youtube.com/vi/${ytPreview}/mqdefault.jpg`} alt="Preview" className="w-full rounded-xl" />
          )}
          <input placeholder="Duration (minutes)" type="number" value={vidDuration} onChange={(e) => setVidDuration(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          <button onClick={saveVideo} disabled={!vidTitle || !vidUrl || saving} className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50">Save Video</button>
        </div>
      )}

      {categories.map((cat) => {
        const catVids = videos.filter((v) => v.category_id === cat.id);
        return (
          <div key={cat.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-50">
              <div>
                <h3 className="font-semibold text-sm text-gray-900">{cat.name}</h3>
                <p className="text-[10px] text-gray-400">{catVids.length} videos</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowVideoForm(cat.id)} className="text-blue-600 text-xs font-medium">+ Video</button>
                <button onClick={() => deleteItem(cat.id, 'category')} className="text-red-400"><Trash2 size={14} /></button>
              </div>
            </div>
            {catVids.map((v) => (
              <div key={v.id} className="flex items-center justify-between px-4 py-2 border-b border-gray-50 last:border-0">
                <p className="text-sm text-gray-700 truncate flex-1">{v.title}</p>
                <button onClick={() => deleteItem(v.id, 'video')} className="text-red-400 p-1"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
