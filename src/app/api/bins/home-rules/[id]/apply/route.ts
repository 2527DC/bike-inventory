export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { ruleProductWhere } from "@/lib/bins/rule-match";
import { BinMoveRefused, LIVE_UNIT_STATUSES, placeUnitsInBin } from "@/lib/units";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("bins:apply-rule");

/**
 * Apply one home-bin rule to stock that is ALREADY in the building (R40, P10 (b)).
 *
 * A rule only ever pointed forward: it placed the next inbound item and left everything
 * already on the shelves where it was. The owner asked for a button that moves the existing
 * stock too, and chose option (b) — EVERYTHING the rule matches moves, including items
 * deliberately placed in another bin. So the dry run matters: `GET` lists what would move and
 * from where, and nothing happens until `POST`.
 *
 * P6 still holds and is not negotiable: a unit stamped "no assembly" is never moved into a bin
 * that holds items needing assembly. Those are listed as SKIPPED rather than silently dropped.
 *
 * Only units move. Stock with no unit records yet (`BinStock` typed in before codes existed)
 * is not touched — generate its codes first (R41), then apply the rule.
 */

/** One POST moves at most this many units, so a rule covering a whole brand cannot run past the
 *  request timeout. The response says how many are left; the button can be pressed again. */
const MAX_PER_RUN = 1000;

interface RuleRow {
  id: string;
  warehouseId: string;
  brandId: string | null;
  categoryId: string | null;
  productId: string | null;
  binId: string;
  bin: { id: string; code: string; name: string; nonAssemblable: boolean; isActive: boolean };
  warehouse: { id: string; name: string };
}

async function loadRule(id: string): Promise<RuleRow | null> {
  return prisma.homeBinRule.findUnique({
    where: { id },
    select: {
      id: true,
      warehouseId: true,
      brandId: true,
      categoryId: true,
      productId: true,
      binId: true,
      bin: { select: { id: true, code: true, name: true, nonAssemblable: true, isActive: true } },
      warehouse: { select: { id: true, name: true } },
    },
  });
}

/**
 * A rule with no brand, category or product names nothing — `POST /api/bins/home-rules` refuses
 * to create one, but an older row could exist, and applying it would move the entire warehouse.
 */
function hasCriteria(rule: RuleRow): boolean {
  return Boolean(rule.productId || rule.brandId || rule.categoryId);
}

/** Every live unit this rule covers that is not already in its bin. */
function movableWhere(rule: RuleRow): Prisma.InventoryUnitWhereInput {
  const productWhere = ruleProductWhere(rule);
  return {
    warehouseId: rule.warehouseId,
    status: { in: LIVE_UNIT_STATUSES },
    // `binId: { not: x }` alone drops the rows with no bin at all — NULL != x is unknown in SQL.
    OR: [{ binId: null }, { binId: { not: rule.binId } }],
    ...(rule.productId ? { productId: rule.productId } : { product: productWhere }),
  };
}

