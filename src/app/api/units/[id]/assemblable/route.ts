export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("units:assemblable");

/**
 * Clear one unit's non-assemblable stamp (plan 1709, P6b).
 *
 * P6 is deliberately one-way: a stamped unit cannot be moved into a bin that holds items
 * needing assembly, so a cycle put into a no-assembly bin by mistake would be stuck there and
 * off the build line for good. This is the correction — one unit at a time, a reason required,
 * written to the activity log because it overrides a rule the rest of the build enforces.
 *
 * It clears the stamp and nothing else. The unit stays where it is and shows on the build line
 * again; moving it to a normal bin is now allowed and is a separate, logged action. Note that
 * putting it back into a no-assembly bin re-stamps it — the stamp follows the bin (P6).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireFeature("bins", "edit");
    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason) return errorResponse("Say why this item needs assembly after all", 400);

    const unit = await prisma.inventoryUnit.findUnique({
      where: { id },
      select: {
        id: true,
        unitCode: true,
        status: true,
        binId: true,
        nonAssemblable: true,
        bin: { select: { id: true, code: true, nonAssemblable: true } },
        product: { select: { id: true, name: true, sku: true } },
      },
    });
    if (!unit) return errorResponse("That item no longer exists", 404);
    if (!unit.nonAssemblable) {
      return errorResponse(`${unit.unitCode} is already marked as needing assembly`, 400);
    }
    if (["SOLD", "LOST", "RESET"].includes(unit.status)) {
      return errorResponse(`${unit.unitCode} is ${unit.status.toLowerCase()} and cannot be changed`, 400);
    }

    await prisma.$transaction(async (tx) => {
      await tx.inventoryUnit.update({ where: { id }, data: { nonAssemblable: false } });
      await logActivity(tx, {
        module: "bins",
        action: "updated",
        entityType: "InventoryUnit",
        entityId: unit.id,
        entityRef: unit.unitCode,
        fromValue: "No assembly",
        toValue: "Needs assembly",
        details: reason,
        userId: user.id,
        userName: user.name,
      });
    });

    log.info("unit marked assemblable", {
      unitId: unit.id,
      unitCode: unit.unitCode,
      productId: unit.product.id,
      binId: unit.binId,
      userId: user.id,
    });

    return successResponse({
      id: unit.id,
      unitCode: unit.unitCode,
      nonAssemblable: false,
      // The bin it is still in says "no assembly" — the screen warns, because moving it back in
      // after a trip to a normal bin would stamp it again.
      stillInNoAssemblyBin: unit.bin?.nonAssemblable === true ? unit.bin.code : null,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("mark assemblable failed", {
      unitId: id,
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to update the item", 400);
  }
}
