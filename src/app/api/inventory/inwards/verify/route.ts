export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// POST: Verify a Zoho-pulled inward transaction (adds stock)
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("inbound", "approve");
    const body = await req.json();
    const { transactionId, binId } = body;

    if (!transactionId) return errorResponse("Transaction ID required", 400);

    const transaction = await prisma.inventoryTransaction.findUnique({
      where: { id: transactionId },
      include: { product: true },
    });

    if (!transaction) return errorResponse("Transaction not found", 404);
    if (transaction.type !== "INWARD") return errorResponse("Not an inward transaction", 400);
    if (!transaction.notes?.includes("[ZOHO]")) return errorResponse("Not a Zoho transaction", 400);
    if (transaction.notes?.includes("[VERIFIED]")) return errorResponse("Already verified", 400);

    // Now actually add the stock — read product INSIDE transaction to prevent race condition
    await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUniqueOrThrow({
        where: { id: transaction.productId },
      });

      const newStock = product.currentStock + transaction.quantity;

      await tx.product.update({
        where: { id: product.id },
        data: {
          currentStock: newStock,
          ...(binId && { binId }),
        },
      });

      await tx.inventoryTransaction.update({
        where: { id: transactionId },
        data: {
          previousStock: product.currentStock,
          newStock,
          notes: transaction.notes!
            .replace("[UNVERIFIED]", "[VERIFIED]")
            + ` | Verified by: ${user.name} at ${new Date().toISOString()}`,
        },
      });
    });

    return successResponse({ message: "Inward verified, stock added", id: transactionId });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Verification failed", 400);
  }
}
