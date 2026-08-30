export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { productUpdateSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:products:id");
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
    await requireFeature("stock", "edit");
    const { id } = await params;
    const body = await req.json();

    // PATCH handles two separate jobs: reclassifying a product's type, and DEACTIVATING or
    // RESTORING it. Both are edits to an existing row, so both sit behind stock.edit.
    //
    // Deactivate lives here rather than on DELETE deliberately. DELETE used to set
    // status INACTIVE and answer "Product deactivated" — a verb that said one thing and did
    // another. Nobody noticed because no screen called it. Each verb now does what it says.
    const { type, status } = body as { type?: string; status?: string };

    if (status !== undefined) {
      // INACTIVE hides the product from pickers and the default list while keeping every
      // record. ACTIVE is the undo. Nothing else changes — stock levels, transactions and
      // serials are never touched, which is the entire point of a soft delete.
      if (status !== "ACTIVE" && status !== "INACTIVE") {
        return errorResponse("Status must be ACTIVE or INACTIVE", 400);
      }

      const existing = await prisma.product.findUnique({
        where: { id },
        select: { id: true, name: true, status: true },
      });
      if (!existing) return errorResponse("Product not found", 404);

      const product = await prisma.product.update({
        where: { id },
        data: { status },
        include: { category: true, brand: true, bin: true },
      });

      const restored = status === "ACTIVE";
      log.info(restored ? "product restored" : "product deactivated", { productId: id });

      return successResponse({
        ...product,
        deactivated: !restored,
        restored,
        message: restored
          ? `${existing.name} is active again.`
          : `${existing.name} is deactivated. It keeps its history and can be restored.`,
      });
    }

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

    const product = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        sku: true,
        _count: {
          select: {
            stockLevels: true,
            transactions: true,
            serialItems: true,
            inboundLineItems: true,
            transferOrderItems: true,
            stockCounts: true,
            purchaseOrderItems: true,
            brandStockMatches: true,
            brandSkuMappings: true,
            lmsProducts: true,
          },
        },
      },
    });
    if (!product) return errorResponse("Product not found", 404);

    // Refuse when anything points at it, and NAME what. Deleting a product with history is
    // not tidying up — it destroys the audit trail, and the foreign keys would refuse anyway.
    // This check exists so the refusal is a sentence someone can act on rather than a
    // constraint-violation string, and so it says which relation is holding the row.
    //
    // Same rule /team already applies to a user with transactions.
    const c = product._count;
    const blockers: string[] = [];
    if (c.stockLevels) blockers.push(`${c.stockLevels} stock row(s)`);
    if (c.transactions) blockers.push(`${c.transactions} transaction(s)`);
    if (c.serialItems) blockers.push(`${c.serialItems} serial item(s)`);
    if (c.inboundLineItems) blockers.push(`${c.inboundLineItems} inbound line(s)`);
    if (c.transferOrderItems) blockers.push(`${c.transferOrderItems} transfer line(s)`);
    if (c.stockCounts) blockers.push(`${c.stockCounts} stock-count line(s)`);
    if (c.purchaseOrderItems) blockers.push(`${c.purchaseOrderItems} purchase-order line(s)`);
    if (c.brandStockMatches) blockers.push(`${c.brandStockMatches} brand stock match(es)`);
    if (c.brandSkuMappings) blockers.push(`${c.brandSkuMappings} SKU mapping(s)`);
    if (c.lmsProducts) blockers.push(`${c.lmsProducts} training record(s)`);

    if (blockers.length) {
      log.info("product delete refused", { productId: id, blockers });
      return successResponse({
        deleted: false,
        name: product.name,
        message:
          `${product.name} has ${blockers.join(", ")} and cannot be deleted. ` +
          `Deactivate it instead to hide it while keeping its history.`,
      });
    }

    // Images are deliberately NOT removed. Product.imageUrls holds S3 URLs and nothing in
    // the app has ever cleaned them up; deleting the wrong key is unrecoverable, and this
    // branch only runs for a product with no history at all. Worth a deliberate sweep, not a
    // side effect of a delete handler.
    await prisma.product.delete({ where: { id } });

    log.info("product deleted", { productId: id, sku: product.sku });
    return successResponse({
      deleted: true,
      name: product.name,
      message: `${product.name} permanently deleted.`,
    });
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
