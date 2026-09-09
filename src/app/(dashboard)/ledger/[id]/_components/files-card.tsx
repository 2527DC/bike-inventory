"use client";

// The Files card — plan 0909-vendor-ledger-screens-and-ai-import, §3 Part E.2.
//
// The one addition to the ledger app's screen: R10–R12 have no counterpart in the app. It sits
// below the five tabs as a card in the app's own styling (card / iconbtn / chip / form), lists
// every file uploaded for this vendor, runs AI over one, and deletes one from storage. What an
// AI run proposed is reviewed in <ReviewCard>; nothing here writes a ledger row.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiTry } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import type { LedgerBrandView } from "@/lib/brand-ledger/view-types";
import { ReviewCard } from "./review-card";

type UploadKind = "STATEMENT" | "CHAT" | "SCREENSHOT" | "DOCUMENT";
type Task = "STATEMENT_ROWS" | "CLAIMS_FROM_CHAT" | "CLAIMS_FROM_IMAGE";

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

const KIND_LABEL: Record<UploadKind, string> = {
  STATEMENT: "Statement (PDF / XLSX / CSV)",
  CHAT: "WhatsApp chat (.txt / .zip)",
  SCREENSHOT: "Screenshot",
  DOCUMENT: "Document (PDF / image)",
};

const TASK_LABEL: Record<Task, string> = {
  STATEMENT_ROWS: "Read statement rows",
  CLAIMS_FROM_CHAT: "Find promised discounts / credits in the chat",
  CLAIMS_FROM_IMAGE: "Find promised discounts / credits in the image",
};

