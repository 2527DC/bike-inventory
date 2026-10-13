"use client";

// The Files card — plan 0909-vendor-ledger-screens-and-ai-import §3 Part E.2, reworked by plan
// 1310-ledger-prompted-import-without-file-storage (R4, R6).
//
// New input goes through <ImportPanel> at the top: read in the browser, sent with a prompt, and
// never stored. The old "upload a file to storage, then Run AI" form is gone — it kept the file
// (R6). Below the panel, every earlier upload with its AI runs; each run opens on the review
// page /ledger/[vendorId]/runs/[runId], which replaced the inline review card. A file stored by
// an upload before plan 1310 keeps its download link, its "Run AI" and its delete (§1.1 "leave
// them"). Nothing on this card writes a ledger row.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { usePermissions } from "@/lib/use-permissions";
import type { LedgerBrandView } from "@/lib/brand-ledger/view-types";
import { ImportPanel } from "./import-panel";

const log = createLogger("ledger:files");

type UploadKind = "STATEMENT" | "CHAT" | "SCREENSHOT" | "DOCUMENT";
/** The tasks an older stored file can still be run with (`POST /api/ledger/uploads/[id]/run`). */
type StoredTask = "STATEMENT_ROWS" | "CLAIMS_FROM_CHAT" | "CLAIMS_FROM_IMAGE";
type Task = StoredTask | "PROMPTED_IMPORT";

interface RunRow {
  id: string;
  task: Task;
  status: "RUNNING" | "DONE" | "FAILED" | "ACCEPTED" | "DISCARDED";
  createdAt: string;
  acceptedAt: string | null;
  chunks: number;
  error: string | null;
  proposalsCount: number;
}

interface UploadRow {
  id: string;
  kind: UploadKind;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  fileUrl: string | null;
  deletedAt: string | null;
  createdAt: string;
  runs: RunRow[];
}

const TASK_LABEL: Record<Task, string> = {
  STATEMENT_ROWS: "Read statement rows",
  CLAIMS_FROM_CHAT: "Find promised discounts / credits in the chat",
  CLAIMS_FROM_IMAGE: "Find promised discounts / credits in the image",
  PROMPTED_IMPORT: "Read with AI, by your prompt",
};

/** Which tasks a stored file of this kind can feed. */
function tasksFor(kind: UploadKind): StoredTask[] {
  if (kind === "STATEMENT") return ["STATEMENT_ROWS"];
  if (kind === "CHAT") return ["CLAIMS_FROM_CHAT"];
  return ["CLAIMS_FROM_IMAGE", "STATEMENT_ROWS"];
}

const STATUS_CHIP: Record<RunRow["status"], string> = {
  RUNNING: "amber",
  DONE: "blue",
  FAILED: "red",
  ACCEPTED: "green",
  DISCARDED: "",
};

const TALL: CSSProperties = { minHeight: 44 };
const LINK_BTN: CSSProperties = { ...TALL, display: "inline-flex", alignItems: "center", textDecoration: "none", whiteSpace: "nowrap" };

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

/** What a run produced, in a few words, for the list. */
function runSummary(r: RunRow): string {
  if (r.status === "RUNNING") return "still reading";
  if (r.status === "FAILED") return "failed";
  const n = r.proposalsCount;
  const parts = r.chunks > 1 ? ` · ${r.chunks} parts` : "";
  return `${n} proposed${parts}`;
}

