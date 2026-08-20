export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { productUpdateSchema } from "@/lib/validations";
import { requireFeature, AuthError, getCurrentUser } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireFeature("stock", "view");
    const { id } = await params;
    const isAdmin = await userCan(user.id, "cost_price", "view");

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        brand: true,
        bin: true,
        serialItems: { orderBy: { createdAt: "desc" }, take: 20 },
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { user: { select: { name: true } } },
        },
      },
    });

    if (!product) {
      return errorResponse("Product not found", 404);
    }

    // Strip cost price for non-admin users
    if (!isAdmin) {
      return successResponse({ ...product, costPrice: undefined });
    }

    return successResponse(product);
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch product",
      500
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("stock", "edit");
    const { id } = await params;
    const body = await req.json();
    const data = productUpdateSchema.parse(body);

    const product = await prisma.product.update({
      where: { id },
      data,
      include: { category: true, brand: true, bin: true },
    });

    return successResponse(product);
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Failed to update product",
      400
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("stock", "edit"); // any authenticated user
    const { id } = await params;
    const body = await req.json();

    // Only allow type reclassification via PATCH
    const { type } = body as { type?: string };
    const VALID_TYPES = ["BICYCLE", "SPARE_PART", "ACCESSORY", "BOX_PIECE", "WIP", "FINISHED_GOOD"];
    if (!type || !VALID_TYPES.includes(type)) {
      return errorResponse("Invalid product type", 400);
    }

    const product = await prisma.product.update({
      where: { id },
      data: { type: type as never },
      include: { category: true, brand: true, bin: true },
    });

    return successResponse(product);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update type", 400);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("stock", "delete");
    const { id } = await params;

    await prisma.product.update({
      where: { id },
      data: { status: "INACTIVE" },
    });

    return successResponse({ message: "Product deactivated" });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Failed to delete product",
      400
    );
  }
}
