"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import type { Diagnostics } from "./types";

/**
 * A refused upload: the server's sentence as it came (400 / 409 / AI failure), and — when the
 * route sent them in `data.diagnostics` — the debug details, folded away. The details carry the
 * file's first lines, so they are shown only to the person who uploaded it and never logged.
 */
export function UploadError({
  message, diagnostics, onDismiss,
}: { message: string; diagnostics: Diagnostics | null; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
      <div className="flex items-start gap-2 text-xs text-red-700">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-medium break-words">{message}</p>
          {diagnostics?.hint && <p className="mt-1">{diagnostics.hint}</p>}
          {diagnostics && (diagnostics.fileStats || diagnostics.filePreview || diagnostics.aiResponse) && (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="flex items-center gap-1 mt-1 min-h-[44px] text-red-600 hover:text-red-800"
            >
              {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {open ? "Hide" : "Show"} debug info
            </button>
          )}
          {diagnostics && open && (
            <div className="mt-2 bg-red-100/50 rounded p-2 space-y-1.5 text-[10px] font-mono">
              {diagnostics.step && <p><span className="font-semibold">Failed at:</span> {diagnostics.step}</p>}
              {diagnostics.fileStats && (
                <p className="break-all">
                  <span className="font-semibold">File:</span> {diagnostics.fileStats.name} ({diagnostics.fileStats.size},{" "}
                  {diagnostics.fileStats.lines} lines, {diagnostics.fileStats.chars} chars)
                </p>
              )}
              {diagnostics.filePreview && (
                <div>
                  <p className="font-semibold mb-0.5">File preview (first 10 lines):</p>
                  <pre className="whitespace-pre-wrap break-all text-[9px] bg-white/50 rounded p-1.5 max-h-32 overflow-y-auto border border-red-200">
                    {diagnostics.filePreview}
                  </pre>
                </div>
              )}
              {diagnostics.aiResponse && (
                <div>
                  <p className="font-semibold mb-0.5">AI response:</p>
                  <pre className="whitespace-pre-wrap break-all text-[9px] bg-white/50 rounded p-1.5 max-h-32 overflow-y-auto border border-red-200">
                    {diagnostics.aiResponse}
                  </pre>
                </div>
              )}
            </div>
          )}
          <button type="button" onClick={onDismiss} className="underline mt-1 min-h-[44px]">dismiss</button>
        </div>
      </div>
    </div>
  );
}

/** A good upload: the B6 sentence, and the way to the lines it imported. */
export function UploadSuccess({
  message, statementId, onDismiss,
}: { message: string; statementId: string | null; onDismiss: () => void }) {
  return (
    <div role="status" className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3 text-xs text-green-800 flex items-start gap-2">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p>{message}</p>
        <div className="flex items-center gap-3 mt-1">
          {statementId && (
            <Link
              href={`/accounts/reconcile/${statementId}`}
              className="inline-flex items-center min-h-[44px] font-medium text-green-700 underline"
            >
              Review the lines
            </Link>
          )}
          <button type="button" onClick={onDismiss} className="underline min-h-[44px]">dismiss</button>
        </div>
      </div>
    </div>
  );
}
