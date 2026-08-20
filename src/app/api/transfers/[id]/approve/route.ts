export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// POST: Approve or reject a pending transfer
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("transfers", "approve");
    const { id } = await params;
    const body = await req.json();
    const { action } = body; // "approve" or "reject"

    if (!["approve", "reject"].includes(action)) {
      return errorResponse("Action must be 'approve' or 'reject'", 400);
    }

    const transaction = await prisma.inventoryTransaction.findUnique({
      where: { id },
    });

    if (!transaction) return errorResponse("Transfer not found", 404);
    if (transaction.type !== "TRANSFER") return errorResponse("Not a transfer", 400);
    if (!transaction.notes?.includes("[PENDING]")) return errorResponse("Transfer is not pending", 400);

    // Extract bin IDs from notes
    const fromBinMatch = transaction.notes.match(/\[fromBin:([^\]]+)\]/);
    const toBinMatch = transaction.notes.match(/\[toBin:([^\]]+)\]/);

    if (action === "approve") {
      if (!fromBinMatch || !toBinMatch) {
        return errorResponse("Cannot extract bin info from transfer", 400);
      }

      const fromBinId = fromBinMatch[1];
      const toBinId = toBinMatch[1];

      await prisma.$transaction(async (tx) => {
        // Update transaction status
        await tx.inventoryTransaction.update({
          where: { id },
          data: {
            notes: transaction.notes!.replace("[PENDING]", "[APPROVED]"),
          },
        });

        // Update product bin
        await tx.product.update({
          where: { id: transaction.productId },
          data: { binId: toBinId },
        });

        // Move serial items
        await tx.serialItem.updateMany({
          where: {
            productId: transaction.productId,
            binId: fromBinId,
            status: "IN_STOCK",
          },
          data: { binId: toBinId },
        });
      });

      return successResponse({ message: "Transfer approved", status: "APPROVED" });
    } else {
      // Reject
      await prisma.inventoryTransaction.update({
        where: { id },
        data: {
          notes: transaction.notes!.replace("[PENDING]", "[REJECTED]"),
        },
      });

      return successResponse({ message: "Transfer rejected", status: "REJECTED" });
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(error instanceof Error ? error.message : "Failed to process transfer", 400);
  }
}
