// The supplier ledger — one definition of "what do we owe this supplier", shared by the ledger
// screens, the vendor page's Overview and the bill page's header. Plan 1210 credit notes and
// payables, Part 6 (R7, R8, R9; findings F5, L14, X8, X9).
//
// WHY ONE QUERY OVER ALL HISTORY
// ------------------------------
// The old route read the newest 50 bills and 50 payments, sorted those ≤100 rows ascending and
// ran the balance forward from the opening figure. For any supplier past 50 rows the starting
// point was wrong, and it then returned the OLDEST 20 of that window labelled "latest" (L14,
// X8). Here the running balance is a window function over every row the supplier has ever had,
// and only the page is cut afterwards — so page 3 continues page 2's balance to the paisa.
//
// THE LINES (D9)
// --------------
//   BILL           billDate     debit  amount                    always
//   CREDIT NOTE    creditDate   credit amount                    status OPEN or CLOSED (VOID drops out)
//   CREDIT REFUND  refundDate   debit  refund amount             its credit is not VOID
//   PAYMENT        paymentDate  credit amount + cdDiscountAmount creditId IS NULL
//
// D9, as a rule: a credit note is subtracted ONCE, on its own date, by its CREDIT NOTE line.
// Applying it to a bill — here (Apply credit) or in Zoho — is NOT a line; it is shown under the
// credit as "applied to 4567". The only other way a credit could be subtracted is a legacy
// CREDIT_ADJUSTMENT payment that names it (Q14), and those are excluded by `creditId IS NULL`.
// A credit-adjustment payment that names no credit stays a payment line: it is the only record
// of that credit.
//
// STORES (Q8 = a)
// ---------------
// `storeId` undefined → every store; an id → that store's rows; "none" → rows with no store.
// `Vendor.openingBalance` (1 Apr 2026) is one number per supplier, not split by store, so it is
// the opening on the all-stores view only. A store view starts at 0 and says why.
//
// MONEY TYPES
// -----------
// Old money columns are Float, new ones Decimal(12,2). Everything is cast to numeric inside the
// query, summed there, rounded to 2 places and handed back as float8 so JSON gets plain numbers.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("payables:ledger");

export type LedgerStoreFilter = string | "none";

export type LedgerEntryKind = "BILL" | "CREDIT" | "REFUND" | "PAYMENT";

/** One application of a credit note to a bill, shown under the credit's line (never a line). */
export interface LedgerCreditApplication {
  applicationId: string;
  source: "ZOHO" | "APP";
  /** The bill in this app, or null when Zoho applied it to a bill not imported yet. */
  billId: string | null;
  billNo: string | null;
  amount: number;
  date: string;
}

export interface LedgerEntry {
  id: string;
  kind: LedgerEntryKind;
  /** ISO timestamp of the business date (bill / credit / refund / payment date). */
  date: string;
  /** Bill number, credit-note number, the refunded credit's number, or the payment reference. */
  reference: string;
  description: string;
  /** We owe more. */
  debit: number;
  /** We owe less. */
  credit: number;
  /** Running balance after this line, over the supplier's whole history (in this store view). */
  balance: number;
  storeId: string | null;
  /** BILL: bill status. CREDIT: OPEN / CLOSED. */
  status: string | null;
  /** BILL: the stored due date (Q5). */
  dueDate: string | null;
  /** PAYMENT: the bill it paid. */
  billId: string | null;
  billNo: string | null;
  /** PAYMENT: payment mode. REFUND: refund mode. */
  mode: string | null;
  /** CREDIT: the supplier's own credit-note number. REFUND: the refund's reference. */
  supplierRef: string | null;
  /** PAYMENT: the cash-discount part of `credit`. 0 on every other line. */
  cd: number;
  /** REFUND: the credit it refunds. */
  creditId: string | null;
  /** CREDIT: amount − usedAmount (negative = applied for more than its total, D17). */
  open: number | null;
  /** CREDIT: where it was applied. Empty for other kinds. */
  appliedTo: LedgerCreditApplication[];
}

export interface LedgerTotals {
  bills: number;
  /** Cash paid — the CD part of each payment is in `cd`, not here. */
  payments: number;
  cd: number;
  credits: number;
  refunds: number;
}

export interface OverSettledBill {
  id: string;
  billNo: string;
  amount: number;
  paidAmount: number;
  /** paidAmount − amount: the trace of a CD taken twice (Q4) or a credit applied twice. */
  over: number;
}

