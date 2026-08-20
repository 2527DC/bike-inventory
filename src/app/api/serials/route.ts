export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, parseSearchParams } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("stock", "view");
    const { searchParams } = parseSearchParams(req.url);
    const productId = searchParams.get("productId");
    const status = searchParams.get("status");
    const search = searchParams.get("search");

    const where = {
      ...(productId && { productId }),
      ...(status && { status: status as never }),
      ...(search && {
        serialCode: { contains: search, mode: "insensitive" as const },
      }),
    };

    const serials = await prisma.serialItem.findMany({
      where,
      include: {
        product: { select: { name: true, sku: true } },
        bin: { select: { code: true, location: true } },
      },
      orderBy: { serialCode: "asc" },
      take: 100,
    });

    return successResponse(serials);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch serials",
      500
    );
  }
}
