"use client";

// The opening-to-closing check over the TICKED rows (plan 1310 Part C, accounting consultant:
// "balance check before approve"). Approve waits for it to tie — or for the person to accept
// the exact difference shown, which the accept route records on the statement.
import { fmtMoney } from "./review-types";

export interface TieCheck {
  computedClosing: number;
  difference: number | null;
  tiesOut: boolean;
}

/**
 * "" → 0 for the opening; anything unreadable → NaN, which the page refuses to send. Not
 * rounded: an untouched figure must reach the server exactly as it was read, or the statement
 * would record an edit nobody made.
 */
export function parseMoney(text: string): number {
  const t = text.replace(/[,₹\s]/g, "");
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export function BalanceCheck({
  opening,
  claimed,
  check,
  ticked,
  unticked,
  acceptDiff,
  readOnly,
  onOpening,
  onClaimed,
  onAcceptDiff,
}: {
  opening: string;
  claimed: string;
  check: TieCheck;
  ticked: number;
  /** The rows left out: how many, and their signed total (+ raises what BCH owes). */
  unticked: { count: number; signed: number };
  acceptDiff: boolean;
  readOnly: boolean;
  onOpening: (v: string) => void;
  onClaimed: (v: string) => void;
  onAcceptDiff: (v: boolean) => void;
}) {
  const openingBad = Number.isNaN(parseMoney(opening));
  const claimedBad = claimed.trim() !== "" && Number.isNaN(parseMoney(claimed));
  const diff = check.difference;

  return (
    <div className="card">
      <h3>Balance check</h3>
      <p className="rv-muted">
        The opening plus the {ticked.toLocaleString("en-IN")} ticked rows should come to the closing balance the statement shows.
        Correct a mis-read opening or closing here.
      </p>

      <div className="rv-grid" style={{ marginTop: 8 }}>
        <div>
          <label className="rv-lbl" htmlFor="rv-opening" style={{ display: "block", marginTop: 0 }}>Opening balance (₹)</label>
          <input
            id="rv-opening"
            className={"rv-in" + (openingBad ? " bad" : "")}
            inputMode="decimal"
            value={opening}
            disabled={readOnly}
            onChange={(e) => onOpening(e.target.value)}
          />
        </div>
        <div>
          <label className="rv-lbl" htmlFor="rv-closing" style={{ display: "block", marginTop: 0 }}>Closing the statement shows (₹)</label>
          <input
            id="rv-closing"
            className={"rv-in" + (claimedBad ? " bad" : "")}
            inputMode="decimal"
            placeholder="as printed"
            value={claimed}
            disabled={readOnly}
            onChange={(e) => onClaimed(e.target.value)}
          />
        </div>
      </div>
      {(openingBad || claimedBad) && <p className="rv-err">Type the balance as a number, e.g. 125000 or -4500.50.</p>}

      <div style={{ marginTop: 10 }}>
        {claimed.trim() === "" ? (
          <div className="rv-warn" style={{ marginTop: 0 }}>
            Rows add up to {fmtMoney(check.computedClosing)}. Enter the closing balance the statement shows — nothing can be
            approved without it.
          </div>
        ) : check.tiesOut ? (
          <div className="rv-ok">✓ Ties out — rows add up to {fmtMoney(check.computedClosing)}, as the statement says</div>
        ) : (
          <div className="rv-bad">
            Rows add up to {fmtMoney(check.computedClosing)}, the statement says {fmtMoney(parseMoney(claimed))} — difference{" "}
            {fmtMoney(Math.abs(diff ?? 0))}
          </div>
        )}
      </div>

      {/* Leaving out rows already on the ledger moves the check by exactly their total — say so,
          rather than let a correct statement look wrong. */}
      {!check.tiesOut && diff !== null && unticked.count > 0 && Math.abs(diff - unticked.signed) <= 1 && (
        <p className="rv-muted" style={{ marginTop: 8, color: "var(--ink)" }}>
          With every row ticked it ties out — the difference is the {unticked.count.toLocaleString("en-IN")} unticked{" "}
          {unticked.count === 1 ? "row" : "rows"} ({fmtMoney(Math.abs(unticked.signed))}). To add only the ticked rows, accept
          the difference below.
        </p>
      )}

      {!readOnly && !check.tiesOut && diff !== null && !claimedBad && (
        <label className="rv-tick" style={{ marginTop: 6, alignItems: "flex-start", paddingTop: 10 }}>
          <input type="checkbox" checked={acceptDiff} onChange={(e) => onAcceptDiff(e.target.checked)} />
          <span>Accept with a difference of {fmtMoney(Math.abs(diff))} — it is recorded on the statement</span>
        </label>
      )}
    </div>
  );
}
