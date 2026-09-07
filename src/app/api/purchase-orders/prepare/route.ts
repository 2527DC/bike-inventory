export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { suggestedOrderQty } from "@/lib/reorder";
import { resolveVendors, groupByVendor, SOURCE_LABEL } from "@/lib/purchase-orders/resolve-vendor";
import { createLogger } from "@/lib/logger";

const log = createLogger("purchase-orders:prepare");

const prepareSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1, "Select at least one product").max(200, "Too many products (max 200)"),
  /** Optional per-product override; anything absent falls back to suggestedOrderQty. */
  quantities: z.record(z.string(), z.number().int().min(1)).optional(),
});

/**
 * Turn a set of product ids into the purchase orders they would become.
 *
 * READ ONLY. It writes nothing and reserves nothing — it answers "who supplies these, and what
 * would the lines look like", so `/purchase-orders/new` can render one section per vendor with
 * real prices and GST instead of the client guessing.
 *
 * ─── WHY THE SERVER DOES THIS ────────────────────────────────────────────────────────────
 *
 * The old `/reorder` handoff carried price and name through `sessionStorage`, and both were
 * wrong. `unitPrice` came from a `costPrice` the API withholds from anyone without
 * `cost_price.view`, so it arrived `undefined` and rendered ₹NaN; and `gstRate` was hardcoded
 * to **0**, which means every purchase order raised from `/reorder` until now has carried 0%
 * GST. The v2 handoff carries `{ productId, quantity }` and nothing else, and this route
 * supplies the rest under the caller's own permissions.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("purchase_orders", "create");
    const canSeeCost = await userCan(user.id, "cost_price", "view");

    const parsed = prepareSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request", 400);
    }
    const { productIds, quantities } = parsed.data;

    const products = await prisma.product.findMany({
      where: { id: { in: [...new Set(productIds)] } },
      select: {
        id: true,
        sku: true,
        name: true,
        currentStock: true,
        reorderLevel: true,
        reorderQty: true,
        gstRate: true,
        brandId: true,
        reorderVendorId: true,
        // Boolean select, the same gate api/products/route.ts uses: an ungranted caller never
        // has the number in the response at all, rather than having it blanked afterwards.
        costPrice: canSeeCost,
        brand: { select: { id: true, name: true } },
      },
    });

    if (products.length === 0) {
      return errorResponse("None of those products exist any more", 400);
    }

    const resolutions = await resolveVendors(products);
    const { groups, unresolved } = groupByVendor(products, resolutions);

    const line = (p: (typeof products)[number]) => ({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      currentStock: p.currentStock,
      reorderLevel: p.reorderLevel,
      reorderQty: p.reorderQty,
      quantity: quantities?.[p.id] ?? suggestedOrderQty(p),
      gstRate: p.gstRate,
      // Absent, not zero, when the caller cannot see cost. The screen renders an empty
      // required rate box for those lines — P9's rule: a ₹0 line must never reach a vendor.
      ...(canSeeCost ? { costPrice: p.costPrice } : {}),
      brand: p.brand,
    });

    log.info("prepared purchase orders", {
      requested: productIds.length,
      found: products.length,
      groups: groups.length,
      unresolved: unresolved.length,
      canSeeCost,
    });

    return successResponse({
      groups: groups.map((g) => ({
        vendorId: g.vendor.id,
        vendorName: g.vendor.name,
        whatsappNumber: g.vendor.whatsappNumber,
        phone: g.vendor.phone,
        source: g.source,
        sourceLabel: SOURCE_LABEL[g.source],
        items: g.products.map(line),
      })),
      unresolved: unresolved.map((u) => ({
        ...line(u.product),
        reason: u.reason,
        candidates: u.candidates.map((c) => ({ id: c.id, name: c.name })),
      })),
      // Products that were asked for and no longer exist. Named rather than silently dropped,
      // because a shorter purchase order than the one somebody selected is worse than an error.
      missing: productIds.filter((id) => !products.some((p) => p.id === id)),
      canSeeCost,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to prepare the purchase orders";
    log.error("prepare failed", { message });
    return errorResponse(message, 400);
  }
}
