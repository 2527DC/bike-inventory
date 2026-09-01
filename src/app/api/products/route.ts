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
import { PLACEHOLDER_BRAND, PLACEHOLDER_CATEGORY } from "@/lib/import-placeholders";
import { BIN_TRACKING_ENABLED } from "@/lib/inventory-config";

export async function GET(req: NextRequest) {
  try {
    const user = await requireFeature("stock", "view");
    const { page, limit, skip, sortBy, sortOrder, search, searchParams } =
      parseSearchParams(req.url);

    const isAdmin = await userCan(user.id, "cost_price", "view");

    const categoryId = searchParams.get("categoryId") || undefined;
    const brandId = searchParams.get("brandId") || undefined;
    const type = searchParams.get("type") || undefined;
    const status = searchParams.get("status") || "ACTIVE";
    const size = searchParams.get("size") || undefined;
    const binId = searchParams.get("binId") || undefined;
    const minStock = searchParams.get("minStock") ? parseInt(searchParams.get("minStock")!) : undefined;
    const maxStock = searchParams.get("maxStock") ? parseInt(searchParams.get("maxStock")!) : undefined;
    // "Needs details" — products the import could not describe. See the note on the clause below.
    const needsDetails = searchParams.get("needsDetails") === "true";

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
        { size: { contains: word, mode: "insensitive" as const } },
      ]);
      // Every word must match SOMETHING — one AND entry per word, as before.
      for (const word of search.trim().split(/\s+/).filter(Boolean)) {
        and.push({ OR: fieldOR(word) });
      }
    }

    if (needsDetails) {
      // A product "needs details" when the import had to invent a value for it. Brand and
      // category are non-null columns, so the import writes a placeholder rather than being
      // able to say "unknown" — matching those two names IS the query for "nobody has looked
      // at this row yet". Case-insensitive so it agrees with `isPlaceholderBrand` on the card;
      // otherwise a renamed brand could render as a placeholder and still escape this filter.
      //
      // The bin is a third kind of missing detail, and the only one no import could ever fill:
      // a bin is a physical shelf in this warehouse and Zoho has never heard of it. It is
      // included only while bin tracking is on — with `BIN_TRACKING_ENABLED` false the bin UI
      // is hidden everywhere, so counting every product as "needs a bin" would swamp the
      // filter with rows a person has no screen to fix.
      and.push({
        OR: [
          { brand: { name: { equals: PLACEHOLDER_BRAND, mode: "insensitive" as const } } },
          { category: { name: { equals: PLACEHOLDER_CATEGORY, mode: "insensitive" as const } } },
          ...(BIN_TRACKING_ENABLED ? [{ binId: null }] : []),
        ],
      });
    }

    const where = {
      ...(and.length > 0 && { AND: and }),
      ...(categoryId && { categoryId }),
      ...(brandId && { brandId }),
      ...(binId && { binId }),
      ...(type && { type: type as never }),
      ...(status && { status: status as never }),
      ...(size && { size }),
      ...(minStock !== undefined && maxStock !== undefined
        ? { currentStock: { gte: minStock, lte: maxStock } }
        : minStock !== undefined ? { currentStock: { gte: minStock } }
        : maxStock !== undefined ? { currentStock: { lte: maxStock } }
        : {}),
    };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: {
          id: true, sku: true, name: true, type: true, status: true, size: true,
          costPrice: isAdmin, sellingPrice: true, mrp: true, gstRate: true, hsnCode: true,
          currentStock: true, minStock: true, reorderLevel: true,
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          bin: { select: { id: true, code: true, location: true } },
        },
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
