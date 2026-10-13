"use client";

// What a person can do to one suspense case (plan 1210-bank-accounts-and-suspense, D1, Q5):
//   open case   → Reassign (edit) · Mark explained (edit) · Write off (approve)
//   closed      → Reopen (edit), for an explained or written-off case only
// The buttons are cosmetic — PATCH /api/bank-suspense/[id] re-checks every grant, and a write-off
// without approve is refused there with the owner's sentence. One panel is open at a time.
import { useState, useId } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { PersonOrNamePicker, type PersonOrName } from "@/components/person-or-name-picker";
import type { SuspenseDetail } from "./types";

const log = createLogger("accounts:suspense");

type Panel = "reassign" | "explain" | "writeoff" | "reopen";
const NOTE_MIN = 5;
const NOTE_MAX = 500;

interface Props {
  detail: SuspenseDetail;
  canEdit: boolean;
  canApprove: boolean;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onUpdated: (d: SuspenseDetail, done: string) => void;
  /** A 409: the case moved under us. The sheet re-reads it and keeps the API's sentence. */
  onStale: (message: string) => void;
}

const PANEL_TEXT: Record<Exclude<Panel, "reassign">, { label: string; placeholder: string; confirm: string; done: string }> = {
  explain: {
    label: "What was it?",
    placeholder: "e.g. Own transfer ICICI → HDFC Hub, or customer receipt booked in Zoho by Deekshith",
    confirm: "Mark explained",
    done: "Marked explained.",
  },
  writeoff: {
    label: "Why is it written off?",
    placeholder: "e.g. Bank cannot trace the sender; Deekshith agrees to write it off",
    confirm: "Write off",
    done: "Written off.",
  },
  reopen: {
    label: "Why reopen it?",
    placeholder: "e.g. The explanation was wrong — Hero says they never sent it",
    confirm: "Reopen",
    done: "Reopened — back in suspense.",
  },
};

