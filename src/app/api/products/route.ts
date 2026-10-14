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
import { PLACEHOLDER_BRAND_NAMES_LOWER, PLACEHOLDER_CATEGORY } from "@/lib/import-placeholders";
import { storeById } from "@/lib/stores";
import { createLogger } from "@/lib/logger";
import { categorySubtreeIds } from "@/lib/categories/tree";
import { conditionByProduct, hasNoAssemblyUnitsWhere, ZERO_CONDITION, type UnitScope } from "@/lib/stock-condition";
import { productHasNoBinWhere } from "@/lib/products/bin-filter";
import { warehouseById } from "@/lib/warehouses";
import { getBinQtyMap, getWarehouseHoldings } from "@/lib/units/bin-qty";
import { isLowStock } from "@/lib/reorder";

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

    // Location and bin scopes (plan 1410-stock-location-and-bin, A2) — the Location and Bin
    // pickers on /stock. Same contract as the store scope: only what the scope holds is listed,
    // and every `currentStock` is the scope's own number.
    //   warehouseId               one location — its StockLevel quantity
    //   binId                     one bin — what is PHYSICALLY in it (getBinQtyMap: live units,
    //                             else the typed-in quantity), not products whose home bin merely
    //                             points there (R3). It used to match the home bin too, and show
    //                             the product's total everywhere.
    //   warehouseId + binId=none  the location's stock that is in no bin (Q1)
    // Each id is checked, and a bin must sit in the location and the store it is sent with: a
    // mismatch is refused rather than answered with an empty list that looks like "nothing here".
    const warehouseIdParam = searchParams.get("warehouseId") || undefined;
    const binIdParam = searchParams.get("binId") || undefined;
    const warehouse = warehouseIdParam ? await warehouseById(warehouseIdParam) : null;
    if (warehouseIdParam && !warehouse) {
      log.warn("unknown location on product list", { warehouseId: warehouseIdParam });
      return errorResponse("Unknown location", 400);
    }
    if (warehouse && storeId && warehouse.storeId !== storeId) {
      log.warn("location outside store on product list", { warehouseId: warehouse.id, storeId });
      return errorResponse("That location is not in this store", 400);
    }
    const noBin = binIdParam === "none";
    if (noBin && !warehouse) {
      log.warn("no-bin scope without a location", {});
      return errorResponse("Choose a location to list its stock that is in no bin", 400);
    }
    const bin =
      binIdParam && !noBin
        ? await prisma.bin.findUnique({
            where: { id: binIdParam },
            select: { id: true, warehouseId: true, isActive: true, warehouse: { select: { storeId: true, isActive: true } } },
          })
        : null;
    if (binIdParam && !noBin && (!bin || !bin.isActive || !bin.warehouse.isActive)) {
      log.warn("unknown bin on product list", { binId: binIdParam });
      return errorResponse("Unknown bin", 400);
    }
    if (bin && warehouse && bin.warehouseId !== warehouse.id) {
      log.warn("bin outside location on product list", { binId: bin.id, warehouseId: warehouse.id });
      return errorResponse("That bin is not in this location", 400);
    }
    if (bin && storeId && bin.warehouse.storeId !== storeId) {
      log.warn("bin outside store on product list", { binId: bin.id, storeId });
      return errorResponse("That bin is not in this store", 400);
    }

    // The narrowest scope wins: a bin, the no-bin stock of a location, a location, a store.
    const scope: { kind: "bin" | "no-bin" | "location" | "store"; id: string; units: UnitScope } | null =
      bin ? { kind: "bin", id: bin.id, units: { binId: bin.id } }
      : noBin && warehouse ? { kind: "no-bin", id: warehouse.id, units: { warehouseId: warehouse.id, unbinned: true } }
      : warehouse ? { kind: "location", id: warehouse.id, units: { warehouseId: warehouse.id } }
      : storeId ? { kind: "store", id: storeId, units: { storeId } }
      : null;

    // R43, P13: a parent category includes its children's products; a child (a leaf) is just
    // itself. One recursive CTE (Part I's helper), then a plain `IN`.
    const categoryIds = categoryId ? await categorySubtreeIds(prisma, categoryId) : undefined;

    // R42: `condition=no-assembly` keeps products that hold at least one live non-assemblable
    // unit — in the scoped store when there is one. Any other value is ignored, not refused, so
    // an old bookmark still loads the list.
    const condition = searchParams.get("condition") || undefined;
    const noAssemblyOnly = condition === "no-assembly";

    // `lowStock=1` — the Low Stock chip on /stock, server-side so it pages like every other
    // filter (plan 1410-stock-quick-add; it used to filter only the 100 rows already loaded).
    // The rule is `isLowStock` (src/lib/reorder.ts): a reorder level is set AND stock is at or
    // below it. Zero stock is included — "what do I need to order" includes what has run out.
    const lowStockOnly = searchParams.get("lowStock") === "1" || searchParams.get("lowStock") === "true";

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

    if (noAssemblyOnly) and.push(hasNoAssemblyUnitsWhere(scope?.units));

    if (needsDetails) {
      log.debug("needs-details filter", { hasSearch: Boolean(search), storeId: storeId ?? null });
      // A product "needs details" when nobody has given it a real brand OR a real category
      // (plan 3009, R1–R3). Either one is enough. `Product.brandId` and `categoryId` are
      // non-null, so an import with no value cannot record "unknown" — it writes a placeholder
      // name instead, and matching those IS the query for "nobody has looked at this row yet".
      // Case-insensitive, sharing `PLACEHOLDER_BRAND_NAMES_LOWER` / `PLACEHOLDER_CATEGORY` with
      // `isPlaceholderBrand` / `isPlaceholderCategory` so the filter and the card can never
      // disagree: if they did, a row would render as needing details while the filter passed it by.
      //
      // Category used to be excluded because every imported product was `Uncategorized`. The
      // catalog import now writes the real Zoho category, so the placeholder is the exception
      // again (665 of 5,738) and belongs in the queue.
      //
      // The bin is the other kind of missing detail, and the only one no import could ever
      // fill: a bin is a physical shelf here and Zoho has never heard of it. Bins are always on
      // (plan 2109, Q27), so a product with no bin always counts as needing one.
      //
      // "No bin" means no home bin AND no stock in any bin (plan 2209-audit-assigns-product-bin,
      // R3): a product a bin audit put on a shelf is not missing a bin just because its home bin
      // field was never written.
      and.push({
        OR: [
          { brand: { name: { in: PLACEHOLDER_BRAND_NAMES_LOWER, mode: "insensitive" as const } } },
          { category: { name: { equals: PLACEHOLDER_CATEGORY, mode: "insensitive" as const } } },
          productHasNoBinWhere(),
        ],
      });
    }

    // A bin is a scope now (above), not a where-clause: `productInBinWhere` (plan 2209, R2) also
    // matched a product whose home bin is the bin while its stock sat elsewhere, and left the
    // Stock column on the product's total everywhere (plan 1410-stock-location-and-bin, §2.1).

    // The half of isLowStock that reads only the product row, so it holds on both paths below.
    // The other half — stock at or below the level — compares against a DIFFERENT stock number
    // on each path, so each path applies it itself.
    if (lowStockOnly) and.push({ reorderLevel: { gt: 0 } });

    const where = {
      ...(and.length > 0 && { AND: and }),
      ...(categoryIds && { categoryId: categoryIds.length === 1 ? categoryIds[0] : { in: categoryIds } }),
      ...(brandId && { brandId }),
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
      // The row's assembly-level chip and the sheet it opens pre-filled (plan 1509-assembly-
      // queue…, E1). Without it the sheet would open on "Not set" for a product that has one.
      assemblyLevel: true,
      category: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } },
      bin: { select: { id: true, code: true, location: true } },
    } satisfies Prisma.ProductSelect;

    if (scope) {
      // The scoped list — a store (D8), and since plan 1410-stock-location-and-bin a location,
      // a bin or a location's no-bin stock. `Product.currentStock` is the global cache across
      // every warehouse, so under a scope it is the wrong number to show, sort by or range on.
      // Each scope yields its own quantity per product, and Prisma cannot order or paginate on
      // those — so this path fetches the matched set, bounded by "products the scope holds with
      // quantity above zero", and sorts and pages it in code. The response shape is the same as
      // below.
      //
      // "Present" is quantity > 0. `adjustWarehouseQty` clamps at zero (stock-location.ts:37),
      // so > 0 and != 0 are the same set today; > 0 says what it means.
      const qtyOf = await scopedQuantities(scope);

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
      // Low against the SCOPE's quantity — the number the Stock column shows under a scope.
      if (lowStockOnly) rows = rows.filter(isLowStock);
      if (sortBy === "currentStock") {
        rows.sort((a, b) =>
          sortOrder === "asc" ? a.currentStock - b.currentStock : b.currentStock - a.currentStock
        );
      }
      const total = rows.length;
      const pageRows = await withCondition(rows.slice(skip, skip + limit), scope.units);

      log.debug("scoped product list", {
        scope: scope.kind,
        scopeId: scope.id,
        held: qtyOf.size,
        returned: pageRows.length,
      });
      return paginatedResponse(pageRows, total, page, limit);
    }

    // Unscoped, low stock compares the cached total with the level — a column-to-column test,
    // which Prisma expresses as a field reference. Wrapped in AND so it cannot collide with the
    // minStock / maxStock range that already sits on `currentStock` in `where`.
    const listWhere: Prisma.ProductWhereInput = lowStockOnly
      ? { AND: [where, { currentStock: { lte: prisma.product.fields.reorderLevel } }] }
      : where;
    if (lowStockOnly) log.debug("low-stock filter", { hasSearch: Boolean(search), page });

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where: listWhere,
        select,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      prisma.product.count({ where: listWhere }),
    ]);

    return paginatedResponse(await withCondition(products), total, page, limit);
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

