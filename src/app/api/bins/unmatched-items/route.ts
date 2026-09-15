export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("bins", "view");

    const items = await prisma.inboundLineItem.findMany({
      where: {
        isDelivered: true,
        binId: null,
      },
      include: {
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            billNo: true,
            deliveredAt: true,
          },
        },
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
      orderBy: [
        { shipment: { deliveredAt: "desc" } },
        { id: "desc" },
      ],
    });

    return successResponse({
      items,
      total: items.length,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch unmatched items", 500);
  }
}
