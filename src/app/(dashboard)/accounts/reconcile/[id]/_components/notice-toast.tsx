"use client";

// What the last action did — "Payment recorded.", or a bulk answer such as "12 recorded — 9 against
// bills, 3 as advances. 1 refused: already handled." Stays until dismissed or the next action:
// nothing here runs on a timer.
import { X } from "lucide-react";

export function NoticeToast({ text, warn, onDismiss }: { text: string; warn: boolean; onDismiss: () => void }) {
  return (
    <div className="fixed above-nav left-0 right-0 z-40 px-3 pb-2" role="status">
      <div
        className={`max-w-lg mx-auto flex items-start gap-2 rounded-lg border p-3 text-sm shadow-lg ${
          warn ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-green-50 border-green-200 text-green-800"
        }`}
      >
        <p className="flex-1">{text}</p>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-m-2 min-h-11 min-w-11 flex items-center justify-center">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
