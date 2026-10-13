"use client";

// The column mapping the AI chose for a sheet, editable (plan 1310 Part C). Every change goes
// up to the parent, which re-applies the plan to the kept cells in the browser at once — no
// network and no AI call. The parent decides whether a change may wipe hand edits.
import { useState } from "react";
import {
  IMPORT_PREVIEW_ROWS,
  PLAN_COLUMNS,
  type ImportSheet,
  type PlanColumn,
  type SheetPlan,
} from "@/lib/brand-ledger/prompted-import";

const FIELD_LABEL: Record<PlanColumn, string> = {
  date: "Date",
  label: "Particulars / description",
  type: "Voucher type",
  ref: "Reference / invoice no.",
  note: "Note",
  debit: "Debit — BCH owes more",
  credit: "Credit — BCH owes less",
  amount: "One signed amount column",
  balance: "Running balance",
};

const SKIP_WORDS_MAX = 20;

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Widest row from the header down — the planProblem rule, so the two never disagree. */
function widthFrom(sheet: ImportSheet, headerRow: number): number {
  return Math.max(0, ...sheet.rows.slice(headerRow, headerRow + 50).map((r) => r.length));
}

/** "Sheet1, header row 5 — date: Date (column 1), debit: AMOUNT (column 4)…" */
export function mappingSummary(plan: SheetPlan, sheets: ImportSheet[]): string {
  const sheet = sheets.find((s) => s.name === plan.sheet);
  const header = sheet?.rows[plan.headerRow] ?? [];
  const parts = PLAN_COLUMNS.filter((c) => plan.columns[c] !== null).map((c) => {
    const i = plan.columns[c] as number;
    const h = (header[i] ?? "").trim();
    return `${c}: ${h ? `"${clip(h, 30)}"` : "unnamed"} (column ${i + 1})`;
  });
  return `${plan.sheet}, header row ${plan.headerRow + 1} — ${parts.join(", ") || "no columns mapped"}`;
}

