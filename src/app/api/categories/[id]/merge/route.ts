export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:categories:merge");

/**
 * Move every product out of one category into another, then delete the source.
 *
 * This is the operation that actually repairs the taxonomy. The categories in this database
 * came from Zoho's `category_name` verbatim, so several of them are wheel sizes (`16`,
 * `24 SS`, `29 MS`) and 151 products sit in `Uncategorized`. Renaming does not help — the
 * useful action is "everything in `16` belongs in Bicycles, and `16` should stop existing".
 *
 * Guarded on `categories.create` rather than `edit`, matching api/brands/[id]/merge: the
 * caller is choosing a destination and destroying a row, which is more than an edit.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("categories", "create");
    const { id: sourceId } = await params;
    const { targetCategoryId } = (await req.json().catch(() => ({}))) as {
      targetCategoryId?: string;
    };

    if (!targetCategoryId || typeof targetCategoryId !== "string") {
      return errorResponse("targetCategoryId is required", 400);
    }
    if (sourceId === targetCategoryId) {
      return errorResponse("Cannot merge a category into itself", 400);
    }

    const [source, target] = await Promise.all([
      prisma.category.findUnique({
        where: { id: sourceId },
        select: { id: true, name: true, _count: { select: { products: true, children: true } } },
      }),
      prisma.category.findUnique({ where: { id: targetCategoryId }, select: { id: true, name: true } }),
    ]);

    if (!source) return errorResponse("Source category not found", 404);
    if (!target) return errorResponse("Target category not found", 404);

    // Products move; children do not, because a sub-category is a structural decision rather
    // than a mis-filing. Re-parenting them silently would rearrange the tree as a side effect
    // of a cleanup, so refuse and let the person move them deliberately.
    if (source._count.children) {
      return errorResponse(
        `${source.name} has ${source._count.children} sub-categor(ies). Move or delete them before merging.`,
        400
      );
    }

    // One transaction: either the products move AND the source goes, or neither happens.
    // A half-applied merge would leave products pointing at a category the screen has
    // already stopped showing.
    //
    // Inbound shipments move for the same reason products do. `InboundShipment.categoryId`
    // is a Restrict foreign key (added in MIG-1a), so leaving them behind does not orphan
    // them — it makes the delete below FAIL, and a merge that has been refusable all along
    // would start dying on a raw constraint string instead.
    const result = await prisma.$transaction(async (tx) => {
      const moved = await tx.product.updateMany({
        where: { categoryId: sourceId },
        data: { categoryId: targetCategoryId },
      });
      const movedShipments = await tx.inboundShipment.updateMany({
        where: { categoryId: sourceId },
        data: { categoryId: targetCategoryId },
      });
      await tx.category.delete({ where: { id: sourceId } });
      return {
        moved: moved.count,
        movedShipments: movedShipments.count,
        from: source.name,
        into: target.name,
      };
    });

    log.info("categories merged", {
      sourceId,
      targetCategoryId,
      moved: result.moved,
      movedShipments: result.movedShipments,
    });

    return successResponse({
      ...result,
      message: `${result.moved} product(s) moved from ${result.from} into ${result.into}. ${result.from} was deleted.`,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to merge the category";
    log.error("category merge failed", { message });
    return errorResponse(message, 400);
  }
}
