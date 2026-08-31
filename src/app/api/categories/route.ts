// `revalidate = 300` used to sit here and did nothing: both handlers call requireFeature,
// which reads cookies, so the route is dynamic and was never cached. It read as a promise
// of caching that no request ever got.
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { categorySchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// `stock.view`, NOT `categories.view`, and deliberately so: every product form reads this
// for its category dropdown. Re-guarding it on the taxonomy module would empty those
// dropdowns for anyone who is not a taxonomy admin — a silent empty list rather than an
// honest 403, which is a worse failure than the one it would prevent.
export async function GET() {
  try {
    await requireFeature("stock", "view");
    const categories = await prisma.category.findMany({
      include: {
        children: { select: { id: true, name: true } },
        parent: { select: { id: true, name: true } },
        _count: { select: { products: true, children: true } },
      },
      orderBy: { name: "asc" },
    });
    return successResponse(categories);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch categories", 500);
  }
}

// Creating a category IS a taxonomy change, so unlike GET this moves to the new module.
// Nothing in the UI called this before /more/categories existed.
export async function POST(req: NextRequest) {
  try {
    await requireFeature("categories", "create");
    const body = await req.json();
    const data = categorySchema.parse(body);

    // Category.name is @unique — answer with the name that already holds it rather than a
    // raw constraint violation.
    const clash = await prisma.category.findFirst({
      where: { name: { equals: data.name.trim(), mode: "insensitive" } },
      select: { name: true },
    });
    if (clash) return errorResponse(`"${clash.name}" already exists`, 409);

    const category = await prisma.category.create({
      data: { ...data, name: data.name.trim() },
    });
    return successResponse(category, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create category", 400);
  }
}
