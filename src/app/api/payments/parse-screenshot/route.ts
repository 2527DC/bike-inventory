export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// POST — Parse payment screenshot using Claude Vision
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

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return errorResponse("AI API key not configured", 400);

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

    // Call Claude Vision API with retry
    let claudeData: { content?: Array<{ text?: string }> } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: mediaType, data: base64 },
                },
                { type: "text", text: prompt },
              ],
            },
          ],
        }),
      });

      if (res.ok) {
        claudeData = await res.json();
        break;
      }

      const errText = await res.text();
      if (errText.includes("overloaded") || res.status === 529) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
          continue;
        }
        return errorResponse("AI service is temporarily busy. Please try again in a minute.", 503);
      }
      return errorResponse(`AI processing failed (${res.status})`, 500);
    }

    if (!claudeData) return errorResponse("AI processing failed", 500);

    const responseText = claudeData.content?.[0]?.text || "";

    // Parse JSON from response
    let parsed: {
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

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return errorResponse("Failed to parse AI response", 500);
    }

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
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to parse screenshot",
      500
    );
  }
}
