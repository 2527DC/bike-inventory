export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
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

    const where = {
      ...(search && (() => {
        const words = search.trim().split(/\s+/).filter(Boolean);
        const fieldOR = (word: string) => ([
          { name: { contains: word, mode: "insensitive" as const } },
          { sku: { contains: word, mode: "insensitive" as const } },
          { brand: { name: { contains: word, mode: "insensitive" as const } } },
          { size: { contains: word, mode: "insensitive" as const } },
        ]);
        if (words.length > 1) {
          return { AND: words.map((w) => ({ OR: fieldOR(w) })) };
        }
        return { OR: fieldOR(words[0]) };
      })()),
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
    const user = await requireFeature("stock", "create");
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
