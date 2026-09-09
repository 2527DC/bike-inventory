import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("po-extraction:matcher");

/**
 * Matches rows extracted from a vendor's quotation to products in our catalogue.
 * Plan 0909-po-ai-upload, P1 / §5.3 — derived from the brand-stock matcher, with:
 *
 *   - NO saved-mappings phase. The owner answered Q6 "match fresh each time" (9 Sep 2026),
 *     consistent with nothing from an upload persisting past the PO.
 *   - the fuzzy phase scoped to WHAT THE VENDOR SUPPLIES — the product's own
 *     `reorderVendorId`, or any product of a brand linked to the vendor — which is the scope
 *     /api/products/search already applies when given a vendorId. If the vendor supplies
 *     nothing yet (brand_vendors is empty until somebody fills it in), it falls back to the
 *     whole active catalogue rather than matching nothing.
 *
 * The scoring (`normalize` / `fuzzyScore`) is the brand-stock matcher's, unchanged: it is the
 * part of that module worth keeping.
 */

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

export function fuzzyScore(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.85;

  const wordsA = na.split(" ");
  const wordsB = nb.split(" ");
  const total = Math.max(wordsA.length, wordsB.length);
  if (total === 0) return 0;

  let matched = 0;
  for (const wa of wordsA) {
    if (wa.length < 2) continue;
    if (wordsB.some((wb) => wb === wa || wb.includes(wa) || wa.includes(wb))) matched++;
  }

  return matched / total;
}

/** The floor below which a fuzzy hit is not offered at all. */
export const FUZZY_THRESHOLD = 0.6;

export interface MatchInput {
  id: string;
  rawSku: string | null;
  rawName: string;
}

export type MatchStatus = "AUTO" | "FUZZY" | "MANUAL" | "UNMATCHED";

export interface MatchResult {
  itemId: string;
  productId: string;
  status: Extract<MatchStatus, "AUTO" | "FUZZY">;
  confidence: number;
}

/**
 * Phase 1 — exact SKU (case-insensitive) against the active catalogue: AUTO, confidence 1.
 * Phase 2 — fuzzy name against the vendor's products (or the whole catalogue): FUZZY.
 * Rows with no result are UNMATCHED; the review screen lets the person map them by hand.
 */
export async function matchExtractedRows(items: MatchInput[], vendorId: string): Promise<MatchResult[]> {
  const results: MatchResult[] = [];
  const matched = new Set<string>();

  // Phase 1: exact SKU
  const withSku = items.filter((i) => i.rawSku && i.rawSku.trim().length > 0);
  if (withSku.length > 0) {
    const skus = withSku.map((i) => i.rawSku!.trim());
    const products = await prisma.product.findMany({
      where: { sku: { in: skus, mode: "insensitive" }, status: "ACTIVE" },
      select: { id: true, sku: true },
    });
    const bySku = new Map(products.map((p) => [p.sku.toLowerCase(), p.id]));
    for (const item of withSku) {
      const pid = bySku.get(item.rawSku!.trim().toLowerCase());
      if (pid) {
        results.push({ itemId: item.id, productId: pid, status: "AUTO", confidence: 1.0 });
        matched.add(item.id);
      }
    }
  }

  // Phase 2: fuzzy name, scoped to the vendor
  const unmatched = items.filter((i) => !matched.has(i.id));
  if (unmatched.length > 0) {
    const select = { id: true, name: true, sku: true } as const;
    let candidates = await prisma.product.findMany({
      where: {
        status: "ACTIVE",
        OR: [{ reorderVendorId: vendorId }, { brand: { vendors: { some: { vendorId } } } }],
      },
      select,
    });
    let scope: "vendor" | "catalogue" = "vendor";
    if (candidates.length === 0) {
      candidates = await prisma.product.findMany({ where: { status: "ACTIVE" }, select });
      scope = "catalogue";
    }

    for (const item of unmatched) {
      let bestScore = 0;
      let bestProductId = "";
      for (const p of candidates) {
        const score = fuzzyScore(item.rawName, p.name);
        if (score > bestScore) {
          bestScore = score;
          bestProductId = p.id;
        }
      }
      if (bestScore >= FUZZY_THRESHOLD) {
        results.push({ itemId: item.id, productId: bestProductId, status: "FUZZY", confidence: bestScore });
        matched.add(item.id);
      }
    }

    log.debug("fuzzy phase", { vendorId, scope, candidates: candidates.length, rows: unmatched.length });
  }

  log.info("rows matched", {
    vendorId,
    rows: items.length,
    auto: results.filter((r) => r.status === "AUTO").length,
    fuzzy: results.filter((r) => r.status === "FUZZY").length,
    unmatched: items.length - results.length,
  });

  return results;
}
