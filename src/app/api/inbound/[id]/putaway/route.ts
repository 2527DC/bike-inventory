export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// POST: Assign bins to delivered line items (post-delivery putaway)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireFeature("inbound", "approve");
    const { id } = await params;
    const body = await req.json();
    const items: Array<{ lineItemId: string; binId: string }> = body.items || [];

    if (items.length === 0) return errorResponse("No items provided", 400);

    const shipment = await prisma.inboundShipment.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!shipment) return errorResponse("Shipment not found", 404);

    let updated = 0;
    for (const item of items) {
      const lineItem = await prisma.inboundLineItem.findFirst({
        where: { id: item.lineItemId, shipmentId: id },
      });
      if (!lineItem) continue;

      await prisma.inboundLineItem.update({
        where: { id: item.lineItemId },
        data: { binId: item.binId },
      });

      // Also update product's default bin
      if (lineItem.productId) {
        await prisma.product.update({
          where: { id: lineItem.productId },
          data: { binId: item.binId },
        });
      }
      updated++;
    }

    // Record putaway user on shipment if not already set
    if (updated > 0) {
      await prisma.inboundShipment.update({
        where: { id, putawayById: null },
        data: { putawayAt: new Date(), putawayById: user.id },
      }).catch(() => {}); // ignore if already set
    }

    return successResponse({ updated });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Putaway failed", 400);
  }
}
