'use client';

import { useState } from 'react';
import { Search, Globe, Plus, Save, Loader2, ExternalLink, PlayCircle, Image as ImageIcon, CheckCircle, AlertCircle } from 'lucide-react';
import Link from 'next/link';

interface ProductEntry {
  id: string;
  name: string;
  brand: string;
  category: string;
  price: number | null;
  image_url: string | null;
  website_url: string;
}

export function ResearchPortal({ products }: { products: ProductEntry[] }) {
  const [entries, setEntries] = useState<ProductEntry[]>(products);
  const [newProduct, setNewProduct] = useState({ name: '', brand: '', category: 'E-Cycle', website_url: '' });
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [searching, setSearching] = useState<Record<string, boolean>>({});
  const [searchResults, setSearchResults] = useState<Record<string, any>>({});

  async function saveWebsiteUrl(id: string, url: string) {
    setSaving((s) => ({ ...s, [id]: true }));
    setSaved((s) => ({ ...s, [id]: false }));
    try {
      // Fetch existing sources first, then merge
      const getRes = await fetch(`/api/staff-lms/products`);
      const getData = await getRes.json();
      const existing = getData.products?.find((p: any) => p.id === id);
      const currentSources: any[] = existing?.sources || [];
      const filtered = currentSources.filter((s: any) => s.title !== 'Official Website');
      const merged = [{ title: 'Official Website', url }, ...filtered];
      const res = await fetch('/api/staff-lms/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, sources: merged }),
      });
      if (res.ok) setSaved((s) => ({ ...s, [id]: true }));
    } catch {}
    setSaving((s) => ({ ...s, [id]: false }));
  }

  async function searchYouTube(id: string, productName: string) {
    setSearching((s) => ({ ...s, [id]: true }));
    try {
      const res = await fetch('/api/staff-lms/research/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: id, productName }),
      });
      const data = await res.json();
      setSearchResults((s) => ({ ...s, [id]: data }));
    } catch {}
    setSearching((s) => ({ ...s, [id]: false }));
  }

  async function addProduct() {
    if (!newProduct.name || !newProduct.brand) return;
    setSaving((s) => ({ ...s, new: true }));
    try {
      const res = await fetch('/api/staff-lms/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProduct.name,
          brand: newProduct.brand,
          category: newProduct.category,
          sources: newProduct.website_url ? [{ title: 'Official Website', url: newProduct.website_url }] : [],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setEntries((e) => [...e, {
          id: data.product.id,
          name: newProduct.name,
          brand: newProduct.brand,
          category: newProduct.category,
          price: null,
          image_url: null,
          website_url: newProduct.website_url,
        }]);
        setNewProduct({ name: '', brand: '', category: 'E-Cycle', website_url: '' });
        setShowAdd(false);
      }
    } catch {}
    setSaving((s) => ({ ...s, new: false }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Product Research Portal</h2>
          <p className="text-xs text-gray-500">Add product names & website links. Use these to research and fill product details.</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-xl text-xs font-semibold">
          <Plus size={14} /> Add Product
        </button>
      </div>

      {/* Add New Product Form */}
      {showAdd && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-bold text-blue-900">New Product</p>
          <div className="grid grid-cols-2 gap-2">
            <input value={newProduct.name} onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))} placeholder="Product Name" className="text-sm border border-gray-300 rounded-xl p-2.5" />
            <input value={newProduct.brand} onChange={(e) => setNewProduct((p) => ({ ...p, brand: e.target.value }))} placeholder="Brand" className="text-sm border border-gray-300 rounded-xl p-2.5" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={newProduct.category} onChange={(e) => setNewProduct((p) => ({ ...p, category: e.target.value }))} placeholder="Category" className="text-sm border border-gray-300 rounded-xl p-2.5" />
            <input value={newProduct.website_url} onChange={(e) => setNewProduct((p) => ({ ...p, website_url: e.target.value }))} placeholder="Website URL (Google it)" className="text-sm border border-gray-300 rounded-xl p-2.5" />
          </div>
          <div className="flex gap-2">
            <button onClick={addProduct} disabled={saving['new']} className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl disabled:opacity-50">
              {saving['new'] ? 'Creating...' : 'Create Product'}
            </button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 bg-gray-200 text-gray-700 text-xs font-semibold rounded-xl">Cancel</button>
          </div>
        </div>
      )}

      {/* Product List */}
      <div className="space-y-2">
        {entries.map((product) => (
          <div key={product.id} className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-3">
              {product.image_url ? (
                <img src={product.image_url} alt={product.name} className="w-14 h-14 object-contain rounded-xl bg-gray-50" />
              ) : (
                <div className="w-14 h-14 bg-gray-100 rounded-xl flex items-center justify-center">
                  <ImageIcon size={20} className="text-gray-300" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-gray-900 truncate">{product.name}</p>
                <p className="text-xs text-gray-500">{product.brand} · {product.category}</p>
                {product.price && <p className="text-xs font-bold text-blue-600">₹{product.price.toLocaleString('en-IN')}</p>}
              </div>
              <Link href={`/products/${product.id}`} className="text-xs text-blue-600 font-medium">View →</Link>
            </div>

            {/* Website URL Input */}
            <div className="flex items-center gap-2">
              <Globe size={14} className="text-gray-400 flex-shrink-0" />
              <input
                value={entries.find((e) => e.id === product.id)?.website_url || ''}
                onChange={(e) => setEntries((arr) => arr.map((p) => p.id === product.id ? { ...p, website_url: e.target.value } : p))}
                placeholder="Paste official product website URL here..."
                className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-300 focus:border-blue-300"
              />
              <button
                onClick={() => saveWebsiteUrl(product.id, entries.find((e) => e.id === product.id)?.website_url || '')}
                disabled={saving[product.id]}
                className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                {saving[product.id] ? <Loader2 size={12} className="animate-spin" /> : saved[product.id] ? <CheckCircle size={12} className="text-green-500" /> : <Save size={12} />}
                Save
              </button>
              {entries.find((e) => e.id === product.id)?.website_url && (
                <a href={entries.find((e) => e.id === product.id)?.website_url} target="_blank" rel="noopener noreferrer" className="p-2 text-blue-500 hover:text-blue-700">
                  <ExternalLink size={14} />
                </a>
              )}
            </div>

            {/* YouTube Search */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => searchYouTube(product.id, `${product.brand} ${product.name}`)}
                disabled={searching[product.id]}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-50 text-red-700 text-xs font-medium rounded-lg hover:bg-red-100 disabled:opacity-50"
              >
                {searching[product.id] ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={14} />}
                {searching[product.id] ? 'Searching...' : 'Find YouTube Videos'}
              </button>
              {searchResults[product.id] && (
                <span className="text-xs text-gray-500">
                  {searchResults[product.id].added || 0} videos linked
                </span>
              )}
            </div>

            {/* Search Results */}
            {searchResults[product.id]?.videos && searchResults[product.id].videos.length > 0 && (
              <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Linked Videos</p>
                {searchResults[product.id].videos.map((v: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <PlayCircle size={12} className="text-red-500 flex-shrink-0" />
                    <a href={v.youtubeUrl || v.youtube_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate flex-1">{v.title}</a>
                    <CheckCircle size={12} className="text-green-500 flex-shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {entries.length === 0 && (
        <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
          <Search size={32} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No products yet. Add your first product above.</p>
        </div>
      )}
    </div>
  );
}