export function FilesCard({ vendorId, brand }: { vendorId: string; brand: LedgerBrandView }) {
  const router = useRouter();
  const { canCreate, canDelete } = usePermissions();
  const canRunStatement = canCreate("brand_ledger");
  const canRunClaims = canCreate("brand_ledger_gaps");
  const canRemove = canDelete("brand_ledger");

  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  // Per-file "Run AI" panel for an older STORED file: which file is open, its task and prompt,
  // and whether a run is in flight. One open panel at a time — the app's forms behave the same way.
  const [runFor, setRunFor] = useState<string | null>(null);
  const [task, setTask] = useState<StoredTask>("STATEMENT_ROWS");
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  // Promise chain, not an async body — see page.tsx for why (react-hooks/set-state-in-effect).
  const load = useCallback(
    () =>
      apiTry<{ uploads: UploadRow[] }>(`/api/ledger/vendors/${vendorId}/uploads`).then(({ data, error: err, status }) => {
        if (err || !data) {
          log.warn("files failed to load", { vendorId, status });
          setError(err || "Could not load the files");
        } else {
          setUploads(data.uploads);
          setError("");
          log.debug("files loaded", { vendorId, uploads: data.uploads.length });
        }
        setLoading(false);
      }),
    [vendorId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const canRun = (t: StoredTask) => (t === "STATEMENT_ROWS" ? canRunStatement : canRunClaims);

  const openRun = (u: UploadRow) => {
    setRunFor(u.id);
    setTask(tasksFor(u.kind).filter(canRun)[0] ?? tasksFor(u.kind)[0]);
    setPrompt("");
    setActionError("");
  };

  // An older stored file, read again by the pre-1310 runner; the result opens on the review page.
  const run = async (u: UploadRow) => {
    setRunning(true);
    setActionError("");
    const { data, error: err, status } = await apiTry<{ id: string; status: RunRow["status"] }>(`/api/ledger/uploads/${u.id}/run`, {
      method: "POST",
      json: { task, prompt: prompt.trim() || undefined },
      timeoutMs: 180_000,
    });
    if (err || !data) {
      log.warn("stored-file run failed", { vendorId, uploadId: u.id, task, status });
      setRunning(false);
      setActionError(`AI run failed${status ? ` (${status})` : ""}: ${err ?? "no answer"}`);
      await load();
      return;
    }
    log.info("stored-file run finished — opening the review", { vendorId, uploadId: u.id, runId: data.id, task, status: data.status });
    setRunFor(null);
    router.push(`/ledger/${vendorId}/runs/${data.id}`);
  };

  const remove = async (u: UploadRow) => {
    const accepted = u.runs.some((r) => r.status === "ACCEPTED");
    const ok = confirm(
      `Delete "${u.fileName}" from storage?` +
        (accepted ? "\nA run from this file was accepted into the ledger; those rows stay." : "") +
        "\nThe file itself cannot be recovered."
    );
    if (!ok) return;
    setRemoving(u.id);
    setActionError("");
    const { error: err, status } = await apiTry(`/api/ledger/uploads/${u.id}`, { method: "DELETE" });
    setRemoving(null);
    if (err) {
      log.warn("stored-file delete failed", { vendorId, uploadId: u.id, status });
      setActionError("Delete failed: " + err);
      return;
    }
    log.info("stored file deleted", { vendorId, uploadId: u.id });
    await load();
  };

  return (
    <>
      <ImportPanel vendorId={vendorId} vendorName={brand.name} onFailed={() => void load()} />

      <div className="card">
        <h3>Files &amp; AI runs</h3>
        <p className="smallmuted" style={{ marginTop: 0 }}>
          Everything read for {brand.name}, newest first. Open a run to review it — nothing reaches the ledger until it is
          approved there. What you import above is read and not kept; files stored by earlier uploads stay downloadable until
          you delete them here.
        </p>

        {error && (
          <div className="alert" role="alert" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ flex: 1 }}>{error}</span>
            <button
              type="button"
              className="iconbtn"
              style={TALL}
              onClick={() => {
                setLoading(true);
                void load();
              }}
            >
              Try again
            </button>
          </div>
        )}
        {actionError && (
          <div className="alert" role="alert">
            {actionError}
          </div>
        )}
        {loading && <div className="empty">Loading files…</div>}
        {!loading && !error && uploads.length === 0 && <div className="empty">Nothing imported yet</div>}

        {uploads.map((u) => {
          const stored = !!u.fileUrl && !u.deletedAt;
          const notKept = !u.fileUrl && !u.deletedAt;
          const runnable = tasksFor(u.kind).filter(canRun);
          return (
            <div key={u.id} className="gap" style={{ borderTop: "1px solid var(--line)", marginTop: 8, paddingLeft: 0, paddingRight: 0 }}>
              <div className="top" style={{ cursor: "default" }}>
                <span className="title" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  {stored ? (
                    <a href={u.fileUrl as string} target="_blank" rel="noreferrer">
                      {u.fileName}
                    </a>
                  ) : notKept ? (
                    u.fileName
                  ) : (
                    <span style={{ color: "var(--muted)", textDecoration: "line-through" }}>{u.fileName}</span>
                  )}
                </span>
                <span className="amt smallmuted">{fmtBytes(u.sizeBytes)}</span>
              </div>
              <div className="meta">
                <span className="chip">{u.kind.toLowerCase()}</span>
                <span className="chip">{day(u.createdAt)}</span>
                {notKept && <span className="chip blue">read on upload — not stored</span>}
                {u.deletedAt && <span className="chip red">deleted from storage {day(u.deletedAt)}</span>}
              </div>

              {u.runs.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {u.runs.map((r) => (
                    <div key={r.id} className="minigap" style={{ cursor: "default" }}>
                      <div className="mg-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
                        <span className="mg-title" style={{ minWidth: 140 }}>
                          {TASK_LABEL[r.task] ?? r.task}
                        </span>
                        <span className={"chip " + STATUS_CHIP[r.status]}>{r.status.toLowerCase()}</span>
                        <span className="mg-amt smallmuted">{runSummary(r)}</span>
                        <Link className={"iconbtn" + (r.status === "DONE" ? " primary" : "")} style={LINK_BTN} href={`/ledger/${vendorId}/runs/${r.id}`}>
                          {r.status === "DONE" ? "Review" : "View"}
                        </Link>
                      </div>
                      {r.status === "FAILED" && r.error && (
                        <div className="mg-detail" style={{ color: "var(--red)", overflowWrap: "anywhere" }}>
                          {r.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {stored && runFor !== u.id && (runnable.length > 0 || canRemove) && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {runnable.length > 0 && (
                    <button type="button" className="iconbtn" style={TALL} disabled={running} onClick={() => openRun(u)}>
                      Run AI
                    </button>
                  )}
                  {canRemove && (
                    <button type="button" className="iconbtn danger" style={TALL} disabled={removing === u.id} onClick={() => void remove(u)}>
                      {removing === u.id ? "Deleting…" : "Delete file"}
                    </button>
                  )}
                </div>
              )}

              {stored && runFor === u.id && (
                <div className="form" style={{ marginTop: 8 }}>
                  <div>
                    <label htmlFor={`run-task-${u.id}`}>Task</label>
                    <select id={`run-task-${u.id}`} value={task} disabled={running} style={TALL} onChange={(e) => setTask(e.target.value as StoredTask)}>
                      {runnable.map((t) => (
                        <option key={t} value={t}>
                          {TASK_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`run-prompt-${u.id}`}>What to look for (optional)</label>
                    <textarea
                      id={`run-prompt-${u.id}`}
                      value={prompt}
                      maxLength={500}
                      disabled={running}
                      placeholder="e.g. discounts promised by Prashant on alloy bills after June 2025"
                      onChange={(e) => setPrompt(e.target.value)}
                    />
                  </div>
                  <div className="formactions">
                    <button type="button" className="iconbtn" style={TALL} disabled={running} onClick={() => setRunFor(null)}>
                      Cancel
                    </button>
                    <button type="button" className="iconbtn primary" style={TALL} disabled={running} onClick={() => void run(u)}>
                      {running ? "Running… this can take a minute" : "Run"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
