export const dynamic = "force-dynamic";
// A bulk action works up to 200 lines, each in its own transaction (Q9 = a). Sequential on
// purpose — two lines may share a bill — so a full statement needs more than the default.
export const maxDuration = 60;

// GET  /api/bank-statements/[id]/review — one statement's lines, for /accounts/reconcile/[id].
// POST /api/bank-statements/[id]/review — every human decision on a bank line.
//
// Plan 1210-bank-accounts-and-suspense, §3 C2 and Part F:
//
//   - Guards (A3, Q3 = a): bank_recon.view to read; bank_recon.edit to act, PLUS bills.create to
//     record a NEW vendor payment and expenses.create to record a NEW expense. A bank-only grant
//     must not be a back door into payables or expenses. Linking to a record that already exists
//     creates nothing, so it needs bank_recon.edit alone.
//   - Every state change goes through src/lib/bank-recon/lines.ts (claimLine, closeCaseAsRecorded,
//     parkLine). The claim IS the "already handled" guard (D3): a double tap, two tabs or two people
//     record one payment for a bank debit, never two.
//   - Recording or linking money PAID needs a debit line (D4). A credit can be parked or skipped;
//     card, UPI, finance and cash deposits are matched on Daily Settlement.
//   - Bulk (txnIds): every line in its OWN transaction, so one refusal never rolls back the others
//     (L3, Q9 = a). The answer lists what happened to each.
//   - Every successful action writes an ActivityLog row in the same transaction — the "who
//     skipped this?" trail Q13 relies on, since Skip takes no reason.
import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { Prisma, type BankTransaction, type ExpenseCategory, type PaymentMode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError, type CurrentUser } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { createLogger } from "@/lib/logger";
import { listStores } from "@/lib/stores";
import { logActivity } from "@/lib/activity-log";
import { resolveStore, ExpenseAssignmentError } from "@/lib/expenses/assignment";
import { storeIdForPayment, StoreRuleError } from "@/lib/payables/store";
import { bankReviewActionSchema } from "@/lib/validations";
import { claimLine, closeCaseAsRecorded, parkLine, BankLineError } from "@/lib/bank-recon/lines";
import { matchEntries, type BookRecord, type MatchableEntry } from "@/lib/brand-ledger/reconcile";

const log = createLogger("bank-statements:review");

type Tx = Prisma.TransactionClient;

/** Paise tolerance. The money columns are Float (docs/schema-review.md §4); same epsilon as api/payments. */
const EPS = 0.01;
const DAY_MS = 86_400_000;
/** Part F looks this far either side of the statement period for a record already made. */
const LINK_WINDOW_DAYS = 30;

const round2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const lineDay = (d: Date) =>
  d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const words = (s: string) => s.toLowerCase().replace(/_/g, " ");

// ─── Expenses created from a bank debit (plan 1210-expense-store-department-and-payer, Part G) ───

/** The reconcile screen's expense chips → `ExpenseCategory`. Anything unknown is MISCELLANEOUS. */
const EXPENSE_CATEGORY_MAP: Record<string, ExpenseCategory> = {
  EXPENSE_SALARY: "SALARY_ADVANCE",
  EXPENSE_RENT: "SHOP_MAINTENANCE",
  EXPENSE_UTILITY: "UTILITIES",
  EXPENSE_DELIVERY: "DELIVERY",
  EXPENSE_TRANSPORT: "TRANSPORT",
  EXPENSE_OTHER: "MISCELLANEOUS",
};

/** How a bank line paid, read off its reference. One rule for vendor payments and expenses (L8). */
function paymentModeFromReference(reference: string | null): PaymentMode {
  if (reference?.startsWith("UPI")) return "UPI";
  if (reference?.startsWith("NEFT") || reference?.startsWith("RTGS")) return "NEFT";
  return "CHEQUE";
}

/**
 * The expense a bank debit becomes. Payer stays the typed "Bank Transfer" (E6) — the money
 * left the bank account, not a person's pocket. `notes` is how /expenses recognises a
 * bank-created row (its delete confirmation warns the bank line reopens); do not reword it.
 */
function expenseFromLine(
  line: BankTransaction,
  opts: { category: ExpenseCategory; storeId: string; recordedById: string }
): Prisma.ExpenseUncheckedCreateInput {
  return {
    date: line.date,
    amount: line.amount,
    category: opts.category,
    description: line.description,
    paidBy: "Bank Transfer",
    paidById: null,
    storeId: opts.storeId,
    paymentMode: paymentModeFromReference(line.reference),
    referenceNo: line.reference,
    notes: "Auto-recorded from bank statement",
    recordedById: opts.recordedById,
  };
}

