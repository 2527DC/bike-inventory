// One Zoho vendor credit → this app (plan 1210 credit notes, Part 3.4, re-issued 13 Oct 2026).
//
// Called by `api/zoho/pull-review/approve` for each approved `vendorcredit` preview. The route is
// already 700+ lines; the rules below are the part a second reader has to get exactly right, so
// they live in one place.
//
// ─── THE RULES, IN ORDER ──────────────────────────────────────────────────────────────────────
//
// Q1 = (b), 13 Oct: credits are APPLIED IN THIS APP and Zoho is never told. A credit can also be
// applied in Zoho (D17), so every application row carries a `source`:
//
//   ZOHO  pulled from the credit's `bills_credited[]` — this file writes and prunes them.
//   APP   made here by Apply credit — this file NEVER writes or prunes one.
//
//   usedAmount = (Zoho total − Zoho balance) + Σ this credit's APP applications
//
// Zoho's balance never sees an application made here, hence the second term.
//
// WHY NOTHING IS SUBTRACTED TWICE FROM A BILL. `paidAmount` means "settled" (payments + CD +
// credits) and 17 files read `amount − paidAmount`. `creditAppliedAmount` records how much of it is
// credit notes, and always equals Σ VendorCreditApplication.amount for the bill (both sources).
// A sync moves `paidAmount` only by the CHANGE in that sum (S), in one conditional UPDATE whose
// guard is the old S — so running the same sync twice moves nothing, and a credit un-applied in
// Zoho re-opens the bill by exactly that amount.
//
// No Zoho write anywhere in here (§6): one `GET /vendorcredits/{id}` per credit.
import { Prisma, type VendorCreditStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import type { BooksClient, ZohoLocation, ZohoVendorCreditDetail } from "@/lib/integrations/books";
import { resolveBillVendor } from "@/lib/vendors/resolve-zoho-vendor";
import { storeIdForLocation } from "@/lib/payables/store";

const log = createLogger("payables:sync-credit");

type Tx = Prisma.TransactionClient;

// ─── Shared with the credit-note sync and the pull routes ────────────────────────────────────

/**
 * The sentence for Zoho's 401 code 57 on a credit-note endpoint.
 *
 * Phase 0 (13 Oct 2026): the stored token was granted bills, invoices, contacts and settings but
 * NOT `ZohoBooks.debitnotes.READ` / `ZohoBooks.creditnotes.READ`, so both lists answer "You are not
 * authorized to perform this operation". That text names no permission and no fix; this does.
 */
export const ZOHO_CREDIT_SCOPE_MESSAGE =
  "Zoho refused: the connection is missing the credit-note permission (ZohoBooks.debitnotes.READ / ZohoBooks.creditnotes.READ). Reconnect Zoho Books in Settings › Integrations with those scopes.";

/** A Zoho failure on a credit-note call, as a sentence a phone can show. */
export function describeZohoCreditError(e: unknown): { message: string; missingScope: boolean } {
  const raw = e instanceof Error ? e.message : String(e);
  if (/not authori[sz]ed to perform this operation/i.test(raw) || /\bcode\s*57\b/i.test(raw)) {
    return { message: ZOHO_CREDIT_SCOPE_MESSAGE, missingScope: true };
  }
  return { message: raw || "Zoho Books did not answer", missingScope: false };
}

/**
 * Zoho's `last_modified_time` ("2026-10-12T15:30:00+0530") → Date, or null.
 * The offset is written without a colon, which ISO 8601 parsers are not obliged to accept.
 */
export function parseZohoTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalised = value.trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(normalised);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A Zoho calendar date ("2026-10-01") → Date at UTC midnight — the same construction the bill
 * import uses for `billDate`, so a credit and the bill it settles sort on the same scale.
 */
export function zohoDate(value: string | null | undefined, what: string): Date {
  const d = value ? new Date(value) : new Date(NaN);
  if (Number.isNaN(d.getTime())) throw new Error(`${what} has no valid date in Zoho ("${value ?? ""}")`);
  return d;
}

/** Money as Decimal(12,2), from a Zoho amount (a number, or now and then a numeric string). */
export function toMoney(n: unknown): Prisma.Decimal {
  const v = n === null || n === undefined || n === "" ? 0 : Number(n);
  if (!Number.isFinite(v)) {
    log.warn("non-numeric amount from Zoho treated as 0", { value: String(n).slice(0, 20) });
    return new Prisma.Decimal(0);
  }
  return new Prisma.Decimal(v.toFixed(2));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function rupees(n: number): string {
  return `₹${round2(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** Zoho's status words → ours. Drafts never reach here (Q10); anything unknown is logged. */
function mapStatus(zohoStatus: string, creditNo: string): VendorCreditStatus {
  switch ((zohoStatus || "").toLowerCase()) {
    case "open":
      return "OPEN";
    case "closed":
      return "CLOSED";
    case "void":
      return "VOID";
    default:
      log.warn("unknown vendor credit status — treated as open", { creditNo, zohoStatus });
      return "OPEN";
  }
}

// ─── The bill settle step (Part 3.4 d), shared with nothing else on purpose ──────────────────

/**
 * Bring one bill's `paidAmount` / `creditAppliedAmount` / `status` in line with the sum of its
 * application rows. Returns true when the bill moved.
 *
 * The guard and the write are ONE statement: `WHERE "creditAppliedAmount" = oldS`. Postgres
 * re-checks the WHERE against the newest row version, so an Apply credit committed by someone
 * else between our read and our write makes this match zero rows instead of overwriting their
 * change. Zero rows → re-read once and retry; still zero → throw, and the caller's transaction
 * rolls back with nothing half-written.
 */
async function settleBill(tx: Tx, billId: string, ctx: { zohoVendorCreditId: string }): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const bill = await tx.vendorBill.findUnique({
      where: { id: billId },
      select: { billNo: true, creditAppliedAmount: true },
    });
    if (!bill) return false; // deleted meanwhile; the application row's FK was nulled with it
    const agg = await tx.vendorCreditApplication.aggregate({ where: { billId }, _sum: { amount: true } });
    const s = agg._sum.amount ?? new Prisma.Decimal(0);
    const oldS = bill.creditAppliedAmount;
    if (s.equals(oldS)) return false;

    const S = s.toFixed(2);
    const OLD = oldS.toFixed(2);
    // Every right-hand side reads the row's values from BEFORE the update, as SQL requires.
    // paidAmount is a Float column: float8 + numeric resolves to float8 arithmetic.
    const updated = await tx.$executeRaw`
      UPDATE "VendorBill"
         SET "paidAmount" = "paidAmount" + (${S}::numeric - "creditAppliedAmount"),
             "creditAppliedAmount" = ${S}::numeric,
             status = (CASE
                         WHEN status = 'DISPUTED' THEN 'DISPUTED'
                         WHEN "paidAmount" + (${S}::numeric - "creditAppliedAmount") >= amount - 0.01 THEN 'PAID'
                         WHEN "paidAmount" + (${S}::numeric - "creditAppliedAmount") > 0.01 THEN 'PARTIALLY_PAID'
                         ELSE 'PENDING' END)::"BillStatus",
             "updatedAt" = now()
       WHERE id = ${billId} AND "creditAppliedAmount" = ${OLD}::numeric`;
    if (updated === 1) {
      log.debug("bill settled by credit sync", { billId, from: OLD, to: S, ...ctx });
      return true;
    }
    log.warn("conditional update lost, retrying", { billId, attempt: attempt + 1, ...ctx });
    if (attempt === 1) {
      throw new Error(
        `Bill ${bill.billNo} changed while this credit was being synced — import it again.`
      );
    }
  }
  return false;
}

// ─── The sync ─────────────────────────────────────────────────────────────────────────────────

export interface VendorCreditSyncResult {
  vendorCreditId: string | null;
  creditNoteNo: string;
  outcome: "created" | "updated" | "skipped";
  status: VendorCreditStatus | null;
  applications: number;
  refunds: number;
  billsMoved: number;
  /** Things a person should know (Part 3.4 step 4). Never failures — those throw. */
  notices: string[];
}

export interface SyncContext {
  books: BooksClient;
  /** The organisation's locations, read once per approve run; undefined = exact match only. */
  locations?: ZohoLocation[];
}

/**
 * Pull one vendor credit from Zoho and write it, its applications and its refunds here.
 * Throws with a sentence on failure; the caller records it against the preview.
 */
export async function syncVendorCredit(
  zohoVendorCreditId: string,
  ctx: SyncContext,
): Promise<VendorCreditSyncResult> {
  try {
    return await syncOnce(zohoVendorCreditId, ctx);
  } catch (e) {
    // Two approves of the same credit at once: both found no row and both created it. The
    // loser hits a unique violation; one re-run finds the winner's row and updates it.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = String(e.meta?.target ?? "");
      if (target.includes("zohoVendorCreditId") || target.includes("zohoVendorCreditBillId") || target.includes("zohoRefundId")) {
        log.warn("vendor credit sync raced — running once more", { zohoVendorCreditId, target });
        try {
          return await syncOnce(zohoVendorCreditId, ctx);
        } catch (again) {
          return fail(zohoVendorCreditId, again);
        }
      }
    }
    return fail(zohoVendorCreditId, e);
  }
}

function fail(zohoVendorCreditId: string, e: unknown): never {
  const { message, missingScope } = describeZohoCreditError(e);
  if (missingScope) log.warn("credit sync refused by Zoho — missing scope", { zohoVendorCreditId });
  else log.error("credit sync failed", { zohoVendorCreditId, message });
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new Error(
      `This credit's number is already used here by a different Zoho credit — it may have been deleted and re-entered in Zoho. Check it by hand.`
    );
  }
  throw new Error(message);
}

