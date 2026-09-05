export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { stockCountUpdateSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { isPlaceholderBrand } from "@/lib/import-placeholders";
import { setWarehouseQty } from "@/lib/stock-location";
import { logActivity } from "@/lib/activity-log";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("stock_audit", "view");
    const { id } = await params;

    // Clerks/Mechanic can only view their assigned stock counts
    if (!(await userCan(user.id, "stock_audit", "approve"))) {
      const check = await prisma.stockCount.findUnique({ where: { id }, select: { assignedToId: true } });
      if (!check) return errorResponse("Stock count not found", 404);
      if (check.assignedToId !== user.id) return errorResponse("You can only access stock counts assigned to you", 403);
    }

    const stockCount = await prisma.stockCount.findUnique({
      where: { id },
      include: {
        assignedTo: { select: { name: true } },
        approvedBy: { select: { name: true } },
        store: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true } },
        bin: { select: { code: true, name: true, location: true } },
        items: {
          include: {
            product: {
              select: { name: true, sku: true, currentStock: true, category: { select: { name: true } }, brand: { select: { name: true } }, bin: { select: { code: true, location: true } } },
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
      // The scope in one string, so every screen renders it the same way (§5.1 three states).
      scopeLabel:
        stockCount.warehouse?.name ??
        (stockCount.store ? `${stockCount.store.name} — whole store` : "Legacy audit — no location"),
      // Only a warehouse-scoped audit may correct stock; the detail screen hides the
      // checkbox on this, and the API refuses regardless.
      canCorrectStock: Boolean(stockCount.warehouseId),
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
    const user = await requireFeature("stock_audit", "edit");
    const { id } = await params;
    const body = await req.json();
    const data = stockCountUpdateSchema.parse(body);

    const existing = await prisma.stockCount.findUnique({ where: { id } });
    if (!existing) return errorResponse("Stock count not found", 404);

    // ─── WHO MAY DO WHAT (R2) ─────────────────────────────────────────────────────────────
    //
    // Two independent facts, resolved once: is this MY audit, and may I approve audits?
    // They used to be tangled into three overlapping checks, and the last of them refused an
    // approve-holder the Start action outright ("Admin can only complete, approve, or reject
    // … not initiate them"). That is why an owner who assigned an audit to themselves could
    // open it and find no way to begin — holding `approve` disqualified them from counting.
    //
    // Holding `approve` no longer takes anything away. The only thing it still cannot do is
    // approve YOUR OWN count, which is the separation of duties that matters.
    const isAssignee = existing.assignedToId === user.id;
    const canApprove = await userCan(user.id, "stock_audit", "approve");

    if (!isAssignee && !canApprove) {
      return errorResponse("You can only update stock counts assigned to you", 403);
    }

    const isReview = data.status === "APPROVED" || data.status === "REJECTED";

    if (isReview) {
      if (!canApprove) {
        return errorResponse("You do not have permission to approve or reject stock counts", 403);
      }
      // Separation of duties: counting your own work and signing it off are two jobs.
      if (isAssignee) {
        return errorResponse("You cannot approve or reject your own stock count", 403);
      }
    } else if (!isAssignee) {
      // Starting, counting and completing belong to the person doing the counting — an
      // approver reaching in would overwrite the counter's numbers under their name.
      return errorResponse(
        "Only the person this audit is assigned to can start, count or complete it",
        403
      );
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
      canApprove;

    // ─── RESOLVE THE CORRECTION TARGET BEFORE THE TRANSACTION (§5.1) ──────────────────────
    //
    // This is a DATA-INTEGRITY FIX, not a refactor.
    //
    // The old code resolved the target INSIDE the transaction, with
    // `warehouseByCode(existing.location)` — on the root `prisma` client, against a
    // module-level cache, using a free-text code. When that lookup returned null it set
    // `isLocCount = false`, and the two `else` branches below then wrote
    // `Product.currentStock` **globally** — while the comment directly above them claimed
    // the count "is NOT applied to stock". A count of one warehouse silently overwrote the
    // product's total across every store.
    //
    // Now: only a warehouse-scoped audit may correct stock. A whole-store audit cannot,
    // because a whole-store count yields ONE number per product while StockLevel is per
    // warehouse — any split of the variance would invent a location. Refusing is the
    // correct answer, and it is a 400 with a sentence rather than a silent global write.
    // ONE value, not a boolean plus a nullable warehouse. `applyToStock === true` and
    // `countWarehouse === null` was a representable state that meant "correct stock, but
    // nowhere" — precisely the state the old code fell into and resolved by writing globally.
    // Non-null here means "apply the counts, at this warehouse", and nothing else can.
    let correctionTarget: { id: string; name: string } | null = null;
    if (applyToStock) {
      if (!existing.warehouseId) {
        return errorResponse(
          existing.storeId
            ? "This audit covers the whole store. Approve as verify-only, or raise one audit per warehouse to correct stock."
            : "This audit has no recorded location, so its counts cannot be applied to stock. Approve as verify-only.",
          400
        );
      }
      const w = await prisma.warehouse.findUnique({
        where: { id: existing.warehouseId },
        select: { id: true, name: true, isActive: true },
      });
      if (!w) return errorResponse("The warehouse this audit covers no longer exists", 400);
      if (!w.isActive) {
        return errorResponse(`${w.name} is no longer active — stock cannot be corrected there`, 400);
      }
      correctionTarget = { id: w.id, name: w.name };
    }

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
      if (correctionTarget) {
        const BASELINE_END = new Date("2026-07-31T23:59:59+05:30");
        const isBaselinePeriod = new Date() <= BASELINE_END;
        // The count was scoped to ONE warehouse (guaranteed by the check before the
        // transaction), so the counted quantity applies to THAT warehouse and currentStock
        // recomputes as the sum across all of them. There is no longer an "unresolved
        // location" path, because there is no longer a free-text location to fail to resolve.

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

          // Apply the counter's suggested brand only when the current one carries no
          // information. The three "no brand" names this catalog has collected used to be
          // listed inline here; they now live in `isPlaceholderBrand`, so this test, the
          // /stock card and the "Needs details" filter share one definition and cannot drift
          // apart. A real brand is never overwritten by a count.
          let brandUpdate: Record<string, string> = {};
          if (item.suggestedBrand && (!product.brand || isPlaceholderBrand(product.brand.name))) {
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
            // Always through the ledger. The `else` that used to sit here wrote
            // `currentStock` directly — the global total — for a count of one warehouse.
            const newTotal = await setWarehouseQty(tx, product.id, correctionTarget.id, item.countedQty);
            if (Object.keys(brandUpdate).length) {
              await tx.product.update({ where: { id: product.id }, data: brandUpdate });
            }

            await tx.inventoryTransaction.create({
              data: {
                type: "INWARD",
                productId: product.id,
                quantity: item.countedQty,
                previousStock: product.currentStock,
                newStock: newTotal,
                referenceNo: existing.title,
                notes: `[STOCK_COUNT] [BASELINE] Counted ${item.countedQty} units at ${correctionTarget.name}${item.suggestedBrand ? ` — brand: ${item.suggestedBrand}` : ""} during "${existing.title}"`,
                userId: user.id,
              },
            });
          } else {
            // --- VERIFICATION MODE: Stock count = AUDIT ---
            // Variance against the SCOPED systemQty recorded when the audit was raised, not
            // against the product's global total.
            const variance = item.countedQty - (item.systemQty ?? 0);

            await setWarehouseQty(tx, product.id, correctionTarget.id, item.countedQty);
            if (Object.keys(brandUpdate).length) {
              await tx.product.update({ where: { id: product.id }, data: brandUpdate });
            }

            if (variance !== 0) {
              await tx.inventoryTransaction.create({
                data: {
                  type: "ADJUSTMENT",
                  productId: product.id,
                  quantity: Math.abs(variance),
                  previousStock: item.systemQty ?? 0,
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

      // Logged INSIDE the transaction and BEFORE the update, so an approval that fails to
      // record itself fails outright rather than leaving an unexplained status change.
      // Only real transitions are logged — saving individual counts is deliberately not.
      if (data.status && data.status !== existing.status) {
        const action =
          data.status === "APPROVED" ? "approved"
          : data.status === "REJECTED" ? "rejected"
          : "status_changed";
        await logActivity(tx, {
          module: "stock_audit",
          action,
          entityType: "StockCount",
          entityId: id,
          entityRef: existing.countNo,
          fromValue: existing.status,
          toValue: data.status,
          details:
            data.status === "APPROVED"
              ? correctionTarget
                ? `stock corrected at ${correctionTarget.name}`
                : "verify only"
              : data.status === "REJECTED"
                ? (data.rejectionReason || "no reason given")
                : undefined,
          userId: user.id,
          userName: user.name,
        });
      }

      const updated = await tx.stockCount.update({
        where: { id },
        data: updateData,
        include: {
          assignedTo: { select: { name: true } },
          store: { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true } },
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
    const user = await requireFeature("stock_audit", "delete");
    const { id } = await params;

    const stockCount = await prisma.stockCount.findUnique({ where: { id } });
    if (!stockCount) return errorResponse("Stock count not found", 404);

    if (stockCount.status === "APPROVED") {
      return errorResponse("Cannot delete an approved stock count", 403);
    }

    if (stockCount.status === "COMPLETED") {
      // Only ADMIN can delete completed stock counts
      if (!(await userCan(user.id, "stock_audit", "approve"))) {
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
