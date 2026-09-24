export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { stockCountUpdateSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { isPlaceholderBrand } from "@/lib/import-placeholders";
import { logActivity } from "@/lib/activity-log";
import { recordApprovalEvent } from "@/lib/approvals/events";
import { syncBinStock } from "@/lib/units";
import { getBinQtyMap } from "@/lib/units/bin-qty";
import { applyBinCountLine } from "../_lib/apply-bin-line";
import { assignBinToCountedProducts } from "../_lib/assign-product-bin";
import { createLogger } from "@/lib/logger";
import { notifyStockAudit } from "@/lib/notify/stock-audit";

// This route applies a counter's numbers — and used to apply their spelling of a brand name
// straight into the brand list — with no record of either beyond the response body.
const log = createLogger("stock-counts");

/**
 * Where an approved count's numbers go when the approver chooses "set system stock": ONE bin
 * of one warehouse (plan 2109, R33, R36).
 *
 * Each counted quantity becomes what THAT BIN holds. The warehouse total moves by the bin's
 * difference (`adjustWarehouseQty`) — never set to the bin's count, which is what used to wipe
 * every other bin of the warehouse.
 *
 * Removed in plan 2109 (R36): the `warehouse` scope (a count of a whole warehouse, applied with
 * `setWarehouseQty`) and the `store` scope (a whole-store count, surplus booked to a warehouse
 * the approver named, shortage via `deductFromStore`). Neither can say which bin a difference
 * belongs to; such audits still approve as verify-only.
 */
type CorrectionTarget = {
  warehouseId: string;
  name: string;
  binId: string;
  binCode: string;
  /** R32: a non-assemblable bin's count has no condition; everything in it is unassembled. */
  nonAssemblable: boolean;
};

/** What "set system stock" actually did, returned to the screen so the receipt can say it. */
interface AppliedSummary {
  lines: number;
  changed: number;
  netUnits: number;
  zeroLines: number;
  writtenOff: number;
  warehouse: string;
  scope: "bin";
  /** The bin corrected, by code. */
  bin: string;
  binId: string;
  /** Products that had no home bin and were given this bin by the approval (plan 2209, R1). */
  productsGivenBin: number;
  /** Unit records brought in line with the counts (plan 1709, Part B, Q42). */
  units: {
    created: number;
    /** The units created by this approval — "Print labels" on the receipt prints exactly these (R31). */
    createdUnitIds: string[];
    markedAssembled: number;
    markedUnassembled: number;
    /** Codes retired as LOST — their labels are on real items, so they are listed (P9). */
    retiredCodes: string[];
  };
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
        // `nonAssemblable` decides the count screen (R32): Assembled / Unassembled in an
        // assemblable bin, a single count in a non-assemblable one.
        bin: { select: { id: true, code: true, name: true, location: true, directions: true, floor: true, zone: true, nonAssemblable: true } },
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

    // `correctionWarehouses` (the list a whole-store audit's approver picked a surplus warehouse
    // from) was removed in plan 2109 (R36): only a bin audit can be applied to stock now.
    return successResponse({
      ...stockCount,
      // The scope in one string, so every screen renders it the same way (§5.1 three states).
      scopeLabel:
        stockCount.warehouse?.name ??
        (stockCount.store ? `${stockCount.store.name} — whole store` : "Legacy audit — no location"),
      // Only a bin audit corrects stock (plan 2109, R33, R36): it knows which bin a difference
      // belongs to. Audits saved without a bin approve as verify-only.
      canCorrectStock: Boolean(stockCount.binId && stockCount.warehouseId),
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
      // ─── THE SELF-APPROVAL BLOCK IS GONE (plan 1709, R23, Q15) ────────────────────────
      //
      // It used to refuse here: "You cannot approve or reject your own stock count."
      // Separation of duties is a good instinct and the wrong rule for this shop. The owner's
      // answer to Q15 is that ANYONE whose role holds `approve` may approve, INCLUDING their
      // own record — a store with two people on shift cannot wait for a third to sign off a
      // count that is already done, and the practical effect of the block was audits sitting
      // COMPLETED for days, which is worse evidence than one signed by its counter.
      //
      // What did NOT change: `approve` is still a grant an admin decides who holds, applying
      // the counts to live stock still needs `stock_correction.approve` below, and every
      // approval writes an ApprovalEvent naming the approver — so a person signing off their
      // own work is recorded as having done exactly that, and the approver-error rate (R26)
      // counts corrections against them like anybody else's.
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
    // explicitly sends applyToStock=true pushes the counted quantities onto stock.
    // Per R16 / owner decision, applying counts to live system stock requires the dedicated
    // `stock_correction.approve` permission (or admin bypass).
    const canApplyCorrection = await userCan(user.id, "stock_correction", "approve");
    if (data.status === "APPROVED" && data.applyToStock === true && !canApplyCorrection) {
      return errorResponse(
        "You do not have permission to apply stock corrections to live inventory (requires stock_correction.approve)",
        403
      );
    }

    const applyToStock =
      data.status === "APPROVED" &&
      data.applyToStock === true &&
      canApplyCorrection;

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
    // Only a BIN audit is applied (plan 2109, R33, R36). The whole-warehouse branch
    // (`setWarehouseQty`) and the whole-store branch (`correctionWarehouseId` + `deductFromStore`)
    // were removed: neither can say which bin a difference belongs to, and the warehouse one
    // overwrote every other bin's stock with this bin's count.
    let correctionTarget: CorrectionTarget | null = null;
    if (applyToStock) {
      if (!existing.binId || !existing.warehouseId) {
        log.warn("apply to stock refused: audit has no bin", {
          stockCountId: id,
          warehouseId: existing.warehouseId,
          storeId: existing.storeId,
        });
        return errorResponse(
          "This audit was saved without a bin, so it cannot say which bin a difference belongs to. Approve it as verify-only, then count each bin.",
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
      const bin = await prisma.bin.findUnique({
        where: { id: existing.binId },
        select: { id: true, code: true, warehouseId: true, isActive: true, nonAssemblable: true },
      });
      if (!bin || bin.warehouseId !== w.id) {
        log.warn("apply to stock refused: bin missing or moved", { stockCountId: id, binId: existing.binId });
        return errorResponse("The bin this audit counted no longer exists in its warehouse. Approve it as verify-only.", 400);
      }
      if (!bin.isActive) {
        return errorResponse(`Bin ${bin.code} is no longer active — stock cannot be corrected there. Approve as verify-only.`, 400);
      }
      correctionTarget = {
        warehouseId: w.id,
        name: w.name,
        binId: bin.id,
        binCode: bin.code,
        nonAssemblable: bin.nonAssemblable,
      };
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
                // This older path carries no condition split; a split that no longer sums to
                // the count would be applied wrongly, so it is cleared (plan 1709, Q42).
                assembledQty: null,
                unassembledQty: null,
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
        //
        // R33: "live" is what THIS BIN holds — the same figure the counter was shown when the
        // audit was raised. It used to be the whole warehouse's quantity, so a bin holding 5 of
        // a warehouse's 9, counted as 5, applied as −4 and wrote off another bin's stock.
        const productIds = countedItems.map((i) => i.productId);
        const liveMap = await getBinQtyMap(target.binId, productIds, tx);

        const summary: AppliedSummary = {
          lines: 0, changed: 0, netUnits: 0, zeroLines: 0, writtenOff: 0,
          warehouse: target.name, scope: "bin", bin: target.binCode, binId: target.binId,
          productsGivenBin: 0,
          units: { created: 0, createdUnitIds: [], markedAssembled: 0, markedUnassembled: 0, retiredCodes: [] },
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
          // ── UNITS AND STOCK FOLLOW THE COUNT (plan 1709, Part B, R7, R11, Q42; plan 2109,
          //    R31–R33) — `applyBinCountLine` ──
          //
          // Every counted line makes THIS BIN hold exactly the counted units, keeping existing
          // codes (P9) and creating `U-` codes in the bin for items that have none (R31). It
          // runs even when the total matches, because the condition may not.
          //   - non-assemblable bin (R32): no condition is counted — all of it is unassembled,
          //     and `createUnits` stamps new units non-assemblable from the bin;
          //   - assemblable bin with the split: exactly the counter's two numbers;
          //   - assemblable bin without the split (an older client): the total, keeping what
          //     is already built.
          // The warehouse then moves by the bin's difference. Before plan 2109 the sync ran over
          // the whole warehouse, a line without the split retired a shortage from ANY bin
          // (`adjustWarehouseUnits`), and `setWarehouseQty(counted)` set the whole warehouse to
          // one bin's count — R33.
          const lineResult = await applyBinCountLine(tx, {
            productId: product.id,
            warehouseId: target.warehouseId,
            binId: target.binId,
            nonAssemblable: target.nonAssemblable,
            counted,
            live,
            assembledQty: item.assembledQty,
            unassembledQty: item.unassembledQty,
          });
          const { synced, warehouseBefore, warehouseAfter } = lineResult;
          summary.units.created += synced.createdAssembled + synced.createdUnassembled;
          summary.units.createdUnitIds.push(...synced.createdUnitIds);
          summary.units.markedAssembled += synced.markedAssembled;
          summary.units.markedUnassembled += synced.markedUnassembled;
          summary.units.retiredCodes.push(...synced.retired.map((r) => r.unitCode));

          if (delta === 0) continue;
          summary.changed += 1;
          summary.netUnits += delta;

          // ── EVERY CORRECTION IS EVIDENCE (plan 1709, R26) ──────────────────────────────
          //
          // One CORRECTED event per line the count actually moved. This is the raw material of
          // the approver-error rate: `api/approvals/error-rate` matches each of these back to
          // the most recent APPROVED inbound or transfer for the same product (and place, when
          // one is recorded) inside the rule's window, and counts it against THAT approver.
          //
          // `approverId` is deliberately NULL here. The person to blame is not known at this
          // moment and must not be guessed at — it is certainly not the auditor, who found the
          // mistake. Leaving the match to read time is also what makes `windowDays` a setting
          // that can be changed and re-applied to history; had it been resolved here, changing
          // 7 days to 1 would only affect corrections made after the change.
          await recordApprovalEvent(tx, {
            activity: "STOCK_AUDIT",
            event: "CORRECTED",
            recordId: id,
            recordRef: existing.countNo ?? existing.title,
            actorId: user.id,
            approverId: null,
            productId: product.id,
            warehouseId: target.warehouseId,
            quantity: delta,
            note: `counted ${counted} in bin ${target.binCode}, bin held ${live}`,
          });

          await tx.binMovementLog.create({
            data: {
              warehouseId: target.warehouseId,
              productId: product.id,
              quantity: Math.abs(delta),
              fromBinId: delta < 0 ? target.binId : null,
              toBinId: delta > 0 ? target.binId : null,
              reason: `Stock Count Audit Correction (${existing.countNo || existing.title})`,
              movedById: user.id,
            },
          });

          // Keep the `[STOCK_COUNT]` prefix: DELETE of a completed count reverses by it.
          // previous/new are the WAREHOUSE's figures; the bin's are in the note.
          await tx.inventoryTransaction.create({
            data: {
              type: "ADJUSTMENT",
              productId: product.id,
              quantity: Math.abs(delta),
              previousStock: warehouseBefore,
              newStock: warehouseAfter,
              referenceNo: existing.title,
              notes: `[STOCK_COUNT] [VERIFICATION] ${delta > 0 ? "Surplus" : "Shortage"} of ${Math.abs(delta)} (snapshot ${item.systemQty}, bin held ${live}, counted ${counted}) in bin ${target.binCode} at ${target.name} during "${existing.title}"`,
              userId: user.id,
            },
          });
        }

        // One recount of the bin from its units at the end (P11), so a line whose total matched
        // but whose BinStock row had drifted is left consistent too.
        await syncBinStock(tx, [target.binId]);

        // The counted products get this bin as their home bin when they have none (plan
        // 2209-audit-assigns-product-bin, Part A). Without it a product that entered the
        // building through an audit kept `Product.binId = null` for good: invisible to the
        // /stock bin filter and stuck under "Needs details". Only here — on approval WITH
        // "apply to stock" — never on Complete, reject or a record-only approval (Q3a).
        summary.productsGivenBin = await assignBinToCountedProducts(tx, target.binId, countedItems);
        log.info("audit gave products their bin", {
          stockCountId: id, binId: target.binId, productsGivenBin: summary.productsGivenBin,
        });

        applied = summary;
        log.info("stock corrected", {
          stockCountId: id,
          scope: summary.scope,
          binId: summary.binId,
          lines: summary.lines,
          changed: summary.changed,
          netUnits: summary.netUnits,
          zeroLines: summary.zeroLines,
          writtenOff: summary.writtenOff,
          unitsCreated: summary.units.created,
          unitsMarkedAssembled: summary.units.markedAssembled,
          unitsMarkedUnassembled: summary.units.markedUnassembled,
          unitsRetired: summary.units.retiredCodes.length,
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

        // The approval itself, as an event (R22, R26). `approverId` is the actor on APPROVED —
        // this is the row a later correction of THIS audit's own numbers would be counted
        // against — and null on REJECTED, where nothing was approved (see events.ts).
        if (data.status === "APPROVED" || data.status === "REJECTED") {
          await recordApprovalEvent(tx, {
            activity: "STOCK_AUDIT",
            event: data.status === "APPROVED" ? "APPROVED" : "REJECTED",
            recordId: id,
            recordRef: existing.countNo ?? existing.title,
            actorId: user.id,
            approverId: data.status === "APPROVED" ? user.id : null,
            warehouseId: existing.warehouseId,
            note:
              data.status === "REJECTED"
                ? data.rejectionReason || null
                : correctionTarget
                  ? `applied to stock in bin ${correctionTarget.binCode} at ${correctionTarget.name}`
                  : "verify only",
          });
        }
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
                ? `stock corrected in bin ${correctionTarget.binCode} at ${correctionTarget.name}`
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

    // After the commit (plan 2409-stock-audit-push, R2/R3): one push for the transition that
    // just happened. Starting a count (PENDING/REJECTED → IN_PROGRESS) pushes nobody.
    if (data.status && data.status !== existing.status) {
      const kind =
        data.status === "COMPLETED" ? "completed"
        : data.status === "APPROVED" ? "approved"
        : data.status === "REJECTED" ? "rejected"
        : null;
      if (kind) {
        notifyStockAudit(kind, {
          stockCountId: id,
          countNo: existing.countNo,
          title: existing.title,
          assignedToId: existing.assignedToId,
          actorId: user.id,
          actorName: user.name,
          reason: data.status === "REJECTED" ? data.rejectionReason ?? null : null,
        });
      }
    }

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
