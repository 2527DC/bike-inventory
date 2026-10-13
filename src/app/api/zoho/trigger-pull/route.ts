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
import { floorWarehouseForInvoice, listFloorWarehousesWithPrefix } from "@/lib/deliveries/zoho-invoice";
import { toPlus91 } from "@/lib/phone";
import { describeZohoCreditError, parseZohoTimestamp, round2 } from "@/lib/payables/sync-vendor-credit";

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

// ─── The credit steps (plan 1210 credit notes, Parts 3.3 and 8.2) ───────────────────────────

type CreditStep = "vendorcredits" | "creditnotes";

/** One Zoho row of either kind, reduced to what classification and the preview need. */
interface CreditRow {
  zohoId: string;
  number: string;
  status: string;
  lastModified: Date | null;
  total: number;
  data: Record<string, string | number | null>;
}

/** What is here already, by Zoho id. `amount` is the stored total, for the no-timestamp fallback. */
interface LocalCredit {
  id: string;
  zohoLastModifiedAt: Date | null;
  status: string;
  amount: number;
}

const CREDIT_STEP: Record<CreditStep, { entityType: string; one: string; many: string; where: SkipItem["where"] }> = {
  vendorcredits: { entityType: "vendorcredit", one: "vendor credit", many: "vendor credits", where: "accounts" },
  creditnotes: { entityType: "creditnote", one: "credit note", many: "credit notes", where: "receivables" },
};

/**
 * Fetch vendor credits or customer credit notes changed in Zoho since the window's start, and
 * stage the ones that need a decision as previews.
 *
 * Classification (Part 3.3): `draft` → skipped "draft" (Q10). Not here → "new" (a void one never
 * imported is skipped "void" — there is nothing of it to remove). Here, and Zoho's
 * last_modified_time is newer than ours → "update", or "void" when Zoho now says void. Otherwise
 * skipped "alreadyImported".
 */
