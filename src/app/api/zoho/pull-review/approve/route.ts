export const dynamic = "force-dynamic";
export const maxDuration = 60; // Approve step now fetches bill details from Zoho

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { PLACEHOLDER_CATEGORY } from "@/lib/import-placeholders";
// Type-only. The clients themselves are still loaded through a dynamic import inside the
// handler, so importing the type here adds nothing to the module graph at runtime.
import type { BooksClient } from "@/lib/integrations";
import {
  storeIdForInvoice,
  deliveryFieldsFromInvoiceDetail,
  type DeliveryFieldsFromInvoice,
} from "@/lib/deliveries/zoho-invoice";
import { logActivity } from "@/lib/activity-log";
import { nextSequence } from "@/lib/sequence";
import { ibSeedSql } from "@/lib/inbound/sequence";

// This route had no logger at all — a 499-line import handler whose only record of what it
// did was the response body, which a 504 never delivers.
const log = createLogger("zoho:approve");

// POST — approve or reject a pull
export async function POST(req: NextRequest) {
  // Wall-clock for the finish log. This route dies at maxDuration = 60 under load, so how
  // long a successful run took is the number that says how close to the cliff it is.
  const startedAt = Date.now();
  try {
    const user = await requireFeature("zoho", "approve");
    const body = await req.json();
    const { pullId, action, entityType, previewIds, source } = body as {
      pullId: string; action: "approve" | "reject"; entityType?: string; previewIds?: string[]; source?: string;
    };

    if (!pullId || !["approve", "reject"].includes(action)) {
      return errorResponse("pullId and action (approve/reject) required", 400);
    }

    // Find or auto-create pullLog (handles case where finalize step failed)
    let pullLog = await prisma.zohoPullLog.findUnique({ where: { pullId } });
    if (!pullLog) {
      // Check that previews exist for this pullId before creating log
      const previewCount = await prisma.zohoPullPreview.count({ where: { pullId } });
      if (previewCount === 0) return errorResponse("Pull not found", 404);
      pullLog = await prisma.zohoPullLog.create({
        data: { pullId, billsNew: previewCount, apiCallsUsed: 0 },
      });
    }
    if (pullLog.status !== "PENDING_REVIEW" && pullLog.status !== "PARTIAL") {
      return errorResponse(`Pull already ${pullLog.status.toLowerCase()}`, 400);
    }

    // Filter: specific IDs > entity type > all pending
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let previewFilter: any = { pullId, status: "PENDING" };
    if (previewIds && previewIds.length > 0) {
      previewFilter = { pullId, status: "PENDING", id: { in: previewIds } };
    } else if (entityType) {
      previewFilter.entityType = entityType;
    }

    const previews = await prisma.zohoPullPreview.findMany({ where: previewFilter });

    if (action === "reject") {
      await prisma.zohoPullPreview.updateMany({
        where: previewFilter,
        data: { status: "REJECTED", reviewedAt: new Date(), reviewedById: user.id },
      });
      // Only mark pull as rejected if ALL previews are now rejected
      const remaining = await prisma.zohoPullPreview.count({ where: { pullId, status: "PENDING" } });
      if (remaining === 0) {
        await prisma.zohoPullLog.update({
          where: { pullId },
          data: { status: "REJECTED", approvedAt: new Date() },
        });
      }
      return successResponse({ action: "rejected", count: previews.length, entityType: entityType || "all" });
    }

    // ─── APPROVE: write to real tables ───
    // `contacts` and `items` are always 0 — those two branches were deleted with the Zoho
    // item import. The keys stay because four screens read this response shape, and a 0 is
    // the honest answer rather than a missing field they would have to guard against.
    //
    // Products ARE still created here, by the BILL branch, when a bill line names a SKU the
    // catalog does not have. That is deliberate and was decided explicitly: an inbound
    // shipment must be able to receive something the catalog has not met yet.
    // `skipped` is new: an already-imported record is a normal outcome, not an error and not a
    // silent nothing. Before this a re-import reported "0 imported" with no explanation.
    const results = { contacts: 0, items: 0, bills: 0, invoices: 0, skipped: 0, errors: [] as string[] };

    // Every store, for invoice-prefix attribution (O8). Two rows; loaded once, not per record.
    const stores = await prisma.store.findMany({
      select: { id: true, invoicePrefix: true },
    });

    // Imported records are attributed to a system-role account when one exists, so the audit
    // trail doesn't credit whoever happened to click Approve.
    const adminUser = await prisma.user.findFirst({
      where: { role: { isSystem: true }, isActive: true },
      orderBy: { createdAt: "asc" },
    });
    const systemUserId = adminUser?.id || user.id;

    for (const preview of previews) {
      const d = preview.data as Record<string, unknown>;
      try {
        if (preview.entityType === "bill") {
          // Fetch line items from Zoho if not in preview data
          let lineItems = (d.lineItems as Array<{ name: string; sku: string; quantity: number; rate: number; itemTotal: number }>) || [];
          if (lineItems.length === 0 && preview.zohoId) {
            try {
              // getBooks(), not `new BooksClient()` + init(). This sits INSIDE the
              // per-preview loop, so the old form paid one IntegrationConfig read — and a
              // token refresh whenever the token was near expiry — for every bill in the
              // batch. getBooks is request-scoped, so the whole approve now pays once.
              const { getBooks } = await import("@/lib/integrations");
              const zoho = await getBooks();
              if (zoho) {
                const detail = await zoho.getBill(preview.zohoId);
                lineItems = (detail.bill?.line_items || []).map((li) => ({
                  name: li.name, sku: li.sku || "", quantity: li.quantity, rate: li.rate, itemTotal: li.item_total, item_id: li.item_id,
                }));
              }
            } catch (e) {
              results.errors.push(`Bill ${d.billNumber}: failed to fetch details — ${e instanceof Error ? e.message : "Unknown"}`);
            }
          }

          // Find vendor — auto-create if not found
          let vendor = await prisma.vendor.findFirst({
            where: { name: { equals: String(d.vendorName), mode: "insensitive" } },
          });
          if (!vendor) {
            const code = String(d.vendorName || "")
              .replace(/[^a-zA-Z0-9]/g, "")
              .substring(0, 6)
              .toUpperCase() + String(Date.now()).slice(-4);
            vendor = await prisma.vendor.create({
              data: { name: String(d.vendorName), code },
            });
          }

          // Dedup: skip if shipment already exists for this bill
          const existsShipment = await prisma.inboundShipment.findFirst({
            where: { billNo: String(d.billNumber) },
            select: { id: true, shipmentNo: true },
          });
          if (existsShipment) {
            // Not an error — a re-fetched window whose bills are already in is normal.
            results.skipped++;
            log.debug("bill already has a shipment", { billNo: String(d.billNumber), shipmentNo: existsShipment.shipmentNo });
            await prisma.zohoPullPreview.update({ where: { id: preview.id }, data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: user.id } });
            continue;
          }

          // Reuse existing VendorBill if it exists (e.g. from accounting import), or create new
          const existingVB = await prisma.vendorBill.findFirst({ where: { billNo: String(d.billNumber) } });

          const total = Number(d.total || 0);
          const balance = Number(d.balance || 0);

          // Match products for line items — auto-create if not found.
          // Accounting (Bills & Payments) imports are FINANCIAL-ONLY: they must never
          // create products or touch the stock chain, so the whole loop is skipped for them.
          const matchedProducts: Array<{ li: typeof lineItems[0]; product: { id: string; currentStock: number } }> = [];

          if (source !== "accounting") {
          // Resolve brand for new products (use vendor name as brand)
          const billVendorName = String(d.vendorName).trim();
          let itemBrand = await prisma.brand.findFirst({ where: { name: { equals: billVendorName, mode: "insensitive" } } });
          if (!itemBrand) itemBrand = await prisma.brand.create({ data: { name: billVendorName } });

          // Default category fallback — the shared placeholder name.
          let defaultCategory = await prisma.category.findFirst({ where: { name: PLACEHOLDER_CATEGORY } });
          if (!defaultCategory) defaultCategory = await prisma.category.create({ data: { name: PLACEHOLDER_CATEGORY, description: "Auto-created from bill import" } });

          // The client for fetching item details (category, HSN, tax). Same shared,
          // request-scoped client as the getBill call above — asking twice in one request
          // returns the same instance, so this costs nothing after the first bill.
          //
          // `any` is gone with it: getBooks() returns a typed BooksClient | null, and the
          // eslint-disable that suppressed the complaint is no longer needed.
          let zohoForItems: BooksClient | null = null;
          try {
            const { getBooks } = await import("@/lib/integrations");
            zohoForItems = await getBooks();
          } catch (e) {
            // Best effort — a missing item detail costs category and HSN, not the import.
            // But a swallowed error with no log is a bug, so say what was lost.
            log.warn("item detail client unavailable; importing without category/HSN", {
              pullId,
              error: e instanceof Error ? e.message : String(e),
            });
          }

          for (let liIdx = 0; liIdx < lineItems.length; liIdx++) {
            const li = lineItems[liIdx];
            const zohoItemId = (li as Record<string, unknown>).item_id as string | undefined;

            // Try to find existing product: by zohoItemId, then SKU, then name
            let product = zohoItemId
              ? await prisma.product.findFirst({ where: { zohoItemId }, select: { id: true, currentStock: true } })
              : null;
            if (!product && li.sku) {
              product = await prisma.product.findFirst({ where: { sku: li.sku }, select: { id: true, currentStock: true } });
            }
            if (!product) {
              product = await prisma.product.findFirst({
                where: { name: { contains: li.name.substring(0, 20), mode: "insensitive" } },
                select: { id: true, currentStock: true },
              });
            }

            if (!product) {
              // Fetch item details from Zoho for category, HSN, tax
              let zohoCategoryName = "";
              let zohoHsn = "";
              let zohoTax = 18;
              if (zohoForItems && zohoItemId) {
                try {
                  const detail = await zohoForItems.getItem(zohoItemId);
                  const item = detail.item || {};
                  zohoCategoryName = String(item.category_name || "").trim();
                  zohoHsn = String(item.hsn_or_sac || "").trim();
                  zohoTax = Number(item.tax_percentage || 18);
                } catch { /* best effort */ }
              }

              // Resolve category from Zoho or fallback
              let productCategory = defaultCategory;
              if (zohoCategoryName) {
                let cat = await prisma.category.findFirst({ where: { name: zohoCategoryName } });
                if (!cat) cat = await prisma.category.create({ data: { name: zohoCategoryName, description: `From Zoho: ${zohoCategoryName}` } });
                productCategory = cat;
              }

              // Generate unique SKU — check for conflicts
              let sku = li.sku || "";
              if (sku) {
                const skuExists = await prisma.product.findFirst({ where: { sku }, select: { id: true } });
                if (skuExists) sku = ""; // clear so we auto-generate
              }
              if (!sku) {
                sku = `AUTO-${Date.now().toString(36).toUpperCase()}${liIdx}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
              }

              // Ensure zohoItemId uniqueness
              const safeZohoItemId = zohoItemId
                ? (await prisma.product.findFirst({ where: { zohoItemId }, select: { id: true } })) ? null : zohoItemId
                : null;

              product = await prisma.product.create({
                data: {
                  name: li.name,
                  sku,
                  costPrice: li.rate,
                  sellingPrice: li.rate,
                  mrp: li.rate,
                  gstRate: zohoTax,
                  hsnCode: zohoHsn || null,
                  currentStock: 0,
                  brandId: itemBrand.id,
                  categoryId: productCategory.id,
                  zohoItemId: safeZohoItemId,
                },
                select: { id: true, currentStock: true },
              });
              results.errors.push(`Bill ${d.billNumber}: auto-created "${li.name}" (${sku}) in ${productCategory.name}`);
            }
            matchedProducts.push({ li, product });
          }
          } // end if (source !== "accounting") — accounting imports stay financial-only

          // Calculate due date: use Zoho's dueDate unless it equals billDate (missing), then use vendor's payment terms
          const billDate = new Date(String(d.date));
          let dueDate = new Date(String(d.dueDate));
          if (dueDate.toISOString().slice(0, 10) === billDate.toISOString().slice(0, 10)) {
            dueDate = new Date(billDate);
            dueDate.setDate(dueDate.getDate() + (vendor.paymentTermDays || 30));
          }

          const vendorBill = existingVB || await prisma.vendorBill.create({
            data: {
              billNo: String(d.billNumber),
              vendorId: vendor.id,
              billDate,
              dueDate,
              amount: total,
              paidAmount: total - balance,
              status: balance === 0 ? "PAID" : balance < total ? "PARTIALLY_PAID" : "PENDING",
            },
          });

          // ─── Create InboundShipment (only from inventory/inbound flow, not accounting) ───
          if (source === "accounting") {
            results.bills++;
            await prisma.zohoPullPreview.update({
              where: { id: preview.id },
              data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: user.id },
            });
            continue;
          }

          // Resolve brand from vendor name (find or create)
          const vendorName = String(d.vendorName).trim();
          let shipmentBrand = await prisma.brand.findFirst({ where: { name: { equals: vendorName, mode: "insensitive" } } });
          if (!shipmentBrand) {
            shipmentBrand = await prisma.brand.create({ data: { name: vendorName } });
          }
          const shipmentBrandId = shipmentBrand.id;

          // Lead time comes off the brand row already fetched above — it used to be a
          // separate BrandLeadTime lookup, i.e. a whole extra round trip INSIDE the
          // per-record import loop for a value that was already in memory.
          const leadDays = shipmentBrand.leadDays || 7;
          const expectedDeliveryDate = new Date(billDate);
          expectedDeliveryDate.setDate(expectedDeliveryDate.getDate() + leadDays);

          // Shipment number: IB-YYYYMM-0001, allocated atomically (§4 Counter).
          //
          // This is the worse of the two IB- allocators it replaces: a read-then-write
          // running INSIDE a loop that imports a whole batch within one 60-second function.
          // Every bill in the batch re-read "the last shipment number", so two concurrent
          // imports — or one import racing a manual create on /inbound — collided on a
          // unique column. Both allocators switch in the same change.
          const now = new Date();
          const prefix = `IB-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
          const shipmentNo = `${prefix}-${await nextSequence(prisma, prefix, 4, ibSeedSql(prefix))}`;

          const totalAmount = matchedProducts.reduce((s, { li }) => s + (li.itemTotal || li.rate * li.quantity), 0);

          // Auto-match pre-booked customers
          const waitingPreBookings = await prisma.preBooking.findMany({
            where: { status: "WAITING" },
          });

          const shipment = await prisma.inboundShipment.create({
            data: {
              shipmentNo,
              brandId: shipmentBrandId,
              billNo: String(d.billNumber),
              billDate,
              expectedDeliveryDate,
              totalAmount,
              totalItems: matchedProducts.length,
              createdById: systemUserId,
              vendorBillId: vendorBill.id,
              zohoBillId: preview.zohoId || null,
              lineItems: {
                create: matchedProducts.map(({ li, product }) => {
                  const preBookMatch = waitingPreBookings.find((pb) =>
                    li.name.toLowerCase().includes(pb.productName.toLowerCase().substring(0, 15))
                    || pb.productName.toLowerCase().includes(li.name.toLowerCase().substring(0, 15))
                  );
                  return {
                    productName: li.name,
                    productId: product.id,
                    sku: li.sku || null,
                    quantity: li.quantity,
                    rate: li.rate,
                    amount: li.itemTotal || li.rate * li.quantity,
                    preBookedCustomerName: preBookMatch?.customerName || null,
                    preBookedCustomerPhone: preBookMatch?.customerPhone || null,
                    preBookedInvoiceNo: preBookMatch?.zohoInvoiceNo || null,
                  };
                }),
              },
            },
            include: { lineItems: true },
          });

          // Update matched pre-bookings to MATCHED
          for (const sli of shipment.lineItems) {
            if (sli.preBookedInvoiceNo) {
              const pb = waitingPreBookings.find((p) => p.zohoInvoiceNo === sli.preBookedInvoiceNo);
              if (pb) {
                await prisma.preBooking.update({
                  where: { id: pb.id },
                  data: {
                    status: "MATCHED",
                    matchedShipmentId: shipment.id,
                    matchedLineItemId: sli.id,
                    expectedDate: expectedDeliveryDate,
                  },
                });
              }
            }
          }

          results.bills++;
        } else if (preview.entityType === "invoice") {
          const invoiceNo = String(d.invoiceNumber);

          // DEDUP FIRST, and it is no longer silent.
          //
          // This used to be a bare `continue` AFTER the detail fetch, which had three
          // consequences: a wasted Zoho round trip per duplicate, `results.invoices` never
          // incremented so re-imports were under-reported as "0 imported", and — worst — the
          // `continue` skipped the `preview.update` below, so the preview stayed PENDING
          // FOREVER and the pull could never leave PARTIAL.
          const exists = await prisma.delivery.findFirst({ where: { invoiceNo } });
          if (exists) {
            results.skipped++;
            log.debug("invoice already imported", { invoiceNo, deliveryId: exists.id });
            await prisma.zohoPullPreview.update({
              where: { id: preview.id },
              data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: user.id },
            });
            continue;
          }

          let fields: DeliveryFieldsFromInvoice | null = null;

          // ALWAYS fetch the detail, and ask the SAME provider that found it.
          //
          // Only `getBooks()` was tried before, so on a Zakya-only setup the detail call
          // returned nothing and every imported delivery arrived with no line items, no
          // address, no area and no pincode — the dispatch clerk had nothing to route by.
          // `provider` is written into the preview by trigger-pull (named `provider`, not
          // `source`, because this route already has a `source` body field meaning something
          // else entirely).
          if (preview.zohoId) {
            try {
              const { getBooks, getZakya } = await import("@/lib/integrations");
              const provider = String(d.provider || "");
              const zoho =
                provider === "pos"
                  ? (await getZakya()) ?? (await getBooks())
                  : provider === "books"
                    ? (await getBooks()) ?? (await getZakya())
                    : (await getZakya()) ?? (await getBooks());
              if (zoho) {
                const detail = await zoho.getInvoice(preview.zohoId);
                if (detail.invoice) fields = deliveryFieldsFromInvoiceDetail(detail.invoice);
              } else {
                results.errors.push(`Invoice ${invoiceNo}: no Zoho client to fetch details`);
              }
            } catch (e) {
              results.errors.push(`Invoice ${invoiceNo}: failed to fetch details — ${e instanceof Error ? e.message : "Unknown"}`);
            }
          }

          // WHICH STORE sold it (O8). Resolved at pull time and stored on the preview; the
          // prefix rule is re-applied here as a fallback so a preview written before the
          // stores had prefixes still lands on the right store when they are filled in.
          const storeId =
            (d.storeId ? String(d.storeId) : null) ?? storeIdForInvoice(invoiceNo, stores);

          const previewLineItems =
            (d.lineItems as Array<{ name: string; sku: string; quantity: number; rate: number; itemTotal: number }>) || [];

          // The detail supplies the rich fields; the PREVIEW wins on the four it already knows
          // authoritatively, because those came from the listing this import is approving.
          await prisma.delivery.create({
            data: {
              ...(fields ?? {}),
              invoiceNo,
              zohoInvoiceId: preview.zohoId,
              invoiceDate: new Date(String(d.date)),
              invoiceAmount: Number(d.total || 0),
              customerName: String(d.customerName),
              customerPhone: fields?.customerPhone ?? (String(d.phone || "") || null),
              salesPerson: fields?.salesPerson || String(d.salesPerson || "") || null,
              storeId,
              status: "PENDING",
              lineItems:
                fields && fields.lineItems.length > 0
                  ? fields.lineItems
                  : previewLineItems.length > 0
                    ? previewLineItems
                    : undefined,
            },
          });
          results.invoices++;
        }

        await prisma.zohoPullPreview.update({
          where: { id: preview.id },
          data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: user.id },
        });
      } catch (e) {
        results.errors.push(`${preview.entityType} ${preview.zohoId}: ${e instanceof Error ? e.message : "Unknown"}`);
      }
    }

    // Check if any previews are still pending (partial approval by entity type)
    const remainingPending = await prisma.zohoPullPreview.count({ where: { pullId, status: "PENDING" } });
    const newStatus = remainingPending > 0 ? "PARTIAL" : (results.errors.length > 0 ? "PARTIAL" : "APPROVED");

    await prisma.zohoPullLog.update({
      where: { pullId },
      data: { status: newStatus, approvedAt: remainingPending === 0 ? new Date() : undefined },
    });

    // The one durable record of what an approve actually did. Identifiers and counts only —
    // never the records themselves. This matters most in the case where the response never
    // arrives: if the function is killed at maxDuration the client sees a 504 with no body,
    // and without this line there is no way afterwards to tell what got in before the kill.
    log.info("approve finished", {
      pullId,
      requestedBy: user.id,
      entityType: entityType || "all",
      contacts: results.contacts,
      items: results.items,
      bills: results.bills,
      invoices: results.invoices,
      skipped: results.skipped,
      errors: results.errors.length,
      remainingPending,
      status: newStatus,
      ms: Date.now() - startedAt,
    });

    await logActivity(prisma, {
      module: "zoho", action: "imported", entityType: "ZohoPull", entityId: pullId, entityRef: pullId,
      details: `${results.invoices} deliveries, ${results.bills} shipments, ${results.skipped} skipped`,
      userId: user.id, userName: user.name,
    });

    return successResponse({
      action: "approved",
      entityType: entityType || "all",
      remainingPending,
      ...results,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Approval failed";
    log.error("approve failed", { message });
    return errorResponse(message, 500);
  }
}
