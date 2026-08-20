export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("reports", "view");
    const { searchParams } = new URL(req.url);
    const groupBy = searchParams.get("groupBy") || "category";

    // 1. Current stock
    const products = await prisma.product.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true, sku: true,
        categoryId: true, brandId: true, type: true,
        currentStock: true, costPrice: true, sellingPrice: true, mrp: true,
        category: { select: { name: true } },
        brand: { select: { name: true } },
      },
    });

    // 2. In-transit items (inbound shipments not yet delivered, matched to products)
    const inTransitItems = await prisma.inboundLineItem.findMany({
      where: {
        productId: { not: null },
        isDelivered: false,
        shipment: { status: "IN_TRANSIT" },
      },
      select: { productId: true, quantity: true, rate: true },
    });

    // Build in-transit map: productId → { qty, value }
    const inTransitMap = new Map<string, { qty: number; value: number }>();
    for (const item of inTransitItems) {
      if (!item.productId) continue;
      const existing = inTransitMap.get(item.productId) || { qty: 0, value: 0 };
      existing.qty += item.quantity;
      existing.value += item.quantity * item.rate;
      inTransitMap.set(item.productId, existing);
    }

    // 3. Outward pending (deliveries not yet completed — stock not yet deducted)
    // Stock deduction happens at WALK_OUT or DELIVERED, so these statuses still have stock reserved
    const pendingDeliveries = await prisma.delivery.findMany({
      where: {
        status: { in: ["PENDING", "VERIFIED", "SCHEDULED", "PACKED", "SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY"] },
      },
      select: { lineItems: true },
    });

    // Build SKU-based outward map
    const outwardMap = new Map<string, number>(); // sku → qty
    for (const d of pendingDeliveries) {
      const items = (d.lineItems as Array<{ sku?: string; quantity: number }>) || [];
      for (const item of items) {
        if (!item.sku) continue;
        outwardMap.set(item.sku, (outwardMap.get(item.sku) || 0) + item.quantity);
      }
    }

    let totalItems = 0;
    let totalCostValue = 0;
    let totalSellingValue = 0;
    let totalMrpValue = 0;
    let totalInTransitQty = 0;
    let totalInTransitValue = 0;
    let totalOutwardQty = 0;
    let totalOutwardValue = 0;

    const groups = new Map<string, {
      name: string; count: number; qty: number;
      costValue: number; sellingValue: number; mrpValue: number;
      inTransitQty: number; inTransitValue: number;
      outwardQty: number; outwardValue: number;
    }>();

    for (const p of products) {
      const inTransit = inTransitMap.get(p.id) || { qty: 0, value: 0 };
      const outwardQty = p.sku ? (outwardMap.get(p.sku) || 0) : 0;
      const outwardValue = outwardQty * p.costPrice;

      totalItems += p.currentStock;
      totalCostValue += p.currentStock * p.costPrice;
      totalSellingValue += p.currentStock * p.sellingPrice;
      totalMrpValue += p.currentStock * p.mrp;
      totalInTransitQty += inTransit.qty;
      totalInTransitValue += inTransit.value;
      totalOutwardQty += outwardQty;
      totalOutwardValue += outwardValue;

      let key: string;
      let name: string;
      if (groupBy === "brand") {
        key = p.brandId;
        name = p.brand?.name || "Unknown";
      } else if (groupBy === "type") {
        key = p.type;
        name = p.type.replace(/_/g, " ");
      } else {
        key = p.categoryId;
        name = p.category?.name || "Unknown";
      }

      const existing = groups.get(key) || {
        name, count: 0, qty: 0,
        costValue: 0, sellingValue: 0, mrpValue: 0,
        inTransitQty: 0, inTransitValue: 0,
        outwardQty: 0, outwardValue: 0,
      };
      existing.count += 1;
      existing.qty += p.currentStock;
      existing.costValue += p.currentStock * p.costPrice;
      existing.sellingValue += p.currentStock * p.sellingPrice;
      existing.mrpValue += p.currentStock * p.mrp;
      existing.inTransitQty += inTransit.qty;
      existing.inTransitValue += inTransit.value;
      existing.outwardQty += outwardQty;
      existing.outwardValue += outwardValue;
      groups.set(key, existing);
    }

    const breakdown = Array.from(groups.values()).sort((a, b) => b.costValue - a.costValue);

    // Effective = Current + InTransit - Outward
    const effectiveCostValue = totalCostValue + totalInTransitValue - totalOutwardValue;

    return successResponse({
      totalItems,
      totalProducts: products.length,
      totalCostValue,
      totalSellingValue,
      totalMrpValue,
      // New fields
      totalInTransitQty,
      totalInTransitValue,
      totalOutwardQty,
      totalOutwardValue,
      effectiveCostValue,
      effectiveQty: totalItems + totalInTransitQty - totalOutwardQty,
      breakdown,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch stock value", 500);
  }
}
