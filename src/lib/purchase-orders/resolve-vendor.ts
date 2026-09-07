import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("purchase-orders:resolve-vendor");

export type VendorSource = "PRODUCT" | "BRAND_PRIMARY" | "BRAND_ONLY";
export type UnresolvedReason = "NO_VENDOR" | "AMBIGUOUS";

export interface VendorRef {
  id: string;
  name: string;
  whatsappNumber: string | null;
  phone: string | null;
}

export type Resolution =
  | { resolved: true; vendor: VendorRef; source: VendorSource }
  | { resolved: false; reason: UnresolvedReason; candidates: VendorRef[] };

/** The product fields the resolver reads. Structural, so callers can pass rows they already hold. */
export interface ResolvableProduct {
  id: string;
  brandId: string | null;
  reorderVendorId: string | null;
}

/** Human wording for the caption under a read-only vendor. */
export const SOURCE_LABEL: Record<VendorSource, string> = {
  PRODUCT: "set on the product",
  BRAND_PRIMARY: "from the brand's primary vendor",
  BRAND_ONLY: "the only vendor for this brand",
};

/**
 * Work out which vendor supplies each product.
 *
 * Order, highest confidence first:
 *   1. `Product.reorderVendorId`, if that vendor is still active  → PRODUCT
 *   2. the brand's `BrandVendor` row marked `isPrimary`           → BRAND_PRIMARY
 *   3. exactly one `BrandVendor` row for the brand                → BRAND_ONLY
 *   4. otherwise unresolved: NO_VENDOR, or AMBIGUOUS with the candidates listed
 *
 * TWO bulk queries regardless of how many products come in — one `vendor.findMany` for the
 * distinct reorder vendors, one `brandVendor.findMany` for the distinct brands. Resolving a
 * fifty-line order must not be fifty round trips.
 *
 * ─── WHAT YOU SHOULD EXPECT ON DAY ONE ───────────────────────────────────────────────────
 *
 * Tiers 2 and 3 read `brand_vendors`, and **that table is empty**. Nothing in this codebase
 * has ever written it: no seed, no import, no migration, no route, no screen — only the
 * `CREATE TABLE` in `0_init`. It has four READERS (both ledger routes and both ledger
 * screens) and zero writers, which is why `docs/dead-code.md` lists it as unpopulated.
 *
 * So until somebody fills it in through `PUT /api/vendors/[id]/brands`, every product whose
 * `reorderVendorId` is null resolves to NO_VENDOR. That is not a bug in this function; it is
 * the honest answer, and the screens are built to say so rather than to guess.
 *
 * Deactivated vendors are treated as absent at every tier — `isActive` is a soft delete
 * (`DELETE /api/vendors/[id]` flips the flag), so a stale `reorderVendorId` must fall through
 * to the brand rather than put a vendor the shop has stopped buying from onto an order.
 */
