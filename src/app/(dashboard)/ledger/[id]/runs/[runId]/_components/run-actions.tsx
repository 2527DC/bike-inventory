"use client";

// "Re-run with a new prompt" and the other reads of the same upload (plan 1310 §1.1). A re-run
// reads the cells or text kept on a run — no upload, the file was never stored — and opens the
// new run; the earlier ones stay listed here. Discard lives here too for runs with nothing to
// approve (not a ledger, failed, or a read that stopped).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IMPORT_PROMPT_MAX_CHARS } from "@/lib/brand-ledger/prompted-import";
import { DISCARD_CONFIRM } from "./approve-bar";
import { discardRun, rerunRun } from "./review-api";
import { STATUS_LABEL, fmtWhen, type ReviewRun } from "./review-types";

export function RunActions({
  run,
  canRerun,
  canDiscard,
  showDiscard,
  onDiscarded,
  onReload,
}: {
  run: ReviewRun;
  canRerun: boolean;
  canDiscard: boolean;
  /** Only where no approve bar carries Discard already. */
  showDiscard: boolean;
  onDiscarded: () => void;
  onReload: () => void;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(run.userPrompt ?? "");
  const [busy, setBusy] = useState<"rerun" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // This run's kept cells, or — for a run that failed or was set aside — another read of the
  // same upload that still holds them. Only a run waiting for review keeps them.
  const rerunFrom =
    run.task !== "PROMPTED_IMPORT" || run.status === "ACCEPTED"
      ? null
      : run.source
        ? run.id
        : (run.siblings?.find((s) => s.status === "DONE")?.id ?? null);
  const siblings = run.siblings ?? [];

  const rerun = async () => {
    if (!rerunFrom || !prompt.trim()) return;
    setBusy("rerun");
    setError(null);
    const r = await rerunRun(rerunFrom, prompt.trim());
    if ("error" in r) {
      setBusy(null);
      setError(r.error);
      // A re-run that failed still created a run; reloading lists it below.
      onReload();
      return;
    }
    router.push(`/ledger/${run.vendorId}/runs/${r.id}`);
  };

  const discard = async () => {
    if (!confirm(DISCARD_CONFIRM)) return;
    setBusy("discard");
    setError(null);
    const r = await discardRun(run.id);
    if ("error" in r) {
      setBusy(null);
      setError(r.error);
      return;
    }
    onDiscarded();
  };

  const showRerun = run.task === "PROMPTED_IMPORT" && run.status !== "ACCEPTED" && canRerun;
  const discardable = showDiscard && canDiscard && run.status !== "ACCEPTED" && run.status !== "DISCARDED";
  if (!showRerun && !discardable && siblings.length === 0) return null;

  return (
    <div className="card">
      {showRerun && (
        <>
          <h3>Re-run with a new prompt</h3>
          {rerunFrom ? (
            <>
              <p className="rv-muted">
                Say what to do differently — which column means what, what to skip, what this is. The kept{" "}
                {run.source?.kind === "text" ? "text" : "cells"} are read again; nothing is uploaded, and this run stays listed.
              </p>
              <div className="form" style={{ marginTop: 8 }}>
                <textarea
                  aria-label="Prompt for the re-run"
                  value={prompt}
                  rows={4}
                  maxLength={IMPORT_PROMPT_MAX_CHARS}
                  disabled={busy !== null}
                  style={{ fontSize: 16 }}
                  placeholder="e.g. AMOUNT is their invoice, PAYMENT is our payment; skip the summary block at the top"
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>
              <div className="rv-row" style={{ marginTop: 8 }}>
                <button type="button" className="iconbtn primary rv-btn" disabled={busy !== null || !prompt.trim()} onClick={rerun}>
                  {busy === "rerun" ? "Reading again… this can take a minute" : "Re-run with this prompt"}
                </button>
                <span className="rv-muted">
                  {prompt.length.toLocaleString("en-IN")} / {IMPORT_PROMPT_MAX_CHARS.toLocaleString("en-IN")}
                </span>
              </div>
            </>
          ) : (
            <p className="rv-muted">
              Nothing was kept from this upload to read again — what was read is kept only while a run waits for review, and an
              image or PDF that was not a ledger keeps nothing. Upload the file again on the ledger page.
            </p>
          )}
        </>
      )}

      {discardable && (
        <div className="rv-row" style={{ marginTop: showRerun ? 12 : 0 }}>
          <button type="button" className="iconbtn danger rv-btn" disabled={busy !== null} onClick={discard}>
            {busy === "discard" ? "Discarding…" : "Discard this run"}
          </button>
        </div>
      )}

      {error && <div className="rv-bad" style={{ marginTop: 8 }}>{error}</div>}

      {siblings.length > 0 && (
        <>
          <div className="rv-lbl" style={{ marginTop: showRerun || discardable ? 14 : 0 }}>Other reads of this upload</div>
          {siblings.map((s) => (
            <Link key={s.id} className="rv-sib" href={`/ledger/${run.vendorId}/runs/${s.id}`}>
              <span className="grow">
                <span className="rv-row">
                  <span className={"chip " + STATUS_LABEL[s.status].chip}>{STATUS_LABEL[s.status].text}</span>
                  <span className="rv-muted">{fmtWhen(s.createdAt)}</span>
                </span>
                <span className="p" title={s.userPrompt ?? undefined}>{s.userPrompt || "No prompt"}</span>
              </span>
              <span aria-hidden="true" className="rv-muted" style={{ fontSize: 18 }}>›</span>
            </Link>
          ))}
        </>
      )}
    </div>
  );
}
