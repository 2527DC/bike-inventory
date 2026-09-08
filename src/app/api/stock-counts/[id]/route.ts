export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { stockCountUpdateSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { isPlaceholderBrand } from "@/lib/import-placeholders";
import {
  setWarehouseQty,
  adjustWarehouseQty,
  deductFromStore,
  getWarehouseQtyMap,
  getStoreQtyMap,
} from "@/lib/stock-location";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

// This route applies a counter's numbers — and used to apply their spelling of a brand name
// straight into the brand list — with no record of either beyond the response body.
const log = createLogger("stock-counts");

/**
 * Where an approved count's numbers go when the approver chooses "set system stock".
 *
 * `warehouse` — the audit covered ONE warehouse, so each counted quantity becomes that
 * warehouse's quantity outright (`setWarehouseQty`).
 *
 * `store` — the audit covered the WHOLE store, one number per product across every active
 * warehouse. The approver names the warehouse that receives a surplus (`warehouseId`); a
 * shortage is taken from the store's warehouses in picker order, the same rule a sale
 * follows (`deductFromStore`). Until 8 Sep 2026 a whole-store audit could not be applied at
 * all — the 4 Sep §5.1 rule — because nobody had said where the difference belongs. Now the
 * approver says, per approval, and nothing is invented.
 */
type CorrectionTarget =
  | { scope: "warehouse"; warehouseId: string; name: string }
  | { scope: "store"; storeId: string; storeName: string; warehouseId: string; name: string };

/** What "set system stock" actually did, returned to the screen so the receipt can say it. */
interface AppliedSummary {
  lines: number;
  changed: number;
  netUnits: number;
  zeroLines: number;
  writtenOff: number;
  warehouse: string;
  scope: "warehouse" | "store";
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireFeature("stock_audit", "view");

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

    // A whole-store audit can be applied only if the approver names a warehouse to receive
    // any surplus. The store's active warehouses ride along in picker order so the review
    // screen has the list without a second round trip. Empty for a warehouse-scoped audit
    // (the target is the audit's own warehouse) and for a legacy audit (nothing to choose).
    const correctionWarehouses =
      stockCount.storeId && !stockCount.warehouseId
        ? await prisma.warehouse.findMany({
            where: { storeId: stockCount.storeId, isActive: true },
            select: { id: true, name: true },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          })
        : [];

    return successResponse({
      ...stockCount,
      // The scope in one string, so every screen renders it the same way (§5.1 three states).
      scopeLabel:
        stockCount.warehouse?.name ??
        (stockCount.store ? `${stockCount.store.name} — whole store` : "Legacy audit — no location"),
      // A warehouse audit corrects its own warehouse; a whole-store audit corrects the store
      // once a receiving warehouse is named (see CorrectionTarget). A legacy audit never can.
      canCorrectStock: Boolean(stockCount.warehouseId) || correctionWarehouses.length > 0,
      correctionWarehouses,
      countedItems,
      totalItems: stockCount.items.length,
      totalVariance,
      itemsWithVariance,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("stock count fetch failed", {
      stockCountId: id,
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch stock count", 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Resolved outside the try so the catch can name the audit in its log line.
  const { id } = await params;
  try {
    const user = await requireFeature("stock_audit", "edit");
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

    // Counts are written while the audit is IN PROGRESS and at no other time. The items
    // route refuses this already; this body's own `items` loop is the second door, and a
    // line rewritten after approval would contradict the stock that was corrected from it.
    if (data.items && data.items.length > 0 && existing.status !== "IN_PROGRESS") {
      log.warn("count write refused by status", { stockCountId: id, status: existing.status, userId: user.id });
      return errorResponse(
        `This audit is ${existing.status.toLowerCase().replace(/_/g, " ")}; counts can only be saved while it is in progress`,
        409
      );
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
    // not change inventory (Inwards is the way stock is added). Only an approver who
    // explicitly sends applyToStock=true pushes the counted quantities onto stock. The
    // approver decides — `stock_audit.approve` is the whole gate (owner, 8 Sep 2026, Q11).
    const applyToStock =
      data.status === "APPROVED" &&
      data.applyToStock === true &&
      canApprove;

    // ─── RESOLVE THE CORRECTION TARGET BEFORE THE TRANSACTION ─────────────────────────────
    //
    // This is a DATA-INTEGRITY guard, not a refactor.
    //
    // The old code resolved the target INSIDE the transaction, with
    // `warehouseByCode(existing.location)` — on the root `prisma` client, against a
    // module-level cache, using a free-text code. When that lookup returned null it set
    // `isLocCount = false`, and two `else` branches then wrote `Product.currentStock`
    // **globally** — while the comment directly above them claimed the count "is NOT applied
    // to stock". A count of one warehouse silently overwrote the product's total across
    // every store.
    //
    // ONE value, not a boolean plus a nullable warehouse. `applyToStock === true` with no
    // target was a representable state that meant "correct stock, but nowhere" — precisely
    // the state the old code fell into and resolved by writing globally. Non-null here means
    // "apply the counts, HERE", and nothing else can.
    //
    // A whole-store audit is applied only when the approver names the warehouse that
    // receives a surplus (`correctionWarehouseId`). The split is theirs, not the system's.
    let correctionTarget: CorrectionTarget | null = null;
    if (applyToStock) {
      if (existing.warehouseId) {
        const w = await prisma.warehouse.findUnique({
          where: { id: existing.warehouseId },
          select: { id: true, name: true, isActive: true },
        });
        if (!w) return errorResponse("The warehouse this audit covers no longer exists", 400);
        if (!w.isActive) {
          return errorResponse(`${w.name} is no longer active — stock cannot be corrected there`, 400);
        }
        correctionTarget = { scope: "warehouse", warehouseId: w.id, name: w.name };
      } else if (existing.storeId) {
        if (!data.correctionWarehouseId) {
          return errorResponse(
            "This audit covers the whole store. Choose the warehouse that receives any surplus before applying the counts, or approve as verify-only.",
            400
          );
        }
        const w = await prisma.warehouse.findUnique({
          where: { id: data.correctionWarehouseId },
          select: { id: true, name: true, isActive: true, storeId: true, store: { select: { name: true } } },
        });
        if (!w || w.storeId !== existing.storeId) {
          return errorResponse("Choose a warehouse that belongs to the store this audit covers", 400);
        }
        if (!w.isActive) {
          return errorResponse(`${w.name} is no longer active — a surplus cannot be booked there`, 400);
        }
        correctionTarget = {
          scope: "store",
          storeId: existing.storeId,
          storeName: w.store.name,
          warehouseId: w.id,
          name: w.name,
        };
      } else {
        return errorResponse(
          "This audit has no recorded location, so its counts cannot be applied to stock. Approve as verify-only.",
          400
        );
      }
    }

    // Filled inside the transaction when `correctionTarget` is set; null for verify-only.
    let applied: AppliedSummary | null = null;

    // Suggested brands the count could NOT apply, one line per unmatched name (§6). A stock
    // count no longer creates brands, so the person who typed the suggestion has to hear
    // that it was not applied — silence would read as "applied", and the product would keep
    // its placeholder brand with nobody the wiser.
    const brandNotices: string[] = [];

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

        // Every line must carry a number before the count can be signed off. "I looked and
        // there were none" is a 0, recorded per line or by the Uncounted tab's bulk action
        // (`POST /api/stock-counts/[id]/zero-uncounted`) — never silently assumed here. The
        // pre-go-live branch that zeroed the rest at Complete ended 31 Jul 2026 and is gone.
        const uncountedItems = await tx.stockCountItem.count({
          where: { stockCountId: id, countedQty: null },
        });
        if (uncountedItems > 0) {
          throw new Error(`${uncountedItems} item${uncountedItems > 1 ? "s" : ""} not yet counted. Count all items, or record 0 for the rest from the Uncounted tab, before completing.`);
        }
      }
      if (data.status === "APPROVED") {
        updateData.approvedById = user.id;
        updateData.approvedAt = new Date();
      }
      if (data.status === "REJECTED") {
        updateData.rejectionReason = data.rejectionReason || null;
      }

      // Apply counted quantities to stock ONLY on an explicit correction (applyToStock).
      // A plain approval is verify-only and leaves inventory untouched.
      if (correctionTarget) {
        const target = correctionTarget;

        // Every counted line, INCLUDING 0. A shelf counted as empty is the line that matters
        // most here — it is the one that removes phantom stock. Until 8 Sep 2026 the loop
        // below opened with `if (!item.countedQty) continue`, and `!0` is true, so every
        // zero line was silently skipped and "correct stock" left the phantom units in place.
        const countedItems = await tx.stockCountItem.findMany({
          where: { stockCountId: id, countedQty: { not: null } },
          include: {
            product: { select: { id: true, name: true, sku: true, brandId: true, brand: { select: { name: true } } } },
          },
        });

        // LIVE stock, read now, inside the transaction — not the snapshot the audit was
        // raised with. Stock moves between raising and approving; the ledger row must say
        // what the books held at the moment they were corrected, or it lies. The snapshot
        // still decides `StockCountItem.variance` (what the counter saw), and a line whose
        // two figures differ is warned about below so the drift is visible in the log.
        const productIds = countedItems.map((i) => i.productId);
        const liveMap =
          target.scope === "warehouse"
            ? await getWarehouseQtyMap(productIds, target.warehouseId, tx)
            : await getStoreQtyMap(productIds, target.storeId, tx);

        const summary: AppliedSummary = {
          lines: 0, changed: 0, netUnits: 0, zeroLines: 0, writtenOff: 0,
          warehouse: target.name, scope: target.scope,
        };

        for (const item of countedItems) {
          // Narrowing only — the query already excludes uncounted lines. `=== null`, never
          // `!item.countedQty`: zero is a counted line and is applied like any other.
          if (item.countedQty === null) continue;
          const counted = item.countedQty;
          const product = item.product;
          const live = liveMap.get(item.productId) ?? 0;
          const delta = counted - live;

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
              log.info("suggested brand matched", {
                stockCountId: id, productId: product.id, brandId: targetBrand.id,
              });
            } else {
              // MATCH ONLY (§6). This used to `brand.create` whatever the counter typed, so
              // a typo on a shelf became a permanent row in the brand list. The product keeps
              // the brandId it already has — non-null, so nothing is left dangling — and the
              // unmatched name is reported back instead. Creating a brand is `brands.create`
              // on /more/brands, and it stays there.
              const notice = `brand "${item.suggestedBrand}" is not in the list; create it on /more/brands`;
              if (!brandNotices.includes(notice)) brandNotices.push(notice);
              log.warn("suggested brand not in the list — left unchanged", {
                stockCountId: id, productId: product.id, suggestedBrand: item.suggestedBrand,
              });
            }
          }

          if (Object.keys(brandUpdate).length) {
            await tx.product.update({ where: { id: product.id }, data: brandUpdate });
          }

          summary.lines += 1;
          if (counted === 0) {
            summary.zeroLines += 1;
            summary.writtenOff += live;
          }
          if (live !== item.systemQty) {
            log.warn("stale line applied against live stock", {
              stockCountId: id, productId: product.id, snapshot: item.systemQty, live, counted,
            });
          }
          if (delta === 0) continue;
          summary.changed += 1;
          summary.netUnits += delta;

          const label = `${product.name} (${product.sku})`;
          if (target.scope === "warehouse") {
            // One warehouse: the counted number IS that warehouse's quantity.
            await setWarehouseQty(tx, product.id, target.warehouseId, counted);
          } else if (delta > 0) {
            // Whole store, surplus: booked to the warehouse the approver named.
            await adjustWarehouseQty(tx, product.id, target.warehouseId, delta);
          } else {
            // Whole store, shortage: taken from the store's active warehouses in picker
            // order — the rule a sale follows. `live` was summed over the same active
            // warehouses inside this transaction, so the amount never exceeds what is held
            // and `deductFromStore`'s insufficiency refusal cannot fire here.
            await deductFromStore(tx, product.id, target.storeId, -delta, label);
          }

          // Keep the `[STOCK_COUNT]` prefix: DELETE of a completed count reverses by it.
          const where =
            target.scope === "warehouse"
              ? `at ${target.name}`
              : delta > 0
                ? `booked to ${target.name}`
                : `taken from ${target.storeName} in picker order`;
          await tx.inventoryTransaction.create({
            data: {
              type: "ADJUSTMENT",
              productId: product.id,
              quantity: Math.abs(delta),
              previousStock: live,
              newStock: counted,
              referenceNo: existing.title,
              notes: `[STOCK_COUNT] [VERIFICATION] ${delta > 0 ? "Surplus" : "Shortage"} of ${Math.abs(delta)} (snapshot ${item.systemQty}, live ${live}, counted ${counted}) ${where} during "${existing.title}"`,
              userId: user.id,
            },
          });
        }

        applied = summary;
        log.info("stock corrected", {
          stockCountId: id,
          scope: summary.scope,
          lines: summary.lines,
          changed: summary.changed,
          netUnits: summary.netUnits,
          zeroLines: summary.zeroLines,
          writtenOff: summary.writtenOff,
        });
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
                ? correctionTarget.scope === "warehouse"
                  ? `stock corrected at ${correctionTarget.name}`
                  : `stock corrected across ${correctionTarget.storeName}, surplus to ${correctionTarget.name}`
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

    // `brandNotices` and `applied` ride alongside the updated count rather than replacing
    // the response shape — every existing reader of this endpoint keeps the object it
    // already reads. `applied` is null unless stock was actually corrected.
    return successResponse({ ...result, brandNotices, applied });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    // This is the route that overwrites stock; a failed approval must leave a server-side
    // trace and not only a response body somebody may never read.
    log.error("stock count update failed", {
      stockCountId: id,
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to update stock count", 400);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireFeature("stock_audit", "delete");

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
    log.error("stock count delete failed", {
      stockCountId: id,
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to delete stock count", 400);
  }
}
