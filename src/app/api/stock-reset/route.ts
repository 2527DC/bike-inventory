export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function POST(req: NextRequest) {
  try {
    // approve, NOT create: this zeroes currentStock and reservedStock on EVERY active product.
    // `create` is the grant a junior counter needs to START a stock count; `approve` is the
    // supervisory action on this module. The confirm string below is a typo guard, not a
    // permission check.
    await requireFeature("stock_audit", "approve");
    const body = await req.json();
    const { location, confirm } = body as { location?: string; confirm?: string };

    if (confirm !== "RESET_STOCK") {
      return errorResponse("Send { confirm: 'RESET_STOCK' } to confirm this destructive action", 400);
    }

    const where: Record<string, unknown> = { status: "ACTIVE" };

    if (location) {
      const bins = await prisma.bin.findMany({
        where: { location: { startsWith: location } },
        select: { id: true },
      });
      const binIds = bins.map((b) => b.id);
      where.binId = { in: binIds };
    }

    const result = await prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: where as never,
        select: { id: true, currentStock: true, name: true },
      });

      const nonZero = products.filter((p) => p.currentStock > 0);

      await tx.product.updateMany({
        where: { id: { in: nonZero.map((p) => p.id) } },
        data: { currentStock: 0, reservedStock: 0 },
      });

      return { productsReset: nonZero.length, location: location || "ALL" };
    });

    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Reset failed", 500);
  }
}
