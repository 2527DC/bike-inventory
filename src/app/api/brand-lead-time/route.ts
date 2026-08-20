export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// GET: List all brand lead times (with brand name)
export async function GET() {
  try {
    await requireFeature("brands", "view");

    const brands = await prisma.brand.findMany({
      select: {
        id: true,
        name: true,
        leadTime: { select: { leadDays: true } },
      },
      orderBy: { name: "asc" },
    });

    const data = brands.map((b) => ({
      brandId: b.id,
      brandName: b.name,
      leadDays: b.leadTime?.leadDays ?? 7,
    }));

    return successResponse(data);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}

// POST/PUT: Upsert brand lead time
export async function POST(req: NextRequest) {
  try {
    await requireFeature("brands", "create");
    const body = await req.json();
    const { brandId, leadDays } = body;

    if (!brandId || typeof leadDays !== "number" || leadDays < 1) {
      return errorResponse("brandId and leadDays (>= 1) required", 400);
    }

    const result = await prisma.brandLeadTime.upsert({
      where: { brandId },
      update: { leadDays },
      create: { brandId, leadDays },
    });

    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 400);
  }
}
