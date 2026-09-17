export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { logActivity } from "@/lib/activity-log";
import { retireUnits, LIVE_UNIT_STATUSES } from "@/lib/units";
import { createLogger } from "@/lib/logger";

const log = createLogger("stock-reset:warehouse");

const bodySchema = z.object({
  warehouseId: z.string().min(1, "Choose a warehouse"),
  confirm: z.literal("RESET_STOCK", { error: "Type RESET_STOCK to confirm" }),
});

/**
 * POST: reset ONE warehouse's stock to nothing (plan 1709-priority-build-and-stock-flow, R11,
 * Q43, P3), before it is re-audited at unit level.
 *
 * Clears, in one transaction:
 *   - the warehouse's `StockLevel` rows — quantity AND holds (a hold on stock that no longer
 *     exists would block every outward from it);
 *   - the `BinStock` of every bin in it;
 *   - every live unit there, marked RESET (history kept, open build tasks cancelled — P3).
 *     Units in transit and units already sold / lost / reset are not touched.
 * then recomputes each affected product's cached totals and writes one ADJUSTMENT ledger row
 * per product whose quantity changed, and one activity-log entry.
 *
 * `stock_audit.approve`, like the older all-products reset — it is the supervisory action on
 * this module. The confirm string is a typo guard, not a permission.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("stock_audit", "approve");
    const raw = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request", 400);
    }
    const { warehouseId } = parsed.data;

    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true, name: true, code: true, store: { select: { name: true } } },
    });
    if (!warehouse) return errorResponse("That warehouse does not exist", 404);

    const result = await prisma.$transaction(
      async (tx) => {
        const levels = await tx.stockLevel.findMany({
          where: { warehouseId, OR: [{ quantity: { not: 0 } }, { reservedQuantity: { not: 0 } }] },
          select: { productId: true, quantity: true, reservedQuantity: true },
        });

        // Units first: retiring them recounts their bins, and the blanket zero below then
        // clears what untracked products had typed into those bins.
        const units = await tx.inventoryUnit.findMany({
          where: { warehouseId, status: { in: LIVE_UNIT_STATUSES } },
          select: { id: true },
        });
        const unitsReset = await retireUnits(tx, units.map((u) => u.id), "RESET");

        const binStock = await tx.binStock.updateMany({
          where: { bin: { warehouseId }, quantity: { not: 0 } },
          data: { quantity: 0 },
        });

        const zeroed = await tx.stockLevel.updateMany({
          where: { warehouseId, OR: [{ quantity: { not: 0 } }, { reservedQuantity: { not: 0 } }] },
          data: { quantity: 0, reservedQuantity: 0 },
        });

        const productIds = levels.map((l) => l.productId);
        let ledgerRows = 0;
        if (productIds.length > 0) {
          const before = await tx.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, currentStock: true },
          });
          const previous = new Map(before.map((p) => [p.id, p.currentStock]));

          // The cached totals, recomputed from the rows in ONE statement. This is what
          // `recomputeCurrentStock` + `recomputeReservedStock` do per product; a warehouse can
          // hold thousands of products, and two round trips each would not finish inside the
          // transaction on the remote pooler.
          await tx.$executeRaw`
            UPDATE "Product" p
            SET "currentStock" = s.qty, "reservedStock" = s.reserved, "updatedAt" = NOW()
            FROM (
              SELECT ids.id, COALESCE(SUM(sl.quantity), 0)::int AS qty,
                     COALESCE(SUM(sl."reservedQuantity"), 0)::int AS reserved
              FROM unnest(${productIds}::text[]) AS ids(id)
              LEFT JOIN "StockLevel" sl ON sl."productId" = ids.id
              GROUP BY ids.id
            ) s
            WHERE p.id = s.id
          `;

          const after = await tx.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, currentStock: true },
          });
          const newStock = new Map(after.map((p) => [p.id, p.currentStock]));

          const rows: Prisma.InventoryTransactionCreateManyInput[] = levels
            .filter((l) => l.quantity !== 0)
            .map((l) => ({
              type: "ADJUSTMENT" as const,
              productId: l.productId,
              quantity: l.quantity,
              previousStock: previous.get(l.productId) ?? 0,
              newStock: newStock.get(l.productId) ?? 0,
              referenceNo: `RESET-${warehouse.code}`,
              notes: `[STOCK_RESET] ${warehouse.name} reset for a unit-level audit: ${l.quantity} cleared${
                l.reservedQuantity ? `, ${l.reservedQuantity} held released` : ""
              }`,
              userId: user.id,
            }));
          if (rows.length > 0) {
            const created = await tx.inventoryTransaction.createMany({ data: rows });
            ledgerRows = created.count;
          }
        }

        const summary = {
          warehouseId,
          warehouse: warehouse.name,
          products: levels.length,
          unitsCleared: levels.reduce((sum, l) => sum + l.quantity, 0),
          holdsReleased: levels.reduce((sum, l) => sum + l.reservedQuantity, 0),
          stockLevelRows: zeroed.count,
          binStockRows: binStock.count,
          unitRecordsReset: unitsReset,
          ledgerRows,
        };

        await logActivity(tx, {
          module: "stock_audit",
          action: "stock_reset",
          entityType: "Warehouse",
          entityId: warehouse.id,
          entityRef: warehouse.code,
          details: `${warehouse.store.name} · ${warehouse.name}: ${summary.unitsCleared} stock cleared across ${summary.products} products, ${unitsReset} unit records reset`,
          userId: user.id,
          userName: user.name,
        });

        return summary;
      },
      { timeout: 55_000, maxWait: 10_000 }
    );

    log.info("warehouse stock reset", {
      warehouseId,
      products: result.products,
      unitsCleared: result.unitsCleared,
      unitRecordsReset: result.unitRecordsReset,
      binStockRows: result.binStockRows,
      userId: user.id,
    });
    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("warehouse stock reset failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Reset failed", 500);
  }
}
