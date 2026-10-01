export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getInventory } from "@/lib/integrations";
import { getTodayIST } from "@/lib/services/timezone";
import { resolveBillWindow } from "@/lib/zoho/date-window";
import { DEFAULT_BRAND, PLACEHOLDER_CATEGORY } from "@/lib/import-placeholders";
import { createLogger } from "@/lib/logger";

const log = createLogger("stock:zoho-preview");

export interface StockPreviewItem {
  zohoId: string;
  name: string;
  sku?: string;
  brandName: string;
  brandStatus: "existing" | "new";
  categoryName: string;
  categoryId?: string;
  categoryStatus: "existing" | "new";
  status: "new" | "update";
  costPrice: number;
  sellingPrice: number;
  gstRate: number;
  hsnCode?: string;
  stockOnHand: number;
}

/**
 * GET /api/stock/zoho-preview — WRITES NOTHING.
 *
 * Previews active items from Zoho Inventory within a specified rolling date window (?days=3|7|30),
 * classifying each item against local Products, Brands, and Categories.
 */
export async function GET(req: NextRequest) {
  try {
    await requireFeature("zoho", "fetch");

    const { searchParams } = new URL(req.url);
    const daysParam = searchParams.get("days");
    const days = daysParam ? parseInt(daysParam, 10) : 7;
    const window = resolveBillWindow(
      { days: Number.isFinite(days) && days > 0 ? days : 7 },
      getTodayIST()
    );

    const zoho = await getInventory();
    if (!zoho) {
      log.warn("stock preview refused - Zoho Inventory is not connected");
      return errorResponse(
        "Zoho Inventory is not connected. Connect it in Settings > Integrations, then try again.",
        503
      );
    }

    log.debug("fetching active items from Zoho Inventory");
    const [zohoItems, localProducts, localBrands, localCategories] = await Promise.all([
      zoho.listAllActiveItems(),
      prisma.product.findMany({
        select: { id: true, sku: true, zohoItemId: true, name: true },
      }),
      prisma.brand.findMany({
        select: { id: true, name: true, zohoBrandId: true },
      }),
      prisma.category.findMany({
        select: { id: true, name: true, zohoCategoryId: true },
      }),
    ]);

    log.debug("stock preview source rows", {
      zoho: zohoItems.length,
      localProducts: localProducts.length,
      localBrands: localBrands.length,
      localCategories: localCategories.length,
    });

    // Lookup indexes
    const productByZohoId = new Map(
      localProducts.filter((p) => p.zohoItemId).map((p) => [p.zohoItemId!, p])
    );
    const productBySku = new Map(
      localProducts.filter((p) => p.sku).map((p) => [p.sku.trim().toLowerCase(), p])
    );

    const brandByName = new Map(
      localBrands.map((b) => [b.name.trim().toLowerCase(), b])
    );

    const categoryByName = new Map(
      localCategories.map((c) => [c.name.trim().toLowerCase(), c])
    );
    const categoryByZohoId = new Map(
      localCategories.filter((c) => c.zohoCategoryId).map((c) => [c.zohoCategoryId!, c])
    );

    let newCount = 0;
    let updateCount = 0;
    const brandsToCreate = new Set<string>();
    const categoriesToCreate = new Set<string>();
    const items: StockPreviewItem[] = [];

    for (const item of zohoItems) {
      // Strictly active
      if (item.status?.toLowerCase() !== "active") continue;

      // Filter by date window: item.last_modified_time or item.created_time >= window.from
      const modDate = item.last_modified_time ? item.last_modified_time.slice(0, 10) : "";
      const crDate = item.created_time ? item.created_time.slice(0, 10) : "";
      const itemDate = modDate && crDate ? (modDate >= crDate ? modDate : crDate) : (modDate || crDate);
      if (!itemDate || itemDate < window.from) continue;

      const zohoId = item.item_id;
      if (!zohoId) continue;

      const sku = item.sku?.trim() || "";
      const name = (item.name ?? "").trim();

      // Product status: new | update
      const existingProduct =
        productByZohoId.get(zohoId) ||
        (sku ? productBySku.get(sku.toLowerCase()) : undefined);
      const status: "new" | "update" = existingProduct ? "update" : "new";

      if (status === "new") {
        newCount++;
      } else {
        updateCount++;
      }

      // Brand: name & status
      const rawBrand = item.brand?.trim();
      const brandName = rawBrand || DEFAULT_BRAND;
      const brandKey = brandName.toLowerCase();
      const isExistingBrand = brandByName.has(brandKey);
      const brandStatus: "existing" | "new" = isExistingBrand ? "existing" : "new";
      if (brandStatus === "new") {
        brandsToCreate.add(brandKey);
      }

      // Category: name & status
      const rawCatName = item.category_name?.trim();
      const categoryName = rawCatName || PLACEHOLDER_CATEGORY;
      const categoryId = item.category_id?.trim() || undefined;
      const catKey = categoryName.toLowerCase();
      const isExistingCategory =
        Boolean(categoryId && categoryByZohoId.has(categoryId)) ||
        categoryByName.has(catKey);
      const categoryStatus: "existing" | "new" = isExistingCategory ? "existing" : "new";
      if (categoryStatus === "new") {
        categoriesToCreate.add(catKey);
      }

      items.push({
        zohoId,
        name,
        sku: sku || undefined,
        brandName,
        brandStatus,
        categoryName,
        categoryId,
        categoryStatus,
        status,
        costPrice: item.purchase_rate ?? 0,
        sellingPrice: item.rate ?? 0,
        gstRate: item.tax_percentage ?? 18,
        hsnCode: item.hsn_or_sac?.trim() || undefined,
        stockOnHand: item.stock_on_hand ?? 0,
      });
    }

    log.info("stock preview built", {
      total: items.length,
      new: newCount,
      update: updateCount,
      brandsToCreate: brandsToCreate.size,
      categoriesToCreate: categoriesToCreate.size,
      window,
    });

    return successResponse({
      window,
      counts: {
        total: items.length,
        new: newCount,
        update: updateCount,
        brandsToCreate: brandsToCreate.size,
        categoriesToCreate: categoriesToCreate.size,
      },
      items,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("stock preview failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      error instanceof Error ? error.message : "Failed to preview Zoho stock items",
      500
    );
  }
}
