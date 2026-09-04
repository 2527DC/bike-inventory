export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// nodejs, explicitly: this route reaches SMTP (a raw socket on 587) and the FCM JWT signer
// (node crypto) through notify(). Neither works on the edge runtime, and the failure there
// is not self-explanatory. Node is the default today; this stops a later change from
// silently breaking sends. See the notifications plan, Part C and D.1.
// 60, not 30. Headroom for the bill and invoice steps, which fetch a page at a time and then
// write their previews in a fixed number of queries rather than one round trip per record.
export const maxDuration = 60;

import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { usersWithPermission } from "@/lib/rbac";
import { notify } from "@/lib/notify";
import {
  getBooks,
  getInventory,
  getZakya,
  type IntegrationClient,
} from "@/lib/integrations";
import { createLogger } from "@/lib/logger";

const log = createLogger("zoho:trigger-pull");

/*
 * MANUAL PULL (step-by-step):
 * ─────────────────────────
 * Bills:     Zoho Books (fallback Zakya POS)
 * Invoices:  Zakya POS (fallback Books)
 *
 * ITEMS and CONTACTS are gone. Products no longer come from Zoho at all — the catalog is
 * loaded by scripts/import-products.ts — and contacts had no caller once the central pull
 * card was removed. Vendors still arrive from Zoho: the BILL branch of pull-review/approve
 * find-or-creates one from the bill's vendor name.
 */

