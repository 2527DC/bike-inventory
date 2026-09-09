export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  successResponse,
  errorResponse,
  paginatedResponse,
  parseSearchParams,
} from "@/lib/api-utils";
import { productSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { PLACEHOLDER_BRAND_NAMES_LOWER } from "@/lib/import-placeholders";
import { BIN_TRACKING_ENABLED } from "@/lib/inventory-config";
import { storeById } from "@/lib/stores";
import { createLogger } from "@/lib/logger";

const log = createLogger("products:list");

export async function GET(req: NextRequest) {
  try {
    const user = await requireFeature("stock", "view");
    const { page, limit, skip, sortBy, sortOrder, search, searchParams } =
      parseSearchParams(req.url);

    const isAdmin = await userCan(user.id, "cost_price", "view");

    const categoryId = searchParams.get("categoryId") || undefined;
    const brandId = searchParams.get("brandId") || undefined;
    const status = searchParams.get("status") || "ACTIVE";
    const binId = searchParams.get("binId") || undefined;
    const minStock = searchParams.get("minStock") ? parseInt(searchParams.get("minStock")!) : undefined;
    const maxStock = searchParams.get("maxStock") ? parseInt(searchParams.get("maxStock")!) : undefined;
    // "Needs details" — products the import could not describe. See the note on the clause below.
    const needsDetails = searchParams.get("needsDetails") === "true";
    // A store scope (plan 0909-stock-store-and-warehouse-scoping, D8). When set, the list is
    // "what this store holds" and every `currentStock` in the response is that store's number,
    // not the global cache. Resolved against the cached store set so a stale or mistyped id is
    // refused here rather than quietly returning an empty list.
    const storeIdParam = searchParams.get("storeId") || undefined;
    const store = storeIdParam ? await storeById(storeIdParam) : null;
    if (storeIdParam && !store) {
      log.warn("unknown store on product list", { storeId: storeIdParam });
      return errorResponse("Unknown store", 400);
    }
    const storeId = store?.id;

    // Search and needsDetails BOTH produce an OR group, and both used to want the same
    // top-level key. Collecting every OR group into one `AND` array is the only form that
    // survives combining them: `{ OR: search } + { OR: needsDetails }` in one object literal
    // silently drops the first, which would turn "search within the products that need
    // attention" into "every product that needs attention", with no error anywhere.
    //
    // Semantics are unchanged for search alone: `AND: [{ OR: … }]` ≡ `{ OR: … }`.
    const and: Prisma.ProductWhereInput[] = [];

    if (search) {
      const fieldOR = (word: string) => ([
        { name: { contains: word, mode: "insensitive" as const } },
        { sku: { contains: word, mode: "insensitive" as const } },
        { brand: { name: { contains: word, mode: "insensitive" as const } } },
      ]);
      // Every word must match SOMETHING — one AND entry per word, as before.
      for (const word of search.trim().split(/\s+/).filter(Boolean)) {
        and.push({ OR: fieldOR(word) });
      }
    }

    if (needsDetails) {
      // A product "needs details" when nobody has given it a real brand. `Product.brandId` is
      // non-null, so an import with no brand cannot record "unknown" — it writes one of the
      // placeholder names instead, and matching those IS the query for "nobody has looked at
      // this row yet". Case-insensitive, and sharing `PLACEHOLDER_BRAND_NAMES_LOWER` with
      // `isPlaceholderBrand` so the filter and the card can never disagree: if they did, a
      // row would render as needing a brand while the filter meant to collect it passed by.
      //
      // CATEGORY IS DELIBERATELY NOT TESTED HERE, and must not be added back. Every product
      // the catalog import creates is `Uncategorized`, so the name is the normal state of the
      // whole catalog rather than the exception — including it would return all 8,175 rows
      // and the filter would stop distinguishing anything.
      //
      // The bin is the other kind of missing detail, and the only one no import could ever
      // fill: a bin is a physical shelf here and Zoho has never heard of it. Included only
      // while bin tracking is on — with `BIN_TRACKING_ENABLED` false the bin UI is hidden
      // everywhere, so counting every product as "needs a bin" would swamp the filter with
      // rows a person has no screen to fix.
      and.push({
        OR: [
          { brand: { name: { in: PLACEHOLDER_BRAND_NAMES_LOWER, mode: "insensitive" as const } } },
          ...(BIN_TRACKING_ENABLED ? [{ binId: null }] : []),
        ],
      });
    }

    const where = {
      ...(and.length > 0 && { AND: and }),
      ...(categoryId && { categoryId }),
      ...(brandId && { brandId }),
      ...(binId && { binId }),
      ...(status && { status: status as never }),
      ...(minStock !== undefined && maxStock !== undefined
        ? { currentStock: { gte: minStock, lte: maxStock } }
        : minStock !== undefined ? { currentStock: { gte: minStock } }
        : maxStock !== undefined ? { currentStock: { lte: maxStock } }
        : {}),
    };

    // One select for both paths below, so the scoped list can never return a row shape the
    // unscoped one does not.
    const select = {
      id: true, sku: true, name: true, status: true,
      costPrice: isAdmin, sellingPrice: true, mrp: true, gstRate: true, hsnCode: true,
      currentStock: true, minStock: true, reorderLevel: true,
      // reorderQty and reorderVendorId are read by the /stock reorder sheet (P8), which
      // opens pre-filled from the row it was tapped on. Without them the sheet would show
      // 0 and no vendor for a product that has both, and saving would erase them.
      reorderQty: true, reorderVendorId: true,
      category: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } },
      bin: { select: { id: true, code: true, location: true } },
    } satisfies Prisma.ProductSelect;

    if (storeId) {
      // The store-scoped list (D8). `Product.currentStock` is the global cache across every
      // warehouse, so under a store filter it is the wrong number to show, sort by or range
      // on. The store's own quantity is SUM(StockLevel.quantity) over that store's active
      // warehouses, and Prisma cannot order or paginate on a relation aggregate — so this path
      // fetches the matched set, bounded by "products the store holds with quantity above
      // zero", and sorts and pages it in code. The response shape is the same as below.
      //
      // "Present in the store" is quantity > 0. `adjustWarehouseQty` clamps at zero
      // (stock-location.ts:37), so > 0 and != 0 are the same set today; > 0 says what it means.
      const held = await prisma.stockLevel.groupBy({
        by: ["productId"],
        where: { warehouse: { storeId, isActive: true } },
        _sum: { quantity: true },
      });
      const qtyOf = new Map<string, number>();
      for (const row of held) {
        const qty = row._sum.quantity ?? 0;
        if (qty > 0) qtyOf.set(row.productId, qty);
      }

      // `currentStock` is set to undefined, not deleted: Prisma ignores an undefined field,
      // and the range it carried (minStock/maxStock — which is also how the In Stock and
      // No Stock chips arrive: minStock=1 / maxStock=0) is applied to the SCOPED quantity
      // below. Left in the where clause it would test the global cache and contradict the
      // Stock column the person is looking at.
      const scopedWhere: Prisma.ProductWhereInput = {
        ...where,
        currentStock: undefined,
        id: { in: [...qtyOf.keys()] },
      };
      const matched = await prisma.product.findMany({
        where: scopedWhere,
        select,
        // The stock sort is done in code on the scoped number; every other sort is a plain
        // column and the database is still the right place for it.
        ...(sortBy !== "currentStock" && { orderBy: { [sortBy]: sortOrder } }),
      });

      let rows = matched.map((p) => ({ ...p, currentStock: qtyOf.get(p.id) ?? 0 }));
      if (minStock !== undefined) rows = rows.filter((p) => p.currentStock >= minStock);
      if (maxStock !== undefined) rows = rows.filter((p) => p.currentStock <= maxStock);
      if (sortBy === "currentStock") {
        rows.sort((a, b) =>
          sortOrder === "asc" ? a.currentStock - b.currentStock : b.currentStock - a.currentStock
        );
      }
      const total = rows.length;
      const pageRows = rows.slice(skip, skip + limit);

      log.debug("scoped product list", { storeId, held: qtyOf.size, returned: pageRows.length });
      return paginatedResponse(pageRows, total, page, limit);
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    return paginatedResponse(products, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    log.error("product list failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch products",
      500
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFeature("stock", "create");
    const body = await req.json();
    const data = productSchema.parse(body);

    // An inactive brand or category is not a destination (plan 0809-brand-category-inactive):
    // the create form's pickers no longer offer one, and a stale screen or a direct call must
    // not file a NEW product under a retired row. The same two lookups reclassify does.
    if (data.brandId) {
      const brand = await prisma.brand.findUnique({
        where: { id: data.brandId },
        select: { name: true, isActive: true },
      });
      if (!brand) return errorResponse("Selected brand no longer exists", 400);
      if (!brand.isActive) return errorResponse(`${brand.name} is inactive. Activate it on /more/brands first.`, 400);
    }
    if (data.categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: data.categoryId },
        select: { name: true, isActive: true },
      });
      if (!category) return errorResponse("Selected category no longer exists", 400);
      if (!category.isActive) return errorResponse(`${category.name} is inactive. Activate it on /categories first.`, 400);
    }

    const product = await prisma.product.create({
      data: {
        ...data,
        imageUrls: data.imageUrls || [],
        tags: data.tags || [],
      },
      include: { category: true, brand: true, bin: true },
    });

    return successResponse(product, 201);
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Failed to create product",
      400
    );
  }
}
