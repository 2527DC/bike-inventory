export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { createLogger } from "@/lib/logger";
import { toAiErrorResponse, aiErrorKind } from "@/lib/ai";
import { poExtractRequestSchema } from "@/lib/validations";
import { parseQuotation, isSupportedQuotation, fileExtension } from "@/lib/po-extraction/parse";
import { matchExtractedRows } from "@/lib/po-extraction/matcher";
import { discardExtractions, loadExtraction, storeQuotationFile } from "@/lib/po-extraction/store";

const log = createLogger("purchase-orders:extract");

/**
 * Upload a vendor's quotation and turn it into review rows — plan 0909-po-ai-upload, P3.
 *
 * Multipart body: `file` + `vendorId`. The vendor is chosen BEFORE the upload (Q2): a PO goes
 * to one vendor, and the matcher's fuzzy phase is scoped to what that vendor supplies.
 *
 * Order of work, and why:
 *   1. the caller's earlier extractions are deleted FIRST (§5.1 "abandoned reviews"). There
 *      are no cron jobs, so this is what keeps one person from accumulating orphans: they
 *      never hold more than one open review, and an orphan is at most as old as their last
 *      upload;
 *   2. parse — Excel/CSV locally, PDF and images through AI (30–60 s, costs money);
 *   3. the extraction and its rows are written in ONE transaction, in file order;
 *   4. the matcher runs and the matches are written back; AUTO rows and confident FUZZY rows
 *      (≥ 0.85) are pre-selected, the rest are left for the person to decide;
 *   5. the file is stored best-effort so the review can show it. It is deleted with the rows.
 */
const PRESELECT_FUZZY_AT = 0.85;

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("purchase_orders", "create");
    const canSeeCost = await userCan(user.id, "cost_price", "view");

    const formData = await req.formData();
    const file = formData.get("file");
    const parsedFields = poExtractRequestSchema.safeParse({ vendorId: formData.get("vendorId") });
    if (!parsedFields.success) return errorResponse("Vendor is required", 400);
    const { vendorId } = parsedFields.data;

    if (!(file instanceof File) || file.size === 0) return errorResponse("No file uploaded", 400);
    if (!isSupportedQuotation(file.name)) {
      return errorResponse("Unsupported file type. Upload Excel (.xlsx/.xls/.csv), PDF, or an image (.png/.jpg/.webp)", 400);
    }

    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, isActive: true } });
    if (!vendor) return errorResponse("Vendor not found", 404);
    if (!vendor.isActive) return errorResponse("This vendor is inactive. Reactivate it before raising an order.", 400);

    // 1. one open review per person
    const replaced = await discardExtractions({ createdById: user.id });
    if (replaced.length > 0) log.info("earlier extractions replaced", { userId: user.id, replaced });

    // 2. parse
    const fileName = file.name;
    const fileType = fileExtension(fileName);
    const bytes = await file.arrayBuffer();
    log.debug("extracting quotation", { vendorId, fileType, bytes: bytes.byteLength });

    let parsed;
    try {
      parsed = await parseQuotation(bytes, fileName);
    } catch (e) {
      // AiError / AiNotConfiguredError get their own status (501 "Settings → AI", 502/503 by
      // kind) before the generic 400. The parser already logged the failing document.
      const aiRes = toAiErrorResponse(e);
      if (aiRes) return aiRes;
      log.warn("quotation parse failed", { vendorId, fileType, kind: aiErrorKind(e), message: e instanceof Error ? e.message : String(e) });
      return errorResponse(e instanceof Error ? e.message : "Could not read the file", 400);
    }
    if (parsed.items.length === 0) {
      return errorResponse("No product rows were found in this file", 400);
    }

    // 3. rows, in one transaction
    const extraction = await prisma.$transaction(async (tx) => {
      const row = await tx.poExtraction.create({
        data: {
          vendorId,
          fileName,
          fileType,
          source: parsed.source,
          aiModel: parsed.aiModel,
          totalItems: parsed.items.length,
          createdById: user.id,
        },
      });
      await tx.poExtractionItem.createMany({
        data: parsed.items.map((it, index) => ({
          extractionId: row.id,
          rawName: it.rawName,
          rawSku: it.rawSku,
          rawCategory: it.rawCategory,
          rawSize: it.rawSize,
          qty: it.brandAvailableQty > 0 ? it.brandAvailableQty : null,
          price: it.brandPrice,
          mrp: it.brandMrp,
          sortOrder: index,
        })),
      });
      return row;
    });

    // 4. match, then write the matches back
    const items = await prisma.poExtractionItem.findMany({
      where: { extractionId: extraction.id },
      select: { id: true, rawSku: true, rawName: true },
    });
    const matches = await matchExtractedRows(items, vendorId);

    await prisma.$transaction(async (tx) => {
      for (const m of matches) {
        await tx.poExtractionItem.update({
          where: { id: m.itemId },
          data: {
            productId: m.productId,
            matchStatus: m.status,
            matchConfidence: m.confidence,
            selected: m.status === "AUTO" || m.confidence >= PRESELECT_FUZZY_AT,
          },
        });
      }
      await tx.poExtraction.update({ where: { id: extraction.id }, data: { matchedItems: matches.length } });
    });

    // 5. the file, best effort
    const fileUrl = await storeQuotationFile(extraction.id, fileName, fileType, bytes);
    if (fileUrl) await prisma.poExtraction.update({ where: { id: extraction.id }, data: { fileUrl } });

    log.info("quotation extracted", {
      extractionId: extraction.id,
      vendorId,
      source: parsed.source,
      totalItems: parsed.items.length,
      matchedItems: matches.length,
    });

    const view = await loadExtraction(extraction.id, user.id, canSeeCost);
    return successResponse(view, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("quotation extraction failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Could not extract the quotation", 500);
  }
}
