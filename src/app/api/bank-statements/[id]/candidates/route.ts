export const dynamic = "force-dynamic";

// GET /api/bank-statements/[id]/candidates?txnId=<line> — Part F's manual picker
// (plan 1210-bank-accounts-and-suspense, Q11, D12).
//
// A payment entered on /payments/new, or an expense entered on /expenses, and later seen on the
// bank statement must be LINKED to its line — recording it again from the bank screen would book
// the same money twice. This lists what the line could be: every vendor payment and expense of the
// same amount (±₹0.01) dated within 30 days either side, that no bank line explains yet. Reference
// (UTR) matches first, then the nearest date; at most 10.
//
// bank_recon.edit, not view: the list exists only to be linked, and linking is an edit. Nothing is
// written here — POST …/review { action: "link_payment" | "link_expense" } does the linking.
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("bank-statements:candidates");

/** Paise tolerance — the money columns are Float (docs/schema-review.md §4). */
const EPS = 0.01;
const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
const MAX_RESULTS = 10;
/** Read a few more than shown, so the ones already linked can be dropped and still leave ten. */
const READ_PER_KIND = 50;

const querySchema = z.object({
  txnId: z.string({ error: "Say which bank line — txnId" }).trim().min(1, "Say which bank line — txnId").max(64),
});

const words = (s: string) => s.toLowerCase().replace(/_/g, " ");
const normaliseRef = (ref: string | null | undefined) => String(ref || "").replace(/[^a-z0-9]/gi, "").toLowerCase();

/** The UTR on the bank line and the reference typed on the record name the same transfer. */
function sameReference(bankRef: string | null, recordRef: string | null): boolean {
  const a = normaliseRef(bankRef);
  const b = normaliseRef(recordRef);
  if (a.length < 6 || b.length < 6) return false;
  return a.includes(b) || b.includes(a);
}

interface Candidate {
  kind: "payment" | "expense";
  id: string;
  amount: number;
  date: Date;
  label: string;
  detail: string | null;
  reference: string | null;
  referenceMatch: boolean;
  dayGap: number;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let statementId = "";
  let txnId = "";
  try {
    await requireFeature("bank_recon", "edit");
    const { id } = await params;
    statementId = id;

    const parsed = querySchema.safeParse({ txnId: req.nextUrl.searchParams.get("txnId") ?? undefined });
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Say which bank line — txnId";
      log.warn("candidates refused", { statementId, message });
      return errorResponse(message, 400);
    }
    txnId = parsed.data.txnId;

    const line = await prisma.bankTransaction.findFirst({
      where: { id: txnId, statementId: id },
      select: { id: true, type: true, amount: true, date: true, reference: true },
    });
    if (!line) return errorResponse("This line is not on this statement. Reload.", 404);
    if (line.type !== "DEBIT") {
      log.warn("candidates refused", { statementId, txnId, reason: "credit line" });
      return errorResponse("Only a debit — money paid out — can be linked to a payment or an expense.", 400);
    }

    const date = { gte: new Date(+line.date - WINDOW_DAYS * DAY_MS), lt: new Date(+line.date + (WINDOW_DAYS + 1) * DAY_MS) };
    const amount = { gte: line.amount - EPS, lte: line.amount + EPS };

    const [payments, expenses] = await Promise.all([
      prisma.vendorPayment.findMany({
        // A credit-note adjustment is not money that left the bank.
        where: { amount, paymentDate: date, paymentMode: { not: "CREDIT_ADJUSTMENT" } },
        select: {
          id: true,
          amount: true,
          paymentDate: true,
          paymentMode: true,
          referenceNo: true,
          vendor: { select: { name: true } },
          bill: { select: { billNo: true } },
        },
        orderBy: { paymentDate: "desc" },
        take: READ_PER_KIND,
      }),
      prisma.expense.findMany({
        where: { amount, date },
        select: {
          id: true,
          amount: true,
          date: true,
          category: true,
          description: true,
          paymentMode: true,
          referenceNo: true,
          store: { select: { name: true } },
        },
        orderBy: { date: "desc" },
        take: READ_PER_KIND,
      }),
    ]);

    // Already explaining another bank line → not offered; the unique index would refuse it anyway.
    const linkedRows =
      payments.length + expenses.length === 0
        ? []
        : await prisma.bankTransaction.findMany({
            where: {
              OR: [
                { confirmedPaymentId: { in: payments.map((p) => p.id) } },
                { confirmedExpenseId: { in: expenses.map((e) => e.id) } },
              ],
            },
            select: { confirmedPaymentId: true, confirmedExpenseId: true },
          });
    const linked = new Set(linkedRows.flatMap((r) => [r.confirmedPaymentId, r.confirmedExpenseId]).filter(Boolean));
    const gap = (d: Date) => Math.round(Math.abs(+d - +line.date) / DAY_MS);

    const candidates: Candidate[] = [
      ...payments
        .filter((p) => !linked.has(p.id))
        .map((p): Candidate => ({
          kind: "payment",
          id: p.id,
          amount: p.amount,
          date: p.paymentDate,
          label: `Payment to ${p.vendor.name}`,
          detail: [p.bill ? `bill ${p.bill.billNo}` : "advance", words(p.paymentMode)].join(" · "),
          reference: p.referenceNo,
          referenceMatch: sameReference(line.reference, p.referenceNo),
          dayGap: gap(p.paymentDate),
        })),
      ...expenses
        .filter((e) => !linked.has(e.id))
        .map((e): Candidate => ({
          kind: "expense",
          id: e.id,
          amount: e.amount,
          date: e.date,
          label: `Expense · ${words(e.category)}${e.store ? ` · ${e.store.name}` : ""}`,
          detail: [e.description.slice(0, 80), words(e.paymentMode)].filter(Boolean).join(" · "),
          reference: e.referenceNo,
          referenceMatch: sameReference(line.reference, e.referenceNo),
          dayGap: gap(e.date),
        })),
    ]
      .sort((a, b) => Number(b.referenceMatch) - Number(a.referenceMatch) || a.dayGap - b.dayGap)
      .slice(0, MAX_RESULTS);

    log.debug("candidates listed", {
      statementId,
      txnId,
      payments: payments.length,
      expenses: expenses.length,
      alreadyLinked: linked.size,
      shown: candidates.length,
    });
    return successResponse({ candidates });
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("candidates refused", { statementId, txnId, status: error.status });
      return errorResponse(error.message, error.status);
    }
    return failure(error, { scope: "bank-statements:candidates", statementId, txnId });
  }
}
