"use client";

// The review of one AI run — plan 0909-vendor-ledger-screens-and-ai-import, §3 Part E.4.
//
// A statement run shows its rows under the tie-out line: the rows' sum against the closing the
// statement claims. Accept stays disabled until they tie; the claimed closing is editable here
// because a mis-read closing is the most common reason they do not. A claims run shows each
// candidate with the message that proves it; unticked ones are not accepted.
import { useEffect, useMemo, useState } from "react";
import { apiTry } from "@/lib/api-client";
import type { LedgerViewGapType } from "@/lib/brand-ledger/view-types";

interface StatementRow {
  date: string;
  label: string;
  ref: string;
  note: string;
  amount: number;
  direction: 1 | -1;
  type: string;
  side: "VENDOR" | "BCH";
}

interface StatementProposals {
  kind: "statement";
  statementDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  opening: number;
  claimedClosing: number | null;
  computedClosing: number;
  difference: number | null;
  tiesOut: boolean;
  rows: StatementRow[];
  skipped: number;
  source: "ai" | "sheet";
}

interface Claim {
  title: string;
  type: LedgerViewGapType;
  amount: number | null;
  amountNote: string;
  promisedBy: string;
  promisedOn: string | null;
  quote: string;
  line: number | null;
}

interface ClaimsProposals {
  kind: "claims";
  claims: Claim[];
}

interface Run {
  id: string;
  task: "STATEMENT_ROWS" | "CLAIMS_FROM_CHAT" | "CLAIMS_FROM_IMAGE";
  status: "RUNNING" | "DONE" | "FAILED" | "ACCEPTED" | "DISCARDED";
  provider: string | null;
  model: string | null;
  usageIn: number | null;
  usageOut: number | null;
  latencyMs: number | null;
  chunks: number;
  proposals: StatementProposals | ClaimsProposals | null;
  error: string | null;
  acceptedAt: string | null;
  upload: { id: string; fileName: string; kind: string };
}

const TIE_TOLERANCE = 1;

