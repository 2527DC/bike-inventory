export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("stock", "view");
    const q = new URL(req.url).searchParams.get("q") || "";
    if (q.length < 2) {
      return successResponse([]);
    }

    const products = await prisma.product.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
          { brand: { name: { contains: q, mode: "insensitive" } } },
          { size: { contains: q, mode: "insensitive" } },
          { category: { name: { contains: q, mode: "insensitive" } } },
          { bin: { code: { contains: q, mode: "insensitive" } } },
        ],
      },
      select: {
        id: true,
        sku: true,
        name: true,
        currentStock: true,
        reorderLevel: true,
        bin: { select: { code: true, location: true } },
        category: { select: { name: true } },
        brand: { select: { name: true } },
      },
      take: 20,
      orderBy: { name: "asc" },
    });

    return successResponse(products);
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Search failed",
      500
    );
  }
}
