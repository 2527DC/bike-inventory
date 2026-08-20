export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import {
  runningBalance,
  checkBalance,
  matchEntries,
  unclaimedBooks,
  assessCoverage,
  type BookRecord,
} from "@/lib/brand-ledger/reconcile";

// GET — one vendor's full reconciliation: their statement, our books, and the difference.
//
// The two sides are assembled separately and compared here. Nothing in this route writes:
// matching is computed per request so it always reflects the current state of Accounts, and
// a match is only persisted when a human confirms it (see the review endpoint).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("brand_ledger", "view");
    const { id } = await params;

    const vendor = await prisma.vendor.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        gstin: true,
        openingBalance: true,
        cdTermsDays: true,
        cdPercentage: true,
        brands: { select: { brand: { select: { id: true, name: true } }, isPrimary: true } },
      },
    });
    if (!vendor) return errorResponse("Vendor not found", 404);

    // ── THEIR side ──────────────────────────────────────────────────────────
    const entries = await prisma.brandLedgerEntry.findMany({
      where: { vendorId: id },
      orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true, entryDate: true, type: true, ref: true, amount: true, direction: true,
        side: true, note: true, source: true, auditStatus: true, auditNote: true,
        matchStatus: true, billId: true, paymentId: true, creditId: true, gapId: true,
        reviewNote: true,
      },
    });

    // ── OUR side ────────────────────────────────────────────────────────────
    const [bills, payments, credits] = await Promise.all([
      prisma.vendorBill.findMany({
        where: { vendorId: id },
        select: { id: true, billNo: true, billDate: true, amount: true, paidAmount: true, status: true },
        orderBy: { billDate: "asc" },
      }),
      prisma.vendorPayment.findMany({
        where: { vendorId: id },
        select: { id: true, amount: true, paymentDate: true, referenceNo: true, paymentMode: true },
        orderBy: { paymentDate: "asc" },
      }),
      prisma.vendorCredit.findMany({
        where: { vendorId: id },
        select: { id: true, creditNoteNo: true, amount: true, creditDate: true, reason: true },
        orderBy: { creditDate: "asc" },
      }),
    ]);

    const books: BookRecord[] = [
      ...bills.map((b) => ({ id: b.id, date: b.billDate, amount: b.amount, reference: b.billNo, kind: "bill" as const })),
      ...payments.map((p) => ({ id: p.id, date: p.paymentDate, amount: p.amount, reference: p.referenceNo, kind: "payment" as const })),
      ...credits.map((c) => ({ id: c.id, date: c.creditDate, amount: c.amount, reference: c.creditNoteNo, kind: "credit" as const })),
    ];

    // ── Compare ─────────────────────────────────────────────────────────────
    const latestStatement = await prisma.brandStatement.findFirst({
      where: { vendorId: id },
      orderBy: { statementDate: "desc" },
      select: {
        id: true, statementDate: true, claimedClosing: true, computedClosing: true,
        tiesOut: true, fileUrl: true, fileName: true, sourceKind: true, periodFrom: true, periodTo: true,
      },
    });

    const withBalance = runningBalance(entries, vendor.openingBalance);
    const balance = checkBalance(entries, vendor.openingBalance, latestStatement?.claimedClosing ?? null);

    const matches = matchEntries(
      entries.map((e) => ({ id: e.id, entryDate: e.entryDate, amount: e.amount, ref: e.ref })),
      books
    );
    const matchByEntry = new Map(matches.map((m) => [m.entryId, m]));

    // Things WE hold that never appeared on their statement — the most valuable output.
    const theyMissing = unclaimedBooks(books, matches);

    // ── Claims ──────────────────────────────────────────────────────────────
    // Gated separately: a live dispute is more sensitive than the statement it came from.
    const canSeeGaps = await userCan(user.id, "brand_ledger_gaps", "view");
    const gaps = canSeeGaps
      ? await prisma.ledgerGap.findMany({
          where: { vendorId: id },
          orderBy: { number: "asc" },
          include: {
            evidence: { select: { id: true, url: true, kind: true, source: true, note: true, capturedOn: true } },
            _count: { select: { notes: true, entries: true } },
          },
        })
      : [];

    const discountTerms = await prisma.vendorDiscountTerm.findMany({
      where: { vendorId: id },
      orderBy: [{ kind: "asc" }, { effectiveFrom: "asc" }],
    });

    return successResponse({
      vendor,
      entries: withBalance.map(({ entry, balance: bal }) => ({
        ...entry,
        balance: bal,
        match: matchByEntry.get(entry.id) ?? null,
      })),
      books: { bills, payments, credits },
      theyMissing,
      balance,
      latestStatement,
      coverage: assessCoverage(books.length, entries.length),
      gaps,
      canSeeGaps,
      discountTerms,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}
