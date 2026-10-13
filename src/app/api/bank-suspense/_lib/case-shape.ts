// What the suspense routes answer for one case (plan 1210-bank-accounts-and-suspense, D2).
// Shared by GET /api/bank-suspense (the list), GET and PATCH /api/bank-suspense/[id] (the
// sheet), so a card and its sheet can never disagree about a field. A private folder (`_lib`)
// — not a route.
import type { Prisma, BankTxnType, SuspenseResolution } from "@prisma/client";
import { businessDate, fromDateColumn } from "@/lib/analytics/time";
import { diffDays } from "@/lib/bank-recon/status";

export const CASE_SELECT = {
  id: true,
  reason: true,
  assigneeId: true,
  assigneeName: true,
  assignee: { select: { id: true, name: true } },
  parkedAt: true,
  parkedBy: { select: { id: true, name: true } },
  resolvedAt: true,
  resolvedBy: { select: { id: true, name: true } },
  resolution: true,
  resolutionNote: true,
  bankTxn: {
    select: {
      id: true,
      statementId: true,
      date: true,
      amount: true,
      type: true,
      description: true,
      reference: true,
      bankAccount: { select: { id: true, name: true, bank: true, accountLast4: true } },
      // The free string on statements uploaded before accounts existed ("HDFC" / "ICICI").
      statement: { select: { bank: true } },
    },
  },
  _count: { select: { notes: true } },
} satisfies Prisma.BankSuspenseSelect;

type CaseRecord = Prisma.BankSuspenseGetPayload<{ select: typeof CASE_SELECT }>;

export const NOTE_SELECT = {
  id: true,
  body: true,
  isSystem: true,
  createdAt: true,
  author: { select: { id: true, name: true } },
} satisfies Prisma.BankSuspenseNoteSelect;

type NoteRecord = Prisma.BankSuspenseNoteGetPayload<{ select: typeof NOTE_SELECT }>;

export interface SuspenseNoteDto {
  id: string;
  body: string;
  isSystem: boolean;
  createdAt: string;
  author: { id: string; name: string };
}

export function toNoteDto(n: NoteRecord): SuspenseNoteDto {
  return { id: n.id, body: n.body, isSystem: n.isSystem, createdAt: n.createdAt.toISOString(), author: n.author };
}

export interface SuspenseCaseDto {
  id: string;
  status: "OPEN" | "CLOSED";
  reason: string;
  assignee: { id: string; name: string } | null;
  /** Typed name of someone outside the team. */
  assigneeName: string | null;
  /** "Ravi", "Deekshith (outside)", or null when nobody chases it. */
  assigneeLabel: string | null;
  parkedAt: string;
  parkedBy: { id: string; name: string };
  /** Calendar days (IST) from parking to today, or to the day it closed. */
  daysParked: number;
  resolvedAt: string | null;
  resolvedBy: { id: string; name: string } | null;
  resolution: SuspenseResolution | null;
  resolutionNote: string | null;
  noteCount: number;
  line: {
    id: string;
    statementId: string;
    /** "YYYY-MM-DD" — the bank's date for the line. */
    date: string;
    amount: number;
    type: BankTxnType;
    narration: string;
    reference: string | null;
    /** null on a statement uploaded before bank accounts existed. */
    account: { id: string; name: string; bank: string; accountLast4: string | null } | null;
    /** The statement's bank string — what to show when `account` is null. */
    bank: string;
  };
}

export function toCaseDto(c: CaseRecord, now: Date = new Date()): SuspenseCaseDto {
  const t = c.bankTxn;
  const assigneeLabel = c.assignee
    ? c.assignee.name
    : c.assigneeName
      ? `${c.assigneeName} (outside)`
      : null;
  return {
    id: c.id,
    status: c.resolvedAt ? "CLOSED" : "OPEN",
    reason: c.reason,
    assignee: c.assignee,
    assigneeName: c.assignee ? null : c.assigneeName,
    assigneeLabel,
    parkedAt: c.parkedAt.toISOString(),
    parkedBy: c.parkedBy,
    daysParked: Math.max(0, diffDays(businessDate(c.parkedAt), businessDate(c.resolvedAt ?? now))),
    resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
    resolvedBy: c.resolvedBy,
    resolution: c.resolution,
    resolutionNote: c.resolutionNote,
    noteCount: c._count.notes,
    line: {
      id: t.id,
      statementId: t.statementId,
      date: fromDateColumn(t.date),
      amount: t.amount,
      type: t.type,
      narration: t.description,
      reference: t.reference,
      account: t.bankAccount,
      bank: t.statement.bank,
    },
  };
}

/** "HDFC Hub 04 Oct 2026 ₹48,200" — the activity feed's reference for a bank line. */
export function lineRef(line: SuspenseCaseDto["line"]): string {
  const where = line.account?.name ?? line.bank;
  const when = new Date(`${line.date}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const amount = `₹${line.amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  return `${where} ${when} ${amount}`;
}
