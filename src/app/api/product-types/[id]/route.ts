export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { productTypeSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("product-types");

/**
 * PATCH — rename, reorder, or retire a type.
 *
 * There is deliberately NO DELETE. `Product.productTypeId` is required and the foreign key is
 * RESTRICT, so deleting a type in use fails at the database anyway; and deleting one that is
 * unused still breaks any report or saved filter that referenced it. `isActive: false` is how
 * a type leaves the pickers while every product that holds it keeps a valid answer.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("product_types", "edit");
    const { id } = await params;
    const body = await req.json();
    const data = productTypeSchema.partial().parse(body);

    const existing = await prisma.productType.findUnique({
      where: { id },
      select: { id: true, name: true, _count: { select: { products: true } } },
    });
    if (!existing) return errorResponse("Product type not found", 404);

    const name = data.name?.trim();

    if (name && name.toLowerCase() !== existing.name.toLowerCase()) {
      const clash = await prisma.productType.findFirst({
        where: { name: { equals: name, mode: "insensitive" }, id: { not: id } },
        select: { name: true },
      });
      if (clash) return errorResponse(`"${clash.name}" already exists`, 409);
    }

    // Retiring a type in use is allowed and is the point of `isActive` — the products keep it,
    // it simply stops being offered. Say how many, so it is not a silent decision.
    if (data.isActive === false && existing._count.products > 0) {
      log.info("product type retired while in use", {
        productTypeId: id,
        products: existing._count.products,
      });
    }

    const updated = await prisma.productType.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });

    log.info("product type updated", { productTypeId: id });
    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("failed to update product type", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to update product type", 400);
  }
}
