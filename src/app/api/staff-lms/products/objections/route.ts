export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { guarded } from "@/lib/staff-lms/route";
import { serializeLmsProduct } from "@/lib/staff-lms/serialize";

/**
 * Flashcard deck: product objections only.
 *
 * §5.4 — the current flashcards screen fetches the entire product catalog with all JSON
 * columns just to extract objections client-side. This endpoint returns only the fields the
 * flashcard deck needs, and filters out products with zero objections.
 */
export const GET = guarded(
  "staff_lms_products",
  "view",
  "staff-lms:products:objections",
  async () => {
    const products = await prisma.lmsProduct.findMany({
      where: { isActive: true },
      orderBy: [{ brand: "asc" }, { name: "asc" }],
    });

    const cards = products
      .map((p) => {
        const s = serializeLmsProduct(p);
        return {
          id: s.id,
          name: s.name,
          brand: s.brand,
          imageUrl: s.imageUrl,
          commonObjections: s.commonObjections,
        };
      })
      .filter((c) => c.commonObjections.length > 0);

    return successResponse(cards);
  }
);
