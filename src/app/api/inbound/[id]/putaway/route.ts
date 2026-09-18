export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { loadHomeBinRules, pickHomeBin } from "@/lib/bins/rule-match";
import { BinMoveRefused, placeUnitsInBin } from "@/lib/units";
import { createLogger } from "@/lib/logger";

const log = createLogger("inbound:putaway");

// GET: Retrieve shipment items for put-away with suggested HomeBinRules and existing bin assignments
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("inbound", "view");
    const { id } = await params;

    const shipment = await prisma.inboundShipment.findUnique({
      where: { id },
      include: {
        brand: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        lineItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                brandId: true,
                brand: { select: { id: true, name: true } },
                categoryId: true,
                category: { select: { id: true, name: true } },
                binId: true,
                bin: { select: { id: true, code: true, name: true, directions: true } },
              },
            },
            bin: { select: { id: true, code: true, name: true, directions: true } },
          },
        },
      },
    });

    if (!shipment) return errorResponse("Shipment not found", 404);

    const { searchParams } = new URL(req.url);
    const queryWarehouseId = searchParams.get("warehouseId");

    // ── ONE MATCHER, SHARED WITH THE INWARD PATHS (P4, P13) ──
    //
    // The precedence chain used to live here, inline, and nowhere else — so an inward that went
    // straight into stock ignored the rules. It is `src/lib/bins/rule-match.ts` now; this route
    // only supplies the fallback (the SHIPMENT's brand/category for a line whose product carries
    // none) and reads the answer.
    const homeRules = await loadHomeBinRules(prisma, queryWarehouseId);

    // Map each line item with suggested home bin rule based on item-level brand and category
    const itemsWithSuggestions = shipment.lineItems.map((item) => {
      // Item/product level takes absolute priority; the shipment's own values are the fallback.
      const match = item.productId
        ? pickHomeBin(homeRules, {
            productId: item.productId,
            brandId: item.product?.brandId || shipment.brandId,
            categoryId: item.product?.categoryId || shipment.categoryId,
          })
        : null;

      let matchedRule: { type: string; label: string } | null = match
        ? { type: match.type, label: match.label }
        : null;

      const finalBin = match?.bin || item.product?.bin || null;
      if (!matchedRule && item.product?.bin) {
        matchedRule = { type: "product_default", label: "Product Default Bin" };
      }

      return {
        ...item,
        suggestedBin: finalBin,
        matchedRule,
      };
    });

    // Fetch units belonging to this shipment
    const units = await prisma.inventoryUnit.findMany({
      where: { inboundShipmentId: id },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        bin: { select: { id: true, code: true, name: true } },
      },
      orderBy: { unitCode: "asc" },
    });

    return successResponse({
      shipment: {
        id: shipment.id,
        shipmentNo: shipment.shipmentNo,
        brand: shipment.brand,
        category: shipment.category,
        putawayAt: shipment.putawayAt,
      },
      items: itemsWithSuggestions,
      units,
      warehouseId: queryWarehouseId ?? null,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("put-away details fetch failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch putaway details", 500);
  }
}

// POST: Execute put-away rounds (Round 1, Round 2...)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const user = await requireFeature("inbound", "approve");
    const body = await req.json();
    const { items, round = 1, warehouseId } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return errorResponse("No putaway items provided", 400);
    }

    const shipment = await prisma.inboundShipment.findUnique({
      where: { id },
      select: { id: true, shipmentNo: true },
    });
    if (!shipment) return errorResponse("Shipment not found", 404);

    let updatedCount = 0;
    let unitsPutAway = 0;

    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        const { lineItemId, binId, unitIds, quantity } = item;
        if (!binId) continue;

        const lineItem = await tx.inboundLineItem.findUnique({
          where: { id: lineItemId },
        });
        if (!lineItem) continue;

        const targetBin = await tx.bin.findUnique({
          where: { id: binId },
          select: { id: true, warehouseId: true, code: true },
        });
        if (!targetBin) continue;

        const effectiveWarehouseId = warehouseId || targetBin.warehouseId;

        // Update lineItem bin
        await tx.inboundLineItem.update({
          where: { id: lineItemId },
          data: { binId },
        });

        // If specific bicycle units were selected or exist for this lineItem
        if (lineItem.productId) {
          const moveQty = quantity || lineItem.deliveredQty || lineItem.quantity;

          // Put away specific units or all unassigned units for this shipment & product
          const unitsToUpdate =
            unitIds && unitIds.length > 0
              ? await tx.inventoryUnit.findMany({ where: { id: { in: unitIds } } })
              : await tx.inventoryUnit.findMany({
                  where: { inboundShipmentId: id, productId: lineItem.productId, binId: null },
                  take: moveQty,
                });

          if (unitsToUpdate.length > 0) {
            // ── ONE PLACEMENT HELPER (P6, P11) ──
            //
            // Refuses a no-assembly item into a bin that holds items needing assembly, stamps
            // the units when this bin is a no-assembly one, and recounts `BinStock` from the
            // units in both bins. The `BinStock` increment that used to sit below ran on TOP of
            // moving the units, so a recounted bin read double.
            await placeUnitsInBin(tx, unitsToUpdate.map((u) => u.id), binId);
            unitsPutAway += unitsToUpdate.length;

            for (const u of unitsToUpdate) {
              await tx.binMovementLog.create({
                data: {
                  warehouseId: effectiveWarehouseId,
                  unitId: u.id,
                  productId: lineItem.productId,
                  quantity: 1,
                  fromBinId: u.binId,
                  toBinId: binId,
                  reason: `Put-away round ${round} (${shipment.shipmentNo})`,
                  movedById: user.id,
                },
              });
            }
          } else {
            // No unit records: older loose stock, whose bin quantity is `BinStock` alone.
            await tx.binStock.upsert({
              where: { binId_productId: { binId, productId: lineItem.productId } },
              update: { quantity: { increment: moveQty } },
              create: { binId, productId: lineItem.productId, quantity: moveQty },
            });
            await tx.binMovementLog.create({
              data: {
                warehouseId: effectiveWarehouseId,
                productId: lineItem.productId,
                quantity: moveQty,
                fromBinId: null,
                toBinId: binId,
                reason: `Put-away round ${round} (${shipment.shipmentNo})`,
                movedById: user.id,
              },
            });
          }

          updatedCount++;
        }
      }

      await tx.inboundShipment.update({
        where: { id },
        data: {
          putawayAt: new Date(),
          putawayById: user.id,
        },
      });
      // A round can carry dozens of units, each with a movement log and a bin recount — past
      // Prisma's 5 s default.
    }, { timeout: 30_000 });

    log.info("put-away round completed", {
      shipmentId: id,
      round,
      lines: updatedCount,
      unitsPutAway,
      userId: user.id,
    });
    return successResponse({ updated: updatedCount, unitsPutAway, round });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof BinMoveRefused) {
      log.warn("put-away refused", { shipmentId: id, message: error.message });
      return errorResponse(error.message, 409);
    }
    log.error("put-away failed", {
      shipmentId: id,
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Putaway failed", 400);
  }
}
