export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { LIVE_UNIT_STATUSES } from "@/lib/units";
import { getBinUnitCounts, EMPTY_BIN_COUNTS } from "@/lib/bins/unit-counts";

const log = createLogger("bins:inventory");

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("bins", "view");
    const { id } = await params;

    const bin = await prisma.bin.findUnique({
      where: { id },
      include: {
        warehouse: { select: { id: true, name: true, code: true, kind: true, storeId: true } },
      },
    });

    if (!bin) return errorResponse("Bin not found", 404);

    const [units, binStocks, recentMovements, counts] = await Promise.all([
      prisma.inventoryUnit.findMany({
        // Live units only, so "Items in this bin" agrees with the Total above it (plan 2109, R5).
        // A sold or lost unit can keep its old binId; it is no longer on the shelf.
        where: { binId: id, status: { in: LIVE_UNIT_STATUSES } },
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              brand: { select: { id: true, name: true } },
              category: { select: { id: true, name: true } },
            },
          },
          assembledBy: { select: { id: true, name: true } },
        },
        orderBy: { unitCode: "asc" },
      }),
      prisma.binStock.findMany({
        where: { binId: id, quantity: { gt: 0 } },
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              brand: { select: { id: true, name: true } },
              category: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { product: { name: "asc" } },
      }),
      prisma.binMovementLog.findMany({
        where: {
          OR: [{ fromBinId: id }, { toBinId: id }],
        },
        take: 20,
        orderBy: { createdAt: "desc" },
        include: {
          fromBin: { select: { id: true, code: true, name: true } },
          toBin: { select: { id: true, code: true, name: true } },
          movedBy: { select: { id: true, name: true } },
          unit: { select: { id: true, unitCode: true } },
          product: { select: { id: true, sku: true, name: true } },
        },
      }),
      // R5: the same live-unit figures the bins list shows on the card.
      getBinUnitCounts([id]),
    ]);

    return successResponse({
      bin,
      units,
      binStocks,
      recentMovements,
      unitCounts: counts.get(id) ?? EMPTY_BIN_COUNTS,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("bin inventory fetch failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch bin inventory", 500);
  }
}
