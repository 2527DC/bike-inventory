import { loadHomeBinRules, pickHomeBin, type Db, type HomeBinMatch } from "@/lib/bins/rule-match";
import { createLogger } from "@/lib/logger";

/**
 * The home-bin rule LOCK on an inbound line — plan 2109-inbound-bins-navigation-fixes, R34.
 *
 * A line whose product a home-bin rule matches goes into the rule's bin and nowhere else: the
 * screen shows that bin locked, and the server refuses any other. Both the receive branch of
 * `PUT /api/inbound/[id]` and `POST /api/inbound/[id]/putaway` ask this one function, so the two
 * cannot disagree about what "the rule's bin" is.
 *
 * It asks the question exactly the way the screen's suggestion does (`putaway` GET): the
 * product's own brand and category first, the SHIPMENT's as the fallback for a product that
 * carries none. `matchHomeBin` reads the product only, so a line the screen locked through the
 * shipment's brand would be refused here with its own locked bin — hence `pickHomeBin` over the
 * warehouse's rules, the same matcher underneath.
 *
 * The warehouse is the one the chosen BIN stands in: a rule only speaks for its own warehouse.
 */

const log = createLogger("inbound:rule-bin");

/** Thrown inside a receive / put-away transaction so the claim rolls back; the route answers 409. */
export class RuleBinLocked extends Error {
  constructor(
    message: string,
    public readonly context: { lineItemId: string; binId: string; ruleBinId: string; ruleId: string }
  ) {
    super(message);
    this.name = "RuleBinLocked";
  }
}

export interface RuleBinInput {
  productId: string;
  warehouseId: string;
  /** The shipment's brand / category — the fallback for a product that carries none. */
  shipmentBrandId?: string | null;
  shipmentCategoryId?: string | null;
}

/** The rule that decides this product's bin in this warehouse, or null when none does. */
export async function ruleBinForLine(db: Db, input: RuleBinInput): Promise<HomeBinMatch | null> {
  const product = await db.product.findUnique({
    where: { id: input.productId },
    select: { id: true, brandId: true, categoryId: true },
  });
  if (!product) {
    log.warn("no product for inbound rule check", { productId: input.productId });
    return null;
  }
  const rules = await loadHomeBinRules(db, input.warehouseId);
  return pickHomeBin(rules, {
    productId: product.id,
    brandId: product.brandId || input.shipmentBrandId,
    categoryId: product.categoryId || input.shipmentCategoryId,
  });
}

/**
 * Throws `RuleBinLocked` when a rule matches and `binId` is not the rule's bin. Returns the
 * match (or null) so the caller can say in its log and movement reason that the rule placed it.
 */
export async function assertRuleBin(
  db: Db,
  input: RuleBinInput & { lineItemId: string; binId: string }
): Promise<HomeBinMatch | null> {
  const match = await ruleBinForLine(db, input);
  if (match && match.bin.id !== input.binId) {
    throw new RuleBinLocked(
      `This item's bin is set by rule ${match.label} (bin ${match.bin.code}). Receive it into ${match.bin.code}.`,
      { lineItemId: input.lineItemId, binId: input.binId, ruleBinId: match.bin.id, ruleId: match.rule.id }
    );
  }
  return match;
}
