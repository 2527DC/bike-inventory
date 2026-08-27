import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { ProductDetail } from './product-detail';

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [product, user, videos] = await Promise.all([
    prisma.lmsProduct.findUnique({ where: { id } }),
    getCurrentUser(),
    prisma.lmsVideo.findMany({ where: { lmsProductId: id, isActive: true }, orderBy: { sortOrder: 'asc' } }),
  ]);

  if (!product) notFound();

  const serialized = {
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    price: product.price ? Number(product.price) : null,
    image_url: product.imageUrl || null,
    usps: product.usps,
    features: product.features,
    talking_points: product.talkingPoints,
    target_customer: product.targetCustomer || null,
    common_objections: product.commonObjections as any[] || [],
    buyer_psychology: (product.buyerPsychology as any) || null,
    unique_fact: product.uniqueFact || null,
    specs: (product.specs as any) || {},
    competitors: (product.competitors as any[]) || [],
    reviews: (product.reviews as any) || { best: [], worst: [] },
    sources: (product.sources as any[]) || [],
    faqs: (product.faqs as any[]) || [],
    is_active: product.isActive,
    created_at: product.createdAt.toISOString(),
  };

  const serializedVideos = videos.map((v) => ({
    id: v.id,
    title: v.title,
    description: v.description,
    youtube_url: v.youtubeUrl,
  }));

  return <ProductDetail product={serialized as any} isAdmin={!!user} videos={serializedVideos} />;
}