function fmtINR(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

export function ReviewCard({ runId, onClose, reload }: { runId: string; onClose: () => void; reload: () => void }) {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState<string>("");
  const [opening, setOpening] = useState<string>("");
  const [ticked, setTicked] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await apiTry<Run>(`/api/ledger/runs/${runId}`);
      if (cancelled) return;
      if (err || !data) {
        setError(err || "Could not load the run");
        return;
      }
      setRun(data);
      if (data.proposals?.kind === "statement") {
        setClaimed(data.proposals.claimedClosing === null ? "" : String(data.proposals.claimedClosing));
        setOpening(String(data.proposals.opening));
      } else if (data.proposals?.kind === "claims") {
        setTicked(new Set(data.proposals.claims.map((_, i) => i)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  // The tie-out, recomputed live as the person edits the opening or the claimed closing.
  const check = useMemo(() => {
    if (run?.proposals?.kind !== "statement") return null;
    const rows = run.proposals.rows;
    const open = opening === "" ? 0 : Number(opening);
    const computed = Math.round(rows.reduce((s, r) => s + r.direction * r.amount, open) * 100) / 100;
    const claim = claimed === "" ? null : Number(claimed);
    const difference = claim === null || isNaN(claim) ? null : Math.round((claim - computed) * 100) / 100;
    return { computed, claim, difference, tiesOut: difference !== null && Math.abs(difference) <= TIE_TOLERANCE };
  }, [run, opening, claimed]);

  const readOnly = run?.status !== "DONE";

  const accept = async () => {
    if (!run || !run.proposals) return;
    setBusy(true);
    const body =
      run.proposals.kind === "statement"
        ? { claimedClosing: claimed === "" ? null : Number(claimed), opening: opening === "" ? 0 : Number(opening) }
        : { claims: run.proposals.claims.filter((_, i) => ticked.has(i)) };
    const { error: err, status } = await apiTry(`/api/ledger/runs/${runId}/accept`, { method: "POST", json: body });
    setBusy(false);
    if (err) {
      alert(`Not accepted${status ? ` (${status})` : ""}: ${err}`);
      return;
    }
    alert("Accepted ✓");
    reload();
    onClose();
  };

  const discard = async () => {
    if (!confirm("Discard this run? Nothing it proposed will reach the ledger.")) return;
    setBusy(true);
    const { error: err } = await apiTry(`/api/ledger/runs/${runId}/discard`, { method: "POST" });
    setBusy(false);
    if (err) {
      alert("Discard failed: " + err);
      return;
    }
    reload();
    onClose();
  };

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <h3 style={{ flex: 1 }}>
          {run ? `Review · ${run.upload.fileName}` : "Review"}
          {run?.status === "ACCEPTED" && <span className="chip green" style={{ marginLeft: 8 }}>accepted</span>}
        </h3>
        <button className="iconbtn" onClick={onClose}>Close</button>
      </div>
      {run && (
        <p className="smallmuted">
          {run.model ? `${run.provider} · ${run.model}` : "read in code, no AI"}
          {run.usageIn != null && run.model ? ` · ${run.usageIn.toLocaleString("en-IN")} in / ${(run.usageOut ?? 0).toLocaleString("en-IN")} out tokens` : ""}
          {run.chunks > 1 ? ` · ${run.chunks} parts` : ""}
        </p>
      )}
      {error && <p className="smallmuted" style={{ color: "var(--red)" }}>{error}</p>}
      {!run && !error && <div className="empty">Loading…</div>}
      {run?.status === "FAILED" && <div className="alert">Run failed: {run.error}</div>}

      {run?.proposals?.kind === "statement" && check && (
        <>
          <div className="matchbar" style={{ marginTop: 10 }}>
            <div className="mrow">
              <div className="b">
                <div className="v">{fmtINR(check.computed)}</div>
                <div className="l">Rows add up to ({run.proposals.rows.length} rows{run.proposals.skipped ? `, ${run.proposals.skipped} skipped` : ""})</div>
              </div>
              <div className="b" style={{ textAlign: "right" }}>
                <div className="v" style={{ color: check.tiesOut ? "var(--green)" : "var(--red)" }}>
                  {check.claim === null ? "closing unknown" : check.tiesOut ? "✓ TIES OUT" : `${check.difference! > 0 ? "+" : "−"}${fmtINR(Math.abs(check.difference!))}`}
                </div>
                <div className="l">vs the closing the statement claims</div>
              </div>
            </div>
            {!check.tiesOut && (
              <div className="covnote" style={{ color: "var(--red)" }}>
                The rows do not sum to the stated closing. Correct the opening or closing below, or discard the run and
                re-upload a clearer statement — nothing is accepted until it ties.
              </div>
            )}
          </div>

          <div className="form" style={{ marginTop: 8 }}>
            <div className="row">
              <div>
                <label>Opening balance (₹)</label>
                <input type="number" value={opening} disabled={readOnly} onChange={(e) => setOpening(e.target.value)} />
              </div>
              <div>
                <label>Closing the statement claims (₹)</label>
                <input type="number" value={claimed} disabled={readOnly} onChange={(e) => setClaimed(e.target.value)} placeholder="as printed" />
              </div>
            </div>
          </div>

          <div className="tablewrap" style={{ marginTop: 8 }}>
            <table className="ltable">
              <thead>
                <tr><th>Date</th><th>Ref / label</th><th>Type</th><th>Debit</th><th>Credit</th></tr>
              </thead>
              <tbody>
                {run.proposals.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="td-date">{r.date}</td>
                    <td className="td-ref">
                      {r.ref || <span className="td-plain">{r.label}</span>}
                      {r.ref && <div className="td-sub2">{[r.label, r.note].filter(Boolean).join(" · ")}</div>}
                    </td>
                    <td><span className={"chip " + (r.direction > 0 ? "red" : "green")}>{r.type.toLowerCase().replace(/_/g, "-")}</span></td>
                    <td className="num red">{r.direction > 0 ? fmtINR(r.amount) : ""}</td>
                    <td className="num green">{r.direction < 0 ? fmtINR(r.amount) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {run?.proposals?.kind === "claims" && (
        <div className="list" style={{ marginTop: 10 }}>
          {run.proposals.claims.length === 0 && <div className="empty">The AI found no promises in this file</div>}
          {run.proposals.claims.map((c, i) => (
            <div key={i} className="gap">
              <div className="top" style={{ cursor: "default" }}>
                {!readOnly && (
                  <input
                    type="checkbox"
                    checked={ticked.has(i)}
                    onChange={(e) => {
                      const next = new Set(ticked);
                      if (e.target.checked) next.add(i);
                      else next.delete(i);
                      setTicked(next);
                    }}
                  />
                )}
                <span className="title">{c.title}</span>
                <span className="amt">{c.amountNote || (c.amount !== null ? fmtINR(c.amount) : "TBD")}</span>
              </div>
              <div className="meta">
                <span className="chip">{c.type}</span>
                {c.promisedBy && <span className="chip">by {c.promisedBy}</span>}
                {c.promisedOn && <span className="chip">{c.promisedOn}</span>}
                {c.line && <span className="chip blue">L{c.line}</span>}
              </div>
              {c.quote && (
                <div className="detail">
                  <div className="lbl">Quoted message</div>
                  <div className="evblocks"><div className="evline"><span className="ev-q">&quot;{c.quote}&quot;</span></div></div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {run?.status === "DONE" && (
        <div className="formactions" style={{ marginTop: 10 }}>
          <button className="iconbtn danger" disabled={busy} onClick={discard}>Discard</button>
          <button
            className="iconbtn primary"
            disabled={
              busy ||
              (run.proposals?.kind === "statement" && !check?.tiesOut) ||
              (run.proposals?.kind === "claims" && ticked.size === 0)
            }
            onClick={accept}
          >
            {busy ? "Saving…" : run.proposals?.kind === "statement" ? "Accept into the ledger" : `Accept ${ticked.size} claim${ticked.size === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
    </div>
  );
}
