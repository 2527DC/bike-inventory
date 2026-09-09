export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { createLogger } from "@/lib/logger";
import { poExtractionItemPatchSchema } from "@/lib/validations";
import { serializeItem } from "@/lib/po-extraction/store";

const log = createLogger("purchase-orders:extract");

type Ctx = { params: Promise<{ id: string; itemId: string }> };

/**
 * Edit one review row: map it to a product by hand (MANUAL), clear a wrong match
 * (UNMATCHED), tick or untick it, or set the quantity to order.
 *
 * The rules that are not obvious from the schema:
 *   - clearing the product also unticks the row. An unmatched row cannot become a PO line,
 *     so leaving it selected would be a tick that does nothing;
 *   - ticking a row that has no product is refused with a sentence, not silently ignored;
 *   - the extraction's `matchedItems` is recounted in the same transaction, so the header the
 *     review shows never disagrees with its rows.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireFeature("purchase_orders", "create");
    const { id, itemId } = await params;
    const canSeeCost = await userCan(user.id, "cost_price", "view");

    const parsed = poExtractionItemPatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request", 400);
    const body = parsed.data;

    const item = await prisma.poExtractionItem.findFirst({
      where: { id: itemId, extractionId: id, extraction: { createdById: user.id } },
      select: { id: true, productId: true, matchStatus: true },
    });
    if (!item) return errorResponse("Extraction row not found", 404);

    const data: Prisma.PoExtractionItemUpdateInput = {};

    if (body.productId !== undefined) {
      if (body.productId === null) {
        data.product = { disconnect: true };
        data.matchStatus = "UNMATCHED";
        data.matchConfidence = null;
        data.selected = false;
      } else {
        const product = await prisma.product.findUnique({
          where: { id: body.productId },
          select: { id: true, status: true },
        });
        if (!product) return errorResponse("Product not found", 404);
        if (product.status !== "ACTIVE") return errorResponse("That product is not active", 400);
        data.product = { connect: { id: product.id } };
        data.matchStatus = "MANUAL";
        data.matchConfidence = 1;
      }
    }

    if (body.selected !== undefined) {
      const willHaveProduct = body.productId === undefined ? item.productId !== null : body.productId !== null;
      if (body.selected && !willHaveProduct) {
        return errorResponse("Map this row to a product before selecting it", 400);
      }
      data.selected = body.selected;
    }

    if (body.orderQty !== undefined) data.orderQty = body.orderQty;

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.poExtractionItem.update({
        where: { id: itemId },
        data,
        include: {
          product: {
            select: {
              id: true, name: true, sku: true, costPrice: true, gstRate: true,
              currentStock: true, reorderLevel: true, reservedStock: true,
            },
          },
        },
      });
      const matchedItems = await tx.poExtractionItem.count({
        where: { extractionId: id, productId: { not: null } },
      });
      await tx.poExtraction.update({ where: { id }, data: { matchedItems } });
      return { row, matchedItems };
    });

    log.info("extraction row updated", {
      extractionId: id,
      itemId,
      matchStatus: updated.row.matchStatus,
      selected: updated.row.selected,
      matchedItems: updated.matchedItems,
    });

    return successResponse({ item: serializeItem(updated.row, canSeeCost), matchedItems: updated.matchedItems });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("extraction row update failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Could not update the row", 500);
  }
}
