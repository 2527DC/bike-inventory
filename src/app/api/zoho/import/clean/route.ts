export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { BooksClient } from "@/lib/integrations";

interface ImportedItem {
  sku: string;
  name: string;
  brand: string;
  costPrice: number;
  sellingPrice: number;
  stock: number;
  gst: number;
  hsn: string;
  type: string;
}

export async function POST() {
  try {
    const user = await requireFeature("zoho", "fetch");

    const zoho = new BooksClient();
    const ready = await zoho.init();
    if (!ready) return errorResponse("Zoho not connected", 400);

    const log = await prisma.syncLog.create({
      data: { syncType: "clean-import", status: "running", triggeredBy: user.id },
    });

    // Step 1: Pull only ACTIVE items from Zoho
    const allItems = await zoho.listAllItems("active");

    // Step 2: Filter — stock > 0
    const activeItems = allItems.filter((item) => {
      return Number(item.stock_on_hand || 0) > 0;
    });

    // Step 3: Delete all existing products and related data
    await prisma.$transaction(async (tx) => {
      await tx.serialTransactionItem.deleteMany({});
      await tx.serialItem.deleteMany({});
      await tx.stockCountItem.deleteMany({});
      await tx.stockCount.deleteMany({});
      await tx.inventoryTransaction.deleteMany({});
      await tx.purchaseOrderItem.deleteMany({});
      await tx.product.deleteMany({});
    });

    // Step 4: Ensure default category exists
    let defaultCategory = await prisma.category.findFirst({ where: { name: "General" } });
    if (!defaultCategory) {
      defaultCategory = await prisma.category.create({
        data: { name: "General", description: "General items" },
      });
    }

    // Step 5: Default brand (brands managed manually via stock count)
    let defaultBrand = await prisma.brand.findFirst({ where: { name: "Unbranded" } });
    if (!defaultBrand) {
      defaultBrand = await prisma.brand.create({ data: { name: "Unbranded" } });
    }

    // Step 6: Import active items and record each one
    let imported = 0;
    let failed = 0;
    const errors: string[] = [];
    const importedItems: ImportedItem[] = [];

    for (const item of activeItems) {
      try {
        const zohoItem = item as Record<string, unknown>;
        const sku = (item.sku || `ZOHO-${String(Date.now()).slice(-8)}-${imported}`).substring(0, 50);

        // Brand assigned manually during stock count — use default here
        const brandId = defaultBrand.id;
        const resolvedBrand = "Unbranded";

        // Determine product type
        const zohoType = String(zohoItem.product_type || zohoItem.item_type || "").toLowerCase();
        let productType: "BICYCLE" | "SPARE_PART" | "ACCESSORY" = "SPARE_PART";
        if (zohoType.includes("bicycle") || zohoType.includes("cycle")) productType = "BICYCLE";
        else if (zohoType.includes("accessory")) productType = "ACCESSORY";

        const stock = Number(zohoItem.stock_on_hand || 0);
        const costPrice = Number(zohoItem.purchase_rate || 0);
        const sellingPrice = Number(zohoItem.rate || 0);
        const gstRate = Number(zohoItem.tax_percentage || 18);
        const hsnCode = String(zohoItem.hsn_or_sac || "");

        await prisma.product.create({
          data: {
            sku,
            name: item.name,
            zohoItemId: item.item_id || null,
            categoryId: defaultCategory.id,
            brandId,
            type: productType,
            costPrice,
            sellingPrice,
            mrp: sellingPrice,
            gstRate,
            hsnCode,
            currentStock: stock,
          },
        });

        importedItems.push({
          sku,
          name: item.name,
          brand: resolvedBrand,
          costPrice,
          sellingPrice,
          stock,
          gst: gstRate,
          hsn: hsnCode,
          type: productType,
        });
        imported++;
      } catch (err) {
        failed++;
        errors.push(`${item.name}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }

    const status = failed === 0 ? "success" : imported === 0 ? "failed" : "partial";

    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status,
        totalItems: allItems.length,
        synced: imported,
        failed,
        errors: errors.length > 0 ? JSON.stringify(errors) : null,
        completedAt: new Date(),
      },
    });

    return successResponse({
      syncType: "clean-import",
      status,
      zohoTotal: allItems.length,
      activeWithStock: activeItems.length,
      imported,
      failed,
      errors: errors.slice(0, 20),
      importedItems,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Clean import failed", 500);
  }
}
