export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { z } from "zod";

const transferSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
  fromBinId: z.string().min(1, "Source bin is required"),
  toBinId: z.string().min(1, "Destination bin is required"),
  notes: z.string().optional(),
});

// GET: List transfers
export async function GET(req: NextRequest) {
  try {
    await requireFeature("transfers", "view");
    const { page, limit, skip, searchParams } = parseSearchParams(req.url);
    const status = searchParams.get("status"); // PENDING, APPROVED, REJECTED, all

    const where = {
      type: "TRANSFER" as const,
      ...(status && status !== "all" && {
        notes: { contains: `[${status}]` },
      }),
    };

    const [transfers, total] = await Promise.all([
      prisma.inventoryTransaction.findMany({
        where,
        include: {
          product: { select: { name: true, sku: true } },
          user: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.inventoryTransaction.count({ where }),
    ]);

    return paginatedResponse(transfers, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch transfers", 500);
  }
}

// POST: Create a transfer request
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("transfers", "create");
    const body = await req.json();
    const data = transferSchema.parse(body);

    if (data.fromBinId === data.toBinId) {
      return errorResponse("Source and destination bins must be different", 400);
    }

    // Verify bins exist
    const [fromBin, toBin, product] = await Promise.all([
      prisma.bin.findUnique({ where: { id: data.fromBinId } }),
      prisma.bin.findUnique({ where: { id: data.toBinId } }),
      prisma.product.findUnique({ where: { id: data.productId } }),
    ]);

    if (!fromBin) return errorResponse("Source bin not found", 404);
    if (!toBin) return errorResponse("Destination bin not found", 404);
    if (!product) return errorResponse("Product not found", 404);

    if (product.currentStock < data.quantity) {
      return errorResponse(`Insufficient stock. Available: ${product.currentStock}`, 400);
    }

    // For ADMIN: auto-approve. For others: create as pending
    const isAutoApprove = await userCan(user.id, "transfers", "approve");
    const status = isAutoApprove ? "APPROVED" : "PENDING";

    const result = await prisma.$transaction(async (tx) => {
      const previousStock = product.currentStock;

      // Create the transfer transaction
      const transaction = await tx.inventoryTransaction.create({
        data: {
          type: "TRANSFER",
          productId: data.productId,
          quantity: data.quantity,
          previousStock,
          newStock: previousStock, // Stock count doesn't change, only location
          referenceNo: `TRF-${Date.now().toString(36).toUpperCase()}`,
          notes: `[${status}] From: ${fromBin.code} (${fromBin.location}) → To: ${toBin.code} (${toBin.location})${data.notes ? ` | ${data.notes}` : ""} [fromBin:${data.fromBinId}] [toBin:${data.toBinId}]`,
          userId: user.id,
        },
        include: {
          product: { select: { name: true, sku: true } },
          user: { select: { name: true } },
        },
      });

      // If auto-approved, update product bin and move serial items
      if (isAutoApprove) {
        await tx.product.update({
          where: { id: data.productId },
          data: { binId: data.toBinId },
        });

        // Move serial items from source bin to destination bin
        await tx.serialItem.updateMany({
          where: {
            productId: data.productId,
            binId: data.fromBinId,
            status: "IN_STOCK",
          },
          data: { binId: data.toBinId },
        });
      }

      return transaction;
    });

    return successResponse(result, 201);
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(error instanceof Error ? error.message : "Failed to create transfer", 400);
  }
}
