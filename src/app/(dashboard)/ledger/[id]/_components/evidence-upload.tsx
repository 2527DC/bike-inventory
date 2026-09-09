"use client";

// Attach a screenshot or PDF to a claim — plan 0909-vendor-ledger-screens-and-ai-import,
// §3 Part B.8. The ledger app pinned evidence in a generated file (evidence.gen.js); here it
// is uploaded per gap. Rendering the shots is <GapShots>'s job; this form only adds one.
import { useRef, useState } from "react";
import { apiTry } from "@/lib/api-client";

export function EvidenceUpload({ gapId, reload }: { gapId: string; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) {
    return (
      <button className="iconbtn" style={{ fontSize: 12, marginTop: 6 }} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        + Add screenshot / PDF
      </button>
    );
  }

  const save = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    if (date.trim()) form.append("date", date.trim());
    if (source.trim()) form.append("source", source.trim());
    if (note.trim()) form.append("note", note.trim());
    const { error } = await apiTry(`/api/ledger/gaps/${gapId}/evidence`, { method: "POST", body: form, timeoutMs: 120_000 });
    setBusy(false);
    if (error) {
      alert("Upload failed: " + error);
      return;
    }
    setOpen(false);
    setDate("");
    setSource("");
    setNote("");
    reload();
  };

  return (
    <div className="form" style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
      <div><label>Screenshot or PDF</label><input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" /></div>
      <div className="row">
        <div><label>Date of the evidence</label><input value={date} onChange={(e) => setDate(e.target.value)} placeholder="2025-05-05 or 'Aug-2024 orders'" /></div>
        <div><label>Source</label><input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Mani WhatsApp chat (L1600)" /></div>
      </div>
      <div><label>What it proves</label><input value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="formactions">
        <button className="iconbtn" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
        <button className="iconbtn primary" disabled={busy} onClick={save}>{busy ? "Uploading…" : "Attach"}</button>
      </div>
    </div>
  );
}
