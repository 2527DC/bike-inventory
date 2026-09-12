export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { binSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("bins", "view");
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouseId");

    const where: Record<string, unknown> = { isActive: true };
    if (warehouseId) {
      where.warehouseId = warehouseId;
    }

    const bins = await prisma.bin.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true, code: true, kind: true } },
        _count: { select: { products: true, binStocks: true, units: true } },
      },
      orderBy: [{ warehouse: { name: "asc" } }, { code: "asc" }],
    });
    return successResponse(bins);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch bins", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFeature("bins", "create");
    const body = await req.json();
    const data = binSchema.parse(body);

    // Check for duplicate code within the same warehouse
    const existing = await prisma.bin.findUnique({
      where: {
        warehouseId_code: {
          warehouseId: data.warehouseId,
          code: data.code,
        },
      },
    });

    if (existing) {
      return errorResponse(
        `Bin code "${data.code}" already exists in this warehouse. Try a different code.`,
        409
      );
    }

    const bin = await prisma.bin.create({
      data: {
        code: data.code.trim().toUpperCase(),
        name: data.name.trim(),
        warehouseId: data.warehouseId,
        location: data.location || null,
        directions: data.directions || null,
        floor: data.floor || null,
        zone: data.zone || null,
        capacity: data.capacity ?? null,
        isAssemblyArea: data.isAssemblyArea ?? false,
        isActive: data.isActive ?? true,
      },
      include: {
        warehouse: { select: { id: true, name: true, code: true, kind: true } },
      },
    });
    return successResponse(bin, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create bin", 400);
  }
}

