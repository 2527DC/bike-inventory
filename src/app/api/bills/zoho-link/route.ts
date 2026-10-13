export const dynamic = "force-dynamic";
// Two Zoho reads per bill; the route also stops itself at ~45 s and hands back a cursor, so a slow
// Zoho shortens a batch instead of killing it.
export const maxDuration = 60;

// POST /api/bills/zoho-link — link bills already in the app to their Zoho bill (plan 1210 credit
// notes, Part 1.4). A route, not a script: it must run where Zoho is connected, and a local restore
// has its credentials nulled (rule 10).
//
//   { mode: "dry-run" }            writes NOTHING; reports what apply would do
//   { mode: "apply", cursor? }     writes zohoBillId, zohoLocationId, storeId (from a linked
//                                  location), creditAppliedAmount and the pre-import credit
//                                  applications — NEVER paidAmount
//
// The screen sends the next batch when the previous one answers, until `cursor` comes back null.
// One click starts it; nothing runs on a timer.
//
// FOR EACH BILL WITH NO zohoBillId
//   1. Its shipment carries a Zoho bill id → that id (no Zoho call to find it).
//   2. Its vendor has a Zoho id → GET /bills?vendor_id&bill_number. Exactly one with the same total
//      (±₹0.01) → matched; none → not found; several → ambiguous. Untouched unless matched.
//   3. Matched → GET /bills/{id} for its credits, location and balance.
//   4. creditAppliedAmount = the Zoho applications dated BEFORE the import day: those were inside
//      Zoho's balance when the import set paidAmount = total − balance. Later ones are not in
//      paidAmount and are left for the first credit pull, which moves paidAmount by exactly them.
//      An application dated within a day of the import cannot be placed → "check by hand", and the
//      bill is left untouched.
//   5. Balance drift (here vs Zoho) is REPORTED only: payments recorded here are not in Zoho until
//      plan C, so "correcting" it would erase real payments.
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { billZohoLinkSchema } from "@/lib/validations";
import { logActivity } from "@/lib/activity-log";
import type { BooksClient, ZohoLocation } from "@/lib/integrations/books";
import { storeIdForLocation } from "@/lib/payables/store";
import { toMoney, zohoDate, round2 } from "@/lib/payables/sync-vendor-credit";

const log = createLogger("bills:zoho-link");

const DEFAULT_BATCH = 20;
/** Stop taking new bills after this long, so the answer always beats maxDuration. */
const TIME_BUDGET_MS = 45_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

interface ListItem {
  billId: string;
  billNo: string;
  vendorName: string;
  reason?: string;
}
interface DriftItem {
  billId: string;
  billNo: string;
  vendorName: string;
  /** amount − paidAmount here. */
  here: number;
  /** Zoho's balance. */
  zoho: number;
}

