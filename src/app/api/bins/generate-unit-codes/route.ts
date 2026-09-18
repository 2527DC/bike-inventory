export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createUnits, LIVE_UNIT_STATUSES } from "@/lib/units";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("bins:generate-unit-codes");

/**
 * Give EXISTING stock unit codes (R41, R46, P8).
 *
 * Until now only an inbound receipt minted codes, so everything that was on the shelves before
 * the units arrived is a bare quantity: a `StockLevel` number per warehouse, a `BinStock` row
 * where somebody did a put-away, and `Product.binId` as a home bin. None of that can be put on
 * a label or picked by the build line.
 *
 * ── HOW MANY (P8, count (a)) ──
 *   per product, in this warehouse: `StockLevel.quantity` − the live unit records it already
 *   has there, floored at 0. Ten boxed cycles therefore get ten SEPARATE codes (R46) from the
 *   same row-locked sequence, so no two labels can read the same.
 *
 * ── IN WHAT CONDITION (P8, condition) ──
 *   There is NO condition choice. Generating codes is code creation and nothing else: every
 *   item in scope gets one, unassembled, exactly as an inward creates them (P4) — stamped "no
 *   assembly" only when the bin it goes into is a no-assembly bin. A floor full of built cycles
 *   is corrected afterwards by the unit-level stock audit (assembled qty + unassembled qty),
 *   not by this button.
 *
 * ── WHICH BIN ──
 *   the product's `BinStock` row in this warehouse → else `Product.binId` when that bin is in
 *   this warehouse → else no bin at all (it shows in "Unmatched", to be put away).
 */

/** One run creates at most this many units. The response says what is left; press it again. */
const MAX_PER_RUN = 500;

interface ScopeRow {
  productId: string;
  productName: string;
  sku: string;
  missing: number;
  stockQty: number;
  liveUnits: number;
  binId: string | null;
  binCode: string | null;
  binNonAssemblable: boolean;
}

/**
 * What this warehouse (optionally one bin of it) is short of unit records, per product.
 * Read-only; both GET and POST start here so the dry run and the run cannot disagree.
 */
async function buildScope(warehouseId: string, binId: string | null): Promise<ScopeRow[]> {
  const [levels, unitCounts, binStocks, binsInWarehouse] = await Promise.all([
    prisma.stockLevel.findMany({
      where: { warehouseId, quantity: { gt: 0 } },
      select: { productId: true, quantity: true },
    }),
    prisma.inventoryUnit.groupBy({
      by: ["productId"],
      where: { warehouseId, status: { in: LIVE_UNIT_STATUSES } },
      _count: { _all: true },
    }),
    prisma.binStock.findMany({
      where: { bin: { warehouseId, isActive: true }, quantity: { gt: 0 } },
      select: { binId: true, productId: true, quantity: true },
      orderBy: { quantity: "desc" },
    }),
    prisma.bin.findMany({
      where: { warehouseId, isActive: true },
      select: { id: true, code: true, nonAssemblable: true },
    }),
  ]);

  const liveByProduct = new Map(unitCounts.map((u) => [u.productId, u._count._all]));
  const binMeta = new Map(binsInWarehouse.map((b) => [b.id, b]));

  // The bin a product is recorded in. Several rows can exist for one product; the biggest wins,
  // which `orderBy quantity desc` plus first-write already gives us.
  const binByProduct = new Map<string, string>();
  for (const row of binStocks) {
    if (!binByProduct.has(row.productId)) binByProduct.set(row.productId, row.binId);
  }

  const shortIds: string[] = [];
  const shortfall = new Map<string, { stockQty: number; live: number; missing: number }>();
  for (const level of levels) {
    const live = liveByProduct.get(level.productId) ?? 0;
    const missing = level.quantity - live;
    if (missing <= 0) continue;
    shortIds.push(level.productId);
    shortfall.set(level.productId, { stockQty: level.quantity, live, missing });
  }
  if (shortIds.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: shortIds } },
    select: { id: true, name: true, sku: true, binId: true },
  });

  const rows: ScopeRow[] = [];
  for (const product of products) {
    const short = shortfall.get(product.id);
    if (!short) continue;

    // BinStock first, then the product's home bin — but only when that bin is in THIS warehouse.
    let targetBinId = binByProduct.get(product.id) ?? null;
    if (!targetBinId && product.binId && binMeta.has(product.binId)) targetBinId = product.binId;
    const bin = targetBinId ? binMeta.get(targetBinId) ?? null : null;
    if (!bin) targetBinId = null;

    // A bin-scoped run covers only what that bin holds.
    if (binId && targetBinId !== binId) continue;

    rows.push({
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      missing: short.missing,
      stockQty: short.stockQty,
      liveUnits: short.live,
      binId: targetBinId,
      binCode: bin?.code ?? null,
      binNonAssemblable: bin?.nonAssemblable ?? false,
    });
  }

  rows.sort((a, b) => b.missing - a.missing || a.productName.localeCompare(b.productName));
  return rows;
}

