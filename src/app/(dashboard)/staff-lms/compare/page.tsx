'use client';

import { useState, useEffect, useMemo } from 'react';

interface Product {
  id: string;
  name: string;
  brand: string;
  category: string;
  price: number | null;
  features: string[];
  usps: string[];
  specs: Record<string, string>;
  image_url: string | null;
}

export default function ComparePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [idA, setIdA] = useState('');
  const [idB, setIdB] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/staff-lms/products')
      .then((r) => r.json())
      .then((d) => setProducts(d.products ?? []))
      .finally(() => setLoading(false));
  }, []);

  const productA = useMemo(() => products.find((p) => p.id === idA), [products, idA]);
  const productB = useMemo(() => products.find((p) => p.id === idB), [products, idB]);

  const specKeys = useMemo(() => {
    if (!productA || !productB) return [];
    const keys = new Set([
      ...Object.keys(productA.specs ?? {}),
      ...Object.keys(productB.specs ?? {}),
    ]);
    return Array.from(keys).sort();
  }, [productA, productB]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-4">Compare Products</h1>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Product A</label>
          <select
            value={idA}
            onChange={(e) => setIdA(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="">Select...</option>
            {products.map((p) => (
              <option key={p.id} value={p.id} disabled={p.id === idB}>
                {p.brand} - {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Product B</label>
          <select
            value={idB}
            onChange={(e) => setIdB(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="">Select...</option>
            {products.map((p) => (
              <option key={p.id} value={p.id} disabled={p.id === idA}>
                {p.brand} - {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {productA && productB && (
        <>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 w-1/3">Attribute</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-blue-600 w-1/3">{productA.name}</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-blue-600 w-1/3">{productB.name}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                <Row label="Brand" a={productA.brand} b={productB.brand} />
                <Row label="Category" a={productA.category} b={productB.category} />
                <Row
                  label="Price"
                  a={productA.price != null ? `\u20B9${productA.price.toLocaleString('en-IN')}` : '-'}
                  b={productB.price != null ? `\u20B9${productB.price.toLocaleString('en-IN')}` : '-'}
                  winA={productA.price != null && productB.price != null && productA.price < productB.price}
                  winB={productA.price != null && productB.price != null && productB.price < productA.price}
                />
                <Row
                  label="Features"
                  a={String(productA.features?.length ?? 0)}
                  b={String(productB.features?.length ?? 0)}
                  winA={(productA.features?.length ?? 0) > (productB.features?.length ?? 0)}
                  winB={(productB.features?.length ?? 0) > (productA.features?.length ?? 0)}
                />
                <Row
                  label="USPs"
                  a={(productA.usps ?? []).join(', ') || '-'}
                  b={(productB.usps ?? []).join(', ') || '-'}
                />
                {specKeys.map((key) => (
                  <Row
                    key={key}
                    label={key}
                    a={(productA.specs as any)?.[key] ?? '-'}
                    b={(productB.specs as any)?.[key] ?? '-'}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={() => window.open(`/showroom/${productA.id}`, '_blank')}
            className="mt-4 w-full bg-blue-600 text-white rounded-2xl py-3 text-sm font-semibold active:bg-blue-700 transition"
          >
            Share Product A with Customer
          </button>
        </>
      )}
    </div>
  );
}

function Row({
  label,
  a,
  b,
  winA,
  winB,
}: {
  label: string;
  a: string;
  b: string;
  winA?: boolean;
  winB?: boolean;
}) {
  return (
    <tr>
      <td className="px-4 py-2.5 text-xs font-medium text-gray-500">{label}</td>
      <td className={`px-4 py-2.5 text-sm ${winA ? 'text-green-700 font-semibold bg-green-50' : 'text-gray-900'}`}>
        {a}
      </td>
      <td className={`px-4 py-2.5 text-sm ${winB ? 'text-green-700 font-semibold bg-green-50' : 'text-gray-900'}`}>
        {b}
      </td>
    </tr>
  );
}
