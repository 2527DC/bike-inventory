export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

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

    const [units, binStocks, recentMovements] = await Promise.all([
      prisma.inventoryUnit.findMany({
        where: { binId: id },
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
    ]);

    return successResponse({
      bin,
      units,
      binStocks,
      recentMovements,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch bin inventory", 500);
  }
}