export async function POST(req: NextRequest) {
  // Captured for the catch. A 500 has to name WHICH step failed — init, items, bills and
  // finalize are indistinguishable otherwise. Kept as a separate object rather than hoisting
  // the destructured consts, so their type narrowing below is preserved.
  const ctx: { step?: string; pullId?: string } = {};

  try {
    // The user is kept: both Zoho notifications below name the person who pressed the button
    // in their body and leave them out of the recipients.
    const user = await requireFeature("zoho", "fetch");
    const body = await req.json();
    const { step, pullId: existingPullId, fromDate, searchText } = body as { step: string; pullId?: string; fromDate?: string; searchText?: string };
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

      const syncLog = await prisma.syncLog.create({
        data: { syncType: "cron-pull", status: "running", triggeredBy: "manual" },
      });

      // Check at least one source is connected.
      //
      // In parallel, and through the factory. Each of these is a config read plus a possible
      // token refresh, and there is no reason to do three of them one after another when the
      // answer to each is independent. The clients themselves are discarded here — this step
      // only reports which sources are usable — but they are request-scoped, so the later
      // steps that ask for the same provider reuse what this call already initialised.
      const [books, zakya, inventory] = await Promise.all([
        getBooks(),
        getZakya(),
        getInventory(),
      ]);
      const booksReady = !!books;
      const posReady = !!zakya;
      const inventoryReady = !!inventory;

      if (!booksReady && !posReady && !inventoryReady) {
        return errorResponse("No Zoho sources connected", 400);
      }

      const pullId = `pull-${Date.now()}`;

      // zoho.pull_started (§F.4): tell everyone ELSE who can pull that a sync is running — it
      // is also why they will get a 409 if they start their own. The SyncLog row above is
      // committed (no transaction here) and the source check has passed, so this is a real pull.
      // §F.0: after() sends once the response has gone out so the init step is not slowed.
      const actorId = user.id;
      const actorName = user.name;
      after(async () => {
        try {
          const recipients = (await usersWithPermission("zoho", "fetch")).filter((uid) => uid !== actorId);
          if (recipients.length === 0) {
            log.debug("pull started but nobody else holds zoho.fetch", { pullId });
            return;
          }
          await notify("zoho.pull_started", {
            recipients,
            title: "Zoho pull started",
            body: `${actorName} started a bills & invoices pull (bills from Zoho Books, invoices from Zakya POS)`,
            refId: syncLog.id,
            link: "/settings/integrations",
            data: {
              pullId,
              books: booksReady ? "connected" : "skipped",
              pos: posReady ? "connected" : "skipped",
            },
          });
        } catch (err) {
          log.error("zoho.pull_started notification failed", {
            pullId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

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
    const todayStr = new Date().toISOString().slice(0, 10);

    // ─── ITEMS: via Zoho Inventory (fallback Books) ───
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
          // Books first, Zakya as the fallback. `IntegrationClient` rather than `any`:
          // listAllBills lives on the base class, so both providers satisfy the type and the
          // eslint-disable that used to sit here is no longer needed.
          let client: IntegrationClient | null = await getBooks();
          if (client) source = "books";
          else {
            // Fallback to Zakya POS
            client = await getZakya();
            if (client) source = "pos";
          }

          if (!client) {
              log.warn("bills step skipped — no source connected", { pullId: existingPullId });
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

      log.info("bills step finished", { pullId: existingPullId, source, billsNew, apiCalls, errors: errors.length });
      return successResponse({ step: "bills", source, billsNew, apiCalls, errors });
    }

    // ─── INVOICES: via Zakya POS (fallback Books) ───
    if (step === "invoices") {
      let invoicesNew = 0;
      let apiCalls = 0;
      const errors: string[] = [];
      let source = "none";

      try {
        // Zakya POS first for invoices, Books as the fallback — the reverse of bills above,
        // which is deliberate and documented at the top of this file.
        let client: IntegrationClient | null = await getZakya();
        if (client) source = "pos";
        else {
          client = await getBooks();
          if (client) source = "books";
        }

        if (!client) {
            log.warn("invoices step skipped — no source connected", { pullId: existingPullId });
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

      log.info("invoices step finished", { pullId: existingPullId, source, invoicesNew, apiCalls, errors: errors.length });
      return successResponse({ step: "invoices", source, invoicesNew, apiCalls, errors });
    }

    // ─── FINALIZE ───
    if (step === "finalize") {
      // itemsNew and contactsNew are always 0 now — no step produces them. The two columns
      // stay on ZohoPullLog because the schema is deliberately untouched on this branch, and
      // a zero is honest: that pull genuinely imported no items and no contacts.
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
      // Hoisted so the SyncLog row and the notification below cannot disagree about the outcome.
      const pullStatus = allErrors.length > 0 ? "partial" : "success";
      if (syncLog) {
        await prisma.syncLog.update({
          where: { id: syncLog.id },
          data: {
            status: pullStatus,
            totalItems: totalNew,
            synced: totalNew,
            failed: allErrors.length,
            errors: allErrors.length > 0 ? JSON.stringify(allErrors.slice(0, 20)) : null,
            completedAt: new Date(),
          },
        });
      }

      // zoho.pull_finished (§F.4): the outcome, clean or partial, to everyone else who can pull.
      // Email defaults ON for this event — it is the one most likely to report something broken
      // while nobody is watching. §F.0: the SyncLog update above has committed; after() sends
      // once the response has gone out.
      {
        const actorId = user.id;
        const finishedPullId: string = existingPullId;
        const syncLogId = syncLog?.id;
        const errorCount = allErrors.length;
        const firstError = allErrors[0];
        after(async () => {
          try {
            // The OUTCOME event, unlike pull_started, falls back to including the actor.
            // zoho.fetch is a narrow grant — quite possibly ADMIN alone — so excluding the
            // person who pressed Pull could leave nobody at all, and this is the one event
            // that defaults email ON precisely because it reports something already broken.
            // Firing for nobody would also write no outbox row, so there would be no trace
            // that it tried. pull_started keeps the exclusion: that one is pure courtesy.
            const holders = await usersWithPermission("zoho", "fetch");
            const others = holders.filter((uid) => uid !== actorId);
            const recipients = others.length > 0 ? others : holders;
            if (recipients.length === 0) {
              log.warn("pull finished but nobody holds zoho.fetch", { pullId: finishedPullId });
              return;
            }
            const counts = `${billsNew} new bill${billsNew === 1 ? "" : "s"}, ${invoicesNew} new invoice${invoicesNew === 1 ? "" : "s"}`;
            const text =
              pullStatus === "partial"
                ? `${counts}. ${errorCount} error${errorCount === 1 ? "" : "s"} — first: ${firstError}`
                : `${counts}. No errors.`;
            await notify("zoho.pull_finished", {
              recipients,
              title: `Zoho pull ${pullStatus}`,
              body: text,
              refId: syncLogId ?? finishedPullId,
              link: "/settings/integrations",
              data: {
                pullId: finishedPullId,
                status: pullStatus,
                billsNew: String(billsNew),
                invoicesNew: String(invoicesNew),
                errors: String(errorCount),
              },
            });
          } catch (err) {
            log.error("zoho.pull_finished notification failed", {
              pullId: finishedPullId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        });
      }

      // Update lastSyncAt for all connected sources
      await prisma.integrationConfig.update({ where: { provider: "ZOHO_BOOKS" }, data: { lastSyncAt: new Date() } }).catch(() => {});
      await prisma.integrationConfig.update({ where: { provider: "ZAKYA_POS" }, data: { lastSyncAt: new Date() } }).catch(() => {});
      await prisma.integrationConfig.update({ where: { provider: "ZOHO_INVENTORY" }, data: { lastSyncAt: new Date() } }).catch(() => {});

      log.info("pull finalized", {
        pullId: existingPullId,
        status: totalNew > 0 ? "PENDING_REVIEW" : "NO_NEW_DATA",
        billsNew,
        invoicesNew,
        apiCallsUsed: apiCalls,
        errors: allErrors.length,
      });
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
