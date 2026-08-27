'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';

interface Objection {
  objection: string;
  response: string;
  productName: string;
  brand: string;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function FlashcardsPage() {
  const [allObjections, setAllObjections] = useState<Objection[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [brandFilter, setBrandFilter] = useState('');
  const [deck, setDeck] = useState<Objection[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/staff-lms/products')
      .then((r) => r.json())
      .then((d) => {
        const products = d.products ?? [];
        const brandSet = new Set<string>();
        const objs: Objection[] = [];
        for (const p of products) {
          brandSet.add(p.brand);
          const objections = (p.common_objections ?? []) as Array<{
            objection?: string;
            response?: string;
          }>;
          for (const o of objections) {
            if (o.objection && o.response) {
              objs.push({
                objection: o.objection,
                response: o.response,
                productName: p.name,
                brand: p.brand,
              });
            }
          }
        }
        setBrands(Array.from(brandSet).sort());
        setAllObjections(objs);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () => (brandFilter ? allObjections.filter((o) => o.brand === brandFilter) : allObjections),
    [allObjections, brandFilter],
  );

  const reshuffleDeck = useCallback(() => {
    setDeck(shuffle(filtered));
    setIndex(0);
    setFlipped(false);
  }, [filtered]);

  useEffect(() => {
    reshuffleDeck();
  }, [reshuffleDeck]);

  const card = deck[index];

  const next = () => {
    setFlipped(false);
    setIndex((i) => Math.min(i + 1, deck.length - 1));
  };

  const prev = () => {
    setFlipped(false);
    setIndex((i) => Math.max(i - 1, 0));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (deck.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 mt-20">
        No objection cards available{brandFilter ? ` for ${brandFilter}` : ''}.
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 max-w-md mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">Objection Cards</h1>
        <button
          onClick={reshuffleDeck}
          className="text-xs font-medium text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full active:bg-blue-100 transition"
        >
          Shuffle
        </button>
      </div>

      <select
        value={brandFilter}
        onChange={(e) => setBrandFilter(e.target.value)}
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-600"
      >
        <option value="">All Brands</option>
        {brands.map((b) => (
          <option key={b} value={b}>{b}</option>
        ))}
      </select>

      <p className="text-xs text-gray-400 text-center mb-3">
        Card {index + 1} of {deck.length}
      </p>

      <div
        className="perspective-1000 cursor-pointer mb-6"
        style={{ perspective: '1000px' }}
        onClick={() => setFlipped((f) => !f)}
      >
        <div
          className="relative w-full transition-transform duration-500"
          style={{
            transformStyle: 'preserve-3d',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
            minHeight: '280px',
          }}
        >
          {/* Front */}
          <div
            className="absolute inset-0 rounded-2xl shadow-lg bg-white border border-gray-100 flex flex-col items-center justify-center p-8 text-center"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-4">Customer says...</p>
            <p className="text-lg font-semibold text-gray-900 mb-6 leading-relaxed">
              &ldquo;{card.objection}&rdquo;
            </p>
            <span className="inline-block bg-gray-100 text-gray-600 text-xs px-3 py-1 rounded-full">
              {card.productName}
            </span>
            <p className="text-xs text-gray-400 mt-6">Tap to reveal response</p>
          </div>

          {/* Back */}
          <div
            className="absolute inset-0 rounded-2xl shadow-lg bg-blue-600 flex flex-col items-center justify-center p-8 text-center"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <p className="text-xs text-blue-200 uppercase tracking-wide mb-4">Your response</p>
            <p className="text-base text-white leading-relaxed">{card.response}</p>
            <p className="text-xs text-blue-300 mt-6">Tap to flip back</p>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={prev}
          disabled={index === 0}
          className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm font-medium text-gray-700 disabled:opacity-30 active:bg-gray-50 transition"
        >
          Previous
        </button>
        <button
          onClick={next}
          disabled={index === deck.length - 1}
          className="flex-1 py-3 rounded-2xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-30 active:bg-blue-700 transition"
        >
          Next
        </button>
      </div>
    </div>
  );
}
