import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("bins:rule-products");

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The products a bin's audit lists (plan 2109-bin-audit-lists-rule-products, R1, R2).
 *
 * Every ACTIVE product that matches BOTH the brand and the category of one of this bin's
 * home-bin rules. The owner, 21 Sep 2026: "must match both the brand and the category — not
 * just category, not just brand." A rule missing either side lists nothing. Such rules can no
 * longer be created (R5), and any old one is flagged on /bins.
 *
 * One product is listed once however many rules match it. It cannot land in two bins' audits:
 * a warehouse holds one rule per brand + category pair (saving the pair again moves it, see
 * POST /api/bins/home-rules).
 *
 * A rule's category is always a leaf: a subcategory is mandatory when one exists (plan 2109,
 * Q3). So an exact `categoryId` match is the whole test, and no descendant walk is needed.
 */
export async function productIdsForBinRules(binId: string, db: Db = prisma): Promise<string[]> {
  const rules = await db.homeBinRule.findMany({
    where: { binId, brandId: { not: null }, categoryId: { not: null } },
    select: { brandId: true, categoryId: true },
  });
  if (rules.length === 0) {
    log.debug("bin has no brand + category rules", { binId });
    return [];
  }

  const products = await db.product.findMany({
    where: {
      status: "ACTIVE",
      OR: rules.map((r) => ({ brandId: r.brandId!, categoryId: r.categoryId! })),
    },
    select: { id: true },
  });

  log.debug("rule products for bin", { binId, rules: rules.length, products: products.length });
  return products.map((p) => p.id);
}
