export const dynamic = "force-dynamic";

export const runtime = "nodejs";
// nodejs, explicitly: this route reaches SMTP (a raw socket on 587) and the FCM JWT signer
// (node crypto) through notify(). Neither works on the edge runtime, and the failure there
// is not self-explanatory. Node is the default today; this stops a later change from
// silently breaking sends. See the notifications plan, Part C and D.1.
import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { maybeNotifyBelowReorder, type ReorderCrossing } from "@/lib/notify/stock";

export async function PUT(req: NextRequest) {
  try {
    const user = await requireFeature("deliveries", "edit");
    const body = await req.json();
    const { deliveryIds, action } = body as { deliveryIds: string[]; action: string };

    if (!deliveryIds || !Array.isArray(deliveryIds) || deliveryIds.length === 0) {
      return errorResponse("No deliveries selected", 400);
    }
    if (deliveryIds.length > 50) {
      return errorResponse("Maximum 50 deliveries per batch", 400);
    }

    if (!["OUT_FOR_DELIVERY", "DELIVERED"].includes(action)) {
      return errorResponse("Invalid action", 400);
    }

    const expectedStatus = action === "OUT_FOR_DELIVERY" ? "SCHEDULED" : "OUT_FOR_DELIVERY";
    const deliveries = await prisma.delivery.findMany({
      where: { id: { in: deliveryIds }, status: expectedStatus },
    });

    if (deliveries.length === 0) {
      return errorResponse(`No deliveries in ${expectedStatus} status`, 400);
    }

    // §F.0: filled INSIDE the transaction across every delivery and item, sent ONCE after it
    // commits. A batch can touch dozens of products; sending inside would eat the 5-second
    // transaction budget and roll back every deduction in the batch.
    const crossings: ReorderCrossing[] = [];

    const result = await prisma.$transaction(async (tx) => {
      let updated = 0;

      for (const delivery of deliveries) {
        const updateData: Record<string, unknown> = { status: action };

        if (action === "OUT_FOR_DELIVERY") {
          updateData.dispatchedAt = new Date();
        }

        if (action === "DELIVERED") {
          updateData.deliveredAt = new Date();

          // Idempotency: skip if already deducted
          const alreadyDeducted = await tx.inventoryTransaction.findFirst({
            where: { referenceNo: delivery.invoiceNo, type: "OUTWARD" },
          });
          if (alreadyDeducted) {
            await tx.delivery.update({ where: { id: delivery.id }, data: updateData });
            updated++;
            continue;
          }

          // Stock deduction — prefer BCH location
          const items = (delivery.lineItems as Array<{ name: string; sku: string; quantity: number; rate: number }>) || [];
          const wasReserved = !!(delivery as unknown as { stockReservedAt: Date | null }).stockReservedAt;

          for (const item of items) {
            if (!item.sku) continue;
            const product = await tx.product.findFirst({
              where: { sku: item.sku, bin: { location: { startsWith: "Bharath Cycle Hub" } } },
              select: { id: true, currentStock: true, reservedStock: true },
            }) || await tx.product.findFirst({
              where: { sku: item.sku },
              select: { id: true, currentStock: true, reservedStock: true },
            });
            if (!product) continue;

            if (wasReserved) {
              const newStock = product.currentStock - item.quantity;
              if (newStock < 0) {
                throw new Error(`Insufficient stock for ${item.name} (SKU: ${item.sku}) on invoice ${delivery.invoiceNo}. Available: ${product.currentStock}, Needed: ${item.quantity}`);
              }
              await tx.product.update({
                where: { id: product.id },
                data: {
                  currentStock: newStock,
                  reservedStock: Math.max(0, product.reservedStock - item.quantity),
                },
              });
            } else {
              const available = product.currentStock - product.reservedStock;
              if (available < item.quantity) {
                throw new Error(`Insufficient available stock for ${item.name} (SKU: ${item.sku}) on invoice ${delivery.invoiceNo}. Available: ${available}, Needed: ${item.quantity}`);
              }
              await tx.product.update({
                where: { id: product.id },
                data: { currentStock: product.currentStock - item.quantity },
              });
            }
            // Both branches above moved currentStock DOWN by item.quantity — the reserved one and
            // the direct one alike — so both can cross the reorder line. Collect only (§F.0).
            crossings.push({
              productId: product.id,
              previousStock: product.currentStock,
              newStock: product.currentStock - item.quantity,
            });
            await tx.inventoryTransaction.create({
              data: {
                type: "OUTWARD",
                productId: product.id,
                quantity: item.quantity,
                previousStock: product.currentStock,
                newStock: product.currentStock - item.quantity,
                referenceNo: delivery.invoiceNo,
                notes: `[ZOHO][VERIFIED] Customer: ${delivery.customerName} | Invoice: ${delivery.invoiceNo} | ${item.name} x${item.quantity}`,
                userId: user.id,
              },
            });
          }
        }

        await tx.delivery.update({ where: { id: delivery.id }, data: updateData });
        updated++;
      }

      return { updated };
    });

    // §F.0: committed. One helper call for the whole batch, after the response has gone out;
    // nothing is sent if the transaction threw (e.g. insufficient stock on a later item).
    after(() => maybeNotifyBelowReorder(crossings));

    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to batch update", 400);
  }
}