export interface VendorLedger {
  vendor: { id: string; name: string; code: string; openingBalance: number };
  /** null on the all-stores view. `{ id: "none", … }` for the "Not set" view. */
  store: { id: string; code: string | null; name: string } | null;
  opening: number;
  /** Set on a store view: the opening balance is not split by store (Q8 = a). */
  openingNote: string | null;
  closing: number;
  totals: LedgerTotals;
  /** Newest first. */
  entries: LedgerEntry[];
  page: number;
  pageSize: number;
  totalEntries: number;
  /** True when `all` was asked and the supplier has more rows than the export cap. */
  truncated: boolean;
  overSettledBills: OverSettledBill[];
}

export interface VendorLedgerOptions {
  storeId?: LedgerStoreFilter;
  page?: number;
  pageSize?: number;
  /** Every row up to EXPORT_CAP, newest first, for an Excel export. Ignores page/pageSize. */
  all?: boolean;
}

/** Thrown for a vendor or store that does not exist. The route answers 404 with the message. */
export class LedgerNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerNotFoundError";
  }
}

export const LEDGER_DEFAULT_PAGE_SIZE = 50;
export const LEDGER_MAX_PAGE_SIZE = 200;
export const LEDGER_EXPORT_CAP = 5000;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The store predicate on the unified rows. */
function storeFilterSql(storeId: LedgerStoreFilter | undefined): Prisma.Sql {
  if (storeId === undefined) return Prisma.sql`TRUE`;
  if (storeId === "none") return Prisma.sql`"storeId" IS NULL`;
  return Prisma.sql`"storeId" = ${storeId}`;
}

/**
 * Every line of one supplier's ledger, unordered, scoped to a store. The four kinds share one
 * column list so the window function and the totals run over the same rows.
 *
 * `day` is the IST calendar day: same-day lines order bill → credit → refund → payment whatever
 * the clock time stored on each, which is what a printed ledger shows.
 */
function scopedRowsSql(vendorId: string, storeId: LedgerStoreFilter | undefined): Prisma.Sql {
  return Prisma.sql`
    WITH ledger_rows AS (
      SELECT b.id, b."billDate" AS d, 1 AS ord, 'BILL'::text AS kind, b."billNo" AS ref,
             b.amount::numeric AS dr, 0::numeric AS cr, 0::numeric AS cd, b."storeId", b."createdAt",
             b.status::text AS status, b."dueDate" AS due, NULL::text AS "billId", NULL::text AS "billNo",
             NULL::text AS mode, NULL::text AS ref2, NULL::text AS "creditId", NULL::numeric AS open
        FROM "VendorBill" b
       WHERE b."vendorId" = ${vendorId}
      UNION ALL
      SELECT c.id, c."creditDate", 2, 'CREDIT', c."creditNoteNo",
             0::numeric, c.amount::numeric, 0::numeric, c."storeId", c."createdAt",
             c.status::text, NULL, NULL, NULL,
             NULL, c."referenceNo", NULL, (c.amount - c."usedAmount")::numeric
        FROM "VendorCredit" c
       WHERE c."vendorId" = ${vendorId} AND c.status IN ('OPEN', 'CLOSED')
      UNION ALL
      SELECT r.id, r."refundDate", 3, 'REFUND', c."creditNoteNo",
             r.amount::numeric, 0::numeric, 0::numeric, c."storeId", r."createdAt",
             NULL, NULL, NULL, NULL,
             r."refundMode", r."referenceNo", c.id, NULL
        FROM "VendorCreditRefund" r
        JOIN "VendorCredit" c ON c.id = r."vendorCreditId"
       WHERE c."vendorId" = ${vendorId} AND c.status <> 'VOID'
      UNION ALL
      SELECT p.id, p."paymentDate", 4, 'PAYMENT', coalesce(nullif(p."referenceNo", ''), p."paymentMode"::text),
             0::numeric, (p.amount + p."cdDiscountAmount")::numeric, p."cdDiscountAmount"::numeric, p."storeId", p."createdAt",
             NULL, NULL, p."billId", pb."billNo",
             p."paymentMode"::text, NULL, NULL, NULL
        FROM "VendorPayment" p
        LEFT JOIN "VendorBill" pb ON pb.id = p."billId"
       WHERE p."vendorId" = ${vendorId} AND p."creditId" IS NULL
    ), scoped AS (
      SELECT *, (d AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS day
        FROM ledger_rows
       WHERE ${storeFilterSql(storeId)}
    )`;
}

interface TotalsRow {
  bills: number;
  payments: number;
  cd: number;
  credits: number;
  refunds: number;
  n: number;
}

