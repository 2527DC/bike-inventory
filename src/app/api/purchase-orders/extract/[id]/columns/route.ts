export const dynamic = "force-dynamic";
// The rescue read sends the whole sheet to the model — 30–60 s on a 400-row workbook. 60 is
// what the send route declares and what every Vercel plan allows.
export const maxDuration = 60;

import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { toAiErrorResponse, aiErrorKind } from "@/lib/ai";
import { poExtractionColumnsSchema } from "@/lib/validations";
import { extractRows, extractRowsWithAi, type ExtractedRow } from "@/lib/po-extraction/sheet";
import { loadExtraction, readLegend, readQuotationFile } from "@/lib/po-extraction/store";

const log = createLogger("purchase-orders:extract");

type Ctx = { params: Promise<{ id: string }> };

/**
 * The person has confirmed which column is what — extract the rows (plan 0909, §3.2 step 4).
 *
 * Body: `{ sheets: SheetColumnsConfirm[], rescue?: boolean }`. The normal path is
 * deterministic: `extractRows` reads every row below each sheet's header with the fill colour
 * of its item-name cell, no AI, no row cap. `rescue: true` is step 5 — the whole sheet goes to
 * the model and rows come back without colours; the review says so through `source: "ai"`.
 *
 * The workbook is read back from the file store: it is not kept in the database, and the
 * upload refused the sheet if storage was not configured. A file that has since gone (the
 * provider was switched, the object deleted) answers with a sentence asking for a fresh
 * upload — the extraction is scratch, re-uploading costs nothing.
 *
 * Reopening "Columns" on a review that already has rows is allowed: the rows are replaced,
 * every one unselected, in the same transaction that flips the stage. A person ticks rows
 * after seeing them, never before (every extracted row is `selected: false`).
 *
 * Owner-only — somebody else's extraction is a 404, so the id is not worth confirming.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireFeature("purchase_orders", "create");
    const { id } = await params;

    const parsed = poExtractionColumnsSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request", 400);
    const { sheets, rescue } = parsed.data;

    const extraction = await prisma.poExtraction.findFirst({
      where: { id, createdById: user.id },
      select: { id: true, fileName: true, fileType: true, fileUrl: true, source: true, legend: true },
    });
    if (!extraction) return errorResponse("Extraction not found", 404);
    if (!extraction.fileUrl) {
      // A PDF whose file was not stored, or a sheet from before this route existed.
      log.warn("columns confirmed with no stored file", { extractionId: id });
      return errorResponse("This upload has no stored file to read. Upload the sheet again.", 400);
    }

    const bytes = await readQuotationFile(id, extraction.fileUrl);
    if (!bytes) {
      return errorResponse("The uploaded sheet could not be read back. Upload it again.", 400);
    }

    const legend = readLegend(extraction.legend);
    let rows: ExtractedRow[];
    let aiModel: string | null = null;
    // What columnRoles is set to: the echoed sheets (headers + preview) on the deterministic
    // path; on the rescue path the roles are left as they were.
    let storedSheets: unknown = undefined;
    try {
      if (rescue) {
        const out = await extractRowsWithAi(bytes, extraction.fileName);
        rows = out.rows;
        aiModel = out.aiModel;
      } else {
        const out = extractRows(bytes, extraction.fileName, sheets, legend);
        rows = out.rows;
        // The echoed sheets carry headers, preview and row estimate — what "Reopen columns"
        // and a refresh render. Storing the bare request body instead left them blank
        // (review finding 2, 9 Sep 2026).
        storedSheets = out.sheets;
      }
    } catch (e) {
      // The rescue path is an AI call: 501 "Settings → AI", 502/503 by kind, before the
      // generic 400. sheet.ts already logged the failing workbook.
      const aiRes = toAiErrorResponse(e);
      if (aiRes) return aiRes;
      log.warn("row extraction failed", { extractionId: id, rescue: Boolean(rescue), kind: aiErrorKind(e), message: e instanceof Error ? e.message : String(e) });
      return errorResponse(e instanceof Error ? e.message : "Could not extract the rows", 400);
    }
    if (rows.length === 0) {
      return errorResponse("No item rows were found below the header. Check the header row and the item-name column.", 400);
    }

    await prisma.$transaction(async (tx) => {
      await tx.poExtractionItem.deleteMany({ where: { extractionId: id } });
      await tx.poExtractionItem.createMany({
        data: rows.map((r) => ({
          extractionId: id,
          rawName: r.name,
          qty: r.quantity,
          sheetName: r.sheetName,
          rowIndex: r.rowIndex,
          rowColor: r.rowColor,
          columns: r.columns as unknown as Prisma.InputJsonValue,
          selected: false,
          sortOrder: r.sortOrder,
        })),
      });
      await tx.poExtraction.update({
        where: { id },
        data: {
          stage: "review",
          ...(storedSheets !== undefined ? { columnRoles: storedSheets as Prisma.InputJsonValue } : {}),
          totalItems: rows.length,
          source: rescue ? "ai" : "sheet",
          ...(aiModel ? { aiModel } : {}),
        },
      });
    });

    log.info("sheet rows extracted", {
      extractionId: id,
      sheets: rescue ? new Set(rows.map((r) => r.sheetName)).size : sheets.length,
      rows: rows.length,
      rescue: Boolean(rescue),
      model: aiModel,
    });

    const view = await loadExtraction(id, user.id);
    return successResponse(view);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("column confirm failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Could not extract the rows", 500);
  }
}
