import { createLogger } from "@/lib/logger";
import { runAi, aiErrorKind } from "@/lib/ai";
import type { ExtractedVendorInvoice, ExtractedInvoiceLineItem } from "./types";

const log = createLogger("invoice-extraction:parse");

function cleanNumber(val: unknown, fallback = 0): number {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/[^0-9.-]/g, "");
    const parsed = parseFloat(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function cleanString(val: unknown): string | null {
  if (typeof val === "string") {
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function formatDate(val: unknown): string {
  if (typeof val === "string") {
    const match = val.match(/\b\d{4}-\d{2}-\d{2}\b/);
    if (match) return match[0];
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  return new Date().toISOString().split("T")[0];
}

export async function parseVendorInvoiceWithAI(
  buffer: ArrayBuffer,
  fileName: string
): Promise<ExtractedVendorInvoice> {
  const base64 = Buffer.from(buffer).toString("base64");
  const lowerName = fileName.toLowerCase();
  const isPdf = lowerName.endsWith(".pdf");
  const mediaType = isPdf
    ? "application/pdf"
    : lowerName.endsWith(".png")
    ? "image/png"
    : lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")
    ? "image/jpeg"
    : lowerName.endsWith(".webp")
    ? "image/webp"
    : "image/jpeg";

  log.debug("parsing vendor invoice with AI", { fileName, mediaType, bytes: buffer.byteLength });

  const prompt = `You are an expert accounting system AI. Extract all structured data from this vendor Tax Invoice / purchase bill into a JSON object adhering to this schema:

{
  "vendor": {
    "name": "Seller/Vendor Business Name (e.g. INKODOP TECHNOLOGIES PRIVATE LIMITED)",
    "gstin": "15-character GSTIN of seller, or null",
    "address": "Seller full address, or null",
    "email": "Seller email, or null",
    "phone": "Seller contact number, or null"
  },
  "invoice": {
    "invoiceNumber": "Invoice / Bill Number (e.g. 27-EM-2627-14004)",
    "invoiceDate": "YYYY-MM-DD",
    "dueDate": "YYYY-MM-DD (if mentioned, else null)",
    "referenceNumber": "Purchase order / delivery note / order reference number, or null",
    "taxType": "IGST" or "CGST_SGST"
  },
  "lineItems": [
    {
      "name": "Exact product name or description",
      "hsn": "HSN or SAC code, or null",
      "quantity": number,
      "rate": number (unit price before GST/tax),
      "gstPercent": number (e.g. 5, 12, 18, 28),
      "taxAmount": number (total tax amount for this line),
      "total": number (line total amount including tax)
    }
  ],
  "totals": {
    "subTotal": number (total taxable value before tax),
    "taxTotal": number (total tax amount),
    "grandTotal": number (total payable amount after tax)
  }
}

Rules:
1. Every quantity, rate, taxAmount, and total must be a valid number (no commas, no ₹ symbols).
2. Rate must be unit price before tax. If only line taxable amount is given, calculate rate = taxable amount / quantity.
3. Determine taxType: If IGST is charged, set "IGST"; if CGST and SGST are charged, set "CGST_SGST".
4. Ensure all line items are extracted accurately without skipping rows.
5. Return ONLY a valid JSON object matching the schema.`;

  let result;
  try {
    result = await runAi({
      purpose: "purchase_orders.invoice_extract",
      prompt,
      attachments: [{ kind: isPdf ? "pdf" : "image", mediaType, base64, fileName }],
      maxTokens: 8000,
      json: true,
    });
  } catch (error) {
    log.error("AI invoice extraction failed", { fileName, kind: aiErrorKind(error) });
    throw error;
  }

  const raw = result.json as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    log.error("AI returned non-object response", { fileName, model: result.model });
    throw new Error("Could not extract invoice details from this document.");
  }

  const rawVendor = (raw.vendor as Record<string, unknown>) || {};
  const rawInvoice = (raw.invoice as Record<string, unknown>) || {};
  const rawLines = Array.isArray(raw.lineItems) ? raw.lineItems : [];
  const rawTotals = (raw.totals as Record<string, unknown>) || {};

  const lineItems: ExtractedInvoiceLineItem[] = rawLines.map((item: Record<string, unknown>, idx: number) => {
    const qty = Math.max(1, Math.round(cleanNumber(item.quantity, 1)));
    const rate = cleanNumber(item.rate, 0);
    const gstPercent = cleanNumber(item.gstPercent, 0);
    const calculatedTax = (rate * qty * gstPercent) / 100;
    const taxAmount = cleanNumber(item.taxAmount, calculatedTax);
    const total = cleanNumber(item.total, rate * qty + taxAmount);

    return {
      id: `line-${idx + 1}`,
      name: String(item.name || "").trim() || `Item ${idx + 1}`,
      hsn: cleanString(item.hsn),
      quantity: qty,
      rate,
      gstPercent,
      taxAmount,
      total,
    };
  });

  const subTotal = cleanNumber(rawTotals.subTotal, lineItems.reduce((acc, l) => acc + l.rate * l.quantity, 0));
  const taxTotal = cleanNumber(rawTotals.taxTotal, lineItems.reduce((acc, l) => acc + l.taxAmount, 0));
  const grandTotal = cleanNumber(rawTotals.grandTotal, subTotal + taxTotal);

  const invoiceNumber = cleanString(rawInvoice.invoiceNumber) || "INV-UNKNOWN";
  const invoiceDate = formatDate(rawInvoice.invoiceDate);
  const taxType = rawInvoice.taxType === "CGST_SGST" ? "CGST_SGST" : "IGST";

  log.info("vendor invoice extracted successfully", {
    fileName,
    invoiceNumber,
    vendorName: rawVendor.name,
    itemCount: lineItems.length,
    grandTotal,
    model: result.model,
  });

  return {
    vendor: {
      name: cleanString(rawVendor.name) || "Unknown Vendor",
      gstin: cleanString(rawVendor.gstin),
      address: cleanString(rawVendor.address),
      email: cleanString(rawVendor.email),
      phone: cleanString(rawVendor.phone),
    },
    invoice: {
      invoiceNumber,
      invoiceDate,
      dueDate: rawInvoice.dueDate ? formatDate(rawInvoice.dueDate) : null,
      referenceNumber: cleanString(rawInvoice.referenceNumber),
      taxType,
    },
    lineItems,
    totals: {
      subTotal,
      taxTotal,
      grandTotal,
    },
    aiModel: result.model,
    fileName,
  };
}
