export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { listWarehouses } from "@/lib/warehouses";
import { getWarehouseBinQty } from "@/lib/units/bin-qty";
import { loadHomeBinRules, pickHomeBin } from "@/lib/bins/rule-match";
import { createLogger } from "@/lib/logger";
import type { TransferBinOption, TransferBinOptions } from "@/lib/transfers/bin-options";

const log = createLogger("transfers:bin-options");

/**
 * The bins a transfer line can name — plan 0310, Part C (2209 Phase 1, Q14).
 *
 * `GET ?fromWarehouseId=&toWarehouseId=&productIds=a,b,c`
 *
 * Read by `/transfers/new` and the Edit items sheet of a returned order. The quantities come from
 * `getWarehouseBinQty` and the rule from `pickHomeBin` — the same two functions
 * `validateTransferItems` checks the submitted lines with, so what the picker offers is what the
 * server accepts.
 *
 * Guarded by `transfers.view`, not `create`: a returned order's creator may correct it without
 * holding `create` (see PATCH /api/transfer-orders/[id]), and this only reads.
 */
export async function GET(req: NextRequest) {
  const started = Date.now();
  try {
    await requireFeature("transfers", "view");
    const { searchParams } = new URL(req.url);
    const fromWarehouseId = searchParams.get("fromWarehouseId") ?? "";
    const toWarehouseId = searchParams.get("toWarehouseId") ?? "";
    const productIds = [
      ...new Set((searchParams.get("productIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
    ];

    if (!fromWarehouseId || !toWarehouseId) return errorResponse("fromWarehouseId and toWarehouseId are required", 400);
    if (productIds.length > 100) return errorResponse("At most 100 products at a time", 400);

    const warehouses = await listWarehouses();
    const fromWh = warehouses.find((w) => w.id === fromWarehouseId);
    const toWh = warehouses.find((w) => w.id === toWarehouseId);
    if (!fromWh) return errorResponse("The source warehouse is not active", 400);
    if (!toWh) return errorResponse("The destination warehouse is not active", 400);

    const [qty, bins, rules, products] = await Promise.all([
      getWarehouseBinQty(fromWh.id, productIds),
      prisma.bin.findMany({
        where: { warehouseId: { in: [fromWh.id, toWh.id] }, isActive: true },
        select: { id: true, code: true, name: true, warehouseId: true, nonAssemblable: true },
        orderBy: { code: "asc" },
      }),
      loadHomeBinRules(prisma, toWh.id),
      prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, brandId: true, categoryId: true },
      }),
    ]);

    const binById = new Map(bins.map((b) => [b.id, b]));
    const fromBins: TransferBinOptions["fromBins"] = {};
    const ruleBins: TransferBinOptions["ruleBins"] = {};
    for (const productId of productIds) {
      fromBins[productId] = [...(qty.get(productId) ?? new Map<string, number>()).entries()]
        .map(([binId, n]) => {
          const b = binById.get(binId);
          return b ? { id: b.id, code: b.code, name: b.name, qty: n } : null;
        })
        .filter((b): b is TransferBinOption & { qty: number } => b !== null)
        .sort((a, b) => b.qty - a.qty || a.code.localeCompare(b.code));
    }
    for (const p of products) {
      const match = pickHomeBin(rules, { productId: p.id, brandId: p.brandId, categoryId: p.categoryId });
      ruleBins[p.id] = match ? { id: match.bin.id, code: match.bin.code, name: match.bin.name } : null;
    }
    const toBins = bins
      .filter((b) => b.warehouseId === toWh.id)
      .map((b) => ({ id: b.id, code: b.code, name: b.name, nonAssemblable: b.nonAssemblable }));

    log.debug("transfer bin options", {
      fromWarehouseId,
      toWarehouseId,
      products: productIds.length,
      toBins: toBins.length,
      ms: Date.now() - started,
    });
    return successResponse({ fromBins, ruleBins, toBins } satisfies TransferBinOptions);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("transfer bin options failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to load bins", 500);
  }
}
