import type { Prisma, PrismaClient } from "@prisma/client";
import { createLogger } from "@/lib/logger";

/**
 * Home-bin rule matching — plan 1709-priority-build-and-stock-flow, Part H (R39, P4, P13).
 *
 * ONE matcher for the three places that ask "where does this item live?":
 *
 *   1. the put-away suggestion (`api/inbound/[id]/putaway` GET),
 *   2. the rule-based inward (P4) — inbound receive with no hand-picked bin, and
 *      `api/inventory/inwards/verify`,
 *   3. "apply this rule to existing stock" (R40), which asks the question in reverse.
 *
 * Before this the chain lived inline in the put-away route only, so an inward that went
 * straight into stock ignored the rules entirely.
 *
 * ── PRECEDENCE (P13) ──
 *
 *   product  >  brand + category  >  category  >  brand
 *
 * The category test is EXACT, never a subtree walk. A rule always names a category with no
 * active children — `api/bins/home-rules` POST refuses a parent and asks for the subcategory —
 * so "the whole subtree" can never be what a rule meant. (The `/stock` FILTER is the opposite:
 * a parent there includes its children. Different question, different rule.)
 */

const log = createLogger("bins:rule-match");

export type Db = PrismaClient | Prisma.TransactionClient;

export type HomeBinMatchType = "product" | "brand_category" | "category" | "brand";

/** Everything a caller needs to place units and to tell the user why. */
export interface HomeBinRuleRow {
  id: string;
  brandId: string | null;
  categoryId: string | null;
  productId: string | null;
  binId: string;
  bin: {
    id: string;
    code: string;
    name: string;
    directions: string | null;
    isAssemblyArea: boolean;
    nonAssemblable: boolean;
    warehouseId: string;
  };
}

export interface HomeBinMatch {
  rule: HomeBinRuleRow;
  bin: HomeBinRuleRow["bin"];
  type: HomeBinMatchType;
  /** What the screen prints: "Brand + Category Rule". */
  label: string;
}

const LABELS: Record<HomeBinMatchType, string> = {
  product: "Product Rule",
  brand_category: "Brand + Category Rule",
  category: "Category Rule",
  brand: "Brand Rule",
};

/** The bin fields every caller needs; kept in one place so the shapes cannot drift. */
export const homeBinRuleInclude = {
  bin: {
    select: {
      id: true,
      code: true,
      name: true,
      directions: true,
      isAssemblyArea: true,
      nonAssemblable: true,
      warehouseId: true,
    },
  },
} as const;

/**
 * Every rule that could fire in a warehouse (or in all of them when `warehouseId` is omitted),
 * with its bin. Only rules pointing at an ACTIVE bin: a rule whose bin was retired must not
 * silently send stock into it.
 *
 * Load once per request and pass the list to `pickHomeBin` for each line — a shipment with 40
 * lines is one query, not 40.
 */
export async function loadHomeBinRules(db: Db, warehouseId?: string | null): Promise<HomeBinRuleRow[]> {
  const rules = await db.homeBinRule.findMany({
    where: {
      ...(warehouseId ? { warehouseId } : {}),
      warehouse: { isActive: true },
      bin: { isActive: true },
    },
    select: { id: true, brandId: true, categoryId: true, productId: true, binId: true, ...homeBinRuleInclude },
  });
  log.debug("home bin rules loaded", { warehouseId: warehouseId ?? null, count: rules.length });
  return rules;
}

export interface PickHomeBinItem {
  productId: string | null | undefined;
  brandId: string | null | undefined;
  categoryId: string | null | undefined;
}

/**
 * The matcher itself. Pure — no database, so it can run inside a loop over a shipment's lines
 * and inside a transaction without adding round trips.
 *
 * `rules` must already be scoped to the warehouse the item is going into; a caller holding
 * rules for several warehouses filters first (see `matchHomeBin`).
 */
export function pickHomeBin(rules: HomeBinRuleRow[], item: PickHomeBinItem): HomeBinMatch | null {
  const found = (rule: HomeBinRuleRow, type: HomeBinMatchType): HomeBinMatch => ({
    rule,
    bin: rule.bin,
    type,
    label: LABELS[type],
  });

  if (item.productId) {
    const byProduct = rules.find((r) => r.productId === item.productId);
    if (byProduct) return found(byProduct, "product");
  }
  if (item.brandId && item.categoryId) {
    const byBoth = rules.find(
      (r) => !r.productId && r.brandId === item.brandId && r.categoryId === item.categoryId
    );
    if (byBoth) return found(byBoth, "brand_category");
  }
  if (item.categoryId) {
    const byCategory = rules.find((r) => !r.productId && !r.brandId && r.categoryId === item.categoryId);
    if (byCategory) return found(byCategory, "category");
  }
  if (item.brandId) {
    const byBrand = rules.find((r) => !r.productId && !r.categoryId && r.brandId === item.brandId);
    if (byBrand) return found(byBrand, "brand");
  }
  return null;
}

/**
 * One product, one warehouse: the bin its home-bin rules send it to, or null.
 *
 * The convenience form for the inward paths (P4), which handle one line at a time and are
 * already inside a transaction. Reads the product's own brand and category — a caller with a
 * fallback (the shipment's brand/category on an unmatched line) uses `pickHomeBin` directly.
 */
export async function matchHomeBin(
  db: Db,
  input: { productId: string; warehouseId: string }
): Promise<HomeBinMatch | null> {
  const product = await db.product.findUnique({
    where: { id: input.productId },
    select: { id: true, brandId: true, categoryId: true },
  });
  if (!product) {
    log.warn("no product for home bin match", { productId: input.productId });
    return null;
  }

  const rules = await loadHomeBinRules(db, input.warehouseId);
  const match = pickHomeBin(rules, {
    productId: product.id,
    brandId: product.brandId,
    categoryId: product.categoryId,
  });

  log.debug("home bin matched", {
    productId: input.productId,
    warehouseId: input.warehouseId,
    ruleId: match?.rule.id ?? null,
    binId: match?.bin.id ?? null,
    type: match?.type ?? null,
  });
  return match;
}

// `ruleProductWhere` (the "apply rule to existing stock" query, 1709 R40) was removed with the
// per-rule Apply button and `api/bins/home-rules/[id]/apply` — plan 2109, Q21.
