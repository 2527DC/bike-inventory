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
  type IntegrationBill,
  type IntegrationInvoice,
} from "@/lib/integrations";
import { createLogger } from "@/lib/logger";
import { zohoPullSchema } from "@/lib/validations";
import { resolveBillWindow, type ResolvedWindow } from "@/lib/zoho/date-window";
import { getTodayIST } from "@/lib/services/timezone";
import { logActivity } from "@/lib/activity-log";
import { storeIdForInvoice } from "@/lib/deliveries/zoho-invoice";

const log = createLogger("zoho:trigger-pull");

/**
 * Close the `running` SyncLog row this pull created (R1).
 *
 * THE WEDGE THIS REMOVES. `init` creates a `running` row BEFORE anything can fail, and only
 * `finalize` ever cleared it. Any early return or throw in bills/invoices left the row behind,
 * and the next `init` within two minutes answered 409 "Sync already in progress" — so the
 * FIRST failure was invisible and the SECOND click reported a wedge that had nothing to do
 * with what actually went wrong. Every early exit below calls this.
 */
async function closeRunningSync(reason: string) {
  try {
    const row = await prisma.syncLog.findFirst({
      where: { status: "running", syncType: "cron-pull" },
      orderBy: { startedAt: "desc" },
    });
    if (!row) return;
    await prisma.syncLog.update({
      where: { id: row.id },
      data: { status: "failed", completedAt: new Date(), errors: JSON.stringify([reason]) },
    });
    log.info("running sync closed", { syncLogId: row.id, reason });
  } catch (e) {
    log.error("could not close the running sync row", {
      reason,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Why no client could be built, in words a person can act on.
 *
 * `init()` returns the same `false` for "never connected" and "the refresh token was
 * refused", which is the root of "fetch does nothing": both looked like "no new invoices".
 * `isConnected` plus `lastAuthErrorAt` (MIG-1a) separate them.
 */
async function noSourceMessage(): Promise<string> {
  const configs = await prisma.integrationConfig.findMany({
    select: { provider: true, isConnected: true, lastAuthErrorAt: true },
  });
  const refused = configs.find((c) => c.isConnected && c.lastAuthErrorAt);
  if (refused) {
    return `Zoho is connected but its token was refused — reconnect it on Settings › Integrations.`;
  }
  return "Zoho is not connected — connect it on Settings › Integrations.";
}

/** The §5.2 skip block, built once so bills and invoices cannot drift apart. */
type SkipReason = "alreadyImported" | "void" | "centre";
interface SkipItem {
  ref: string;
  reason: SkipReason;
  where?: "inbound" | "accounts" | "deliveries";
  id?: string;
  no?: string;
  status?: string;
}

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

    // Zod at the boundary. The old bare cast named four fields and dropped `days` and
    // `toDate` on the floor, which is exactly why the date chips appeared to do nothing.
    const parsed = zohoPullSchema.safeParse(await req.json());
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request", 400);
    }
    const body = parsed.data;
    const { step, pullId: existingPullId, days, fromDate, toDate, searchText } = body;
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
      if (runningSync) return errorResponse("A Zoho pull is already running. Wait for it to finish, or try again in two minutes.", 409);

      // SOURCE CHECK FIRST, ROW SECOND.
      //
      // This order is the fix, not a tidy-up. The create used to come first, so a "no source
      // connected" refusal left a `running` row behind and the user's immediate retry got a
      // 409 about a pull that never started — two different failures, one confusing message.
      // Nothing is written until we know a pull can actually happen.
      //
      // In parallel, and through the factory: each is a config read plus a possible token
      // refresh, and the answers are independent. The clients are discarded here (this step
      // only reports which sources are usable) but they are request-scoped, so the later
      // steps reuse what this call initialised.
      const [books, zakya, inventory] = await Promise.all([
        getBooks(),
        getZakya(),
        getInventory(),
      ]);
      const booksReady = !!books;
      const posReady = !!zakya;
      const inventoryReady = !!inventory;

      if (!booksReady && !posReady && !inventoryReady) {
        const message = await noSourceMessage();
        log.warn("init refused — no usable Zoho source", { message });
        // 409, not 400: nothing about the REQUEST is malformed. It is the system's state
        // that makes the pull impossible, and the client shows this sentence verbatim.
        return errorResponse(message, 409);
      }

      const syncLog = await prisma.syncLog.create({
        data: { syncType: "cron-pull", status: "running", triggeredBy: "manual" },
      });

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

    // THE WINDOW, resolved once for bills and invoices alike.
    //
    // Replaces `todayStr = new Date().toISOString().slice(0,10)` — the SERVER'S UTC date,
    // which is yesterday for the first 5.5 hours of every Indian day — and the hardcoded
    // `fyStart = "2026-04-01"`, which becomes wrong on the next 1 April, silently.
    //
    // A search overrides the window entirely: "find bill 12345" should not also be filtered
    // to the last three days.
    let window: ResolvedWindow | null = null;
    if (!searchText && step !== "finalize") {
      try {
        window = resolveBillWindow({ days, fromDate, toDate }, getTodayIST());
      } catch (e) {
        // The caller's RANGE is wrong — that is a 400, and it is not a pull failure, so the
        // running row is closed rather than left to wedge the next attempt.
        const message = e instanceof Error ? e.message : "Invalid date range";
        log.warn("window rejected", { pullId: existingPullId, days, fromDate, toDate, message });
        await closeRunningSync(`Invalid date range: ${message}`);
        return errorResponse(message, 400);
      }
    }

    // ─── ITEMS: via Zoho Inventory (fallback Books) ───
    // ─── BILLS: via Zoho Inventory (fallback Zakya → Books) ───
    if (step === "bills") {
      let billsNew = 0;
      let apiCalls = 0;
      const errors: string[] = [];
      const skippedItems: SkipItem[] = [];
      let alreadyImported = 0;
      let source = "none";
      let fetched = 0;

      {
        // Books first, Zakya as the fallback. `IntegrationClient` rather than `any`:
        // listAllBills lives on the base class, so both providers satisfy the type.
        let client: IntegrationClient | null = await getBooks();
        if (client) source = "books";
        else {
          client = await getZakya();
          if (client) source = "pos";
        }

        // NO CLIENT IS A 409, NOT A 200.
        //
        // This is root cause #1 of "fetch does nothing": the step used to answer HTTP 200
        // with `billsNew: 0`, which the screen rendered as "No new bills found". A
        // disconnected Zoho and a genuinely quiet week were indistinguishable.
        if (!client) {
          const message = await noSourceMessage();
          log.warn("bills step has no source", { pullId: existingPullId, message });
          await closeRunningSync("No Zoho source connected for bills");
          return errorResponse(message, 409);
        }

        let bills: IntegrationBill[];
        try {
          log.info("bills window resolved", {
            pullId: existingPullId,
            mode: searchText ? "search" : "range",
            from: window?.from,
            to: window?.to,
            clampedToFy: window?.clampedToFy,
          });
          bills = await client.listAllBills(window?.from, window?.to, searchText);
        } catch (e) {
          // A PROVIDER failure is a 502, not a swallowed entry in `errors[]` beside
          // `success: true` — root cause #4. The client never read `errors`, so a Zoho
          // outage was reported to the user as "no new bills".
          const message = e instanceof Error ? e.message : "Unknown error";
          log.error("bills listing failed", { pullId: existingPullId, source, message });
          await closeRunningSync(`Zoho ${source}: ${message}`);
          return errorResponse(`Zoho ${source}: ${message}`, 502);
        }

        {
          fetched = bills.length;
          apiCalls += Math.ceil(bills.length / 200) || 1;

          const billNumbers = bills.map((b) => b.bill_number);
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
          const newBills = bills.filter((b) => !existingMap.has(b.bill_number));

          // ALREADY-IMPORTED IS NOT AN ERROR.
          //
          // These used to be pushed into `errors[]`, which made `finalize` report the pull as
          // "partial" and the notification announce failures — for the entirely normal case
          // of re-fetching a window whose bills are already in. They belong in `skipped`
          // (§5.2), which the inbound screen renders as a neutral "Already imported" card.
          const skippedBills = bills.filter((b) => existingMap.has(b.bill_number));
          for (const sb of skippedBills) {
            const ref = sb.bill_number;
            const existing = existingMap.get(ref);
            const shipment = existing?.inboundShipment;
            alreadyImported++;
            skippedItems.push(
              shipment
                ? { ref, reason: "alreadyImported", where: "inbound", id: shipment.id, no: shipment.shipmentNo, status: shipment.status }
                : { ref, reason: "alreadyImported", where: "accounts" }
            );
          }

          if (newBills.length > 0) {
            // Clean up old preview records for these bills (from previous pulls) so they aren't blocked
            const newBillZohoIds = newBills.map((b) => b.bill_id);
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
      }

      log.info("bills step finished", {
        pullId: existingPullId, source, fetched, billsNew, alreadyImported, apiCalls, errors: errors.length,
      });

      await logActivity(prisma, {
        module: "zoho", action: "pulled", entityType: "ZohoPull", entityId: existingPullId,
        entityRef: existingPullId,
        fromValue: window?.from ?? null, toValue: window?.to ?? null,
        details: `${billsNew} new bill${billsNew === 1 ? "" : "s"} via ${source}`,
        userId: user.id, userName: user.name,
      });

      // §5.2 response shape, shared with invoices.
      return successResponse({
        step: "bills", source, window,
        fetched, billsNew,
        skipped: { counts: { alreadyImported }, items: skippedItems },
        apiCalls, errors,
      });
    }

    // ─── INVOICES: via Zakya POS (fallback Books) ───
    if (step === "invoices") {
      let invoicesNew = 0;
      let apiCalls = 0;
      const errors: string[] = [];
      const skippedItems: SkipItem[] = [];
      let alreadyImported = 0;
      let voidCount = 0;
      const byStore: Record<string, number> = {};
      let source = "none";
      let fetched = 0;

      // Zakya POS first for invoices, Books as the fallback — the reverse of bills above,
      // which is deliberate and documented at the top of this file.
      let client: IntegrationClient | null = await getZakya();
      if (client) source = "pos";
      else {
        client = await getBooks();
        if (client) source = "books";
      }

      // Root cause #1 again: a 409 with a sentence, not a 200 that reads as "nothing new".
      if (!client) {
        const message = await noSourceMessage();
        log.warn("invoices step has no source", { pullId: existingPullId, message });
        await closeRunningSync("No Zoho source connected for invoices");
        return errorResponse(message, 409);
      }

      let invoices: IntegrationInvoice[];
      try {
        log.info("invoices window resolved", {
          pullId: existingPullId,
          mode: searchText ? "search" : "range",
          from: window?.from, to: window?.to, clampedToFy: window?.clampedToFy,
        });
        invoices = await client.listAllInvoices(window?.from, window?.to, searchText);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        log.error("invoices listing failed", { pullId: existingPullId, source, message });
        await closeRunningSync(`Zoho ${source}: ${message}`);
        return errorResponse(`Zoho ${source}: ${message}`, 502);
      }

      fetched = invoices.length;
      apiCalls += Math.ceil(invoices.length / 200) || 1;

      // Every store, for prefix attribution. Two rows; loaded once.
      const stores = await prisma.store.findMany({
        select: { id: true, code: true, invoicePrefix: true, isActive: true, sortOrder: true },
      });

      const liveInvoices = invoices.filter((inv) => inv.status !== "void");
      for (const inv of invoices) {
        if (inv.status === "void") {
          voidCount++;
          skippedItems.push({ ref: inv.invoice_number, reason: "void" });
        }
      }

      const existingInvoices = await prisma.delivery.findMany({
        where: { invoiceNo: { in: liveInvoices.map((i) => i.invoice_number) } },
        select: { invoiceNo: true, id: true, status: true },
      });
      const existingInvMap = new Map(existingInvoices.map((d) => [d.invoiceNo, d]));

      const newInvoices: IntegrationInvoice[] = [];
      for (const inv of liveInvoices) {
        const ref = inv.invoice_number;
        const already = existingInvMap.get(ref);
        if (already) {
          alreadyImported++;
          skippedItems.push({
            ref, reason: "alreadyImported", where: "deliveries", id: already.id, status: already.status,
          });
          continue;
        }
        newInvoices.push(inv);
      }

      // THE `BCC/` SKIP IS GONE (O8, owner 4 Sep).
      //
      // It was `!inv.invoice_number.startsWith("BCC/")` — a store NAME hardcoded in three
      // routes, hiding a real store with its own GSTIN and its own stock. Bharath Cycle
      // Centre's invoices were silently never imported, so its deliveries never existed and
      // its stock never moved. They are imported now and TAGGED with their store instead,
      // resolved from Store.invoicePrefix. An invoice matching no prefix still imports; it
      // simply carries storeId: null and is counted so the summary can say so.
      if (newInvoices.length > 0) {
        await prisma.$transaction(
          newInvoices.map((invoice) => {
            const invoiceNo = invoice.invoice_number;
            const storeId = storeIdForInvoice(invoiceNo, stores);
            const store = stores.find((s) => s.id === storeId);
            const key = store?.code ?? "unmatchedPrefix";
            byStore[key] = (byStore[key] ?? 0) + 1;
            return prisma.zohoPullPreview.create({
              data: {
                pullId: existingPullId,
                entityType: "invoice",
                zohoId: invoice.invoice_id,
                data: {
                  invoiceNumber: invoiceNo,
                  customerName: invoice.customer_name,
                  phone: invoice.phone || "",
                  date: invoice.date,
                  total: invoice.total,
                  balance: invoice.balance,
                  status: invoice.status,
                  salesPerson: "",
                  lineItems: [],
                  // Which client fetched this, so approve can ask the SAME provider for the
                  // detail. Named `provider`, NOT `source`: pull-review/approve already
                  // destructures a body field called `source` meaning "accounting-only
                  // import", and reusing the name would mislead every reader of that file.
                  provider: source,
                  storeId: storeId ?? null,
                },
              },
            });
          })
        );
        invoicesNew = newInvoices.length;
      }

      log.info("invoices step finished", {
        pullId: existingPullId, source, fetched, invoicesNew,
        alreadyImported, voidCount, byStore, apiCalls, errors: errors.length,
      });

      await logActivity(prisma, {
        module: "zoho", action: "pulled", entityType: "ZohoPull", entityId: existingPullId,
        entityRef: existingPullId,
        fromValue: window?.from ?? null, toValue: window?.to ?? null,
        details: `${invoicesNew} new invoice${invoicesNew === 1 ? "" : "s"} via ${source}`,
        userId: user.id, userName: user.name,
      });

      return successResponse({
        step: "invoices", source, window,
        fetched, invoicesNew,
        skipped: { counts: { alreadyImported, void: voidCount, byStore }, items: skippedItems },
        apiCalls, errors,
      });
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