async function readScope(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const warehouseId = searchParams.get("warehouseId");
  const binId = searchParams.get("binId");
  if (!warehouseId) return { ok: false as const, error: "Choose the warehouse to generate codes for" };

  const warehouse = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, name: true, isActive: true },
  });
  if (!warehouse || !warehouse.isActive) {
    return { ok: false as const, error: "That warehouse does not exist or is not active" };
  }

  if (binId) {
    const bin = await prisma.bin.findUnique({
      where: { id: binId },
      select: { id: true, code: true, warehouseId: true, isActive: true },
    });
    if (!bin || !bin.isActive) return { ok: false as const, error: "That bin does not exist or is not active" };
    if (bin.warehouseId !== warehouseId) return { ok: false as const, error: "That bin is in another warehouse" };
  }

  return { ok: true as const, warehouse, binId: binId || null };
}

/** GET — the dry run: how many codes, for which products, into which bins. Writes nothing. */
export async function GET(req: NextRequest) {
  try {
    await requireFeature("bins", "edit");

    const scope = await readScope(req);
    if (!scope.ok) return errorResponse(scope.error, 400);

    const rows = await buildScope(scope.warehouse.id, scope.binId);
    const total = rows.reduce((acc, r) => acc + r.missing, 0);
    const withoutBin = rows.filter((r) => !r.binId).reduce((acc, r) => acc + r.missing, 0);
    const noAssembly = rows.filter((r) => r.binNonAssemblable).reduce((acc, r) => acc + r.missing, 0);

    log.info("generate-unit-codes dry run", {
      warehouseId: scope.warehouse.id,
      binId: scope.binId,
      products: rows.length,
      total,
      withoutBin,
      noAssembly,
    });

    return successResponse({
      warehouse: { id: scope.warehouse.id, name: scope.warehouse.name },
      binId: scope.binId,
      totalCodes: total,
      products: rows.length,
      withoutBin,
      noAssembly,
      maxPerRun: MAX_PER_RUN,
      // The whole list can be thousands of rows; the screen needs the biggest ones and a total.
      rows: rows.slice(0, 200),
      truncated: rows.length > 200,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("generate-unit-codes dry run failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to work out what needs codes", 500);
  }
}

/** POST — create the codes. Scope comes from the query string, exactly as the dry run read it. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("bins", "edit");

    const scope = await readScope(req);
    if (!scope.ok) return errorResponse(scope.error, 400);

    const rows = await buildScope(scope.warehouse.id, scope.binId);
    if (rows.length === 0) {
      return successResponse({ created: 0, remaining: 0, units: [] });
    }

    // Take products in order until the run is full. A product is never split across two runs
    // half-way through if it fits; one that alone exceeds the cap is filled to the cap and the
    // rest is left for the next press.
    const plan: Array<{ row: ScopeRow; qty: number }> = [];
    let budget = MAX_PER_RUN;
    for (const row of rows) {
      if (budget <= 0) break;
      const qty = Math.min(row.missing, budget);
      plan.push({ row, qty });
      budget -= qty;
    }

    const createdIds = await prisma.$transaction(
      async (tx) => {
        const ids: string[] = [];
        for (const { row, qty } of plan) {
          // Unassembled, no condition choice (P8). `createUnits` stamps them when the bin is a
          // no-assembly bin and recounts that bin from its units afterwards (P6, P11).
          const made = await createUnits(tx, {
            productId: row.productId,
            warehouseId: scope.warehouse.id,
            qty,
            binId: row.binId,
          });
          ids.push(...made);
        }

        await logActivity(tx, {
          module: "bins",
          action: "created",
          entityType: "Warehouse",
          entityId: scope.warehouse.id,
          entityRef: scope.warehouse.name,
          details: `Generated ${ids.length} unit code(s) for existing stock${scope.binId ? " in one bin" : ""}`,
          userId: user.id,
          userName: user.name,
        });

        return ids;
      },
      // Two statements per code (allocate, insert) plus a bin recount per product.
      { timeout: 180_000 }
    );

    const units = createdIds.length
      ? await prisma.inventoryUnit.findMany({
          where: { id: { in: createdIds } },
          select: {
            id: true,
            unitCode: true,
            nonAssemblable: true,
            bin: { select: { id: true, code: true } },
            product: { select: { id: true, name: true, sku: true } },
          },
          orderBy: { unitCode: "asc" },
        })
      : [];

    const after = await buildScope(scope.warehouse.id, scope.binId);
    const remaining = after.reduce((acc, r) => acc + r.missing, 0);

    log.info("unit codes generated for existing stock", {
      warehouseId: scope.warehouse.id,
      binId: scope.binId,
      created: createdIds.length,
      products: plan.length,
      remaining,
      userId: user.id,
    });

    return successResponse({
      created: createdIds.length,
      products: plan.length,
      remaining,
      unitIds: createdIds,
      units,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("generate-unit-codes failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to generate unit codes", 500);
  }
}
