export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { BIN_TRACKING_ENABLED } from "@/lib/inventory-config";

// This route rewrites a field on up to 500 products in one statement and left no record that
// it had run. It is the fix-up tool for imported rows — the one place a person corrects 151
// products at once — so "which 500 rows changed, and to what" is exactly the question that
// gets asked afterwards.
const log = createLogger("products:bulk");

// POST — bulk update products (category, brand, bin, status)
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("stock", "create");
    const body = await req.json();
    const { productIds, brandId, status, categoryId, binId } = body as {
      productIds: string[];
      brandId?: string;
      status?: "ACTIVE" | "INACTIVE";
      categoryId?: string;
      binId?: string;
    };

    if (!productIds || productIds.length === 0) {
      return errorResponse("No products selected", 400);
    }
    if (productIds.length > 500) {
      return errorResponse("Maximum 500 products per batch", 400);
    }
    if (!brandId && !status && !categoryId && !binId) {
      return errorResponse("Nothing to update — provide brandId, categoryId, binId, or status", 400);
    }

    // Validate brand exists if provided
    if (brandId) {
      const brand = await prisma.brand.findUnique({ where: { id: brandId } });
      if (!brand) return errorResponse("Brand not found", 404);
    }

    // Validate category exists if provided
    if (categoryId) {
      const cat = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!cat) return errorResponse("Category not found", 404);
    }

    // Bins are the one detail no import can ever supply — a bin is a physical shelf in this
    // warehouse and Zoho has never heard of one. Walking a freshly imported batch to a shelf
    // in a single action is the whole reason this field is here.
    //
    // Refused outright while bin tracking is dormant, rather than quietly accepted: with
    // BIN_TRACKING_ENABLED false the rest of the app works on warehouses and hides every bin
    // control, so a binId written now would be invisible in the UI that is supposed to show
    // it. Better a 400 that names the reason than a silent write nobody can see or undo.
    if (binId) {
      if (!BIN_TRACKING_ENABLED) {
        return errorResponse("Bin tracking is disabled — bins cannot be assigned", 400);
      }
      const bin = await prisma.bin.findUnique({ where: { id: binId } });
      if (!bin) return errorResponse("Bin not found", 404);
    }

    const updateData: Record<string, unknown> = {};
    if (brandId) updateData.brandId = brandId;
    if (status) updateData.status = status;
    if (categoryId) updateData.categoryId = categoryId;
    if (binId) updateData.binId = binId;

    const result = await prisma.product.updateMany({
      where: { id: { in: productIds } },
      data: updateData,
    });

    // Identifiers and counts, never the rows themselves. `fields` says WHAT changed without
    // repeating the ids, which are already in the request the caller can correlate by.
    log.info("bulk update applied", {
      requestedBy: user.id,
      requested: productIds.length,
      updated: result.count,
      fields: Object.keys(updateData),
      brandId,
      categoryId,
      binId,
      status,
    });

    return successResponse({ updated: result.count });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Bulk update failed";
    log.error("bulk update failed", { message });
    return errorResponse(message, 500);
  }
}
