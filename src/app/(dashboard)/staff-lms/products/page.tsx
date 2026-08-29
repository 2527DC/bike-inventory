'use client';

// Client component on purpose. This page used to query Prisma as a server component with no
// per-request input, so Next prerendered it at BUILD time and `npm run build` needed a live
// Postgres. It now fetches from the same guarded endpoint the rest of the app uses.

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { ProductList } from './product-list';
import { apiFetch } from '@/lib/api-client';
import { createLogger } from '@/lib/logger';
import { SkeletonList } from '@/components/ui/skeleton';
import { toClientProduct, byPriceThenName, type ApiLmsProduct } from '@/lib/staff-lms/to-client-product';
import type { LmsProduct } from '@/types/lms';

const log = createLogger('staff-lms:products');

export default function ProductsPage() {
  const [products, setProducts] = useState<LmsProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ApiLmsProduct[]>('/api/staff-lms/products')
      .then((rows) => setProducts(rows.map(toClientProduct).sort(byPriceThenName)))
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : 'Failed to load products';
        log.error('product list load failed', { message });
        setError(message);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <SkeletonList count={5} type="card" />;

  // The server version could not fail visibly — a throw became a 500 page. These two states
  // are what docs/agents/frontend-engineer.md requires of any component that fetches.
  if (error) {
    return (
      <div className="text-center py-10">
        <AlertCircle className="h-8 w-8 text-red-300 mx-auto mb-2" />
        <p className="text-sm text-slate-600">{error}</p>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-sm text-slate-400">No products yet.</p>
      </div>
    );
  }

  return <ProductList products={products} />;
}
