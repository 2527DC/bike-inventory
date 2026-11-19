export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { toAiErrorResponse, aiErrorKind } from "@/lib/ai";
import { parseVendorInvoiceWithAI } from "@/lib/invoice-extraction/parse";

const log = createLogger("purchase-orders:invoice-extract");

export async function POST(req: NextRequest) {
  try {
    await requireFeature("purchase_orders", "create");

    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return errorResponse("No invoice file uploaded", 400);
    }

    const lowerName = file.name.toLowerCase();
    const allowed = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];
    if (!allowed.some((ext) => lowerName.endsWith(ext))) {
      return errorResponse("Unsupported file type. Please upload a PDF or an invoice image (.png, .jpg, .webp).", 400);
    }

    const bytes = await file.arrayBuffer();
    log.debug("starting AI invoice extraction", { fileName: file.name, bytes: bytes.byteLength });

    let extracted;
    try {
      extracted = await parseVendorInvoiceWithAI(bytes, file.name);
    } catch (e) {
      const aiRes = toAiErrorResponse(e);
      if (aiRes) return aiRes;
      log.warn("invoice extraction failed", { fileName: file.name, kind: aiErrorKind(e), message: e instanceof Error ? e.message : String(e) });
      return errorResponse(e instanceof Error ? e.message : "Could not read the invoice file with AI", 400);
    }

    // 1. Resolve matching vendor in our database
    let matchedVendor = null;
    const gstin = extracted.vendor.gstin?.trim();
    if (gstin && gstin.length >= 10) {
      matchedVendor = await prisma.vendor.findFirst({
        where: {
          OR: [
            { gstin: { equals: gstin, mode: "insensitive" } },
            // In case of slight state code variation or PAN match (first 10 chars of GSTIN)
            { gstin: { contains: gstin.slice(2, 12), mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true, gstin: true, zohoVendorId: true },
      });
    }

    if (!matchedVendor && extracted.vendor.name) {
      const vName = extracted.vendor.name.trim();
      matchedVendor = await prisma.vendor.findFirst({
        where: {
          OR: [
            { name: { equals: vName, mode: "insensitive" } },
            { name: { contains: vName.slice(0, 10), mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true, gstin: true, zohoVendorId: true },
      });
    }

    // 2. Try matching line items with existing catalog products
    const productNames = extracted.lineItems.map((li) => li.name).filter(Boolean);
    const existingProducts = productNames.length > 0 ? await prisma.product.findMany({
      where: {
        OR: [
          ...productNames.map((name) => ({ name: { contains: name.slice(0, 15), mode: "insensitive" as const } })),
          ...extracted.lineItems
            .map((li) => li.name.split(" ")[0])
            .filter((firstWord) => firstWord.length > 3)
            .map((word) => ({ name: { contains: word, mode: "insensitive" as const } })),
        ],
      },
      select: { id: true, name: true, sku: true },
      take: 50,
    }) : [];

    const enrichedLineItems = extracted.lineItems.map((li) => {
      const match = existingProducts.find((p) => {
        const pName = p.name.toLowerCase();
        const liName = li.name.toLowerCase();
        return pName === liName || liName.includes(pName) || pName.includes(liName);
      });

      return {
        ...li,
        matchedProductId: match ? match.id : null,
        matchedProductName: match ? match.name : null,
      };
    });

    // Convert bytes to base64 so client can carry it for Zoho attachment on submit
    const fileBase64 = Buffer.from(bytes).toString("base64");

    return successResponse({
      ...extracted,
      lineItems: enrichedLineItems,
      matchedVendor: matchedVendor || null,
      fileBase64,
      fileName: file.name,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("invoice extract route error", { error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to process invoice", 500);
  }
}
