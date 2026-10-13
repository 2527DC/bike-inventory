"use client";

// One statement row, editable — as a card on a phone and as a table row from `lg`. Both are
// memoised and take a stable `onPatch`, so typing in one row of an 800-row statement does not
// re-render the other 799.
import { memo } from "react";
import type { LedgerEntryType } from "@prisma/client";
import { ROW_TYPES, TYPE_LABEL, fmtMoney, isIsoDay, parseRowAmount, type EditRow } from "./review-types";

export type PatchRow = (key: number, patch: Partial<EditRow>) => void;

interface RowProps {
  row: EditRow;
  /** 1-based position in the whole list, shown when the row has no sheet row number. */
  n: number;
  dup: boolean;
  aiTyped: boolean;
  readOnly: boolean;
  onPatch: PatchRow;
}

function DrCr({ row, readOnly, onPatch }: Pick<RowProps, "row" | "readOnly" | "onPatch">) {
  return (
    <span className="rv-seg" role="group" aria-label="Debit or credit">
      <button
        type="button"
        className={row.direction === 1 ? "dr" : ""}
        aria-pressed={row.direction === 1}
        title="Debit — BCH owes more"
        disabled={readOnly}
        onClick={() => onPatch(row.key, { direction: 1 })}
      >
        Dr
      </button>
      <button
        type="button"
        className={row.direction === -1 ? "cr" : ""}
        aria-pressed={row.direction === -1}
        title="Credit — BCH owes less"
        disabled={readOnly}
        onClick={() => onPatch(row.key, { direction: -1 })}
      >
        Cr
      </button>
    </span>
  );
}

function TypeSelect({ row, readOnly, onPatch }: Pick<RowProps, "row" | "readOnly" | "onPatch">) {
  const options = ROW_TYPES.includes(row.type) ? ROW_TYPES : [row.type, ...ROW_TYPES];
  return (
    <select
      className="rv-in"
      aria-label="Entry type"
      value={row.type}
      disabled={readOnly}
      onChange={(e) => onPatch(row.key, { type: e.target.value as LedgerEntryType })}
    >
      {options.map((t) => (
        <option key={t} value={t}>{TYPE_LABEL[t]}</option>
      ))}
    </select>
  );
}

function Tick({ row, readOnly, onPatch, label }: Pick<RowProps, "row" | "readOnly" | "onPatch"> & { label?: string }) {
  return (
    <label className="rv-tick">
      <input
        type="checkbox"
        checked={row.ticked}
        disabled={readOnly}
        aria-label={label ? undefined : "Include this row"}
        onChange={(e) => onPatch(row.key, { ticked: e.target.checked })}
      />
      {label}
    </label>
  );
}

function Flags({ dup, aiTyped }: Pick<RowProps, "dup" | "aiTyped">) {
  return (
    <>
      {dup && <span className="chip amber">Already on the ledger</span>}
      {aiTyped && <span className="chip amber">AI-typed — check</span>}
    </>
  );
}

/** The row's note travels to the ledger as it was read; shown, not edited. */
function Note({ text }: { text: string }) {
  return <div className="rv-muted" style={{ marginTop: 4, wordBreak: "break-word" }}>Note: {text}</div>;
}

function fieldState(row: EditRow) {
  const amount = parseRowAmount(row.amount);
  return {
    amount,
    dateBad: row.ticked && !isIsoDay(row.date),
    amountBad: row.ticked && (amount === null || amount <= 0),
  };
}

