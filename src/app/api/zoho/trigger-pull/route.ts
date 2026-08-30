export const dynamic = "force-dynamic";
// 60, not 30. Headroom, NOT the fix — the fix is that `items` and `contacts` no longer do one
// database round trip per record (see buildItemPreviews below). Raising this alone would only
// move the cliff from ~400 items to ~800.
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { BooksClient, InventoryClient, ZakyaClient, type IntegrationItem } from "@/lib/integrations";
import { createLogger } from "@/lib/logger";

const log = createLogger("zoho:trigger-pull");

// A single `IN (...)` with several thousand values produces a very large query. Chunk the
// lookup and merge the results.
const LOOKUP_CHUNK = 1000;

/*
 * 3-SOURCE MANUAL PULL (step-by-step):
 * ─────────────────────────
 * Items:     Zoho Inventory (fallback Books)
 * Contacts:  Zoho Books
 * Bills:     Zoho Books (fallback Zakya POS)
 * Invoices:  Zakya POS (fallback Books)
 */

/**
 * Turn a batch of Zoho items into ZohoPullPreview rows, in a fixed number of queries.
 *
 * Replaces a per-item loop that ran two `product.findFirst` calls plus a `create` for EVERY
 * record. Each of those crosses Mumbai (`vercel.json` "regions": ["bom1"]) to Singapore
 * (`DATABASE_URL` ap-southeast-1) at roughly 40 ms, sequentially, so a ~400-item catalog spent
 * ~32 s on latency alone and the function died at `maxDuration` — the 504 users were seeing.
 * `bills` and `invoices` in this same file were already written this way; `items` and
 * `contacts` were simply never converted.
 *
 * Called from BOTH item sources on purpose. The ZOHO_INVENTORY path and the ZOHO_BOOKS
 * fallback ran equivalent loops, and fixing only the first would ship a fallback that still
 * times out — while testing green on any environment where Inventory is connected, which is
 * exactly where it would be tested.
 *
 * Returns the number of previews written.
 */
async function buildItemPreviews(items: IntegrationItem[], pullId: string): Promise<number> {
  // Zoho can return the same item_id on more than one page. ZohoPullPreview has NO unique
  // constraint on zohoId, so `createMany({ skipDuplicates })` cannot help — dedupe here or
  // the review screen lists the same product twice.
  const byId = new Map<string, IntegrationItem>();
  for (const item of items) {
    if (item.item_id) byId.set(item.item_id, item);
  }
  const unique = [...byId.values()];
  if (unique.length === 0) return 0;

  // Empty SKUs must never reach an `in` clause. Many Zoho items carry `sku: ""`, and
  // `{ sku: { in: ["", ...] } }` matches every local product with a blank SKU — which would
  // mark brand-new items as already existing and silently drop them from the review.
  const skus = [...new Set(unique.map((i) => i.sku).filter((s): s is string => !!s && s.trim() !== ""))];
  const ids = [...new Set(unique.map((i) => i.item_id).filter((s): s is string => !!s))];

  const knownSkus = new Set<string>();
  const knownIds = new Set<string>();
  const absorb = (rows: Array<{ sku: string | null; zohoItemId: string | null }>) => {
    for (const r of rows) {
      if (r.sku) knownSkus.add(r.sku);
      if (r.zohoItemId) knownIds.add(r.zohoItemId);
    }
  };

  for (let i = 0; i < skus.length; i += LOOKUP_CHUNK) {
    absorb(
      await prisma.product.findMany({
        where: { sku: { in: skus.slice(i, i + LOOKUP_CHUNK) } },
        select: { sku: true, zohoItemId: true },
      })
    );
  }
  for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
    absorb(
      await prisma.product.findMany({
        where: { zohoItemId: { in: ids.slice(i, i + LOOKUP_CHUNK) } },
        select: { sku: true, zohoItemId: true },
      })
    );
  }

  // Existing items are FROZEN — Zoho never modifies an item already in the app (brand,
  // category, pricing, SKU, name and stock all stay as edited). Only brand-new items are
  // pulled in for review. This is the set-based form of the `continue` the old loop used; it
  // is a deliberate business rule, not an optimisation, and must survive any rewrite.
  const fresh = unique.filter((item) => {
    if (item.sku && knownSkus.has(item.sku)) return false;
    if (item.item_id && knownIds.has(item.item_id)) return false;
    return true;
  });

  log.debug("items batched", {
    pullId,
    received: items.length,
    unique: unique.length,
    frozen: unique.length - fresh.length,
    new: fresh.length,
  });

  if (fresh.length === 0) return 0;

  await prisma.zohoPullPreview.createMany({
    data: fresh.map((item) => ({
      pullId,
      entityType: "item",
      zohoId: item.item_id,
      data: {
        name: item.name,
        sku: item.sku || "",
        costPrice: Number(item.purchase_rate || 0),
        sellingPrice: Number(item.rate || 0),
        gstRate: Number(item.tax_percentage || 18),
        hsnCode: String(item.hsn_or_sac || ""),
        stockOnHand: Number(item.stock_on_hand || 0),
        productType: String(item.product_type || item.item_type || ""),
        brand: String(item.brand || item.manufacturer || "").trim(),
        categoryName: String(item.category_name || ""),
      },
    })),
  });

  return fresh.length;
}

