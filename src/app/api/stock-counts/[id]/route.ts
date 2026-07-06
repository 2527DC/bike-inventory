export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { stockCountUpdateSchema } from "@/lib/validations";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { BIN_TRACKING_ENABLED, isStockLocation, type StockLocation } from "@/lib/inventory-config";
import { setLocationQty } from "@/lib/stock-location";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(["ADMIN", "SUPERVISOR", "PURCHASE_MANAGER", "ACCOUNTS_MANAGER", "INWARDS_EXECUTIVE", "OUTWARDS_EXECUTIVE", "STORE_MANAGER"]);
    const { id } = await params;

    // Clerks/Mechanic can only view their assigned stock counts
    if (["INWARDS_EXECUTIVE", "OUTWARDS_EXECUTIVE"].includes(user.role)) {
      const check = await prisma.stockCount.findUnique({ where: { id }, select: { assignedToId: true } });
      if (!check) return errorResponse("Stock count not found", 404);
      if (check.assignedToId !== user.id) return errorResponse("You can only access stock counts assigned to you", 403);
    }

    const stockCount = await prisma.stockCount.findUnique({
      where: { id },
      include: {
        assignedTo: { select: { name: true } },
        approvedBy: { select: { name: true } },
        bin: { select: { code: true, name: true, location: true } },
        items: {
          include: {
            product: {
              select: { name: true, sku: true, currentStock: true, type: true, category: { select: { name: true } }, brand: { select: { name: true } }, bin: { select: { code: true, location: true } } },
            },
          },
          orderBy: { product: { name: "asc" } },
        },
      },
    });

    if (!stockCount) return errorResponse("Stock count not found", 404);

    const countedItems = stockCount.items.filter((i) => i.countedQty !== null).length;
    const totalVariance = stockCount.items.reduce((sum, i) => sum + (i.variance || 0), 0);
    const itemsWithVariance = stockCount.items.filter((i) => i.variance !== null && i.variance !== 0).length;

    return successResponse({
      ...stockCount,
      countedItems,
      totalItems: stockCount.items.length,
      totalVariance,
      itemsWithVariance,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch stock count", 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(["ADMIN", "SUPERVISOR", "PURCHASE_MANAGER", "ACCOUNTS_MANAGER", "INWARDS_EXECUTIVE", "OUTWARDS_EXECUTIVE", "STORE_MANAGER"]);
    const { id } = await params;
    const body = await req.json();
    const data = stockCountUpdateSchema.parse(body);

    const existing = await prisma.stockCount.findUnique({ where: { id } });
    if (!existing) return errorResponse("Stock count not found", 404);

    // Clerks/Mechanic can only update their assigned stock counts
    if (["INWARDS_EXECUTIVE", "OUTWARDS_EXECUTIVE"].includes(user.role)) {
      if (existing.assignedToId !== user.id) return errorResponse("You can only update stock counts assigned to you", 403);
    }

    // Only ADMIN/CEO/SUPERVISOR/ACCOUNTS_MANAGER can approve or reject
    if (data.status === "APPROVED" || data.status === "REJECTED") {
      if (!["ADMIN", "CEO", "SUPERVISOR", "ACCOUNTS_MANAGER"].includes(user.role)) {
        return errorResponse("Only Admin, Supervisor, or Accounts Manager can approve/reject stock counts", 403);
      }
      // Prevent self-approval
      if (data.status === "APPROVED" && existing.assignedToId === user.id) {
        return errorResponse("You cannot approve your own stock count — another team member must review it", 403);
      }
    }

    // ADMIN cannot start counts — only complete, approve, or reject
    if (user.role === "ADMIN" && data.status === "IN_PROGRESS") {
      return errorResponse("Admin can only complete, approve, or reject stock counts, not initiate them", 403);
    }

    // Status transition guards
    if (data.status) {
      const VALID_TRANSITIONS: Record<string, string[]> = {
        PENDING: ["IN_PROGRESS"],
        IN_PROGRESS: ["COMPLETED"],
        COMPLETED: ["APPROVED", "REJECTED"],
        REJECTED: ["IN_PROGRESS"], // Can re-start after rejection
        APPROVED: [], // Final state
      };
      const allowed = VALID_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(data.status)) {
        return errorResponse(
          `Cannot change status from ${existing.status} to ${data.status}. ${
            existing.status === "APPROVED" ? "This stock count is already approved." : `Must be ${allowed.join(" or ")} next.`
          }`,
          400
        );
      }
    }

    // Stock Count is VERIFY-ONLY by default: approving records the count + variance but does
    // not change inventory (Inwards is the way stock is added). Only an ADMIN/CEO who explicitly
    // sends applyToStock=true may push the counted quantities onto stock as a correction.
    const applyToStock =
      data.status === "APPROVED" &&
      data.applyToStock === true &&
      (user.role === "ADMIN" || user.role === "CEO");

    const result = await prisma.$transaction(async (tx) => {
      if (data.items && data.items.length > 0) {
        for (const item of data.items) {
          if (item.countedQty < 0) continue; // Reject negative counts
          const existingItem = await tx.stockCountItem.findUnique({ where: { id: item.id } });
          if (existingItem) {
            await tx.stockCountItem.update({
              where: { id: item.id },
              data: {
                countedQty: item.countedQty,
                variance: item.countedQty - existingItem.systemQty,
                notes: item.notes ?? existingItem.notes,
                countedAt: new Date(),
              },
            });
          }
        }
      }

      const updateData: Record<string, unknown> = {};
      if (data.status) updateData.status = data.status;
      if (data.notes !== undefined) updateData.notes = data.notes;
      if (data.status === "COMPLETED") {
        updateData.completedAt = new Date();

        // After baseline: require all items to have countedQty
        const BASELINE_END = new Date("2026-07-31T23:59:59+05:30");
        if (new Date() > BASELINE_END) {
          const uncountedItems = await tx.stockCountItem.count({
            where: { stockCountId: id, countedQty: null },
          });
          if (uncountedItems > 0) {
            throw new Error(`${uncountedItems} item${uncountedItems > 1 ? "s" : ""} not yet counted. Count all items before completing.`);
          }
        } else if (new Date() <= BASELINE_END) {
          // Bulk update: set all uncounted items to 0 in one query
          await tx.stockCountItem.updateMany({
            where: { stockCountId: id, countedQty: null },
            data: { countedQty: 0, countedAt: new Date() },
          });
          // Then fix variance: need individual updates since variance = 0 - systemQty per item
          // Use raw SQL for bulk variance calculation
          await tx.$executeRaw`
            UPDATE "StockCountItem"
            SET variance = 0 - "systemQty"
            WHERE "stockCountId" = ${id} AND "countedQty" = 0 AND variance IS NULL
          `;
        }
      }
      if (data.status === "APPROVED") {
        updateData.approvedById = user.id;
        updateData.approvedAt = new Date();
      }
      if (data.status === "REJECTED") {
        updateData.rejectionReason = data.rejectionReason || null;
      }

      // Apply counted quantities to stock ONLY on an explicit admin correction (applyToStock).
      // A plain approval is verify-only and leaves inventory untouched.
      if (applyToStock) {
        const BASELINE_END = new Date("2026-07-31T23:59:59+05:30");
        const isBaselinePeriod = new Date() <= BASELINE_END;
        // Location mode: the count was scoped to one of the 4 locations, so apply the
        // counted qty to THAT location (currentStock recomputes as the sum).
        const isLocCount = !BIN_TRACKING_ENABLED && isStockLocation(existing.location);
        const countLocation = existing.location as StockLocation;

        // Process all items that were counted (including 0 — means item not found at location)
        const countedItems = await tx.stockCountItem.findMany({
          where: { stockCountId: id, countedQty: { not: null } },
          include: { product: { select: { brandId: true, brand: { select: { name: true } } } } },
        });

        for (const item of countedItems) {
          if (!item.countedQty) continue; // TS guard (query already filters > 0)

          const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { id: true, currentStock: true, binId: true, brandId: true, brand: { select: { name: true } } },
          });

          if (!product) continue;

          // Apply suggested brand if item's current brand is Imported/Unbranded/missing
          let brandUpdate: Record<string, string> = {};
          if (item.suggestedBrand && (!product.brand || ["Imported", "Unbranded", "General"].includes(product.brand.name))) {
            const targetBrand = await tx.brand.findFirst({
              where: { name: { equals: item.suggestedBrand, mode: "insensitive" } },
            });
            if (targetBrand) {
              brandUpdate = { brandId: targetBrand.id };
            } else {
              // Create new brand
              const newBrand = await tx.brand.create({ data: { name: item.suggestedBrand } });
              brandUpdate = { brandId: newBrand.id };
            }
          }

          if (isBaselinePeriod) {
            // --- BASELINE MODE: Stock count = INWARD + PUTAWAY ---
            let newTotal = item.countedQty;
            if (isLocCount) {
              newTotal = await setLocationQty(tx, product.id, countLocation, item.countedQty);
              if (Object.keys(brandUpdate).length) {
                await tx.product.update({ where: { id: product.id }, data: brandUpdate });
              }
            } else {
              const assignBin = existing.binId && item.countedQty > 0;
              await tx.product.update({
                where: { id: product.id },
                data: {
                  currentStock: item.countedQty,
                  ...(assignBin && { binId: existing.binId }),
                  ...brandUpdate,
                },
              });
            }

            await tx.inventoryTransaction.create({
              data: {
                type: "INWARD",
                productId: product.id,
                quantity: item.countedQty,
                previousStock: product.currentStock,
                newStock: newTotal,
                referenceNo: existing.title,
                notes: `[STOCK_COUNT] [BASELINE] Counted ${item.countedQty} units${isLocCount ? ` at ${countLocation}` : existing.binId ? " — placed in bin" : ""}${item.suggestedBrand ? ` — brand: ${item.suggestedBrand}` : ""} during "${existing.title}"`,
                userId: user.id,
              },
            });
          } else {
            // --- VERIFICATION MODE: Stock count = AUDIT ---
            const variance = item.countedQty - (isLocCount ? (item.systemQty ?? 0) : product.currentStock);

            if (isLocCount) {
              await setLocationQty(tx, product.id, countLocation, item.countedQty);
              if (Object.keys(brandUpdate).length) {
                await tx.product.update({ where: { id: product.id }, data: brandUpdate });
              }
            } else {
              await tx.product.update({
                where: { id: product.id },
                data: {
                  currentStock: item.countedQty,
                  ...(existing.binId && { binId: existing.binId }),
                  ...brandUpdate,
                },
              });
            }

            if (variance !== 0) {
              await tx.inventoryTransaction.create({
                data: {
                  type: "ADJUSTMENT",
                  productId: product.id,
                  quantity: Math.abs(variance),
                  previousStock: isLocCount ? (item.systemQty ?? 0) : product.currentStock,
                  newStock: item.countedQty,
                  referenceNo: existing.title,
                  notes: `[STOCK_COUNT] [VERIFICATION] ${variance > 0 ? "Surplus" : "Shortage"} of ${Math.abs(variance)} found during "${existing.title}"`,
                  userId: user.id,
                },
              });
            }
          }
        }
      }

      const updated = await tx.stockCount.update({
        where: { id },
        data: updateData,
        include: {
          assignedTo: { select: { name: true } },
          _count: { select: { items: true } },
        },
      });

      return updated;
    }, { timeout: 120000 }); // 2 min timeout for large stock counts

    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update stock count", 400);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(["ADMIN", "SUPERVISOR", "ACCOUNTS_MANAGER"]);
    const { id } = await params;

    const stockCount = await prisma.stockCount.findUnique({ where: { id } });
    if (!stockCount) return errorResponse("Stock count not found", 404);

    if (stockCount.status === "APPROVED") {
      return errorResponse("Cannot delete an approved stock count", 403);
    }

    if (stockCount.status === "COMPLETED") {
      // Only ADMIN can delete completed stock counts
      if (user.role !== "ADMIN") {
        return errorResponse("Only ADMIN can delete a completed stock count", 403);
      }

      await prisma.$transaction(async (tx) => {
        // Find all transactions created by this stock count
        const transactions = await tx.inventoryTransaction.findMany({
          where: {
            referenceNo: stockCount.title,
            notes: { contains: "[STOCK_COUNT]" },
          },
        });

        // Reverse each product's stock and bin assignment
        for (const txn of transactions) {
          const product = await tx.product.findUnique({
            where: { id: txn.productId },
            select: { id: true, binId: true },
          });
          if (!product) continue;

          await tx.product.update({
            where: { id: product.id },
            data: {
              currentStock: txn.previousStock,
              // Clear bin only if it was assigned by this stock count
              ...(stockCount.binId && product.binId === stockCount.binId && { binId: null }),
            },
          });
        }

        // Delete the transactions
        await tx.inventoryTransaction.deleteMany({
          where: {
            referenceNo: stockCount.title,
            notes: { contains: "[STOCK_COUNT]" },
          },
        });

        // Delete count items and count
        await tx.stockCountItem.deleteMany({ where: { stockCountId: id } });
        await tx.stockCount.delete({ where: { id } });
      });

      return successResponse({ deleted: true, reversed: true });
    }

    // Non-completed counts: simple delete
    await prisma.$transaction([
      prisma.stockCountItem.deleteMany({ where: { stockCountId: id } }),
      prisma.stockCount.delete({ where: { id } }),
    ]);

    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to delete stock count", 400);
  }
}
