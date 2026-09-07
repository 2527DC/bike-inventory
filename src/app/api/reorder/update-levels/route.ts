export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { reorderLevelsSchema } from "@/lib/validations";
import { validateReorderVendor } from "@/lib/vendors/validate";
import { createLogger } from "@/lib/logger";

const log = createLogger("reorder:update-levels");

/**
 * The /reorder screen's batch save: set reorder level, quantity and vendor on many products.
 *
 * Three things this route had none of, all required by CLAUDE.md and all added here:
 *
 * 1. VALIDATION. It read `body.items`, checked `Array.isArray` and looped. Anything that got
 *    past `Array.isArray` reached `prisma.product.update`, so a bad `reorderVendorId` came
 *    back as a raw foreign-key violation rather than a sentence, and a non-numeric level was
 *    silently coerced by `Number(x) || 0` — a typo became 0, which switches low-stock
 *    detection OFF for that product (isLowStock requires reorderLevel > 0). Now Zod.
 * 2. A BOUND. The array was unbounded, so one request could open a transaction over the whole
 *    catalogue and hold it there. Capped at 500, matching api/products/bulk.
 * 3. A LOGGER. This was the only route in the reorder tree with no `createLogger`, so a
 *    failed batch save left nothing behind to find it by.
 *
 * The permission is unchanged: `reorder.edit`. `PUT /api/products/[id]/reorder` writes the
 * same three columns and is gated the same way, deliberately (owner, 6 Sep).
 */
export async function PUT(req: NextRequest) {
  try {
    await requireFeature("reorder", "edit");

    const parsed = reorderLevelsSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid reorder levels", 400);
    }
    const { items } = parsed.data;

    // Vendors are checked BEFORE the transaction opens, and each distinct id once. Doing it
    // inside would mean a lookup per row, and a refusal halfway through would roll back rows
    // the person had already been told were fine.
    const vendorIds = [...new Set(items.map((i) => i.reorderVendorId).filter((v): v is string => !!v))];
    for (const vendorId of vendorIds) {
      const vendorError = await validateReorderVendor(vendorId);
      if (vendorError) return errorResponse(vendorError, 400);
    }

    const results = await prisma.$transaction(async (tx) => {
      const updated = [];
      for (const item of items) {
        const result = await tx.product.update({
          where: { id: item.id },
          data: {
            reorderLevel: item.reorderLevel,
            ...(item.reorderQty !== undefined && { reorderQty: item.reorderQty }),
            ...(item.reorderVendorId !== undefined && { reorderVendorId: item.reorderVendorId || null }),
          },
          select: { id: true, name: true, reorderLevel: true, reorderQty: true },
        });
        updated.push(result);
      }
      return updated;
    });

    log.info("reorder levels saved", { count: results.length, vendorsTouched: vendorIds.length });
    return successResponse({ updated: results.length });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to update reorder levels";
    log.error("reorder levels save failed", { message });
    return errorResponse(message, 400);
  }
}
