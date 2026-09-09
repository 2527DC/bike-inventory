"use client";

// App.jsx:802-831
import { useState } from "react";
import type { LedgerEntryWrite } from "@/lib/brand-ledger/view-types";
import { ENTRY_TYPES, today } from "./ledger-helpers";

export function EntryForm({
  onSave,
  onCancel,
}: {
  onSave: (vals: LedgerEntryWrite) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState({
    date: today(),
    type: "payment" as LedgerEntryWrite["type"],
    ref: "",
    amount: "" as number | "",
    note: "",
  });
  const set =
    (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setV({ ...v, [k]: e.target.value } as typeof v);
  return (
    <div className="card form">
      <h3>New entry</h3>
      <div className="row">
        <div>
          <label>Date</label>
          <input type="date" value={v.date} onChange={set("date")} />
        </div>
        <div>
          <label>Type</label>
          <select value={v.type} onChange={set("type")}>
            {ENTRY_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label>Amount (₹)</label>
          <input type="number" value={v.amount} onChange={set("amount")} />
        </div>
        <div>
          <label>Ref / txn ID</label>
          <input value={v.ref} onChange={set("ref")} placeholder="UTR, invoice no., CN no." />
        </div>
      </div>
      <div>
        <label>Note</label>
        <input value={v.note} onChange={set("note")} />
      </div>
      <div className="formactions">
        <button className="iconbtn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="iconbtn primary"
          disabled={v.type !== "note" && v.amount === ""}
          onClick={() => onSave({ ...v, amount: v.amount === "" ? null : Number(v.amount) })}
        >
          Save
        </button>
      </div>
    </div>
  );
}
