'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Trash2, X, Search, AlertCircle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { ErrorToast } from '@/components/error-toast';

interface ProductForm {
  name: string;
  brand: string;
  category: string;
  price: string;
  image_url: string;
  target_customer: string;
  usps: string[];
  features: string[];
  talking_points: string[];
  common_objections: { objection: string; response: string }[];
}

const EMPTY_FORM: ProductForm = {
  name: '', brand: '', category: 'MTB', price: '', image_url: '', target_customer: '',
  usps: [''], features: [''], talking_points: [''], common_objections: [{ objection: '', response: '' }],
};

const CATEGORIES = ['MTB', 'Road', 'Hybrid', 'City', 'Kids', 'E-Cycles', 'BMX'];
const BRANDS = ['EMotorad', 'Firefox', 'Raleigh', 'Hero', 'Hercules', 'Montra', 'Giant', 'Other'];

export default function AdminProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickBrand, setQuickBrand] = useState('');
  const [quickCategory, setQuickCategory] = useState('MTB');
  const [quickPrice, setQuickPrice] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadProducts(); }, []);

  async function loadProducts() {
    try {
      const res = await apiFetch('/api/staff-lms/products');
      const data = await res.json();
      setProducts(data.products || []);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function quickAddProduct() {
    if (!quickName || !quickBrand) return;
    setSaving(true);
    try {
      await apiFetch('/api/staff-lms/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: quickName,
          brand: quickBrand,
          category: quickCategory,
          price: quickPrice ? parseFloat(quickPrice) : null,
        }),
      });
      setQuickName('');
      setQuickBrand('');
      setQuickPrice('');
      setShowQuickAdd(false);
      loadProducts();
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function saveProduct() {
    setSaving(true);
    try {
      const body = {
        ...form,
        price: form.price ? parseFloat(form.price) : null,
        usps: form.usps.filter(Boolean),
        features: form.features.filter(Boolean),
        talking_points: form.talking_points.filter(Boolean),
        common_objections: form.common_objections.filter((o) => o.objection && o.response),
      };
      await apiFetch('/api/staff-lms/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setShowForm(false);
      setForm(EMPTY_FORM);
      loadProducts();
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function deleteProduct(id: string) {
    if (!confirm('Remove this product?')) return;
    try {
      await apiFetch('/api/staff-lms/products', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      loadProducts();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function addListItem(field: 'usps' | 'features' | 'talking_points') {
    setForm({ ...form, [field]: [...form[field], ''] });
  }

  function updateListItem(field: 'usps' | 'features' | 'talking_points', index: number, value: string) {
    const arr = [...form[field]];
    arr[index] = value;
    setForm({ ...form, [field]: arr });
  }

  function removeListItem(field: 'usps' | 'features' | 'talking_points', index: number) {
    setForm({ ...form, [field]: form[field].filter((_, i) => i !== index) });
  }

  function hasData(p: any): boolean {
    return (p.usps?.length > 0 || p.features?.length > 0 || p.specs && Object.keys(p.specs).length > 0);
  }

  const filtered = products.filter((p) =>
    !filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.brand.toLowerCase().includes(filter.toLowerCase())
  );

  const withData = products.filter(hasData).length;
  const withoutData = products.length - withData;

  return (
    <div className="space-y-4">
      <ErrorToast message={error} onClose={() => setError(null)} />
      <div className="flex items-center justify-between">
        <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-gray-500">
          <ArrowLeft size={16} /> Admin
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white rounded-xl p-3 shadow-sm text-center">
          <p className="text-xl font-bold text-gray-900">{products.length}</p>
          <p className="text-[10px] text-gray-500">Total</p>
        </div>
        <div className="bg-white rounded-xl p-3 shadow-sm text-center">
          <p className="text-xl font-bold text-green-600">{withData}</p>
          <p className="text-[10px] text-gray-500">Detailed</p>
        </div>
        <div className="bg-white rounded-xl p-3 shadow-sm text-center">
          <p className="text-xl font-bold text-orange-500">{withoutData}</p>
          <p className="text-[10px] text-gray-500">Need Data</p>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setShowQuickAdd(true)} className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium">
          <Plus size={16} /> Quick Add Bicycle
        </button>
        <button onClick={() => setShowForm(true)} className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium">
          <Plus size={16} /> Detailed
        </button>
      </div>

      {showQuickAdd && (
        <div className="bg-blue-50 rounded-2xl p-4 shadow-sm space-y-3 border border-blue-200">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-blue-900 text-sm">Add Bicycle to Study List</h3>
            <button onClick={() => setShowQuickAdd(false)} className="text-blue-400"><X size={18} /></button>
          </div>
          <p className="text-xs text-blue-600">Just enter the name and brand. Details will be fetched automatically.</p>
          <input placeholder="Bicycle Name (e.g. EMotorad T-Rex V3)" value={quickName} onChange={(e) => setQuickName(e.target.value)} className="w-full px-3 py-2.5 border border-blue-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white" />
          <div className="grid grid-cols-2 gap-2">
            <select value={quickBrand} onChange={(e) => setQuickBrand(e.target.value)} className="px-3 py-2.5 border border-blue-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
              <option value="">Select Brand</option>
              {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={quickCategory} onChange={(e) => setQuickCategory(e.target.value)} className="px-3 py-2.5 border border-blue-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <input placeholder="Price (Rs.) -- optional" type="number" value={quickPrice} onChange={(e) => setQuickPrice(e.target.value)} className="w-full px-3 py-2.5 border border-blue-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300" />
          <button onClick={quickAddProduct} disabled={saving || !quickName || !quickBrand} className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium text-sm disabled:opacity-50">
            {saving ? 'Adding...' : 'Add to Study List'}
          </button>
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-900">New Product (Detailed)</h3>
            <button onClick={() => setShowForm(false)} className="text-gray-400"><X size={20} /></button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Product Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="col-span-2 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            <select value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="">Select Brand *</option>
              {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200">
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <input placeholder="Price (Rs.)" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            <input placeholder="Image URL" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <input placeholder="Target Customer" value={form.target_customer} onChange={(e) => setForm({ ...form, target_customer: e.target.value })} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          {(['usps', 'features', 'talking_points'] as const).map((field) => (
            <div key={field}>
              <label className="text-xs font-medium text-gray-600 uppercase">{field.replace(/_/g, ' ')}</label>
              {form[field].map((item, i) => (
                <div key={i} className="flex gap-2 mt-1">
                  <input value={item} onChange={(e) => updateListItem(field, i, e.target.value)} placeholder={`Add ${field.replace(/_/g, ' ').slice(0, -1)}`} className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                  <button onClick={() => removeListItem(field, i)} className="text-gray-400"><X size={16} /></button>
                </div>
              ))}
              <button onClick={() => addListItem(field)} className="text-xs text-blue-600 mt-1">+ Add more</button>
            </div>
          ))}
          <div>
            <label className="text-xs font-medium text-gray-600 uppercase">Common Objections</label>
            {form.common_objections.map((obj, i) => (
              <div key={i} className="mt-2 space-y-1">
                <input value={obj.objection} onChange={(e) => { const arr = [...form.common_objections]; arr[i] = { ...arr[i], objection: e.target.value }; setForm({ ...form, common_objections: arr }); }} placeholder="Customer says..." className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                <input value={obj.response} onChange={(e) => { const arr = [...form.common_objections]; arr[i] = { ...arr[i], response: e.target.value }; setForm({ ...form, common_objections: arr }); }} placeholder="You respond..." className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
              </div>
            ))}
            <button onClick={() => setForm({ ...form, common_objections: [...form.common_objections, { objection: '', response: '' }] })} className="text-xs text-blue-600 mt-1">+ Add objection</button>
          </div>
          <button onClick={saveProduct} disabled={saving || !form.name || !form.brand} className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium text-sm disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Product'}
          </button>
        </div>
      )}

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input placeholder="Search products..." value={filter} onChange={(e) => setFilter(e.target.value)} className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
      </div>

      <div className="space-y-2">
        {filtered.map((p) => {
          const complete = hasData(p);
          return (
            <div key={p.id} className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${complete ? 'bg-green-400' : 'bg-orange-400'}`} />
                <div className="flex-1 min-w-0">
                  <Link href={`/products/${p.id}`} className="font-medium text-sm text-gray-900 hover:text-blue-600 truncate block">{p.name}</Link>
                  <p className="text-xs text-gray-500">{p.brand} · {p.category}{p.price ? ` · Rs.${Number(p.price).toLocaleString('en-IN')}` : ''}</p>
                </div>
                <div className="flex items-center gap-1">
                  {complete ? <CheckCircle2 size={16} className="text-green-500" /> : <AlertCircle size={16} className="text-orange-400" />}
                  <button onClick={() => deleteProduct(p.id)} className="text-red-300 p-1.5 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <p className="text-center text-gray-400 text-sm py-8">No products found.</p>}
      </div>
    </div>
  );
}
