'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search, Zap, Mountain, Bike, Route, Baby, ChevronRight, Plus, X, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ErrorToast } from '@/components/error-toast';
import type { LmsProduct as Product } from '@/types/lms';

const BRANDS = ['EMotorad', 'Firefox', 'Raleigh', 'Hero', 'Hercules', 'Montra', 'Giant', 'Other'];
const ADD_CATEGORIES = ['MTB', 'Road', 'Hybrid', 'City', 'Kids', 'E-Cycles', 'BMX'];

const CATEGORIES = [
  { key: 'all', label: 'All', icon: Bike },
  { key: 'E-Cycles', label: 'E-Cycles', icon: Zap },
  { key: 'MTB', label: 'MTB', icon: Mountain },
  { key: 'Hybrid', label: 'Hybrid', icon: Route },
  { key: 'Road', label: 'Road', icon: Bike },
  { key: 'Kids', label: 'Kids', icon: Baby },
  { key: 'City', label: 'City', icon: Bike },
];

const CATEGORY_COLORS: Record<string, string> = {
  'E-Cycles': 'bg-blue-50 text-blue-500',
  'MTB': 'bg-green-50 text-green-500',
  'Hybrid': 'bg-purple-50 text-purple-500',
  'Road': 'bg-red-50 text-red-500',
  'Kids': 'bg-yellow-50 text-yellow-500',
  'City': 'bg-gray-100 text-gray-500',
};

export function ProductList({ products }: { products: Product[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addBrand, setAddBrand] = useState('');
  const [addCategory, setAddCategory] = useState('MTB');
  const [addPrice, setAddPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addProduct() {
    if (!addName.trim() || !addBrand) return;
    setSaving(true);
    try {
      await apiFetch('/api/staff-lms/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addName.trim(),
          brand: addBrand,
          category: addCategory,
          price: addPrice ? parseFloat(addPrice) : null,
        }),
      });
      setAddName(''); setAddBrand(''); setAddPrice(''); setShowAdd(false);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  const filtered = products.filter((p) => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.brand.toLowerCase().includes(search.toLowerCase());
    const matchCategory = activeCategory === 'all' || p.category === activeCategory;
    return matchSearch && matchCategory;
  });

  const categoryCounts = CATEGORIES.map((c) => ({
    ...c,
    count: c.key === 'all' ? products.length : products.filter((p) => p.category === c.key).length,
  })).filter((c) => c.count > 0);

  return (
    <div className="space-y-4">
      <ErrorToast message={error} onClose={() => setError(null)} />

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Know every bike inside out.</p>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium">
          <Plus size={14} /> Add Bike
        </button>
      </div>

      {showAdd && (
        <div className="bg-blue-50 rounded-2xl p-4 shadow-sm space-y-3 border border-blue-200">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-blue-900 text-sm">Add a New Bike</h3>
            <button onClick={() => setShowAdd(false)} className="text-blue-400"><X size={18} /></button>
          </div>
          <input placeholder="Bike Name (e.g. Firefox Tremor 29)" value={addName} onChange={(e) => setAddName(e.target.value)} className="w-full px-3 py-2.5 border border-blue-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300" />
          <div className="grid grid-cols-2 gap-2">
            <select value={addBrand} onChange={(e) => setAddBrand(e.target.value)} className="px-3 py-2.5 border border-blue-200 rounded-xl text-sm bg-white">
              <option value="">Select Brand</option>
              {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={addCategory} onChange={(e) => setAddCategory(e.target.value)} className="px-3 py-2.5 border border-blue-200 rounded-xl text-sm bg-white">
              {ADD_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <input placeholder="Price (₹) — optional" type="number" value={addPrice} onChange={(e) => setAddPrice(e.target.value)} className="w-full px-3 py-2.5 border border-blue-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300" />
          <button onClick={addProduct} disabled={saving || !addName.trim() || !addBrand} className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium text-sm disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <><Loader2 size={14} className="animate-spin" /> Adding...</> : 'Add to Study List'}
          </button>
        </div>
      )}

      {/* Category Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
        {categoryCounts.map((cat) => {
          const Icon = cat.icon;
          const active = activeCategory === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => { setActiveCategory(cat.key); setSearch(''); }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs whitespace-nowrap transition-colors ${
                active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              <Icon size={13} />
              {cat.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                {cat.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name or brand..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-3 bg-white rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
      </div>

      {/* Product Cards */}
      <div className="space-y-3">
        {filtered.map((product) => (
          <Link
            key={product.id}
            href={`/staff-lms/products/${product.id}`}
            className="block bg-white rounded-2xl p-4 shadow-sm card-hover"
          >
            <div className="flex items-start gap-3">
              <div className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 ${CATEGORY_COLORS[product.category] || 'bg-gray-100 text-gray-400'}`}>
                {product.image_url ? (
                  <img src={product.image_url} alt={product.name} className="w-full h-full object-cover rounded-xl" />
                ) : product.category === 'E-Cycles' ? (
                  <Zap size={22} />
                ) : product.category === 'MTB' ? (
                  <Mountain size={22} />
                ) : product.category === 'Road' ? (
                  <Bike size={22} />
                ) : product.category === 'Kids' ? (
                  <Baby size={22} />
                ) : (
                  <Bike size={22} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900 text-sm">{product.name}</h3>
                <p className="text-xs text-gray-500">{product.brand} · {product.category}</p>
                {product.price && (
                  <p className="text-sm font-bold text-blue-600 mt-1">₹{product.price.toLocaleString('en-IN')}</p>
                )}
                {product.usps.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {product.usps.slice(0, 2).map((usp, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full truncate max-w-[180px]">
                        {usp}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <ChevronRight size={18} className="text-gray-300 mt-1" />
            </div>
          </Link>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-gray-400 py-8">No bikes match your search.</p>
      )}
    </div>
  );
}
