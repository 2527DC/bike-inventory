export const revalidate = 300; // cache 5 min

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { brandSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET() {
  try {
    await requireFeature("brands", "view");
    const brands = await prisma.brand.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: { name: "asc" },
    });
    return successResponse(brands);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch brands", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFeature("brands", "create");
    const body = await req.json();
    const data = brandSchema.parse(body);

    const brand = await prisma.brand.create({ data });
    return successResponse(brand, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create brand", 400);
  }
}
