export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError, getCurrentUser } from "@/lib/auth-helpers";
import { getBooks } from "@/lib/integrations";
import { PLACEHOLDER_BRAND, PLACEHOLDER_CATEGORY } from "@/lib/import-placeholders";
import { parseBicycleSize } from "@/lib/product-size";

export async function POST() {
  try {
    await requireFeature("zoho", "fetch");
    const currentUser = await getCurrentUser();

    const zoho = await getBooks();
    if (!zoho) return errorResponse("Zoho not connected", 400);

    const log = await prisma.syncLog.create({
      data: { syncType: "import-items", status: "running", triggeredBy: currentUser?.id },
    });

    const items = await zoho.listAllItems();

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    // Mirror Zoho categories — exact category_name from Zoho, falling back to the shared
    // placeholder constant. The second import path that writes these two names; see
    // `pull-review/approve/route.ts` for why they are constants.
    //
    // NOTE: unlike the approve route this path never reads `item.brand` / `item.manufacturer`
    // at all — every product it creates gets the placeholder brand even when Zoho has a real
    // one. That is Part B of the plan and is deliberately NOT fixed here: whether those fields
    // arrive populated is exactly what Part 0 measures.
    const categoryCache: Record<string, string> = {};
    async function resolveCategory(zohoCategoryName?: string): Promise<string> {
      const catName = (zohoCategoryName || "").trim() || PLACEHOLDER_CATEGORY;
      if (!categoryCache[catName]) {
        let cat = await prisma.category.findFirst({ where: { name: catName } });
        if (!cat) cat = await prisma.category.create({ data: { name: catName, description: `Zoho category: ${catName}` } });
        categoryCache[catName] = cat.id;
      }
      return categoryCache[catName];
    }

    let defaultBrand = await prisma.brand.findFirst({ where: { name: PLACEHOLDER_BRAND } });
    if (!defaultBrand) {
      defaultBrand = await prisma.brand.create({
        data: { name: PLACEHOLDER_BRAND },
      });
    }

    for (const item of items) {
      try {
        const zohoItem = item as Record<string, unknown>;
        const sku = (item.sku || `ZOHO-${String(Date.now()).slice(-6)}`).substring(0, 50);

        // Existing items are FROZEN — Zoho never overwrites items already in the app.
        if (item.sku) {
          const existing = await prisma.product.findFirst({
            where: { sku: item.sku },
          });
          if (existing) {
            skipped++;
            continue;
          }
        }

        // Determine product type from Zoho item_type or product_type
        const zohoType = String(zohoItem.product_type || zohoItem.item_type || "").toLowerCase();
        let productType: "BICYCLE" | "SPARE_PART" | "ACCESSORY" = "SPARE_PART";
        if (zohoType.includes("bicycle") || zohoType.includes("cycle")) productType = "BICYCLE";
        else if (zohoType.includes("accessory")) productType = "ACCESSORY";

        const itemCategoryId = await resolveCategory(item.category_name || "");

        // Same wheel-size recovery as the approve route — BICYCLE only, known sizes only.
        const parsedSize = productType === "BICYCLE" ? parseBicycleSize(item.name) : null;

        await prisma.product.create({
          data: {
            sku,
            name: item.name,
            categoryId: itemCategoryId,
            brandId: defaultBrand.id,
            type: productType,
            size: parsedSize,
            costPrice: Number(zohoItem.purchase_rate || 0),
            sellingPrice: Number(zohoItem.rate || 0),
            mrp: Number(zohoItem.rate || 0),
            gstRate: Number(zohoItem.tax_percentage || 18),
            hsnCode: String(zohoItem.hsn_or_sac || ""),
            currentStock: Number(zohoItem.stock_on_hand || 0),
          },
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
        totalItems: items.length,
        synced: imported,
        failed,
        errors: errors.length > 0 ? JSON.stringify(errors) : null,
        completedAt: new Date(),
      },
    });

    return successResponse({
      syncType: "import-items",
      status,
      total: items.length,
      imported,
      skipped,
      failed,
      errors,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Import failed", 500);
  }
}
