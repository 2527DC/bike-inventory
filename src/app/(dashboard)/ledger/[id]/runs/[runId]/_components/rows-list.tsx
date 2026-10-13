"use client";

// The proposed rows: counts, filters to find what needs a look (warnings, duplicates, rows that
// need fixing), bulk tick, and the rows themselves — cards on a phone, a table from `lg`.
// Rendered a page at a time so an 800-row statement stays responsive.
import { useMemo, useState } from "react";
import { RowCard, RowTr, type PatchRow } from "./row-editors";
import { plural, rowProblem, type EditRow } from "./review-types";
import { useWide } from "./use-wide";

const PAGE = 100;

type Filter = "all" | "warnings" | "dups" | "problems" | "unticked";

export function RowsList({
  rows,
  dups,
  aiTyped,
  readOnly,
  onPatch,
  onTickMany,
}: {
  rows: EditRow[];
  /** Aligned with `rows`: true when the row is already on the ledger. */
  dups: boolean[];
  aiTyped: boolean;
  readOnly: boolean;
  onPatch: PatchRow;
  onTickMany: (keys: Set<number>, ticked: boolean) => void;
}) {
  const wide = useWide();
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);

  const counts = useMemo(() => {
    let ticked = 0;
    let warnings = 0;
    let duplicates = 0;
    let problems = 0;
    rows.forEach((r, i) => {
      if (r.ticked) ticked++;
      if (r.warning) warnings++;
      if (dups[i]) duplicates++;
      if (r.ticked && rowProblem(r)) problems++;
    });
    return { ticked, warnings, duplicates, problems, unticked: rows.length - ticked };
  }, [rows, dups]);

  // A filter holds the rows that matched when it was picked, so fixing a row under "Need
  // fixing" does not whisk it away mid-keystroke. Each row keeps its 1-based position.
  const [frozen, setFrozen] = useState<Set<number> | null>(null);
  const matches = (f: Filter, row: EditRow, i: number): boolean => {
    if (f === "warnings") return !!row.warning;
    if (f === "dups") return dups[i];
    if (f === "problems") return row.ticked && !!rowProblem(row);
    if (f === "unticked") return !row.ticked;
    return true;
  };
  const visible = useMemo(() => {
    const all = rows.map((row, i) => ({ row, i }));
    return frozen ? all.filter(({ row }) => frozen.has(row.key)) : all;
  }, [rows, frozen]);

  const page = visible.slice(0, shown);
  const pick = (f: Filter) => {
    setFilter(f);
    setShown(PAGE);
    setFrozen(f === "all" ? null : new Set(rows.filter((r, i) => matches(f, r, i)).map((r) => r.key)));
  };
  const chip = (f: Filter, label: string, n: number) =>
    (f === "all" || n > 0 || filter === f) && (
      <button type="button" className={filter === f ? "on" : ""} style={{ minHeight: 44 }} onClick={() => pick(f)}>
        {label} ({n.toLocaleString("en-IN")})
      </button>
    );

  if (rows.length === 0) {
    return (
      <div className="card">
        <h3>Rows</h3>
        <div className="empty">No rows came out of this. Check the column mapping, or the skipped rows below.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Rows</h3>
      <p className="rv-muted">
        {plural(rows.length, "row")} · {counts.ticked.toLocaleString("en-IN")} ticked
        {counts.warnings > 0 && ` · ${plural(counts.warnings, "warning")}`}
        {counts.duplicates > 0 && ` · ${counts.duplicates.toLocaleString("en-IN")} already on the ledger`}
      </p>
      <p className="rv-muted" style={{ marginTop: 2 }}>Dr raises what BCH owes the vendor; Cr lowers it. Only ticked rows are added.</p>
      {counts.problems > 0 && (
        <p className="rv-err">{plural(counts.problems, "ticked row needs", "ticked rows need")} fixing — a real date and an amount above 0.</p>
      )}

      <div className="filters" style={{ marginTop: 10 }}>
        {chip("all", "All", rows.length)}
        {chip("warnings", "Warnings", counts.warnings)}
        {chip("dups", "Already on the ledger", counts.duplicates)}
        {chip("problems", "Need fixing", counts.problems)}
        {chip("unticked", "Unticked", counts.unticked)}
      </div>

      {!readOnly && visible.length > 0 && (
        <div className="rv-row">
          <button
            type="button"
            className="iconbtn rv-btn"
            onClick={() => onTickMany(new Set(visible.map(({ row }) => row.key)), true)}
          >
            Tick {filter === "all" ? "all" : "these"} {visible.length.toLocaleString("en-IN")}
          </button>
          <button
            type="button"
            className="iconbtn rv-btn"
            onClick={() => onTickMany(new Set(visible.map(({ row }) => row.key)), false)}
          >
            Untick {filter === "all" ? "all" : "these"} {visible.length.toLocaleString("en-IN")}
          </button>
        </div>
      )}

      {visible.length === 0 && <div className="empty">Nothing here.</div>}

      {wide && page.length > 0 && (
        <div className="tablewrap" style={{ marginTop: 8 }}>
          <table className="rv-table">
            <thead>
              <tr>
                <th aria-label="Include" />
                <th>Row</th>
                <th>Date</th>
                <th>Particulars</th>
                <th>Ref</th>
                <th>Type</th>
                <th>Dr / Cr</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {page.map(({ row, i }) => (
                <RowTr key={row.key} row={row} n={i + 1} dup={dups[i]} aiTyped={aiTyped} readOnly={readOnly} onPatch={onPatch} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!wide &&
        page.map(({ row, i }) => (
          <RowCard key={row.key} row={row} n={i + 1} dup={dups[i]} aiTyped={aiTyped} readOnly={readOnly} onPatch={onPatch} />
        ))}

      {visible.length > shown && (
        <button type="button" className="iconbtn rv-btn" style={{ width: "100%", marginTop: 10 }} onClick={() => setShown(shown + PAGE)}>
          Show {Math.min(PAGE, visible.length - shown)} more ({(visible.length - shown).toLocaleString("en-IN")} not shown)
        </button>
      )}
    </div>
  );
}
