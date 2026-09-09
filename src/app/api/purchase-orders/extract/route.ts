export const dynamic = "force-dynamic";
// The column step is an AI call (~10 s) and a PDF read can take 30–60 s. 60 is what the send
// route declares and what every Vercel plan allows.
export const maxDuration = 60;

import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { toAiErrorResponse, aiErrorKind } from "@/lib/ai";
import { tryGetStorage } from "@/lib/storage";
import { poExtractRequestSchema } from "@/lib/validations";
import { parseQuotation, fileExtension, AI_EXTENSIONS } from "@/lib/po-extraction/parse";
import { proposeColumns, sanitizeHint, SHEET_EXTENSIONS } from "@/lib/po-extraction/sheet";
import { discardExtractions, loadExtraction, storeQuotationFile } from "@/lib/po-extraction/store";

const log = createLogger("purchase-orders:extract");

/**
 * Upload a vendor's file and start a review — plan 0909-po-sheet-ai-extraction-and-
 * catalogue-free-lines, §3.2 / P2.
 *
 * Multipart body: `file` + `vendorId` + optional `hint`. The vendor is chosen BEFORE the
 * upload (Q11): a PO goes to one vendor and the sheet is uploaded against it.
 *
 * Two kinds of file, two different answers:
 *
 *   SHEET (xlsx / xls / csv) — the hybrid path (D1). The model reads the header area of every
 *   sheet and proposes a role per column; the extraction is created at stage "columns" with
 *   NO rows. The person confirms on `POST /extract/[id]/columns`, which re-reads the stored
 *   workbook and extracts every row deterministically, with its fill colour. That re-read is
 *   why a sheet upload REQUIRES a storage provider: the workbook is not kept in the database.
 *
 *   PDF / IMAGE — today's whole-document AI read, unchanged. Rows are written at once, at
 *   stage "review", with a fixed set of columns so the same review renders them.
 *
 * Order of work, and why:
 *   1. every refusal that needs no work — vendor, extension, hint, storage — comes BEFORE the
 *      caller's earlier extraction is deleted, so a bad upload does not wipe a good review;
 *   2. the caller's earlier extractions are deleted (§3.3 "abandoned reviews"). There are no
 *      cron jobs, so this is what keeps one person from accumulating orphans;
 *   3. the AI call (column proposal or PDF read), then the row(s) in one transaction;
 *   4. the file is stored. Best-effort for a PDF; mandatory for a sheet (see above).
 *
 * The hint is never logged — only its length (§3.6).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("purchase_orders", "create");

    const formData = await req.formData();
    const file = formData.get("file");
    const rawHint = formData.get("hint");
    const parsedFields = poExtractRequestSchema.safeParse({
      vendorId: formData.get("vendorId"),
      hint: typeof rawHint === "string" ? rawHint : undefined,
    });
    if (!parsedFields.success) {
      return errorResponse(parsedFields.error.issues[0]?.message ?? "Vendor is required", 400);
    }
    const { vendorId } = parsedFields.data;

    if (!(file instanceof File) || file.size === 0) return errorResponse("No file uploaded", 400);
    const fileName = file.name;
    const fileType = fileExtension(fileName);
    const isSheet = SHEET_EXTENSIONS.includes(fileType);
    const isDocument = (AI_EXTENSIONS as readonly string[]).includes(fileType);
    if (!isSheet && !isDocument) {
      return errorResponse("Unsupported file type. Upload a sheet (.xlsx/.xls/.csv), a PDF, or an image (.png/.jpg/.webp)", 400);
    }

    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, isActive: true } });
    if (!vendor) return errorResponse("Vendor not found", 404);
    if (!vendor.isActive) return errorResponse("This vendor is inactive. Reactivate it before raising an order.", 400);

    // The hint is data for the model, never an instruction. `sanitizeHint` strips it and
    // refuses one that still reads like an instruction (§3.6) — refused before anything is
    // sent, and logged by length only.
    const { hint, refused } = sanitizeHint(parsedFields.data.hint);
    if (refused) {
      log.warn("hint refused", { userId: user.id, vendorId, length: parsedFields.data.hint?.length ?? 0 });
      return errorResponse(refused, 400);
    }

    // A sheet must be re-read at the column step, so its file has to land somewhere.
    if (isSheet && !(await tryGetStorage())) {
      log.warn("sheet upload refused", { userId: user.id, vendorId, reason: "storage not configured" });
      return errorResponse("Storage must be configured for sheet uploads (Settings → Storage)", 400);
    }

    // One open review per person — but the earlier one is discarded only once the new file
    // has been read successfully (inside proposeSheet / readDocument, just before the insert),
    // so a failed AI call does not leave the person with nothing (review finding 6, 9 Sep 2026).
    const bytes = await file.arrayBuffer();
    log.debug("extracting upload", { vendorId, fileType, bytes: bytes.byteLength, hintLength: hint?.length ?? 0, path: isSheet ? "sheet" : "document" });

    if (isSheet) return await proposeSheet({ userId: user.id, vendorId, fileName, fileType, bytes, hint });
    return await readDocument({ userId: user.id, vendorId, fileName, fileType, bytes });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("extraction failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Could not read the file", 500);
  }
}

interface UploadArgs {
  userId: string;
  vendorId: string;
  fileName: string;
  fileType: string;
  bytes: ArrayBuffer;
}

/** The sheet path: the AI names the columns; no rows yet. */
async function proposeSheet({ userId, vendorId, fileName, fileType, bytes, hint }: UploadArgs & { hint: string | null }) {
  let proposal;
  try {
    proposal = await proposeColumns(bytes, fileName, hint);
  } catch (e) {
    // AiError / AiNotConfiguredError get their own status (501 "Settings → AI", 502/503 by
    // kind) before the generic 400. sheet.ts already logged the failing workbook.
    const aiRes = toAiErrorResponse(e);
    if (aiRes) return aiRes;
    log.warn("column proposal failed", { vendorId, fileType, kind: aiErrorKind(e), message: e instanceof Error ? e.message : String(e) });
    return errorResponse(e instanceof Error ? e.message : "Could not read the sheet", 400);
  }
  if (proposal.sheets.length === 0) {
    return errorResponse("No sheet with rows was found in this file", 400);
  }

  const replaced = await discardExtractions({ createdById: userId });
  if (replaced.length > 0) log.info("earlier extractions replaced", { userId, replaced });

  const extraction = await prisma.poExtraction.create({
    data: {
      vendorId,
      fileName,
      fileType,
      source: "sheet",
      aiModel: proposal.aiModel,
      totalItems: 0,
      createdById: userId,
      stage: "columns",
      columnRoles: proposal.sheets as unknown as Prisma.InputJsonValue,
      legend: proposal.legend as unknown as Prisma.InputJsonValue,
      hint,
    },
    select: { id: true },
  });

  // Mandatory here: the column step reads this file back. Storage was checked before the
  // AI call, so a null now is a failed write, not a missing provider.
  const fileUrl = await storeQuotationFile(extraction.id, fileName, fileType, bytes);
  if (!fileUrl) {
    await prisma.poExtraction.delete({ where: { id: extraction.id } });
    log.error("sheet not stored", { extractionId: extraction.id, vendorId, fileType });
    return errorResponse("The sheet could not be stored. Check Settings → Storage and upload it again.", 500);
  }
  await prisma.poExtraction.update({ where: { id: extraction.id }, data: { fileUrl } });

  log.info("sheet columns proposed", {
    extractionId: extraction.id,
    vendorId,
    sheets: proposal.sheets.length,
    legend: proposal.legend.length,
    model: proposal.aiModel,
  });

  const view = await loadExtraction(extraction.id, userId);
  return successResponse(view, 201);
}

