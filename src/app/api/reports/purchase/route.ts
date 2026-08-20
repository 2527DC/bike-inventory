export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("reports", "view");
    const { searchParams } = new URL(req.url);

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dateFrom = searchParams.get("dateFrom") ? new Date(searchParams.get("dateFrom")!) : thirtyDaysAgo;
    const dateTo = searchParams.get("dateTo") ? new Date(searchParams.get("dateTo")!) : now;
    const vendorId = searchParams.get("vendorId") || undefined;

    const where = {
      orderDate: { gte: dateFrom, lte: dateTo },
      ...(vendorId && { vendorId }),
    };

    const orders = await prisma.purchaseOrder.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true, code: true } },
      },
    });

    const vendorMap = new Map<string, { name: string; code: string; orderCount: number; totalAmount: number; receivedAmount: number; pendingAmount: number }>();

    let totalOrders = 0;
    let totalAmount = 0;

    for (const order of orders) {
      totalOrders++;
      totalAmount += order.grandTotal;

      const key = order.vendorId;
      const existing = vendorMap.get(key) || {
        name: order.vendor.name,
        code: order.vendor.code,
        orderCount: 0, totalAmount: 0, receivedAmount: 0, pendingAmount: 0,
      };
      existing.orderCount++;
      existing.totalAmount += order.grandTotal;
      if (order.status === "RECEIVED") {
        existing.receivedAmount += order.grandTotal;
      } else if (order.status !== "CANCELLED") {
        existing.pendingAmount += order.grandTotal;
      }
      vendorMap.set(key, existing);
    }

    const vendors = Array.from(vendorMap.values()).sort((a, b) => b.totalAmount - a.totalAmount);

    return successResponse({
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      totalOrders,
      totalAmount,
      vendors,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch purchase report", 500);
  }
}
