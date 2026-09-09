"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

interface StepShellProps {
  title: string;
  /** "Step 2 of 5", or a sentence for the non-entry screens. */
  subtitle?: string;
  onBack: () => void;
  /** How many expenses are already in the batch — visible on every screen (Part C rules). */
  rowCount: number;
  /** True while a row picked from the review screen is being changed. */
  editing?: boolean;
  children: ReactNode;
  /** The forward button(s). Rendered below the content with room to tap. */
  footer?: ReactNode;
}

/**
 * One screen of the stepper: back arrow, title, the running batch count, content, footer.
 * The same frame on every step is what lets a person feel where they are in the flow.
 */
export function StepShell({ title, subtitle, onBack, rowCount, editing, children, footer }: StepShellProps) {
  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          onClick={onBack}
          className="p-2.5 -ml-2 rounded-lg hover:bg-slate-100 focus-ring min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-slate-900 truncate">{title}</h1>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        <span
          className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full tabular-nums ${
            editing ? "bg-amber-100 text-amber-700" : rowCount > 0 ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {editing ? "Editing" : rowCount === 1 ? "1 in batch" : `${rowCount} in batch`}
        </span>
      </div>

      <div className="space-y-4">{children}</div>

      {footer && <div className="mt-6 space-y-2">{footer}</div>}
    </div>
  );
}
