"use client";

// The review page's header card: what was read, how, with which prompt, when, and where it
// stands. A prompted import's file was read on upload and never kept (R6) — said so plainly,
// so nobody goes looking for a download.
import { STATUS_LABEL, fmtWhen, inputKindLabel, type ReviewRun, type RunTask } from "./review-types";

const TASK_LABEL: Record<RunTask, string> = {
  PROMPTED_IMPORT: "Import with a prompt",
  STATEMENT_ROWS: "Read statement rows",
  CLAIMS_FROM_CHAT: "Promises found in a chat",
  CLAIMS_FROM_IMAGE: "Promises found in an image",
};

export function ReviewHeader({ run }: { run: ReviewRun }) {
  const status = STATUS_LABEL[run.status];
  const prompted = run.task === "PROMPTED_IMPORT";
  // Text typed into the box has no file; the import route names its upload "Typed text".
  const fileName = run.upload.fileName || "Typed text";
  const stored = !!run.upload.fileUrl && !run.upload.deletedAt;

  return (
    <div className="card">
      <div className="rv-row" style={{ alignItems: "flex-start" }}>
        <div className="grow rv-file">{fileName}</div>
        <span className={"chip " + status.chip}>{status.text}</span>
      </div>

      <div className="rv-meta">
        <span className="chip">{inputKindLabel(run)}</span>
        <span className="chip">{TASK_LABEL[run.task]}</span>
        <span className="chip">{fmtWhen(run.createdAt)}</span>
        {run.source?.kind === "sheet" && run.source.sheets.length > 1 && (
          <span className="chip">{run.source.sheets.length} sheets</span>
        )}
      </div>

      {prompted && !run.upload.fileUrl && (
        <p className="rv-muted" style={{ marginTop: 8 }}>Read on upload — the file was not kept.</p>
      )}
      {!prompted && stored && (
        <p className="rv-muted" style={{ marginTop: 8 }}>
          <a href={run.upload.fileUrl as string} target="_blank" rel="noreferrer">Open the stored file</a>
        </p>
      )}
      {!prompted && run.upload.deletedAt && (
        <p className="rv-muted" style={{ marginTop: 8 }}>The file was deleted from storage on {fmtWhen(run.upload.deletedAt)}.</p>
      )}

      <div className="rv-lbl">Prompt used</div>
      {run.userPrompt ? (
        <div className="rv-prompt">{run.userPrompt}</div>
      ) : (
        <p className="rv-muted">No prompt was given.</p>
      )}

      {(run.model || run.chunks > 1) && (
        <p className="rv-muted" style={{ marginTop: 8 }}>
          {[
            run.model ? `${run.provider ?? "AI"} · ${run.model}` : null,
            run.usageIn != null && run.model
              ? `${run.usageIn.toLocaleString("en-IN")} in / ${(run.usageOut ?? 0).toLocaleString("en-IN")} out tokens`
              : null,
            run.chunks > 1 ? `${run.chunks} AI calls` : null,
            run.latencyMs != null ? `${Math.round(run.latencyMs / 1000)} s` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {run.source?.kind === "text" && (
        <details className="rv-details" style={{ marginTop: 4 }}>
          <summary>The text that was read ({run.source.text.length.toLocaleString("en-IN")} characters)</summary>
          <div className="rv-text">{run.source.text}</div>
        </details>
      )}
    </div>
  );
}