/** Which tasks a file of this kind can feed. */
function tasksFor(kind: UploadKind): Task[] {
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

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

export function FilesCard({ vendorId, brand, reload }: { vendorId: string; brand: LedgerBrandView; reload: () => void }) {
  const { canCreate, canDelete } = usePermissions();
  const canUpload = canCreate("brand_ledger");
  const canRunClaims = canCreate("brand_ledger_gaps");
  const canRemove = canDelete("brand_ledger");

  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<UploadKind>("STATEMENT");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Per-file "Run AI" panel state: which file is open, its task and prompt, and whether a run
  // is in flight. One open panel at a time — the app's forms behave the same way.
  const [runFor, setRunFor] = useState<string | null>(null);
  const [task, setTask] = useState<Task>("STATEMENT_ROWS");
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [reviewRunId, setReviewRunId] = useState<string | null>(null);

  // Promise chain, not an async body — see page.tsx for why (react-hooks/set-state-in-effect).
  const load = useCallback(
    () =>
      apiTry<{ uploads: UploadRow[] }>(`/api/ledger/vendors/${vendorId}/uploads`).then(({ data, error: err }) => {
        if (err) setError(err);
        else if (data) {
          setUploads(data.uploads);
          setError("");
        }
        setLoading(false);
      }),
    [vendorId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    const { error: err } = await apiTry(`/api/ledger/vendors/${vendorId}/uploads`, { method: "POST", body: form, timeoutMs: 120_000 });
    setUploading(false);
    if (err) {
      alert("Upload failed: " + err);
      return;
    }
    if (fileRef.current) fileRef.current.value = "";
    await load();
  };

  const openRun = (u: UploadRow) => {
    setRunFor(u.id);
    setTask(tasksFor(u.kind)[0]);
    setPrompt("");
  };

  const run = async (u: UploadRow) => {
    setRunning(true);
    const { data, error: err, status } = await apiTry<{ id: string; status: RunRow["status"]; error: string | null }>(
      `/api/ledger/uploads/${u.id}/run`,
      { method: "POST", json: { task, prompt: prompt.trim() || undefined }, timeoutMs: 180_000 }
    );
    setRunning(false);
    if (err) {
      alert(`AI run failed${status ? ` (${status})` : ""}: ${err}`);
      await load();
      return;
    }
    setRunFor(null);
    await load();
    if (data?.status === "DONE") setReviewRunId(data.id);
  };

  const remove = async (u: UploadRow) => {
    const accepted = u.runs.some((r) => r.status === "ACCEPTED");
    const ok = confirm(
      `Delete "${u.fileName}" from storage?` +
        (accepted ? "\nA run from this file was accepted into the ledger; those rows stay." : "") +
        "\nThe file itself cannot be recovered."
    );
    if (!ok) return;
    const { error: err } = await apiTry(`/api/ledger/uploads/${u.id}`, { method: "DELETE" });
    if (err) {
      alert("Delete failed: " + err);
      return;
    }
    await load();
  };

  const canRun = (t: Task) => (t === "STATEMENT_ROWS" ? canUpload : canRunClaims);

  return (
    <>
      <div className="card">
        <h3>Files &amp; AI</h3>
        <p className="smallmuted">
          Upload {brand.name}&apos;s statements, WhatsApp exports and screenshots, run AI over one, and review what it found
          before anything reaches the ledger. Files are stored in S3 until you delete them here.
        </p>

        {canUpload && (
          <div className="form" style={{ marginTop: 10 }}>
            <div className="row">
              <div>
                <label>Kind</label>
                <select value={kind} onChange={(e) => setKind(e.target.value as UploadKind)}>
                  {(Object.keys(KIND_LABEL) as UploadKind[]).map((k) => (
                    <option key={k} value={k}>{KIND_LABEL[k]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>File</label>
                <input ref={fileRef} type="file" />
              </div>
            </div>
            <div className="formactions">
              <button className="iconbtn primary" disabled={uploading} onClick={upload}>
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>
          </div>
        )}

        {error && <p className="smallmuted" style={{ color: "var(--red)" }}>{error}</p>}
        {loading && <div className="empty">Loading files…</div>}
        {!loading && uploads.length === 0 && <div className="empty">No files uploaded yet</div>}

        {uploads.map((u) => (
          <div key={u.id} className="gap" style={{ borderTop: "1px solid var(--line)", marginTop: 8, paddingLeft: 0, paddingRight: 0 }}>
            <div className="top" style={{ cursor: "default" }}>
              <span className="title">
                {u.fileUrl && !u.deletedAt ? (
                  <a href={u.fileUrl} target="_blank" rel="noreferrer">{u.fileName}</a>
                ) : (
                  <span style={{ color: "var(--muted)", textDecoration: "line-through" }}>{u.fileName}</span>
                )}
              </span>
              <span className="amt smallmuted">{fmtBytes(u.sizeBytes)}</span>
            </div>
            <div className="meta">
              <span className="chip">{u.kind.toLowerCase()}</span>
              <span className="chip">{day(u.createdAt)}</span>
              {u.deletedAt && <span className="chip red">deleted from storage {day(u.deletedAt)}</span>}
            </div>

            {u.runs.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {u.runs.map((r) => (
                  <div key={r.id} className="minigap" style={{ cursor: "default" }}>
                    <div className="mg-row">
                      <span className="mg-title">{TASK_LABEL[r.task]}</span>
                      <span className={"chip " + STATUS_CHIP[r.status]}>{r.status.toLowerCase()}</span>
                      <span className="mg-amt smallmuted">
                        {r.status === "FAILED" ? r.error : `${r.proposalsCount} proposed${r.chunks > 1 ? ` · ${r.chunks} parts` : ""}`}
                      </span>
                      {(r.status === "DONE" || r.status === "ACCEPTED") && (
                        <button className="iconbtn" style={{ fontSize: 12 }} onClick={() => setReviewRunId(r.id)}>
                          {r.status === "DONE" ? "Review" : "View"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="statusrow" style={{ marginTop: 8 }}>
              {!u.deletedAt && runFor !== u.id && tasksFor(u.kind).some(canRun) && (
                <button className="iconbtn" onClick={() => openRun(u)}>Run AI</button>
              )}
              {!u.deletedAt && canRemove && (
                <button style={{ color: "var(--red)" }} onClick={() => remove(u)}>Delete file</button>
              )}
            </div>

            {runFor === u.id && (
              <div className="form" style={{ marginTop: 8 }}>
                <div>
                  <label>Task</label>
                  <select value={task} onChange={(e) => setTask(e.target.value as Task)}>
                    {tasksFor(u.kind).filter(canRun).map((t) => (
                      <option key={t} value={t}>{TASK_LABEL[t]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>What to look for (optional)</label>
                  <textarea
                    value={prompt}
                    maxLength={500}
                    placeholder="e.g. discounts promised by Prashant on alloy bills after June 2025"
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                </div>
                <div className="formactions">
                  <button className="iconbtn" disabled={running} onClick={() => setRunFor(null)}>Cancel</button>
                  <button className="iconbtn primary" disabled={running} onClick={() => run(u)}>
                    {running ? "Running… this can take a minute" : "Run"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {reviewRunId && (
        <ReviewCard
          runId={reviewRunId}
          onClose={() => setReviewRunId(null)}
          reload={() => {
            void load();
            reload();
          }}
        />
      )}
    </>
  );
}
