"use client";

import { useState } from "react";
import { AlertTriangle, Hammer, X } from "lucide-react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { HoldIssue } from "./types";

const log = createLogger("assembly:hold-sheet");

interface HoldSheetProps {
  taskId: string;
  unitCode: string;
  onClose: () => void;
  /** Called after the hold is saved — reload the queue. */
  onHeld: () => void;
  /** Called when the hold could not be saved; the sheet is already closed by then. */
  onError: (message: string) => void;
}

/**
 * The one-tap hold (plan 1709, R3, R4). Two large boxes and nothing else: one tap saves the
 * hold and closes the sheet. No confirm, no text box, no undo bar — a mis-tap is fixed with
 * Resume (Q4). A bottom sheet on a phone, a centred dialog on a wide screen.
 */
export function HoldSheet({ taskId, unitCode, onClose, onHeld, onError }: HoldSheetProps) {
  const [sending, setSending] = useState(false);

  async function hold(issue: HoldIssue) {
    if (sending) return; // a double tap sends once
    setSending(true);
    onClose();
    const { error, status } = await apiTry(`/api/assembly/tasks/${taskId}/hold`, {
      method: "POST",
      json: { action: "HOLD", issue },
    });
    if (error) {
      log.error("hold failed", { taskId, issue, status });
      onError(error);
      return;
    }
    log.info("build held", { taskId, issue });
    onHeld();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hold-sheet-title"
        className="w-full max-w-md rounded-t-2xl bg-white p-4 pb-6 shadow-xl sm:rounded-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 id="hold-sheet-title" className="text-sm font-bold text-slate-900">
            Hold <span className="font-mono text-indigo-600">{unitCode}</span> — what is the issue?
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={sending}
            onClick={() => hold("CYCLE")}
            className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-red-200 bg-red-50 p-4 text-center font-black uppercase tracking-wide text-red-800 transition-colors hover:bg-red-100 active:bg-red-200 disabled:opacity-60"
          >
            <AlertTriangle className="h-8 w-8 text-red-600" aria-hidden />
            <span className="text-base leading-tight">Issue with the cycle</span>
          </button>
          <button
            type="button"
            disabled={sending}
            onClick={() => hold("WORKFLOOR")}
            className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-center font-black uppercase tracking-wide text-amber-900 transition-colors hover:bg-amber-100 active:bg-amber-200 disabled:opacity-60"
          >
            <Hammer className="h-8 w-8 text-amber-600" aria-hidden />
            <span className="text-base leading-tight">Issue on the workfloor</span>
          </button>
        </div>
        <p className="mt-3 text-center text-[11px] text-slate-500">The timer freezes until you tap Resume.</p>
      </div>
    </div>
  );
}
