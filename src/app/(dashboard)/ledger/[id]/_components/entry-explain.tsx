"use client";

// App.jsx:697-722
// Tap-to-explain: what this entry is + its audit verdict + the linked gap card
import type { LedgerBrandView, LedgerViewEntry } from "@/lib/brand-ledger/view-types";
import { gapAmount, gapId, statusColor } from "./ledger-helpers";

export function EntryExplain({
  e,
  brand,
  onOpenGap,
}: {
  e: LedgerViewEntry;
  brand: LedgerBrandView;
  onOpenGap?: (n: number) => void;
}) {
  const TYPE_EXPLAIN: Record<string, string> = {
    invoice: `${brand.name} billed BCH — increases what BCH owes`,
    payment: `BCH paid ${brand.name} — reduces the balance`,
    "credit-note": `${brand.name} credited BCH (return/CN) — reduces the balance`,
    discount: `Discount journal passed by ${brand.name} — reduces the balance`,
    "debit-note": "Debit raised — increases the balance",
    adjustment: "Journal adjustment — reduces the balance",
    note: "Informational note",
  };
  const gap = e.audit?.g ? brand.gaps.find((g) => g.n === e.audit!.g) : null;
  return (
    <div className="bexplain">
      <div className="bx-type">{TYPE_EXPLAIN[e.type] || e.type}</div>
      {e.audit && <div className={"auditline a-" + e.audit.s}>{e.audit.t}</div>}
      {gap && (
        <div
          className="gapinline"
          onClick={(ev) => {
            if (onOpenGap) {
              ev.stopPropagation();
              onOpenGap(gap.n);
            }
          }}
          style={onOpenGap ? { cursor: "pointer" } : undefined}
        >
          <b>{gapId(brand, gap.n)}</b>{" "}
          <span className={"chip " + (statusColor[gap.status] || "")}>{gap.status}</span> {gapAmount(gap)}
          <div>{gap.title}</div>
          {gap.action && <div className="bx-action">→ {gap.action}</div>}
          {onOpenGap && (
            <div className="bx-action" style={{ color: "var(--blue)" }}>
              Open full gap →
            </div>
          )}
        </div>
      )}
    </div>
  );
}
