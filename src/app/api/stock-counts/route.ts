export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { stockCountSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { BIN_TRACKING_ENABLED, isStockLocation, type StockLocation } from "@/lib/inventory-config";
import { getLocationQtyMap } from "@/lib/stock-location";

export async function GET(req: NextRequest) {
  try {
    const user = await requireFeature("stock_audit", "view");
    const { page, limit, skip, searchParams } = parseSearchParams(req.url);
    const status = searchParams.get("status") || undefined;

    // Non-admins only see their own assigned stock counts
    const isAdmin = await userCan(user.id, "stock_audit", "approve");

    const where = {
      ...(status && { status }),
      ...(!isAdmin && { assignedToId: user.id }),
    };

    const [counts, total] = await Promise.all([
      prisma.stockCount.findMany({
        where,
        include: {
          assignedTo: { select: { name: true } },
          _count: { select: { items: true } },
          items: { select: { countedQty: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.stockCount.count({ where }),
    ]);

    const data = counts.map((c) => {
      const countedItems = c.items.filter((i) => i.countedQty !== null).length;
      return {
        id: c.id,
        countNo: c.countNo,
        title: c.title,
        assignedTo: c.assignedTo,
        status: c.status,
        dueDate: c.dueDate,
        completedAt: c.completedAt,
        notes: c.notes,
        createdAt: c.createdAt,
        totalItems: c._count.items,
        countedItems,
      };
    });

    return paginatedResponse(data, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch stock counts", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("stock_audit", "create");
    const body = await req.json();
    const data = stockCountSchema.parse(body);

    // Must assign to someone
    if (!data.assignedToId) return errorResponse("You must assign the stock count to a team member", 400);
    const isSelfCount = body.selfCount === true;
    if (data.assignedToId === user.id && !isSelfCount) return errorResponse("You cannot assign a stock count to yourself", 400);

    let productIds = data.productIds;
    const binId = body.binId as string | undefined;
    const locationScope = body.location as string | undefined;
    const productType = data.productType || undefined;
    // Location mode (bins dormant): locationScope is one of the 4 StockLocations.
    const isLocationScoped = !BIN_TRACKING_ENABLED && isStockLocation(locationScope);

    let binIds: string[] | undefined;
    if (!productIds || productIds.length === 0) {
      // Bin mode only: find all bins in that location, then products from those bins.
      if (BIN_TRACKING_ENABLED && locationScope) {
        const locationBins = await prisma.bin.findMany({
          where: { location: locationScope, isActive: true },
          select: { id: true },
        });
        binIds = locationBins.map((b) => b.id);
        if (binIds.length === 0) {
          return errorResponse("No active bins found for this location.", 400);
        }
      }

      // Baseline mode: include ALL active products so clerks can count what's
      // physically there (items may not be assigned to a bin yet)
      const BASELINE_END = new Date("2026-07-31T23:59:59+05:30");
      const isBaseline = new Date() <= BASELINE_END;

      const allProducts = await prisma.product.findMany({
        where: {
          status: "ACTIVE",
          ...(productType ? { type: productType } : {}),
          ...(BIN_TRACKING_ENABLED && !isBaseline && binId ? { binId } : {}),
          ...(BIN_TRACKING_ENABLED && !isBaseline && binIds ? { binId: { in: binIds } } : {}),
        },
        select: { id: true },
      });

      if (allProducts.length === 0) {
        return errorResponse("No active products found for this filter.", 400);
      }

      productIds = allProducts.map((p) => p.id);
    }

    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, currentStock: true, binId: true },
    });

    // In location mode, systemQty is the quantity AT THE COUNTED LOCATION so the
    // variance is per-location (not against the product's total).
    const locQtyMap = isLocationScoped ? await getLocationQtyMap(productIds, locationScope as StockLocation) : null;

    // Generate countNo: SC-YYYYMM-NNNN
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const lastCount = await prisma.stockCount.findFirst({
      where: { countNo: { startsWith: `SC-${ym}-` } },
      orderBy: { countNo: "desc" },
      select: { countNo: true },
    });
    const seq = lastCount?.countNo ? parseInt(lastCount.countNo.split("-").pop()!) + 1 : 1;
    const countNo = `SC-${ym}-${String(seq).padStart(4, "0")}`;

    const stockCount = await prisma.stockCount.create({
      data: {
        countNo,
        title: data.title,
        assignedToId: data.assignedToId || user.id,
        binId: binId || null,
        location: locationScope || null,
        productType: productType || null,
        dueDate: new Date(data.dueDate),
        notes: data.notes,
        items: {
          create: products.map((p) => ({
            productId: p.id,
            // Only show system stock if product belongs to THIS bin/location
            // Products from other bins show systemQty=0 so clerks aren't confused
            systemQty: (() => {
              if (isLocationScoped) return locQtyMap!.get(p.id) ?? 0; // qty at the counted location
              if (!p.binId) return p.currentStock; // unassigned product — show its stock
              if (binId && p.binId !== binId) return 0; // belongs to a different bin
              if (binIds && !binIds.includes(p.binId)) return 0; // belongs to a bin outside this location
              return p.currentStock;
            })(),
          })),
        },
      },
      include: {
        assignedTo: { select: { name: true } },
        _count: { select: { items: true } },
      },
    });

    return successResponse(stockCount, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create stock count", 400);
  }
}
