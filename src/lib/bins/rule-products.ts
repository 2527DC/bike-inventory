import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { categorySubtreeIds } from "@/lib/categories/tree";

const log = createLogger("bins:rule-products");

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The products a bin's audit lists (plan 2109-bin-audit-lists-rule-products, R1, R2).
 *
 * Every ACTIVE product that matches BOTH the brand and the category of one of this bin's
 * home-bin rules (including any subcategories). The owner, 21 Sep 2026: "must match both the brand
 * and the category — not just category, not just brand." A rule missing either side lists nothing.
 * Such rules can no longer be created (R5), and any old one is flagged on /bins.
 *
 * One product is listed once however many rules match it. It cannot land in two bins' audits:
 * a warehouse holds one rule per brand + category pair (saving the pair again moves it, see
 * POST /api/bins/home-rules).
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

  // Resolve subtrees for each category so that a category rule also includes its products & descendants
  const uniqueCategoryIds = [...new Set(rules.map((r) => r.categoryId!))];
  const subtreeMap = new Map<string, string[]>();
  for (const catId of uniqueCategoryIds) {
    subtreeMap.set(catId, await categorySubtreeIds(db, catId));
  }

  const orConditions = rules.flatMap((r) => {
    const subIds = subtreeMap.get(r.categoryId!) ?? [r.categoryId!];
    return subIds.map((subId) => ({
      brandId: r.brandId!,
      categoryId: subId,
    }));
  });

  const products = await db.product.findMany({
    where: {
      status: "ACTIVE",
      OR: orConditions,
    },
    select: { id: true },
  });

  log.debug("rule products for bin", { binId, rules: rules.length, products: products.length });
  return products.map((p) => p.id);
}
