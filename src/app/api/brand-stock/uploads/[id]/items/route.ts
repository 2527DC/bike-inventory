export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("purchase_orders", "edit");
    const { id } = await params;
    const body = await req.json();
    const { items } = body as { items: Array<{ id: string; productId?: string; orderQty?: number; selected?: boolean }> };

    if (!items || !Array.isArray(items)) return errorResponse("Items array required", 400);

    const upload = await prisma.brandStockUpload.findUnique({ where: { id } });
    if (!upload) return errorResponse("Upload not found", 404);

    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        const updateData: Record<string, unknown> = {};

        if (item.productId !== undefined) {
          updateData.productId = item.productId || null;
          updateData.matchStatus = item.productId ? "MANUAL_MATCHED" : "UNMATCHED";
          updateData.matchConfidence = item.productId ? 1.0 : null;

          // Populate BCH context for manual match
          if (item.productId) {
            const product = await tx.product.findUnique({
              where: { id: item.productId },
              select: { currentStock: true, reservedStock: true, reorderLevel: true },
            });
            if (product) {
              const available = product.currentStock - product.reservedStock;
              updateData.bchCurrentStock = product.currentStock;
              updateData.bchReorderLevel = product.reorderLevel;
              updateData.suggestedQty = Math.max(0, product.reorderLevel - available);
            }

            // Save mapping for future uploads
            const existing = await tx.brandStockItem.findUnique({ where: { id: item.id }, select: { rawSku: true, rawName: true } });
            if (existing) {
              await tx.brandSkuMapping.upsert({
                where: { brandId_brandName: { brandId: upload.brandId, brandName: existing.rawName } },
                update: { productId: item.productId, brandSku: existing.rawSku },
                create: { brandId: upload.brandId, brandName: existing.rawName, brandSku: existing.rawSku, productId: item.productId },
              });
            }
          }
        }

        if (item.orderQty !== undefined) updateData.orderQty = item.orderQty;
        if (item.selected !== undefined) updateData.selected = item.selected;

        if (Object.keys(updateData).length > 0) {
          await tx.brandStockItem.update({ where: { id: item.id }, data: updateData });
        }
      }

      // Recount matches
      const matched = await tx.brandStockItem.count({ where: { uploadId: id, matchStatus: { not: "UNMATCHED" } } });
      const total = await tx.brandStockItem.count({ where: { uploadId: id } });
      await tx.brandStockUpload.update({
        where: { id },
        data: { matchedItems: matched, unmatchedItems: total - matched, status: "REVIEWED" },
      });
    });

    return successResponse({ updated: items.length });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update items", 500);
  }
}