export function CaseActions({ detail, canEdit, canApprove, busy, setBusy, onUpdated, onStale }: Props) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState<PersonOrName>({ assigneeId: null, assigneeName: null });
  const [users, setUsers] = useState<{ id: string; name: string }[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();

  const open = detail.status === "OPEN";
  const reopenable = !open && (detail.resolution === "EXPLAINED" || detail.resolution === "WRITTEN_OFF");

  function show(p: Panel) {
    setError(null);
    setNote("");
    setPanel((cur) => (cur === p ? null : p));
  }

  async function loadUsers() {
    setUsersLoading(true);
    setUsersError(null);
    const { data, error: err, status } = await apiTry<{ users: { id: string; name: string }[] }>("/api/bank-suspense/assignees");
    setUsersLoading(false);
    if (err || !data) {
      log.error("assignee list failed", { status, message: err });
      setUsersError(err ?? "Could not load the staff list.");
      return;
    }
    setUsers(data.users);
  }

  function showReassign() {
    show("reassign");
    setAssignee({ assigneeId: detail.assignee?.id ?? null, assigneeName: detail.assigneeName });
    if (!users && !usersLoading) void loadUsers();
  }

  async function patch(body: unknown, done: string, action: string) {
    setBusy(true);
    setSaving(true);
    setError(null);
    const { data, error: err, status } = await apiTry<SuspenseDetail>(`/api/bank-suspense/${detail.id}`, {
      method: "PATCH",
      json: body,
    });
    setBusy(false);
    setSaving(false);
    if (err || !data) {
      log.error("suspense change failed", { suspenseId: detail.id, action, status, message: err });
      setError(err ?? "The change was not saved.");
      if (status === 409) onStale(err ?? "Someone else changed this case first.");
      return;
    }
    log.info("suspense changed", { suspenseId: detail.id, action });
    setPanel(null);
    setNote("");
    onUpdated(data, done);
  }

  function confirmNote() {
    if (panel === "explain") return patch({ resolve: "EXPLAINED", note: note.trim() }, PANEL_TEXT.explain.done, "explain");
    if (panel === "writeoff") return patch({ resolve: "WRITTEN_OFF", note: note.trim() }, PANEL_TEXT.writeoff.done, "write_off");
    if (panel === "reopen") return patch({ reopen: true, note: note.trim() }, PANEL_TEXT.reopen.done, "reopen");
  }

  function saveAssignee() {
    const name = assignee.assigneeName?.trim() || null;
    const body = { assign: { assigneeId: assignee.assigneeId, assigneeName: assignee.assigneeId ? null : name } };
    const done = assignee.assigneeId || name ? "Reassigned." : "Nobody is chasing it now.";
    return patch(body, done, "assign");
  }

  if (!canEdit && !canApprove) return null;
  if (!open && !reopenable) {
    return detail.resolution === "RECORDED" ? (
      <p className="text-[11px] text-slate-500 rounded-lg bg-slate-50 px-3 py-2">
        Closed because the line was recorded. To reopen it, undo its payment, expense or settlement match.
      </p>
    ) : null;
  }

  const btn =
    "min-h-[44px] px-3 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 focus-ring";
  const noteValid = note.trim().length >= NOTE_MIN;

  return (
    <section aria-label="Actions" className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {open && canEdit && (
          <button type="button" onClick={showReassign} disabled={busy} aria-pressed={panel === "reassign"}
            className={`${btn} ${panel === "reassign" ? "border-blue-500 bg-blue-50 text-blue-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
            Reassign
          </button>
        )}
        {open && canEdit && (
          <button type="button" onClick={() => show("explain")} disabled={busy} aria-pressed={panel === "explain"}
            className={`${btn} ${panel === "explain" ? "border-blue-500 bg-blue-50 text-blue-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
            Mark explained
          </button>
        )}
        {open && canApprove && (
          <button type="button" onClick={() => show("writeoff")} disabled={busy} aria-pressed={panel === "writeoff"}
            className={`${btn} ${panel === "writeoff" ? "border-red-500 bg-red-50 text-red-800" : "border-red-200 bg-white text-red-700 hover:bg-red-50"}`}>
            Write off
          </button>
        )}
        {reopenable && canEdit && (
          <button type="button" onClick={() => show("reopen")} disabled={busy} aria-pressed={panel === "reopen"}
            className={`${btn} ${panel === "reopen" ? "border-blue-500 bg-blue-50 text-blue-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
            Reopen
          </button>
        )}
      </div>

      {panel === "reassign" && (
        <div className="rounded-lg border border-slate-200 p-3 space-y-2">
          <p className="text-xs font-medium text-slate-700">Who chases it?</p>
          {usersLoading ? (
            <div className="space-y-1.5" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-11 rounded-lg bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : usersError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2.5">
              <p className="text-xs text-red-700">{usersError}</p>
              <button type="button" onClick={() => void loadUsers()} className="mt-1 min-h-[44px] px-3 text-xs font-medium text-red-700 focus-ring rounded">
                Retry
              </button>
            </div>
          ) : (
            <PersonOrNamePicker users={users ?? []} value={assignee} onChange={setAssignee} disabled={busy} />
          )}
          <SaveRow saving={saving} disabled={busy || usersLoading || !!usersError} label="Save" onClick={() => void saveAssignee()} onCancel={() => setPanel(null)} />
        </div>
      )}

      {panel && panel !== "reassign" && (
        <div className={`rounded-lg border p-3 space-y-2 ${panel === "writeoff" ? "border-red-200 bg-red-50/40" : "border-slate-200"}`}>
          <label htmlFor={noteId} className="block text-xs font-medium text-slate-700">
            {PANEL_TEXT[panel].label}
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
            disabled={busy}
            rows={3}
            maxLength={NOTE_MAX}
            placeholder={PANEL_TEXT[panel].placeholder}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
          />
          <p className="text-[10px] text-slate-400 tabular-nums">
            {note.trim().length < NOTE_MIN ? `At least ${NOTE_MIN} characters · ` : ""}
            {note.length}/{NOTE_MAX}
          </p>
          {panel === "writeoff" && (
            <p className="flex items-start gap-1.5 text-[11px] text-red-800">
              <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden="true" />
              Written off here only. Nothing is posted to Zoho Books — the accountant posts the write-off there.
            </p>
          )}
          <SaveRow
            saving={saving}
            disabled={busy || !noteValid}
            label={PANEL_TEXT[panel].confirm}
            destructive={panel === "writeoff"}
            onClick={() => void confirmNote()}
            onCancel={() => setPanel(null)}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}

function SaveRow(props: {
  saving: boolean;
  disabled: boolean;
  label: string;
  destructive?: boolean;
  onClick: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <button type="button" onClick={props.onCancel} disabled={props.saving}
        className="min-h-[44px] px-3 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 focus-ring">
        Cancel
      </button>
      <button type="button" onClick={props.onClick} disabled={props.disabled}
        className={`min-h-[44px] px-4 rounded-lg text-sm font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-50 focus-ring ${
          props.destructive ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-slate-800"
        }`}>
        {props.saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {props.label}
      </button>
    </div>
  );
}
