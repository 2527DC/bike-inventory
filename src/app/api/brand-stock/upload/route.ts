export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { parseExcelBuffer } from "@/lib/excel-parser";
import { parsePdfWithAI } from "@/lib/pdf-parser";
import { runMatchPipeline, populateBchContext } from "@/lib/brand-stock-matcher";

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("purchase_orders", "create");

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const brandId = formData.get("brandId") as string | null;

    if (!file) return errorResponse("No file uploaded", 400);
    if (!brandId) return errorResponse("Brand ID is required", 400);

    const brand = await prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) return errorResponse("Brand not found", 404);

    const fileName = file.name;
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const EXCEL_TYPES = ["xlsx", "xls", "csv"];
    const AI_TYPES = ["pdf", "png", "jpg", "jpeg", "webp"];
    if (![...EXCEL_TYPES, ...AI_TYPES].includes(ext)) {
      return errorResponse("Unsupported file type. Upload Excel (.xlsx/.csv), PDF, or image (.png/.jpg)", 400);
    }

    const buffer = await file.arrayBuffer();
    let parsedItems;
    try {
      if (EXCEL_TYPES.includes(ext)) {
        parsedItems = parseExcelBuffer(buffer, fileName);
      } else {
        parsedItems = await parsePdfWithAI(buffer, fileName);
      }
    } catch (e) {
      return errorResponse(e instanceof Error ? e.message : "Failed to parse file", 400);
    }

    // Create upload + items in transaction
    const upload = await prisma.$transaction(async (tx) => {
      const upload = await tx.brandStockUpload.create({
        data: {
          brandId,
          fileName,
          fileType: ext,
          status: "PROCESSING",
          totalItems: parsedItems.length,
          uploadedById: user.id,
        },
      });

      await tx.brandStockItem.createMany({
        data: parsedItems.map((item) => ({
          uploadId: upload.id,
          rawSku: item.rawSku,
          rawName: item.rawName,
          rawCategory: item.rawCategory,
          brandAvailableQty: item.brandAvailableQty,
          brandPrice: item.brandPrice,
          brandMrp: item.brandMrp,
          rawSize: item.rawSize,
        })),
      });

      return upload;
    });

    // Run matching pipeline
    const items = await prisma.brandStockItem.findMany({
      where: { uploadId: upload.id },
      select: { id: true, rawSku: true, rawName: true },
    });

    const matches = await runMatchPipeline(items, brandId);

    // Apply matches
    for (const match of matches) {
      await prisma.brandStockItem.update({
        where: { id: match.itemId },
        data: {
          productId: match.productId,
          matchStatus: match.status,
          matchConfidence: match.confidence,
        },
      });
    }

    // Populate BCH context for matched items
    const matchedIds = matches.map((m) => m.itemId);
    if (matchedIds.length > 0) {
      const context = await populateBchContext(matchedIds);
      for (const [itemId, ctx] of context) {
        await prisma.brandStockItem.update({
          where: { id: itemId },
          data: {
            bchCurrentStock: ctx.currentStock,
            bchReorderLevel: ctx.reorderLevel,
            suggestedQty: ctx.suggestedQty,
            orderQty: ctx.suggestedQty > 0 ? ctx.suggestedQty : null,
            selected: ctx.suggestedQty > 0,
          },
        });
      }
    }

    // Update upload status
    const matchedCount = matches.length;
    const unmatchedCount = parsedItems.length - matchedCount;
    await prisma.brandStockUpload.update({
      where: { id: upload.id },
      data: {
        status: "PARSED",
        matchedItems: matchedCount,
        unmatchedItems: unmatchedCount,
      },
    });

    return successResponse({
      uploadId: upload.id,
      totalItems: parsedItems.length,
      matchedItems: matchedCount,
      unmatchedItems: unmatchedCount,
    }, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Upload failed", 500);
  }
}
