export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

interface PriceCheckItem {
  productId: string;
  productName: string;
  sku: string;
  binName: string | null;
  currentStock: number;
  appCostPrice: number;
  lastBillPrice: number | null;
  lastBillNo: string | null;
  lastBillDate: string | null;
  difference: number | null;
  totalImpact: number | null;
  isMismatch: boolean;
}

export async function GET(req: NextRequest) {
  try {
    await requireFeature("stock", "view");

    const { searchParams } = new URL(req.url);
    const mismatchOnly = searchParams.get("mismatchOnly") === "true";

    // Get all active products with stock > 0
    const products = await prisma.product.findMany({
      where: { status: "ACTIVE", currentStock: { gt: 0 } },
      select: {
        id: true,
        name: true,
        sku: true,
        costPrice: true,
        currentStock: true,
        zohoItemId: true,
        bin: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    });

    // For each product, find the last INWARD transaction with a referenceNo (bill reference)
    // Then look up VendorBill by billNo to find line-item level pricing via PurchaseOrderItem
    const productIds = products.map((p) => p.id);

    // Get last inward transaction per product (with bill reference)
    const lastInwards = await prisma.inventoryTransaction.findMany({
      where: {
        productId: { in: productIds },
        type: "INWARD",
        referenceNo: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: {
        productId: true,
        referenceNo: true,
        createdAt: true,
      },
    });

    // Build map: productId -> last inward reference
    const lastInwardMap = new Map<
      string,
      { referenceNo: string; createdAt: Date }
    >();
    for (const txn of lastInwards) {
      if (!lastInwardMap.has(txn.productId) && txn.referenceNo) {
        lastInwardMap.set(txn.productId, {
          referenceNo: txn.referenceNo,
          createdAt: txn.createdAt,
        });
      }
    }

    // Collect unique bill numbers from inward references
    const billNos = new Set<string>();
    for (const entry of lastInwardMap.values()) {
      billNos.add(entry.referenceNo);
    }

    // Fetch VendorBills by billNo, and their linked PO items for per-product pricing
    const bills = await prisma.vendorBill.findMany({
      where: { billNo: { in: Array.from(billNos) } },
      select: {
        billNo: true,
        billDate: true,
        amount: true,
        purchaseOrderId: true,
        purchaseOrder: {
          select: {
            items: {
              select: {
                productId: true,
                unitPrice: true,
              },
            },
          },
        },
      },
    });

    // Build map: billNo -> { billDate, poItems by productId }
    const billMap = new Map<
      string,
      {
        billDate: Date;
        poItemPrices: Map<string, number>;
        billAmount: number;
      }
    >();
    for (const bill of bills) {
      const poItemPrices = new Map<string, number>();
      if (bill.purchaseOrder?.items) {
        for (const item of bill.purchaseOrder.items) {
          poItemPrices.set(item.productId, item.unitPrice);
        }
      }
      billMap.set(bill.billNo, {
        billDate: bill.billDate,
        poItemPrices,
        billAmount: bill.amount,
      });
    }

    // Build result
    const items: PriceCheckItem[] = [];
    for (const product of products) {
      const inward = lastInwardMap.get(product.id);
      let lastBillPrice: number | null = null;
      let lastBillNo: string | null = null;
      let lastBillDate: string | null = null;

      if (inward) {
        const billInfo = billMap.get(inward.referenceNo);
        lastBillNo = inward.referenceNo;

        if (billInfo) {
          lastBillDate = billInfo.billDate.toISOString().split("T")[0];
          // Try to get per-item price from PO line items
          const poPrice = billInfo.poItemPrices.get(product.id);
          if (poPrice !== undefined) {
            lastBillPrice = poPrice;
          }
        } else {
          // Bill not found in VendorBill table, use inward date as fallback
          lastBillDate = inward.createdAt.toISOString().split("T")[0];
        }
      }

      const difference =
        lastBillPrice !== null
          ? Math.round((product.costPrice - lastBillPrice) * 100) / 100
          : null;
      const totalImpact =
        difference !== null
          ? Math.round(difference * product.currentStock * 100) / 100
          : null;
      const isMismatch =
        lastBillPrice !== null && Math.abs(product.costPrice - lastBillPrice) >= 0.01;

      if (mismatchOnly && !isMismatch) continue;

      items.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        binName: product.bin?.name || null,
        currentStock: product.currentStock,
        appCostPrice: product.costPrice,
        lastBillPrice,
        lastBillNo,
        lastBillDate,
        difference,
        totalImpact,
        isMismatch,
      });
    }

    // Sort: mismatches first, then by absolute impact descending
    items.sort((a, b) => {
      if (a.isMismatch !== b.isMismatch) return a.isMismatch ? -1 : 1;
      const absA = Math.abs(a.totalImpact || 0);
      const absB = Math.abs(b.totalImpact || 0);
      return absB - absA;
    });

    // Summary stats
    const mismatchCount = items.filter((i) => i.isMismatch).length;
    const totalImpactSum = items
      .filter((i) => i.isMismatch)
      .reduce((sum, i) => sum + Math.abs(i.totalImpact || 0), 0);

    return successResponse({
      items,
      summary: {
        totalChecked: mismatchOnly ? items.length : products.length,
        mismatchCount,
        totalImpact: Math.round(totalImpactSum * 100) / 100,
      },
    });
  } catch (error) {
    if (error instanceof AuthError)
      return errorResponse(error.message, error.status);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch price check",
      500
    );
  }
}