async function syncOnce(zohoVendorCreditId: string, { books, locations }: SyncContext): Promise<VendorCreditSyncResult> {
  // ── 1. One read ──
  log.debug("-> vendorcredits.get", { zohoVendorCreditId });
  const res = await books.getVendorCredit(zohoVendorCreditId);
  const detail: ZohoVendorCreditDetail | undefined = res.vendor_credit;
  if (!detail) throw new Error(`Zoho returned no vendor credit for id ${zohoVendorCreditId}`);

  const creditNo = detail.vendor_credit_number || zohoVendorCreditId;
  const notices: string[] = [];

  if ((detail.status || "").toLowerCase() === "draft") {
    // Q10: a draft is not in Zoho's books either. The fetch already skips them; this covers a
    // credit moved back to draft between fetch and import.
    log.info("vendor credit is a draft in Zoho — not imported", { zohoVendorCreditId });
    notices.push(`Credit ${creditNo} is a draft in Zoho — not imported. Open it in Zoho, then fetch again.`);
    return {
      vendorCreditId: null, creditNoteNo: creditNo, outcome: "skipped", status: null,
      applications: 0, refunds: 0, billsMoved: 0, notices,
    };
  }

  // ── 2. The vendor, by Zoho vendor id (plan 2409) — created once if Zoho knows one we have not met ──
  if (!detail.vendor_id) {
    throw new Error(`Credit ${creditNo} has no Zoho vendor id — open it in Zoho and check its vendor`);
  }
  const { vendor, notice: vendorNotice } = await resolveBillVendor({
    billNo: creditNo,
    vendorName: detail.vendor_name || "",
    vendorId: detail.vendor_id,
    vendorSource: "books",
  });
  if (vendorNotice) notices.push(vendorNotice);

  const status = mapStatus(detail.status, creditNo);
  const total = round2(Number(detail.total) || 0);
  const balance = round2(Number(detail.balance) || 0);
  const zohoUsed = round2(total - balance); // applied in Zoho + refunded
  const locationStore = await storeIdForLocation(detail.location_id, locations);

  // A void credit applies to nothing: whatever Zoho still lists, its applications leave (Part 3.4,
  // "VOID handling re-opens bills by removing its ZOHO applications").
  const zohoApps = status === "VOID" ? [] : (detail.bills_credited ?? []).filter((a) => a.vendor_credit_bill_id);
  const zohoRefunds = (detail.vendor_credit_refunds ?? []).filter((r) => r.vendor_credit_refund_id);
  const now = new Date();

  // ── 3. One transaction ──
  const outcome = await prisma.$transaction(
    async (tx) => {
      // a. The credit row: by Zoho id; else the hand-typed twin (vendor + number, no Zoho id) is
      //    stamped once (Q14); else a new row.
      let existing = await tx.vendorCredit.findUnique({
        where: { zohoVendorCreditId },
        select: { id: true, storeId: true, vendorId: true },
      });
      let stampedTwin = false;
      if (!existing) {
        const twin = await tx.vendorCredit.findUnique({
          where: { vendorId_creditNoteNo: { vendorId: vendor.id, creditNoteNo: creditNo } },
          select: { id: true, storeId: true, vendorId: true, zohoVendorCreditId: true },
        });
        if (twin && twin.zohoVendorCreditId === null) {
          existing = { id: twin.id, storeId: twin.storeId, vendorId: twin.vendorId };
          stampedTwin = true;
          log.info("hand-typed credit linked to its Zoho twin", { vendorCreditId: twin.id, zohoVendorCreditId });
        }
        // A twin that carries a DIFFERENT Zoho id falls through to create, whose unique
        // (vendorId, creditNoteNo) refuses it — fail() turns that into a sentence.
      }

      const appSumAgg = existing
        ? await tx.vendorCreditApplication.aggregate({
            where: { vendorCreditId: existing.id, source: "APP" },
            _sum: { amount: true },
          })
        : null;
      const appSum = round2(Number(appSumAgg?._sum.amount ?? 0));
      // A void credit has no Zoho-side use left; only what was applied here remains, and that is
      // flagged below for a person to remove.
      const usedAmount = round2((status === "VOID" ? 0 : zohoUsed) + appSum);

      // b(i). Bills the Zoho applications point at, in one read.
      const zohoBillIds = Array.from(new Set(zohoApps.map((a) => a.bill_id).filter(Boolean)));
      const bills = zohoBillIds.length
        ? await tx.vendorBill.findMany({
            where: { zohoBillId: { in: zohoBillIds } },
            select: { id: true, zohoBillId: true, vendorId: true, storeId: true, billNo: true },
          })
        : [];
      const billByZohoId = new Map(bills.map((b) => [b.zohoBillId as string, b]));

      // Store (§2.2): Zoho location → the store of the bills it is applied to, when they agree →
      // null. A store already on the row is local data (set by hand, or by an earlier rule) and is
      // never overwritten by a pull.
      const billStores = new Set(
        zohoApps
          .map((a) => billByZohoId.get(a.bill_id))
          .filter((b): b is NonNullable<typeof b> => !!b && b.vendorId === vendor.id && !!b.storeId)
          .map((b) => b.storeId as string),
      );
      const derivedStore = locationStore ?? (billStores.size === 1 ? [...billStores][0] : null);
      const storeId = existing?.storeId ?? derivedStore;

      const fields = {
        vendorId: vendor.id,
        creditNoteNo: creditNo,
        referenceNo: detail.reference_number?.trim() || null,
        amount: total,
        usedAmount,
        status,
        creditDate: zohoDate(detail.date, `Credit ${creditNo}`),
        notes: detail.notes?.trim() || null,
        zohoVendorCreditId,
        zohoLocationId: detail.location_id || null,
        storeId,
        zohoLastModifiedAt: parseZohoTimestamp(detail.last_modified_time),
        lastSyncedAt: now,
      };
      const credit = existing
        ? await tx.vendorCredit.update({ where: { id: existing.id }, data: fields, select: { id: true } })
        : await tx.vendorCredit.create({ data: fields, select: { id: true } });

      // b(ii). Applications. The bills touched BEFORE this sync are read first, so a bill an
      //        application leaves is re-settled too.
      const before = await tx.vendorCreditApplication.findMany({
        where: {
          source: "ZOHO",
          OR: [{ zohoVendorCreditId }, { vendorCreditId: credit.id }],
        },
        select: { id: true, billId: true, zohoVendorCreditBillId: true },
      });
      const touched = new Set(before.map((a) => a.billId).filter((x): x is string => !!x));

      const keep: string[] = [];
      for (const a of zohoApps) {
        const bill = billByZohoId.get(a.bill_id);
        let billId: string | null = null;
        if (bill && bill.vendorId === vendor.id) {
          billId = bill.id;
        } else if (bill) {
          // Zoho applies a credit only to its own vendor's bills, so this is a mislinked bill
          // here. Linking it would settle another supplier's bill; it waits instead.
          log.warn("application's bill belongs to another vendor — left unlinked", {
            zohoVendorCreditId, zohoBillId: a.bill_id, billId: bill.id,
          });
          notices.push(
            `Credit ${creditNo} is applied in Zoho to bill ${a.bill_number || bill.billNo}, but that bill belongs to a different vendor here — not linked. Check the bill's vendor.`,
          );
        } else {
          log.warn("application waits for bill", { zohoVendorCreditId, zohoBillId: a.bill_id });
          notices.push(
            `Credit ${creditNo} is applied to bill ${a.bill_number || a.bill_id}, which is not in the app yet — fetch it on /bills`,
          );
        }
        const row = {
          source: "ZOHO" as const,
          zohoVendorCreditId,
          zohoBillId: a.bill_id || null,
          vendorCreditId: credit.id,
          billId,
          amount: toMoney(a.amount),
          appliedDate: zohoDate(a.date, `Credit ${creditNo}'s application`),
        };
        await tx.vendorCreditApplication.upsert({
          where: { zohoVendorCreditBillId: a.vendor_credit_bill_id },
          create: { ...row, zohoVendorCreditBillId: a.vendor_credit_bill_id },
          update: row,
        });
        keep.push(a.vendor_credit_bill_id);
        if (billId) touched.add(billId);
      }

      // Prune ZOHO rows Zoho no longer lists for this credit. Never an APP row (D17).
      const stale = before.filter((a) => !a.zohoVendorCreditBillId || !keep.includes(a.zohoVendorCreditBillId));
      if (stale.length > 0) {
        await tx.vendorCreditApplication.deleteMany({
          where: { id: { in: stale.map((a) => a.id) }, source: "ZOHO" },
        });
      }

      // c. Refunds: the same upsert-and-prune, by Zoho's refund id.
      const refundKeep: string[] = [];
      for (const r of zohoRefunds) {
        const data = {
          vendorCreditId: credit.id,
          refundDate: zohoDate(r.date, `Credit ${creditNo}'s refund`),
          amount: toMoney(r.amount_bcy ?? r.amount),
          refundMode: r.refund_mode?.trim() || null,
          referenceNo: r.reference_number?.trim() || null,
        };
        await tx.vendorCreditRefund.upsert({
          where: { zohoRefundId: r.vendor_credit_refund_id },
          create: { ...data, zohoRefundId: r.vendor_credit_refund_id },
          update: data,
        });
        refundKeep.push(r.vendor_credit_refund_id);
      }
      await tx.vendorCreditRefund.deleteMany({
        where: { vendorCreditId: credit.id, zohoRefundId: { notIn: refundKeep } },
      });

      // d. Every bill touched, before or after: move paidAmount by the change in S.
      // In id order, so two syncs touching the same bills lock them in the same order.
      let billsMoved = 0;
      for (const billId of [...touched].sort()) {
        if (await settleBill(tx, billId, { zohoVendorCreditId })) billsMoved++;
      }

      return {
        vendorCreditId: credit.id,
        created: !existing,
        stampedTwin,
        storeId,
        usedAmount,
        appSum,
        applications: zohoApps.length,
        refunds: zohoRefunds.length,
        billsMoved,
      };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  // ── 4. Notices (Part 3.4 step 4) ──
  if (status === "VOID") {
    notices.push(`Credit ${creditNo} is void in Zoho — removed from the ledger`);
    if (outcome.appSum > 0.01) {
      // Applications made here are a person's act; a pull never removes them (D17).
      log.warn("void credit still applied here", {
        vendorCreditId: outcome.vendorCreditId, zohoVendorCreditId, appliedHere: outcome.appSum,
      });
      notices.push(
        `Credit ${creditNo} is void in Zoho but ${rupees(outcome.appSum)} of it is applied here — remove those applications on the bill.`,
      );
    }
  }
  if (!outcome.storeId) {
    notices.push(`Store not known for ${creditNo} — set it on the vendor's Credits tab`);
  }
  // e. Over-applied across Zoho and here together (D17). Zoho's application is a fact and stays;
  //    the person is told, in both places' numbers, and the credit card shows it red.
  if (status !== "VOID" && outcome.usedAmount > total + 0.01) {
    const over = round2(outcome.usedAmount - total);
    log.warn("vendor credit over-applied", {
      vendorCreditId: outcome.vendorCreditId,
      zohoVendorCreditId,
      total,
      appliedHere: outcome.appSum,
      usedInZoho: zohoUsed,
    });
    notices.push(
      `${creditNo} is applied ${rupees(outcome.appSum)} here and ${rupees(zohoUsed)} in Zoho — ${rupees(over)} more than its ${rupees(total)} total. Remove one of them.`,
    );
  }

  log.info("vendor credit synced", {
    vendorCreditId: outcome.vendorCreditId,
    zohoVendorCreditId,
    vendorId: vendor.id,
    status,
    created: outcome.created,
    stampedTwin: outcome.stampedTwin,
    applications: outcome.applications,
    refunds: outcome.refunds,
    billsMoved: outcome.billsMoved,
  });

  return {
    vendorCreditId: outcome.vendorCreditId,
    creditNoteNo: creditNo,
    outcome: outcome.created ? "created" : "updated",
    status,
    applications: outcome.applications,
    refunds: outcome.refunds,
    billsMoved: outcome.billsMoved,
    notices,
  };
}
