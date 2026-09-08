export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { productUpdateSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:products:id");
import { userCan } from "@/lib/rbac";
import { validateReorderVendor } from "@/lib/vendors/validate";

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

    const shaped = product;

    // Strip cost price for non-admin users
    if (!isAdmin) {
      return successResponse({ ...shaped, costPrice: undefined });
    }

    return successResponse(shaped);
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
    const user = await requireFeature("stock", "edit");
    const { id } = await params;
    const body = await req.json();
    const data = productUpdateSchema.parse(body);

    // P8 added `reorderVendorId` to productSchema so the /stock/[id] edit form can set it.
    // That would otherwise have opened a side door: this route is guarded on `stock.edit`,
    // while the two routes built for that column (api/products/[id]/reorder and
    // api/reorder/update-levels) demand `reorder.edit`. One column behind two permissions,
    // depending on which URL you posted to, is not a permission.
    //
    // So the extra grant is required only when the field is actually present, and the vendor
    // is validated the same way. Same shape as api/products/bulk.
    //
    // KNOWN INCONSISTENCY, deliberately left: `reorderLevel` and `reorderQty` remain writable
    // here under `stock.edit` alone, as they were before P8 — this form has always sent
    // reorderLevel. Pulling them behind `reorder.edit` would take the field away from roles
    // that use it today, which is a change to make on purpose, not as a side effect of P8.
    if (data.reorderVendorId !== undefined) {
      if (!(await userCan(user.id, "reorder", "edit"))) {
        return errorResponse("You do not have permission to set the reorder vendor", 403);
      }
      const vendorError = await validateReorderVendor(data.reorderVendorId);
      if (vendorError) return errorResponse(vendorError, 400);
    }

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

    // PATCH does one job: DEACTIVATING or RESTORING a product. It sits behind stock.edit.
    //
    // It used to also reclassify a product's type. That half went with ProductType (P3 of
    // the 0409 plan); a body carrying no `status` is now a 400 rather than a silent no-op.
    //
    // Deactivate lives here rather than on DELETE deliberately. DELETE used to set
    // status INACTIVE and answer "Product deactivated" — a verb that said one thing and did
    // another. Nobody noticed because no screen called it. Each verb now does what it says.
    const { status } = body as { status?: string };

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

    // No `status` means the caller sent a body this route no longer understands — almost
    // certainly a product-type reclassification. Fail loudly rather than answering 200 to a
    // request that changed nothing.
    return errorResponse("status is required (ACTIVE or INACTIVE)", 400);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update type", 400);
  }
}

/*
 * There is NO `DELETE` handler, deliberately — owner's instruction, 8 Sep 2026:
 * a product is DEACTIVATED, never destroyed.
 *
 * What used to be here: a `?check=true` probe that counted attached records, a refusal that
 * named them, and a `?force=true` branch that hand-rolled a nine-table cascade
 * (SerialTransactionItem -> SerialItem -> InventoryTransaction -> StockLevel ->
 * InboundLineItem -> PurchaseOrderItem -> TransferOrderItem -> StockCountItem ->
 * BrandSkuMapping, then the product) because NOTHING in the schema cascades onto Product —
 * every foreign key to it is a default Restrict.
 *
 * That cascade was the problem. Deleting a product with history does not tidy the catalog; it
 * rewrites what a shipment, a purchase order, a transfer and a stock count each say happened,
 * and there is no undo. `PATCH { status: "INACTIVE" }` above hides the row from every screen
 * while keeping all of it.
 *
 * Next.js answers an unexported method with 405, which is the correct answer here.
 *
 * If a product genuinely must go — a test row created by mistake, with no history — that is a
 * deliberate database operation, not a button an inventory screen offers to everyone holding
 * `stock.delete`. The `stock.delete` grant itself still exists and is still used, by
 * `POST /api/products/stale` (a SOFT delete, sets INACTIVE) and `DELETE /api/inventory/cleanup`
 * (Zoho transactions and bills, never products).
 */
