import { prisma } from '@/lib/db';
import { ProductList } from './product-list';

export default async function ProductsPage() {
  const products = await prisma.lmsProduct.findMany({
    where: { isActive: true },
    orderBy: [{ price: 'asc' }, { name: 'asc' }],
  });

  const serialized = products.map((p) => ({
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    price: p.price ? Number(p.price) : null,
    image_url: p.imageUrl || null,
    usps: p.usps,
    features: p.features,
    talking_points: p.talkingPoints,
    target_customer: p.targetCustomer || null,
    common_objections: p.commonObjections as any[] || [],
    buyer_psychology: (p.buyerPsychology as any) || null,
    unique_fact: p.uniqueFact || null,
    specs: (p.specs as any) || {},
    competitors: (p.competitors as any[]) || [],
    reviews: (p.reviews as any) || { best: [], worst: [] },
    sources: (p.sources as any[]) || [],
    is_active: p.isActive,
    created_at: p.createdAt.toISOString(),
  }));

  return <ProductList products={serialized as any[]} />;
}
