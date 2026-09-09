export const dynamic = "force-dynamic";
// jspdf's node build statically requires `fs` and `path`. On the edge runtime those do not
// exist and the route fails at import time, so this declaration is load-bearing, not habit.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { renderPurchaseOrderPdf, type PoPdfLine } from "@/lib/purchase-orders/pdf";
import { loadCompanyIdentity } from "@/lib/purchase-orders/company";
import { createLogger } from "@/lib/logger";

const log = createLogger("purchase-orders:pdf-route");

/**
 * The purchase order as a PDF, rendered on request.
 *
 * `purchase_orders.view`, NOT `edit` — reading the document a vendor will receive is a read.
 * The same file is what `POST /[id]/send` attaches, so "Preview PDF" on the send sheet and the
 * vendor's attachment are byte-for-byte the same render.
 *
 * NOT STORED. Rendering costs a few hundred milliseconds and the PO can be amended right up
 * until it is sent, so a cached copy would mostly be a stale copy. P12b keeps a snapshot of the
 * exact bytes that were emailed, which is a different question — that one must never change,
 * because it is what the vendor is holding.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("purchase_orders", "view");
    const { id } = await params;

    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: {
        poNumber: true,
        orderDate: true,
        expectedDate: true,
        notes: true,
        deliveryAddress: true,
        subtotal: true,
        gstTotal: true,
        grandTotal: true,
        approvedAt: true,
        approvedBy: { select: { name: true } },
        vendor: {
          select: {
            name: true, code: true, addressLine1: true, addressLine2: true, city: true, state: true,
            pincode: true, gstin: true, phone: true,
            // The primary contact is a nicety on the document ("Attn: …"). Sorted rather than
            // filtered because nothing in the database guarantees a primary exists — the rule
            // is application-enforced in api/vendors/[id]/contacts.
            contacts: {
              select: { name: true, isPrimary: true },
              orderBy: { isPrimary: "desc" },
              take: 1,
            },
          },
        },
        items: {
          select: {
            // The description is the line's own `name` (plan 0909, D2): a line raised from the
            // vendor's sheet has no product at all. SKU and HSN come from the product only when
            // the line is linked; hsnCode lives on Product, NOT on PurchaseOrderItem — the
            // column that does not exist there is exactly what made the old brand-stock PO
            // generator (deleted 9 Sep 2026) throw for months.
            name: true,
            quantity: true,
            unitPrice: true,
            gstRate: true,
            amount: true,
            product: { select: { sku: true, hsnCode: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!po) return errorResponse("Purchase order not found", 404);

    const company = await loadCompanyIdentity();

    const items: PoPdfLine[] = po.items.map((it) => ({
      sku: it.product?.sku ?? null,
      name: it.name,
      hsnCode: it.product?.hsnCode ?? null,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      gstRate: it.gstRate,
      amount: it.amount,
    }));

    const pdf = await renderPurchaseOrderPdf(
      {
        poNumber: po.poNumber,
        orderDate: po.orderDate,
        expectedDate: po.expectedDate,
        notes: po.notes,
        deliveryAddress: po.deliveryAddress,
        subtotal: po.subtotal,
        gstTotal: po.gstTotal,
        grandTotal: po.grandTotal,
        approvedByName: po.approvedBy?.name ?? null,
        approvedAt: po.approvedAt,
        vendor: {
          name: po.vendor.name,
          code: po.vendor.code,
          // Both lines, joined — a vendor with a unit number on line 2 would otherwise have
          // half an address on the document.
          address: [po.vendor.addressLine1, po.vendor.addressLine2].filter(Boolean).join(", ") || null,
          city: po.vendor.city,
          state: po.vendor.state,
          pincode: po.vendor.pincode,
          gstin: po.vendor.gstin,
          phone: po.vendor.phone,
          contactName: po.vendor.contacts[0]?.name ?? null,
        },
        items,
      },
      company
    );

    log.info("purchase order pdf served", { poId: id, poNumber: po.poNumber, bytes: pdf.byteLength });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.byteLength),
        // `inline` so it opens in the browser's viewer rather than downloading — the point of
        // this route is "let me look at what the vendor will get". The filename is still used
        // when somebody chooses to save it.
        "Content-Disposition": `inline; filename="${po.poNumber}.pdf"`,
        // NOT the immutable header api/media uses. A purchase order can be amended while it is
        // still a draft, and an immutable year-long cache would serve a pre-amendment document
        // to the person checking whether their change took.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to render the purchase order";
    log.error("pdf render failed", { message });
    return errorResponse(message, 500);
  }
}
