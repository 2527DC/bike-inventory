import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ResearchPortal } from './research-portal';

export default async function AdminResearchPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/');

  const products = await prisma.lmsProduct.findMany({
    where: { isActive: true },
    orderBy: [{ brand: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, brand: true, category: true, price: true, imageUrl: true, sources: true },
  });

  const serialized = products.map((p) => ({
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    price: p.price ? Number(p.price) : null,
    image_url: p.imageUrl,
    website_url: ((p.sources as any[]) || []).find((s: any) => s.title?.toLowerCase().includes('official'))?.url || '',
  }));

  return <ResearchPortal products={serialized} />;
}
