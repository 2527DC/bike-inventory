import { Star } from "lucide-react";
import { assemblyLevelLabel } from "@/lib/assembly-level";
import { deliveryDayLabel, HOLD_ISSUE_LABEL, type HoldIssue, type ReservedFor } from "./types";

/** "85% · Semi-built" chip, or a muted "Level not set" for a product nobody has decided yet. */
export function LevelChip({ level }: { level: string | null | undefined }) {
  return level ? (
    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-indigo-100">
      {assemblyLevelLabel(level)}
    </span>
  ) : (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
      Level not set
    </span>
  );
}

/** ★ + the delivery day, on every unit or build held for a priority outward (R20). */
export function StarChip({ reservedFor }: { reservedFor: ReservedFor | null | undefined }) {
  if (!reservedFor) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 ring-1 ring-amber-200"
      title={`Priority for ${reservedFor.invoiceNo}`}
    >
      <Star className="h-3 w-3 fill-amber-500 text-amber-500" aria-hidden />
      <span className="sr-only">Priority,</span>
      {deliveryDayLabel(reservedFor.scheduledDate)}
    </span>
  );
}

export function HoldIssueChip({ issue, legacyReason }: { issue: HoldIssue | null | undefined; legacyReason?: string | null }) {
  const text = issue ? HOLD_ISSUE_LABEL[issue] : legacyReason;
  if (!text) return null;
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${
        issue === "CYCLE"
          ? "bg-red-50 text-red-700 ring-red-100"
          : issue === "WORKFLOOR"
          ? "bg-amber-50 text-amber-800 ring-amber-100"
          : "bg-slate-100 text-slate-600 ring-slate-200"
      }`}
    >
      {text}
    </span>
  );
}
