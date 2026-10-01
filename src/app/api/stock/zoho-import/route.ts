export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { z } from "zod";
import { ProductStatus, ProductCondition } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError, type CurrentUser } from "@/lib/auth-helpers";
import { logActivity } from "@/lib/activity-log";
import { DEFAULT_BRAND, PLACEHOLDER_CATEGORY } from "@/lib/import-placeholders";
import { createLogger } from "@/lib/logger";

const log = createLogger("stock:zoho-import");

const itemSchema = z.object({
  zohoId: z.string().min(1, "zohoId is required"),
  sku: z.string().optional().nullable(),
  name: z.string().min(1, "name is required"),
  brandName: z.string().optional().nullable(),
  categoryName: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  costPrice: z.number().optional().nullable(),
  sellingPrice: z.number().optional().nullable(),
  gstRate: z.number().optional().nullable(),
  hsnCode: z.string().optional().nullable(),
});

const bodySchema = z.object({
  items: z.array(itemSchema).default([]),
});

/**
 * POST /api/stock/zoho-import
 *
 * Imports selected active products from Zoho into the local database:
 * - Resolves or auto-creates Brands and Categories (case-insensitive)
 * - Upserts Products matching by zohoItemId or sku
 * - Logs activity and returns import counts
 */
export async function POST(req: NextRequest) {
  try {
    let user: CurrentUser;
    try {
      user = await requireFeature("zoho", "fetch");
    } catch {
      user = await requireFeature("stock", "create");
    }

    const raw = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid import request", 400);
    }

    const { items } = parsed.data;
    if (items.length === 0) {
      return successResponse({
        created: 0,
        updated: 0,
        brandsCreated: 0,
        categoriesCreated: 0,
      });
    }

    const result = await prisma.$transaction(
      async (tx) => {
        // 1. Load existing brands and categories for case-insensitive lookup
        const [existingBrands, existingCategories] = await Promise.all([
          tx.brand.findMany({ select: { id: true, name: true, zohoBrandId: true } }),
          tx.category.findMany({ select: { id: true, name: true, zohoCategoryId: true } }),
        ]);

        const brandByName = new Map<string, string>();
        for (const b of existingBrands) {
          brandByName.set(b.name.trim().toLowerCase(), b.id);
        }

        const categoryByName = new Map<string, string>();
        const categoryByZohoId = new Map<string, string>();
        for (const c of existingCategories) {
          categoryByName.set(c.name.trim().toLowerCase(), c.id);
          if (c.zohoCategoryId) {
            categoryByZohoId.set(c.zohoCategoryId, c.id);
          }
        }

        let brandsCreated = 0;
        let categoriesCreated = 0;

        async function resolveBrand(rawName?: string | null): Promise<string> {
          const name = (rawName?.trim() || DEFAULT_BRAND).trim();
          const key = name.toLowerCase();
          let brandId = brandByName.get(key);
          if (!brandId) {
            const created = await tx.brand.create({
              data: {
                name,
                isActive: true,
                leadDays: 7,
              },
              select: { id: true },
            });
            brandId = created.id;
            brandByName.set(key, brandId);
            brandsCreated++;
          }
          return brandId;
        }

        async function resolveCategory(rawName?: string | null, rawZohoCatId?: string | null): Promise<string> {
          const name = (rawName?.trim() || PLACEHOLDER_CATEGORY).trim();
          const zohoCatId = rawZohoCatId?.trim() || null;
          const key = name.toLowerCase();

          let categoryId: string | undefined = undefined;
          if (zohoCatId && categoryByZohoId.has(zohoCatId)) {
            categoryId = categoryByZohoId.get(zohoCatId);
          } else if (categoryByName.has(key)) {
            categoryId = categoryByName.get(key);
          }

          if (!categoryId) {
            const created = await tx.category.create({
              data: {
                name,
                zohoCategoryId: zohoCatId,
                isActive: true,
              },
              select: { id: true },
            });
            categoryId = created.id;
            categoryByName.set(key, categoryId);
            if (zohoCatId) {
              categoryByZohoId.set(zohoCatId, categoryId);
            }
            categoriesCreated++;
          }
          return categoryId;
        }

        // 2. Load existing products matching any zohoId or sku
        const zohoIds = items.map((i) => i.zohoId).filter(Boolean);
        const skus = items
          .map((i) => i.sku?.trim())
          .filter((s): s is string => Boolean(s));

        const existingProducts = await tx.product.findMany({
          where: {
            OR: [
              { zohoItemId: { in: zohoIds } },
              { sku: { in: skus } },
            ],
          },
          select: {
            id: true,
            sku: true,
            zohoItemId: true,
            name: true,
            costPrice: true,
            sellingPrice: true,
            mrp: true,
            gstRate: true,
            hsnCode: true,
          },
        });

        const productByZohoId = new Map(
          existingProducts.filter((p) => p.zohoItemId).map((p) => [p.zohoItemId!, p])
        );
        const productBySku = new Map(
          existingProducts.filter((p) => p.sku).map((p) => [p.sku.trim().toLowerCase(), p])
        );

        let created = 0;
        let updated = 0;

        for (const item of items) {
          const brandId = await resolveBrand(item.brandName);
          const categoryId = await resolveCategory(item.categoryName, item.categoryId);

          const zohoId = item.zohoId.trim();
          const sku = item.sku?.trim() || "";

          const existing =
            productByZohoId.get(zohoId) ||
            (sku ? productBySku.get(sku.toLowerCase()) : undefined);

          const costPrice =
            typeof item.costPrice === "number" && !isNaN(item.costPrice) ? item.costPrice : undefined;
          const sellingPrice =
            typeof item.sellingPrice === "number" && !isNaN(item.sellingPrice) ? item.sellingPrice : undefined;
          const gstRate =
            typeof item.gstRate === "number" && !isNaN(item.gstRate) ? item.gstRate : undefined;
          const hsnCode = item.hsnCode !== undefined ? (item.hsnCode?.trim() || null) : undefined;

          if (existing) {
            const updateData: Parameters<typeof tx.product.update>[0]["data"] = {
              name: item.name.trim(),
              brandId,
              categoryId,
              status: ProductStatus.ACTIVE,
              ...(costPrice !== undefined ? { costPrice } : {}),
              ...(sellingPrice !== undefined ? { sellingPrice, mrp: sellingPrice } : {}),
              ...(gstRate !== undefined ? { gstRate } : {}),
              ...(hsnCode !== undefined ? { hsnCode } : {}),
              ...(zohoId && !existing.zohoItemId ? { zohoItemId: zohoId } : {}),
            };

            const updatedProd = await tx.product.update({
              where: { id: existing.id },
              data: updateData,
              select: {
                id: true,
                sku: true,
                zohoItemId: true,
                name: true,
                costPrice: true,
                sellingPrice: true,
                mrp: true,
                gstRate: true,
                hsnCode: true,
              },
            });

            if (updatedProd.zohoItemId) productByZohoId.set(updatedProd.zohoItemId, updatedProd);
            if (updatedProd.sku) productBySku.set(updatedProd.sku.toLowerCase(), updatedProd);
            updated++;
          } else {
            let finalSku = sku || `ZOHO-${zohoId}`;
            if (productBySku.has(finalSku.toLowerCase())) {
              finalSku = `${finalSku}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
            }

            const newProd = await tx.product.create({
              data: {
                name: item.name.trim(),
                sku: finalSku,
                brandId,
                categoryId,
                status: ProductStatus.ACTIVE,
                condition: ProductCondition.NEW,
                currentStock: 0,
                costPrice: costPrice ?? 0,
                sellingPrice: sellingPrice ?? 0,
                mrp: sellingPrice ?? 0,
                gstRate: gstRate ?? 18,
                hsnCode: hsnCode || null,
                zohoItemId: zohoId || null,
              },
              select: {
                id: true,
                sku: true,
                zohoItemId: true,
                name: true,
                costPrice: true,
                sellingPrice: true,
                mrp: true,
                gstRate: true,
                hsnCode: true,
              },
            });

            if (newProd.zohoItemId) productByZohoId.set(newProd.zohoItemId, newProd);
            productBySku.set(newProd.sku.toLowerCase(), newProd);
            created++;
          }
        }

        await logActivity(tx, {
          module: "stock",
          action: "sync",
          entityType: "stock",
          entityId: "zoho-import",
          entityRef: "zoho-import",
          details: `Imported ${items.length} items from Zoho (${created} created, ${updated} updated, ${brandsCreated} brands created, ${categoriesCreated} categories created)`,
          userId: user.id,
          userName: user.name,
        });

        return { created, updated, brandsCreated, categoriesCreated };
      },
      { timeout: 60000, maxWait: 10000 }
    );

    log.info("zoho stock import completed", result);
    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("stock import failed", {
      message: error instanceof Error ? error.message : String(error),
      code: (error as { code?: string } | null)?.code,
    });

    if ((error as { code?: string } | null)?.code === "P2002") {
      return errorResponse(
        "A product SKU or Zoho item ID conflicted with an existing record during import. Please try again.",
        409
      );
    }

    return errorResponse(
      error instanceof Error ? error.message : "Failed to import Zoho stock items",
      500
    );
  }
}
