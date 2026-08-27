'use client';

import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Plus, X, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { ErrorToast } from '@/components/error-toast';

interface SettingsList {
  items: string[];
  loading: boolean;
  saving: boolean;
}

export default function AdminSettingsPage() {
  const [brands, setBrands] = useState<SettingsList>({ items: [], loading: true, saving: false });
  const [categories, setCategories] = useState<SettingsList>({ items: [], loading: true, saving: false });
  const [newBrand, setNewBrand] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async (key: string) => {
    try {
      const res = await apiFetch(`/api/staff-lms/settings?key=${key}`);
      const data = await res.json();
      return data.value || [];
    } catch {
      return [];
    }
  }, []);

  const saveSettings = useCallback(async (key: string, value: string[]) => {
    try {
      await apiFetch('/api/staff-lms/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
    } catch (e: any) {
      setError(e.message);
      throw e;
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchSettings('brands'), fetchSettings('categories')]).then(([b, c]) => {
      setBrands({ items: b, loading: false, saving: false });
      setCategories({ items: c, loading: false, saving: false });
    });
  }, [fetchSettings]);

  async function addBrand() {
    const v = newBrand.trim();
    if (!v || brands.items.includes(v)) return;
    const updated = [...brands.items, v];
    setBrands(s => ({ ...s, saving: true }));
    try {
      await saveSettings('brands', updated);
      setBrands({ items: updated, loading: false, saving: false });
      setNewBrand('');
    } catch {
      setBrands(s => ({ ...s, saving: false }));
    }
  }

  async function removeBrand(item: string) {
    const updated = brands.items.filter(b => b !== item);
    setBrands(s => ({ ...s, saving: true }));
    try {
      await saveSettings('brands', updated);
      setBrands({ items: updated, loading: false, saving: false });
    } catch {
      setBrands(s => ({ ...s, saving: false }));
    }
  }

  async function addCategory() {
    const v = newCategory.trim();
    if (!v || categories.items.includes(v)) return;
    const updated = [...categories.items, v];
    setCategories(s => ({ ...s, saving: true }));
    try {
      await saveSettings('categories', updated);
      setCategories({ items: updated, loading: false, saving: false });
      setNewCategory('');
    } catch {
      setCategories(s => ({ ...s, saving: false }));
    }
  }

  async function removeCategory(item: string) {
    const updated = categories.items.filter(c => c !== item);
    setCategories(s => ({ ...s, saving: true }));
    try {
      await saveSettings('categories', updated);
      setCategories({ items: updated, loading: false, saving: false });
    } catch {
      setCategories(s => ({ ...s, saving: false }));
    }
  }

  return (
    <div className="space-y-6 pb-8">
      <ErrorToast message={error} onClose={() => setError(null)} />
      <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-gray-500">
        <ArrowLeft size={16} /> Back to Admin
      </Link>

      <h1 className="text-lg font-bold text-gray-900">Settings</h1>

      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <h2 className="font-bold text-gray-900 text-sm mb-3">Brands</h2>
        {brands.loading ? (
          <div className="flex justify-center py-4"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
        ) : (
          <>
            <div className="space-y-1.5 mb-3">
              {brands.items.length === 0 && <p className="text-xs text-gray-400">No brands added yet.</p>}
              {brands.items.map(item => (
                <div key={item} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                  <span className="text-sm text-gray-800">{item}</span>
                  <button onClick={() => removeBrand(item)} className="p-0.5 text-red-400 hover:text-red-600"><X size={14} /></button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newBrand} onChange={e => setNewBrand(e.target.value)} onKeyDown={e => e.key === 'Enter' && addBrand()} placeholder="Add brand..." className="flex-1 text-sm border border-gray-300 rounded-xl px-3 py-2" />
              <button onClick={addBrand} disabled={brands.saving} className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl disabled:opacity-50 flex items-center gap-1">
                {brands.saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add
              </button>
            </div>
          </>
        )}
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <h2 className="font-bold text-gray-900 text-sm mb-3">Categories</h2>
        {categories.loading ? (
          <div className="flex justify-center py-4"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
        ) : (
          <>
            <div className="space-y-1.5 mb-3">
              {categories.items.length === 0 && <p className="text-xs text-gray-400">No categories added yet.</p>}
              {categories.items.map(item => (
                <div key={item} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                  <span className="text-sm text-gray-800">{item}</span>
                  <button onClick={() => removeCategory(item)} className="p-0.5 text-red-400 hover:text-red-600"><X size={14} /></button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newCategory} onChange={e => setNewCategory(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCategory()} placeholder="Add category..." className="flex-1 text-sm border border-gray-300 rounded-xl px-3 py-2" />
              <button onClick={addCategory} disabled={categories.saving} className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl disabled:opacity-50 flex items-center gap-1">
                {categories.saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
