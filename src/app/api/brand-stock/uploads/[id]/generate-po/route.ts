export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireFeature("purchase_orders", "create");
    const { id } = await params;

    const upload = await prisma.brandStockUpload.findUnique({
      where: { id },
      include: {
        brand: { select: { name: true } },
        items: {
          where: { selected: true, orderQty: { gt: 0 }, productId: { not: null } },
          include: { product: { select: { id: true, sku: true, name: true, costPrice: true, gstRate: true, hsnCode: true } } },
        },
      },
    });

    if (!upload) return errorResponse("Upload not found", 404);
    if (upload.items.length === 0) return errorResponse("No items selected for PO", 400);

    // Find or pick a vendor for this brand
    const vendor = await prisma.vendor.findFirst({
      where: { name: { contains: upload.brand.name, mode: "insensitive" } },
      select: { id: true, name: true },
    });

    // Generate PO number
    const lastPO = await prisma.purchaseOrder.findFirst({
      orderBy: { poNumber: "desc" },
      select: { poNumber: true },
    });
    const lastNum = lastPO?.poNumber ? parseInt(lastPO.poNumber.replace(/\D/g, ""), 10) || 0 : 0;
    const poNumber = `PO-${String(lastNum + 1).padStart(4, "0")}`;

    const poItems = upload.items.map((item) => {
      const unitPrice = item.brandPrice || item.product?.costPrice || 0;
      const qty = item.orderQty || 0;
      const gstRate = item.product?.gstRate || 18;
      const subtotal = qty * unitPrice;
      const gstAmount = subtotal * (gstRate / 100);
      return { productId: item.productId!, quantity: qty, unitPrice, gstRate, hsnCode: item.product?.hsnCode || null, amount: subtotal, gstAmount };
    });

    const subtotal = poItems.reduce((s, i) => s + i.amount, 0);
    const gstTotal = poItems.reduce((s, i) => s + i.gstAmount, 0);

    if (!vendor) return errorResponse("No vendor found matching this brand. Create a vendor first.", 400);

    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber,
        vendorId: vendor.id,
        status: "DRAFT",
        subtotal,
        gstTotal,
        grandTotal: subtotal + gstTotal,
        notes: `Auto-generated from ${upload.brand.name} stock upload (${upload.fileName})`,
        createdById: user.id,
        items: {
          create: poItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            gstRate: item.gstRate,
            hsnCode: item.hsnCode,
            amount: item.amount,
          })),
        },
      },
      include: { vendor: { select: { name: true } }, items: { include: { product: { select: { name: true, sku: true } } } } },
    });

    return successResponse({ po, brandName: upload.brand.name }, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to generate PO", 500);
  }
}
