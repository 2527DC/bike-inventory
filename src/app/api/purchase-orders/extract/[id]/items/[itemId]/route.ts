export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { poExtractionItemPatchSchema } from "@/lib/validations";
import { readLegend, serializeItem } from "@/lib/po-extraction/store";

const log = createLogger("purchase-orders:extract");

type Ctx = { params: Promise<{ id: string; itemId: string }> };

/**
 * Tick or untick one review row. Body: `{ selected: boolean }` — nothing else. The product
 * match and the order quantity the old PATCH accepted are gone (plan 0909, D2/Q10): a row is
 * what the sheet said, and Qty is typed on the line after "Use selected".
 *
 * Answers the row and the extraction's selected count in one round trip, so the header the
 * review shows never disagrees with its rows.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireFeature("purchase_orders", "create");
    const { id, itemId } = await params;

    const parsed = poExtractionItemPatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request", 400);
    const { selected } = parsed.data;

    const item = await prisma.poExtractionItem.findFirst({
      where: { id: itemId, extractionId: id, extraction: { createdById: user.id } },
      select: { id: true, extraction: { select: { legend: true } } },
    });
    if (!item) return errorResponse("Extraction row not found", 404);

    const { row, selectedCount } = await prisma.$transaction(async (tx) => {
      const updated = await tx.poExtractionItem.update({ where: { id: itemId }, data: { selected } });
      const count = await tx.poExtractionItem.count({ where: { extractionId: id, selected: true } });
      return { row: updated, selectedCount: count };
    });

    log.debug("extraction row updated", { extractionId: id, itemId, selected, selectedCount });
    return successResponse({ item: serializeItem(row, readLegend(item.extraction.legend)), selectedCount });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("extraction row update failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Could not update the row", 500);
  }
}