/** "2026-10-01" for the IST calendar day of an instant. */
function istDay(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
/** Whole days from `a` to `b`, both "YYYY-MM-DD". */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}
function sameNumber(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  let mode: string | undefined;
  let cursor: string | undefined;
  try {
    const user = await requireFeature("zoho", "approve");

    let raw: unknown;
    try {
      raw = await req.json();
    } catch (e) {
      log.warn("body is not JSON", { message: e instanceof Error ? e.message : String(e) });
      return errorResponse("The request body must be JSON.", 400);
    }
    const parsed = billZohoLinkSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request";
      log.warn("body refused", { message });
      return errorResponse(message, 400);
    }
    mode = parsed.data.mode;
    cursor = parsed.data.cursor;
    const apply = mode === "apply";
    const batch = parsed.data.batch ?? DEFAULT_BATCH;

    // Progress denominator, on the first call of a run only.
    const remaining = cursor ? undefined : await prisma.vendorBill.count({ where: { zohoBillId: null } });

    const bills = await prisma.vendorBill.findMany({
      where: { zohoBillId: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: batch,
      select: {
        id: true,
        billNo: true,
        amount: true,
        paidAmount: true,
        createdAt: true,
        storeId: true,
        zohoLocationId: true,
        vendor: { select: { id: true, name: true, zohoVendorId: true } },
        inboundShipment: { select: { zohoBillId: true } },
      },
    });

    // Zoho, only when a bill needs it — zero bills (production, 13 Oct 2026) answer zeros without
    // touching Zoho at all.
    let booksPromise: Promise<BooksClient | null> | null = null;
    const books = () => (booksPromise ??= import("@/lib/integrations").then((m) => m.getBooks()));
    let locationsPromise: Promise<ZohoLocation[] | undefined> | null = null;
    const zohoLocations = () =>
      (locationsPromise ??= (async () => {
        const client = await books();
        if (!client) return undefined;
        try {
          return (await client.listLocations()).locations ?? [];
        } catch (e) {
          log.warn("Zoho locations unavailable — stores resolve by exact location only", {
            message: e instanceof Error ? e.message : String(e),
          });
          return undefined;
        }
      })());
    const storeForLocation = async (locationId: string | null | undefined) => {
      if (!locationId) return null;
      return (await storeIdForLocation(locationId)) ?? (await storeIdForLocation(locationId, await zohoLocations()));
    };

    const items = {
      notFound: [] as ListItem[],
      ambiguous: [] as ListItem[],
      vendorNotLinked: [] as ListItem[],
      checkByHand: [] as ListItem[],
      failed: [] as ListItem[],
      drift: [] as DriftItem[],
    };
    let matched = 0;
    let linkable = 0;
    let linked = 0;
    let storesSet = 0;
    let applicationsWritten = 0;
    let withLocation = 0;
    let withoutLocation = 0;
    let lastProcessedId: string | null = null;
    let stoppedEarly = false;
    const claimed = new Set<string>(); // Zoho bill ids matched earlier in this batch

    for (const bill of bills) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        stoppedEarly = true;
        break;
      }
      lastProcessedId = bill.id;
      const ref: ListItem = { billId: bill.id, billNo: bill.billNo, vendorName: bill.vendor.name };

      // ── 1–2. Find the Zoho bill id ──
      let zohoBillId = bill.inboundShipment?.zohoBillId ?? null;
      if (!zohoBillId) {
        if (!bill.vendor.zohoVendorId) {
          items.vendorNotLinked.push(ref);
          continue;
        }
        const client = await books();
        if (!client) {
          log.warn("link refused — Zoho Books not connected", { mode });
          return errorResponse("Zoho Books is not connected — connect it on Settings › Integrations, then run this again.", 409);
        }
        let found;
        try {
          found = (await client.findBill(bill.vendor.zohoVendorId, bill.billNo)).bills ?? [];
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          log.error("Zoho bill lookup failed", { billId: bill.id, message });
          items.failed.push({ ...ref, reason: `Zoho lookup failed: ${message}` });
          continue;
        }
        const numbered = found.filter((z) => sameNumber(z.bill_number || "", bill.billNo));
        const sameTotal = numbered.filter((z) => Math.abs((Number(z.total) || 0) - bill.amount) <= 0.01);
        if (sameTotal.length > 1) {
          log.warn("ambiguous Zoho bill", { billId: bill.id, billNo: bill.billNo, candidates: sameTotal.length });
          items.ambiguous.push({ ...ref, reason: `${sameTotal.length} Zoho bills have this number and total` });
          continue;
        }
        if (sameTotal.length === 0) {
          items.notFound.push({
            ...ref,
            reason: numbered.length
              ? `Zoho's bill ${bill.billNo} totals ₹${round2(Number(numbered[0].total) || 0)}; here ₹${round2(bill.amount)}`
              : "No Zoho bill with this number for this vendor",
          });
          continue;
        }
        zohoBillId = sameTotal[0].bill_id;
      }

      // One Zoho bill, one bill here.
      if (claimed.has(zohoBillId)) {
        log.warn("ambiguous Zoho bill", { billId: bill.id, billNo: bill.billNo, zohoBillId, reason: "matched twice in one batch" });
        items.ambiguous.push({ ...ref, reason: "Another bill here matched the same Zoho bill" });
        continue;
      }
      const holder = await prisma.vendorBill.findUnique({ where: { zohoBillId }, select: { billNo: true } });
      if (holder) {
        log.warn("ambiguous Zoho bill", { billId: bill.id, billNo: bill.billNo, zohoBillId, reason: "already linked here" });
        items.ambiguous.push({ ...ref, reason: `That Zoho bill is already linked to bill ${holder.billNo} here` });
        continue;
      }
      claimed.add(zohoBillId);

      // ── 3. The detail: credits, location, balance ──
      const client = await books();
      if (!client) {
        log.warn("link refused — Zoho Books not connected", { mode });
        return errorResponse("Zoho Books is not connected — connect it on Settings › Integrations, then run this again.", 409);
      }
      let detail;
      try {
        detail = (await client.getBill(zohoBillId)).bill;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log.error("Zoho bill detail failed", { billId: bill.id, message });
        items.failed.push({ ...ref, reason: `Zoho detail failed: ${message}` });
        continue;
      }
      if (!detail) {
        log.error("Zoho bill detail failed", { billId: bill.id, message: "empty detail" });
        items.failed.push({ ...ref, reason: "Zoho returned no detail for this bill" });
        continue;
      }
      matched++;

      const locationId = typeof detail.location_id === "string" && detail.location_id ? detail.location_id : null;
      if (locationId) withLocation++;
      else withoutLocation++;

      const zohoBalance = Number(detail.balance);
      const hereOpen = round2(bill.amount - bill.paidAmount);
      if (Number.isFinite(zohoBalance) && Math.abs(hereOpen - zohoBalance) > 0.01) {
        items.drift.push({ ...ref, here: hereOpen, zoho: round2(zohoBalance) });
      }

      // ── 4. Which Zoho applications are already inside paidAmount ──
      const importDay = istDay(bill.createdAt);
      const apps = Array.isArray(detail.vendor_credits)
        ? detail.vendor_credits.filter((a) => a && a.vendor_credit_bill_id && a.vendor_credit_id)
        : null;
      const zohoApplied = Number(detail.vendor_credits_applied) || 0;
      if (apps === null && zohoApplied > 0.01) {
        items.checkByHand.push({ ...ref, reason: `Zoho shows ₹${round2(zohoApplied)} of credits applied but does not list them` });
        continue;
      }
      const pre: NonNullable<typeof apps> = [];
      const unsure: string[] = [];
      for (const a of apps ?? []) {
        const diff = dayDiff(importDay, (a.date || "").slice(0, 10));
        if (!Number.isFinite(diff) || Math.abs(diff) <= 1) unsure.push(a.vendor_credit_number || a.vendor_credit_id);
        else if (diff < -1) pre.push(a);
        // diff > 1: applied after the import — left for the first credit pull (Part 1.4 step 4).
      }
      if (unsure.length > 0) {
        items.checkByHand.push({
          ...ref,
          reason: `Credit ${unsure.join(", ")} was applied within a day of this bill's import (${importDay}) — cannot tell whether it is already in the paid amount`,
        });
        continue;
      }

      const storeId = await storeForLocation(locationId);
      const preTotal = round2(pre.reduce((s, a) => s + (Number(a.amount) || 0), 0));
      const setsStore = !bill.storeId && !!storeId;
      // Passed every check: dry run says it would be linked; apply tries to.
      linkable++;

      if (!apply) {
        if (setsStore) storesSet++;
        continue;
      }

      // ── 6. Apply: the link, the store, the credit split. NEVER paidAmount. ──
      try {
        const done = await prisma.$transaction(
          async (tx) => {
            // Guard and write in one statement: a bill linked meanwhile matches nothing.
            const res = await tx.vendorBill.updateMany({
              where: { id: bill.id, zohoBillId: null },
              data: {
                zohoBillId,
                ...(bill.zohoLocationId ? {} : { zohoLocationId: locationId }),
                ...(bill.storeId || !storeId ? {} : { storeId }),
                // An increment, not a set: an Apply credit made here already counts in it.
                creditAppliedAmount: { increment: toMoney(preTotal) },
              },
            });
            if (res.count === 0) return false;

            if (pre.length > 0) {
              const credits = await tx.vendorCredit.findMany({
                where: { zohoVendorCreditId: { in: Array.from(new Set(pre.map((a) => a.vendor_credit_id))) } },
                select: { id: true, zohoVendorCreditId: true },
              });
              const creditByZohoId = new Map(credits.map((c) => [c.zohoVendorCreditId as string, c.id]));
              for (const a of pre) {
                const vendorCreditId = creditByZohoId.get(a.vendor_credit_id) ?? null;
                const row = {
                  zohoVendorCreditId: a.vendor_credit_id,
                  zohoBillId,
                  billId: bill.id,
                  amount: toMoney(a.amount),
                  appliedDate: zohoDate(a.date, `Bill ${bill.billNo}'s credit application`),
                };
                await tx.vendorCreditApplication.upsert({
                  where: { zohoVendorCreditBillId: a.vendor_credit_bill_id },
                  create: { ...row, source: "ZOHO", vendorCreditId, zohoVendorCreditBillId: a.vendor_credit_bill_id },
                  update: { ...row, ...(vendorCreditId ? { vendorCreditId } : {}) },
                });
              }
            }
            return true;
          },
          { timeout: 20_000, maxWait: 10_000 },
        );
        if (done) {
          linked++;
          applicationsWritten += pre.length;
          if (setsStore) storesSet++;
        } else {
          log.info("bill linked meanwhile — skipped", { billId: bill.id });
        }
      } catch (e) {
        // A unique clash on zohoBillId means another request linked the same Zoho bill first.
        const message =
          e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
            ? "That Zoho bill was linked to another bill here a moment ago"
            : e instanceof Error
              ? e.message
              : String(e);
        log.error("bill link write failed", { billId: bill.id, zohoBillId, message });
        items.failed.push({ ...ref, reason: message });
      }
    }

    // The next page starts after the last bill looked at. A full page, or a batch cut short by
    // the time budget, may have more behind it.
    const nextCursor =
      stoppedEarly || bills.length === batch ? (lastProcessedId ?? cursor ?? null) : null;

    const report = {
      mode,
      processed: lastProcessedId ? bills.findIndex((b) => b.id === lastProcessedId) + 1 : 0,
      remaining,
      matched,
      linkable,
      linked,
      storesSet,
      applicationsWritten,
      notFound: items.notFound.length,
      ambiguous: items.ambiguous.length,
      vendorNotLinked: items.vendorNotLinked.length,
      checkByHand: items.checkByHand.length,
      failed: items.failed.length,
      drift: items.drift.length,
      withLocation,
      withoutLocation,
      items,
      cursor: nextCursor,
      stoppedEarly,
    };

    log.info("zoho link batch finished", {
      mode,
      processed: report.processed,
      matched,
      linkable,
      linked,
      notFound: report.notFound,
      ambiguous: report.ambiguous,
      vendorNotLinked: report.vendorNotLinked,
      checkByHand: report.checkByHand,
      failed: report.failed,
      drift: report.drift,
      cursor: nextCursor,
      ms: Date.now() - startedAt,
    });

    if (apply && linked > 0) {
      await logActivity(prisma, {
        module: "zoho",
        action: "bills_linked",
        entityType: "VendorBill",
        entityId: lastProcessedId ?? "zoho-link",
        entityRef: `${linked} bill${linked === 1 ? "" : "s"}`,
        details: `${linked} bill${linked === 1 ? "" : "s"} linked to Zoho, ${applicationsWritten} pre-import credit application${applicationsWritten === 1 ? "" : "s"}, ${storesSet} store${storesSet === 1 ? "" : "s"} set`,
        userId: user.id,
        userName: user.name,
      });
    }

    return successResponse(report);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : String(error);
    log.error("zoho link failed", { mode, cursor, message });
    return errorResponse(`Linking bills to Zoho failed: ${message}`, 500);
  }
}