export async function POST(req: NextRequest) {
  // Captured for the catch. A 500 has to name WHICH step failed — init, items, bills and
  // finalize are indistinguishable otherwise. Kept as a separate object rather than hoisting
  // the destructured consts, so their type narrowing below is preserved.
  const ctx: { step?: string; pullId?: string } = {};

  try {
    await requireFeature("zoho", "fetch");
    const body = await req.json();
    const { step, pullId: existingPullId, fullImport, fromDate, searchText } = body as { step: string; pullId?: string; fullImport?: boolean; fromDate?: string; searchText?: string };
    ctx.step = step;
    ctx.pullId = existingPullId;

    // ─── INIT ───
    if (step === "init") {
      await prisma.syncLog.updateMany({
        where: {
          status: "running",
          syncType: "cron-pull",
          startedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) },
        },
        data: { status: "failed", completedAt: new Date(), errors: JSON.stringify(["Auto-cleared"]) },
      });

      const runningSync = await prisma.syncLog.findFirst({
        where: { status: "running", syncType: "cron-pull" },
      });
      if (runningSync) return errorResponse("Sync already in progress", 409);

      await prisma.syncLog.create({
        data: { syncType: "cron-pull", status: "running", triggeredBy: "manual" },
      });

      // Check at least one source is connected
      const zoho = new BooksClient();
      const booksReady = await zoho.init();
      const zakya = new ZakyaClient();
      const posReady = await zakya.init();
      const inventory = new InventoryClient();
      const inventoryReady = await inventory.init();

      if (!booksReady && !posReady && !inventoryReady) {
        return errorResponse("No Zoho sources connected", 400);
      }

      const pullId = `pull-${Date.now()}`;
      return successResponse({
        pullId, step: "init", message: "Ready",
        sources: {
          books: booksReady ? "connected" : "skipped",
          pos: posReady ? "connected" : "skipped",
          inventory: inventoryReady ? "connected" : "skipped",
        },
      });
    }

    if (!existingPullId) return errorResponse("pullId required", 400);

    // Default last sync — 7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const defaultLastSync = sevenDaysAgo.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);

    // ─── ITEMS: via Zoho Inventory (fallback Books) ───
    if (step === "items") {
      let itemsNew = 0;
      let apiCalls = 0;
      const errors: string[] = [];
      let source = "none";

      try {
        // Try Inventory first
        const inventory = new InventoryClient();
        const inventoryReady = await inventory.init();

        if (inventoryReady) {
          source = "inventory";
          const invConfig = await prisma.integrationConfig.findUnique({ where: { provider: "ZOHO_INVENTORY" } });
          const lastSync = fromDate || invConfig?.lastSyncAt?.toISOString().slice(0, 10) || defaultLastSync;
          const allItems = await inventory.listAllItems("active", fullImport ? undefined : lastSync);
          apiCalls += Math.ceil(allItems.length / 200) || 1;
          const items = allItems.filter(item => Number(item.stock_on_hand || 0) > 0);

          itemsNew += await buildItemPreviews(items, existingPullId);
        } else {
          // Fallback to Books
          const zoho = new BooksClient();
          const booksReady = await zoho.init();
          if (booksReady) {
            source = "books";
            const booksConfig = await prisma.integrationConfig.findUnique({ where: { provider: "ZOHO_BOOKS" } });
            const lastSync = fromDate || booksConfig?.lastSyncAt?.toISOString().slice(0, 10) || defaultLastSync;
            const allItems = await zoho.listAllItems("active", fullImport ? undefined : lastSync);
            apiCalls += Math.ceil(allItems.length / 200) || 1;
            const items = allItems.filter(item => Number(item.stock_on_hand || 0) > 0);

            // Same helper as the Inventory path above. These two loops were byte-for-byte
            // equivalent apart from a redundant `as Record<string, unknown>` cast — every
            // field it reached for is already on IntegrationItem.
            itemsNew += await buildItemPreviews(items, existingPullId);
          } else {
            errors.push("Items: no source connected");
          }
        }
      } catch (e) {
        log.error("items step failed", { pullId: existingPullId, source, itemsNew, message: e instanceof Error ? e.message : "Unknown" });
        errors.push(`Items: ${e instanceof Error ? e.message : "Unknown"}`);
      }

      log.info("items step finished", { pullId: existingPullId, source, itemsNew, apiCalls, errors: errors.length });
      return successResponse({ step: "items", source, itemsNew, apiCalls, errors });
    }

    // ─── CONTACTS: via Zoho Books ───
    if (step === "contacts") {
      let contactsNew = 0;
      let apiCalls = 0;
      const errors: string[] = [];

      try {
        const zoho = new BooksClient();
        const booksReady = await zoho.init();
        if (!booksReady) {
          return successResponse({ step: "contacts", source: "skipped", contactsNew: 0, apiCalls: 0, errors: ["Books not connected"] });
        }

        const booksConfig = await prisma.integrationConfig.findUnique({ where: { provider: "ZOHO_BOOKS" } });
        const lastSync = booksConfig?.lastSyncAt?.toISOString().slice(0, 10) || defaultLastSync;
        const contacts = await zoho.listAllContacts(lastSync);
        apiCalls += Math.ceil(contacts.length / 200) || 1;
        const vendors = contacts.filter((c) => c.contact_type === "vendor");

        for (const contact of vendors) {
          const existing = await prisma.vendor.findFirst({
            where: { name: { equals: contact.contact_name, mode: "insensitive" } },
          });
          if (existing) continue;

          await prisma.zohoPullPreview.create({
            data: {
              pullId: existingPullId,
              entityType: "contact",
              zohoId: contact.contact_id,
              data: {
                name: contact.contact_name,
                gstin: contact.gst_no || "",
                email: contact.email || "",
                phone: contact.phone || "",
                city: contact.billing_address?.city || "",
                state: contact.billing_address?.state || "",
              },
            },
          });
          contactsNew++;
        }
      } catch (e) {
        errors.push(`Contacts: ${e instanceof Error ? e.message : "Unknown"}`);
      }

      return successResponse({ step: "contacts", source: "books", contactsNew, apiCalls, errors });
    }

    // ─── BILLS: via Zoho Inventory (fallback Zakya → Books) ───
    if (step === "bills") {
      let billsNew = 0;
      let apiCalls = 0;
      const errors: string[] = [];
      let source = "none";

      try {
        // Enforce minimum date: April 1 of current FY
        const fyStart = "2026-04-01";
        let billsFromDate = fromDate || todayStr;
        if (billsFromDate < fyStart) billsFromDate = fyStart;

        // Use Zoho Books for bills (Inventory token lacks bills scope)
        {
          const zoho = new BooksClient();
          const booksReady = await zoho.init();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let client: any = null;
          if (booksReady) { client = zoho; source = "books"; }
          else {
            // Fallback to Zakya POS
            const zakya = new ZakyaClient();
            if (await zakya.init()) { client = zakya; source = "pos"; }
          }

          if (!client) {
            return successResponse({ step: "bills", source: "skipped", billsNew: 0, apiCalls: 0, errors: ["No source connected for bills"] });
          }

          const bills = await client.listAllBills(searchText ? undefined : billsFromDate, searchText ? undefined : todayStr, searchText);
          apiCalls += Math.ceil(bills.length / 200) || 1;

          const billNumbers = bills.map((b: { bill_number: string }) => b.bill_number);
          const existingBills = await prisma.vendorBill.findMany({
            where: { billNo: { in: billNumbers } },
            select: { billNo: true, id: true, inboundShipment: { select: { id: true, shipmentNo: true, status: true } }, _count: { select: { payments: true } } },
          });
          // Auto-cleanup orphaned VendorBills (no shipment + no payments) so they can be re-fetched
          const orphanedBillIds = existingBills
            .filter((b) => !b.inboundShipment && b._count.payments === 0)
            .map((b) => b.id);
          if (orphanedBillIds.length > 0) {
            await prisma.vendorBill.deleteMany({ where: { id: { in: orphanedBillIds } } });
          }
          // Only block bills that still have a shipment or payments
          const existingMap = new Map(
            existingBills
              .filter((b) => b.inboundShipment || b._count.payments > 0)
              .map((b) => [b.billNo, b])
          );
          const newBills = bills.filter((b: { bill_number: string }) => !existingMap.has(b.bill_number));

          // Report already-imported bills with location info
          const skippedBills = bills.filter((b: { bill_number: string }) => existingMap.has(b.bill_number));
          for (const sb of skippedBills) {
            const existing = existingMap.get((sb as { bill_number: string }).bill_number);
            const shipment = existing?.inboundShipment;
            if (shipment) {
              errors.push(`${(sb as { bill_number: string }).bill_number}: already imported → ${shipment.shipmentNo} (${shipment.status})`);
            } else {
              errors.push(`${(sb as { bill_number: string }).bill_number}: already imported (in accounts)`);
            }
          }

          if (newBills.length > 0) {
            // Clean up old preview records for these bills (from previous pulls) so they aren't blocked
            const newBillZohoIds = newBills.map((b: { bill_id: string }) => b.bill_id);
            await prisma.zohoPullPreview.deleteMany({
              where: { zohoId: { in: newBillZohoIds }, entityType: "bill", status: { in: ["APPROVED", "REJECTED"] } },
            });

            await prisma.$transaction(
              newBills.map((bill: { bill_id: string; bill_number: string; vendor_name: string; date: string; due_date: string; total: number; balance: number; status: string }) =>
                prisma.zohoPullPreview.create({
                  data: {
                    pullId: existingPullId,
                    entityType: "bill",
                    zohoId: bill.bill_id,
                    data: {
                      billNumber: bill.bill_number,
                      vendorName: bill.vendor_name,
                      date: bill.date,
                      dueDate: bill.due_date,
                      total: bill.total,
                      balance: bill.balance,
                      status: bill.status,
                      lineItems: [],
                    },
                  },
                })
              )
            );
            billsNew = newBills.length;
          }
        }
      } catch (e) {
        errors.push(`Bills: ${e instanceof Error ? e.message : "Unknown"}`);
      }

      return successResponse({ step: "bills", source, billsNew, apiCalls, errors });
    }

    // ─── INVOICES: via Zakya POS (fallback Books) ───
    if (step === "invoices") {
      let invoicesNew = 0;
      let apiCalls = 0;
      const errors: string[] = [];
      let source = "none";

      try {
        // Try Zakya POS first
        const zakya = new ZakyaClient();
        const posReady = await zakya.init();

        // Determine which client and source to use
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let client: any = null;
        if (posReady) {
          client = zakya;
          source = "pos";
        } else {
          const zoho = new BooksClient();
          const booksReady = await zoho.init();
          if (booksReady) {
            client = zoho;
            source = "books";
          }
        }

        if (!client) {
          return successResponse({ step: "invoices", source: "skipped", invoicesNew: 0, apiCalls: 0, errors: ["No source connected"] });
        }

        const invoicesFromDate = fromDate || todayStr;
        const invoices = await client.listAllInvoices(searchText ? undefined : invoicesFromDate, searchText ? undefined : todayStr, searchText);
        apiCalls += Math.ceil(invoices.length / 200) || 1;

        // Batch check existing invoices in one query
        const invoiceNumbers = invoices
          .filter((inv: { status: string }) => inv.status !== "void")
          .map((inv: { invoice_number: string }) => inv.invoice_number);
        const existingInvoices = await prisma.delivery.findMany({
          where: { invoiceNo: { in: invoiceNumbers } },
          select: { invoiceNo: true },
        });
        const existingInvSet = new Set(existingInvoices.map((d) => d.invoiceNo));
        const newInvoices = invoices.filter(
          (inv: { status: string; invoice_number: string }) =>
            inv.status !== "void" &&
            !existingInvSet.has(inv.invoice_number) &&
            !inv.invoice_number.startsWith("BCC/") // Skip Bharath Cycle Centre invoices
        );

        // Batch create all previews in one transaction
        if (newInvoices.length > 0) {
          await prisma.$transaction(
            newInvoices.map((invoice: { invoice_id: string; invoice_number: string; customer_name: string; phone?: string; date: string; total: number; balance: number; status: string }) =>
              prisma.zohoPullPreview.create({
                data: {
                  pullId: existingPullId,
                  entityType: "invoice",
                  zohoId: invoice.invoice_id,
                  data: {
                    invoiceNumber: invoice.invoice_number,
                    customerName: invoice.customer_name,
                    phone: invoice.phone || "",
                    date: invoice.date,
                    total: invoice.total,
                    balance: invoice.balance,
                    status: invoice.status,
                    salesPerson: "",
                    lineItems: [],
                  },
                },
              })
            )
          );
          invoicesNew = newInvoices.length;
        }
      } catch (e) {
        errors.push(`Invoices: ${e instanceof Error ? e.message : "Unknown"}`);
      }

      return successResponse({ step: "invoices", source, invoicesNew, apiCalls, errors });
    }

    // ─── FINALIZE ───
    if (step === "finalize") {
      const { itemsNew = 0, contactsNew = 0, billsNew = 0, invoicesNew = 0, apiCalls = 0, allErrors = [] } = body as {
        itemsNew?: number; contactsNew?: number; billsNew?: number; invoicesNew?: number;
        apiCalls?: number; allErrors?: string[];
      };

      await prisma.zohoPullLog.create({
        data: {
          pullId: existingPullId,
          contactsNew,
          itemsNew,
          billsNew,
          invoicesNew,
          apiCallsUsed: apiCalls,
          errors: allErrors.length > 0 ? JSON.stringify(allErrors) : null,
        },
      });

      const totalNew = contactsNew + itemsNew + billsNew + invoicesNew;

      const syncLog = await prisma.syncLog.findFirst({
        where: { status: "running", syncType: "cron-pull" },
        orderBy: { startedAt: "desc" },
      });
      if (syncLog) {
        await prisma.syncLog.update({
          where: { id: syncLog.id },
          data: {
            status: allErrors.length > 0 ? "partial" : "success",
            totalItems: totalNew,
            synced: totalNew,
            failed: allErrors.length,
            errors: allErrors.length > 0 ? JSON.stringify(allErrors.slice(0, 20)) : null,
            completedAt: new Date(),
          },
        });
      }

      // Update lastSyncAt for all connected sources
      await prisma.integrationConfig.update({ where: { provider: "ZOHO_BOOKS" }, data: { lastSyncAt: new Date() } }).catch(() => {});
      await prisma.integrationConfig.update({ where: { provider: "ZAKYA_POS" }, data: { lastSyncAt: new Date() } }).catch(() => {});
      await prisma.integrationConfig.update({ where: { provider: "ZOHO_INVENTORY" }, data: { lastSyncAt: new Date() } }).catch(() => {});

      return successResponse({
        pullId: existingPullId,
        status: totalNew > 0 ? "PENDING_REVIEW" : "NO_NEW_DATA",
        contactsNew,
        itemsNew,
        billsNew,
        invoicesNew,
        apiCallsUsed: apiCalls,
        errors: allErrors.slice(0, 10),
      });
    }

    return errorResponse("Invalid step", 400);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    // failure() writes the message AND the stack to the server log before answering the
    // client. Without it a 500 here left nothing behind to identify which call failed.
    return failure(error, { scope: "zoho:trigger-pull", ...ctx });
  }
}
