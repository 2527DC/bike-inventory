// Shapes the suspense screen reads (plan 1210-bank-accounts-and-suspense, D3). They mirror
// src/app/api/bank-suspense/_lib/case-shape.ts — the routes are the source of truth.

export type SuspenseResolution = "RECORDED" | "EXPLAINED" | "WRITTEN_OFF";
export type StatusFilter = "open" | "closed" | "all";

export interface SuspenseNote {
  id: string;
  body: string;
  isSystem: boolean;
  createdAt: string;
  author: { id: string; name: string };
}

export interface SuspenseLine {
  id: string;
  statementId: string;
  /** "YYYY-MM-DD" */
  date: string;
  amount: number;
  type: "CREDIT" | "DEBIT";
  narration: string;
  reference: string | null;
  account: { id: string; name: string; bank: string; accountLast4: string | null } | null;
  /** The statement's bank string, for a line on a statement with no account yet. */
  bank: string;
}

export interface SuspenseCase {
  id: string;
  status: "OPEN" | "CLOSED";
  reason: string;
  assignee: { id: string; name: string } | null;
  assigneeName: string | null;
  assigneeLabel: string | null;
  parkedAt: string;
  parkedBy: { id: string; name: string };
  daysParked: number;
  resolvedAt: string | null;
  resolvedBy: { id: string; name: string } | null;
  resolution: SuspenseResolution | null;
  resolutionNote: string | null;
  noteCount: number;
  line: SuspenseLine;
}

/** A row of GET /api/bank-suspense. */
export interface SuspenseRow extends SuspenseCase {
  lastNote: SuspenseNote | null;
}

/** GET /api/bank-suspense/[id] — the case with its whole trail, oldest first. */
export interface SuspenseDetail extends SuspenseCase {
  notes: SuspenseNote[];
}

export const RESOLUTION_LABELS: Record<SuspenseResolution, string> = {
  RECORDED: "Recorded",
  EXPLAINED: "Explained",
  WRITTEN_OFF: "Written off",
};

export function parkedLabel(c: Pick<SuspenseCase, "status" | "daysParked">): string {
  const d = c.daysParked;
  const span = d === 0 ? "today" : d === 1 ? "1 day" : `${d} days`;
  if (c.status === "OPEN") return d === 0 ? "parked today" : `parked ${span}`;
  return d === 0 ? "closed the day it was parked" : `was parked ${span}`;
}
