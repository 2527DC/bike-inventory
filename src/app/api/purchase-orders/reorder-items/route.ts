export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, paginatedResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { findReorderItems } from "@/lib/purchase-orders/reorder-items";
import { createLogger } from "@/lib/logger";

const log = createLogger("purchase-orders:reorder-items");

const querySchema = z.object({
  vendorId: z.string().min(1, "Choose a vendor first"),
  page: z.coerce.number().int().min(1).default(1),
  // 10 is the page the New PO modal shows (R6); 50 caps what one request may ask for.
  limit: z.coerce.number().int().min(1).max(50).default(10),
  search: z.string().trim().max(100, "Search is too long").optional(),
});

/**
 * GET /api/purchase-orders/reorder-items?vendorId=…&page=1&limit=10&search=…
 *
 * The "Add reorder items" modal on New Purchase Order (plan 1509-reorder-inside-purchase-orders,
 * R2–R6): the vendor's products whose stock is at or below their reorder level, a page at a
 * time, with the quantity each one starts at. The rule itself lives in
 * `lib/purchase-orders/reorder-items.ts`.
 *
 * READ ONLY. Guarded on `purchase_orders.create`, the same as `purchase-orders/prepare`: it is a
 * helper for raising a purchase order, not the Reorder tab (which stays on `reorder.view`). No
 * price anywhere — a purchase order carries no money (plan 1509-po-product-and-quantity-only).
 */
export async function GET(req: NextRequest) {
  let vendorId: string | undefined;
  try {
    await requireFeature("purchase_orders", "create");

    const sp = new URL(req.url).searchParams;
    const parsed = querySchema.safeParse({
      vendorId: sp.get("vendorId") ?? undefined,
      page: sp.get("page") ?? undefined,
      limit: sp.get("limit") ?? undefined,
      search: sp.get("search") || undefined,
    });
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request", 400);
    }
    const { page, limit, search } = parsed.data;
    vendorId = parsed.data.vendorId;

    // An inactive vendor is refused rather than listed: resolveVendors treats it as absent, so
    // PO save would refuse every line this list offered for it.
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, name: true, isActive: true },
    });
    if (!vendor) return errorResponse("That vendor no longer exists", 400);
    if (!vendor.isActive) {
      return errorResponse(`${vendor.name} is inactive, so no reorder items are listed for it`, 400);
    }

    const { items, total } = await findReorderItems({ vendorId, search, page, limit });

    log.debug("reorder items listed", {
      vendorId,
      page,
      limit,
      searched: !!search,
      total,
      returned: items.length,
      alreadyOnOpenPo: items.filter((i) => i.openPo).length,
    });

    return paginatedResponse(items, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to load the reorder items";
    log.error("reorder items failed", { vendorId, message });
    return errorResponse(message, 500);
  }
}