export const RowCard = memo(function RowCard({ row, n, dup, aiTyped, readOnly, onPatch }: RowProps) {
  const { amount, dateBad, amountBad } = fieldState(row);
  return (
    <div className={"rv-card" + (row.ticked ? "" : " off")}>
      <div className="rv-cardtop">
        <Tick row={row} readOnly={readOnly} onPatch={onPatch} label={row.sourceRow ? `Row ${row.sourceRow}` : `Line ${n}`} />
        <Flags dup={dup} aiTyped={aiTyped} />
        <span className="rv-amt" style={{ color: row.direction === 1 ? "var(--red)" : "var(--green)" }}>
          {fmtMoney(amount)} {row.direction === 1 ? "Dr" : "Cr"}
        </span>
      </div>
      <div className="rv-grid" style={{ marginTop: 6 }}>
        <input
          type="date"
          className={"rv-in" + (dateBad ? " bad" : "")}
          aria-label="Date"
          value={row.date}
          disabled={readOnly}
          onChange={(e) => onPatch(row.key, { date: e.target.value })}
        />
        <DrCr row={row} readOnly={readOnly} onPatch={onPatch} />
        <input
          className="rv-in full"
          aria-label="Particulars"
          placeholder="Particulars"
          value={row.label}
          maxLength={300}
          disabled={readOnly}
          onChange={(e) => onPatch(row.key, { label: e.target.value })}
        />
        <input
          className="rv-in"
          aria-label="Reference"
          placeholder="Ref / invoice no."
          value={row.ref}
          maxLength={120}
          disabled={readOnly}
          onChange={(e) => onPatch(row.key, { ref: e.target.value })}
        />
        <input
          className={"rv-in" + (amountBad ? " bad" : "")}
          aria-label="Amount"
          inputMode="decimal"
          placeholder="Amount"
          value={row.amount}
          disabled={readOnly}
          onChange={(e) => onPatch(row.key, { amount: e.target.value })}
        />
        <div className="full">
          <TypeSelect row={row} readOnly={readOnly} onPatch={onPatch} />
        </div>
      </div>
      {row.note && <Note text={row.note} />}
      {row.warning && <div className="rv-rowwarn">⚠ {row.warning}</div>}
    </div>
  );
});

export const RowTr = memo(function RowTr({ row, n, dup, aiTyped, readOnly, onPatch }: RowProps) {
  const { dateBad, amountBad } = fieldState(row);
  return (
    <tr className={row.ticked ? "" : "off"}>
      <td style={{ width: 44 }}>
        <Tick row={row} readOnly={readOnly} onPatch={onPatch} />
      </td>
      <td className="rowno">{row.sourceRow ?? n}</td>
      <td style={{ width: 150 }}>
        <input
          type="date"
          className={"rv-in" + (dateBad ? " bad" : "")}
          aria-label="Date"
          value={row.date}
          disabled={readOnly}
          onChange={(e) => onPatch(row.key, { date: e.target.value })}
        />
      </td>
      <td>
        <input
          className="rv-in"
          aria-label="Particulars"
          value={row.label}
          maxLength={300}
          disabled={readOnly}
          onChange={(e) => onPatch(row.key, { label: e.target.value })}
        />
        {(dup || aiTyped) && (
          <div className="rv-meta" style={{ marginTop: 4 }}>
            <Flags dup={dup} aiTyped={aiTyped} />
          </div>
        )}
        {row.note && <Note text={row.note} />}
        {row.warning && <div className="rv-rowwarn">⚠ {row.warning}</div>}
      </td>
      <td style={{ width: 150 }}>
        <input
          className="rv-in"
          aria-label="Reference"
          value={row.ref}
          maxLength={120}
          disabled={readOnly}
          onChange={(e) => onPatch(row.key, { ref: e.target.value })}
        />
      </td>
      <td style={{ width: 140 }}>
        <TypeSelect row={row} readOnly={readOnly} onPatch={onPatch} />
      </td>
      <td style={{ width: 96 }}>
        <DrCr row={row} readOnly={readOnly} onPatch={onPatch} />
      </td>
      <td style={{ width: 130 }}>
        <input
          className={"rv-in num" + (amountBad ? " bad" : "")}
          style={{ textAlign: "right" }}
          aria-label="Amount"
          inputMode="decimal"
          value={row.amount}
          disabled={readOnly}
          onChange={(e) => onPatch(row.key, { amount: e.target.value })}
        />
      </td>
    </tr>
  );
});
