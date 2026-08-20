export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// DELETE — remove all Zoho-imported transactions + optionally reverse stock
// Query param: ?reverse=true (default) reverses stock, ?reverse=false keeps stock
export async function DELETE(req: NextRequest) {
  try {
    await requireFeature("stock", "delete");

    const reverseStock = req.nextUrl.searchParams.get("reverse") !== "false";
    let stockReversals = 0;

    if (reverseStock) {
      // Find all VERIFIED Zoho transactions and reverse stock changes
      const verifiedTransactions = await prisma.inventoryTransaction.findMany({
        where: {
          notes: { contains: "[ZOHO][VERIFIED]" },
        },
        select: { id: true, productId: true, quantity: true, type: true },
      });

      // Reverse stock for each verified transaction
      for (const tx of verifiedTransactions) {
        const delta = tx.type === "INWARD" ? -tx.quantity : tx.quantity;
        await prisma.product.update({
          where: { id: tx.productId },
          data: { currentStock: { increment: delta } },
        });
        stockReversals++;
      }
    }

    // Delete all Zoho transactions
    const zohoTransactions = await prisma.inventoryTransaction.deleteMany({
      where: { notes: { contains: "[ZOHO]" } },
    });

    // Delete vendor bills
    const zohoBills = await prisma.vendorBill.deleteMany({
      where: { billNo: { not: "" } },
    });

    // Clean up pull previews and logs
    const previews = await prisma.zohoPullPreview.deleteMany({});
    const pullLogs = await prisma.zohoPullLog.deleteMany({});

    return successResponse({
      deleted: {
        transactions: zohoTransactions.count,
        vendorBills: zohoBills.count,
        previews: previews.count,
        pullLogs: pullLogs.count,
      },
      stockReversals,
      reversed: reverseStock,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Cleanup failed", 500);
  }
}

// GET — preview what would be deleted (dry run)
export async function GET() {
  try {
    await requireFeature("stock", "view");

    const zohoTransactions = await prisma.inventoryTransaction.count({
      where: { notes: { contains: "[ZOHO]" } },
    });

    const verifiedTransactions = await prisma.inventoryTransaction.count({
      where: { notes: { contains: "[ZOHO][VERIFIED]" } },
    });

    const vendorBills = await prisma.vendorBill.count();
    const previews = await prisma.zohoPullPreview.count();

    return successResponse({
      wouldDelete: {
        transactions: zohoTransactions,
        verifiedTransactions,
        vendorBills,
        previews,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Preview failed", 500);
  }
}