function totalsQuery(vendorId: string, storeId: LedgerStoreFilter | undefined) {
  return prisma.$queryRaw<TotalsRow[]>`
    ${scopedRowsSql(vendorId, storeId)}
    SELECT round(coalesce(sum(dr) FILTER (WHERE kind = 'BILL'), 0), 2)::float8         AS bills,
           round(coalesce(sum(cr - cd) FILTER (WHERE kind = 'PAYMENT'), 0), 2)::float8 AS payments,
           round(coalesce(sum(cd) FILTER (WHERE kind = 'PAYMENT'), 0), 2)::float8      AS cd,
           round(coalesce(sum(cr) FILTER (WHERE kind = 'CREDIT'), 0), 2)::float8       AS credits,
           round(coalesce(sum(dr) FILTER (WHERE kind = 'REFUND'), 0), 2)::float8       AS refunds,
           count(*)::int                                                                AS n
      FROM scoped`;
}

function closingFrom(opening: number, t: Pick<TotalsRow, "bills" | "payments" | "cd" | "credits" | "refunds">) {
  return round2(opening + t.bills - t.payments - t.cd - t.credits + t.refunds);
}

/**
 * What we owe this supplier now: opening + Σ bills − Σ payments − Σ CD − Σ credit notes
 * + Σ refunds, over all history. The opening counts only on the all-stores view (Q8 = a).
 *
 * The one balance formula — `GET /api/bills/[id]`, the vendor page's Overview and the ledger's
 * closing figure all come from here, so they cannot disagree (§2.4's three numbers).
 * A vendor that does not exist has a balance of 0.
 */
export async function vendorBalance(vendorId: string, storeId?: LedgerStoreFilter): Promise<number> {
  const started = Date.now();
  const [vendor, rows] = await Promise.all([
    storeId === undefined
      ? prisma.vendor.findUnique({ where: { id: vendorId }, select: { openingBalance: true } })
      : Promise.resolve(null),
    totalsQuery(vendorId, storeId),
  ]);
  const opening = storeId === undefined ? vendor?.openingBalance ?? 0 : 0;
  const balance = closingFrom(opening, rows[0]);
  log.debug("vendor balance", { vendorId, storeId: storeId ?? "all", rows: rows[0].n, ms: Date.now() - started });
  return balance;
}

