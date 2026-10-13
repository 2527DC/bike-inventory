export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { getTodayIST } from "@/lib/services/timezone";
import { fromDateColumn, toDateColumn } from "@/lib/analytics/time";
import { computeStatus, type StatementPeriod } from "@/lib/bank-recon/status";

const log = createLogger("bank-accounts:status");

// GET /api/bank-accounts/status — the weekly reconciliation tile on /accounts (plan
// 1210-bank-accounts-and-suspense, R5, D17, §3 E2). Read only, and read when the page loads:
// nothing here runs on a timer (no cron, no polling — CLAUDE.md).
//
// Per ACTIVE account, in parallel: its statements (periods, latest upload), then — once the
// start day is known — three small indexed reads: lines still to review, the first open line,
// open suspense cases. The rule that turns those into "reconciled up to" is the pure
// computeStatus (src/lib/bank-recon/status.ts). Statements with no account (uploaded before
// accounts existed, Q7) are not counted until someone assigns them.
export async function GET() {
  try {
    await requireFeature("bank_recon", "view");
    const started = Date.now();
    const today = getTodayIST();

    const accounts = await prisma.bankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        bank: true,
        accountLast4: true,
        reconcileFrom: true,
        store: { select: { id: true, code: true, name: true } },
      },
    });

    const rows = await Promise.all(
      accounts.map(async (a) => {
        const statements = await prisma.bankStatement.findMany({
          where: { bankAccountId: a.id },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            fromDate: true,
            toDate: true,
            createdAt: true,
            uploadedBy: { select: { name: true } },
          },
        });
        const periods: StatementPeriod[] = statements
          .filter((s) => s.fromDate && s.toDate)
          .map((s) => ({ from: fromDateColumn(s.fromDate!), to: fromDateColumn(s.toDate!) }));

        // Q4: reconcileFrom, or — blank — the earliest period start.
        const reconcileFrom = a.reconcileFrom ? fromDateColumn(a.reconcileFrom) : null;
        const start = reconcileFrom ?? periods.reduce<string | null>((min, p) => (min === null || p.from < min ? p.from : min), null);
        const onOrAfterStart = start ? { gte: toDateColumn(start) } : undefined;

        const [unmatched, firstOpen, suspense] = await Promise.all([
          prisma.bankTransaction.count({
            where: { bankAccountId: a.id, processedAt: null, ...(onOrAfterStart ? { date: onOrAfterStart } : {}) },
          }),
          // The earliest line still to review OR parked — either holds the date back. findFirst
          // (not aggregate _min) so the tile's Review button can open that very line.
          prisma.bankTransaction.findFirst({
            where: {
              bankAccountId: a.id,
              ...(onOrAfterStart ? { date: onOrAfterStart } : {}),
              OR: [{ processedAt: null }, { matchStatus: "FLAGGED" }],
            },
            orderBy: [{ date: "asc" }, { id: "asc" }],
            select: { id: true, date: true, statementId: true },
          }),
          // Every open case on the account's lines, whatever its date: a deliberate park is
          // never filtered out (E1 step 5).
          prisma.bankSuspense.count({ where: { resolvedAt: null, bankTxn: { bankAccountId: a.id } } }),
        ]);

        const status = computeStatus(periods, firstOpen ? fromDateColumn(firstOpen.date) : null, start, today);
        const latest = statements[0] ?? null;

        return {
          id: a.id,
          name: a.name,
          bank: a.bank,
          accountLast4: a.accountLast4,
          store: a.store,
          reconcileFrom,
          start: status.start,
          reconciledUpTo: status.reconciledUpTo,
          daysBehind: status.daysBehind,
          stale: status.stale,
          coveredTo: status.coveredTo,
          missing: status.missing,
          unmatched,
          suspense,
          statementCount: statements.length,
          lastUpload: latest
            ? {
                statementId: latest.id,
                at: latest.createdAt.toISOString(),
                by: latest.uploadedBy.name,
                from: latest.fromDate ? fromDateColumn(latest.fromDate) : null,
                to: latest.toDate ? fromDateColumn(latest.toDate) : null,
              }
            : null,
          // Where "Review" goes: the first open line on its statement, else the latest upload.
          firstOpen: firstOpen ? { txnId: firstOpen.id, statementId: firstOpen.statementId, date: fromDateColumn(firstOpen.date) } : null,
        };
      })
    );

    log.debug("status computed", {
      accounts: rows.length,
      stale: rows.filter((r) => r.stale).length,
      ms: Date.now() - started,
    });
    return successResponse({ today, accounts: rows });
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("status refused", { status: error.status });
      return errorResponse(error.message, error.status);
    }
    return failure(error, { scope: "bank-accounts:status" });
  }
}
