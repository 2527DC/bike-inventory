"use client";

// A claims run under review: each promise the AI found, editable, with the message that proves
// it. Ticked claims become VERIFY gaps on approve — a person still confirms each before it is
// pressed with the vendor (the accept route's rule).
import { memo, useCallback, useState } from "react";
import type { ClaimsProposals } from "@/lib/brand-ledger/ai-run";
import type { ClaimProposal } from "@/lib/brand-ledger/ai-prompts";
import { LEDGER_VIEW_GAP_TYPES, type LedgerViewGapType } from "@/lib/brand-ledger/view-types";
import { ApproveBar, useBarState } from "./approve-bar";
import { acceptRun } from "./review-api";
import { fmtMoney, isIsoDay, plural, toEditClaims, type EditClaim, type ReviewRun } from "./review-types";

const gapTypeLabel = (t: LedgerViewGapType) => t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, " ");

/** null when blank; NaN when unreadable (Approve is then blocked, so NaN is never sent). */
function claimAmount(c: EditClaim): number | null {
  const t = c.amountText.replace(/[,₹\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function claimProblem(c: EditClaim): string | null {
  if (!c.title.trim()) return "it needs a title";
  if (c.title.trim().length > 300) return "the title is over 300 characters";
  const a = claimAmount(c);
  if (a !== null && Number.isNaN(a)) return "the amount is not a number";
  if (c.promisedOn && !isIsoDay(c.promisedOn)) return "the promised date is not a real date";
  return null;
}

function toClaim(c: EditClaim): ClaimProposal {
  return {
    title: c.title.trim(),
    type: c.type,
    amount: claimAmount(c),
    amountNote: c.amountNote.trim(),
    promisedBy: c.promisedBy.trim(),
    promisedOn: c.promisedOn || null,
    quote: c.quote.slice(0, 2000),
    line: c.line,
  };
}

type PatchClaim = (key: number, patch: Partial<EditClaim>) => void;

const ClaimCard = memo(function ClaimCard({ c, n, readOnly, onPatch }: { c: EditClaim; n: number; readOnly: boolean; onPatch: PatchClaim }) {
  const problem = c.ticked ? claimProblem(c) : null;
  const amount = claimAmount(c);
  return (
    <div className={"rv-card" + (c.ticked ? "" : " off")}>
      <div className="rv-cardtop">
        <label className="rv-tick">
          <input type="checkbox" checked={c.ticked} disabled={readOnly} onChange={(e) => onPatch(c.key, { ticked: e.target.checked })} />
          Claim {n}
        </label>
        {c.line !== null && <span className="chip blue">line {c.line}</span>}
        <span className="rv-amt">{c.amountNote || (amount !== null && !Number.isNaN(amount) ? fmtMoney(amount) : "TBD")}</span>
      </div>
      <div className="rv-grid" style={{ marginTop: 6 }}>
        <input
          className={"rv-in full" + (problem && !c.title.trim() ? " bad" : "")}
          aria-label="Title"
          placeholder="What was promised"
          value={c.title}
          disabled={readOnly}
          onChange={(e) => onPatch(c.key, { title: e.target.value })}
        />
        <input
          className={"rv-in" + (amount !== null && Number.isNaN(amount) ? " bad" : "")}
          aria-label="Amount"
          inputMode="decimal"
          placeholder="Amount (₹)"
          value={c.amountText}
          disabled={readOnly}
          onChange={(e) => onPatch(c.key, { amountText: e.target.value })}
        />
        <input
          className="rv-in"
          aria-label="Amount note"
          placeholder="e.g. 2% of the bill"
          value={c.amountNote}
          maxLength={200}
          disabled={readOnly}
          onChange={(e) => onPatch(c.key, { amountNote: e.target.value })}
        />
        <select
          className="rv-in full"
          aria-label="Claim type"
          value={c.type}
          disabled={readOnly}
          onChange={(e) => onPatch(c.key, { type: e.target.value as LedgerViewGapType })}
        >
          {LEDGER_VIEW_GAP_TYPES.map((t) => (
            <option key={t} value={t}>{gapTypeLabel(t)}</option>
          ))}
        </select>
        <input
          className="rv-in"
          aria-label="Promised by"
          placeholder="Promised by"
          value={c.promisedBy}
          maxLength={120}
          disabled={readOnly}
          onChange={(e) => onPatch(c.key, { promisedBy: e.target.value })}
        />
        <input
          type="date"
          className="rv-in"
          aria-label="Promised on"
          value={c.promisedOn ?? ""}
          disabled={readOnly}
          onChange={(e) => onPatch(c.key, { promisedOn: e.target.value || null })}
        />
      </div>
      {c.quote && (
        <div className="evblocks" style={{ marginTop: 8 }}>
          <div className="rv-lbl" style={{ marginTop: 0 }}>Quoted message</div>
          <div className="evline"><span className="ev-q">&quot;{c.quote}&quot;</span></div>
        </div>
      )}
      {problem && <p className="rv-err">This claim: {problem}.</p>}
    </div>
  );
});

export function ClaimsReview({
  run,
  editable,
  onApproved,
  onDiscarded,
  onReload,
}: {
  run: ReviewRun;
  /** DONE, and the person holds Create on Ledger Claims. */
  editable: boolean;
  onApproved: (added: number) => void;
  onDiscarded: () => void;
  onReload: () => void;
}) {
  const p = run.proposals as ClaimsProposals;
  const [claims, setClaims] = useState<EditClaim[]>(() => toEditClaims(p.claims));
  const bar = useBarState(run.id, onDiscarded);
  const readOnly = !editable || bar.busy !== null;

  const onPatch: PatchClaim = useCallback((key, patch) => {
    setClaims((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }, []);

  const ticked = claims.filter((c) => c.ticked);
  const firstBad = ticked.find((c) => claimProblem(c));
  const blocked =
    claims.length === 0
      ? "There is nothing to add."
      : ticked.length === 0
        ? "Tick at least one claim."
        : firstBad
          ? `Claim ${claims.indexOf(firstBad) + 1}: ${claimProblem(firstBad)}.`
          : null;

  const approve = async () => {
    if (blocked) return;
    bar.setBusy("approve");
    bar.setError(null);
    const r = await acceptRun(run.id, { claims: ticked.map(toClaim) });
    if ("error" in r) {
      bar.setBusy(null);
      bar.setError({ text: r.error, status: r.status });
      return;
    }
    onApproved(r.result.gaps ?? ticked.length);
  };

  return (
    <div>
      <div className="card">
        <h3>Claims</h3>
        {claims.length === 0 ? (
          <div className="empty">The AI found no promises of a discount, credit or scheme in this.</div>
        ) : (
          <p className="rv-muted">
            {plural(claims.length, "claim")} found · {ticked.length.toLocaleString("en-IN")} ticked. Each ticked claim is added as a gap
            marked &ldquo;verify&rdquo;.
          </p>
        )}
        {claims.map((c, i) => (
          <ClaimCard key={c.key} c={c} n={i + 1} readOnly={readOnly} onPatch={onPatch} />
        ))}
      </div>

      {editable && (
        <ApproveBar
          label={`Add ${plural(ticked.length, "claim")} as gaps`}
          status={`${ticked.length.toLocaleString("en-IN")} of ${plural(claims.length, "claim")} ticked`}
          blocked={blocked}
          busy={bar.busy}
          error={bar.error}
          onApprove={approve}
          onDiscard={bar.discard}
          onReload={onReload}
        />
      )}
    </div>
  );
}
