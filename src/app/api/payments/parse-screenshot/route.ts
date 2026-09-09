export const dynamic = "force-dynamic";
// runAi's retry policy is three attempts with 3 s + 6 s sleeps between them; two 529s already exceed 30 s.
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { runAi, toAiErrorResponse, aiErrorKind } from "@/lib/ai";

const log = createLogger("payments:parse-screenshot");

// POST — Parse payment screenshot with the shared AI client (vision)
export async function POST(req: NextRequest) {
  try {
    await requireFeature("bills", "create");

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return errorResponse("No file uploaded", 400);

    // Validate file type
    const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!validTypes.includes(file.type)) {
      return errorResponse("Only PNG, JPEG, or WebP images are supported", 400);
    }

    // Convert to base64
    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const mediaType = file.type as "image/png" | "image/jpeg" | "image/webp";

    // Fetch vendor names for matching
    const vendors = await prisma.vendor.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    });

    const vendorList = vendors.map((v) => `${v.name} (${v.code})`).join(", ");

    const prompt = `You are a payment receipt/screenshot parser for a bicycle store called Bharath Cycle Hub.

Analyze this payment confirmation screenshot (UPI, NEFT, RTGS, IMPS, bank transfer, or cheque photo) and extract:

1. **amount** — The payment amount (number, no currency symbol)
2. **paymentMode** — One of: CASH, CHEQUE, NEFT, RTGS, UPI, IMPS (infer from screenshot type)
3. **referenceNo** — UTR number, transaction ID, cheque number, or reference number
4. **paymentDate** — Date in YYYY-MM-DD format
5. **vendorName** — The beneficiary/receiver name (who was paid)
6. **payerName** — The sender/payer name (who paid)
7. **bankName** — Bank name visible in the screenshot
8. **notes** — Any other relevant details (account numbers, remarks, etc.)

KNOWN VENDORS (try to match vendorName to one of these):
${vendorList}

Return ONLY valid JSON, no markdown, no explanation:
{
  "amount": 12345.00,
  "paymentMode": "UPI",
  "referenceNo": "UTR123456789",
  "paymentDate": "2026-04-22",
  "vendorName": "extracted beneficiary name",
  "matchedVendor": "closest matching vendor from the list above, or null if no match",
  "payerName": "sender name",
  "bankName": "bank name",
  "notes": "any extra details"
}

If a field cannot be determined, use null. Always try to extract at least amount and referenceNo.`;

    log.debug("-> runAi payments.screenshot_scan", {
      mediaType,
      bytes: bytes.byteLength,
      vendors: vendors.length,
    });

    const result = await runAi({
      purpose: "payments.screenshot_scan",
      prompt,
      attachments: [{ kind: "image", mediaType, base64 }],
      // maxTokens is a ceiling, not spend: a thinking model draws its reasoning from the same budget,
      // and runAi refuses a max_tokens stop outright rather than hand back half a screenshot.
      maxTokens: 4096,
      json: true,
    });

    // runAi has already stripped fences and parsed; all that is left to check is the shape.
    const raw: unknown = result.json;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      log.error("screenshot scan returned JSON that is not an object", {
        model: result.model,
        type: Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw,
      });
      return errorResponse("Failed to parse AI response", 500);
    }

    const parsed = raw as {
      amount: number | null;
      paymentMode: string | null;
      referenceNo: string | null;
      paymentDate: string | null;
      vendorName: string | null;
      matchedVendor: string | null;
      payerName: string | null;
      bankName: string | null;
      notes: string | null;
    };

    log.info("screenshot parsed", {
      model: result.model,
      hasAmount: parsed.amount != null,
      hasReference: !!parsed.referenceNo,
      hasMatchedVendor: !!parsed.matchedVendor,
    });

    // Try to find the matched vendor ID
    let vendorId: string | null = null;
    if (parsed.matchedVendor) {
      const match = vendors.find(
        (v) => v.name.toLowerCase() === parsed.matchedVendor!.toLowerCase()
      );
      if (match) vendorId = match.id;
    }

    // Fallback: fuzzy match vendorName against vendor list
    if (!vendorId && parsed.vendorName) {
      const name = parsed.vendorName.toLowerCase();
      const fuzzy = vendors.find(
        (v) =>
          v.name.toLowerCase().includes(name.substring(0, 10)) ||
          name.includes(v.name.toLowerCase().substring(0, 10))
      );
      if (fuzzy) vendorId = fuzzy.id;
    }

    return successResponse({
      amount: parsed.amount || null,
      paymentMode: parsed.paymentMode || null,
      referenceNo: parsed.referenceNo || null,
      paymentDate: parsed.paymentDate || null,
      vendorName: parsed.vendorName || null,
      vendorId,
      matchedVendorName: vendorId
        ? vendors.find((v) => v.id === vendorId)?.name || null
        : null,
      payerName: parsed.payerName || null,
      bankName: parsed.bankName || null,
      notes: parsed.notes || null,
    });
  } catch (error) {
    const aiRes = toAiErrorResponse(error);
    if (aiRes) {
      log.warn("screenshot scan failed at the AI step", { status: aiRes.status, kind: aiErrorKind(error) });
      return aiRes;
    }
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("parse-screenshot failed", {
      kind: aiErrorKind(error),
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      error instanceof Error ? error.message : "Failed to parse screenshot",
      500
    );
  }
}
