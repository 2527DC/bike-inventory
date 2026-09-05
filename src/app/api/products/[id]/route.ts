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

export async function DELETE(
  req: NextRequest,
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

    // ?check=true answers "what is attached" and returns WITHOUT deleting anything.
    //
    // The screen calls this first so it can raise ONE accurate confirmation naming the
    // blockers, rather than attempting a delete and asking a second time after a refusal.
    // Two chained browser dialogs were unreliable — see the note in stock/page.tsx.
    if (new URL(req.url).searchParams.get("check") === "true") {
      log.debug("product delete check", { productId: id, blockers });
      return successResponse({
        deleted: false,
        name: product.name,
        blockers,
        canForce: blockers.length > 0,
        message: blockers.length
          ? `${product.name} has ${blockers.join(", ")}.`
          : `${product.name} has no records attached.`,
      });
    }

    // ?force=true removes the product AND everything attached to it.
    //
    // Deliberately opt-in and never the default. The safe path refuses and explains; this one
    // destroys audit history, and the caller has to ask for that in the URL. It exists because
    // a Zoho import can leave hundreds of junk products carrying a transaction and a handful
    // of serials, and refusing forever means they can never be cleaned up.
    const force = new URL(req.url).searchParams.get("force") === "true";

    if (blockers.length && !force) {
      log.info("product delete refused", { productId: id, blockers });
      return successResponse({
        deleted: false,
        name: product.name,
        blockers,
        // `canForce` tells the screen a second, destructive option exists. Without it the UI
        // would have to guess, or offer force on products that do not need it.
        canForce: true,
        message:
          `${product.name} has ${blockers.join(", ")} and cannot be deleted. ` +
          `Deactivate it instead to hide it while keeping its history.`,
      });
    }

    if (blockers.length && force) {
      // One transaction: either the product and all of its records go, or none do. A partial
      // cascade would leave orphaned lines pointing at a product that no longer exists.
      //
      // ORDER MATTERS. SerialTransactionItem sits beneath BOTH SerialItem and
      // InventoryTransaction, so it must go first or those deletes hit a foreign key.
      await prisma.$transaction(async (tx) => {
        const serials = await tx.serialItem.findMany({
          where: { productId: id },
          select: { id: true },
        });
        const txns = await tx.inventoryTransaction.findMany({
          where: { productId: id },
          select: { id: true },
        });

        if (serials.length || txns.length) {
          await tx.serialTransactionItem.deleteMany({
            where: {
              OR: [
                { serialItemId: { in: serials.map((r) => r.id) } },
                { transactionId: { in: txns.map((r) => r.id) } },
              ],
            },
          });
        }

        // The product's own records — meaningless without it.
        await tx.serialItem.deleteMany({ where: { productId: id } });
        await tx.inventoryTransaction.deleteMany({ where: { productId: id } });
        await tx.stockLevel.deleteMany({ where: { productId: id } });

        // Lines on OTHER documents. Removing these changes what that shipment, order, transfer
        // or count says — which is why force is opt-in and the response names them.
        await tx.inboundLineItem.deleteMany({ where: { productId: id } });
        await tx.purchaseOrderItem.deleteMany({ where: { productId: id } });
        await tx.transferOrderItem.deleteMany({ where: { productId: id } });
        await tx.stockCountItem.deleteMany({ where: { productId: id } });
        await tx.brandSkuMapping.deleteMany({ where: { productId: id } });

        // Optional references: the row survives, it just stops pointing here.
        await tx.brandStockItem.updateMany({ where: { productId: id }, data: { productId: null } });

        await tx.product.delete({ where: { id } });
      });

      log.warn("product FORCE deleted with its records", { productId: id, sku: product.sku, blockers });
      return successResponse({
        deleted: true,
        forced: true,
        name: product.name,
        message: `${product.name} and its ${blockers.join(", ")} were permanently deleted.`,
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
