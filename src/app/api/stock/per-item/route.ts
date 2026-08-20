import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

interface LastDatesRow {
  productId: string;
  lastInward: Date | null;
  lastOutward: Date | null;
}

export async function GET(request: Request) {
  try {
    await requireFeature("stock", "view");

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || undefined;
    const brandId = searchParams.get("brandId") || undefined;
    const categoryId = searchParams.get("categoryId") || undefined;
    const binId = searchParams.get("binId") || undefined;

    const products = await prisma.product.findMany({
      where: {
        status: "ACTIVE",
        ...(search && {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { sku: { contains: search, mode: "insensitive" } },
            { brand: { name: { contains: search, mode: "insensitive" } } },
          ],
        }),
        ...(brandId && { brandId }),
        ...(categoryId && { categoryId }),
        ...(binId && { binId }),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        currentStock: true,
        costPrice: true,
        sellingPrice: true,
        brand: { select: { id: true, name: true } },
        category: { select: { name: true } },
        bin: { select: { id: true, code: true, name: true, location: true } },
      },
      orderBy: { name: "asc" },
    });

    // Fetch last inward/outward dates for all matched products in a single query
    const productIds = products.map((p) => p.id);

    let lastDatesMap: Record<string, { lastInward: string | null; lastOutward: string | null }> = {};

    if (productIds.length > 0) {
      const lastDates = await prisma.$queryRaw<LastDatesRow[]>`
        SELECT
          "productId",
          MAX(CASE WHEN type = 'INWARD' THEN "createdAt" END) as "lastInward",
          MAX(CASE WHEN type = 'OUTWARD' THEN "createdAt" END) as "lastOutward"
        FROM "InventoryTransaction"
        WHERE "productId" = ANY(${productIds})
        GROUP BY "productId"
      `;

      lastDatesMap = Object.fromEntries(
        lastDates.map((row) => [
          row.productId,
          {
            lastInward: row.lastInward ? new Date(row.lastInward).toISOString() : null,
            lastOutward: row.lastOutward ? new Date(row.lastOutward).toISOString() : null,
          },
        ])
      );
    }

    // Group products by name (normalized) to merge across bins
    const grouped: Record<
      string,
      {
        name: string;
        brandName: string | null;
        brandId: string | null;
        categoryName: string | null;
        totalStock: number;
        bins: {
          binId: string | null;
          binCode: string | null;
          binName: string | null;
          binLocation: string | null;
          stock: number;
          sku: string;
          productId: string;
          costPrice: number;
          sellingPrice: number;
          lastInward: string | null;
          lastOutward: string | null;
        }[];
      }
    > = {};

    for (const p of products) {
      const key = p.name.trim().toLowerCase();
      if (!grouped[key]) {
        grouped[key] = {
          name: p.name,
          brandName: p.brand?.name ?? null,
          brandId: p.brand?.id ?? null,
          categoryName: p.category?.name ?? null,
          totalStock: 0,
          bins: [],
        };
      }
      grouped[key].totalStock += p.currentStock;
      const dates = lastDatesMap[p.id] || { lastInward: null, lastOutward: null };
      grouped[key].bins.push({
        binId: p.bin?.id ?? null,
        binCode: p.bin?.code ?? null,
        binName: p.bin?.name ?? null,
        binLocation: p.bin?.location ?? null,
        stock: p.currentStock,
        sku: p.sku,
        productId: p.id,
        costPrice: p.costPrice,
        sellingPrice: p.sellingPrice,
        lastInward: dates.lastInward,
        lastOutward: dates.lastOutward,
      });
    }

    // Convert to sorted array
    const result = Object.values(grouped).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError)
      return errorResponse(error.message, error.status);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch per-item stock",
      500
    );
  }
}
