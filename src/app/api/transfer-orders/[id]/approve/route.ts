export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { BIN_TRACKING_ENABLED } from "@/lib/inventory-config";
import { adjustWarehouseQty, getWarehouseBreakdown } from "@/lib/stock-location";

// POST: Approve or reject a transfer order
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireFeature("transfers", "approve");
    const { id } = await params;
    const body = await req.json();
    const { action, rejectionNote } = body; // "approve" or "reject"

    if (!["approve", "reject"].includes(action)) {
      return errorResponse("Action must be 'approve' or 'reject'", 400);
    }

    const order = await prisma.transferOrder.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: { select: { id: true, currentStock: true, name: true } },
            fromBin: { select: { id: true, code: true } },
            toBin: { select: { id: true, code: true } },
            // Warehouses are rows now, so their display names come from the join rather than
            // from a stockLocationLabel() lookup table.
            fromWarehouse: { select: { id: true, code: true, name: true } },
            toWarehouse: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });

    if (!order) return errorResponse("Transfer order not found", 404);
    if (order.status !== "PENDING") return errorResponse("Order is not pending", 400);

    if (action === "approve") {
      // Verify stock is still available at the source
      const breakdown = BIN_TRACKING_ENABLED
        ? new Map<string, Record<string, number>>()
        : await getWarehouseBreakdown(order.items.map((i) => i.productId));
      for (const item of order.items) {
        if (BIN_TRACKING_ENABLED) {
          if (item.product.currentStock < item.quantity) {
            return errorResponse(
              `Insufficient stock for ${item.product.name}. Available: ${item.product.currentStock}, Requested: ${item.quantity}`,
              400
            );
          }
        } else {
          // A transfer line with no source warehouse cannot be approved. Previously this
          // silently resolved to 0 available and produced an "Insufficient stock" message
          // that blamed the stock rather than the missing warehouse.
          if (!item.fromWarehouse || !item.toWarehouse) {
            return errorResponse(
              `${item.product.name} has no source or destination warehouse on its transfer line.`,
              400
            );
          }
          const available = breakdown.get(item.productId)?.[item.fromWarehouse.code] ?? 0;
          if (available < item.quantity) {
            return errorResponse(
              `Insufficient stock for ${item.product.name} at ${item.fromWarehouse.name}. Available: ${available}, Requested: ${item.quantity}`,
              400
            );
          }
        }
      }

      await prisma.$transaction(async (tx) => {
        // Update order status
        await tx.transferOrder.update({
          where: { id },
          data: { status: "APPROVED", reviewedById: user.id, reviewedAt: new Date() },
        });

        // Execute each item transfer
        for (const item of order.items) {
          if (BIN_TRACKING_ENABLED) {
            await tx.product.update({
              where: { id: item.productId },
              data: { binId: item.toBinId },
            });
            await tx.serialItem.updateMany({
              where: { productId: item.productId, binId: item.fromBinId!, status: "IN_STOCK" },
              data: { binId: item.toBinId },
            });
            await tx.inventoryTransaction.create({
              data: {
                type: "TRANSFER",
                productId: item.productId,
                quantity: item.quantity,
                previousStock: item.product.currentStock,
                newStock: item.product.currentStock,
                referenceNo: order.orderNo,
                notes: `[APPROVED] From: ${item.fromBin?.code} → To: ${item.toBin?.code} | Transfer Order: ${order.orderNo}`,
                userId: user.id,
              },
            });
          } else {
            // Warehouse mode: move qty out of source, into destination. Total unchanged.
            // Both are non-null here — the loop above refuses the order otherwise.
            await adjustWarehouseQty(tx, item.productId, item.fromWarehouseId!, -item.quantity);
            await adjustWarehouseQty(tx, item.productId, item.toWarehouseId!, item.quantity);
            await tx.inventoryTransaction.create({
              data: {
                type: "TRANSFER",
                productId: item.productId,
                quantity: item.quantity,
                previousStock: item.product.currentStock,
                newStock: item.product.currentStock,
                referenceNo: order.orderNo,
                notes: `[APPROVED] From: ${item.fromWarehouse?.name} → To: ${item.toWarehouse?.name} | Transfer Order: ${order.orderNo}`,
                userId: user.id,
              },
            });
          }
        }
      });

      return successResponse({ message: "Transfer order approved", status: "APPROVED" });
    } else {
      // Reject
      await prisma.transferOrder.update({
        where: { id },
        data: {
          status: "REJECTED",
          reviewedById: user.id,
          reviewedAt: new Date(),
          rejectionNote: rejectionNote || null,
        },
      });

      return successResponse({ message: "Transfer order rejected", status: "REJECTED" });
    }
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to process transfer order", 400);
  }
}
