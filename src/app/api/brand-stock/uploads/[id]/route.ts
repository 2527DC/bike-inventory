export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("purchase_orders", "view");
    const { id } = await params;

    const upload = await prisma.brandStockUpload.findUnique({
      where: { id },
      include: {
        brand: { select: { id: true, name: true, contactName: true, whatsappNumber: true, contactPhone: true } },
        uploadedBy: { select: { name: true } },
        items: {
          include: {
            product: {
              select: {
                id: true, sku: true, name: true, currentStock: true, reservedStock: true,
                reorderLevel: true, reorderQty: true, costPrice: true, sellingPrice: true,
                category: { select: { name: true } },
              },
            },
          },
          orderBy: [{ selected: "desc" }, { matchStatus: "asc" }, { rawName: "asc" }],
        },
      },
    });

    if (!upload) return errorResponse("Upload not found", 404);
    return successResponse(upload);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch upload", 500);
  }
}