async function creditStep(
  step: CreditStep,
  ctx: { pullId: string; window: ResolvedWindow | null; searchText?: string; userId: string; userName: string },
) {
  const cfg = CREDIT_STEP[step];
  const { pullId, window, searchText } = ctx;
  const skippedItems: SkipItem[] = [];
  let alreadyImported = 0;
  let drafts = 0;
  let voidSkipped = 0;

  // Books only: Zakya and Zoho Inventory have no purchase-side credit notes, and D2 names one
  // Books organisation. No client is the same 409 the bills step answers.
  const books = await getBooks();
  if (!books) {
    const message = await noSourceMessage();
    log.warn(`${step} step has no source`, { pullId, message });
    await closeRunningSync(`No Zoho Books connection for ${cfg.many}`);
    return errorResponse(message, 409);
  }

  // The window is sent as last_modified_time ≥ from, not as a date range (Part 3.3). A search
  // overrides it, as for bills.
  const modifiedFrom = searchText ? undefined : window?.from;
  log.info(`${step} window resolved`, {
    pullId, mode: searchText ? "search" : "modifiedSince", modifiedFrom, clampedToFy: window?.clampedToFy,
  });

  let rows: CreditRow[];
  try {
    if (step === "vendorcredits") {
      const list = await books.listAllVendorCredits(modifiedFrom, searchText);
      rows = list.map((r) => ({
        zohoId: r.vendor_credit_id,
        number: r.vendor_credit_number,
        status: (r.status || "").toLowerCase(),
        lastModified: parseZohoTimestamp(r.last_modified_time),
        total: round2(Number(r.total) || 0),
        data: {
          creditNumber: r.vendor_credit_number,
          referenceNumber: r.reference_number || null,
          vendorName: r.vendor_name,
          // Approve resolves the Vendor by this, exactly as for bills (plan 2409).
          vendorId: r.vendor_id || null,
          vendorSource: "books",
          date: r.date,
          total: Number(r.total) || 0,
          balance: Number(r.balance) || 0,
          status: r.status,
          lastModifiedTime: r.last_modified_time || null,
          locationId: r.location_id || null,
        },
      }));
    } else {
      const list = await books.listAllCreditNotes(modifiedFrom, searchText);
      rows = list.map((r) => ({
        zohoId: r.creditnote_id,
        number: r.creditnote_number,
        status: (r.status || "").toLowerCase(),
        lastModified: parseZohoTimestamp(r.last_modified_time),
        total: round2(Number(r.total) || 0),
        data: {
          creditNoteNumber: r.creditnote_number,
          referenceNumber: r.reference_number || null,
          customerName: r.customer_name,
          customerId: r.customer_id || null,
          date: r.date,
          total: Number(r.total) || 0,
          balance: Number(r.balance) || 0,
          status: r.status,
          lastModifiedTime: r.last_modified_time || null,
          locationId: r.location_id || null,
        },
      }));
    }
  } catch (e) {
    // Phase 0, 13 Oct 2026: the stored token lacks debitnotes.READ / creditnotes.READ and Zoho
    // answers 401 code 57. That is a connection to fix, not an outage — a 409 with the sentence
    // that says which permission and where. Anything else is Zoho failing: 502.
    const { message, missingScope } = describeZohoCreditError(e);
    if (missingScope) {
      log.warn(`${step} refused by Zoho — missing scope`, { pullId });
      await closeRunningSync(`Zoho Books refused ${cfg.many}: missing scope`);
      return errorResponse(message, 409);
    }
    log.error(`${step} listing failed`, { pullId, message });
    await closeRunningSync(`Zoho books: ${message}`);
    return errorResponse(`Zoho Books: ${message}`, 502);
  }

  const fetched = rows.length;
  const apiCalls = Math.ceil(fetched / 200) || 1;

  // What is here already, in one read.
  const zohoIds = rows.map((r) => r.zohoId).filter(Boolean);
  const local = new Map<string, LocalCredit>();
  if (zohoIds.length > 0) {
    if (step === "vendorcredits") {
      const found = await prisma.vendorCredit.findMany({
        where: { zohoVendorCreditId: { in: zohoIds } },
        select: { id: true, zohoVendorCreditId: true, zohoLastModifiedAt: true, status: true, amount: true },
      });
      for (const c of found) {
        local.set(c.zohoVendorCreditId as string, { id: c.id, zohoLastModifiedAt: c.zohoLastModifiedAt, status: c.status, amount: c.amount });
      }
    } else {
      const found = await prisma.customerCreditNote.findMany({
        where: { zohoCreditNoteId: { in: zohoIds } },
        select: { id: true, zohoCreditNoteId: true, zohoLastModifiedAt: true, status: true, total: true },
      });
      for (const c of found) {
        local.set(c.zohoCreditNoteId, { id: c.id, zohoLastModifiedAt: c.zohoLastModifiedAt, status: c.status, amount: Number(c.total) });
      }
    }
  }

  const staged: Array<{ row: CreditRow; action: "new" | "update" | "void"; localId: string | null }> = [];
  for (const row of rows) {
    const ref = row.number || row.zohoId;
    if (row.status === "draft") {
      drafts++;
      skippedItems.push({ ref, reason: "draft" });
      continue;
    }
    const here = local.get(row.zohoId);
    if (!here) {
      if (row.status === "void") {
        voidSkipped++;
        skippedItems.push({ ref, reason: "void" });
        continue;
      }
      staged.push({ row, action: "new", localId: null });
      continue;
    }
    // Changed since our copy? By Zoho's timestamp when both sides have one; without it, by the
    // fields a person would notice.
    const changed =
      row.lastModified && here.zohoLastModifiedAt
        ? row.lastModified.getTime() > here.zohoLastModifiedAt.getTime()
        : row.lastModified
          ? true
          : row.status.toUpperCase() !== here.status || Math.abs(row.total - here.amount) > 0.01;
    const nowVoid = row.status === "void";
    if (!changed || (nowVoid && here.status === "VOID")) {
      alreadyImported++;
      skippedItems.push({ ref, reason: "alreadyImported", where: cfg.where, id: here.id, status: here.status });
      continue;
    }
    staged.push({ row, action: nowVoid ? "void" : "update", localId: here.id });
  }

  if (staged.length > 0) {
    // Old decided previews for the same Zoho id would block nothing but confuse the review; the
    // bills step clears them the same way.
    await prisma.zohoPullPreview.deleteMany({
      where: {
        zohoId: { in: staged.map((s) => s.row.zohoId) },
        entityType: cfg.entityType,
        status: { in: ["APPROVED", "REJECTED"] },
      },
    });
    await prisma.$transaction(
      staged.map(({ row, action, localId }) =>
        prisma.zohoPullPreview.create({
          data: {
            pullId,
            entityType: cfg.entityType,
            zohoId: row.zohoId,
            action,
            ...(localId
              ? { localMatch: step === "vendorcredits" ? { vendorCreditId: localId } : { customerCreditNoteId: localId } }
              : {}),
            data: row.data,
          },
        }),
      ),
    );
  }

  const counts = {
    new: staged.filter((s) => s.action === "new").length,
    updated: staged.filter((s) => s.action === "update").length,
    voided: staged.filter((s) => s.action === "void").length,
  };

  log.info(step === "vendorcredits" ? "vendor credits step finished" : "credit notes step finished", {
    pullId, fetched, ...counts, drafts, voidSkipped, alreadyImported, apiCalls,
  });

  await logActivity(prisma, {
    module: "zoho", action: "pulled", entityType: "ZohoPull", entityId: pullId, entityRef: pullId,
    fromValue: modifiedFrom ?? null, toValue: null,
    details: `${counts.new} new, ${counts.updated} changed, ${counts.voided} voided ${cfg.many} from Zoho Books`,
    userId: ctx.userId, userName: ctx.userName,
  });

  // §5.2 response shape. `found` is what finalize counts (the previews to review).
  return successResponse({
    step,
    source: "books",
    window: window ? { ...window, mode: searchText ? "search" : "modifiedSince" } : null,
    fetched,
    found: staged.length,
    ...(step === "vendorcredits" ? { vendorCreditsNew: staged.length } : { creditNotesNew: staged.length }),
    counts,
    skipped: {
      counts: { alreadyImported, draft: drafts, void: voidSkipped },
      items: skippedItems,
    },
    apiCalls,
    errors: [] as string[],
  });
}

