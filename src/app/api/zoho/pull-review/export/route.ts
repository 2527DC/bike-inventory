export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("zoho:pull-review-export");

// GET — download pull preview as CSV (simple, works everywhere)
export async function GET(req: NextRequest) {
  const pullId = new URL(req.url).searchParams.get("pullId");
  try {
    await requireFeature("zoho", "view");

    if (!pullId) return errorResponse("pullId required", 400);

    const previews = await prisma.zohoPullPreview.findMany({
      where: { pullId },
      orderBy: [{ entityType: "asc" }, { createdAt: "asc" }],
    });

    if (previews.length === 0) return errorResponse("No data for this pull", 404);

    // Build CSV — one row per line item for invoices/bills so item names & SKUs are visible
    const lines: string[] = [];
    lines.push("Type,Doc Number,Date,Customer/Vendor,Sales Person,Item Name,SKU,Qty,Rate,Item Total,Doc Total,Status");

    for (const p of previews) {
      const d = p.data as Record<string, unknown>;
      const esc = (v: unknown) => String(v || "").replace(/"/g, '""').replace(/,/g, " ");

      if (p.entityType === "contact") {
        lines.push(`contact,,,,,"${esc(d.name)}",,,,,,"${esc(`Phone: ${d.phone} | GSTIN: ${d.gstin}`)}"`);
      } else if (p.entityType === "item") {
        lines.push(`item,,,,,"${esc(d.name)}","${esc(d.sku)}",,"${esc(d.costPrice)}","${esc(d.sellingPrice)}",,`);
      } else if (p.entityType === "invoice") {
        const items = (d.lineItems as Array<{ name: string; sku: string; quantity: number; rate: number; itemTotal: number }>) || [];
        if (items.length > 0) {
          for (const li of items) {
            lines.push(`invoice,"${esc(d.invoiceNumber)}","${esc(d.date)}","${esc(d.customerName)}","${esc(d.salesPerson)}","${esc(li.name)}","${esc(li.sku)}",${li.quantity},${li.rate},${li.itemTotal},${d.total},${d.status}`);
          }
        } else {
          lines.push(`invoice,"${esc(d.invoiceNumber)}","${esc(d.date)}","${esc(d.customerName)}","${esc(d.salesPerson)}",,,,,,${d.total},${d.status}`);
        }
      } else if (p.entityType === "bill") {
        const items = (d.lineItems as Array<{ name: string; sku: string; quantity: number; rate: number; itemTotal: number }>) || [];
        if (items.length > 0) {
          for (const li of items) {
            lines.push(`bill,"${esc(d.billNumber)}","${esc(d.date)}","${esc(d.vendorName)}",,"${esc(li.name)}","${esc(li.sku)}",${li.quantity},${li.rate},${li.itemTotal},${d.total},${d.status}`);
          }
        } else {
          // Seven commas after the vendor: Sales Person and the five item columns are empty. It was
          // six, which put every bill's total under "Item Total" — and every bill preview has no
          // line items, so every bill row was shifted.
          lines.push(`bill,"${esc(d.billNumber)}","${esc(d.date)}","${esc(d.vendorName)}",,,,,,,${d.total},${d.status}`);
        }
      } else if (p.entityType === "vendorcredit" || p.entityType === "creditnote") {
        // Plan 1210 credit notes: one row per note. No line items; the Status column also says
        // what the import would do (new / update / void) and how much of the note is still open.
        const isVendor = p.entityType === "vendorcredit";
        const number = isVendor ? d.creditNumber : d.creditNoteNumber;
        const party = isVendor ? d.vendorName : d.customerName;
        const status = `${esc(d.status)} (${esc(p.action)}; open ${esc(d.balance ?? 0)})`;
        lines.push(`${isVendor ? "vendor credit" : "credit note"},"${esc(number)}","${esc(d.date)}","${esc(party)}",,,,,,,${Number(d.total) || 0},"${status}"`);
      }
    }

    const csv = lines.join("\n");
    log.debug("pull exported", { pullId, previews: previews.length, rows: lines.length - 1 });

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="zoho-pull-${pullId}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : String(error);
    log.error("pull export failed", { pullId, message });
    return errorResponse("Export failed. Try again.", 500);
  }
}
