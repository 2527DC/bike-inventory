// The ONLY code that changes a bank line's state (plan 1210-bank-accounts-and-suspense, §3 C1).
//
// Every writer — the review route, the suspense routes, the settlement routes, the expense
// delete — calls these, so the invariant below cannot drift between modules (finding L13: two
// modules used to write matchStatus independently).
//
//   State                          matchStatus            processedAt  Suspense case
//   To review                      UNMATCHED              null         none, or closed
//   Recorded as a vendor payment   MATCHED + paymentId    set          none, or closed RECORDED
//   Recorded as an expense         EXPENSE + expenseId    set          none, or closed RECORDED
//   Matched in a daily settlement  MATCHED + a match      set          none, or closed RECORDED
//   Skipped                        IGNORED                set          none
//   In suspense                    FLAGGED                set          OPEN
//   Suspense explained/written off IGNORED                set          closed EXPLAINED / WRITTEN_OFF
//
// INVARIANT: FLAGGED and processed ⇔ an open BankSuspense case.
//
// A transaction-taking helper in src/lib departs from backend-engineer.md's "logic in the
// route"; it is named in the plan and justified by the cross-module invariant
// (stock-location.ts is the precedent). Every function takes the transaction client.
import type { Prisma, SuspenseResolution } from "@prisma/client";
import { createLogger } from "@/lib/logger";

type Tx = Prisma.TransactionClient;

const log = createLogger("bank-recon:lines");

/** A refusal the route answers with this status and sentence. */
export class BankLineError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "BankLineError";
  }
}

const ALREADY_HANDLED = "This line was already handled — reload to see how.";

/**
 * Claim a line for a decision, atomically. The guard IS the write: under Postgres' row lock a
 * second, simultaneous claim re-reads the row and finds nothing to claim (count 0 → 409).
 *
 * A line in suspense (FLAGGED) can still be claimed — recording it closes its case (D1) — unless
 * `allowParked` is false (Skip and Park take to-review lines only: a parked line closes only
 * through Explained / Written off / Recorded, Q5).
 */
export async function claimLine(
  tx: Tx,
  txnId: string,
  data: Prisma.BankTransactionUncheckedUpdateManyInput,
  opts: { allowParked?: boolean } = {}
): Promise<void> {
  const allowParked = opts.allowParked ?? true;
  const res = await tx.bankTransaction.updateMany({
    where: {
      id: txnId,
      OR: allowParked ? [{ processedAt: null }, { matchStatus: "FLAGGED" }] : [{ processedAt: null }],
    },
    data: { ...data, processedAt: new Date() },
  });
  if (res.count === 0) {
    log.warn("line claim lost", { txnId, allowParked });
    throw new BankLineError(ALREADY_HANDLED, 409);
  }
}

/** If the line has an open suspense case, close it RECORDED with a system note. */
export async function closeCaseAsRecorded(
  tx: Tx,
  txnId: string,
  userId: string,
  sentence: string
): Promise<boolean> {
  const open = await tx.bankSuspense.findFirst({
    where: { bankTxnId: txnId, resolvedAt: null },
    select: { id: true },
  });
  if (!open) return false;
  await tx.bankSuspense.update({
    where: { id: open.id },
    data: { resolvedAt: new Date(), resolvedById: userId, resolution: "RECORDED", resolutionNote: sentence },
  });
  await tx.bankSuspenseNote.create({
    data: { suspenseId: open.id, body: `Recorded: ${sentence}`, isSystem: true, authorId: userId },
  });
  log.info("suspense closed as recorded", { suspenseId: open.id, txnId });
  return true;
}

/**
 * The record behind a line went away (settlement match removed, settlement deleted, sessions
 * re-pulled, expense deleted). A line that came OUT of suspense goes back INTO suspense with its
 * case reopened; any other line returns to "to review". Confirmed ids are cleared either way.
 */
export async function releaseLine(tx: Tx, txnId: string, userId: string, why: string): Promise<"suspense" | "review"> {
  const suspense = await tx.bankSuspense.findUnique({
    where: { bankTxnId: txnId },
    select: { id: true, resolution: true, resolvedAt: true },
  });
  const cleared = { confirmedPaymentId: null, confirmedExpenseId: null, confirmedVendorId: null };

  if (suspense && suspense.resolution === "RECORDED") {
    await tx.bankSuspense.update({
      where: { id: suspense.id },
      data: { resolvedAt: null, resolvedById: null, resolution: null, resolutionNote: null },
    });
    await tx.bankSuspenseNote.create({
      data: { suspenseId: suspense.id, body: `Reopened: ${why}`, isSystem: true, authorId: userId },
    });
    await tx.bankTransaction.update({
      where: { id: txnId },
      data: { ...cleared, matchStatus: "FLAGGED", processedAt: new Date() },
    });
    log.info("line released back to suspense", { txnId, suspenseId: suspense.id });
    return "suspense";
  }

  await tx.bankTransaction.update({
    where: { id: txnId },
    data: { ...cleared, matchStatus: "UNMATCHED", processedAt: null },
  });
  log.info("line released to review", { txnId });
  return "review";
}

async function assertAssignee(tx: Tx, assigneeId: string | null | undefined): Promise<string | null> {
  if (!assigneeId) return null;
  const user = await tx.user.findUnique({ where: { id: assigneeId }, select: { name: true, isActive: true } });
  if (!user || !user.isActive) throw new BankLineError("Pick an active staff member to chase this line.", 400);
  return user.name;
}

function assigneeSentence(name: string | null, typed: string | null | undefined): string | null {
  if (name) return `Assigned to ${name}`;
  if (typed) return `Assigned to ${typed} (outside the team)`;
  return null;
}

