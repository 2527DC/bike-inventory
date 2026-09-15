export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { poExtractionSelectSchema } from "@/lib/validations";
import { PRICED_ROW } from "@/lib/po-extraction/store";

const log = createLogger("purchase-orders:extract");

type Ctx = { params: Promise<{ id: string }> };

/**
 * Tick or untick many rows at once — "Select all shown" on a 400-row review (plan 0909,
 * §3.5). Body: `{ itemIds: string[], selected: boolean }`; answers the new selected count.
 *
 * The update is scoped to rows of THIS extraction owned by THIS caller, so an id from
 * somebody else's review in the list is simply not matched — never an error, never a write.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireFeature("purchase_orders", "create");
    const { id } = await params;

    const parsed = poExtractionSelectSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request", 400);
    const { itemIds, selected } = parsed.data;

    const extraction = await prisma.poExtraction.findFirst({
      where: { id, createdById: user.id },
      select: { id: true },
    });
    if (!extraction) return errorResponse("Extraction not found", 404);

    const { updated, selectedCount } = await prisma.$transaction(async (tx) => {
      const res = await tx.poExtractionItem.updateMany({
        // Ticking skips a row with no price in the sheet (plan 1509, R5); unticking clears any.
        where: { extractionId: id, id: { in: itemIds }, ...(selected ? PRICED_ROW : {}) },
        data: { selected },
      });
      const count = await tx.poExtractionItem.count({ where: { extractionId: id, selected: true } });
      return { updated: res.count, selectedCount: count };
    });

    const skipped = itemIds.length - updated;
    log.info("extraction rows selected", { extractionId: id, requested: itemIds.length, updated, skipped, selected, selectedCount });
    return successResponse({ selectedCount, skipped });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("extraction select failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Could not update the rows", 500);
  }
}