export async function resolveVendors(
  products: ResolvableProduct[]
): Promise<Map<string, Resolution>> {
  const out = new Map<string, Resolution>();
  if (products.length === 0) return out;

  const vendorIds = [...new Set(products.map((p) => p.reorderVendorId).filter((v): v is string => !!v))];
  const brandIds = [...new Set(products.map((p) => p.brandId).filter((v): v is string => !!v))];

  const [vendors, brandVendors] = await Promise.all([
    vendorIds.length
      ? prisma.vendor.findMany({
          where: { id: { in: vendorIds }, isActive: true },
          select: { id: true, name: true, whatsappNumber: true, phone: true },
        })
      : Promise.resolve([]),
    brandIds.length
      ? prisma.brandVendor.findMany({
          // The relation filter keeps deactivated vendors out of the candidate list, so an
          // AMBIGUOUS answer never offers one the shop has stopped using.
          where: { brandId: { in: brandIds }, vendor: { isActive: true } },
          select: {
            brandId: true,
            isPrimary: true,
            vendor: { select: { id: true, name: true, whatsappNumber: true, phone: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const activeVendorById = new Map(vendors.map((v) => [v.id, v]));

  const byBrand = new Map<string, Array<{ vendor: VendorRef; isPrimary: boolean }>>();
  for (const bv of brandVendors) {
    const list = byBrand.get(bv.brandId) ?? [];
    list.push({ vendor: bv.vendor, isPrimary: bv.isPrimary });
    byBrand.set(bv.brandId, list);
  }

  let unresolvedCount = 0;

  for (const p of products) {
    // 1. the product's own vendor, if still active
    if (p.reorderVendorId) {
      const v = activeVendorById.get(p.reorderVendorId);
      if (v) {
        out.set(p.id, { resolved: true, vendor: v, source: "PRODUCT" });
        continue;
      }
      // Falls through deliberately: the id points at a vendor that has been deactivated, so
      // the brand is a better answer than a dead vendor.
    }

    const candidates = p.brandId ? (byBrand.get(p.brandId) ?? []) : [];

    // 2. the brand's primary
    const primaries = candidates.filter((c) => c.isPrimary);
    if (primaries.length === 1) {
      out.set(p.id, { resolved: true, vendor: primaries[0].vendor, source: "BRAND_PRIMARY" });
      continue;
    }
    if (primaries.length > 1) {
      // Nothing in the database stops two vendors both claiming primary for one brand —
      // there is no partial unique index, and the editor enforces it in application code
      // only. If that has been circumvented, say AMBIGUOUS rather than picking one at random.
      log.warn("brand has more than one primary vendor", {
        brandId: p.brandId,
        vendorIds: primaries.map((c) => c.vendor.id),
      });
      out.set(p.id, { resolved: false, reason: "AMBIGUOUS", candidates: primaries.map((c) => c.vendor) });
      unresolvedCount++;
      continue;
    }

    // 3. exactly one vendor for the brand
    if (candidates.length === 1) {
      out.set(p.id, { resolved: true, vendor: candidates[0].vendor, source: "BRAND_ONLY" });
      continue;
    }

    // 4. no answer
    out.set(p.id, {
      resolved: false,
      reason: candidates.length > 1 ? "AMBIGUOUS" : "NO_VENDOR",
      candidates: candidates.map((c) => c.vendor),
    });
    unresolvedCount++;
  }

  log.debug("resolved vendors", {
    products: products.length,
    unresolved: unresolvedCount,
    brandsQueried: brandIds.length,
  });

  return out;
}

/**
 * Group resolved products by vendor, keeping the unresolved ones aside.
 *
 * The order of `groups` follows first appearance in `products`, so a screen renders vendors in
 * the order the person selected their items rather than alphabetically — which is what makes
 * "the first section is the one I was just looking at" true.
 */
export function groupByVendor<T extends { id: string }>(
  products: T[],
  resolutions: Map<string, Resolution>
): {
  groups: Array<{ vendor: VendorRef; source: VendorSource; products: T[] }>;
  unresolved: Array<{ product: T; reason: UnresolvedReason; candidates: VendorRef[] }>;
} {
  const groups: Array<{ vendor: VendorRef; source: VendorSource; products: T[] }> = [];
  const byVendorId = new Map<string, number>();
  const unresolved: Array<{ product: T; reason: UnresolvedReason; candidates: VendorRef[] }> = [];

  for (const p of products) {
    const r = resolutions.get(p.id);
    if (!r || !r.resolved) {
      unresolved.push({
        product: p,
        reason: r && !r.resolved ? r.reason : "NO_VENDOR",
        candidates: r && !r.resolved ? r.candidates : [],
      });
      continue;
    }
    const idx = byVendorId.get(r.vendor.id);
    if (idx === undefined) {
      byVendorId.set(r.vendor.id, groups.length);
      groups.push({ vendor: r.vendor, source: r.source, products: [p] });
    } else {
      groups[idx].products.push(p);
    }
  }

  return { groups, unresolved };
}