/**
 * productId → what the scope holds, above zero only (plan 1410-stock-location-and-bin, A2).
 *   store     SUM(StockLevel) over the store's active warehouses (plan 0909, D8)
 *   location  that warehouse's StockLevel
 *   bin       getBinQtyMap — what is physically in the bin, the figure stock counts use
 *   no-bin    getWarehouseHoldings().noBin — the location's stock that no active bin holds,
 *             the same figure the Bin picker shows beside "No bin"
 */
async function scopedQuantities(scope: { kind: "bin" | "no-bin" | "location" | "store"; id: string }) {
  const qtyOf = new Map<string, number>();
  if (scope.kind === "store") {
    const held = await prisma.stockLevel.groupBy({
      by: ["productId"],
      where: { warehouse: { storeId: scope.id, isActive: true } },
      _sum: { quantity: true },
    });
    for (const row of held) {
      const qty = row._sum.quantity ?? 0;
      if (qty > 0) qtyOf.set(row.productId, qty);
    }
  } else if (scope.kind === "location") {
    const held = await prisma.stockLevel.findMany({
      where: { warehouseId: scope.id, quantity: { gt: 0 } },
      select: { productId: true, quantity: true },
    });
    for (const row of held) qtyOf.set(row.productId, row.quantity);
  } else if (scope.kind === "bin") {
    for (const [productId, qty] of await getBinQtyMap(scope.id)) if (qty > 0) qtyOf.set(productId, qty);
  } else {
    for (const [productId, qty] of (await getWarehouseHoldings(scope.id)).noBin) qtyOf.set(productId, qty);
  }
  return qtyOf;
}

/**
 * Attach `assembledUnits` / `unassembledUnits` / `noAssemblyUnits` to one page of rows (R10,
 * P7) — a single grouped query over the page's ids, so the list is not slowed by its length.
 * Under a scope, only the units the scope holds are counted (plan 1410-stock-location-and-bin, A3).
 */
async function withCondition<T extends { id: string }>(rows: T[], scope?: UnitScope) {
  const counts = await conditionByProduct(rows.map((r) => r.id), scope);
  return rows.map((r) => {
    const c = counts.get(r.id) ?? ZERO_CONDITION;
    return {
      ...r,
      assembledUnits: c.assembled,
      unassembledUnits: c.unassembled,
      noAssemblyUnits: c.noAssembly,
    };
  });
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
