"use client";

// "Import with AI" — plan 1310-ledger-prompted-import-without-file-storage, R1, R2, R6, R7.
//
// Anything a vendor sends (Excel, CSV, a chat, a Word file, a photo, a PDF) or text pasted in,
// plus the owner's prompt saying what it is and where it goes. The file is read HERE, in the
// browser (client-input.ts), and only what was read out of it is sent — the file itself is never
// uploaded to storage (R6). The route answers with a run id and the review page takes over; no
// ledger row is written until a person approves there (R4, R5).
//
// Logging: kinds, sizes, ids and timings. Never the prompt, a cell or the text.
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { usePermissions } from "@/lib/use-permissions";
import { IMPORT_PROMPT_MAX_CHARS, IMPORT_TEXT_MAX_CHARS, type ImportInput } from "@/lib/brand-ledger/prompted-import";
import { ImportInputError, describeInput, inputWireBytes, prepareImportInput } from "@/lib/brand-ledger/client-input";

const log = createLogger("ledger:import-panel");

/** The route may take ~60 s (its maxDuration) after a slow phone upload of up to ~4 MB. */
const SEND_TIMEOUT_MS = 120_000;

type Stage = "idle" | "reading" | "sending" | "opening";

interface Prepared {
  input: ImportInput;
  label: string;
  wireBytes: number;
  fileBytes: number;
}

const STAGE_TEXT: Record<Exclude<Stage, "idle">, string> = {
  reading: "Reading the file…",
  sending: "The AI is reading it… this can take up to a minute. Keep this page open.",
  opening: "Done — opening the review…",
};

