export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

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

    // Fetch all home bin rules for active warehouse(s)
    const homeRules = await prisma.homeBinRule.findMany({
      where: queryWarehouseId
        ? { warehouseId: queryWarehouseId, warehouse: { isActive: true } }
        : { warehouse: { isActive: true } },
      include: {
        bin: { select: { id: true, code: true, name: true, directions: true, isAssemblyArea: true, warehouse: { select: { id: true, name: true, kind: true } } } },
      },
    });

    // Map each line item with suggested home bin rule based on item-level brand and category
    const itemsWithSuggestions = shipment.lineItems.map((item) => {
      let suggestedBin = null;
      let matchedRule: { type: string; label: string } | null = null;

      if (item.productId) {
        // Resolve item brand and category: item/product level takes absolute priority
        const itemBrandId = item.product?.brandId || shipment.brandId;
        const itemCategoryId = item.product?.categoryId || shipment.categoryId;

        // 1. Check direct product rule
        const prodRule = homeRules.find((r) => r.productId === item.productId);
        if (prodRule) {
          suggestedBin = prodRule.bin;
          matchedRule = { type: "product", label: "Product Rule" };
        } else {
          // 2. Check brand + category rule
          const brandCatRule = homeRules.find(
            (r) => r.brandId && r.categoryId && r.brandId === itemBrandId && r.categoryId === itemCategoryId
          );
          if (brandCatRule) {
            suggestedBin = brandCatRule.bin;
            matchedRule = { type: "brand_category", label: "Brand + Category Rule" };
          } else {
            // 3. Check category-only rule (where rule has no specific brand restriction)
            const catRule = itemCategoryId
              ? homeRules.find((r) => !r.brandId && r.categoryId === itemCategoryId)
              : null;
            if (catRule) {
              suggestedBin = catRule.bin;
              matchedRule = { type: "category", label: "Category Rule" };
            } else {
              // 4. Check brand-only rule (where rule has no specific category restriction)
              const brandRule = itemBrandId
                ? homeRules.find((r) => r.brandId === itemBrandId && !r.categoryId)
                : null;
              if (brandRule) {
                suggestedBin = brandRule.bin;
                matchedRule = { type: "brand", label: "Brand Rule" };
              }
            }
          }
        }
      }

      const finalBin = suggestedBin || item.product?.bin || null;
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
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch putaway details", 500);
  }
}

// POST: Execute put-away rounds (Round 1, Round 2...)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireFeature("inbound", "approve");
    const { id } = await params;
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

          for (const u of unitsToUpdate) {
            await tx.inventoryUnit.update({
              where: { id: u.id },
              data: { binId, status: "PUT_AWAY" },
            });
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

          // Update BinStock
          await tx.binStock.upsert({
            where: { binId_productId: { binId, productId: lineItem.productId } },
            update: { quantity: { increment: moveQty } },
            create: { binId, productId: lineItem.productId, quantity: moveQty },
          });

          // Log movement for bulk loose products if no units existed
          if (unitsToUpdate.length === 0) {
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
    });

    return successResponse({ updated: updatedCount, round });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Putaway failed", 400);
  }
}
