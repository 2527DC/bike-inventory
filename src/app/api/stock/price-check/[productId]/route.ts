export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getBooks } from "@/lib/integrations";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const user = await requireFeature("stock", "edit");
    const { productId } = await params;

    const body = await req.json();
    const newCostPrice = Number(body.newCostPrice);

    if (isNaN(newCostPrice) || newCostPrice < 0) {
      return errorResponse("Invalid cost price", 400);
    }

    // Fetch current product
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        sku: true,
        costPrice: true,
        sellingPrice: true,
        currentStock: true,
        zohoItemId: true,
        hsnCode: true,
        gstRate: true,
      },
    });

    if (!product) {
      return errorResponse("Product not found", 404);
    }

    const oldCostPrice = product.costPrice;

    if (Math.abs(oldCostPrice - newCostPrice) < 0.01) {
      return errorResponse("New price is the same as current price", 400);
    }

    // Update product cost price and create adjustment transaction
    const [updatedProduct] = await prisma.$transaction([
      prisma.product.update({
        where: { id: productId },
        data: { costPrice: newCostPrice },
      }),
      prisma.inventoryTransaction.create({
        data: {
          type: "ADJUSTMENT",
          productId,
          quantity: 0,
          previousStock: product.currentStock,
          newStock: product.currentStock,
          notes: `[PRICE_CORRECTION] Cost price updated from ₹${oldCostPrice.toFixed(2)} to ₹${newCostPrice.toFixed(2)}`,
          userId: user.id,
        },
      }),
    ]);

    // Best-effort Zoho push
    let zohoPushed = false;
    let zohoError: string | null = null;

    if (product.zohoItemId) {
      try {
        // updateItem(), not a raw apiCall. This was the only Zoho WRITE in the codebase
        // with no client method — the one endpoint that overwrites existing Zoho data,
        // called from inside a route handler and therefore absent from every listing.
        const zoho = await getBooks();
        if (zoho) {
          await zoho.updateItem(product.zohoItemId, { purchase_rate: newCostPrice });
          zohoPushed = true;
        }
      } catch (err) {
        zohoError =
          err instanceof Error ? err.message : "Unknown Zoho error";
      }
    }

    return successResponse({
      productId: updatedProduct.id,
      oldCostPrice,
      newCostPrice,
      zohoPushed,
      zohoError,
    });
  } catch (error) {
    if (error instanceof AuthError)
      return errorResponse(error.message, error.status);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to update price",
      500
    );
  }
}