/** GET — the dry run. Nothing is written. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requireFeature("bins", "edit");

    const rule = await loadRule(id);
    if (!rule) return errorResponse("That rule no longer exists", 404);
    if (!rule.bin.isActive) return errorResponse(`Bin ${rule.bin.code} is no longer active`, 400);
    if (!hasCriteria(rule)) {
      return errorResponse(
        "This rule names no brand, category or product, so there is nothing it applies to. Delete it and make a new one.",
        400
      );
    }

    const where = movableWhere(rule);

    // Counts only: a rule can cover thousands of units and the screen needs a summary, not a
    // list of unit codes. Grouped by product AND source bin, which is what the person is being
    // asked to confirm — "18 from A1, 4 with no bin".
    const grouped = await prisma.inventoryUnit.groupBy({
      by: ["productId", "binId", "nonAssemblable"],
      where,
      _count: { _all: true },
    });

    const productIds = [...new Set(grouped.map((g) => g.productId))];
    const binIds = [...new Set(grouped.map((g) => g.binId).filter((b): b is string => !!b))];
    const [products, bins] = await Promise.all([
      productIds.length
        ? prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true, sku: true },
          })
        : Promise.resolve([]),
      binIds.length
        ? prisma.bin.findMany({ where: { id: { in: binIds } }, select: { id: true, code: true, name: true } })
        : Promise.resolve([]),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const binById = new Map(bins.map((b) => [b.id, b]));

    // A stamped unit may not enter a bin that holds items needing assembly (P6).
    const isSkipped = (nonAssemblable: boolean) => nonAssemblable && !rule.bin.nonAssemblable;

    const moving: Array<{
      productId: string;
      productName: string;
      sku: string;
      fromBinId: string | null;
      fromBinCode: string | null;
      quantity: number;
    }> = [];
    const skipped: typeof moving = [];
    let movingTotal = 0;
    let skippedTotal = 0;

    for (const g of grouped) {
      const product = productById.get(g.productId);
      const row = {
        productId: g.productId,
        productName: product?.name ?? "(unknown product)",
        sku: product?.sku ?? "",
        fromBinId: g.binId,
        fromBinCode: g.binId ? binById.get(g.binId)?.code ?? null : null,
        quantity: g._count._all,
      };
      if (isSkipped(g.nonAssemblable)) {
        skipped.push(row);
        skippedTotal += row.quantity;
      } else {
        moving.push(row);
        movingTotal += row.quantity;
      }
    }

    const byQty = (a: { quantity: number }, b: { quantity: number }) => b.quantity - a.quantity;
    moving.sort(byQty);
    skipped.sort(byQty);

    log.info("apply-rule dry run", {
      ruleId: rule.id,
      warehouseId: rule.warehouseId,
      binId: rule.binId,
      moving: movingTotal,
      skipped: skippedTotal,
      groups: grouped.length,
    });

    return successResponse({
      rule: {
        id: rule.id,
        warehouse: rule.warehouse,
        bin: { id: rule.bin.id, code: rule.bin.code, name: rule.bin.name, nonAssemblable: rule.bin.nonAssemblable },
      },
      movingTotal,
      skippedTotal,
      moving,
      skipped,
      maxPerRun: MAX_PER_RUN,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("apply-rule dry run failed", {
      ruleId: id,
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to work out what would move", 500);
  }
}

/** POST — do it. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireFeature("bins", "edit");

    const rule = await loadRule(id);
    if (!rule) return errorResponse("That rule no longer exists", 404);
    if (!rule.bin.isActive) return errorResponse(`Bin ${rule.bin.code} is no longer active`, 400);
    if (!hasCriteria(rule)) {
      return errorResponse(
        "This rule names no brand, category or product, so there is nothing it applies to. Delete it and make a new one.",
        400
      );
    }

    const where: Prisma.InventoryUnitWhereInput = {
      ...movableWhere(rule),
      // The skipped ones, left where they are (P6). When the rule's bin itself needs no
      // assembly, nothing is excluded — everything may go in.
      ...(rule.bin.nonAssemblable ? {} : { nonAssemblable: false }),
    };

    const candidates = await prisma.inventoryUnit.findMany({
      where,
      select: { id: true, productId: true, binId: true },
      orderBy: { createdAt: "asc" },
      take: MAX_PER_RUN,
    });

    if (candidates.length === 0) {
      return successResponse({ moved: 0, remaining: 0, products: 0, binCode: rule.bin.code });
    }

    const moved = await prisma.$transaction(async (tx) => {
      // Chunked so one statement never carries thousands of ids; all inside ONE transaction, so
      // a failure halfway leaves no half-applied rule.
      const CHUNK = 200;
      for (let i = 0; i < candidates.length; i += CHUNK) {
        const chunk = candidates.slice(i, i + CHUNK);
        // Places, stamps, and recounts `BinStock` for the source bins and the destination (P11).
        await placeUnitsInBin(tx, chunk.map((u) => u.id), rule.binId);
        await tx.binMovementLog.createMany({
          data: chunk.map((u) => ({
            warehouseId: rule.warehouseId,
            unitId: u.id,
            productId: u.productId,
            quantity: 1,
            fromBinId: u.binId,
            toBinId: rule.binId,
            reason: `Home bin rule applied to existing stock → ${rule.bin.code}`,
            movedById: user.id,
          })),
        });
      }

      // The rule's bin becomes these products' home bin, so the put-away suggestion and the
      // stock screens agree with where the items now are.
      const productIds = [...new Set(candidates.map((u) => u.productId))];
      await tx.product.updateMany({ where: { id: { in: productIds } }, data: { binId: rule.binId } });

      await logActivity(tx, {
        module: "bins",
        action: "updated",
        entityType: "HomeBinRule",
        entityId: rule.id,
        entityRef: rule.bin.code,
        details: `Applied to existing stock: ${candidates.length} item(s) moved into ${rule.bin.code} (${rule.warehouse.name})`,
        userId: user.id,
        userName: user.name,
      });

      return { units: candidates.length, products: productIds.length };
    }, { timeout: 120_000 });

    const remaining = await prisma.inventoryUnit.count({ where });

    log.info("home bin rule applied to existing stock", {
      ruleId: rule.id,
      warehouseId: rule.warehouseId,
      binId: rule.binId,
      moved: moved.units,
      products: moved.products,
      remaining,
      userId: user.id,
    });

    return successResponse({
      moved: moved.units,
      products: moved.products,
      remaining,
      binCode: rule.bin.code,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof BinMoveRefused) {
      log.warn("apply-rule refused", { ruleId: id, message: error.message });
      return errorResponse(error.message, 409);
    }
    log.error("apply-rule failed", {
      ruleId: id,
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to move the items", 500);
  }
}