/** The §5.2 skip block, built once so bills, invoices and credit notes cannot drift apart. */
// "draft": a vendor credit or customer credit note still in draft in Zoho — not in Zoho's books
// either, so not imported until it is opened there (plan 1210 credit notes, Q10).
type SkipReason = "alreadyImported" | "void" | "centre" | "draft";
interface SkipItem {
  ref: string;
  reason: SkipReason;
  where?: "inbound" | "accounts" | "deliveries" | "receivables";
  id?: string;
  no?: string;
  status?: string;
}

/*
 * MANUAL PULL (step-by-step):
 * ─────────────────────────
 * Bills:     Zoho Books (fallback Zakya POS)
 * Invoices:  Zakya POS (fallback Books)
 * Vendor credits, customer credit notes:  Zoho Books only (plan 1210 credit notes, Parts 3.3, 8.2)
 *
 * The credit steps read the window as "changed in Zoho since `from`" (last_modified_time), not as
 * a date range: a credit created OR changed in the window is caught — a back-dated one, and an old
 * one applied to a bill this week.
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
      let billsExisting = 0;
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

          // ─── WHICH OF THESE ARE ALREADY HERE (plan 1210 credit notes, Part 1.3; X1, X2) ───
          //
          // NOTHING IS DELETED ANY MORE (X1). This block used to delete every existing bill with
          // no shipment and no payment "so it could be re-fetched": every unpaid bill imported
          // from /bills was destroyed and re-created with a new id on each re-fetch, silently
          // nulling the vendor-issue, bank-suggestion and brand-ledger links that pointed at it —
          // and, with credit applications linked to bills, it would break those too. The re-fetch
          // problem it solved is solved by matching instead:
          //
          //   1. by Zoho's bill id (`VendorBill.zohoBillId`, stamped at every import since this plan);
          //   2. for a row imported before the id was stamped: bill number AND the vendor's Zoho id —
          //      never the number alone (X2: two suppliers' bill "1024" are two bills).
          //
          // A shipment carrying the Zoho id (stamped since long before this plan) also counts.
          const zohoIds = bills.map((b) => b.bill_id).filter(Boolean);
          const billNumbers = bills.map((b) => b.bill_number);
          const zohoVendorIds = Array.from(new Set(bills.map((b) => b.vendor_id).filter(Boolean)));
          const LOCAL_BILL = {
            id: true,
            billNo: true,
            zohoBillId: true,
            vendor: { select: { zohoVendorId: true } },
            inboundShipment: { select: { id: true, shipmentNo: true, status: true } },
          } as const;
          const [byZohoId, unstamped, shipmentsByZohoId] = await Promise.all([
            prisma.vendorBill.findMany({ where: { zohoBillId: { in: zohoIds } }, select: LOCAL_BILL }),
            zohoVendorIds.length > 0
              ? prisma.vendorBill.findMany({
                  where: { zohoBillId: null, billNo: { in: billNumbers }, vendor: { zohoVendorId: { in: zohoVendorIds } } },
                  select: LOCAL_BILL,
                })
              : Promise.resolve([]),
            prisma.inboundShipment.findMany({
              where: { zohoBillId: { in: zohoIds } },
              select: { id: true, shipmentNo: true, status: true, zohoBillId: true },
            }),
          ]);
          const localByZohoId = new Map(byZohoId.map((b) => [b.zohoBillId as string, b]));
          const localByVendorAndNo = new Map(unstamped.map((b) => [`${b.vendor.zohoVendorId}|${b.billNo}`, b]));
          const shipmentByZohoId = new Map(shipmentsByZohoId.map((s) => [s.zohoBillId as string, s]));

          const newBills: IntegrationBill[] = [];
          const existingBills: Array<{ bill: IntegrationBill; vendorBillId: string }> = [];
          for (const b of bills) {
            const ref = b.bill_number;
            const local = localByZohoId.get(b.bill_id) ?? localByVendorAndNo.get(`${b.vendor_id}|${b.bill_number}`);
            const shipment = local?.inboundShipment ?? shipmentByZohoId.get(b.bill_id) ?? null;
            if (shipment) {
              // ALREADY-IMPORTED IS NOT AN ERROR. These used to be pushed into `errors[]`, which
              // made `finalize` report the pull as "partial" for the normal case of re-fetching a
              // window whose bills are already in. They belong in `skipped` (§5.2).
              alreadyImported++;
              skippedItems.push({ ref, reason: "alreadyImported", where: "inbound", id: shipment.id, no: shipment.shipmentNo, status: shipment.status });
              continue;
            }
            if (local) {
              // In Bills but not received on /inbound: a preview with action "existing". /inbound
              // imports it exactly as before (approve reuses the bill and builds the shipment);
              // /bills shows it unticked — approving it there only stamps the missing Zoho link.
              existingBills.push({ bill: b, vendorBillId: local.id });
              continue;
            }
            newBills.push(b);
          }

          const toPreview = [
            ...newBills.map((bill) => ({ bill, vendorBillId: null as string | null })),
            ...existingBills,
          ];
          if (toPreview.length > 0) {
            // Clean up old preview records for these bills (from previous pulls) so they aren't blocked
            await prisma.zohoPullPreview.deleteMany({
              where: { zohoId: { in: toPreview.map((p) => p.bill.bill_id) }, entityType: "bill", status: { in: ["APPROVED", "REJECTED"] } },
            });

            await prisma.$transaction(
              toPreview.map(({ bill, vendorBillId }) =>
                prisma.zohoPullPreview.create({
                  data: {
                    pullId: existingPullId,
                    entityType: "bill",
                    zohoId: bill.bill_id,
                    action: vendorBillId ? "existing" : "new",
                    ...(vendorBillId ? { localMatch: { vendorBillId } } : {}),
                    data: {
                      billNumber: bill.bill_number,
                      vendorName: bill.vendor_name,
                      // Zoho's vendor id — approve resolves the Vendor by it (plan 2409). It
                      // used to arrive here and be dropped. `vendorSource` says which client
                      // can read that contact back: Books and Zakya ids are not interchangeable.
                      vendorId: bill.vendor_id || null,
                      vendorSource: source,
                      date: bill.date,
                      dueDate: bill.due_date,
                      total: bill.total,
                      balance: bill.balance,
                      status: bill.status,
                      // Where Zoho booked it (plan 1210, Part 2): the store comes from this when
                      // the location is linked to a store on /stores.
                      locationId: bill.location_id || null,
                      locationName: bill.location_name || null,
                      lineItems: [],
                    },
                  },
                })
              )
            );
            billsNew = newBills.length;
            billsExisting = existingBills.length;
          }
        }
      }

      log.info("bills step finished", {
        pullId: existingPullId, source, fetched, billsNew,
        existingWithoutShipment: billsExisting, alreadyImported, apiCalls, errors: errors.length,
      });

      await logActivity(prisma, {
        module: "zoho", action: "pulled", entityType: "ZohoPull", entityId: existingPullId,
        entityRef: existingPullId,
        fromValue: window?.from ?? null, toValue: window?.to ?? null,
        details:
          `${billsNew} new bill${billsNew === 1 ? "" : "s"} via ${source}` +
          (billsExisting > 0 ? `, ${billsExisting} already in Bills` : ""),
        userId: user.id, userName: user.name,
      });

      // §5.2 response shape, shared with invoices. `existingWithoutShipment`: bills already in
      // the app with no shipment, previewed with action "existing" (plan 1210 Part 1.3).
      return successResponse({
        step: "bills", source, window,
        fetched, billsNew, existingWithoutShipment: billsExisting,
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
      // Per-bucket counts for the fetch summary, keyed by the FLOOR warehouse that matched
      // (plan 1609-deliveries, R31). `dummyCount` is the invoices whose number matched no
      // floor prefix — imported with no warehouse and no store (A41b); the UI labels it Dummy.
      const byWarehouseCount = new Map<string, number>();
      let dummyCount = 0;
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

      // Every active FLOOR warehouse carrying a prefix, for attribution. A handful of rows;
      // loaded once, not per invoice. The prefix moved here from Store on 16 Sep (T1).
      const floors = await listFloorWarehousesWithPrefix(prisma);

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
      // its stock never moved. They are imported now and TAGGED with the FLOOR warehouse that
      // sold them, resolved from Warehouse.invoicePrefix (plan 1609-deliveries, T1). An invoice
      // matching no floor prefix still imports as a Dummy — warehouseId AND storeId null, no
      // fallback to any store (A41b) — and is counted so the summary can say so.
      //
      // The ids written below are for the review screen only. Approve RE-RESOLVES the prefix,
      // because it may have been typed or changed on /stores between fetch and import.
      if (newInvoices.length > 0) {
        await prisma.$transaction(
          newInvoices.map((invoice) => {
            const invoiceNo = invoice.invoice_number;
            const match = floorWarehouseForInvoice(invoiceNo, floors);
            if (match) {
              byWarehouseCount.set(match.warehouseId, (byWarehouseCount.get(match.warehouseId) ?? 0) + 1);
            } else {
              dummyCount++;
            }
            return prisma.zohoPullPreview.create({
              data: {
                pullId: existingPullId,
                entityType: "invoice",
                zohoId: invoice.invoice_id,
                data: {
                  invoiceNumber: invoiceNo,
                  customerName: invoice.customer_name,
                  // +91-XXXXXXXXXX, as every phone in the deliveries flow is written (B3b).
                  phone: toPlus91(invoice.phone) ?? "",
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
                  warehouseId: match?.warehouseId ?? null,
                  storeId: match?.storeId ?? null,
                },
              },
            });
          })
        );
        invoicesNew = newInvoices.length;
      }

      // Names for the matched buckets, so the summary reads "12 BCH Floor", not an id. One
      // query, and only when something matched.
      const byWarehouse: Array<{ warehouseId: string; name: string; prefix: string | null; count: number }> = [];
      if (byWarehouseCount.size > 0) {
        const named = await prisma.warehouse.findMany({
          where: { id: { in: Array.from(byWarehouseCount.keys()) } },
          select: { id: true, name: true, invoicePrefix: true },
        });
        const byId = new Map(named.map((w) => [w.id, w]));
        for (const [warehouseId, count] of byWarehouseCount) {
          const w = byId.get(warehouseId);
          byWarehouse.push({ warehouseId, name: w?.name ?? warehouseId, prefix: w?.invoicePrefix ?? null, count });
        }
      }

      log.info("invoices step finished", {
        pullId: existingPullId, source, fetched, invoicesNew,
        alreadyImported, voidCount, floors: floors.length,
        byWarehouse: byWarehouse.map((b) => ({ warehouseId: b.warehouseId, count: b.count })),
        dummy: dummyCount, apiCalls, errors: errors.length,
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
        skipped: {
          counts: { alreadyImported, void: voidCount, byWarehouse, dummy: dummyCount },
          items: skippedItems,
        },
        apiCalls, errors,
      });
    }

    // ─── VENDOR CREDITS / CUSTOMER CREDIT NOTES: Zoho Books only (plan 1210, Parts 3.3, 8.2) ───
    if (step === "vendorcredits" || step === "creditnotes") {
      return await creditStep(step, {
        pullId: existingPullId,
        window,
        searchText,
        userId: user.id,
        userName: user.name,
      });
    }

    // ─── FINALIZE ───
    if (step === "finalize") {
      // itemsNew and contactsNew are always 0 now — no step produces them. The two columns
      // stay on ZohoPullLog because the schema is deliberately untouched on this branch, and
      // a zero is honest: that pull genuinely imported no items and no contacts.
      const {
        itemsNew = 0, contactsNew = 0, billsNew = 0, invoicesNew = 0,
        vendorCreditsNew = 0, creditNotesNew = 0, apiCalls = 0, allErrors = [],
      } = body;

      await prisma.zohoPullLog.create({
        data: {
          pullId: existingPullId,
          contactsNew,
          itemsNew,
          billsNew,
          invoicesNew,
          // Previews to review from the credit steps — new, changed and voided (plan 1210).
          vendorCreditsNew,
          creditNotesNew,
          apiCallsUsed: apiCalls,
          errors: allErrors.length > 0 ? JSON.stringify(allErrors) : null,
        },
      });

      const totalNew = contactsNew + itemsNew + billsNew + invoicesNew + vendorCreditsNew + creditNotesNew;

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
            // The credit-note counts are named only when a credit step ran and found something, so a
            // bills-only pull still reads exactly as before.
            const counts = [
              `${billsNew} new bill${billsNew === 1 ? "" : "s"}`,
              `${invoicesNew} new invoice${invoicesNew === 1 ? "" : "s"}`,
              ...(vendorCreditsNew > 0 ? [`${vendorCreditsNew} vendor credit${vendorCreditsNew === 1 ? "" : "s"} to review`] : []),
              ...(creditNotesNew > 0 ? [`${creditNotesNew} customer credit note${creditNotesNew === 1 ? "" : "s"} to review`] : []),
            ].join(", ");
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
                vendorCreditsNew: String(vendorCreditsNew),
                creditNotesNew: String(creditNotesNew),
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

      // Update lastSyncAt for all connected sources. A provider that was never configured has no
      // row, so its update fails — normal, and recorded at debug rather than swallowed bare.
      const syncedAt = new Date();
      for (const provider of ["ZOHO_BOOKS", "ZAKYA_POS", "ZOHO_INVENTORY"] as const) {
        await prisma.integrationConfig
          .update({ where: { provider }, data: { lastSyncAt: syncedAt } })
          .catch((e) => log.debug("lastSyncAt not updated", { provider, message: e instanceof Error ? e.message : String(e) }));
      }

      log.info("pull finalized", {
        pullId: existingPullId,
        status: totalNew > 0 ? "PENDING_REVIEW" : "NO_NEW_DATA",
        billsNew,
        invoicesNew,
        vendorCreditsNew,
        creditNotesNew,
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
        vendorCreditsNew,
        creditNotesNew,
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