// ─── Refusals ───────────────────────────────────────────────────────────────────

/**
 * One line refused. `message` is the sentence a single action answers with; `short` is what a
 * bulk answer lists against the line ("1 refused: already handled").
 */
class LineRefusal extends Error {
  constructor(message: string, readonly status: number, readonly short: string) {
    super(message);
    this.name = "LineRefusal";
  }
}

/** The bulk-answer phrase for a refusal, or null when the error is not a refusal at all. */
function shortReason(e: unknown): string | null {
  if (e instanceof LineRefusal) return e.short;
  if (e instanceof BankLineError) return e.status === 409 ? "already handled" : e.message;
  if (e instanceof StoreRuleError) return e.message;
  return null;
}

/** Q3 = a: confirming a NEW record also needs that record's own create grant. */
async function requireRecordGrant(user: CurrentUser, module: "bills" | "expenses"): Promise<void> {
  if (await userCan(user.id, module, "create")) return;
  throw new AuthError(
    module === "bills"
      ? "You can work bank lines, but recording one as a vendor payment also needs Bills create permission. Ask an admin to grant it — or link the line to a payment already recorded."
      : "You can work bank lines, but recording one as an expense also needs Expenses create permission. Ask an admin to grant it — or link the line to an expense already recorded.",
    403
  );
}

// ─── One line, inside its own transaction ───────────────────────────────────────

interface StatementCtx {
  id: string;
  /** "HDFC Hub", or the old free string ("HDFC") for a statement from before accounts existed. */
  accountName: string;
  /** The account's store — the fallback store of a vendor payment made from it. */
  accountStoreId: string | null;
}

interface Actor {
  user: CurrentUser;
  ctx: StatementCtx;
}

/** The line, provided it is on this statement. Read inside the transaction that acts on it. */
async function readLine(tx: Tx, ctx: StatementCtx, txnId: string): Promise<BankTransaction> {
  const line = await tx.bankTransaction.findFirst({ where: { id: txnId, statementId: ctx.id } });
  if (!line) throw new LineRefusal("This line is not on this statement. Reload.", 404, "not on this statement");
  return line;
}

/** D4 — money received must never be booked as money paid. */
function assertDebit(line: BankTransaction, what: string): void {
  if (line.type !== "DEBIT") {
    throw new LineRefusal(
      `Only a debit — money paid out — can be ${what}. This line is money received: park it in suspense or skip it.`,
      400,
      "a credit line"
    );
  }
}

const isParked = (line: BankTransaction) => line.processedAt !== null && line.matchStatus === "FLAGGED";

/** The activity row every successful action writes, in the same transaction. */
async function logLine(tx: Tx, { user, ctx }: Actor, line: BankTransaction, action: string, details?: string) {
  await logActivity(tx, {
    module: "bank_recon",
    action,
    entityType: "BankTransaction",
    entityId: line.id,
    entityRef: `${ctx.accountName} ${lineDay(line.date)} ${inr(line.amount)}`,
    details: details ?? null,
    userId: user.id,
    userName: user.name,
  });
}

/**
 * Put `amount` on a bill — the guard and the write are ONE conditional UPDATE, as in
 * api/payments: two confirmations at once cannot both settle the last ₹1,000 (Postgres re-checks
 * the WHERE on the newest row version). Status follows api/payments too: DISPUTED stays disputed,
 * a part-paid OVERDUE bill stays overdue.
 *
 * strict (a bill the person picked): every miss is a refusal, with the sentence.
 * lenient (bulk, the line's own AI-suggested bill): every miss returns null — an advance (Q9 = a).
 */
