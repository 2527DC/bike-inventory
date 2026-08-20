export const revalidate = 300; // cache 5 min

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { categorySchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET() {
  try {
    await requireFeature("stock", "view");
    const categories = await prisma.category.findMany({
      include: {
        children: true,
        _count: { select: { products: true } },
      },
      orderBy: { name: "asc" },
    });
    return successResponse(categories);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch categories", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFeature("stock", "create");
    const body = await req.json();
    const data = categorySchema.parse(body);

    const category = await prisma.category.create({ data });
    return successResponse(category, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create category", 400);
  }
}