/** The PDF / image path: the whole document goes to the model; rows are written at once. */
async function readDocument({ userId, vendorId, fileName, fileType, bytes }: UploadArgs) {
  let parsed;
  try {
    parsed = await parseQuotation(bytes, fileName);
  } catch (e) {
    const aiRes = toAiErrorResponse(e);
    if (aiRes) return aiRes;
    log.warn("document parse failed", { vendorId, fileType, kind: aiErrorKind(e), message: e instanceof Error ? e.message : String(e) });
    return errorResponse(e instanceof Error ? e.message : "Could not read the file", 400);
  }
  if (parsed.items.length === 0) {
    return errorResponse("No product rows were found in this file", 400);
  }

  const replaced = await discardExtractions({ createdById: userId });
  if (replaced.length > 0) log.info("earlier extractions replaced", { userId, replaced });

  const money = (v: number | null) => (v === null || v === undefined ? "" : String(v));

  const extraction = await prisma.$transaction(async (tx) => {
    const row = await tx.poExtraction.create({
      data: {
        vendorId,
        fileName,
        fileType,
        source: "ai",
        aiModel: parsed.aiModel,
        totalItems: parsed.items.length,
        createdById: userId,
        stage: "review",
      },
      select: { id: true },
    });
    await tx.poExtractionItem.createMany({
      data: parsed.items.map((it, index) => ({
        extractionId: row.id,
        rawName: it.rawName,
        qty: it.brandAvailableQty > 0 ? it.brandAvailableQty : null,
        sheetName: null,
        rowIndex: null,
        rowColor: null,
        // A fixed column set so the dynamic review renders a PDF the same way it renders a
        // sheet. Only rawName and qty reach the PO line (D2).
        columns: [
          { header: "Item", value: it.rawName },
          { header: "Code", value: it.rawSku ?? "" },
          { header: "Price", value: money(it.brandPrice) },
          { header: "MRP", value: money(it.brandMrp) },
          { header: "Size", value: it.rawSize ?? "" },
        ] as unknown as Prisma.InputJsonValue,
        selected: false,
        sortOrder: index,
      })),
    });
    return row;
  });

  // Best effort for a document: the rows are what the review needs.
  const fileUrl = await storeQuotationFile(extraction.id, fileName, fileType, bytes);
  if (fileUrl) await prisma.poExtraction.update({ where: { id: extraction.id }, data: { fileUrl } });

  log.info("document extracted", {
    extractionId: extraction.id,
    vendorId,
    source: "ai",
    totalItems: parsed.items.length,
    model: parsed.aiModel,
  });

  const view = await loadExtraction(extraction.id, userId);
  return successResponse(view, 201);
}