/**
 * Park a to-review line in suspense (R6). Creates the line's case, or reopens its earlier one
 * so the whole history stays in one notes trail. Writes "Parked: …" and, when given,
 * "Assigned to …" system notes in the same transaction.
 */
export async function parkLine(
  tx: Tx,
  txnId: string,
  input: { reason: string; assigneeId?: string | null; assigneeName?: string | null; userId: string }
): Promise<{ suspenseId: string; reopened: boolean }> {
  const assigneeId = input.assigneeId || null;
  const assigneeName = assigneeId ? null : input.assigneeName?.trim() || null;
  const userName = await assertAssignee(tx, assigneeId);

  await claimLine(tx, txnId, { matchStatus: "FLAGGED" }, { allowParked: false });

  const existing = await tx.bankSuspense.findUnique({ where: { bankTxnId: txnId }, select: { id: true } });
  const now = new Date();
  const suspense = existing
    ? await tx.bankSuspense.update({
        where: { id: existing.id },
        data: {
          reason: input.reason,
          assigneeId,
          assigneeName,
          parkedById: input.userId,
          parkedAt: now,
          resolvedAt: null,
          resolvedById: null,
          resolution: null,
          resolutionNote: null,
        },
        select: { id: true },
      })
    : await tx.bankSuspense.create({
        data: { bankTxnId: txnId, reason: input.reason, assigneeId, assigneeName, parkedById: input.userId, parkedAt: now },
        select: { id: true },
      });

  const notes = [`Parked: ${input.reason}`];
  const assigned = assigneeSentence(userName, assigneeName);
  if (assigned) notes.push(assigned);
  await tx.bankSuspenseNote.createMany({
    data: notes.map((body) => ({ suspenseId: suspense.id, body, isSystem: true, authorId: input.userId })),
  });
  log.info("line parked", { txnId, suspenseId: suspense.id, reopened: !!existing, assigned: !!assigned });
  return { suspenseId: suspense.id, reopened: !!existing };
}

/** Change who chases an open case. A system note records it. */
export async function assignCase(
  tx: Tx,
  suspenseId: string,
  input: { assigneeId?: string | null; assigneeName?: string | null; userId: string }
): Promise<void> {
  const assigneeId = input.assigneeId || null;
  const assigneeName = assigneeId ? null : input.assigneeName?.trim() || null;
  const userName = await assertAssignee(tx, assigneeId);
  const res = await tx.bankSuspense.updateMany({
    where: { id: suspenseId, resolvedAt: null },
    data: { assigneeId, assigneeName },
  });
  if (res.count === 0) throw new BankLineError("This case is closed — reopen it to reassign.", 409);
  await tx.bankSuspenseNote.create({
    data: {
      suspenseId,
      body: assigneeSentence(userName, assigneeName) ?? "Unassigned",
      isSystem: true,
      authorId: input.userId,
    },
  });
}

/**
 * Close an open case as EXPLAINED or WRITTEN_OFF (Q5). The line becomes IGNORED. The caller
 * checks the permission: EXPLAINED needs bank_recon.edit, WRITTEN_OFF bank_recon.approve.
 */
export async function resolveCase(
  tx: Tx,
  suspenseId: string,
  input: { resolution: Exclude<SuspenseResolution, "RECORDED">; note: string; userId: string }
): Promise<void> {
  const res = await tx.bankSuspense.updateMany({
    where: { id: suspenseId, resolvedAt: null },
    data: { resolvedAt: new Date(), resolvedById: input.userId, resolution: input.resolution, resolutionNote: input.note },
  });
  if (res.count === 0) throw new BankLineError("This case is already closed — reload to see how.", 409);
  const c = await tx.bankSuspense.findUniqueOrThrow({ where: { id: suspenseId }, select: { bankTxnId: true } });
  await tx.bankTransaction.update({ where: { id: c.bankTxnId }, data: { matchStatus: "IGNORED" } });
  const label = input.resolution === "EXPLAINED" ? "Explained" : "Written off";
  await tx.bankSuspenseNote.create({
    data: { suspenseId, body: `${label}: ${input.note}`, isSystem: true, authorId: input.userId },
  });
  log.info("suspense resolved", { suspenseId, txnId: c.bankTxnId, resolution: input.resolution });
}

/**
 * Reopen an EXPLAINED or WRITTEN_OFF case (D1). The line goes back to FLAGGED. A RECORDED case
 * cannot be reopened here — undo the record instead (plan §5).
 */
export async function reopenCase(tx: Tx, suspenseId: string, input: { note: string; userId: string }): Promise<void> {
  const res = await tx.bankSuspense.updateMany({
    where: { id: suspenseId, resolvedAt: { not: null }, resolution: { in: ["EXPLAINED", "WRITTEN_OFF"] } },
    data: { resolvedAt: null, resolvedById: null, resolution: null, resolutionNote: null },
  });
  if (res.count === 0) {
    throw new BankLineError(
      "Only an explained or written-off case can be reopened. A recorded line is reopened by undoing its payment, expense or settlement match.",
      409
    );
  }
  const c = await tx.bankSuspense.findUniqueOrThrow({ where: { id: suspenseId }, select: { bankTxnId: true } });
  await tx.bankTransaction.update({ where: { id: c.bankTxnId }, data: { matchStatus: "FLAGGED", processedAt: new Date() } });
  await tx.bankSuspenseNote.create({
    data: { suspenseId, body: `Reopened: ${input.note}`, isSystem: true, authorId: input.userId },
  });
  log.info("suspense reopened", { suspenseId, txnId: c.bankTxnId });
}
