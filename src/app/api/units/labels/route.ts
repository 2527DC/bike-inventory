export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// nodejs, explicitly: bwip-js draws the barcodes into a Node Buffer.

import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { generateBarcodePng } from "@/lib/barcode";
import { createLogger } from "@/lib/logger";

const log = createLogger("units:labels");

/**
 * The label sheet's data (R46).
 *
 * Every physical item has its own code (`U-000086`) and that code goes on a label stuck to the
 * product, so the label must carry the code as a scannable Code 128 barcode as well as in
 * print. The barcodes are rendered HERE, in one request, rather than the page firing 500
 * separate `/api/barcode` calls the way `stock/[id]/barcode` does.
 *
 * Three ways to ask, matching the three places a sheet is wanted:
 *   `?unitIds=a,b,c`          — the codes just generated (R41) or one unit reprinted
 *   `?binId=…`                — everything on one shelf
 *   `?inboundShipmentId=…`    — everything that arrived on one shipment (the link on inbound)
 */

const MAX_LABELS = 500;

export async function GET(req: NextRequest) {
  try {
    await requireFeature("barcode", "create");

    const { searchParams } = new URL(req.url);
    const unitIdsParam = searchParams.get("unitIds");
    const binId = searchParams.get("binId");
    const inboundShipmentId = searchParams.get("inboundShipmentId");

    const unitIds = unitIdsParam
      ? [...new Set(unitIdsParam.split(",").map((s) => s.trim()).filter(Boolean))]
      : [];

    let where: Prisma.InventoryUnitWhereInput;
    if (unitIds.length > 0) {
      if (unitIds.length > MAX_LABELS) {
        return errorResponse(`Print at most ${MAX_LABELS} labels at a time (${unitIds.length} asked for)`, 400);
      }
      where = { id: { in: unitIds } };
    } else if (binId) {
      where = { binId };
    } else if (inboundShipmentId) {
      where = { inboundShipmentId };
    } else {
      return errorResponse("Say which labels to print: unitIds, binId or inboundShipmentId", 400);
    }

    const total = await prisma.inventoryUnit.count({ where });
    if (total > MAX_LABELS) {
      return errorResponse(
        `That is ${total} labels. Print at most ${MAX_LABELS} at a time — narrow it down to one bin or one shipment.`,
        400
      );
    }

    const units = await prisma.inventoryUnit.findMany({
      where,
      select: {
        id: true,
        unitCode: true,
        nonAssemblable: true,
        status: true,
        bin: { select: { id: true, code: true, name: true } },
        product: { select: { id: true, name: true, sku: true, brand: { select: { name: true } } } },
      },
      orderBy: { unitCode: "asc" },
    });

    // One failed barcode must not lose the whole sheet: that label prints its code in text only.
    const labels = await Promise.all(
      units.map(async (unit) => {
        let barcode: string | null = null;
        try {
          barcode = await generateBarcodePng({ text: unit.unitCode, type: "code128", scale: 3, height: 10 });
        } catch (error) {
          log.warn("barcode render failed for one unit", {
            unitId: unit.id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return {
          id: unit.id,
          unitCode: unit.unitCode,
          productName: unit.product.name,
          sku: unit.product.sku,
          brand: unit.product.brand?.name ?? null,
          binCode: unit.bin?.code ?? null,
          nonAssemblable: unit.nonAssemblable,
          status: unit.status,
          barcode,
        };
      })
    );

    log.info("unit labels prepared", {
      count: labels.length,
      binId: binId ?? null,
      inboundShipmentId: inboundShipmentId ?? null,
      byIds: unitIds.length,
      failedBarcodes: labels.filter((l) => !l.barcode).length,
    });

    return successResponse({ labels, total: labels.length });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("unit labels failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to prepare the labels", 500);
  }
}
