export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("purchase_orders", "view");
    const brandId = req.nextUrl.searchParams.get("brandId") || undefined;

    const uploads = await prisma.brandStockUpload.findMany({
      where: { ...(brandId && { brandId }) },
      include: {
        brand: { select: { name: true } },
        uploadedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    return successResponse(uploads);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch uploads", 500);
  }
}