async function settleBill(
  tx: Tx,
  { billId, vendor, amount, strict }: { billId: string; vendor: { id: string; name: string }; amount: number; strict: boolean }
): Promise<{ billNo: string } | null> {
  const bill = await tx.vendorBill.findUnique({
    where: { id: billId },
    select: { id: true, billNo: true, vendorId: true, amount: true, paidAmount: true, status: true, storeId: true },
  });
  const miss = (message: string, status: number, short: string) => {
    if (strict) throw new LineRefusal(message, status, short);
    return null;
  };
  if (!bill) return miss("That bill no longer exists. Reload.", 400, "bill not found");
  if (bill.vendorId !== vendor.id) return miss(`Bill ${bill.billNo} is not a ${vendor.name} bill.`, 400, "bill of another vendor");
  // Bulk pays only a bill that is plainly open; a disputed bill is never paid without a person choosing it.
  if (!strict && !["PENDING", "PARTIALLY_PAID", "OVERDUE"].includes(bill.status)) return null;
  const remaining = round2(bill.amount - bill.paidAmount);
  if (amount > remaining + EPS) {
    return miss(
      `Bank transaction ${inr(amount)} exceeds bill ${bill.billNo} remaining ${inr(remaining)}. Confirm against the right bill, or split the payment.`,
      400,
      "more than the bill's balance"
    );
  }

  const settle = round2(amount).toFixed(2);
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE "VendorBill"
       SET "paidAmount" = round("paidAmount"::numeric + ${settle}::numeric, 2),
           status = (CASE
                       WHEN status = 'DISPUTED'::"BillStatus" THEN 'DISPUTED'
                       WHEN "paidAmount" + ${settle}::numeric >= amount - 0.01 THEN 'PAID'
                       WHEN status = 'OVERDUE'::"BillStatus" THEN 'OVERDUE'
                       ELSE 'PARTIALLY_PAID'
                     END)::"BillStatus",
           "updatedAt" = now()
     WHERE id = ${bill.id}
       AND "vendorId" = ${vendor.id}
       AND "storeId" IS NOT DISTINCT FROM ${bill.storeId}::text
       AND amount - "paidAmount" + 0.01 >= ${settle}::numeric
    RETURNING id`;
  if (rows.length === 0) return miss(`Bill ${bill.billNo} changed meanwhile. Reload and try again.`, 409, "bill changed meanwhile");
  return { billNo: bill.billNo };
}

interface PaymentOutcome {
  txnId: string;
  paymentId: string;
  billId: string | null;
}

/**
 * confirm_payment, one line. `billId` is the person's pick (single) — or, in bulk, absent: the
 * line's own AI-suggested bill is used when it is this vendor's and covers the line (Q9 = a).
 */
async function recordPayment(
  tx: Tx,
  actor: Actor,
  args: { txnId: string; vendor: { id: string; name: string }; billId: string | null; bulk: boolean }
): Promise<PaymentOutcome> {
  const line = await readLine(tx, actor.ctx, args.txnId);
  assertDebit(line, "recorded as a vendor payment");
  await claimLine(tx, line.id, { matchStatus: "MATCHED", confirmedVendorId: args.vendor.id });

  let bill: { id: string; billNo: string } | null = null;
  const candidate = args.bulk ? line.suggestedBillId : args.billId;
  if (candidate) {
    const settled = await settleBill(tx, { billId: candidate, vendor: args.vendor, amount: line.amount, strict: !args.bulk });
    if (settled) bill = { id: candidate, billNo: settled.billNo };
  }

  // The bills' store, else the statement account's store, else unset (plan 1210 credit notes, Q9).
  const storeId = bill
    ? ((await storeIdForPayment({ billIds: [bill.id], explicitStoreId: null }, tx)) ?? actor.ctx.accountStoreId)
    : actor.ctx.accountStoreId;

  const payment = await tx.vendorPayment.create({
    data: {
      vendorId: args.vendor.id,
      billId: bill?.id ?? null,
      amount: line.amount,
      paymentMode: paymentModeFromReference(line.reference),
      paymentDate: line.date,
      referenceNo: line.reference || line.description.slice(0, 50),
      notes: `Auto-recorded from bank statement: ${line.description}`,
      recordedById: actor.user.id,
      storeId,
    },
    select: { id: true },
  });
  await tx.bankTransaction.update({ where: { id: line.id }, data: { confirmedPaymentId: payment.id } });

  const what = `Payment to ${args.vendor.name} ${inr(line.amount)}${bill ? `, bill ${bill.billNo}` : ", as an advance"}`;
  await closeCaseAsRecorded(tx, line.id, actor.user.id, what);
  await logLine(tx, actor, line, "recorded_payment", what);
  return { txnId: line.id, paymentId: payment.id, billId: bill?.id ?? null };
}

/** confirm_expense, one line. The store was resolved once, before any line (resolveStore). */
async function recordExpense(
  tx: Tx,
  actor: Actor,
  args: { txnId: string; category: ExpenseCategory; store: { id: string; name: string } }
): Promise<{ txnId: string; expenseId: string }> {
  const line = await readLine(tx, actor.ctx, args.txnId);
  assertDebit(line, "recorded as an expense");
  await claimLine(tx, line.id, { matchStatus: "EXPENSE" });
  const expense = await tx.expense.create({
    data: expenseFromLine(line, { category: args.category, storeId: args.store.id, recordedById: actor.user.id }),
    select: { id: true },
  });
  // Always stamped, single or bulk (D2) — the line must say which expense it became.
  await tx.bankTransaction.update({ where: { id: line.id }, data: { confirmedExpenseId: expense.id } });

  const what = `Expense (${words(args.category)}) ${inr(line.amount)}, ${args.store.name}`;
  await closeCaseAsRecorded(tx, line.id, actor.user.id, what);
  await logLine(tx, actor, line, "recorded_expense", what);
  return { txnId: line.id, expenseId: expense.id };
}

/** Part F: one recorded payment or expense explains at most one bank line — the unique index says so. */
async function stampLink(tx: Tx, txnId: string, data: Prisma.BankTransactionUncheckedUpdateInput, what: string) {
  try {
    await tx.bankTransaction.update({ where: { id: txnId }, data });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new LineRefusal(`That ${what} is already linked to another bank line.`, 409, "already linked to another line");
    }
    throw e;
  }
}

/** The amounts must agree to the paisa (±₹0.01) — otherwise it is not the same money. */
function assertSameAmount(line: BankTransaction, recorded: number, what: string) {
  if (Math.abs(recorded - line.amount) > EPS) {
    throw new LineRefusal(
      `${inr(line.amount)} on the bank, ${inr(recorded)} recorded — not the same ${what}.`,
      400,
      "amounts differ"
    );
  }
}

/** link_payment: nothing is created and the bill is not touched — the payment moved it when it was recorded. */
async function linkPayment(tx: Tx, actor: Actor, txnId: string, paymentId: string): Promise<void> {
  const line = await readLine(tx, actor.ctx, txnId);
  assertDebit(line, "linked to a vendor payment");
  const payment = await tx.vendorPayment.findUnique({
    where: { id: paymentId },
    select: { id: true, amount: true, vendorId: true, paymentDate: true, paymentMode: true, vendor: { select: { name: true } } },
  });
  if (!payment) throw new LineRefusal("That payment no longer exists. Reload.", 404, "payment not found");
  if (payment.paymentMode === "CREDIT_ADJUSTMENT") {
    throw new LineRefusal("That entry is a credit-note adjustment, not money paid from the bank.", 400, "not a bank payment");
  }

  await claimLine(tx, line.id, { matchStatus: "MATCHED" });
  assertSameAmount(line, payment.amount, "payment");
  await stampLink(tx, line.id, { confirmedPaymentId: payment.id, confirmedVendorId: payment.vendorId }, "payment");

  const what = `Linked to the payment to ${payment.vendor.name} ${inr(payment.amount)} recorded ${lineDay(payment.paymentDate)}`;
  await closeCaseAsRecorded(tx, line.id, actor.user.id, what);
  await logLine(tx, actor, line, "linked_payment", what);
}

/** link_expense: as link_payment, for an expense recorded on /expenses. */
async function linkExpense(tx: Tx, actor: Actor, txnId: string, expenseId: string): Promise<void> {
  const line = await readLine(tx, actor.ctx, txnId);
  assertDebit(line, "linked to an expense");
  const expense = await tx.expense.findUnique({
    where: { id: expenseId },
    select: { id: true, amount: true, date: true, category: true },
  });
  if (!expense) throw new LineRefusal("That expense no longer exists. Reload.", 404, "expense not found");

  await claimLine(tx, line.id, { matchStatus: "EXPENSE" });
  assertSameAmount(line, expense.amount, "expense");
  await stampLink(tx, line.id, { confirmedExpenseId: expense.id }, "expense");

  const what = `Linked to the ${words(expense.category)} expense ${inr(expense.amount)} recorded ${lineDay(expense.date)}`;
  await closeCaseAsRecorded(tx, line.id, actor.user.id, what);
  await logLine(tx, actor, line, "linked_expense", what);
}

/** ignore: to-review lines only. A parked line closes through Explained / Written off / Recorded (Q5). */
async function skipLine(tx: Tx, actor: Actor, txnId: string): Promise<void> {
  const line = await readLine(tx, actor.ctx, txnId);
  if (isParked(line)) {
    throw new LineRefusal(
      "This line is in suspense. Close it on the Suspense screen — explained or written off — or record it.",
      409,
      "in suspense"
    );
  }
  await claimLine(tx, line.id, { matchStatus: "IGNORED" }, { allowParked: false });
  await logLine(tx, actor, line, "skipped");
}

/** Run `work` on each line in its OWN transaction; a refusal is recorded against its line and the rest go on. */
async function eachLine<T>(
  ids: string[],
  label: { statementId: string; action: string },
  work: (tx: Tx, txnId: string) => Promise<T>
): Promise<{ done: T[]; refused: { txnId: string; reason: string }[] }> {
  const done: T[] = [];
  const refused: { txnId: string; reason: string }[] = [];
  for (const txnId of ids) {
    try {
      done.push(await prisma.$transaction((tx) => work(tx, txnId)));
    } catch (e) {
      const reason = shortReason(e);
      if (reason) {
        log.warn("bulk line refused", { ...label, txnId, reason });
        refused.push({ txnId, reason });
      } else {
        // Not a refusal — the database or a bug. Logged in full; the line is reported, not hidden.
        log.error("bulk line failed", { ...label, txnId, reason: e instanceof Error ? e.message : String(e) });
        refused.push({ txnId, reason: "could not be saved — try it again" });
      }
    }
  }
  return { done, refused };
}

// ─── Part F: "Already recorded?" ────────────────────────────────────────────────

interface AlreadyRecorded {
  kind: "payment" | "expense";
  id: string;
  amount: number;
  date: Date;
  label: string;
  reference: string | null;
  /** "exact" = the line's reference (UTR) is in the record's; "likely" = same amount, nearest date. */
  confidence: "exact" | "likely";
  dayGap: number;
}

/**
 * `matchEntries`, fed one amount at a time. It only ever pairs records within ±₹0.01, so lines and
 * records of different amounts never compete and the answer is the same as one call over
 * everything — but it costs lines × records-of-that-amount instead of lines × every record, on a
 * screen that reloads after each action. Amounts are rupees and paise, so the paise bucket is exact.
 */
function matchByAmount(entries: MatchableEntry[], books: BookRecord[]) {
  const paise = (n: number) => Math.round(n * 100);
  const booksByAmount = new Map<number, BookRecord[]>();
  for (const b of books) booksByAmount.set(paise(b.amount), [...(booksByAmount.get(paise(b.amount)) ?? []), b]);
  const entriesByAmount = new Map<number, MatchableEntry[]>();
  for (const e of entries) entriesByAmount.set(paise(e.amount), [...(entriesByAmount.get(paise(e.amount)) ?? []), e]);
  return [...entriesByAmount].flatMap(([amount, group]) => matchEntries(group, booksByAmount.get(amount) ?? []));
}

/**
 * For each to-review DEBIT line, a payment or non-cash expense that looks like the same money and
 * is not linked to another line yet. `matchEntries` (brand-ledger/reconcile.ts, unchanged) runs
 * twice: payments first, then expenses for the lines still unplaced. A suggestion only — nothing
 * is linked until a person presses Link.
 */
async function alreadyRecorded(
  lines: { id: string; type: string; processedAt: Date | null; date: Date; amount: number; reference: string | null }[],
  period: { from: Date | null; to: Date | null },
  statementId: string
): Promise<Map<string, AlreadyRecorded>> {
  const open = lines.filter((l) => l.type === "DEBIT" && !l.processedAt);
  const out = new Map<string, AlreadyRecorded>();
  if (open.length === 0) return out;

  const times = open.map((l) => +l.date);
  const from = new Date(Math.min(period.from ? +period.from : Infinity, ...times) - LINK_WINDOW_DAYS * DAY_MS);
  const to = new Date(Math.max(period.to ? +period.to : -Infinity, ...times) + (LINK_WINDOW_DAYS + 1) * DAY_MS);
  const amounts = open.map((l) => l.amount);
  const amount = { gte: Math.min(...amounts) - EPS, lte: Math.max(...amounts) + EPS };

  const [payments, expenses] = await Promise.all([
    prisma.vendorPayment.findMany({
      where: { paymentDate: { gte: from, lte: to }, amount, paymentMode: { not: "CREDIT_ADJUSTMENT" } },
      select: { id: true, amount: true, paymentDate: true, referenceNo: true, vendor: { select: { name: true } }, bill: { select: { billNo: true } } },
      orderBy: { paymentDate: "asc" },
    }),
    prisma.expense.findMany({
      where: { date: { gte: from, lte: to }, amount, paymentMode: { not: "CASH" } },
      select: { id: true, amount: true, date: true, referenceNo: true, category: true, store: { select: { name: true } } },
      orderBy: { date: "asc" },
    }),
  ]);
  if (payments.length === 0 && expenses.length === 0) return out;

  const linkedRows = await prisma.bankTransaction.findMany({
    where: {
      OR: [
        { confirmedPaymentId: { in: payments.map((p) => p.id) } },
        { confirmedExpenseId: { in: expenses.map((e) => e.id) } },
      ],
    },
    select: { confirmedPaymentId: true, confirmedExpenseId: true },
  });
  const linked = new Set(linkedRows.flatMap((r) => [r.confirmedPaymentId, r.confirmedExpenseId]).filter(Boolean));

  const freePayments = payments.filter((p) => !linked.has(p.id));
  const freeExpenses = expenses.filter((e) => !linked.has(e.id));
  const toEntry = (l: (typeof open)[number]): MatchableEntry => ({ id: l.id, entryDate: l.date, amount: l.amount, ref: l.reference });

  // `kind` is the matcher's own label set; only payments vs expenses matters here, and each run is one of them.
  const paymentBooks: BookRecord[] = freePayments.map((p) => ({ id: p.id, date: p.paymentDate, amount: p.amount, reference: p.referenceNo, kind: "payment" }));
  const paymentById = new Map(freePayments.map((p) => [p.id, p]));
  for (const m of matchByAmount(open.map(toEntry), paymentBooks)) {
    const p = m.bookId ? paymentById.get(m.bookId) : undefined;
    if (!p || m.confidence === "none") continue;
    out.set(m.entryId, {
      kind: "payment",
      id: p.id,
      amount: p.amount,
      date: p.paymentDate,
      label: `Payment to ${p.vendor.name}${p.bill ? ` · bill ${p.bill.billNo}` : ""}`,
      reference: p.referenceNo,
      confidence: m.confidence,
      dayGap: m.dayGap ?? 0,
    });
  }

  const unplaced = open.filter((l) => !out.has(l.id));
  const expenseBooks: BookRecord[] = freeExpenses.map((e) => ({ id: e.id, date: e.date, amount: e.amount, reference: e.referenceNo, kind: "payment" }));
  const expenseById = new Map(freeExpenses.map((e) => [e.id, e]));
  for (const m of matchByAmount(unplaced.map(toEntry), expenseBooks)) {
    const e = m.bookId ? expenseById.get(m.bookId) : undefined;
    if (!e || m.confidence === "none") continue;
    out.set(m.entryId, {
      kind: "expense",
      id: e.id,
      amount: e.amount,
      date: e.date,
      label: `Expense · ${words(e.category)}${e.store ? ` · ${e.store.name}` : ""}`,
      reference: e.referenceNo,
      confidence: m.confidence,
      dayGap: m.dayGap ?? 0,
    });
  }

  log.debug("already-recorded suggestions", {
    statementId,
    openDebits: open.length,
    payments: freePayments.length,
    expenses: freeExpenses.length,
    suggested: out.size,
  });
  return out;
}

// ─── GET ────────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let statementId = "";
  try {
    await requireFeature("bank_recon", "view");
    const { id } = await params;
    statementId = id;
    const started = Date.now();

    const [statement, stores] = await Promise.all([
      prisma.bankStatement.findUnique({
        where: { id },
        select: {
          id: true,
          bank: true,
          fileName: true,
          fromDate: true,
          toDate: true,
          totalCredits: true,
          totalDebits: true,
          txnCount: true,
          createdAt: true,
          uploadedBy: { select: { name: true } },
          bankAccount: {
            select: {
              id: true,
              name: true,
              bank: true,
              accountLast4: true,
              storeId: true,
              store: { select: { id: true, name: true, code: true } },
            },
          },
          transactions: {
            orderBy: { date: "desc" },
            select: {
              id: true,
              date: true,
              description: true,
              reference: true,
              amount: true,
              type: true,
              balance: true,
              matchStatus: true,
              flagReason: true,
              suggestedCategory: true,
              confidence: true,
              suggestedVendor: { select: { id: true, name: true } },
              suggestedBill: { select: { id: true, billNo: true, amount: true, paidAmount: true, vendorId: true, status: true } },
              confirmedVendorId: true,
              confirmedVendor: { select: { name: true } },
              confirmedPaymentId: true,
              confirmedExpenseId: true,
              processedAt: true,
              suspense: {
                select: {
                  id: true,
                  reason: true,
                  assigneeName: true,
                  assignee: { select: { name: true } },
                  parkedAt: true,
                  resolution: true,
                  resolvedAt: true,
                  resolutionNote: true,
                  _count: { select: { notes: true } },
                },
              },
            },
          },
        },
      }),
      listStores(),
    ]);

    if (!statement) return errorResponse("Statement not found", 404);

    const suggestions = await alreadyRecorded(
      statement.transactions,
      { from: statement.fromDate, to: statement.toDate },
      id
    );

    const transactions = statement.transactions.map(({ suspense, ...t }) => ({
      ...t,
      suspense: suspense
        ? {
            id: suspense.id,
            reason: suspense.reason,
            // The staff user's name, or the typed outsider's ("Deekshith (external accountant)").
            assignee: suspense.assignee?.name ?? suspense.assigneeName ?? null,
            assigneeOutside: !suspense.assignee && !!suspense.assigneeName,
            parkedAt: suspense.parkedAt,
            resolution: suspense.resolution,
            resolvedAt: suspense.resolvedAt,
            resolutionNote: suspense.resolutionNote,
            noteCount: suspense._count.notes,
          }
        : null,
      alreadyRecorded: suggestions.get(t.id) ?? null,
    }));

    // The Expense panel's store chips. Served here so reconciling needs no `expenses` grant.
    const expenseStores = stores.map((s) => ({ id: s.id, name: s.name }));
    log.debug("statement loaded", {
      statementId: id,
      lines: transactions.length,
      suggestions: suggestions.size,
      ms: Date.now() - started,
    });
    return successResponse({ ...statement, transactions, expenseStores });
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("statement load refused", { statementId, status: error.status });
      return errorResponse(error.message, error.status);
    }
    return failure(error, { scope: "bank-statements:review", step: "load", statementId });
  }
}

// ─── POST ───────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Hoisted so the catch can name what failed. Identifiers only — never the body.
  let statementId = "";
  let actionName = "";
  try {
    const user = await requireFeature("bank_recon", "edit");
    const { id } = await params;
    statementId = id;

    let raw: unknown;
    try {
      raw = await req.json();
    } catch (e) {
      log.warn("review action refused: body is not JSON", { statementId, reason: e instanceof Error ? e.message : String(e) });
      return errorResponse("Send the action as JSON.", 400);
    }
    const data = bankReviewActionSchema.parse(raw);
    actionName = data.action;

    const statement = await prisma.bankStatement.findUnique({
      where: { id },
      select: { id: true, bank: true, bankAccount: { select: { name: true, storeId: true } } },
    });
    if (!statement) return errorResponse("Statement not found", 404);
    const actor: Actor = {
      user,
      ctx: {
        id,
        accountName: statement.bankAccount?.name ?? statement.bank,
        accountStoreId: statement.bankAccount?.storeId ?? null,
      },
    };
    const label = { statementId: id, action: data.action };

    switch (data.action) {
      case "confirm_payment": {
        await requireRecordGrant(user, "bills");
        const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId }, select: { id: true, name: true } });
        if (!vendor) return errorResponse("That vendor no longer exists. Reload.", 400);

        if (data.txnIds) {
          // L3 (Q9 = a): no bill is picked for many lines — each line pays its OWN suggested bill.
          if (data.billId) {
            return errorResponse("Pick a bill one line at a time. In a bulk payment each line pays its own suggested bill, or is an advance.", 400);
          }
          const ids = [...new Set(data.txnIds)];
          const { done, refused } = await eachLine(ids, label, (tx, txnId) =>
            recordPayment(tx, actor, { txnId, vendor, billId: null, bulk: true })
          );
          const againstBills = done.filter((d) => d.billId).length;
          log.info("bank lines recorded as payments", {
            ...label,
            vendorId: vendor.id,
            txnIds: done.map((d) => d.txnId),
            paymentIds: done.map((d) => d.paymentId),
            againstBills,
            asAdvances: done.length - againstBills,
            refused: refused.length,
          });
          return successResponse({ action: data.action, processed: done.length, againstBills, asAdvances: done.length - againstBills, refused });
        }

        const outcome = await prisma.$transaction((tx) =>
          recordPayment(tx, actor, { txnId: data.txnId!, vendor, billId: data.billId ?? null, bulk: false })
        );
        log.info("bank line recorded as payment", { ...label, txnIds: [outcome.txnId], paymentId: outcome.paymentId, vendorId: vendor.id, billId: outcome.billId });
        return successResponse({ action: "payment_recorded", paymentId: outcome.paymentId, billId: outcome.billId });
      }

      case "confirm_expense": {
        await requireRecordGrant(user, "expenses");
        const store = await resolveStore(data.storeId, user.id);
        const category = EXPENSE_CATEGORY_MAP[data.category ?? ""] ?? "MISCELLANEOUS";
        const ids = data.txnIds ? [...new Set(data.txnIds)] : [data.txnId!];

        if (data.txnIds) {
          const { done, refused } = await eachLine(ids, label, (tx, txnId) => recordExpense(tx, actor, { txnId, category, store }));
          log.info("bank lines recorded as expenses", {
            ...label,
            txnIds: done.map((d) => d.txnId),
            expenseIds: done.map((d) => d.expenseId),
            storeId: store.id,
            refused: refused.length,
          });
          return successResponse({ action: data.action, processed: done.length, refused });
        }

        const outcome = await prisma.$transaction((tx) => recordExpense(tx, actor, { txnId: ids[0], category, store }));
        log.info("bank line recorded as expense", { ...label, txnIds: [outcome.txnId], expenseIds: [outcome.expenseId], storeId: store.id });
        return successResponse({ action: "expense_recorded", expenseId: outcome.expenseId });
      }

      case "link_payment": {
        await prisma.$transaction((tx) => linkPayment(tx, actor, data.txnId, data.paymentId));
        log.info("bank line linked to a payment", { ...label, txnIds: [data.txnId], paymentId: data.paymentId });
        return successResponse({ action: "payment_linked", paymentId: data.paymentId });
      }

      case "link_expense": {
        await prisma.$transaction((tx) => linkExpense(tx, actor, data.txnId, data.expenseId));
        log.info("bank line linked to an expense", { ...label, txnIds: [data.txnId], expenseId: data.expenseId });
        return successResponse({ action: "expense_linked", expenseId: data.expenseId });
      }

      case "ignore": {
        if (data.txnIds) {
          const { done, refused } = await eachLine([...new Set(data.txnIds)], label, async (tx, txnId) => {
            await skipLine(tx, actor, txnId);
            return txnId;
          });
          log.info("bank lines skipped", { ...label, txnIds: done, refused: refused.length });
          return successResponse({ action: data.action, processed: done.length, refused });
        }
        await prisma.$transaction((tx) => skipLine(tx, actor, data.txnId!));
        log.info("bank line skipped", { ...label, txnIds: [data.txnId] });
        return successResponse({ action: "ignored" });
      }

      case "flag": {
        // Park in suspense (R6, D2) — debit or credit, to-review lines only.
        const parked = await prisma.$transaction(async (tx) => {
          const line = await readLine(tx, actor.ctx, data.txnId);
          if (isParked(line)) throw new LineRefusal("This line is already in suspense.", 409, "already in suspense");
          const res = await parkLine(tx, line.id, {
            reason: data.reason,
            assigneeId: data.assigneeId ?? null,
            assigneeName: data.assigneeName ?? null,
            userId: user.id,
          });
          await logLine(tx, actor, line, "parked", data.reason);
          return res;
        });
        log.info("bank line parked", { ...label, txnIds: [data.txnId], suspenseId: parked.suspenseId, reopened: parked.reopened });
        return successResponse({ action: "parked", suspenseId: parked.suspenseId, reopened: parked.reopened });
      }
    }
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("review action refused", { statementId, action: actionName, status: error.status, reason: "permission" });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Invalid request";
      log.warn("review action failed validation", { statementId, action: actionName, message });
      return errorResponse(message, 400);
    }
    if (error instanceof LineRefusal || error instanceof BankLineError || error instanceof ExpenseAssignmentError) {
      log.warn("review action refused", { statementId, action: actionName, status: error.status, reason: error.message });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof StoreRuleError) {
      log.warn("review action refused", { statementId, action: actionName, status: 400, reason: error.message });
      return errorResponse(error.message, 400);
    }
    return failure(error, { scope: "bank-statements:review", statementId, action: actionName });
  }
}
