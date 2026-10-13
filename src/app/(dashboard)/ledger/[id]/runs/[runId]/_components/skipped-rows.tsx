"use client";

// Every line the read dropped, with its reason (plan 1310 Part C) — so a silent loss is
// impossible. Older runs kept only a count; then the count is all there is to show.
import type { SkippedRow } from "@/lib/brand-ledger/prompted-import";

const LIST_MAX = 500;

export function SkippedRows({ rows, count }: { rows: SkippedRow[] | undefined; count: number }) {
  if (!rows && count === 0) return null;
  if (!rows) {
    return (
      <div className="card">
        <p className="rv-muted" style={{ color: "var(--ink)" }}>
          {count.toLocaleString("en-IN")} {count === 1 ? "line was" : "lines were"} skipped for having no readable date or amount.
        </p>
      </div>
    );
  }
  if (rows.length === 0) return null;

  return (
    <div className="card">
      <details className="rv-details">
        <summary>
          {rows.length.toLocaleString("en-IN")} {rows.length === 1 ? "line" : "lines"} skipped — tap to see why
        </summary>
        {rows.slice(0, LIST_MAX).map((r, i) => (
          <div key={i} className="rv-skip">
            <div>
              <b>{r.row !== null ? `Row ${r.row}` : `Line ${i + 1}`}</b>
              {r.sheet ? <span className="rv-muted"> · {r.sheet}</span> : null} — <span className="why">{r.reason}</span>
            </div>
            {r.text && <div className="txt">{r.text}</div>}
          </div>
        ))}
        {rows.length > LIST_MAX && (
          <p className="rv-muted" style={{ marginTop: 6 }}>
            …and {(rows.length - LIST_MAX).toLocaleString("en-IN")} more. Narrow the mapping (header row, dates, skip words) to see fewer.
          </p>
        )}
      </details>
    </div>
  );
}
