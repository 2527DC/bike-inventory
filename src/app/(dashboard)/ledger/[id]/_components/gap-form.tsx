"use client";

// App.jsx:446-487
import { useState } from "react";
import type { LedgerGapWrite, LedgerViewGap, LedgerViewGapStatus, LedgerViewGapType } from "@/lib/brand-ledger/view-types";
import { GAP_STATUSES, GAP_TYPES, gapId } from "./ledger-helpers";

export function GapForm({
  initial,
  onSave,
  onCancel,
  brand,
}: {
  initial: LedgerViewGap | null;
  onSave: (vals: LedgerGapWrite) => void;
  onCancel: () => void;
  brand: { code: string };
}) {
  const [v, setV] = useState(() => ({
    title: initial?.title || "",
    type: (initial?.type || GAP_TYPES[0]) as LedgerViewGapType,
    amt: initial?.amt ?? ("" as number | ""),
    amtText: initial?.amtText || "",
    status: (initial?.status || "open") as LedgerViewGapStatus,
    evidence: initial?.evidence || "",
    action: initial?.action || "",
  }));
  const set =
    (k: keyof typeof v) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setV({ ...v, [k]: e.target.value } as typeof v);
  return (
    <div className="card form">
      <h3>{initial ? `Edit ${gapId(brand, initial.n)}` : "New gap"}</h3>
      <div>
        <label>Title</label>
        <textarea value={v.title} onChange={set("title")} />
      </div>
      <div className="row">
        <div>
          <label>Type</label>
          <select value={v.type} onChange={set("type")}>
            {GAP_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Status</label>
          <select value={v.status} onChange={set("status")}>
            {GAP_STATUSES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label>Amount (₹, number)</label>
          <input type="number" value={v.amt} onChange={set("amt")} placeholder="blank = TBD" />
        </div>
        <div>
          <label>Amount display (optional)</label>
          <input value={v.amtText} onChange={set("amtText")} placeholder="e.g. 1.3–1.4L / TBD" />
        </div>
      </div>
      <div>
        <label>Evidence</label>
        <textarea value={v.evidence} onChange={set("evidence")} />
      </div>
      <div>
        <label>Action</label>
        <textarea value={v.action} onChange={set("action")} />
      </div>
      <div className="formactions">
        <button className="iconbtn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="iconbtn primary"
          disabled={!v.title.trim()}
          onClick={() =>
            onSave({
              ...v,
              amt: v.amt === "" ? null : Number(v.amt),
              title: v.title.trim(),
            })
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}
