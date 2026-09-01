export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { productTypeSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("product-types");

/**
 * GET — every product type, with how many products hold it.
 *
 * Not filtered to active. The screen needs to show a retired type in order to un-retire it,
 * and the count is what makes deleting or deactivating a considered decision rather than a
 * guess. Pickers filter on `isActive` themselves.
 *
 * Guarded on `view` rather than `stock.view` so a role can be given the type list without
 * being given the catalog — but note every product form needs this endpoint, so in practice
 * anyone who can edit a product needs it too.
 */
export async function GET() {
  try {
    await requireFeature("product_types", "view");

    const types = await prisma.productType.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        sortOrder: true,
        isActive: true,
        createdAt: true,
        _count: { select: { products: true } },
      },
    });

    return successResponse(types);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("failed to list product types", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch product types", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFeature("product_types", "create");
    const body = await req.json();
    const data = productTypeSchema.parse(body);
    const name = data.name.trim();

    // `name` is @unique. Answer with the name that already holds it rather than letting a raw
    // constraint violation surface as a 500 — same shape as POST /api/categories.
    const clash = await prisma.productType.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { name: true },
    });
    if (clash) return errorResponse(`"${clash.name}" already exists`, 409);

    const created = await prisma.productType.create({
      data: { name, sortOrder: data.sortOrder ?? 0, isActive: data.isActive ?? true },
    });

    log.info("product type created", { productTypeId: created.id });
    return successResponse(created, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("failed to create product type", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to create product type", 400);
  }
}