interface PageRow {
  id: string;
  d: Date;
  kind: LedgerEntryKind;
  ref: string;
  dr: number;
  cr: number;
  cd: number;
  storeId: string | null;
  status: string | null;
  due: Date | null;
  billId: string | null;
  billNo: string | null;
  mode: string | null;
  ref2: string | null;
  creditId: string | null;
  open: number | null;
  balance: number;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function describe(r: PageRow): string {
  switch (r.kind) {
    case "BILL":
      return `Bill ${r.ref}`;
    case "CREDIT":
      return `Credit note ${r.ref}${r.ref2 ? ` (supplier ref ${r.ref2})` : ""}`;
    case "REFUND":
      return `Refund of credit note ${r.ref}${r.mode ? ` by ${r.mode}` : ""}`;
    case "PAYMENT": {
      const forBill = r.billNo ? ` for ${r.billNo}` : r.billId ? "" : " (advance)";
      const cd = r.cd > 0 ? ` · incl. CD ${inr(r.cd)}` : "";
      return `Payment${forBill}${r.mode ? ` via ${r.mode}` : ""}${cd}`;
    }
  }
}

/**
 * One supplier's ledger, newest first, with a running balance computed over the whole history
 * of the chosen store view.
 *
 * @throws LedgerNotFoundError for an unknown vendor or store.
 */
export async function vendorLedger(vendorId: string, opts: VendorLedgerOptions = {}): Promise<VendorLedger> {
  const started = Date.now();
  const storeId = opts.storeId;
  const all = opts.all === true;
  const pageSize = all
    ? LEDGER_EXPORT_CAP
    : Math.min(LEDGER_MAX_PAGE_SIZE, Math.max(1, Math.floor(opts.pageSize ?? LEDGER_DEFAULT_PAGE_SIZE)));
  const page = all ? 1 : Math.max(1, Math.floor(opts.page ?? 1));
  const offset = (page - 1) * pageSize;

  const [vendor, store] = await Promise.all([
    prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, name: true, code: true, openingBalance: true },
    }),
    storeId && storeId !== "none"
      ? prisma.store.findUnique({ where: { id: storeId }, select: { id: true, code: true, name: true } })
      : Promise.resolve(null),
  ]);
  if (!vendor) throw new LedgerNotFoundError("Vendor not found");
  if (storeId && storeId !== "none" && !store) throw new LedgerNotFoundError("Store not found");

  const opening = storeId === undefined ? round2(vendor.openingBalance) : 0;

  // One snapshot for the totals and the page, so the closing figure always equals the newest
  // line's balance even while someone records a payment.
  const [totalsRows, pageRows] = await prisma.$transaction(
    [
      totalsQuery(vendorId, storeId),
      prisma.$queryRaw<PageRow[]>`
        ${scopedRowsSql(vendorId, storeId)}
        SELECT id, d, kind, ref,
               round(dr, 2)::float8 AS dr, round(cr, 2)::float8 AS cr, round(cd, 2)::float8 AS cd,
               "storeId", status, due, "billId", "billNo", mode, ref2, "creditId",
               round(open, 2)::float8 AS open,
               round(${opening}::numeric + sum(dr - cr) OVER (
                 ORDER BY day, ord, d, "createdAt", id
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ), 2)::float8 AS balance
          FROM scoped
         ORDER BY day DESC, ord DESC, d DESC, "createdAt" DESC, id DESC
         LIMIT ${pageSize} OFFSET ${offset}`,
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  const totalsRow = totalsRows[0];

  // "Applied to …" under each credit line on this page — read, never a line of its own (D9).
  const creditIds = pageRows.filter((r) => r.kind === "CREDIT").map((r) => r.id);
  const applications = creditIds.length
    ? await prisma.vendorCreditApplication.findMany({
        where: { vendorCreditId: { in: creditIds } },
        orderBy: { appliedDate: "asc" },
        select: {
          id: true,
          source: true,
          vendorCreditId: true,
          billId: true,
          amount: true,
          appliedDate: true,
          bill: { select: { billNo: true } },
        },
      })
    : [];
  const appsByCredit = new Map<string, LedgerCreditApplication[]>();
  for (const a of applications) {
    if (!a.vendorCreditId) continue;
    const list = appsByCredit.get(a.vendorCreditId) ?? [];
    list.push({
      applicationId: a.id,
      source: a.source,
      billId: a.billId,
      billNo: a.bill?.billNo ?? null,
      amount: round2(Number(a.amount)),
      date: a.appliedDate.toISOString(),
    });
    appsByCredit.set(a.vendorCreditId, list);
  }

  // Bills settled for more than their amount, in this store view.
  const overRows = await prisma.$queryRaw<OverSettledBill[]>`
    SELECT id, "billNo",
           round(amount::numeric, 2)::float8                       AS amount,
           round("paidAmount"::numeric, 2)::float8                 AS "paidAmount",
           round(("paidAmount" - amount)::numeric, 2)::float8      AS over
      FROM "VendorBill"
     WHERE "vendorId" = ${vendorId}
       AND "paidAmount" > amount + 0.01
       AND ${storeFilterSql(storeId)}
     ORDER BY "billDate" DESC
     LIMIT 100`;

  const entries: LedgerEntry[] = pageRows.map((r) => ({
    id: r.id,
    kind: r.kind,
    date: r.d.toISOString(),
    reference: r.ref,
    description: describe(r),
    debit: r.dr,
    credit: r.cr,
    balance: r.balance,
    storeId: r.storeId,
    status: r.status,
    dueDate: r.due ? r.due.toISOString() : null,
    billId: r.billId,
    billNo: r.billNo,
    mode: r.mode,
    supplierRef: r.ref2,
    cd: r.cd,
    creditId: r.creditId,
    open: r.open,
    appliedTo: r.kind === "CREDIT" ? appsByCredit.get(r.id) ?? [] : [],
  }));

  const totals: LedgerTotals = {
    bills: totalsRow.bills,
    payments: totalsRow.payments,
    cd: totalsRow.cd,
    credits: totalsRow.credits,
    refunds: totalsRow.refunds,
  };

  const storeOut =
    storeId === undefined
      ? null
      : storeId === "none"
        ? { id: "none", code: null, name: "Not set" }
        : { id: store!.id, code: store!.code, name: store!.name };

  const openingNote =
    storeId === undefined || Math.abs(vendor.openingBalance) < 0.005
      ? null
      : `Opening balance (${inr(round2(vendor.openingBalance))}, 1 Apr 2026) is not split by store, so this view starts at ₹0.`;

  if (overRows.length > 0) {
    log.warn("over-settled bills on the ledger", { vendorId, storeId: storeId ?? "all", count: overRows.length });
  }
  log.debug("ledger built", {
    vendorId,
    storeId: storeId ?? "all",
    page,
    rows: entries.length,
    totalEntries: totalsRow.n,
    ms: Date.now() - started,
  });

  return {
    vendor: { id: vendor.id, name: vendor.name, code: vendor.code, openingBalance: round2(vendor.openingBalance) },
    store: storeOut,
    opening,
    openingNote,
    closing: closingFrom(opening, totalsRow),
    totals,
    entries,
    page,
    pageSize,
    totalEntries: totalsRow.n,
    truncated: all && totalsRow.n > entries.length,
    overSettledBills: overRows,
  };
}
