"use client";

// The chase history of one suspense case, oldest first, and the box to add to it (plan
// 1210-bank-accounts-and-suspense, R8). Lines the app wrote itself ("Parked: …", "Assigned to …",
// "Explained: …") are shown apart from what people wrote.
import { useState, useId } from "react";
import { Bot, Loader2 } from "lucide-react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { whenLabel } from "../../_components/bank-labels";
import type { SuspenseNote } from "./types";

const log = createLogger("accounts:suspense");

const NOTE_MAX = 1000;

interface Props {
  caseId: string;
  notes: SuspenseNote[];
  canEdit: boolean;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onAdded: (note: SuspenseNote) => void;
}

export function CaseNotes({ caseId, notes, canEdit, busy, setBusy, onAdded }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const inputId = useId();

  async function add() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setAdding(true);
    setError(null);
    const { data, error: err, status } = await apiTry<SuspenseNote>(`/api/bank-suspense/${caseId}/notes`, {
      method: "POST",
      json: { text: body },
    });
    setBusy(false);
    setAdding(false);
    if (err || !data) {
      log.error("note not added", { suspenseId: caseId, status, message: err });
      setError(err ?? "The note was not saved.");
      return;
    }
    log.info("note added", { suspenseId: caseId, noteId: data.id });
    setText("");
    onAdded(data);
  }

  return (
    <section aria-label="Notes">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
        Notes {notes.length > 0 && <span className="text-slate-400">({notes.length})</span>}
      </h3>

      {notes.length === 0 ? (
        <p className="text-xs text-slate-400 mb-2">No notes yet.</p>
      ) : (
        <ol className="space-y-1.5 mb-3">
          {notes.map((n) =>
            n.isSystem ? (
              <li key={n.id} className="flex items-start gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5">
                <Bot className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-400" aria-label="Written by the app" />
                <div className="min-w-0">
                  <p className="text-xs text-slate-600 break-words">{n.body}</p>
                  <p className="text-[10px] text-slate-400">
                    {n.author.name} · {whenLabel(n.createdAt)}
                  </p>
                </div>
              </li>
            ) : (
              <li key={n.id} className="rounded-lg border border-slate-200 px-2.5 py-1.5">
                <p className="text-xs text-slate-800 whitespace-pre-wrap break-words">{n.body}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  <span className="font-medium text-slate-600">{n.author.name}</span> · {whenLabel(n.createdAt)}
                </p>
              </li>
            )
          )}
        </ol>
      )}

      {canEdit && (
        <div>
          <label htmlFor={inputId} className="sr-only">
            Add a note
          </label>
          <textarea
            id={inputId}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, NOTE_MAX))}
            disabled={busy}
            rows={2}
            maxLength={NOTE_MAX}
            placeholder="Add a note — e.g. Asked Deekshith on WhatsApp"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
          />
          {error && (
            <p role="alert" className="text-xs text-red-600 mt-1">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-slate-400 tabular-nums">
              {text.length}/{NOTE_MAX}
            </span>
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy || !text.trim()}
              className="min-h-[44px] px-4 rounded-lg bg-slate-900 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5 focus-ring"
            >
              {adding && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Add note
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