export function MappingEditor({
  plan,
  aiPlan,
  sheets,
  problem,
  disabled,
  onChange,
  onReset,
}: {
  plan: SheetPlan;
  aiPlan: SheetPlan;
  sheets: ImportSheet[];
  problem: string | null;
  disabled: boolean;
  onChange: (next: SheetPlan) => void;
  onReset: () => void;
}) {
  const [word, setWord] = useState("");
  const sheet = sheets.find((s) => s.name === plan.sheet) ?? sheets[0];
  const header = sheet?.rows[plan.headerRow] ?? [];
  const width = sheet ? widthFrom(sheet, plan.headerRow) : 0;
  const isAiPlan = JSON.stringify(plan) === JSON.stringify(aiPlan);

  // Header-row choices: the rows the AI saw (the first 40), plus the current one if further down.
  const headerChoices = sheet
    ? Array.from({ length: Math.min(IMPORT_PREVIEW_ROWS, sheet.rows.length) }, (_, i) => i)
    : [];
  if (sheet && plan.headerRow >= headerChoices.length && plan.headerRow < sheet.rows.length) headerChoices.push(plan.headerRow);

  const set = (patch: Partial<SheetPlan>) => onChange({ ...plan, ...patch });
  const setColumn = (c: PlanColumn, v: string) => set({ columns: { ...plan.columns, [c]: v === "" ? null : Number(v) } });

  const addWord = () => {
    const w = word.trim().slice(0, 60);
    if (!w) return;
    if (!plan.skipContains.some((x) => x.toLowerCase() === w.toLowerCase())) {
      set({ skipContains: [...plan.skipContains, w].slice(0, SKIP_WORDS_MAX) });
    }
    setWord("");
  };

  return (
    <div className="card">
      <h3>Column mapping</h3>
      <p className="rv-muted">
        Change anything and the rows below are rebuilt from the sheet straight away — no new AI call. Use Debit and Credit
        when the sheet has two money columns, or the one signed amount column when it has one.
      </p>
      <p className="rv-muted" style={{ marginTop: 6, color: "var(--ink)" }}>{mappingSummary(plan, sheets)}</p>

      <div className="rv-map" style={{ marginTop: 10 }}>
        <div>
          <label htmlFor="rv-sheet">Sheet</label>
          <select
            id="rv-sheet"
            className="rv-in"
            value={plan.sheet}
            disabled={disabled}
            onChange={(e) => {
              const next = sheets.find((s) => s.name === e.target.value);
              set({ sheet: e.target.value, headerRow: next ? Math.min(plan.headerRow, Math.max(0, next.rows.length - 1)) : 0 });
            }}
          >
            {sheets.map((s) => (
              <option key={s.name} value={s.name}>{`${s.name} (${s.rows.length.toLocaleString("en-IN")} rows)`}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rv-header">Header row</label>
          <select
            id="rv-header"
            className="rv-in"
            value={plan.headerRow}
            disabled={disabled}
            onChange={(e) => set({ headerRow: Number(e.target.value) })}
          >
            {headerChoices.map((i) => (
              <option key={i} value={i}>
                {`Row ${i + 1} — ${clip(sheet.rows[i].filter(Boolean).join(" | ") || "(empty)", 60)}`}
              </option>
            ))}
          </select>
        </div>
        {PLAN_COLUMNS.map((c) => (
          <div key={c}>
            <label htmlFor={`rv-col-${c}`}>{FIELD_LABEL[c]}</label>
            <select
              id={`rv-col-${c}`}
              className="rv-in"
              value={plan.columns[c] ?? ""}
              disabled={disabled}
              onChange={(e) => setColumn(c, e.target.value)}
            >
              <option value="">— none —</option>
              {Array.from({ length: Math.max(width, (plan.columns[c] ?? -1) + 1) }, (_, j) => (
                <option key={j} value={j}>{`column ${j + 1} — ${clip((header[j] ?? "").trim() || "(blank header)", 40)}`}</option>
              ))}
            </select>
          </div>
        ))}
        {plan.columns.amount !== null && (
          <div>
            <label htmlFor="rv-sign">Amount sign</label>
            <select
              id="rv-sign"
              className="rv-in"
              value={plan.amountSign}
              disabled={disabled}
              onChange={(e) => set({ amountSign: e.target.value as SheetPlan["amountSign"] })}
            >
              <option value="positive_is_debit">A positive amount is a debit — BCH owes more</option>
              <option value="positive_is_credit">A positive amount is a credit — BCH owes less</option>
            </select>
          </div>
        )}
        <div>
          <label htmlFor="rv-from">Only rows from (optional)</label>
          <input id="rv-from" type="date" className="rv-in" value={plan.dateFrom ?? ""} disabled={disabled} onChange={(e) => set({ dateFrom: e.target.value || null })} />
        </div>
        <div>
          <label htmlFor="rv-to">Only rows to (optional)</label>
          <input id="rv-to" type="date" className="rv-in" value={plan.dateTo ?? ""} disabled={disabled} onChange={(e) => set({ dateTo: e.target.value || null })} />
        </div>
      </div>

      <label className="rv-tick" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={plan.dayFirst} disabled={disabled} onChange={(e) => set({ dayFirst: e.target.checked })} />
        Dates are day first — 05/04/2025 is 5 April
      </label>

      <div className="rv-lbl">Skip rows containing</div>
      <div className="rv-chips">
        {plan.skipContains.length === 0 && <span className="rv-muted">Nothing is skipped by word.</span>}
        {plan.skipContains.map((w) => (
          <span key={w} className="rv-chip">
            {w}
            <button
              type="button"
              aria-label={`Stop skipping rows containing ${w}`}
              disabled={disabled}
              onClick={() => set({ skipContains: plan.skipContains.filter((x) => x !== w) })}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {plan.skipContains.length < SKIP_WORDS_MAX && (
        <div className="rv-row" style={{ marginTop: 6 }}>
          <input
            className="rv-in grow"
            style={{ width: "auto" }}
            value={word}
            maxLength={60}
            placeholder="e.g. total, carried forward"
            disabled={disabled}
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addWord();
              }
            }}
          />
          <button type="button" className="iconbtn rv-btn" disabled={disabled || !word.trim()} onClick={addWord}>
            Add
          </button>
        </div>
      )}

      {problem && <p className="rv-err">{problem}</p>}

      <div className="rv-row" style={{ marginTop: 10 }}>
        <button type="button" className="iconbtn rv-btn" disabled={disabled || isAiPlan} onClick={onReset}>
          Reset to the AI&apos;s plan
        </button>
        {!isAiPlan && <span className="rv-muted">You have changed the AI&apos;s mapping.</span>}
      </div>
    </div>
  );
}
