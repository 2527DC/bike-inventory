"use client";

// Approve and Discard, kept in reach at the foot of the screen while a long review scrolls.
// Approve says exactly what it will add; when it cannot, the bar says why instead. A refusal
// from the server is shown as the server wrote it.
import { useState } from "react";
import { discardRun } from "./review-api";

export type BarBusy = "approve" | "discard" | null;
export type BarError = { text: string; status?: number } | null;

export const DISCARD_CONFIRM = "Discard this run? Nothing it proposed will reach the ledger.";

/** The bar's shared state, and Discard — the same for statement rows and claims. */
export function useBarState(runId: string, onDiscarded: () => void) {
  const [busy, setBusy] = useState<BarBusy>(null);
  const [error, setError] = useState<BarError>(null);
  const discard = async () => {
    if (!confirm(DISCARD_CONFIRM)) return;
    setBusy("discard");
    setError(null);
    const r = await discardRun(runId);
    if ("error" in r) {
      setBusy(null);
      setError({ text: r.error, status: r.status });
      return;
    }
    onDiscarded();
  };
  return { busy, setBusy, error, setError, discard };
}

export function ApproveBar({
  label,
  status,
  blocked,
  busy,
  error,
  onApprove,
  onDiscard,
  onReload,
}: {
  /** "Add 38 rows to the ledger" — what Approve will do. */
  label: string;
  /** One line of where things stand, e.g. "38 ticked · ties out". */
  status: string;
  /** Why Approve is not possible yet, or null. */
  blocked: string | null;
  busy: BarBusy;
  error: BarError;
  onApprove: () => void;
  onDiscard: () => void;
  onReload: () => void;
}) {
  return (
    <div className="rv-bar" role="region" aria-label="Approve or discard">
      <p className="rv-muted" style={{ color: "var(--ink)", fontWeight: 600 }}>{status}</p>
      {blocked && <p className="rv-err" style={{ marginTop: 2 }}>{blocked}</p>}
      {error && (
        <div className="rv-bad" style={{ marginTop: 6 }}>
          {error.text}
          {error.status === 409 && (
            <button type="button" className="iconbtn rv-btn" style={{ marginLeft: 8 }} onClick={onReload}>
              Reload this run
            </button>
          )}
        </div>
      )}
      <div className="rv-row" style={{ marginTop: 8 }}>
        <button type="button" className="iconbtn danger rv-btn" disabled={busy !== null} onClick={onDiscard}>
          {busy === "discard" ? "Discarding…" : "Discard"}
        </button>
        <button type="button" className="iconbtn primary rv-btn" disabled={busy !== null || !!blocked} onClick={onApprove}>
          {busy === "approve" ? "Adding…" : label}
        </button>
      </div>
    </div>
  );
}
