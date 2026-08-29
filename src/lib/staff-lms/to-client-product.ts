// camelCase API row -> snake_case shape the Staff LMS product screens consume.
//
// This mapping used to live inline in three server components (products/page.tsx,
// product-learning/page.tsx, and a byte-identical copy of each). Those pages queried Prisma
// directly, which made Next prerender them at BUILD time and open a database connection —
// the reason `npm run build` failed with no Postgres running. The pages now fetch from
// GET /api/staff-lms/products like the rest of the app, so the adapter has to live somewhere
// a client component can import.
//
// Two shapes exist because `ProductList` and the `[id]` screens were ported from the
// standalone LMS app, which spoke snake_case, while the API returns the Prisma row. Folding
// them into one shape is worth doing, but it reaches into the compare and flashcard screens
// too, so it is deliberately NOT part of the build fix.

import type { SerializedLmsProduct } from "@/lib/staff-lms/serialize";
import type { LmsProduct } from "@/types/lms";

/**
 * `SerializedLmsProduct` as it arrives over HTTP.
 *
 * JSON has no Date and no Decimal: `createdAt` reaches the browser as an ISO string, and
 * `price` as a string, which is why the conversion below goes through `Number()` rather
 * than trusting the declared type.
 */
export type ApiLmsProduct = Omit<SerializedLmsProduct, 'createdAt' | 'price'> & {
  createdAt: string;
  price: string | number | null;
};

export function toClientProduct(p: ApiLmsProduct): LmsProduct {
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    // `Number(null)` is 0, and a free bicycle is worse than an unpriced one — so the null
    // check comes first and is deliberate, not defensive noise.
    price: p.price === null || p.price === '' ? null : Number(p.price),
    image_url: p.imageUrl || null,
    usps: p.usps,
    features: p.features,
    talking_points: p.talkingPoints,
    target_customer: p.targetCustomer || null,
    common_objections: p.commonObjections || [],
    buyer_psychology: p.buyerPsychology || null,
    unique_fact: p.uniqueFact || null,
    specs: p.specs || {},
    competitors: p.competitors || [],
    reviews: p.reviews || { best: [], worst: [] },
    sources: p.sources || [],
    // The inline version omitted `faqs` entirely and papered over the resulting type error
    // with `products={serialized as any[]}`. It is mapped here, and the cast is gone.
    faqs: p.faqs || [],
    is_active: p.isActive,
    created_at: p.createdAt,
  };
}

/**
 * Price ascending, then name — the order the product screens have always shown.
 *
 * `GET /api/staff-lms/products` sorts by brand, because other callers want it that way.
 * Sorting here keeps this screen identical rather than reordering every other consumer of
 * a shared endpoint. Unpriced products sort last.
 */
export function byPriceThenName(a: LmsProduct, b: LmsProduct): number {
  if (a.price !== b.price) {
    if (a.price === null) return 1;
    if (b.price === null) return -1;
    return a.price - b.price;
  }
  return a.name.localeCompare(b.name);
}