const TALL: CSSProperties = { minHeight: 44 };

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export function ImportPanel({
  vendorId,
  vendorName,
  onFailed,
}: {
  vendorId: string;
  vendorName?: string;
  /** Called after a failed attempt — the route may have recorded a FAILED run worth listing. */
  onFailed?: () => void;
}) {
  const router = useRouter();
  const { canCreate } = usePermissions();

  const [mode, setMode] = useState<"file" | "text">("file");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [readError, setReadError] = useState("");
  const [pasted, setPasted] = useState("");
  const [prompt, setPrompt] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [sendError, setSendError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // A second pick while the first is still being read must win; the older result is dropped.
  const pickSeq = useRef(0);

  const pastedChars = pasted.trim().length;
  const pastedTooLong = pastedChars > IMPORT_TEXT_MAX_CHARS;
  // Pasted text is the body's bulk: its UTF-8 size is what will cross the wire.
  const pastedBytes = useMemo(() => new TextEncoder().encode(pasted.trim()).length, [pasted]);

  // Cosmetic: the route re-checks (requireImportAccess). Either create permission may start one.
  if (!canCreate("brand_ledger") && !canCreate("brand_ledger_gaps")) return null;

  const busy = stage !== "idle";
  const promptReady = prompt.trim().length > 0;
  const inputReady = mode === "file" ? !!prepared : pastedChars > 0 && !pastedTooLong;

  const pick = async (file: File | null) => {
    const seq = ++pickSeq.current;
    setPrepared(null);
    setReadError("");
    setSendError("");
    if (!file) return;
    setStage("reading");
    try {
      const input = await prepareImportInput({ file });
      if (seq !== pickSeq.current) return;
      setPrepared({ input, label: describeInput(input), wireBytes: inputWireBytes(input), fileBytes: file.size });
    } catch (e) {
      if (seq !== pickSeq.current) return;
      if (e instanceof ImportInputError) {
        // Already logged at warn by client-input with the kind and size.
        log.debug("file refused before sending", { vendorId, bytes: file.size });
        setReadError(e.message);
      } else {
        log.error("file preparation failed", { vendorId, bytes: file.size, error: e instanceof Error ? e.name : "unknown" });
        setReadError("This file could not be read. Try saving it again, or paste the text instead.");
      }
    } finally {
      if (seq === pickSeq.current) setStage("idle");
    }
  };

  const clearFile = () => {
    pickSeq.current++;
    if (fileRef.current) fileRef.current.value = "";
    setPrepared(null);
    setReadError("");
    setSendError("");
  };

  const switchMode = (next: "file" | "text") => {
    setMode(next);
    setSendError("");
  };

  const submit = async () => {
    if (busy || !promptReady || !inputReady) return;
    setSendError("");

    let input: ImportInput;
    if (mode === "file") {
      if (!prepared) return;
      input = prepared.input;
    } else {
      try {
        input = await prepareImportInput({ text: pasted });
      } catch (e) {
        log.debug("pasted text refused", { vendorId, chars: pastedChars, error: e instanceof Error ? e.name : "unknown" });
        setSendError(e instanceof ImportInputError ? e.message : "This text could not be read.");
        return;
      }
    }

    setStage("sending");
    const started = Date.now();
    const { data, error, status, isTimeout } = await apiTry<{ id: string; uploadId: string }>(
      `/api/ledger/vendors/${vendorId}/import`,
      { method: "POST", json: { prompt: prompt.trim(), input }, timeoutMs: SEND_TIMEOUT_MS }
    );
    const ms = Date.now() - started;

    if (error || !data) {
      const ctx = { vendorId, status, isTimeout, inputKind: input.kind, ms };
      if (status && status < 500) log.warn("import refused", ctx);
      else log.error("import failed", ctx);
      setSendError(error ?? "The import failed. Try again.");
      setStage("idle");
      onFailed?.();
      return;
    }

    log.info("import read — opening the review", { vendorId, runId: data.id, uploadId: data.uploadId, inputKind: input.kind, ms });
    // Stays busy until the review page replaces this one, so a second tap cannot send it twice.
    setStage("opening");
    router.push(`/ledger/${vendorId}/runs/${data.id}`);
  };

  const who = vendorName?.trim() || "Lucifer";
  const placeholder =
    `e.g. This is ${who}'s ledger for FY25-26. AMOUNT is their invoice, PAYMENT is our payment.\n` +
    "or: These are claims from the Hero WhatsApp group.\n" +
    "or: This photo is their September statement.";

  return (
    <div className="card">
      <h3>Import with AI</h3>
      <p className="smallmuted" style={{ marginTop: 0 }}>
        Upload what {vendorName || "the vendor"} sent — an Excel ledger, a CSV, a WhatsApp chat (.txt or .zip), a Word file, a
        photo or a PDF — or paste text. Say in your own words what it is and what to do with it. You review everything before
        anything is added.
      </p>

      <div className="form" style={{ marginTop: 10 }}>
        {/* Both stay mounted, so switching to text and back keeps the file already picked. */}
        <div style={mode === "file" ? undefined : { display: "none" }}>
          <label htmlFor="ledger-import-file">File</label>
          <input
            id="ledger-import-file"
            ref={fileRef}
            type="file"
            disabled={busy}
            style={TALL}
            onChange={(e) => void pick(e.target.files?.[0] ?? null)}
          />
          {prepared && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
              <span className="chip green">Ready</span>
              <span className="smallmuted" style={{ flex: 1, minWidth: 0 }}>
                {prepared.label} · {fmtBytes(prepared.wireBytes)} to send
                {prepared.input.kind !== "attachment" || prepared.input.mediaType !== "application/pdf"
                  ? ` (the file is ${fmtBytes(prepared.fileBytes)})`
                  : ""}
              </span>
              <button type="button" className="iconbtn" style={TALL} disabled={busy} onClick={clearFile}>
                Clear
              </button>
            </div>
          )}
          {readError && (
            <p className="smallmuted" role="alert" style={{ color: "var(--red)", margin: "6px 0 0" }}>
              {readError}
            </p>
          )}
          <button
            type="button"
            className="iconbtn"
            style={{ ...TALL, marginTop: 8, width: "100%" }}
            disabled={busy}
            onClick={() => switchMode("text")}
          >
            Paste text instead
          </button>
        </div>
        <div style={mode === "text" ? undefined : { display: "none" }}>
          <label htmlFor="ledger-import-text">Text</label>
          <textarea
            id="ledger-import-text"
            value={pasted}
            rows={6}
            disabled={busy}
            placeholder="Paste a message, a statement copied from an email, a list of credit notes…"
            onChange={(e) => setPasted(e.target.value)}
          />
          <div className="smallmuted" style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
            <span style={{ color: pastedTooLong ? "var(--red)" : undefined }}>
              {pastedChars.toLocaleString("en-IN")} / {IMPORT_TEXT_MAX_CHARS.toLocaleString("en-IN")} characters
              {pastedTooLong ? " — too long, split it into parts" : ""}
            </span>
            {pastedChars > 0 && <span>{fmtBytes(pastedBytes)} to send</span>}
          </div>
          <button
            type="button"
            className="iconbtn"
            style={{ ...TALL, marginTop: 8, width: "100%" }}
            disabled={busy}
            onClick={() => switchMode("file")}
          >
            Choose a file instead
          </button>
        </div>

        <div>
          <label htmlFor="ledger-import-prompt">What is this, and what should be done with it? (required)</label>
          <textarea
            id="ledger-import-prompt"
            value={prompt}
            rows={4}
            maxLength={IMPORT_PROMPT_MAX_CHARS}
            disabled={stage === "sending" || stage === "opening"}
            placeholder={placeholder}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="smallmuted" style={{ textAlign: "right", marginTop: 4 }}>
            {prompt.length.toLocaleString("en-IN")} / {IMPORT_PROMPT_MAX_CHARS.toLocaleString("en-IN")}
          </div>
        </div>

        <p className="smallmuted" style={{ margin: 0 }}>
          The file is read now and not kept — only what is extracted is saved, for your review.
        </p>

        {stage !== "idle" && (
          <p className="smallmuted" role="status" aria-live="polite" style={{ margin: 0, color: "var(--blue)", fontWeight: 600 }}>
            {STAGE_TEXT[stage]}
          </p>
        )}
        {sendError && (
          <div className="alert" role="alert" style={{ marginBottom: 0 }}>
            {sendError}
          </div>
        )}

        <div className="formactions">
          <button
            type="button"
            className="iconbtn primary"
            style={TALL}
            disabled={busy || !inputReady || !promptReady}
            onClick={() => void submit()}
          >
            {stage === "sending" ? "Reading…" : stage === "opening" ? "Opening…" : "Read with AI"}
          </button>
        </div>
        {!busy && inputReady && !promptReady && (
          <p className="smallmuted" style={{ margin: 0 }}>
            Write the prompt first — the AI follows your words.
          </p>
        )}
      </div>
    </div>
  );
}
