export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { getBooks } from "@/lib/integrations";
import { createPurchaseOrder } from "@/lib/purchase-orders/create";

const log = createLogger("purchase-orders:create-from-invoice");

interface LineItemPayload {
  name: string;
  hsn?: string | null;
  quantity: number;
  rate: number;
  gstPercent?: number;
  taxAmount?: number;
  total?: number;
  matchedProductId?: string | null;
}

interface RequestBody {
  vendorId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string | null;
  referenceNumber?: string | null;
  lineItems: LineItemPayload[];
  totals: {
    subTotal: number;
    taxTotal: number;
    grandTotal: number;
  };
  pushToZoho?: boolean;
  fileBase64?: string | null;
  fileName?: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("purchase_orders", "create");
    const body = (await req.json()) as RequestBody;

    const {
      vendorId,
      invoiceNumber,
      invoiceDate,
      dueDate,
      referenceNumber,
      lineItems,
      totals,
      pushToZoho = true,
      fileBase64,
      fileName,
    } = body;

    if (!vendorId) return errorResponse("Vendor is required", 400);
    if (!invoiceNumber?.trim()) return errorResponse("Invoice number is required", 400);
    if (!invoiceDate?.trim()) return errorResponse("Invoice date is required", 400);
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return errorResponse("At least one line item is required", 400);
    }

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, name: true, gstin: true, zohoVendorId: true, paymentTermDays: true },
    });
    if (!vendor) return errorResponse("Selected vendor not found in database", 404);

    let zohoBillId: string | null = null;
    let zohoBillNumber: string | null = null;
    let zohoNotice: string | null = null;

    // ─── 1. Push to Zoho Books if enabled ──────────────────────────────────────────
    if (pushToZoho) {
      try {
        const zoho = await getBooks();
        if (!zoho) {
          log.warn("Zoho Books client is not connected; skipping Zoho push", { vendorId });
          zohoNotice = "Zoho Books is not connected. Saved in local app only.";
        } else {
          log.info("pushing bill to Zoho Books", {
            vendorId: vendor.id,
            zohoVendorId: vendor.zohoVendorId,
            billNo: invoiceNumber,
            amount: totals.grandTotal,
          });

          const zohoRes = await zoho.createBill({
            vendorId: vendor.zohoVendorId || undefined,
            vendorName: vendor.name,
            billNo: invoiceNumber.trim(),
            billDate: invoiceDate,
            dueDate: dueDate || invoiceDate,
            referenceNumber: referenceNumber || undefined,
            amount: totals.grandTotal,
            gstNo: vendor.gstin || undefined,
            lineItems: lineItems.map((li) => ({
              name: li.name.trim(),
              quantity: li.quantity,
              rate: li.rate,
              gstPercent: li.gstPercent || 0,
              hsn: li.hsn || undefined,
            })),
          });

          if (zohoRes?.bill?.bill_id) {
            zohoBillId = zohoRes.bill.bill_id;
            zohoBillNumber = zohoRes.bill.bill_number;
            log.info("Zoho bill created successfully", { billId: zohoBillId, billNumber: zohoBillNumber });

            // Attach PDF if available (best-effort)
            if (fileBase64 && fileName) {
              try {
                const fileBytes = Buffer.from(fileBase64, "base64");
                await zoho.attachFileToBill(zohoBillId, fileName, fileBytes);
                log.info("invoice attachment uploaded to Zoho bill", { billId: zohoBillId, fileName });
              } catch (attErr) {
                log.warn("failed to upload attachment to Zoho bill (bill was created)", {
                  billId: zohoBillId,
                  error: attErr instanceof Error ? attErr.message : String(attErr),
                });
              }
            }
          }
        }
      } catch (zohoErr) {
        log.error("Zoho Books bill creation failed", {
          error: zohoErr instanceof Error ? zohoErr.message : String(zohoErr),
        });
        const msg = zohoErr instanceof Error ? zohoErr.message : "Zoho Books API error";
        return errorResponse(`Zoho Books bill creation failed: ${msg}. Check vendor linkage in Zoho or retry without Zoho push.`, 400);
      }
    }

    // ─── 2. Create local Purchase Order ───────────────────────────────────────────
    const poResult = await createPurchaseOrder(
      {
        vendorId: vendor.id,
        items: lineItems.map((li) => ({
          name: li.name.trim(),
          quantity: li.quantity,
          productId: li.matchedProductId || undefined,
        })),
        expectedDate: dueDate || invoiceDate,
        notes: `Created from Vendor Invoice ${invoiceNumber}${zohoBillNumber ? ` (Zoho Bill: ${zohoBillNumber})` : ""}`,
        submit: true,
      },
      { id: user.id, name: user.name },
      { verifyVendorSupplies: false }
    );

    const po = poResult.po;

    // ─── 3. Create or link VendorBill ─────────────────────────────────────────────
    let calculatedDueDate = dueDate ? new Date(dueDate) : new Date(invoiceDate);
    if (isNaN(calculatedDueDate.getTime())) {
      calculatedDueDate = new Date(invoiceDate);
      calculatedDueDate.setDate(calculatedDueDate.getDate() + (vendor.paymentTermDays || 30));
    }

    const existingBill = await prisma.vendorBill.findUnique({
      where: {
        vendorId_billNo: {
          vendorId: vendor.id,
          billNo: invoiceNumber.trim(),
        },
      },
    });

    let vendorBill;
    if (existingBill) {
      vendorBill = await prisma.vendorBill.update({
        where: { id: existingBill.id },
        data: {
          purchaseOrderId: po.id,
          amount: totals.grandTotal,
          notes: zohoBillId ? `Linked Zoho Bill ID: ${zohoBillId}` : existingBill.notes,
        },
      });
    } else {
      vendorBill = await prisma.vendorBill.create({
        data: {
          vendorId: vendor.id,
          purchaseOrderId: po.id,
          billNo: invoiceNumber.trim(),
          billDate: new Date(invoiceDate),
          dueDate: calculatedDueDate,
          amount: totals.grandTotal,
          notes: zohoBillId ? `Linked Zoho Bill ID: ${zohoBillId}` : undefined,
        },
      });
    }

    log.info("purchase order and vendor bill saved locally", {
      poId: po.id,
      poNumber: po.poNumber,
      vendorBillId: vendorBill.id,
      zohoBillId,
    });

    return successResponse(
      {
        purchaseOrderId: po.id,
        poNumber: po.poNumber,
        vendorBillId: vendorBill.id,
        zohoBillId,
        zohoBillNumber,
        notice: zohoNotice,
      },
      201
    );
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("create from invoice failed", { error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to create purchase order from invoice", 500);
  }
}
